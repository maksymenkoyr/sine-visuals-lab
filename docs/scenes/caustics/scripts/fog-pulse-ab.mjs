// Fog pulse A/B: scores ridge sharpness of beat-shot PNGs, so "a beat hazes
// instead of snapping crisp" is a number, not an impression. Sharpness =
// mean |Laplacian| of luminance (high-frequency energy) — thinner, crisper
// ridges score higher; a hazy frame scores lower.
// usage: node fog-pulse-ab.mjs <beforeDir> <afterDir>
//   (capture the frames first with _shared/scripts/beatshot.mjs, e.g.
//    node .../beatshot.mjs OUT/before --port P --scene caustics --beats 3
//      --delays 0,120 --settings '{"fog":0.57,"focus":0.86,"flash":0,"drift":0,"ripple":0,"sparkle":0}')
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error("usage: node fog-pulse-ab.mjs <beforeDir> <afterDir>");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();

async function sharpness(file) {
  const b64 = readFileSync(file).toString("base64");
  return page.evaluate(async (b) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = Math.round((img.height / img.width) * 480);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const w = c.width, h = c.height;
    const lum = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    };
    let s = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const l = 4 * lum(x, y) - lum(x - 1, y) - lum(x + 1, y) - lum(x, y - 1) - lum(x, y + 1);
        s += Math.abs(l);
        n++;
      }
    }
    return s / n;
  }, b64);
}

const score = async (dir, prefix) => {
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).sort();
  const out = {};
  for (const f of files) out[f] = await sharpness(join(dir, f));
  return out;
};

const before = await score(beforeDir, "before-");
const after = await score(afterDir, "after-");
for (const [f, v] of Object.entries(before)) console.log("before", f, v.toFixed(3));
for (const [f, v] of Object.entries(after)) console.log("after ", f, v.toFixed(3));

const at = (o, delay) =>
  Object.entries(o).filter(([f]) => f.endsWith(`-${delay}.png`)).map(([, v]) => v);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
for (const delay of [0, 120]) {
  const b = mean(at(before, delay));
  const a = mean(at(after, delay));
  console.log(
    `delay ${delay}ms  before ${b.toFixed(3)}  after ${a.toFixed(3)}  (${(((a - b) / b) * 100).toFixed(1)}%)`,
  );
}
await browser.close();