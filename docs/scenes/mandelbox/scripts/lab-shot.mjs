// Shoot the Mandelbox lab page (mbx-lab.html beside this script, through the dev server) for a list of places.
// An item with `seq: [frames, fps]` shoots that many frames of its flight from `fly`, as <name>_<i>.png.
// usage: node lab-shot.mjs <port> <outdir> '<json list of {name, ...lab.show args}>' [page query, e.g. exact]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [port, out, listJson, query = ""] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`https://localhost:${port}/docs/scenes/mandelbox/scripts/mbx-lab.html${query ? `?${query}` : ""}`);
await page.waitForFunction(() => window.labReady || document.title.startsWith("COMPILE"), null, { timeout: 30000 });
const title = await page.title();
if (title.startsWith("COMPILE")) { console.log(title); process.exit(1); }
for (const s of JSON.parse(listJson)) {
  const [frames, fps] = s.seq ?? [1, 1];
  for (let i = 0; i < frames; i++) {
    const shot = { ...s, fly: (s.fly ?? 0) + i / fps };
    const info = await page.evaluate((a) => window.lab.show(a), shot);
    await page.locator("#c").screenshot({ path: join(out, s.seq ? `${s.name}_${String(i).padStart(4, "0")}.png` : `${s.name}.png`) });
    if (!s.seq || i === 0 || i === frames - 1) console.log(s.name, i, JSON.stringify(info));
  }
}
await browser.close();
