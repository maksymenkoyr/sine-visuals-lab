// Chladni figure changes over time — a headless sequence of shots.
// usage: node docs/scenes/chladni/scripts/figure-sequence-shot.mjs <baseUrl> <outDir> <label> [--shots N] [--every MS] [--settle MS]
//        (set CHROMIUM_PATH to launch a browser other than Playwright's pinned one)
//
// Loads the scene with synthetic audio (so before/after runs are
// comparable), pins auto mode, lets the sand settle, then takes a shot every
// `--every` ms. Compare the sequences from two checkouts to see whether the
// plate moves between figures or sits on one.
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [baseUrl, outDirArg, labelArg] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const outDir = outDirArg || tmpdir();
const label = labelArg || "seq";
const shots = Number(flag("--shots", "6"));
const everyMs = Number(flag("--every", "1500"));
const settleMs = Number(flag("--settle", "6000"));

if (!baseUrl) {
  console.error("usage: node figure-sequence-shot.mjs <baseUrl> <outDir> <label> [--shots N] [--every MS] [--settle MS]");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/?audio=synthetic&bpm=120#/v/chladni`;
// CHROMIUM_PATH: a browser other than the one this Playwright version pins.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e && e.stack ? e.stack : e)));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.mouse.click(640, 360);
} catch {}
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 15000 });
await page.evaluate(() => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: {} }));
await page.waitForTimeout(settleMs);

for (let i = 0; i < shots; i++) {
  const path = `${outDir}/${label}-${i}.png`;
  await page.screenshot({ path });
  console.log("shot:", path);
  if (i < shots - 1) await page.waitForTimeout(everyMs);
}
console.log("url:", url);
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
