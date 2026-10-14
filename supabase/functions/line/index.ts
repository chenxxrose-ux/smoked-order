// 煙燻滷味：LINE 機器人
// 1. 網頁（剩貨頁、訂購頁）按「傳到 LINE 群組」→ 這裡用官方帳號把文字傳到綁定的群組。
//    文字只經過這裡轉送，不存檔。訂單電話是否遮蔽由網頁決定（預設遮蔽）。
// 2. LINE 的 Webhook 也打到這裡：在群組裡傳網頁上顯示的 6 位數字，就把那個群組綁定為發送對象。
// 驗證：網頁是公開的，所以用 tag —— 只有知道店家密碼的手機算得出來的 64 位雜湊；第一個設定的 tag 就是店家。
//       LINE 打來的請求用 Channel secret 驗簽章。
// Channel secret／access token 存在 line_cfg（只有這個程式讀得到）。
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

/* ===== 網頁打來的 ===== */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return new Response("ok");   // LINE 驗證 Webhook 網址時可能用 GET 以外的方式，回 200 即可
  let raw = "";
  try { raw = await req.text(); } catch { return json(req, { error: "bad body" }, 400); }
  const sig = req.headers.get("x-line-signature");
  if (sig) { try { return await webhook(raw, sig); } catch (e) { console.error(e); return new Response("ok"); } }

  if (raw.length > 12000) return json(req, { error: "too big" }, 413);
  let b: any; try { b = JSON.parse(raw); } catch { return json(req, { error: "bad json" }, 400); }
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

    if (b.op === "unlink") { await delCfg(["group", "group_name", "pair", "pair_exp"]); return json(req, { ok: true }); }

    if (b.op === "send") {
      if (!cfg.token) return json(req, { error: "not ready" }, 409);
      if (!cfg.group) return json(req, { error: "no group" }, 409);
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text || text.length > 4900) return json(req, { error: "bad text" }, 400);
      const r = await line(cfg.token, "/message/push", { method: "POST", body: JSON.stringify({ to: cfg.group, messages: [{ type: "text", text }] }),
        headers: { "X-Line-Retry-Key": typeof b.id === "string" && /^[0-9a-f-]{36}$/.test(b.id) ? b.id : crypto.randomUUID() } });
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
