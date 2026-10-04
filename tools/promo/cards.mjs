// The promo's text, rendered once as transparent PNGs that compose.py lays over the footage.
//   node tools/promo/cards.mjs
//
// Reads <work>/lines.json:
//   { "title": "0.2.0 - beta", "subtitle": "Sine Visuals Lab",
//     "demos":  [{ "take": "ui_strains", "from": 0, "beats": 3, "group": "Scenes", "text": "…" }, …],
//     "groups": [{ "key": "scenes", "title": "Scenes", "rows": ["…", …] }] }
// A demo is a clip that shows a change happening (a take from record.mjs, `from` its first beat) with
// one caption along the bottom; a group is the full list of changes, shown as a list card held low in
// the frame whose rows scroll through it (compose.py). Rows must stay short: a list row is one line
// (~40 characters), a caption wraps to two. This script warns when text does not fit.
//
// Writes <work>/cards/: meta.json {demos, visible, groups: [{key, n}]}, intro.png, demo_<i>.png, and per
// group chrome_<key>.png (the card and its header, sized for VISIBLE rows) + row_<key>_<i>.png.
// Also the two-screen demos' parts: label_<laptop|tv|popout>.png device tags, and key_<space|option>_<on|off>.png,
// the laptop's Cue and Play keys.
// The look: the version card is a GitHub release in miniature (a green tag icon); the rest
// keeps that family's translucent card, header bar and row rules, without its icons or colours.
import { chromium } from "playwright";
import fs from "node:fs";

const WORK = process.env.PROMO_WORK || new URL("../.cache/promo/", import.meta.url).pathname;
const lines = JSON.parse(fs.readFileSync(`${WORK}/lines.json`, "utf8"));
const OUT = `${WORK}/cards`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// The list card: X/Y of its top-left corner on the 1080x1920 frame, header and row heights, rows shown.
const X = 70, W = 940, HEAD = 96, ROW = 80, VISIBLE = 5, CAP_H = 190;
const Y = 1545 - (HEAD + VISIBLE * ROW);        // its bottom sits just above the band Stories covers
const fontStack = `-apple-system,"SF Pro Text","Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const base = `html,body{margin:0;background:transparent}*{box-sizing:border-box}
body{font-family:${fontStack};color:#eef1f5;-webkit-font-smoothing:antialiased}`;
const css = `${base}
body{width:1080px;height:1920px;position:relative}
.card{position:absolute;left:${X}px;top:${Y}px;width:${W}px;height:${HEAD + VISIBLE * ROW + 2}px;border-radius:14px;
 background:rgba(10,13,18,.5);border:1.5px solid rgba(255,255,255,.24);overflow:hidden}
.head{height:${HEAD}px;display:flex;align-items:center;gap:20px;padding:0 32px;background:rgba(22,26,32,.55);border-bottom:1.5px solid rgba(255,255,255,.18)}
.head h2{margin:0;font-size:40px;font-weight:650;letter-spacing:-.01em;flex:1;text-shadow:0 1px 8px rgba(0,0,0,.6)}
.count{min-width:56px;height:44px;border-radius:22px;padding:0 16px;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:600;background:rgba(255,255,255,.14)}
.row{position:absolute;left:0;top:0;width:${W}px;height:${ROW}px;display:flex;align-items:center;gap:20px;padding:0 32px;border-top:1.5px solid rgba(255,255,255,.12);font-size:35px;font-weight:500;white-space:nowrap;text-shadow:0 1px 8px rgba(0,0,0,.75)}
.row i{flex:none;width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.55)}
`;
const capCss = `${base}
.c{width:${W}px;height:${CAP_H}px;border-radius:18px;padding:22px 32px;display:flex;flex-direction:column;gap:12px;
 background:rgba(8,10,14,.62);border:1.5px solid rgba(255,255,255,.34)}
.top{display:flex;align-items:center;gap:14px;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.62);font-weight:600}
.top span:first-of-type{flex:1}
.top span:last-of-type{letter-spacing:.04em}
.t{font-size:40px;line-height:1.2;font-weight:600;text-shadow:0 1px 10px rgba(0,0,0,.8);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
`;
// GitHub's release header: a green tag and the version (its "Latest" badge was tried; the user cut it)
const introCss = `${base}
body{width:1080px;height:1920px;position:relative}
.v{position:absolute;left:70px;top:760px;width:${W}px;height:420px;border-radius:14px;background:rgba(13,17,23,.5);border:2px solid rgba(240,246,252,.22);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.t{display:flex;align-items:center;gap:26px;font-size:112px;font-weight:700;letter-spacing:-.02em;text-shadow:0 2px 16px rgba(0,0,0,.7)}
.s{display:flex;align-items:center;gap:20px;font-size:36px;color:#b6c0cc;font-weight:500;text-shadow:0 1px 8px rgba(0,0,0,.7)}
`;
const tag = (c, n) => `<svg width="${n}" height="${n}" viewBox="0 0 16 16" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"><path d="M2 2.8v4.5c0 .3.1.5.3.7l6.2 6.2c.4.4 1 .4 1.4 0l4.1-4.1c.4-.4.4-1 0-1.4L8 2.5a1 1 0 0 0-.7-.3H2.8c-.4 0-.8.3-.8.6Z"/><circle cx="5" cy="5" r="1" fill="${c}" stroke="none"/></svg>`;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
async function shot(html, path, style) {
  await p.setContent(`<!doctype html><meta charset=utf-8><style>${style}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path, omitBackground: true });
}
const meta = { demos: 0, visible: VISIBLE, card: { x: X, y: Y + HEAD, w: W, row: ROW }, groups: [] };
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
  await p.setViewportSize({ width: 1080, height: 1920 });
  await shot(`<div class="card" style="height:${HEAD + Math.min(VISIBLE, g.rows.length) * ROW + 2}px"><div class="head"><h2>${esc(g.title)}</h2><div class="count">${g.rows.length}</div></div></div>`, `${OUT}/chrome_${g.key}.png`, css);
  await p.setViewportSize({ width: W, height: ROW });
  for (let i = 0; i < g.rows.length; i++) {
    await shot(`<div class="row"><i></i><span>${esc(g.rows[i])}</span></div>`, `${OUT}/row_${g.key}_${i}.png`, css.replace("width:1080px;height:1920px;", ""));
    const wide = await p.evaluate(() => document.querySelector(".row span").getBoundingClientRect().right > 940 - 28);
    if (wide) warn.push(`${g.key}: too wide for one line: "${g.rows[i]}"`);
  }
  meta.groups.push({ key: g.key, n: g.rows.length });
}
await p.setViewportSize({ width: 1080, height: 1920 });
await shot(`<div class="v"><div class="t">${tag("#3fb950", 84)}<span>${esc(lines.title)}</span></div>
  <div class="s"><span>${esc(lines.subtitle || "")}</span></div></div>`, `${OUT}/intro.png`, introCss);
// device tags for the room's split view
await p.setViewportSize({ width: 220, height: 56 });
await p.setViewportSize({ width: 320, height: 56 });
for (const [k, t] of [["laptop", "Laptop"], ["tv", "TV"], ["popout", "Pop-out window"]])
  await shot(`<div class="l">${t}</div>`, `${OUT}/label_${k}.png`, `${base}
.l{display:inline-flex;align-items:center;height:48px;padding:0 20px;border-radius:24px;background:rgba(8,10,14,.7);border:1.5px solid rgba(255,255,255,.34);font-size:26px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}`);
// the laptop's two output keys, drawn on its deck; lit = held (Cue orange, Play green, as the app's bars)
for (const [k, w, cap, word, lit] of [["space", 300, "space", "CUE", "#f5a524"], ["option", 150, "⌥ option", "PLAY", "#3fb950"]])
  for (const on of [false, true]) {
    await p.setViewportSize({ width: w, height: 58 });
    await shot(`<div class="k"><b>${word}</b><span>${cap}</span></div>`, `${OUT}/key_${k}_${on ? "on" : "off"}.png`, `${base}
.k{width:${w}px;height:58px;border-radius:10px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:21px;
 background:${on ? lit : "#2b2f37"};border:1.5px solid ${on ? lit : "rgba(255,255,255,.22)"};color:${on ? "#0b0d10" : "rgba(255,255,255,.72)"};
 box-shadow:${on ? `0 0 26px ${lit}` : "0 3px 0 rgba(0,0,0,.5)"}}
.k b{font-weight:800;letter-spacing:.1em}.k span{font-weight:500;opacity:.8}`);
  }
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
await b.close();
for (const w of warn) console.log("WARN", w);
console.log(`cards ok: ${meta.demos} demos; groups ${meta.groups.map((g) => `${g.key} (${g.n})`).join(", ")}`);
