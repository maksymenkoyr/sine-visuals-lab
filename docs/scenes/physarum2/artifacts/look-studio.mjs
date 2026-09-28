// Screenshots one of this folder's self-contained prototype pages
// (affinity-studio.html or strain-console.html) the way the artifact viewer
// shows it: wraps the file in a doctype/viewport skeleton, loads it headless
// with the GPU on, prints page errors and the phone-width scroll width, and
// saves a full desktop shot plus a 400 px phone shot.
//
//   node look-studio.mjs --page affinity-studio.html --out /path/to/tmp
//   node look-studio.mjs --page strain-console.html --out /path/to/tmp
import { readFile, writeFile } from "node:fs/promises";

const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const pageFile = opt("--page", "strain-console.html");
const out = opt("--out", ".");
const name = pageFile.replace(/\.html$/, "");

const body = await readFile(new URL(pageFile, import.meta.url), "utf8");
const wrapped = `${out}/${name}.wrapped.html`;
await writeFile(
  wrapped,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`,
);

const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1360, height: 1150 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto("file://" + wrapped);
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}/look-${name}-wide.png`, fullPage: true });
await p.setViewportSize({ width: 400, height: 900 });
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/look-${name}-phone.png` });
const sw = await p.evaluate(() => document.documentElement.scrollWidth);
console.log("errors:", JSON.stringify(errs), "phone scrollWidth:", sw);
await b.close();
