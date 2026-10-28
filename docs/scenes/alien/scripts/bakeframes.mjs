// node bakeframes.mjs <outDir> [--port P] [--w 1920 --h 1080] [--frames "0:0.25,1:0.5"] [--query extra]
// Saves __bake.frame(loop, phase) as <outDir>/loop<n>-<phase>.png from the bake
// page (tools/alien-bake/index.html): the scene's own renderer at a fixed
// moment of each loop, so two builds served side by side can be compared
// picture for picture.
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5431");
const w = Number(opt("w", "1920"));
const h = Number(opt("h", "1080"));
const extra = opt("query", "");
const frames = opt("frames", "0:0.1,0:0.35,0:0.6,0:0.85,1:0.1,1:0.35,1:0.6,1:0.85,2:0.1,2:0.35,2:0.6,2:0.85")
  .split(",")
  .map((s) => s.split(":").map(Number));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 800, height: 600 } })).newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`https://localhost:${port}/tools/alien-bake/index.html?w=${w}&h=${h}${extra ? `&${extra}` : ""}`);
const info = await page.evaluate(async () => {
  const r = await window.__bake.ready;
  return r;
});
console.log(JSON.stringify(info));
for (const [loop, phase] of frames) {
  const url = await page.evaluate(([l, p]) => window.__bake.frame(l, p), [loop, phase]);
  const file = `${out}/loop${loop}-${phase.toFixed(3)}.png`;
  writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log(file);
}
console.log(errors.slice(0, 10).join("\n"));
await browser.close();
