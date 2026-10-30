/* =====================================================
   煙燻滷味：訂購頁（index.html）與剩貨頁（stock.html）共用程式
   這個檔案要和兩個頁面放在同一個資料夾、一起更新。
   要先載入 shared.js（品項清單、圖示、escapeHtml、ymd、WK、FB）。
   ===================================================== */
"use strict";
const CORE_VERSION = 6;

/* ===== 基本工具 ===== */
const te = new TextEncoder(), td = new TextDecoder();
function b64(buf){ const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }
function unb64(s){ return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function hex(buf){ return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const $ = id => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000, TRASH_DAYS = 30;

function fmtDate(s){ if (!s) return ""; const [y, m, d] = s.split("-").map(Number); const dt = new Date(y, m - 1, d); return `${m}/${d}(${WK[dt.getDay()]})`; }
const hm = t => new Date(t).toTimeString().slice(0, 5);
function when(t){ if (!t) return ""; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${hm(t)}`; }

let toastTimer = null;
function toast(msg, isErr){
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isErr ? 4000 : 2600);
}

/* 複製文字（回傳 Promise：true=成功）；quiet=true 時失敗不跳提示 */
function copyText(text, btn, quiet){
  const done = () => {
    if (btn) { const old = btn.innerHTML; btn.innerHTML = ICON.check + "已複製"; setTimeout(() => btn.innerHTML = old, 1500); }
    return true;
  };
  function fallback(){
    // iPhone 舊版 Safari 也能用的複製方式
    const ta = document.createElement("textarea");
    ta.value = text; ta.readOnly = true;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    if (ok) return done();
    if (!quiet) {
      toast("沒辦法自動複製，請長按訂單文字，選「全選」再複製", true);
      const pre = btn && btn.closest(".sheet") && btn.closest(".sheet").querySelector("pre");
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    }
    return false;
  }
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(done, () => fallback());
  }
  return Promise.resolve(fallback());
}

/* 手機原生分享是否可用 */
function canNativeShare(data){
  if (!window.isSecureContext || typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare === "function") {
    try { return navigator.canShare(data); } catch (e) { return false; }
  }
  return true;   // 舊版 Safari 有 share 但沒有 canShare
}

/* ===== 對話框 ===== */
function closeDlg(){ $("dlg").classList.remove("show"); $("dlgBox").innerHTML = ""; }
function askConfirm({ title, msg, ok = "確定", cancel = "取消", danger = false }){
  return new Promise(resolve => {
    $("dlgBox").innerHTML = `<h4>${escapeHtml(title)}</h4><p>${escapeHtml(msg)}</p>
      <div class="dlg-btns"><button type="button" class="btn ghost" data-no>${escapeHtml(cancel)}</button>
      <button type="button" class="btn ${danger ? "danger" : ""}" data-yes>${escapeHtml(ok)}</button></div>`;
    $("dlg").classList.add("show");
    $("dlgBox").querySelector("[data-no]").onclick = () => { closeDlg(); resolve(false); };
    $("dlgBox").querySelector("[data-yes]").onclick = () => { closeDlg(); resolve(true); };
  });
}
const pwField = (id, ph) => `<input class="pw-in" id="${id}" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" placeholder="${ph}">`;
/* 輸入店家密碼的通用對話框；check(pw) 回傳錯誤訊息（字串）代表失敗，回傳其他值代表成功 */
function askPassword({ title, msg, ok = "確定", cancel = "取消", min = 8, check }){
  return new Promise(resolve => {
    $("dlgBox").innerHTML = `<h4>${escapeHtml(title)}</h4><p>${escapeHtml(msg)}</p>
      ${pwField("apw", "店家密碼")}<div class="dlg-err" id="apwErr"></div>
      <div class="dlg-btns"><button type="button" class="btn ghost" data-no>${escapeHtml(cancel)}</button><button type="button" class="btn" data-yes>${escapeHtml(ok)}</button></div>`;
    $("dlg").classList.add("show");
    const inp = $("apw"), err = $("apwErr"), yes = $("dlgBox").querySelector("[data-yes]");
    setTimeout(() => inp.focus(), 50);
    $("dlgBox").querySelector("[data-no]").onclick = () => { closeDlg(); resolve(null); };
    const go = async () => {
      if (inp.value.length < min) { err.textContent = `店家密碼至少 ${min} 碼`; return; }
      yes.disabled = true; err.textContent = "確認中…";
      let r;
      try { r = check ? await check(inp.value) : inp.value; } catch (e) { r = "連不上同步伺服器，請確認網路後再試"; }
      if (typeof r === "string" && check) { yes.disabled = false; err.textContent = r; inp.focus(); return; }
      closeDlg(); resolve(r === undefined ? true : r);
    };
    inp.onkeydown = e => { if (e.key === "Enter") go(); };
    yes.onclick = go;
  });
}

/* ===== 金鑰推算（PBKDF2，與舊版相同的鹽，舊資料可以直接讀） ===== */
const SALT = { room: "smoked-order/room/v1", stock: "smoked-order/stock/v1", join: "smoked-order/join/v1" };
async function pbkdf2Bits(pw, salt, iter = 300000, bits = 256){
  const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: typeof salt === "string" ? te.encode(salt) : salt, iterations: iter, hash: "SHA-256" }, base, bits));
}
async function sha256hex(s){ return hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? te.encode(s) : s)); }
/* 舊版（core 4 以前）的房間代號：只用來把舊資料搬到新房間 */
const roomIdOf = async pw => hex(await pbkdf2Bits(pw, SALT.room));
const joinProofOf = async pw => b64(await pbkdf2Bits(pw, SALT.join));
/* 新版房間代號 = 加入憑證的 SHA-256。規則會檢查憑證雜湊後等於房間代號，不知道密碼就無法建立或加入 */
const roomOf = async pw => { const proof = await joinProofOf(pw); return { room: await sha256hex(proof), proof }; };
const STOCK_ID = /^inv_\d{4}-\d{2}-\d{2}_(ba|ma)$/, ORDER_ID = /^\d{10,16}$/;
/* 剩貨加密金鑰：匯入成「不可匯出」的 CryptoKey，存在 IndexedDB，網頁程式拿不到原始金鑰 */
async function stockKeyOf(pw){ return crypto.subtle.importKey("raw", await pbkdf2Bits(pw, SALT.stock), "AES-GCM", false, ["encrypt", "decrypt"]); }
const RSA = { name: "RSA-OAEP", hash: "SHA-256" };
async function kidOf(meta){ return meta.kid || (await sha256hex(String(meta.pub && meta.pub.n))).slice(0, 16); }

/* ===== IndexedDB 小倉庫（存金鑰與自動備份；不能用時退回記憶體） ===== */
const KV = (() => {
  let dbp = null; const mem = new Map();
  function open(){
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open("smoked-order", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => null);
    return dbp;
  }
  function tx(db, mode, fn){
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode), req = fn(t.objectStore("kv"));
      t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    async get(k){ try { const db = await open(); return db ? await tx(db, "readonly", s => s.get(k)) : mem.get(k); } catch (e) { return mem.get(k); } },
    /* 回傳 true 代表真的存進 IndexedDB（重開網頁還在） */
    async set(k, v){ try { const db = await open(); if (!db) { mem.set(k, v); return false; } await tx(db, "readwrite", s => s.put(v, k)); return true; } catch (e) { mem.set(k, v); return false; } },
    async del(k){ mem.delete(k); try { const db = await open(); if (db) await tx(db, "readwrite", s => s.delete(k)); } catch (e) {} },
    async keys(){ try { const db = await open(); return db ? (await tx(db, "readonly", s => s.getAllKeys())) || [] : [...mem.keys()]; } catch (e) { return [...mem.keys()]; } },
  };
})();

/* ===== 這支手機的識別（只用來在「同步裝置」列表顯示） ===== */
function deviceInfo(){
  let d = null;
  try { d = JSON.parse(localStorage.getItem("deviceInfo") || "null"); } catch (e) {}
  if (!d || !d.id) {
    const id = hex(crypto.getRandomValues(new Uint8Array(8))), ua = navigator.userAgent;
    const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android 手機" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows 電腦" : "裝置";
    d = { id, name: `${kind}・${id.slice(0, 4).toUpperCase()}` };
    try { localStorage.setItem("deviceInfo", JSON.stringify(d)); } catch (e) {}
  }
  return d;
}

/* ===== 雲端（Firebase；資料都先加密才上傳，雲端只有亂碼） =====
   只連到 Google Firebase，不連其他地方。 */
const EP = { fs: "https://firestore.googleapis.com", auth: "https://identitytoolkit.googleapis.com", token: "https://securetoken.googleapis.com" };
const DB_NAME = `projects/${FB.projectId}/databases/(default)/documents`;
const FS = `${EP.fs}/v1/${DB_NAME}`;
class CloudError extends Error { constructor(code, status){ super(code); this.code = code; this.status = status; } }

const Cloud = {
  idToken: null, exp: 0, uidCache: null, tokenP: null,
  authCfg(){ try { return JSON.parse(localStorage.getItem("fbAuth") || "null") || {}; } catch (e) { return {}; } },
  /* 舊版兩個頁面各有一個登入；新版共用一個，裝置列表才不會一支手機出現兩次 */
  legacyRt(){
    for (const k of ["syncCfg", "stockSync"]) { try { const c = JSON.parse(localStorage.getItem(k) || "null"); if (c && c.rt) return c.rt; } catch (e) {} }
    return null;
  },
  dropLegacyRt(){
    for (const k of ["syncCfg", "stockSync"]) { try { const c = JSON.parse(localStorage.getItem(k) || "null"); if (c && c.rt) { delete c.rt; localStorage.setItem(k, JSON.stringify(c)); } } catch (e) {} }
  },
  setTok(tok, exp, rt){
    this.idToken = tok; this.exp = Date.now() + Number(exp) * 1000; this.uidCache = null;
    localStorage.setItem("fbAuth", JSON.stringify({ rt }));
    this.dropLegacyRt();
  },
  token(){
    if (this.idToken && Date.now() < this.exp - 60000) return Promise.resolve(this.idToken);
    if (!this.tokenP) this.tokenP = this._token().finally(() => { this.tokenP = null; });
    return this.tokenP;
  },
  async _token(){
    const rt = this.authCfg().rt || this.legacyRt();
    if (rt) {
      const r = await fetch(`${EP.token}/v1/token?key=${FB.apiKey}`, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(rt) });
      if (r.ok) { const j = await r.json(); this.setTok(j.id_token, j.expires_in, j.refresh_token); return this.idToken; }
      if (r.status >= 500) throw new CloudError("net", r.status);   // 伺服器暫時有問題：不要換新帳號
    }
    const r = await fetch(`${EP.auth}/v1/accounts:signUp?key=${FB.apiKey}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) });
    if (!r.ok) throw new CloudError("auth", r.status);
    const j = await r.json(); this.setTok(j.idToken, j.expiresIn, j.refreshToken);
    return this.idToken;
  },
  /* 換一個新的匿名帳號（被撤銷後重新加入用） */
  newIdentity(){ this.idToken = null; this.exp = 0; this.uidCache = null; localStorage.removeItem("fbAuth"); this.dropLegacyRt(); },
  async uid(){
    await this.token();
    if (!this.uidCache) {
      const p = JSON.parse(atob(this.idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      this.uidCache = p.user_id || p.sub;
    }
    return this.uidCache;
  },
  async req(method, url, body, retry = true){
    const r = await fetch(url, { method, headers: { Authorization: "Bearer " + await this.token(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (r.ok) return method === "DELETE" ? null : r.json();
    if (r.status === 404 && method === "GET") return null;
    if (r.status === 401 && retry) { this.idToken = null; return this.req(method, url, body, false); }
    let st = ""; try { const j = await r.json(); const e = Array.isArray(j) ? j[0] && j[0].error : j.error; st = (e && e.status) || ""; } catch (e) {}
    const code = r.status === 403 || st === "PERMISSION_DENIED" ? "denied"
      : ["FAILED_PRECONDITION", "ALREADY_EXISTS", "NOT_FOUND", "ABORTED"].includes(st) || r.status === 409 ? "conflict"
      : r.status === 401 ? "auth" : "http";
    throw new CloudError(code, r.status);
  },
  get(path){ return this.req("GET", FS + path); },
  commit(writes){ return this.req("POST", FS + ":commit", { writes }); },
  enc(obj){
    const f = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      f[k] = typeof v === "number" ? { integerValue: String(Math.trunc(v)) } : typeof v === "boolean" ? { booleanValue: v }
        : v === null ? { nullValue: null } : typeof v === "object" && v.$ts ? { timestampValue: v.$ts } : { stringValue: String(v) };
    }
    return f;
  },
  dec(doc){
    const o = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
      o[k] = "integerValue" in v ? Number(v.integerValue) : "stringValue" in v ? v.stringValue : "booleanValue" in v ? v.booleanValue
        : "timestampValue" in v ? Date.parse(v.timestampValue) : "doubleValue" in v ? Number(v.doubleValue) : null;
    }
    const dts = doc.fields && doc.fields.dts && doc.fields.dts.timestampValue;   // 伺服器的刪除時間，原樣保留（規則要求不能改）
    return { id: doc.name.split("/").pop(), data: o, ut: doc.updateTime, dtsRaw: dts || undefined };
  },
  /* 寫入：base = 上次讀到的雲端 updateTime；沒有 base 代表必須是新文件。
     stamp=true 會加上伺服器時間 ts（也可以給欄位名稱陣列） */
  write(path, data, { base, stamp, any } = {}){
    const w = { update: { name: DB_NAME + path, fields: this.enc(data) } };
    if (!any) w.currentDocument = base ? { updateTime: base } : { exists: false };
    if (stamp) w.updateTransforms = (stamp === true ? ["ts"] : stamp).map(f => ({ fieldPath: f, setToServerValue: "REQUEST_TIME" }));
    return w;
  },
  patch(path, data){
    return { update: { name: DB_NAME + path, fields: this.enc(data) }, updateMask: { fieldPaths: Object.keys(data) }, currentDocument: { exists: true } };
  },
  del(path){ return { delete: DB_NAME + path }; },
  async list(room, coll = "orders"){
    const out = []; let tok = "";
    do {
      const j = await this.get(`/rooms/${room}/${coll}?pageSize=300` + (tok ? "&pageToken=" + encodeURIComponent(tok) : ""));
      ((j && j.documents) || []).forEach(d => out.push(this.dec(d)));
      tok = j && j.nextPageToken;
    } while (tok);
    return out;
  },
  async query(room, q){
    const j = await this.req("POST", `${FS}/rooms/${room}:runQuery`, { structuredQuery: q });
    return (j || []).filter(x => x.document).map(x => this.dec(x.document));
  },
  /* 只讀上次之後有變動的文件（省流量、省額度） */
  changedSince(room, ms){
    return this.query(room, { from: [{ collectionId: "orders" }],
      where: { fieldFilter: { field: { fieldPath: "ts" }, op: "GREATER_THAN", value: { timestampValue: new Date(Math.max(0, ms)).toISOString() } } } });
  },
  async room(room){ const d = await this.get(`/rooms/${room}`); return d ? this.dec(d).data : null; },
  async meta(room){ const d = await this.get(`/rooms/${room}/orders/_meta`); return d ? JSON.parse(this.dec(d).data.ct) : null; },
  async member(room){ const d = await this.get(`/rooms/${room}/members/${await this.uid()}`); return d ? this.dec(d).data : null; },
  async joinWrites(room, proof){
    const uid = await this.uid(), dev = deviceInfo();
    return [this.write(`/rooms/${room}/joins/${uid}`, { proof }, { any: true }),
      this.write(`/rooms/${room}/members/${uid}`, { dev: dev.id, name: dev.name, joined: Date.now(), seen: Date.now(), revoked: false }, { stamp: true })];
  },
  /* 用店家密碼加入（或建立）店家，全部在背景完成，使用者只需要輸入店家密碼。
     回傳 state：joined 已加入／created 新建立／migrated 從舊版房間升級／none 找不到（create=false 時）／retired 這是已經換掉的舊密碼
     legacy：舊版房間代號（還有舊資料要搬時才有） */
  async enter(pw, { create = false, newMeta = null } = {}){
    const { room, proof } = await roomOf(pw);
    let me = await this.member(room);
    if (me && me.revoked) { this.newIdentity(); me = null; }   // 被停用過：換一個新帳號重新加入
    let rd = await this.room(room);
    if (rd && rd.retired) return { room, state: "retired" };
    if (!rd) {
      // 新版房間還沒建立：舊版的店家（舊資料在舊房間，唯讀），或全新的店家
      const legacy = await roomIdOf(pw);
      let lmeta = null;
      try { lmeta = await this.meta(legacy); } catch (e) { if (e.code !== "denied") throw e; }
      const meta = lmeta || (create ? newMeta : null);
      if (!meta) return { room, state: "none" };
      try {
        await this.commit([this.write(`/rooms/${room}`, { v: 2, retired: false, created: Date.now(), imported: !lmeta }, { stamp: true }),
          ...await this.joinWrites(room, proof),
          this.write(`/rooms/${room}/orders/_meta`, { iv: "meta", ct: JSON.stringify(meta), upd: 0 })]);
        return { room, meta, state: lmeta ? "migrated" : "created", legacy: lmeta ? legacy : "" };
      } catch (e) { if (e.code !== "conflict") throw e; }   // 另一支手機剛好同時建立：改成加入
      rd = await this.room(room); me = await this.member(room);
      if (!rd) throw new CloudError("http", 0);
      if (rd.retired) return { room, state: "retired" };
    }
    if (!me) await this.commit(await this.joinWrites(room, proof));
    const meta = await this.meta(room);
    if (!meta) return { room, state: "none" };
    return { room, meta, state: "joined", legacy: rd.imported ? "" : await roomIdOf(pw) };
  },
  /* 把舊版房間（唯讀）的資料搬到新房間：只補新房間沒有的，搬完標記 imported。多支手機同時搬也不會重複 */
  async importLegacy(room, legacy){
    const rd = await this.room(room);
    if (!rd || rd.imported || rd.retired) return -1;
    let old = [];
    try { old = await this.list(legacy); } catch (e) { if (e.code !== "denied") throw e; }
    const have = new Set((await this.list(room)).map(d => d.id)), uid = await this.uid(), ws = [];
    for (const d of old) {
      if (have.has(d.id) || !d.data.ct || !(ORDER_ID.test(d.id) || STOCK_ID.test(d.id))) continue;
      ws.push(this.write(`/rooms/${room}/orders/${d.id}`, { iv: d.data.iv, ct: d.data.ct, upd: d.data.upd || 0, ver: 1, del: 0, kid: d.data.kid || undefined, by: uid }, { stamp: true }));
    }
    for (let i = 0; i < ws.length; i += 200) {
      const part = ws.slice(i, i + 200);
      try { await this.commit(part); }
      catch (e) {
        if (e.code !== "conflict") throw e;
        for (const w of part) { try { await this.commit([w]); } catch (x) { if (x.code !== "conflict") throw x; } }   // 有些已經被別支手機搬了
      }
    }
    await this.commit([this.patch(`/rooms/${room}`, { imported: true })]);
    return ws.length;
  },
  /* 被拒絕時找原因：revoked 被停用／retired 密碼已更換／join 還沒加入（舊版升級）／denied 其他 */
  async diagnose(room){
    const me = await this.member(room);
    if (me && me.revoked) return "revoked";
    const rd = await this.room(room).catch(() => null);
    if (rd && rd.retired) return "retired";
    return me ? "denied" : "join";
  },
  /* 每 6 小時更新一次「最後使用時間」 */
  async touch(room){
    const k = "seen:" + room, last = Number(localStorage.getItem(k)) || 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;
    try { await this.commit([this.patch(`/rooms/${room}/members/${await this.uid()}`, { seen: Date.now(), name: deviceInfo().name })]); localStorage.setItem(k, String(Date.now())); } catch (e) {}
  },
  async members(room){ return (await this.list(room, "members")).map(x => ({ uid: x.id, ...x.data })); },
  async revoke(room, uid){ await this.commit([this.patch(`/rooms/${room}/members/${uid}`, { revoked: true, revokedAt: Date.now(), revokedBy: await this.uid() })]); },
  async retire(room){
    const w = this.patch(`/rooms/${room}`, { retired: true, retiredAt: Date.now() });
    w.updateMask.fieldPaths.push("rts"); w.updateTransforms = [{ fieldPath: "rts", setToServerValue: "REQUEST_TIME" }];
    await this.commit([w]);
  },
  /* 上傳一筆資料（訂單或剩貨）。base = { ver, ut, del, dtsRaw } 是上次讀到的雲端版本；沒有 base 代表新的一筆。
     prev = 要一起存成歷史版本的上一版（和這次上傳同一批寫入，一定同時成功或失敗） */
  async put(room, id, f, base, prev){
    const ver = ((base && base.ver) || 0) + 1, del = f.del || 0, stamp = ["ts"];
    const data = { iv: f.iv, ct: f.ct, upd: f.upd || 0, ver, del, kid: f.kid || undefined, by: await this.uid() };
    if (del) { if (base && base.del && base.dtsRaw) data.dts = { $ts: base.dtsRaw }; else if (!(base && base.del)) stamp.push("dts"); }
    const ws = [this.write(`/rooms/${room}/orders/${id}`, data, { base: base && base.ut, stamp })];
    if (prev) ws.push(await this.revWrite(room, id, prev, "prev"));
    const j = await this.commit(ws);
    return { ver, ut: j.writeResults[0].updateTime, dtsRaw: del ? (data.dts ? data.dts.$ts : j.writeResults[0].transformResults && j.writeResults[0].transformResults[1] && j.writeResults[0].transformResults[1].timestampValue) : undefined };
  },
  /* 歷史版本（加密）：kind = prev 修改前的版本／conflict 衝突時沒被採用的版本／restore 還原前的版本 */
  async revWrite(room, id, f, kind){
    const uid = await this.uid();
    const rid = kind === "prev" && f.ver ? `${id}_v${f.ver}` : `${id}_${kind[0]}${Date.now()}_${uid.slice(0, 6)}`;
    return this.write(`/rooms/${room}/revs/${rid}`,
      { of: String(id), iv: f.iv, ct: f.ct, upd: f.upd || 0, ver: f.ver || 0, del: f.del || 0, kid: f.kid || "", kind, dev: deviceInfo().name, by: uid, at: Date.now() }, { stamp: true });
  },
  async saveRev(room, id, f, kind = "conflict"){ await this.commit([await this.revWrite(room, id, f, kind)]); },
  /* 一筆資料的所有歷史版本（新的在前） */
  async revsOf(room, id){
    const docs = await this.query(room, { from: [{ collectionId: "revs" }], where: { fieldFilter: { field: { fieldPath: "of" }, op: "EQUAL", value: { stringValue: String(id) } } } });
    return docs.sort((a, b) => (b.data.ts || 0) - (a.data.ts || 0));
  },
  async getDoc(room, id){ const d = await this.get(`/rooms/${room}/orders/${id}`); return d ? this.dec(d) : null; },
  /* 要不要把上一版存成歷史：別支手機改的、或超過 10 分鐘前改的（避免每按一下都存一份） */
  keepPrev(base, uid){ return !!(base && base.ver && (base.by !== uid || !base.rts || Date.now() - base.rts > 10 * 60 * 1000)); },
  /* 清掉已停用房間裡的資料（更換密碼 7 天後；備份保留 90 天不清） */
  async purgeRoom(room){
    for (const coll of ["orders", "revs"]) {
      const docs = await this.list(room, coll);
      for (let i = 0; i < docs.length; i += 300) await this.commit(docs.slice(i, i + 300).map(d => this.del(`/rooms/${room}/${coll}/${d.id}`)));
    }
  },
  /* ===== 雲端每日備份：整個房間（已加密的）資料，分段存；90 天內不能修改或刪除 ===== */
  async backupSets(room){
    const docs = await this.query(room, { from: [{ collectionId: "backups" }], select: { fields: ["set", "i", "n", "at", "nd", "dev", "ts"].map(f => ({ fieldPath: f })) },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }], limit: 400 });
    const m = new Map();
    for (const d of docs) { const x = d.data; if (!m.has(x.set)) m.set(x.set, { set: x.set, at: x.at, ts: x.ts, nd: x.nd, dev: x.dev, n: x.n, got: 0 }); m.get(x.set).got++; }
    return [...m.values()].filter(x => x.got === x.n).sort((a, b) => b.ts - a.ts);
  },
  async backupLoad(room, set){
    const docs = await this.query(room, { from: [{ collectionId: "backups" }], where: { fieldFilter: { field: { fieldPath: "set" }, op: "EQUAL", value: { stringValue: set } } } });
    docs.sort((a, b) => a.data.i - b.data.i);
    if (!docs.length || docs.length !== docs[0].data.n) throw new Error("incomplete");
    const text = docs.map(d => d.data.data).join("");
    if (await sha256hex(text) !== docs[0].data.sha) throw new Error("checksum");
    return JSON.parse(text);
  },
  /* docs = 這次完整同步讀到的所有文件。今天已經有人備份過就跳過；上傳後讀回來核對雜湊 */
  async backupDaily(room, docs){
    const k = "cloudSnap:" + room;
    if (Date.now() - (Number(localStorage.getItem(k)) || 0) < 20 * 3600 * 1000) return null;
    const last = await this.query(room, { from: [{ collectionId: "backups" }], select: { fields: [{ fieldPath: "ts" }] },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "DESCENDING" }], limit: 1 });
    if (last.length && Date.now() - last[0].data.ts < 20 * 3600 * 1000) { localStorage.setItem(k, String(last[0].data.ts)); return null; }
    const keep = docs.filter(d => d.data.ct && (d.id === "_meta" || ORDER_ID.test(d.id) || STOCK_ID.test(d.id)));
    if (keep.length < 2) return null;
    const at = Date.now(), uid = await this.uid();
    const text = JSON.stringify({ app: "smoked-order-cloud-backup", v: 1, at, docs: keep.map(d => ({ id: d.id, iv: d.data.iv, ct: d.data.ct, upd: d.data.upd || 0, del: d.data.del || 0, kid: d.data.kid || undefined })) });
    const sha = await sha256hex(text), set = `${ymd(new Date(at)).replace(/-/g, "")}_${uid.slice(0, 8)}_${hex(crypto.getRandomValues(new Uint8Array(3)))}`;
    const parts = []; for (let i = 0; i < text.length; i += 800000) parts.push(text.slice(i, i + 800000));
    if (parts.length > 50) return null;
    for (let i = 0; i < parts.length; i++) await this.commit([this.write(`/rooms/${room}/backups/${set}_${i}`,
      { set, i, n: parts.length, at, nd: keep.length - 1, sha, data: parts[i], dev: deviceInfo().name, by: uid }, { stamp: true })]);
    const back = await this.backupLoad(room, set);   // 讀回來確認完整
    if (back.docs.length !== keep.length) throw new Error("verify");
    localStorage.setItem(k, String(Date.now()));
    return { set, nd: keep.length - 1 };
  },
};

/* ===== 剩貨同步設定（訂購頁加入／更換密碼時，也一起幫剩貨頁設定好） ===== */
const STOCK_CFG = "stockSync";
const StockCfg = {
  get(){ try { return JSON.parse(localStorage.getItem(STOCK_CFG) || "null") || {}; } catch (e) { return {}; } },
  save(c){ localStorage.setItem(STOCK_CFG, JSON.stringify(c)); },
  async setKey(room, key){
    const c = this.get();
    if (await KV.set("stockKey:" + room, key)) { delete c.k; c.hk = room; }
    else { c.hk = ""; }   // IndexedDB 不能用：只放在記憶體，下次打開要再輸入密碼
    this.save(c);
  },
  /* 用店家密碼設定剩貨頁的房間與金鑰 */
  async join(room, pw, meta, legacy){
    const key = await stockKeyOf(pw), c = this.get();
    if (c.room && c.room !== room) {
      KV.del("stockKey:" + c.room);
      // 換房間：雲端版本基準重設（未上傳的修改保留，會在新房間合併上傳）。
      // 更換密碼（舊房間是新版）時，舊房間有的紀錄在新房間找不到代表已刪除（k0）；舊版升級則重新上傳
      try { const a = JSON.parse(localStorage.getItem("stockData") || "{}"); Object.values(a).forEach(x => { if (x.ut && c.v2) x.k0 = 1; delete x.ut; delete x.ver; delete x.gone; delete x.dtsRaw; }); localStorage.setItem("stockData", JSON.stringify(a)); } catch (e) {}
      c.cursor = 0;
    }
    this.save({ ...this.get(), room, member: room, v2: true, need: "", skip: 0, fullMeta: meta || c.fullMeta, legacy: legacy || "" });
    await this.setKey(room, key);
  },
  async key(room){
    const c = this.get();
    let k = await KV.get("stockKey:" + room);
    if (!k && c.k) {   // 舊版把原始金鑰存在 localStorage：搬到 IndexedDB 並改成不可匯出
      k = await crypto.subtle.importKey("raw", unb64(c.k), "AES-GCM", false, ["encrypt", "decrypt"]);
      await this.setKey(room, k);
    }
    return k || null;
  },
};

/* ===== 衝突合併（不看手機時間） =====
   三方比較：B = 兩支手機共同的上一版（這支手機開始修改前看到的雲端版本）、L = 這支手機、R = 雲端（先同步上去的）。
   只有一邊改的 → 用改的那一邊；兩邊都改而且不同 → 衝突：先用雲端的，這支手機的版本另外保留，並通知使用者選擇。 */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function pick3(b, l, r, hasB){
  if (same(l, r)) return [l, false];
  if (hasB) { if (same(l, b)) return [r, false]; if (same(r, b)) return [l, false]; }
  return [r, true];
}
/* 已送出的剩貨（分享後頁面清空，內容存在這裡）：兩邊合併，用送出時間去重複，最多留 30 份 */
function mergeSends(a, b){
  const m = new Map();
  for (const x of [...(a || []), ...(b || [])]) if (x && x.at && !m.has(x.at)) m.set(x.at, x);
  return [...m.values()].sort((p, q) => q.at - p.at).slice(0, 30);
}
/* 剩貨：逐項比較。沒有共同上一版（舊版留下的修改）時：一邊沒有數字就用另一邊的，兩邊都有而且不同才算衝突 */
function mergeStock3(B, L, R){
  const lv = L.v || {}, rv = R.v || {}, bv = B ? B.v || {} : {};
  const v = {}, cf = [];
  for (const k of new Set([...Object.keys(lv), ...Object.keys(rv), ...Object.keys(bv)])) {
    const l = lv[k] || 0, r = rv[k] || 0;
    let x, c = false;
    if (B) [x, c] = pick3(bv[k] || 0, l, r, true);
    else if (l === r || !l) x = r; else if (!r) x = l; else { x = r; c = true; }
    if (x > 0) v[k] = x;
    if (c) cf.push({ k, mine: l, theirs: r });
  }
  let note, nc = false;
  if (B) [note, nc] = pick3(B.note || "", L.note || "", R.note || "", true);
  else if ((L.note || "") === (R.note || "") || !L.note) note = R.note || ""; else if (!R.note) note = L.note; else { note = R.note; nc = true; }
  const dl = !!L.del, dr = !!R.del;
  let del = 0;
  if (B) { const [d] = pick3(!!B.del, dl, dr, true); del = d ? (R.del || L.del) : 0; }
  else del = dl && dr ? Math.max(L.del, R.del) : 0;   // 不確定時不刪除
  const out = { v, note: note || "", sends: mergeSends(L.sends, R.sends), shared: Math.max(L.shared || 0, R.shared || 0), via: (L.shared || 0) >= (R.shared || 0) ? L.via || "" : R.via || "", upd: Math.max(L.upd || 0, R.upd || 0), del };
  const conf = { items: cf, note: nc ? { mine: L.note || "", theirs: R.note || "" } : null };
  if (cf.length || nc) out.cf = { at: Date.now(), dev: deviceInfo().name, ...conf };
  else if (R.cf) out.cf = R.cf;
  return { rec: out, conflict: !!(cf.length || nc) };
}
/* 從雲端解開的剩貨內容：清理成安全的格式 */
function cleanStock(r, clean){
  const v = Object.fromEntries(Object.entries(r.v || {}).map(([k, x]) => [String(k).slice(0, 40), clean(x, "w")]).filter(([, x]) => x > 0));
  let cf;
  if (r.cf && typeof r.cf === "object") {
    cf = { at: Number(r.cf.at) || 0, dev: String(r.cf.dev || "").slice(0, 40),
      items: (Array.isArray(r.cf.items) ? r.cf.items : []).slice(0, 100).map(x => ({ k: String(x.k).slice(0, 40), mine: clean(x.mine, "w"), theirs: clean(x.theirs, "w") })),
      note: r.cf.note ? { mine: String(r.cf.note.mine || "").slice(0, 500), theirs: String(r.cf.note.theirs || "").slice(0, 500) } : null };
  }
  const sends = (Array.isArray(r.sends) ? r.sends : []).slice(0, 30).map(x => ({ at: Number(x && x.at) || 0, via: x && (x.via === "copy" || x.via === "line") ? x.via : "share",
    v: Object.fromEntries(Object.entries((x && x.v) || {}).map(([k, y]) => [String(k).slice(0, 40), clean(y, "w")]).filter(([, y]) => y > 0)),
    note: String((x && x.note) || "").slice(0, 500) })).filter(x => x.at);
  return { v, note: String(r.note || "").slice(0, 500), upd: Number(r.upd) || 0, shared: Number(r.shared) || 0, via: r.via === "copy" || r.via === "line" ? r.via : r.via ? "share" : "",
    ...(sends.length ? { sends } : {}), ...(cf ? { cf } : {}) };
}
/* 剩貨紀錄開始修改前：記下共同的上一版（衝突合併用），標記待上傳 */
function stockBase(rec){ return { v: { ...(rec.v || {}) }, note: rec.note || "", shared: rec.shared || 0, via: rec.via || "", del: rec.del || 0, sends: (rec.sends || []).slice() }; }
function markStockEdit(rec, syncOn){
  if (!rec.p && rec.ut && !rec.b) rec.b = stockBase(rec);
  if (syncOn) rec.p = 1;
}
async function aesSeal(key, obj){ const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)))) }; }
async function aesOpen(key, iv, ct){ return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct)))); }

/* ===== 加密備份 =====
   備份內容：訂單（本來就是加密的）＋剩貨（用訂單公鑰加密）＋訂單金鑰（私鑰由店家密碼保護）。
   復原時要輸入「備份當時」的店家密碼。自動備份存在這支手機的 IndexedDB，最多保留 12 份。 */
const Backup = {
  KEEP: 12,
  currentMeta(){
    try { const m = JSON.parse(localStorage.getItem("orderVault") || "null"); if (m && m.pub) return m; } catch (e) {}
    const s = StockCfg.get(); return s.fullMeta || null;
  },
  async build(kind){
    const meta = this.currentMeta();
    let orders = []; try { orders = JSON.parse(localStorage.getItem("ordersEnc") || "[]").map(r => { const x = { ...r }; delete x.p; return x; }); } catch (e) {}
    let stock = {}; try { stock = JSON.parse(localStorage.getItem("stockData") || "{}"); } catch (e) {}
    const data = { app: "smoked-order-backup", v: 1, at: Date.now(), kind, dev: deviceInfo().name, meta, orders, stock: null, nOrders: orders.filter(r => !r.del).length, nStock: Object.keys(stock).length };
    if (Object.keys(stock).length) {
      if (meta && meta.pub) {
        const pub = await crypto.subtle.importKey("jwk", meta.pub, RSA, false, ["wrapKey"]);
        const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const s = await aesSeal(k, stock);
        data.stock = { ...s, wk: b64(await crypto.subtle.wrapKey("raw", k, pub, { name: "RSA-OAEP" })), kid: await kidOf(meta) };
      } else data.stockPlain = stock;   // 還沒設定店家密碼：只能存在這支手機，不能匯出
    }
    return data;
  },
  async snapshot(kind = "auto"){
    try {
      if (!localStorage.getItem("ordersEnc") && !localStorage.getItem("stockData")) return null;
      if (kind === "auto") { const last = Number(localStorage.getItem("autoSnap")) || 0; if (Date.now() - last < DAY) return null; }
      const data = await this.build(kind);
      if (!data.nOrders && !data.nStock && !data.orders.length) return null;
      await KV.set("snap:" + data.at, data);
      if (kind === "auto") localStorage.setItem("autoSnap", String(data.at));
      const keys = (await KV.keys()).filter(k => String(k).startsWith("snap:")).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - this.KEEP))) await KV.del(k);
      return data;
    } catch (e) { return null; }
  },
  async list(){
    const keys = (await KV.keys()).filter(k => String(k).startsWith("snap:")).sort().reverse();
    const out = [];
    for (const k of keys) { const d = await KV.get(k); if (d) out.push({ key: k, at: d.at, kind: d.kind, nOrders: d.nOrders, nStock: d.nStock }); }
    return out;
  },
  get(key){ return KV.get(key); },
  label(kind){ return { auto: "每日自動", manual: "手動", cloud: "雲端每日", "before-clear": "清除前", "before-delete": "刪除前", "before-rotate": "更換密碼前", "before-wipe": "重設前", "before-restore": "復原前" }[kind] || "自動"; },
  /* 讀取雲端每日備份，轉成和備份檔一樣的格式（剩貨用目前的剩貨金鑰解開） */
  async fromCloud(room, set, stockKey){
    const j = await Cloud.backupLoad(room, set);
    const m = j.docs.find(d => d.id === "_meta");
    const orders = j.docs.filter(d => ORDER_ID.test(d.id)).map(d => { const p = String(d.ct).split("."); return { id: Number(d.id), iv: d.iv, wk: p[0], ct: p[1], upd: d.upd || 0, kid: d.kid, del: d.del || 0 }; });
    const stockPlain = {};
    const num = x => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0; };
    if (stockKey) for (const d of j.docs.filter(d => STOCK_ID.test(d.id) && !d.del)) { try { stockPlain[d.id] = cleanStock(await aesOpen(stockKey, d.iv, d.ct), num); } catch (e) {} }
    return { app: "smoked-order-backup", v: 1, at: j.at, kind: "cloud", meta: m ? JSON.parse(m.ct) : null, orders, stockPlain,
      nOrders: orders.filter(o => !o.del).length, nStock: Object.keys(stockPlain).length };
  },
  /* 下載備份檔（加密）；不支援下載的手機改用分享 */
  async exportFile(){
    const data = await this.build("manual");
    if (data.stockPlain) delete data.stockPlain;
    if (!data.meta) throw new Error("nometa");
    const name = `煙燻滷味備份-${ymd(new Date()).replace(/-/g, "")}-${hm(Date.now()).replace(":", "")}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const file = typeof File === "function" ? new File([blob], name, { type: "application/json" }) : null;
    if (file && /iPhone|iPad|Android/.test(navigator.userAgent) && canNativeShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return data; } catch (e) { if (e && e.name === "AbortError") return null; }
    }
    const a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return data;
  },
  parse(text){
    const d = JSON.parse(text);
    if (!d || d.app !== "smoked-order-backup" || !Array.isArray(d.orders)) throw new Error("format");
    return d;
  },
  /* 用店家密碼解開備份裡的金鑰（含舊金鑰），回傳 Map(kid → 私鑰)；密碼錯誤回傳 null */
  async keys(meta, pw){
    if (!meta) return null;
    try {
      const pk = await Backup.pinKey(pw, unb64(meta.salt), meta.iter);
      const out = new Map();
      const pk8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(meta.iv) }, pk, unb64(meta.priv));
      out.set(await kidOf(meta), await crypto.subtle.importKey("pkcs8", pk8, RSA, false, ["unwrapKey"]));
      for (const r of meta.ring || []) {
        try { const x = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(r.iv) }, pk, unb64(r.priv)); out.set(r.kid, await crypto.subtle.importKey("pkcs8", x, RSA, false, ["unwrapKey"])); } catch (e) {}
      }
      return out;
    } catch (e) { return null; }
  },
  async pinKey(pin, salt, iter){
    const base = await crypto.subtle.importKey("raw", te.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  },
  async openRec(keys, rec){
    const list = rec.kid && keys.has(rec.kid) ? [keys.get(rec.kid)] : [...keys.values()];
    for (const priv of list) {
      try {
        const k = await crypto.subtle.unwrapKey("raw", unb64(rec.wk), priv, { name: "RSA-OAEP" }, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
        return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, k, unb64(rec.ct))));
      } catch (e) {}
    }
    throw new Error("key");
  },
  async openStock(keys, data){
    if (data.stockPlain) return data.stockPlain;
    if (!data.stock) return {};
    return this.openRec(keys, data.stock);
  },
  /* 把備份裡的剩貨放回這支手機：這支手機沒有、或已刪除的才放回，不會蓋掉現在的資料 */
  restoreStock(map, syncOn){
    let all = {}; try { all = JSON.parse(localStorage.getItem("stockData") || "{}"); } catch (e) {}
    let n = 0;
    for (const [id, r] of Object.entries(map || {})) {
      if (!/^inv_\d{4}-\d{2}-\d{2}_(ba|ma)$/.test(id) || !r || typeof r !== "object") continue;
      const cur = all[id];
      if (cur && !cur.del && (Object.keys(cur.v || {}).length || cur.note)) continue;
      const now = Date.now(), t = {};
      Object.keys(r.v || {}).forEach(k => t[k] = now);
      all[id] = { v: { ...(r.v || {}) }, t, note: r.note || "", nt: now, upd: now, shared: r.shared || 0, del: 0,
        ...(syncOn ? { p: 1 } : {}), ...(cur ? { ver: cur.ver, ut: cur.ut } : {}) };
      n++;
    }
    localStorage.setItem("stockData", JSON.stringify(all));
    return n;
  },
};

/* ===== LINE 機器人：按一下把剩貨／訂單傳到 LINE 群組 =====
   經過 Supabase 小程式（functions/line）用官方帳號發送；文字只轉送不存檔。
   第一次用：貼上官方帳號的 Channel secret 和 Channel access token → 把官方帳號拉進群組 → 在群組傳網頁上的 6 位數字。
   驗證用 tag：店家密碼算出來的雜湊，和手機通知同一套做法。 */
const LINE_URL = "https://fodibhcjitnrgpvqttky.supabase.co/functions/v1/line";
const LINE_ERR = {
  "not owner": "這個 LINE 機器人已經被別的店家密碼設定過", quota: "這個月的免費訊息用完了（每月 200 則），下個月 1 號恢復，先改用「分享」",
  "token rejected": "LINE 不接受這組 access token，請重新複製一次", "bad secret": "Channel secret 應該是 32 個英文和數字，請重新複製",
  "bad token": "Channel access token 好像沒有複製完整，請重新複製", "group gone": "傳不進群組，可能官方帳號被移出群組了，請重新連接",
};
/* LINE 卡片（Flex）：像收據一樣，上面一整條顏色＋大字標題，掃一眼分得出是哪一種
   訂單＝深紅；剩貨／要帶看市場（媽媽＝黃、爸爸＝綠）。卡片傳不過去時，伺服器會改傳純文字。 */
const LineCard = {
  C: { ink: "#1E1A17", sub: "#8A847D", hair: "#ECE9E4", soy: "#7B1F24", gold: "#8A5A00", blue: "#2F5D8A", red: "#B3261E" },
  BAND: { o: ["#7B1F24", "#FFFFFF"], s: ["#F2C14E", "#3B2A05"], b: ["#2F5D8A", "#FFFFFF"], ma: ["#F2C14E", "#3B2A05"], ba: ["#2E7D5B", "#FFFFFF"] },
  t(text, o = {}){ return { type: "text", text: String(text ?? "").trim() || " ", wrap: true, ...o }; },
  band(kind, title, top, sub){
    const [bg, fg] = this.BAND[kind];
    return { type: "box", layout: "horizontal", backgroundColor: bg, paddingAll: "18px", spacing: "md", contents: [
      this.t(title, { size: "xxl", weight: "bold", color: fg, flex: 0, wrap: false, gravity: "bottom" }),
      { type: "box", layout: "vertical", flex: 1, justifyContent: "flex-end", contents: [
        this.t(top, { size: "sm", weight: "bold", color: fg, align: "end" }),
        ...(sub ? [this.t(sub, { size: "xs", color: fg, align: "end" })] : []),
      ] },
    ] };
  },
  /* 剩貨／要帶：顏色看市場（媽媽＝黃、爸爸＝綠），最大字寫市場名稱，下面小標籤寫種類和日期 */
  mband(mkt, kind, date){
    const [bg, fg] = this.BAND[mkt] || this.BAND.s;
    return { type: "box", layout: "vertical", backgroundColor: bg, paddingAll: "18px", paddingBottom: "14px", spacing: "sm", contents: [
      this.t(this.MKT_NAME[mkt] || mkt, { size: "3xl", weight: "bold", color: fg, wrap: false }),
      { type: "box", layout: "horizontal", spacing: "md", contents: [
        { type: "box", layout: "vertical", flex: 0, cornerRadius: "999px", backgroundColor: fg === "#FFFFFF" ? "#FFFFFF47" : "#3B2A051F", paddingStart: "10px", paddingEnd: "10px", paddingTop: "2px", paddingBottom: "2px",
          contents: [this.t(kind, { size: "sm", weight: "bold", color: fg, wrap: false })] },
        this.t(date, { size: "sm", weight: "bold", color: fg, flex: 1, wrap: false, gravity: "center" }),
      ] },
    ] };
  },
  MKT_NAME: { ma: "媽媽市場", ba: "爸爸市場" },
  /* 訂單：深紅底（訂單專用色），右邊市場做成白底深紅大字標籤，下面是取貨時間 */
  oband(title, market, when){
    const [bg, fg] = this.BAND.o, [pb, pf] = ["#FFFFFF", this.C.soy];
    return { type: "box", layout: "horizontal", backgroundColor: bg, paddingAll: "18px", spacing: "md", contents: [
      this.t(title, { size: "xxl", weight: "bold", color: fg, flex: 0, wrap: false, gravity: "bottom" }),
      { type: "box", layout: "vertical", flex: 1, spacing: "sm", justifyContent: "flex-end", contents: [
        ...(market ? [{ type: "box", layout: "horizontal", contents: [{ type: "filler" },
          { type: "box", layout: "vertical", flex: 0, cornerRadius: "8px", backgroundColor: pb, paddingStart: "10px", paddingEnd: "10px", paddingTop: "3px", paddingBottom: "3px",
            contents: [this.t(market, { size: "lg", weight: "bold", color: pf, wrap: false })] }] }] : []),
        this.t(when, { size: "sm", weight: "bold", color: fg, align: "end" }),
      ] },
    ] };
  },
  row(l, r, o = {}){
    return { type: "box", layout: "horizontal", spacing: "md", margin: o.margin || "sm", contents: [
      this.t(l, { size: o.size || "md", color: o.lc || this.C.ink, flex: o.lflex || 1, ...(o.lw ? { weight: "bold" } : {}) }),
      this.t(r, { size: o.size || "md", color: o.rc || this.C.ink, flex: 0, align: "end", wrap: false, ...(o.rw ? { weight: "bold" } : {}) }),
    ] };
  },
  kv(k, v, o = {}){
    return { type: "box", layout: "horizontal", spacing: "md", margin: "sm", contents: [
      this.t(k, { size: "sm", color: this.C.sub, flex: 0 }),
      this.t(v, { size: "sm", color: o.c || this.C.ink, flex: 1, align: "end", ...(o.bold ? { weight: "bold" } : {}) }),
    ] };
  },
  label(t, c){ return this.t(t, { size: "xs", color: c || this.C.sub, weight: "bold", margin: "lg" }); },
  sep(){ return { type: "separator", color: this.C.hair, margin: "lg" }; },
  bubble(band, body){
    return { type: "bubble", size: "mega", header: { ...band }, body: { type: "box", layout: "vertical", paddingAll: "18px", paddingTop: "8px", contents: body } };
  },

  /* ===== 小卡存成圖片：把上面的 LINE 卡片畫成 HTML，再拍成 PNG，用手機的分享選單傳（用自己的 LINE 傳，不扣機器人額度） ===== */
  PX: { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 },
  FS: { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, "3xl": 35, "4xl": 48, "5xl": 74 },
  px(v){ return v == null ? 0 : typeof v === "number" ? v : /px$/.test(v) ? parseFloat(v) : (this.PX[v] ?? 0); },
  html(n, dir){
    const st = [], m = this.px(n.margin);
    if (m) st.push(dir === "row" ? `margin-left:${m}px` : `margin-top:${m}px`);
    const flex = n.flex != null ? n.flex : dir === "row" && n.type !== "separator" ? 1 : 0;
    // 文字一律可以換行，不會疊在一起；右邊的數量最多佔七成，左邊品名至少留 4 個字寬
    st.push(flex ? `flex:${flex} 1 0;min-width:${n.type === "text" && dir === "row" ? "4em" : "0"}` : n.type === "text" && dir === "row" ? "flex:0 1 auto;min-width:0;max-width:70%" : "flex:0 0 auto");
    if (n.type === "filler") return `<div style="flex:1 1 0"></div>`;
    if (n.type === "separator") return `<div style="${dir === "row" ? `width:1px;align-self:stretch;margin-left:${m}px` : `height:1px;margin-top:${m}px`};background:${n.color || "#ECE9E4"};flex:none"></div>`;
    if (n.type === "text") {
      st.push(`font-size:${this.FS[n.size || "md"] || 16}px`, `color:${n.color || "#1E1A17"}`, `line-height:1.4`);
      if (n.weight === "bold") st.push("font-weight:700");
      if (n.align) st.push(`text-align:${n.align === "end" ? "right" : n.align === "center" ? "center" : "left"}`);
      st.push(n.wrap || dir === "row" ? "white-space:pre-wrap;word-break:break-word" : "white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
      if (n.gravity) st.push(`align-self:${n.gravity === "center" ? "center" : n.gravity === "bottom" ? "flex-end" : "flex-start"}`);
      return `<div style="${st.join(";")}">${escapeHtml(n.text)}</div>`;
    }
    if (n.type !== "box") return "";
    const d = n.layout === "vertical" ? "column" : "row";
    st.push("display:flex", `flex-direction:${d}`, "box-sizing:border-box");
    if (n.layout === "baseline") st.push("align-items:baseline");
    if (n.backgroundColor) st.push(`background:${n.backgroundColor}`);
    if (n.cornerRadius) st.push(`border-radius:${this.px(n.cornerRadius)}px`);
    const pa = this.px(n.paddingAll);
    st.push(`padding:${n.paddingTop != null ? this.px(n.paddingTop) : pa}px ${n.paddingEnd != null ? this.px(n.paddingEnd) : pa}px ${n.paddingBottom != null ? this.px(n.paddingBottom) : pa}px ${n.paddingStart != null ? this.px(n.paddingStart) : pa}px`);
    if (n.justifyContent) st.push(`justify-content:${n.justifyContent}`);
    if (n.alignItems) st.push(`align-items:${n.alignItems}`);
    const gap = this.px(n.spacing);
    const kids = (n.contents || []).map((c, i) => this.html(i && gap && c.margin == null ? { ...c, margin: gap + "px" } : c, d)).join("");
    return `<div style="${st.join(";")}">${kids}</div>`;
  },
  async image(card){
    if (!window.html2canvas) await new Promise((ok, no) => {
      const sc = document.createElement("script");
      sc.src = "html2canvas.min.js";   // html2canvas 1.4.1（MIT），放在網站裡，不用另外連外部網站
      sc.onload = ok; sc.onerror = () => no(new Error("offline")); document.head.appendChild(sc);
    });
    // 跟官方帳號的卡片一樣：白色圓角卡片、外面不加底框（四個角透明）
    const b = card.contents, wrap = document.createElement("div");
    const draw = (w, body) => {
      wrap.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif`;
      wrap.innerHTML = `<div style="background:#fff;border-radius:18px;overflow:hidden">${this.html({ ...b.header, flex: 0 }, "column")}${this.html({ ...body, flex: 0 }, "column")}</div>`;
    };
    document.body.appendChild(wrap);
    try {
      draw(300, b.body);
      const cv = await window.html2canvas(wrap, { scale: 3, backgroundColor: null, logging: false });
      return await new Promise(r => cv.toBlob(r, "image/png"));
    } finally { wrap.remove(); }
  },
  /* 分享小卡圖片：回傳 true（交給分享選單）、false（取消或失敗） */
  async shareImage(card, btn, name){
    const old = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.textContent = "製作圖片中…"; }
    try {
      const blob = await this.image(card);
      if (!blob) throw new Error("image");
      const file = new File([blob], (name || "小卡") + ".png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return true; }
        catch (e) { if (e.name === "AbortError") { toast("已取消，沒有分享"); return false; } throw e; }
      }
      // 不能直接分享檔案（有些安卓、電腦）：打開圖片，長按存下來再傳
      const url = URL.createObjectURL(blob), w = window.open(url, "_blank");
      if (!w) { const a = document.createElement("a"); a.href = url; a.download = file.name; a.click(); }
      toast("圖片已打開，長按存起來，再到 LINE 傳");
      return true;
    } catch (e) {
      toast(e && e.message === "offline" ? "要有網路才能做圖片，請連上網路再試" : "圖片做不出來，請改用「傳到 LINE 群組」或分享文字", true);
      return false;
    } finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
  },
};

const LineBot = {
  busy: false,
  async tag(){
    const room = (typeof Sync !== "undefined" && Sync.cfg().room) || ""; if (!room) return "";
    return sha256hex(room + "/line/v1");
  },
  async call(body){
    const tag = await this.tag();
    if (!tag) throw new Error("no room");
    let r;
    try { r = await fetch(LINE_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...body, tag }) }); }
    catch (e) { throw new Error("offline"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "line " + r.status);
    return j;
  },
  msg(e){ const c = e && e.message; return LINE_ERR[c] || (c === "offline" ? "連不上網路，請確認網路後再試" : c === "no room" ? "請先輸入店家密碼開啟同步，才能用 LINE 機器人" : "LINE 傳送失敗，請再試一次"); },
  quotaText(q){ return q && q.left != null ? `本月免費訊息還剩 ${q.left} 則` : ""; },
  /* 傳完的提示：額度用完時卡片會先存在機器人那裡 */
  doneText(r){ return r.queued ? "LINE 這個月的免費則數用完了，卡片先存著：在群組打「卡片」就會出現（不扣額度）"
    : `已傳到 LINE「${r.group}」${this.quotaText(r.quota) ? "，" + this.quotaText(r.quota) : ""}`; },

  /* 第一次：貼上 Channel secret、access token */
  setupDialog(){
    return new Promise(resolve => {
      const field = (id, ph) => `<input class="pw-in" id="${id}" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ph}">`;
      $("dlgBox").innerHTML = `<h4>連接 LINE 官方帳號</h4>
        <p>到 LINE Developers 的「Messaging API」頁面，把兩組文字複製貼上。只要設定一次，所有店家手機都能用。</p>
        ${field("lnSecret", "Channel secret（32 碼）")}${field("lnToken", "Channel access token（很長一串）")}
        <div class="dlg-err" id="lnErr"></div>
        <div class="dlg-btns"><button type="button" class="btn ghost" data-no>取消</button><button type="button" class="btn" data-yes>連接</button></div>`;
      $("dlg").classList.add("show");
      const err = $("lnErr"), yes = $("dlgBox").querySelector("[data-yes]");
      $("dlgBox").querySelector("[data-no]").onclick = () => { closeDlg(); resolve(false); };
      yes.onclick = async () => {
        const secret = $("lnSecret").value.trim(), token = $("lnToken").value.trim();
        if (!secret || !token) { err.textContent = "兩格都要貼上"; return; }
        yes.disabled = true; err.textContent = "連接中…";
        try { await this.call({ op: "setup", secret, token }); closeDlg(); resolve(true); }
        catch (e) { yes.disabled = false; err.textContent = this.msg(e); }
      };
    });
  },

  /* 第二次：把官方帳號拉進群組，在群組傳 6 位數字 */
  async pairDialog(){
    let p;
    try { p = await this.call({ op: "pair" }); } catch (e) { toast(this.msg(e), true); return false; }
    return new Promise(resolve => {
      const id = p.basicId ? `（${escapeHtml(p.basicId)}）` : "";
      $("dlgBox").innerHTML = `<h4>連接 LINE 群組</h4>
        <p>1. 在 LINE 群組右上角 ≡ →「邀請」，把官方帳號${id}加進群組<br>2. 在群組裡傳下面這 6 個數字：</p>
        <div class="ln-code">${p.code.slice(0, 3)} ${p.code.slice(3)}</div>
        <div class="dlg-err" id="lnErr" style="color:var(--sub)">等待群組傳數字…（15 分鐘內有效）</div>
        <div class="dlg-btns"><button type="button" class="btn ghost" data-copy>${ICON.copy}複製數字</button><button type="button" class="btn ghost" data-no>取消</button></div>`;
      $("dlg").classList.add("show");
      let done = false;
      const finish = ok => { if (done) return; done = true; clearInterval(timer); closeDlg(); resolve(ok); };
      $("dlgBox").querySelector("[data-no]").onclick = () => finish(false);
      $("dlgBox").querySelector("[data-copy]").onclick = e => copyText(p.code, e.currentTarget);
      const started = Date.now();
      const timer = setInterval(async () => {
        if (done) return;
        if (!$("dlgBox").querySelector(".ln-code")) { finish(false); return; }
        if (Date.now() - started > 15 * 60 * 1000) { finish(false); toast("數字過期了，請再按一次", true); return; }
        try { const s = await this.call({ op: "status" }); if (s.group) { finish(true); toast(`已連上「${s.group}」`); } } catch (e) {}
      }, 3000);
    });
  },

  /* 設定好就傳；還沒設定就先帶著設定。回傳 { group, quota } 或 null */
  async send(text, btn, card){
    if (this.busy) return null;
    if (!navigator.onLine) { toast("沒有網路，請連上網路後再傳", true); return null; }
    this.busy = true;
    const old = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.textContent = "傳送中…"; }
    try {
      let s = await this.call({ op: "status" });
      if (!s.ready) { if (btn) btn.innerHTML = old; if (!(await this.setupDialog())) return null; s = await this.call({ op: "status" }); }
      if (!s.group) { if (btn) btn.innerHTML = old; if (!(await this.pairDialog())) return null; s = await this.call({ op: "status" }); }
      if (btn) btn.textContent = "傳送中…";
      const r = await this.call({ op: "send", text, id: crypto.randomUUID ? crypto.randomUUID() : undefined,
        ...(card ? { flex: card.contents, alt: card.alt } : {}) });
      return { group: s.group, quota: r.quota, queued: !!r.queued };
    } catch (e) {
      toast(this.msg(e), true);
      return null;
    } finally {
      this.busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = old; }
    }
  },
};
