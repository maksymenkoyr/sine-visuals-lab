// node loopframes.mjs <outDir> <port> <firstLoop> <lastLoop> <framesPerLoop> <w> <h>
// One full loop of each loop in the range from the bake page
// (tools/alien-bake/index.html), as <outDir>/loop<n>/f<k>.png, plus
// <outDir>/info.json (each loop's clip and captured seconds). loopwebp.py
// turns them into the review page's animations.
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const [out, port, first, last, n, w, h] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 800, height: 600 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`https://localhost:${port}/tools/alien-bake/index.html?w=${w}&h=${h}`);
const info = await page.evaluate(() => window.__bake.ready);
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/info.json`, JSON.stringify(info));
for (let l = Number(first); l <= Number(last); l++) {
  mkdirSync(`${out}/loop${l}`, { recursive: true });
  for (let k = 0; k < Number(n); k++) {
    const url = await page.evaluate(([a, b]) => window.__bake.frame(a, b), [l, k / Number(n)]);
    writeFileSync(`${out}/loop${l}/f${String(k).padStart(3, "0")}.png`, Buffer.from(url.split(",")[1], "base64"));
  }
  console.log("loop", l, info.loops[l].clip);
}
await browser.close();
