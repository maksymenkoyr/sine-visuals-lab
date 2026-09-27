// Chladni Sand amount — headless before/after shots.
// usage: node docs/scenes/chladni/scripts/sand-amount-shot.mjs <baseUrl> <outDir> <label> [--values 1,0.3,0] [--settle MS]
//
// Loads the scene with synthetic audio (so runs are comparable), pins auto
// mode so music-driven dials hold still, then screenshots once per Sand
// amount value pushed through window.__viz.setParams. On a checkout without
// the sandAmount setting the override is ignored and the shots are the
// unchanged default bed — that's the "before" side of the comparison.
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [baseUrl, outDirArg, labelArg] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const outDir = outDirArg || tmpdir();
const label = labelArg || "sand";
const values = flag("--values", "1,0.3,0").split(",").map(Number);
const settleMs = Number(flag("--settle", "6000"));

if (!baseUrl) {
  console.error(
    "usage: node sand-amount-shot.mjs <baseUrl> <outDir> <label> [--values 1,0.3,0] [--settle MS]",
  );
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/?audio=synthetic&bpm=120#/v/chladni`;

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 720 },
  permissions: ["microphone"],
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => pageErrors.push(String(e && e.stack ? e.stack : e)));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.mouse.click(640, 360);
} catch {}
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 15000 });

// Auto pinned + no other overrides: only sandAmount varies between shots.
await page.evaluate(() => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: {} }));
await page.waitForTimeout(settleMs);

const paths = [];
for (const value of values) {
  await page.evaluate(
    (v) => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: { sandAmount: v } }),
    value,
  );
  // Thinning is applied by the draw call on the next frame (the sim has
  // already stepped every grain), so a short wait is enough.
  await page.waitForTimeout(700);
  const path = `${outDir}/${label}-sand-${value}.png`;
  await page.screenshot({ path });
  paths.push(path);
  console.log("shot:", path);
}

console.log("url:", url);
console.log("--- console errors/warnings ---");
console.log(consoleErrors.join("\n") || "(none)");
console.log("--- page errors ---");
console.log(pageErrors.join("\n") || "(none)");

await browser.close();