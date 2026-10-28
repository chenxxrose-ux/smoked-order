/* =====================================================
   打字帶入：把一段文字（手寫、講的、貼上的）拆成訂單欄位
   例：「明天10點半 爸爸市場 王小姐 0912345678 公雞半隻 鴨頭3支 雞腳100 米血5」
   只在這支手機上算，不會把文字傳到任何地方。
   ===================================================== */
(function (root) {
  const CN = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 兩: 2, 貳: 2, 三: 3, 參: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陸: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
  const UNIT = "隻支個顆份片塊包條粒串盒";
  // 手寫、講的常見寫法 → 菜單上的名字
  const ALIAS = { 屁股: "雞屁股", 雞爪: "雞腳", 雞腳爪: "雞腳", 雞脖子: "雞脖", 鴨珍: "鴨胗", 鴨肫: "鴨胗", 豆干: "豆乾",
    黑輪: "黑輪片", 頭皮: "豬頭皮", 豬舌: "豬舌頭", 腱子: "腱子肉", 三層: "三層肉", 五花肉: "三層肉", 百頁: "百頁豆腐", 百葉豆腐: "百頁豆腐",
    鵪鶉蛋: "鳥蛋", 米糕: "米血", 米血糕: "米血", 鴨翅膀: "鴨翅", 鴨掌: "鴨腳", 雞母: "母雞", 雞公: "公雞",
    鴨真: "鴨胗", 鴨針: "鴨胗", 鴨診: "鴨胗", 米雪: "米血", 魯蛋: "滷蛋", 百葉: "百頁豆腐", 天婦羅: "甜不辣", 甜布辣: "甜不辣", 黑倫: "黑輪片", 海代: "海帶", 甜不拉: "甜不辣" };
  // 只寫「雞」「鴨」：先當成公雞、鴨肉，預覽會用黃字提醒
  const GUESS = { 雞: "公雞", 雞肉: "公雞", 鴨: "鴨肉" };
  // 口語的贅字，不用放進備註
  const FILLER = /等一下|等等|然後|還有|再來|另外|麻煩|謝謝|請|幫我|我要|總共|共|以上|就這樣|好了|^要$|^跟$|^和$/g;

  /* 全形數字、中文數字 → 阿拉伯數字（十、百也可以） */
  function toNum(s) {
    s = String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248));
    if (/^\d+$/.test(s)) return Number(s);
    let n = 0, cur = 0;
    for (const ch of s) {
      if (ch in CN) cur = CN[ch];
      else if (ch === "十" || ch === "拾") { n += (cur || 1) * 10; cur = 0; }
      else if (ch === "百" || ch === "佰") { n += (cur || 1) * 100; cur = 0; }
      else return NaN;
    }
    return n + cur;
  }
  const NUM = "[0-9０-９]+|[零〇一壹二兩貳三參四肆五伍六陸七柒八捌九玖十拾百佰]+";

  // 手寫辨識常跑出簡體字、注音或像的字：先換成菜單上的字
  const CHAR = { 鸡: "雞", 鷄: "雞", 鸭: "鴨", ㄚ: "鴨", 丫: "鴨", Y: "鴨", 猪: "豬", 头: "頭", 脚: "腳", 肠: "腸", 带: "帶", 页: "頁", 层: "層",
    鸟: "鳥", 轮: "輪", 鱼: "魚", 卤: "滷", 魯: "滷", 熏: "燻", 薰: "燻", 烟: "煙", 块: "塊", 只: "隻", 个: "個", 两: "兩", 后: "後", 点: "點",
    号: "號", 礼: "禮", 周: "週", 妈: "媽", 场: "場", 订: "訂", 钱: "錢", 时: "時" };
  function norm(t) {
    return String(t || "").replace(/[鸡鷄鸭ㄚ丫Y猪头脚肠带页层鸟轮鱼卤魯熏薰烟块只个两后点号礼周妈场订钱时]/g, c => CHAR[c]).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 65248))
      .replace(/[：]/g, ":").replace(/[＄]/g, "$").replace(/[ｘＸ✕╳×*]/g, "x").replace(/\r/g, "");
  }

  /* 日期：今天／明天／後天、星期幾、10/18、10月18日 */
  function findDate(t, now) {
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out = n => { const d = new Date(d0); d.setDate(d.getDate() + n); return d; };
    let m;
    if (/大後天/.test(t)) return { d: out(3), hit: "大後天" };
    if ((m = t.match(/今天|今日/))) return { d: out(0), hit: m[0] };
    if ((m = t.match(/明天|明日/))) return { d: out(1), hit: m[0] };
    if ((m = t.match(/後天/))) return { d: out(2), hit: m[0] };
    if ((m = t.match(/(下{0,2})(?:星期|禮拜|週|周)([一二三四五六日天])/))) {
      const want = "日一二三四五六".indexOf(m[2] === "天" ? "日" : m[2]);
      if (m[1]) {   // 下週三 = 下一個星期（星期一開始算）的星期三
        const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7) + 7 * m[1].length);
        const d = new Date(mon); d.setDate(mon.getDate() + ((want + 6) % 7)); return { d, hit: m[0] };
      }
      return { d: out((want - d0.getDay() + 7) % 7), hit: m[0] };   // 週三 = 最近的星期三（今天是週三就是今天）
    }
    if ((m = t.match(/(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號)?/))) {
      const mo = Number(m[1]), da = Number(m[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        let d = new Date(d0.getFullYear(), mo - 1, da);
        if (d < out(-60)) d = new Date(d0.getFullYear() + 1, mo - 1, da);   // 12 月寫「1/3」是明年
        return { d, hit: m[0] };
      }
    }
    if ((m = t.match(/(\d{1,2})\s*(?:日|號)/)) && !/點|:/.test(m[0])) {
      const da = Number(m[1]);
      if (da >= 1 && da <= 31) { let d = new Date(d0.getFullYear(), d0.getMonth(), da); if (d < d0) d = new Date(d0.getFullYear(), d0.getMonth() + 1, da); return { d, hit: m[0] }; }
    }
    return null;
  }

  /* 時間：10:30、10點半、下午3點、早上七點 */
  function findTime(t) {
    let m = t.match(/(早上|上午|中午|下午|晚上|傍晚)?\s*(\d{1,2}):(\d{2})/);
    let h, mi, ap, hit;
    if (m) { ap = m[1]; h = Number(m[2]); mi = Number(m[3]); hit = m[0]; }
    else if ((m = t.match(new RegExp(`(早上|上午|中午|下午|晚上|傍晚)?\\s*(${NUM})\\s*點\\s*(半|(${NUM})\\s*分?)?`)))) {
      ap = m[1]; h = toNum(m[2]); mi = m[3] === "半" ? 30 : m[4] ? toNum(m[4]) : 0; hit = m[0];
    } else return null;
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi < 60)) return null;
    if ((ap === "下午" || ap === "晚上" || ap === "傍晚") && h < 12) h += 12;
    if (ap === "中午" && h < 6) h += 12;
    if (!ap && h >= 1 && h <= 5) h += 12;   // 市場沒有凌晨取貨：「3點」當成下午 3 點
    if (mi >= 45) h += 1;   // 時間選單是每 30 分鐘一格，取最近的
    mi = mi >= 15 && mi < 45 ? 30 : 0;
    if (h > 23) return null;
    return { t: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, hit };
  }

  function parseOrderText(text, MENU, now) {
    now = now || new Date();
    let t = norm(text);
    const r = { items: [], left: [] };
    const cut = s => { if (s) t = t.replace(s, " "); };

    // 電話（先拿掉，免得被當成數量）
    let m = t.match(/(?:^|[^\d])(0\d(?:[\s-]?\d){6,10})(?!\d)/);
    if (m) { const p = m[1].replace(/\D/g, ""); if (p.length >= 8 && p.length <= 12) { r.phone = p; cut(m[1]); } }
    // 市場
    const MK = [["爸爸市場", /爸爸(?:市場)?|爸市/], ["媽媽市場", /媽媽(?:市場)?|媽市/], ["早市", /早市/], ["外送", /外送/]];
    for (const [mk, re] of MK) { const x = t.match(re); if (x) { r.market = mk; cut(x[0]); break; } }
    // 外送地址：「地址：…」到下一個空白或逗號
    if ((m = t.match(/地址\s*[:]?\s*([^\s，,]+)/))) { r.addr = m[1].trim().slice(0, 80); cut(m[0]); }
    // 日期、時間
    const d = findDate(t, now); if (d) { r.date = d.d; cut(d.hit); }
    const tm = findTime(t); if (tm) { r.time = tm.t; cut(tm.hit); }
    // 付款
    if ((m = t.match(/已付清|付清了?|付過了|已付款/))) { r.pay = "full"; cut(m[0]); }
    else if ((m = t.match(new RegExp(`(?:訂金|定金)\\s*\\$?\\s*(${NUM})\\s*元?`)))) { r.pay = "deposit"; r.deposit = toNum(m[1]); cut(m[0]); }
    // 處理方式
    const PREP = [["cut", /不要?切/, "不切"], ["pepper", /不要?(?:加)?胡椒/, "不要"], ["oil", /不要?(?:加)?香油/, "不要"], ["sauce", /不要?(?:加)?醬油膏/, "不要"]];
    for (const [g, re, v] of PREP) { const x = t.match(re); if (x) { (r.prep = r.prep || {})[g] = v; cut(x[0]); } }
    // 稱呼：王小姐、陳先生
    if ((m = t.match(/([一-鿿]{1,2}?)\s*(小姐|先生)/))) { r.surname = m[1]; r.title = m[2]; cut(m[0]); }
    else if ((m = t.match(/(小姐|先生)/))) { r.title = m[1]; cut(m[0]); }

    // 品項：找出每個品項名稱出現的位置
    const names = [];
    MENU.forEach((sec, si) => sec.items.forEach((it, ii) => names.push({ w: it.name, si, ii })));
    const addAlias = (map, guess) => Object.entries(map).forEach(([w, to]) => MENU.forEach((sec, si) => sec.items.forEach((it, ii) => { if (it.name === to) names.push({ w, si, ii, guess }); })));
    addAlias(ALIAS, false); addAlias(GUESS, true);
    names.sort((a, b) => b.w.length - a.w.length);
    const hits = [], used = new Array(t.length).fill(false);
    for (const n of names) {
      let from = 0, i;
      while ((i = t.indexOf(n.w, from)) >= 0) {
        from = i + n.w.length;
        if (used.slice(i, from).some(Boolean)) continue;
        // 「雞」「鴨」後面還接著別的字（例：雞頭）就不是在說整隻雞
        if (n.guess && /[\u4e00-\u9fff]/.test(t[from] || "") && !new RegExp(`[${UNIT}半肉一二兩三四五六七八九十]`).test(t[from])) continue;
        for (let k = i; k < from; k++) used[k] = true;
        hits.push({ ...n, at: i, end: from });
      }
    }
    hits.sort((a, b) => a.at - b.at);
    // 「煙燻鴨胗」「滷鴨胗」：兩區都有的品項看前面有沒有寫哪一類，沒寫就用滷味
    const SEP = /[\n，,、。；;!！?？\s+＋]/;
    hits.forEach((h, k) => {
      // 這個品項的範圍：往前到上一個品項或分隔符號，往後到下一個品項或分隔符號
      let a = h.at; while (a > 0 && !SEP.test(t[a - 1]) && !(k && a <= hits[k - 1].end)) a--;
      let b = h.end; while (b < t.length && !SEP.test(t[b]) && !(hits[k + 1] && b >= hits[k + 1].at)) b++;
      const before = t.slice(a, h.at), after = t.slice(h.end, b);
      h.span = before + "\u0000" + after; h.a = a; h.b = b;
    });
    const build = (si, ii, span, pre) => {
      const dup = MENU.flatMap((x, a) => x.items.map((it, b) => [a, b, it.name])).filter(z => z[2] === MENU[si].items[ii].name);
      if (dup.length > 1) {
        const pick = dup.find(z => (/燻/.test(pre) && MENU[z[0]].cat === "煙燻") || (/滷/.test(pre) && MENU[z[0]].cat === "滷味"))
          || dup.find(z => MENU[z[0]].cat === "滷味") || dup[0];
        si = pick[0]; ii = pick[1];
      }
      const it = MENU[si].items[ii];
      let s = span.replace(/煙燻|燻|滷味|滷/g, "");
      const line = { si, ii, name: it.name, cat: MENU[si].cat };
      if (it.type === "money" || it.type === "amount") {
        const x = s.match(new RegExp(`\\$?\\s*(${NUM})\\s*(?:元|塊錢|塊)?`));
        const v = x ? toNum(x[1]) : 0;
        line.amount = v >= 10 ? v : 0;   // 「雞腳 100」= 買 100 元
      } else {
        let oi = 0;
        if (it.opts && it.opts.length > 1) {
          const half = it.opts.findIndex(o => /^半/.test(o.label));
          const want = ["前半", "後半"].map(w => it.opts.findIndex(o => o.label === w));
          const named = it.opts.findIndex(o => !/^[一半]/.test(o.label) && s.includes(o.label));   // 例：豬皮「大卷」
          if (named >= 0) { oi = named; s = s.replace(it.opts[named].label, ""); }
          else if (/前半/.test(s) && want[0] >= 0) { oi = want[0]; s = s.replace("前半", ""); }
          else if (/後半/.test(s) && want[1] >= 0) { oi = want[1]; s = s.replace("後半", ""); }
          else if (/半/.test(s) && half >= 0) { oi = half; s = s.replace(new RegExp(`半[${UNIT}]?`), ""); }
        }
        s = s.replace(/[（(][^）)]*[）)]/g, "");
        // 「豬肚一顆3」：選項名稱裡的「一」不是數量，後面還有數字就拿掉選項名稱
        const lab = it.opts && it.opts[oi] ? it.opts[oi].label.replace(/（.*?）/, "") : "";
        if (lab && s.includes(lab) && new RegExp(NUM).test(s.replace(lab, ""))) s = s.replace(lab, "");
        const x = s.match(new RegExp(`x?\\s*(${NUM})\\s*[${UNIT}]?`));
        let q = x ? toNum(x[1]) : 1;
        if (!(q >= 1 && q <= 999)) q = 1;
        line.oi = it.type === "piece" ? undefined : oi; line.q = q;
      }
      return line;
    };
    for (const h of hits) {
      const line = build(h.si, h.ii, h.span, t.slice(Math.max(0, h.a - 3), h.at));
      if (h.guess) line.guess = h.w;
      r.items.push(line);
    }
    // 沒看懂的字：去掉品項範圍後還剩下的
    let rest = "";
    for (let i = 0, k = 0; i < t.length; i++) {
      while (k < hits.length && i >= hits[k].b) k++;
      rest += hits[k] && i >= hits[k].a ? " " : t[i];
    }
    const left = rest.split(SEP).map(x => x.replace(FILLER, "").trim()).filter(x => x && !/^[:：$x\-]+$/.test(x));
    // 沒對到的字：跟菜單比，只差一個字的就當成那個品項（例：「鴨真」→ 鴨胗），預覽會提醒是猜的
    const pool = names.filter(n => !n.guess);
    for (const chunk of left) {
      const core = chunk.replace(new RegExp(`x|\\$|${NUM}|半|[${UNIT}]|元|錢`, "g"), "");
      let best = null, tie = false;
      if (core.length >= 2 && core.length <= 4) for (const n of pool) {
        if (n.w.length !== core.length) continue;
        let same = 0; for (let i = 0; i < core.length; i++) if (core[i] === n.w[i]) same++;
        if (same !== core.length - 1) continue;
        const nm = MENU[n.si].items[n.ii].name;
        if (best && MENU[best.si].items[best.ii].name !== nm) tie = true; else best = n;
      }
      if (best && !tie) { const line = build(best.si, best.ii, chunk.replace(core, "\u0000"), ""); line.guess = core; r.items.push(line); }
      else r.left.push(chunk);
    }
    return r;
  }

  root.parseOrderText = parseOrderText;
  if (typeof module !== "undefined") module.exports = { parseOrderText, toNum };
})(typeof window !== "undefined" ? window : globalThis);
