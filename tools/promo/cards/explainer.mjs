// The explainer's text (cards.mjs dispatches here; /video-explainer approved this look): the showcase's
// caption overlays (transparent full-frame PNGs) and its opaque end card.
//
//   node tools/promo/cards.mjs --work <work> --video explainer
//
// Input: <work>/showcase.json "captions" (items: id, big, small, pos per format; cards: end). Output:
// <work>/caps/<id>-<v|h>.png for each caption and end-<fmt>.png. edit.py overlays the
// captions (timing is in the same config) and ends on the end card. These are renders of text, but
// they are still media: they live in the work dir, never in the repo.
//
// The font is the system font (SF Pro on macOS): the Chakra Petch / Share Tech Mono of the app's own
// look was disliked for the promo text. Caption boxes are dark translucent so they read over any scene.
// pos names where the block sits: "low" lower third, "lowerhalf" centred in the bottom half, "lowright" /
// "lowleft" / "topright" a corner, "top" / "toptight" near the top edge.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Renders the captions for the work dir; the lines are the whole body below, unindented to stay byte for byte.
export async function render(work) {
const cfg = JSON.parse(readFileSync(`${work}/showcase.json`, "utf8"));
const OUT = join(work, "caps") + "/";
mkdirSync(OUT, { recursive: true });

const SANS = `"SF Pro Display", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;
const CAPS = cfg.captions.items;
const END = cfg.captions.cards.end;
const LOGO = `file://${join(REPO, END.logo)}`;

const load = async (page, html) => { const f = OUT + "_tmp.html"; writeFileSync(f, "<!doctype html><meta charset=utf-8>" + html); await page.goto("file://" + f); };

const css = (W, H) => `
html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
.box{position:absolute;left:0;right:0;text-align:center;color:#fff;font-family:${SANS};font-weight:700}
.inner{display:inline-block;background:rgba(0,0,0,.55);padding:${W < H ? "22px 34px" : "16px 30px"};border-radius:6px;backdrop-filter:blur(6px)}
.big{font-size:${W < H ? 84 : 72}px;line-height:1.05;letter-spacing:-.01em;
  text-shadow:0 0 28px rgba(0,0,0,.85),0 2px 6px rgba(0,0,0,.9)}
.small{font-weight:500;font-size:${W < H ? 36 : 30}px;margin-top:14px;letter-spacing:0;color:#ff5a4d;
  text-shadow:0 0 16px rgba(0,0,0,.9)}
`;

function pos(p, W, H) {
  if (p === "toptight") return `top:${Math.round(H * 0.03)}px`;
  if (p === "top") return `top:${Math.round(H * 0.16)}px`;
  if (p === "lowerhalf") return `top:${Math.round(H * 0.66)}px`;
  if (p === "topright") return `top:${Math.round(H * 0.05)}px;right:${Math.round(W * 0.03)}px;left:auto;text-align:right`;
  if (p === "lowright") return `bottom:${Math.round(H * 0.1)}px;right:${Math.round(W * 0.03)}px;left:auto;text-align:right`;
  if (p === "lowleft") return `bottom:${Math.round(H * 0.1)}px;left:${Math.round(W * 0.03)}px;right:auto;text-align:left;width:${Math.round(W * 0.42)}px`;
  return `bottom:${Math.round(H * 0.12)}px`;
}

const browser = await chromium.launch();
for (const [fmt, W, H] of [["v", 1080, 1920], ["h", 1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const c of CAPS) {
    const p = c.pos[fmt];
    await load(page, `<style>${css(W, H)}</style><div class="box" style="${pos(p, W, H)}">
      <div class="inner"><div class="big">${c.big}</div>${c.small ? `<div class="small">${c.small}</div>` : ""}</div></div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}${c.id}-${fmt}.png`, omitBackground: true });
  }
  // End card: opaque, logo + url
  const L = W < H ? 560 : 420;
  await load(page, `<style>${css(W, H)} body{background:#000}
    .end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${W < H ? 56 : 40}px}
    .url{font-family:${SANS};font-weight:700;color:#fff;font-size:${W < H ? 68 : 58}px}
    .tag{font-family:${SANS};font-weight:500;color:#ff5a4d;font-size:${W < H ? 36 : 30}px}</style>
    <div class="end"><img src="${LOGO}" width="${L}" height="${L}"><div class="url">${END.url}</div>
    <div class="tag">${END.tag}</div></div>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}end-${fmt}.png` });
}
await browser.close();
console.log("captions ->", OUT);
}
