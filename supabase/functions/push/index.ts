// 煙燻滷味：手機推播（網頁關掉也收得到）
// 只轉送「有新訂單／訂單有修改」這類一般文字，不經手任何客人名字、電話或訂單內容。
// 驗證：網頁是公開的（沒有 Supabase 登入），所以不用 JWT；改用 tag —— 只有知道店家密碼的手機算得出來的 64 位雜湊。
// 用 text/plain 傳送，瀏覽器不會先發預檢請求。
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const ORIGINS = ["https://chenxxrose-ux.github.io"];
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
const TEXT: Record<string, string> = { new: "有新訂單", edit: "訂單有修改", del: "有訂單被刪除", back: "有訂單被復原" };

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

// VAPID 金鑰：第一次用的時候自動產生，存在資料庫（只有這個程式讀得到）
let vapid: { pub: string; priv: string } | null = null;
async function getVapid() {
  if (vapid) return vapid;
  const { data } = await db.from("push_cfg").select("k,v").in("k", ["vapid_pub", "vapid_priv"]);
  const m = Object.fromEntries((data || []).map((r: { k: string; v: string }) => [r.k, r.v]));
  if (m.vapid_pub && m.vapid_priv) vapid = { pub: m.vapid_pub, priv: m.vapid_priv };
  else {
    const k = webpush.generateVAPIDKeys();
    await db.from("push_cfg").upsert([{ k: "vapid_pub", v: k.publicKey }, { k: "vapid_priv", v: k.privateKey }]);
    const { data: again } = await db.from("push_cfg").select("k,v").in("k", ["vapid_pub", "vapid_priv"]);
    const a = Object.fromEntries((again || []).map((r: { k: string; v: string }) => [r.k, r.v]));
    vapid = { pub: a.vapid_pub, priv: a.vapid_priv };
  }
  webpush.setVapidDetails("https://chenxxrose-ux.github.io/smoked-order/", vapid.pub, vapid.priv);
  return vapid;
}

const isTag = (t: unknown) => typeof t === "string" && /^[0-9a-f]{64}$/.test(t);
function okEndpoint(e: unknown) {
  if (typeof e !== "string" || e.length > 1000) return false;
  try { const u = new URL(e); return u.protocol === "https:" && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  let b: any;
  try { const t = await req.text(); if (t.length > 4000) throw 0; b = JSON.parse(t); } catch { return json(req, { error: "bad json" }, 400); }
  try {
    if (b.op === "key") return json(req, { key: (await getVapid()).pub });

    if (b.op === "sub") {
      const s = b.sub || {};
      if (!isTag(b.tag) || !okEndpoint(s.endpoint) || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string"
          || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return json(req, { error: "bad sub" }, 400);
      const { count } = await db.from("push_subs").select("endpoint", { count: "exact", head: true }).eq("tag", b.tag);
      if ((count || 0) >= 30) return json(req, { error: "too many" }, 429);   // 一家店最多 30 支手機
      await db.from("push_subs").upsert({ endpoint: s.endpoint, tag: b.tag, p256dh: s.keys.p256dh, auth: s.keys.auth, last_ok: new Date().toISOString() });
      return json(req, { ok: true });
    }

    if (b.op === "unsub") {
      if (!okEndpoint(b.endpoint)) return json(req, { error: "bad endpoint" }, 400);
      await db.from("push_subs").delete().eq("endpoint", b.endpoint);
      return json(req, { ok: true });
    }

    if (b.op === "notify") {
      if (!isTag(b.tag)) return json(req, { error: "bad tag" }, 400);
      const kinds = Array.isArray(b.kinds) ? b.kinds.filter((k: string) => k in TEXT).slice(0, 50) : [];
      if (!kinds.length) return json(req, { sent: 0 });
      await getVapid();
      const { data: subs } = await db.from("push_subs").select("endpoint,p256dh,auth").eq("tag", b.tag);
      const n = kinds.length, k0 = kinds[0];
      const body = n === 1 ? `${TEXT[k0]}，打開看看` : `有 ${n} 筆訂單更新，打開看看`;
      const payload = JSON.stringify({ title: "煙燻滷味", body, tag: "orders" });
      let sent = 0;
      await Promise.all((subs || []).filter((s: any) => s.endpoint !== b.from).map(async (s: any) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
          sent++;
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subs").delete().eq("endpoint", s.endpoint);   // 手機已取消
          else console.error("push fail", e?.statusCode, String(e?.body || e).slice(0, 200));
        }
      }));
      return json(req, { sent });
    }
    return json(req, { error: "op" }, 400);
  } catch (e) {
    console.error(e);
    return json(req, { error: "server" }, 500);
  }
});
