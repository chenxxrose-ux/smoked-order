/* =====================================================
   訂購頁、剩貨頁共用：品項清單、圖示、排列、工具函式
   改品項只要改這裡，兩頁會一起更新。
   ===================================================== */
/* =====================================================
   品項清單
   單價直接在網頁上打，會自動記住（同一台裝置下次打開還在）
   price 是預設值，可留 0
   ===================================================== */
const MENU = [
  { cat: "煙燻", items: [
    { name: "雞肉",   weigh: true, opts: [{ label: "一隻", price: 0 }, { label: "半隻", price: 0 }] },
    { name: "鴨肉",   opts: [{ label: "一隻", price: 0 }, { label: "半隻", price: 0 }, { label: "前半", price: 0 }, { label: "後半", price: 0 }] },
    { name: "鴨頭",   opts: [{ label: "一支", price: 0 }] },
    { name: "鴨翅",   opts: [{ label: "一支", price: 0 }] },
    { name: "豬頭皮", type: "amount" },                 // 客人自填要買多少錢
    { name: "腱子肉", type: "piece" },                  // 秤重：一塊多少錢 × 幾塊
    { name: "魚板",   opts: [{ label: "一個", price: 0 }] },
    { name: "鳥蛋",   opts: [{ label: "一份（4個）", price: 0 }] },
    { name: "甜不辣", opts: [{ label: "一份（4個）", price: 0 }] },
    { name: "雞脖",   opts: [{ label: "一個", price: 0 }] },
    { name: "豬舌頭", opts: [{ label: "一顆", price: 0 }, { label: "半顆", price: 0 }] },
    { name: "豬心",   opts: [{ label: "一顆", price: 0 }, { label: "半顆", price: 0 }] },
    { name: "鴨心",   weigh: true, opts: [{ label: "一個", price: 0 }] },
    { name: "鴨舌",   opts: [{ label: "一個", price: 0 }] },
    { name: "鴨胗",   opts: [{ label: "一個", price: 0 }] },
    { name: "雞腳",   type: "money" },                  // 客人說要買多少錢（不用秤重）
    { name: "雞腿",   opts: [{ label: "一支", price: 0 }] },
  ]},
  { cat: "滷味", items: [
    { name: "米血",     opts: [{ label: "一片", price: 0 }] },
    { name: "豆乾",     opts: [{ label: "一個", price: 0 }] },
    { name: "海帶",     opts: [{ label: "一個", price: 0 }] },
    { name: "鴨胗",     opts: [{ label: "一個", price: 0 }] },
    { name: "鴨腸",     type: "amount" },               // 秤重：要買多少錢
    { name: "口香糖",   type: "amount" },
    { name: "大腸",     type: "amount" },
    { name: "百頁豆腐", opts: [{ label: "一個", price: 0 }] },
    { name: "豆包",     opts: [{ label: "一個", price: 0 }] },
    { name: "麵腸",     opts: [{ label: "一個", price: 0 }] },
    { name: "滷蛋",     opts: [{ label: "一個", price: 0 }] },
    { name: "雞肝",     opts: [{ label: "一個", price: 0 }] },
  ]},
];

/* 線條 icon */
const ICON = (() => {
  const svg = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  return {
    plus:  svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    share: svg('<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>'),
    copy:  svg('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
    scale: svg('<path d="M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>'),
    download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 15v3.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V15"/>'),
    edit:  svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    chev:  `<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
    list:  svg('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  };
})();

/* 排列：同一個字開頭的放在一起；不同開頭的群組依字數由短到長，同群組內也依字數 */
function sortNames(arr, name){
  const g = {};
  arr.forEach((x, i) => { const n = name(x), f = n[0]; if (!g[f]) g[f] = { min: n.length, first: i }; else g[f].min = Math.min(g[f].min, n.length); });
  return arr.map((x, i) => [x, i]).sort((a, b) => {
    const na = name(a[0]), nb = name(b[0]), ga = g[na[0]], gb = g[nb[0]];
    return ga.min - gb.min || ga.first - gb.first || na.length - nb.length || a[1] - b[1];
  });
}

/* 防注入：任何要放進 HTML 的文字都先轉義 */
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"'`]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

/* 日期 */
const WK = "日一二三四五六";
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Firebase（apiKey 本來就是公開用的；保護資料的是權限規則與加密） */
const FB = { apiKey: "AIzaSyCpzgphKvbKT77QNIsdj4r43VwF-6dAp1o", projectId: "smoked-order" };
