// The promo's text, rendered once as transparent PNGs that compose.py lays over the footage.
//   node tools/promo/cards.mjs
//
// Reads <work>/lines.json:
//   { "title": "0.2.0 - beta", "subtitle": "Sine Visuals Lab", "opening": "Your music, drawn live.",
//     "hooks": [{ "take": "song_p2r", "beats": 8, "text": "…" }, …] }
// `opening` is the line over the first bar; a hook is a clip (a take from record.mjs, `from` its first
// beat for a panel take) with one caption along the bottom; title and subtitle make the version card at
// the end. The opening may wrap to two lines, a caption must fit on one: this script warns when not.
//
// Writes <work>/cards/: meta.json {hooks, cap}, opening.png, hook_<i>.png, version.png.
// Also the two-screen hooks' parts: label_<laptop|tv|popout>.png device tags, and key_<space|option>_<on|off>.png,
// the laptop's Cue and Play keys.
// The look: the version card is a GitHub release in miniature (a green tag icon); a caption keeps that
// family's translucent card with a white hairline, without its icons or colours.
import { chromium } from "playwright";
import fs from "node:fs";

const WORK = process.env.PROMO_WORK || new URL("../.cache/promo/", import.meta.url).pathname;
const lines = JSON.parse(fs.readFileSync(`${WORK}/lines.json`, "utf8"));
const OUT = `${WORK}/cards`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const W = 940, CAP_H = 112, PAD = 32;           // card width, caption height (one line) and side padding
const OPEN_PX = 92, OPEN_LH = 1.1;              // the opening line's font size and line height
const fontStack = `-apple-system,"SF Pro Text","Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const base = `html,body{margin:0;background:transparent}*{box-sizing:border-box}
body{font-family:${fontStack};color:#eef1f5;-webkit-font-smoothing:antialiased}`;
const capCss = `${base}
.c{width:${W}px;height:${CAP_H}px;border-radius:18px;padding:0 ${PAD}px;display:flex;align-items:center;
 background:rgba(8,10,14,.62);border:1.5px solid rgba(255,255,255,.34)}
.t{font-size:44px;font-weight:600;white-space:nowrap;text-shadow:0 1px 10px rgba(0,0,0,.8)}
`;
// the opening line: big, centred in the band Stories leaves free, no card, so the look shows through
const openCss = `${base}
body{width:1080px;height:1920px;position:relative}
.o{position:absolute;left:70px;top:700px;width:${W}px;height:400px;display:flex;align-items:center;justify-content:center}
.o p{margin:0;text-align:center;text-wrap:balance;font-size:${OPEN_PX}px;line-height:${OPEN_LH};font-weight:700;letter-spacing:-.02em;
 text-shadow:0 2px 24px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.6)}
`;
// GitHub's release header: a green tag and the version (its "Latest" badge was tried; the user cut it)
const versionCss = `${base}
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
const meta = { hooks: 0, cap: { w: W, h: CAP_H } };
const warn = [];

const hooks = lines.hooks || [];
await p.setViewportSize({ width: W, height: CAP_H });
for (let i = 0; i < hooks.length; i++) {
  await shot(`<div class="c"><div class="t">${esc(hooks[i].text)}</div></div>`, `${OUT}/hook_${i}.png`, capCss);
  const wide = await p.evaluate((max) => document.querySelector(".t").getBoundingClientRect().right > max, W - PAD);
  if (wide) warn.push(`hook #${i + 1} is too wide for one line: "${hooks[i].text}"`);
}
meta.hooks = hooks.length;

await p.setViewportSize({ width: 1080, height: 1920 });
if (lines.opening) {
  await shot(`<div class="o"><p>${esc(lines.opening)}</p></div>`, `${OUT}/opening.png`, openCss);
  const tall = await p.evaluate((max) => document.querySelector(".o p").getBoundingClientRect().height > max, OPEN_PX * OPEN_LH * 2 + 4);
  if (tall) warn.push(`the opening wraps past two lines: "${lines.opening}"`);
} else warn.push("lines.json has no opening line");
await shot(`<div class="v"><div class="t">${tag("#3fb950", 84)}<span>${esc(lines.title)}</span></div>
  <div class="s"><span>${esc(lines.subtitle || "")}</span></div></div>`, `${OUT}/version.png`, versionCss);
// device tags for the two-screen hooks
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
console.log(`cards ok: opening, ${meta.hooks} hooks, version`);
