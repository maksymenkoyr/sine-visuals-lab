// The promo's text: GitHub-family translucent cards, rendered once as transparent 1080x1920 PNGs
// that compose.py lays over the footage.   node tools/promo/cards.mjs
//
// Reads <work>/lines.json:
//   { "title": "0.2.0 - beta", "subtitle": "Sine Visuals Lab",
//     "groups": [{ "key": "scenes", "title": "Scenes", "style": "carousel" | "card", "rows": ["…", …] }] }
// A "carousel" group rides a row of small cards along the bottom while the picture stays clear
// (use it for changes you can SEE); a "card" group is one list card over dimmed footage (use it for
// changes you can't). Rows must stay short: a card row is one line (~40 characters), a carousel
// card wraps to three. This script warns when a row does not fit.
//
// Writes <work>/cards/: meta.json, intro.png, and per group chrome_<key>.png + row_<key>_<i>.png
// (card) or car_<key>_<i>.png + car_<key>_<i>_on.png (carousel, the highlighted twin).
// The look: dark translucent fill, thin light border, a header bar with a count pill, a purple
// merged-PR icon per row — a nod to GitHub's release page, not a copy. Translucent on purpose.
import { chromium } from "playwright";
import fs from "node:fs";

const WORK = process.env.PROMO_WORK || new URL("../.cache/promo/", import.meta.url).pathname;
const lines = JSON.parse(fs.readFileSync(`${WORK}/lines.json`, "utf8"));
const OUT = `${WORK}/cards`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const X = 70, W = 940, TOP = 430, HEAD = 100, ROW = 80;
const fontStack = `-apple-system,"SF Pro Text","Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const css = `
html,body{margin:0;background:transparent}
*{box-sizing:border-box}
body{width:1080px;height:1920px;position:relative;font-family:${fontStack};color:#e6edf3;-webkit-font-smoothing:antialiased}
.card{position:absolute;left:${X}px;top:${TOP}px;width:${W}px;border-radius:14px}
.box{background:rgba(13,17,23,.46);border:2px solid rgba(240,246,252,.20);overflow:hidden}
.head{height:${HEAD}px;display:flex;align-items:center;gap:20px;padding:0 32px;background:rgba(22,27,34,.55);border-bottom:2px solid rgba(240,246,252,.16)}
.head h2{margin:0;font-size:42px;font-weight:650;letter-spacing:-.01em;flex:1;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.count{min-width:56px;height:46px;border-radius:23px;padding:0 16px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:600;background:rgba(110,118,129,.40);color:#e6edf3}
.row{position:absolute;left:0;width:${W}px;height:${ROW}px;display:flex;align-items:center;gap:22px;padding:0 32px;border-top:2px solid rgba(240,246,252,.12);font-size:35px;font-weight:500;white-space:nowrap;text-shadow:0 1px 8px rgba(0,0,0,.75)}
.row svg{flex:none}
.rows{position:absolute;left:${X}px;top:${TOP + HEAD}px;width:${W}px}
`;
const merge = (n) => `<svg width="${n}" height="${n}" viewBox="0 0 16 16" fill="none" stroke="#a371f7" stroke-width="1.5" stroke-linecap="round"><circle cx="4" cy="3.2" r="1.7"/><circle cx="4" cy="12.8" r="1.7"/><circle cx="12" cy="8.4" r="1.7"/><path d="M4 4.9v6.2M4 5.2c0 3.1 2.2 3.2 6.3 3.2"/></svg>`;
const tag = (c, n) => `<svg width="${n}" height="${n}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"><path d="M2 2.8v4.5c0 .3.1.5.3.7l6.2 6.2c.4.4 1 .4 1.4 0l4.1-4.1c.4-.4.4-1 0-1.4L8 2.5a1 1 0 0 0-.7-.3H2.8c-.4 0-.8.3-.8.6Z"/><circle cx="5" cy="5" r="1" fill="${c}" stroke="none"/></svg>`;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const carCss = (on) => `
html,body{margin:0;background:transparent}*{box-sizing:border-box}
body{font-family:${fontStack};color:#e6edf3;-webkit-font-smoothing:antialiased}
.c{width:460px;height:200px;border-radius:14px;padding:20px 24px;display:flex;flex-direction:column;gap:14px;
 background:rgba(13,17,23,${on ? 0.74 : 0.52});border:2px solid ${on ? "rgba(163,113,247,.95)" : "rgba(240,246,252,.20)"}}
.top{display:flex;align-items:center;gap:12px;font-size:22px;letter-spacing:.12em;text-transform:uppercase;color:#9aa5b1;font-weight:600}
.top span:first-of-type{flex:1}
.pill{padding:2px 14px;border-radius:20px;background:rgba(110,118,129,.4);color:#e6edf3;letter-spacing:0;font-size:22px}
.t{font-size:33px;line-height:1.24;font-weight:550;text-shadow:0 1px 8px rgba(0,0,0,.75);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
async function shot(html, path, style = css) {
  await p.setContent(`<!doctype html><meta charset=utf-8><style>${style}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: true });
}
const meta = {};
const warn = [];

for (const g of lines.groups) {
  const n = g.rows.length;
  if (g.style === "carousel") {
    await p.setViewportSize({ width: 460, height: 200 });
    for (let i = 0; i < n; i++) for (const on of [false, true]) {
      await shot(`<div class="c"><div class="top">${merge(30)}<span>${esc(g.title)}</span><span class="pill">${i + 1}/${n}</span></div><div class="t">${esc(g.rows[i])}</div></div>`,
        `${OUT}/car_${g.key}_${i}${on ? "_on" : ""}.png`, carCss(on));
      if (!on) {
        const cut = await p.evaluate(() => { const t = document.querySelector(".t"); return t.scrollHeight > t.clientHeight + 1; });
        if (cut) warn.push(`${g.key} #${i + 1} is cut off after three lines: "${g.rows[i]}"`);
      }
    }
    await p.setViewportSize({ width: 1080, height: 1920 });
    meta[g.key] = { n, style: "carousel" };
  } else {
    const h = HEAD + n * ROW + 2;
    await shot(`<div class="card box" style="height:${h}px"><div class="head">${tag("#3fb950", 40)}<h2>${esc(g.title)}</h2><div class="count">${n}</div></div></div>`, `${OUT}/chrome_${g.key}.png`);
    for (let i = 0; i < n; i++) await shot(`<div class="rows"><div class="row" style="top:${i * ROW}px">${merge(34)}<span>${esc(g.rows[i])}</span></div></div>`, `${OUT}/row_${g.key}_${i}.png`);
    await p.setContent(`<!doctype html><meta charset=utf-8><style>${css}.row{position:static}</style>` + g.rows.map((r) => `<div class="row"><span>${esc(r)}</span></div>`).join(""));
    const wide = await p.evaluate(() => [...document.querySelectorAll(".row span")].filter((s) => s.getBoundingClientRect().width > 940 - 64 - 56).map((s) => s.textContent));
    for (const w of wide) warn.push(`${g.key}: too wide for one line: "${w}"`);
    meta[g.key] = { n, h, style: "card" };
  }
}
await shot(`<div class="card box" style="top:760px;height:420px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
  <div style="display:flex;align-items:center;gap:26px">${tag("#3fb950", 84)}<div style="font-size:112px;font-weight:700;letter-spacing:-.02em;text-shadow:0 2px 16px rgba(0,0,0,.7)">${esc(lines.title)}</div></div>
  <div style="font-size:36px;color:#b6c0cc;font-weight:500;text-shadow:0 1px 8px rgba(0,0,0,.7)">${esc(lines.subtitle || "")}</div></div>`, `${OUT}/intro.png`);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
await b.close();
for (const w of warn) console.log("WARN", w);
console.log("cards ok", JSON.stringify(meta));
