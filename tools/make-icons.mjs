// Renders the site's icon set from the real brand mark (src/ui/brandMark.ts),
// so the favicon is the same typeset SINE/VISUALS/LAB square the gallery
// masthead shows, in the actual Shippori Mincho face — a hand-drawn SVG could
// never match the DOM mark's letterforms, and Google's favicon rules don't
// accept SVG at all (BMP/GIF/ICO/PNG/JPEG/PPM/TIFF only), so everything here
// rasterizes to PNG. The ICO keeps a 192px frame as its largest: Google wants
// >48px to look right on search results, browsers asking for /favicon.ico get
// the same mark.
//
//   node tools/make-icons.mjs        # writes public/icon-*.png, -apple-touch-icon, favicon.ico
//
// Runs a throwaway Vite dev server (configFile: false — the app's plugins are
// irrelevant here and the app itself is route-blocked below), imports the mark
// module through it, and element-screenshots it at each size. Re-run after any
// change to the mark's design; the outputs are committed because dist/ is
// built fresh in CI and nothing regenerates them there.
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = path.join(root, "public");
fs.mkdirSync(outDir, { recursive: true });

const PORT = 5199;

const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { port: PORT, strictPort: true },
});
await server.listen();
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const context = await browser.newContext({
  viewport: { width: 600, height: 600 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
// The page is only a host for the mark module — keep the visualizer itself
// out of the way (its canvas, prompts and HUD would otherwise boot beside it).
await page.route("**/src/app.ts", (route) => route.abort());
await page.goto(`${base}/`, { waitUntil: "load" });

const render = async (size) => {
  await page.evaluate(async (s) => {
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    const { createBrandMark } = await import("/src/ui/brandMark.ts");
    const mark = createBrandMark(s);
    mark.style.position = "fixed";
    mark.style.left = "0";
    mark.style.top = "0";
    document.body.appendChild(mark);
    await document.fonts.load('800 22px "Shippori Mincho B1"');
    await document.fonts.ready;
  }, size);
  // One paint past fonts.ready: the face is loaded but may not be applied yet.
  await page.waitForTimeout(150);
  const png = await page.locator("body > div").first().screenshot({ type: "png" });
  return png;
};

/** ICO container around PNG frames (PNG-in-ICO is what every current
 *  consumer expects; the directory entries just point at the PNG blobs). */
function makeIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const o = 6 + 16 * i;
    header.writeUInt8(w >= 256 ? 0 : w, o);
    header.writeUInt8(h >= 256 ? 0 : h, o + 1);
    header.writeUInt8(0, o + 2); // palette colors
    header.writeUInt8(0, o + 3); // reserved
    header.writeUInt16LE(1, o + 4); // color planes
    header.writeUInt16LE(32, o + 6); // bits per pixel
    header.writeUInt32LE(png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

const files = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "apple-touch-icon.png"],
];
const bySize = new Map();
for (const [size, name] of files) {
  const png = await render(size);
  fs.writeFileSync(path.join(outDir, name), png);
  bySize.set(size, png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} B)`);
}
// ICO frames, largest first: 192 (Google's >48px preference), then the
// classic small sizes browsers request when the link tag is ignored.
const icoSizes = [192, 48, 32, 16];
const frames = [];
for (const size of icoSizes) {
  frames.push(bySize.get(size) ?? (await render(size)));
}
const ico = makeIco(frames);
fs.writeFileSync(path.join(outDir, "favicon.ico"), ico);
console.log(`wrote public/favicon.ico (frames ${icoSizes.join(", ")}, ${ico.length} B)`);

await browser.close();
await server.close();
