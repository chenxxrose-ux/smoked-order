// 煙燻滷味：LINE 機器人
// 1. 網頁（剩貨頁、訂購頁）按「傳到 LINE 群組」→ 這裡用官方帳號把文字傳到綁定的群組。
//    文字只經過這裡轉送，不存檔。訂單電話是否遮蔽由網頁決定（預設遮蔽）。
// 2. LINE 的 Webhook 也打到這裡：在群組裡傳網頁上顯示的 6 位數字，就把那個群組綁定為發送對象。
// 驗證：網頁是公開的，所以用 tag —— 只有知道店家密碼的手機算得出來的 64 位雜湊；第一個設定的 tag 就是店家。
//       LINE 打來的請求用 Channel secret 驗簽章。
// Channel secret／access token 存在 line_cfg（只有這個程式讀得到）。
// 3. 每天提醒：網頁把「哪天、幾點取、在哪、要不要秤、稱呼、品項」交過來（不含電話地址，過了當天就刪），
//    資料庫排程打 op=tick（帶只存在資料庫裡的 cron_key），有訂單才傳卡片到群組：
//    凌晨 3:00（slot=early）只提醒「早市」的訂單；中午 12:00 提醒其他市場（早市那時已經提醒過）。
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://chenxxrose-ux.github.io"];
const API = "https://api.line.me/v2/bot";
const SELF = "https://fodibhcjitnrgpvqttky.supabase.co/functions/v1/line";

function serviceKey(): string {
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (k) return k;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default; } catch { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

type Cfg = Record<string, string>;
async function getCfg(): Promise<Cfg> {
  const { data } = await db.from("line_cfg").select("k,v");
  return Object.fromEntries((data || []).map((r: { k: string; v: string }) => [r.k, r.v]));
}
async function setCfg(p: Cfg) {
  await db.from("line_cfg").upsert(Object.entries(p).map(([k, v]) => ({ k, v, updated_at: new Date().toISOString() })));
}
async function delCfg(keys: string[]) { await db.from("line_cfg").delete().in("k", keys); }

async function line(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const t = await r.text();
  let j: any = {}; try { j = t ? JSON.parse(t) : {}; } catch { /* 非 JSON */ }
  return { ok: r.ok, status: r.status, j };
}
const say = (token: string, replyToken: string, text: string) =>
  line(token, "/message/reply", { method: "POST", body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }) });

async function quota(token: string) {
  const [q, c] = await Promise.all([line(token, "/message/quota"), line(token, "/message/quota/consumption")]);
  if (!q.ok || !c.ok) return null;
  return q.j.type === "limited" ? { left: Math.max(0, q.j.value - (c.j.totalUsage || 0)), max: q.j.value } : { left: null, max: null };
}

const isTag = (t: unknown) => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
const owns = (cfg: Cfg, tag: string) => !cfg.owner || cfg.owner === tag;

async function verifySig(secret: string, body: string, sig: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const want = btoa(String.fromCharCode(...mac));
  if (want.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

/* ===== LINE 打來的 Webhook ===== */
async function webhook(body: string, sig: string) {
  const cfg = await getCfg();
  if (!cfg.secret || !cfg.token || !(await verifySig(cfg.secret, body, sig))) return new Response("bad sig", { status: 401 });
  let events: any[] = [];
  try { events = JSON.parse(body).events || []; } catch { return new Response("ok"); }
  for (const ev of events) {
    const src = ev.source || {}, gid = src.groupId || src.roomId || "";
    if (ev.type === "join" && gid && gid !== cfg.group) {
      await say(cfg.token, ev.replyToken, "大家好！要讓剩貨和訂單自動傳到這個群組，請在剩貨頁按「傳到 LINE 群組」，把網頁上的 6 位數字傳到這裡。");
    } else if (ev.type === "message" && ev.message?.type === "text" && gid) {
      const code = String(ev.message.text || "").replace(/\s/g, "");
      const exp = Number(cfg.pair_exp || 0);
      if (cfg.pair && /^\d{6}$/.test(code) && code === cfg.pair) {
        if (Date.now() > exp) { await say(cfg.token, ev.replyToken, "這組數字過期了，請在網頁上重新產生一組。"); continue; }
        let name = "";
        if (src.groupId) { const s = await line(cfg.token, `/group/${src.groupId}/summary`); if (s.ok) name = s.j.groupName || ""; }
        await setCfg({ group: gid, group_name: name || "LINE 群組" });
        await delCfg(["pair", "pair_exp"]);
        await say(cfg.token, ev.replyToken, "✅ 已連上！之後在網頁按「傳到 LINE 群組」，剩貨和訂單就會傳到這裡。");
      }
    } else if (ev.type === "leave" && gid && gid === cfg.group) {
      await delCfg(["group", "group_name"]);
    }
  }
  return new Response("ok");
}

/* ===== 每天的訂單提醒（凌晨 3 點早市、中午其他市場） ===== */
const SITE = "https://chenxxrose-ux.github.io/smoked-order/?today&openExternalBrowser=1";   // 用 Safari 打開：LINE 內建瀏覽器記不住密碼，每次都要重輸
type Slot = { t: string; m: string; w: number; d: number; n?: string; i?: string };   // 取貨時間、地點、要秤、外送、稱呼、品項（不含電話地址）
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
function cleanDaily(x: unknown): Record<string, Slot[]> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const out: Record<string, Slot[]> = {};
  const ents = Object.entries(x as Record<string, unknown>);
  if (ents.length > 62) return null;
  for (const [d, arr] of ents) {
    if (!isDate(d) || !Array.isArray(arr) || arr.length > 120) return null;
    out[d] = arr.map((v: any) => ({
      t: typeof v?.t === "string" && /^\d{1,2}:\d{2}$/.test(v.t) ? v.t : "",
      m: typeof v?.m === "string" ? v.m.slice(0, 12) : "",
      w: v?.w ? 1 : 0, d: v?.d ? 1 : 0,
      n: typeof v?.n === "string" ? v.n.slice(0, 16) : "",
      i: typeof v?.i === "string" ? v.i.slice(0, 120) : "",
    }));
  }
  return out;
}
function twToday() {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  return { ymd: t.toISOString().slice(0, 10), wd: "日一二三四五六"[t.getUTCDay()], md: `${t.getUTCMonth() + 1}/${t.getUTCDate()}` };
}
const txt = (text: string, o: Record<string, unknown> = {}) => ({ type: "text", text, ...o });
const EARLY = "早市";
function dailyCard(md: string, wd: string, slots: Slot[], early = false) {
  const list = [...slots].sort((a, b) => (a.t || "99") < (b.t || "99") ? -1 : (a.t || "99") > (b.t || "99") ? 1 : 0);
  const weigh = list.filter(s => s.w).length;
  // 一筆一張小卡：上面「時間　稱呼　地點」，下面品項
  const shown = list.slice(0, 15);
  const rowBox = (r: Slot, k: number) => ({
    type: "box", layout: "vertical", spacing: "xs", contents: [
      ...(k ? [{ type: "separator", color: "#ECE9E4", margin: "none" }] : []),
      { type: "box", layout: "horizontal", spacing: "md", ...(k ? { margin: "md" } : {}), contents: [
        txt(r.t || "未定", { size: "md", color: r.t ? "#7B1F24" : "#8A847D", weight: "bold", flex: 0, wrap: false }),
        txt(r.n || "訂單", { size: "md", color: "#1E1A17", weight: "bold", flex: 1, wrap: true }),
        txt(r.d ? "外送" : (r.m || "　"), { size: "sm", color: "#8A847D", flex: 0, align: "end", gravity: "center", wrap: false }),
      ] },
      ...(r.i ? [txt(r.i, { size: "sm", color: "#4A4540", wrap: true })] : []),
      ...(r.w ? [txt("待秤重", { size: "xs", color: "#8A5A00", weight: "bold" })] : []),
    ],
  });
  return {
    type: "flex", altText: `今天（${md}）${early ? "早市" : ""}有 ${list.length} 筆訂單`,
    contents: {
      type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#F7F0E1", paddingAll: "20px", spacing: "sm", contents: [
        txt(early ? "早市訂單提醒" : "訂單提醒", { size: "sm", color: "#9A6B17", weight: "bold" }),
        { type: "box", layout: "baseline", spacing: "sm", contents: [
          txt(early ? "今天早市" : "今天", { size: "lg", color: "#1E1A17", weight: "bold", flex: 0 }),
          txt(String(list.length), { size: "3xl", color: "#7B1F24", weight: "bold", flex: 0 }),
          txt("筆訂單", { size: "lg", color: "#1E1A17", weight: "bold", flex: 0 }),
        ] },
        txt(`${md}（${wd}）${weigh ? `・${weigh} 筆待秤` : ""}`, { size: "sm", color: "#8A847D" }),
      ] },
      body: { type: "box", layout: "vertical", paddingAll: "20px", spacing: "md", contents: [
        ...shown.map(rowBox),
        ...(list.length > shown.length ? [txt(`還有 ${list.length - shown.length} 筆，打開網頁看全部`, { size: "xs", color: "#8A847D", wrap: true, margin: "md" })] : []),
      ] },
      footer: { type: "box", layout: "vertical", paddingAll: "16px", contents: [
        { type: "button", style: "primary", color: "#7B1F24", height: "sm", action: { type: "uri", label: "看今天的訂單", uri: SITE } },
      ] },
    },
  };
}
async function retryKey(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
async function tick(force = false, dry = false, probe: unknown = null, early = false) {
  const cfg = await getCfg();
  const { ymd, wd, md } = twToday();
  if (!cfg.token || !cfg.group) return { sent: false, why: "no group" };
  const lastKey = early ? "tick_early_last" : "tick_last";
  if (!force && cfg[lastKey] === ymd) return { sent: false, why: "done" };
  let daily: Record<string, Slot[]> = {};
  try { daily = JSON.parse(cfg.daily || "{}"); } catch { /* 壞掉當沒有 */ }
  const slots = (daily[ymd] || []).filter(s => early ? s.m === EARLY : s.m !== EARLY);
  if (dry) {   // 只請 LINE 檢查卡片格式，不真的傳（沒訂單就用範例）
    const sample: Slot[] = slots.length ? slots : [{ t: "10:00", m: "爸爸市場", w: 0, d: 0, n: "王小姐", i: "雞肝 ×20、豬舌頭 一顆" }, { t: "14:30", m: "", w: 1, d: 1, n: "陳先生", i: "鴨腸 約$150、豆乾" }, { t: "", m: "媽媽市場", w: 0, d: 0, n: "客人（小姐）", i: "雞腳 一斤" }];
    const msg = probe && typeof probe === "object" ? { type: "flex", altText: "test", contents: probe } : dailyCard(md, wd, sample, early);   // probe：檢查網頁做的卡片
    const v = await line(cfg.token, "/message/validate/push", { method: "POST", body: JSON.stringify({ messages: [msg] }) });
    return { dry: true, ok: v.ok, status: v.status, detail: v.ok ? undefined : v.j, today: ymd, n: slots.length };
  }
  await setCfg({ [lastKey]: ymd });
  if (!slots.length) return { sent: false, why: "no orders" };   // 沒訂單的日子不傳，省免費則數
  const r = await line(cfg.token, "/message/push", { method: "POST", body: JSON.stringify({ to: cfg.group, messages: [dailyCard(md, wd, slots, early)] }),
    headers: { "X-Line-Retry-Key": await retryKey((early ? "early/" : "tick/") + ymd + (force ? "/" + Date.now() : "")) } });
  if (!r.ok && r.status !== 409) { console.error("tick", r.status, r.j); return { sent: false, why: "line " + r.status }; }
  return { sent: true, n: slots.length };
}

/* ===== 網頁打來的 ===== */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return new Response("ok");   // LINE 驗證 Webhook 網址時可能用 GET 以外的方式，回 200 即可
  let raw = "";
  try { raw = await req.text(); } catch { return json(req, { error: "bad body" }, 400); }
  const sig = req.headers.get("x-line-signature");
  if (sig) { try { return await webhook(raw, sig); } catch (e) { console.error(e); return new Response("ok"); } }

  if (raw.length > 150000) return json(req, { error: "too big" }, 413);
  let b: any; try { b = JSON.parse(raw); } catch { return json(req, { error: "bad json" }, 400); }
  if (b.op === "tick") {   // 資料庫排程：key 只存在資料庫裡
    const k = (await getCfg()).cron_key;
    if (!k || typeof b.key !== "string" || b.key !== k) return json(req, { error: "no" }, 403);
    try { return json(req, await tick(!!b.force, !!b.dry, b.dry ? b.probe : null, b.slot === "early")); } catch (e) { console.error(e); return json(req, { error: "server" }, 500); }
  }
  if (!isTag(b.tag)) return json(req, { error: "bad tag" }, 400);
  try {
    const cfg = await getCfg();
    if (!owns(cfg, b.tag)) return json(req, { error: "not owner" }, 403);

    if (b.op === "status") {
      const ready = !!(cfg.token && cfg.secret);
      return json(req, { ready, basicId: cfg.basic_id || "", botName: cfg.bot_name || "", group: cfg.group ? (cfg.group_name || "LINE 群組") : "",
        quota: ready && cfg.group ? await quota(cfg.token) : null });
    }

    if (b.op === "setup") {
      const secret = String(b.secret || "").trim(), token = String(b.token || "").trim();
      if (!/^[0-9a-f]{32}$/i.test(secret)) return json(req, { error: "bad secret" }, 400);
      if (token.length < 100 || token.length > 400 || /\s/.test(token)) return json(req, { error: "bad token" }, 400);
      const info = await line(token, "/info");
      if (!info.ok) return json(req, { error: "token rejected" }, 400);
      const wh = await line(token, "/channel/webhook/endpoint", { method: "PUT", body: JSON.stringify({ endpoint: SELF }) });
      const same = cfg.token === token;
      await setCfg({ owner: b.tag, secret, token, basic_id: info.j.basicId || "", bot_name: info.j.displayName || "" });
      if (!same) await delCfg(["group", "group_name"]);   // 換了官方帳號 → 舊群組不能用
      return json(req, { ok: true, basicId: info.j.basicId || "", botName: info.j.displayName || "", webhook: wh.ok });
    }

    if (b.op === "pair") {
      if (!cfg.token) return json(req, { error: "not ready" }, 409);
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
      const code = String(n).padStart(6, "0");
      await setCfg({ pair: code, pair_exp: String(Date.now() + 15 * 60 * 1000) });
      return json(req, { code, basicId: cfg.basic_id || "" });
    }

    if (b.op === "daily") {
      const d = cleanDaily(b.daily);
      if (!d) return json(req, { error: "bad daily" }, 400);
      const today = twToday().ymd;
      for (const k of Object.keys(d)) if (k < today) delete d[k];
      await setCfg({ daily: JSON.stringify(d) });
      return json(req, { ok: true });
    }

    if (b.op === "unlink") { await delCfg(["group", "group_name", "pair", "pair_exp"]); return json(req, { ok: true }); }

    if (b.op === "send") {
      if (!cfg.token) return json(req, { error: "not ready" }, 409);
      if (!cfg.group) return json(req, { error: "no group" }, 409);
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text || text.length > 4900) return json(req, { error: "bad text" }, 400);
      // 有卡片就傳卡片（收據樣子）；LINE 不收這張卡片（400）就改傳純文字，不會漏掉
      const flex = b.flex && typeof b.flex === "object" && b.flex.type === "bubble" && JSON.stringify(b.flex).length < 28000 ? b.flex : null;
      const alt = (typeof b.alt === "string" && b.alt.trim() ? b.alt.trim() : text.split("\n")[0]).slice(0, 380);
      const key = typeof b.id === "string" && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : crypto.randomUUID();
      const push = (msg: unknown, k: string) => line(cfg.token, "/message/push", { method: "POST", body: JSON.stringify({ to: cfg.group, messages: [msg] }),
        headers: { "X-Line-Retry-Key": k } });
      let r = await push(flex ? { type: "flex", altText: alt, contents: flex } : { type: "text", text }, key);
      if (flex && r.status === 400) { console.error("flex", r.j); r = await push({ type: "text", text }, crypto.randomUUID()); }
      if (r.status === 409) return json(req, { ok: true, dup: true });   // 同一則已送過（重試）
      if (r.status === 429) return json(req, { error: "quota" }, 429);
      if (r.status === 400 || r.status === 403 || r.status === 404) { console.error("push", r.status, r.j); return json(req, { error: "group gone" }, 409); }
      if (!r.ok) { console.error("push", r.status, r.j); return json(req, { error: "line" }, 502); }
      return json(req, { ok: true, quota: await quota(cfg.token) });
    }
    return json(req, { error: "op" }, 400);
  } catch (e) {
    console.error(e);
    return json(req, { error: "server" }, 500);
  }
});
