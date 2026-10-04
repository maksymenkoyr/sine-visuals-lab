// The promo's text, rendered once as transparent PNGs that compose.py lays over the footage.
//   node tools/promo/cards.mjs
//
// Reads <work>/lines.json:
//   { "title": "0.2.0 - beta", "subtitle": "Sine Visuals Lab",
//     "demos":  [{ "take": "ui_strains", "from": 0, "beats": 3, "group": "Scenes", "text": "…" }, …],
//     "groups": [{ "key": "scenes", "title": "Scenes", "rows": ["…", …] }] }
// A demo is a clip that shows a change happening (a take from record.mjs, `from` its first beat) with
// one caption along the bottom; a group is the full list of changes, which compose.py spins through a
// wheel low in the frame. Rows must stay short: a wheel row is one line (~40 characters), a caption
// wraps to two. This script warns when text does not fit.
//
// Writes <work>/cards/: meta.json {demos, groups: [{key, n}]}, intro.png, demo_<i>.png, and per group
// head_<key>.png + row_<key>_<i>.png (one wheel row each, centred).
// The look: dark translucent panels with white hairlines, the app's own accent (white) — a release
// page's feel without its icons or colours.
import { chromium } from "playwright";
import fs from "node:fs";

const WORK = process.env.PROMO_WORK || new URL("../.cache/promo/", import.meta.url).pathname;
const lines = JSON.parse(fs.readFileSync(`${WORK}/lines.json`, "utf8"));
const OUT = `${WORK}/cards`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const W = 940, CAP_H = 190, ROW_H = 84, HEAD_H = 70;
const fontStack = `-apple-system,"SF Pro Display","SF Pro Text","Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const base = `html,body{margin:0;background:transparent}*{box-sizing:border-box}
body{font-family:${fontStack};color:#f2f4f7;-webkit-font-smoothing:antialiased}`;
const capCss = `${base}
.c{width:${W}px;height:${CAP_H}px;border-radius:18px;padding:22px 32px;display:flex;flex-direction:column;gap:12px;
 background:rgba(8,10,14,.62);border:1.5px solid rgba(255,255,255,.34)}
.top{display:flex;align-items:center;gap:14px;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.62);font-weight:600}
.top span:first-of-type{flex:1}
.top span:last-of-type{letter-spacing:.04em}
.t{font-size:40px;line-height:1.2;font-weight:600;text-shadow:0 1px 10px rgba(0,0,0,.8);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
`;
const rowCss = `${base}
.r{width:${W}px;height:${ROW_H}px;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:600;white-space:nowrap;text-shadow:0 2px 12px rgba(0,0,0,.9)}
.h{width:${W}px;height:${HEAD_H}px;display:flex;align-items:center;justify-content:center;gap:18px;font-size:26px;letter-spacing:.2em;text-transform:uppercase;font-weight:650;color:rgba(255,255,255,.75);text-shadow:0 1px 8px rgba(0,0,0,.8)}
.h i{display:block;width:70px;height:1.5px;background:rgba(255,255,255,.4)}
.h b{font-weight:500;color:rgba(255,255,255,.5);letter-spacing:.06em}
`;
const introCss = `${base}
body{width:1080px;height:1920px;position:relative}
.v{position:absolute;left:70px;top:760px;width:${W}px;height:420px;border-radius:22px;background:rgba(8,10,14,.5);border:1.5px solid rgba(255,255,255,.3);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.v div:first-child{font-size:116px;font-weight:700;letter-spacing:-.02em;text-shadow:0 2px 18px rgba(0,0,0,.7)}
.v div:last-child{font-size:34px;color:rgba(255,255,255,.7);font-weight:500;letter-spacing:.14em;text-transform:uppercase}
`;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
async function shot(html, path, style) {
  await p.setContent(`<!doctype html><meta charset=utf-8><style>${style}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: true });
}
const meta = { demos: 0, groups: [] };
const warn = [];

const demos = lines.demos || [];
await p.setViewportSize({ width: W, height: CAP_H });
for (let i = 0; i < demos.length; i++) {
  const d = demos[i];
  await shot(`<div class="c"><div class="top"><span>${esc(d.group || "")}</span><span>${i + 1} / ${demos.length}</span></div><div class="t">${esc(d.text)}</div></div>`,
    `${OUT}/demo_${i}.png`, capCss);
  const cut = await p.evaluate(() => { const t = document.querySelector(".t"); return t.scrollHeight > t.clientHeight + 1; });
  if (cut) warn.push(`demo #${i + 1} is cut off after two lines: "${d.text}"`);
}
meta.demos = demos.length;

for (const g of lines.groups) {
  await p.setViewportSize({ width: W, height: HEAD_H });
  await shot(`<div class="h"><i></i><span>${esc(g.title)}</span><b>${g.rows.length}</b><i></i></div>`, `${OUT}/head_${g.key}.png`, rowCss);
  await p.setViewportSize({ width: W, height: ROW_H });
  for (let i = 0; i < g.rows.length; i++) {
    await shot(`<div class="r"><span>${esc(g.rows[i])}</span></div>`, `${OUT}/row_${g.key}_${i}.png`, rowCss);
    const wide = await p.evaluate(() => document.querySelector(".r span").getBoundingClientRect().width > 900);
    if (wide) warn.push(`${g.key}: too wide for one line: "${g.rows[i]}"`);
  }
  meta.groups.push({ key: g.key, n: g.rows.length });
}
await p.setViewportSize({ width: 1080, height: 1920 });
await shot(`<div class="v"><div>${esc(lines.title)}</div><div>${esc(lines.subtitle || "")}</div></div>`, `${OUT}/intro.png`, introCss);
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
await b.close();
for (const w of warn) console.log("WARN", w);
console.log(`cards ok: ${meta.demos} demos; groups ${meta.groups.map((g) => `${g.key} (${g.n})`).join(", ")}`);
