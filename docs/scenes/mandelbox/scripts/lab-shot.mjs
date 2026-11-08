// Shoot the Mandelbox lab page (mbx-lab.html beside this script, through the dev server) for a list of places.
// usage: node lab-shot.mjs <port> <outdir> '<json list of {name, ...lab.show args}>'
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [port, out, listJson] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`https://localhost:${port}/docs/scenes/mandelbox/scripts/mbx-lab.html`);
await page.waitForFunction(() => window.labReady || document.title.startsWith("COMPILE"), null, { timeout: 30000 });
const title = await page.title();
if (title.startsWith("COMPILE")) { console.log(title); process.exit(1); }
for (const s of JSON.parse(listJson)) {
  const info = await page.evaluate((s) => window.lab.show(s), s);
  await page.locator("#c").screenshot({ path: join(out, `${s.name}.png`) });
  console.log(s.name, JSON.stringify(info));
}
await browser.close();
