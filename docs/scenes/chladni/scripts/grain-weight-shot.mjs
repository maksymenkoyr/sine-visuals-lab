// Chladni Grain weight / Size mix — headless shots of each bed after it sorts.
// usage: node docs/scenes/chladni/scripts/grain-weight-shot.mjs <baseUrl> <outDir> <label>
//          [--variants '{"name":{"grainWeight":0,"sizeMix":0},…}'] [--settle MS] [--square]
//
// Loads the scene with synthetic audio on the real (Metal) GPU so the sim runs
// at full frame rate, pins auto mode, then for each variant pushes its
// settings through window.__viz.setParams, waits for the bed to re-sort, and
// screenshots. On a checkout without the grainWeight/sizeMix settings the
// overrides are ignored and every shot is the unchanged default bed — the
// "before" side of the comparison. Run from a checkout so `playwright`
// resolves.
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [baseUrl, outDirArg, labelArg] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const outDir = outDirArg || tmpdir();
const label = labelArg || "weight";
const settleMs = Number(flag("--settle", "10000"));
const square = args.includes("--square");
const variants = JSON.parse(
  flag(
    "--variants",
    JSON.stringify({
      default: {},
      powder: { grainWeight: 0, sizeMix: 0 },
      grit: { grainWeight: 1, sizeMix: 0 },
      mixed: { grainWeight: 0.5, sizeMix: 1 },
    }),
  ),
);

if (!baseUrl) {
  console.error("usage: node grain-weight-shot.mjs <baseUrl> <outDir> <label> [--variants JSON] [--settle MS] [--square]");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}/?audio=synthetic&bpm=120#/v/chladni`;

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 720 },
  permissions: ["microphone"],
});
const page = await context.newPage();

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[page] ${String(e && e.stack ? e.stack : e)}`));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.mouse.click(640, 360);
} catch {}
await page.waitForFunction(() => typeof window.__viz?.setParams === "function", { timeout: 15000 });

for (const [name, settings] of Object.entries(variants)) {
  const all = { squarePlate: square ? 1 : 0, ...settings };
  await page.evaluate((s) => window.__viz.setParams({ scene: "chladni", autoPin: true, settings: s }), all);
  await page.waitForTimeout(settleMs);
  const path = `${outDir}/${label}-${name}.png`;
  await page.screenshot({ path });
  const scene = await page.evaluate(() => window.__viz.probe?.()?.scene ?? location.hash);
  console.log("shot:", path, "scene:", typeof scene === "string" ? scene : JSON.stringify(scene));
}

console.log("url:", url);
console.log(errors.filter((e) => !e.includes("8787")).join("\n") || "(no errors)");
await browser.close();
