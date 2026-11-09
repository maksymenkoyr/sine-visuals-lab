// Auto sign-off (docs/adding-a-scene.md): every Plasma setting probes
// "manual" on a fresh profile, and after Auto is switched on every one with
// an auto table probes "auto" while the rest stay "manual". Two runs on
// synthetic audio with the dev auto-pin cleared; the second switches Auto on
// for every key the first run saw, and the probe itself only reports "auto"
// where the card gives the setting an auto table.
//   node automodes.mjs --repo DIR --port P [--scene plasma]
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const repo = opt("--repo", process.cwd());
const port = opt("--port", "5173");
const scene = opt("--scene", "plasma");
const { chromium } = await import(pathToFileURL(`${repo}/node_modules/playwright/index.mjs`).href);

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});

async function run(label, autoKeys) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
  if (autoKeys) {
    await ctx.addInitScript(
      ([sc, keys]) => {
        const on = {};
        for (const k of keys) on[k] = true;
        localStorage.setItem("vibe.sceneAuto", JSON.stringify({ [sc]: on }));
      },
      [scene, autoKeys],
    );
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 300)));
  await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124#/v/${scene}`, { waitUntil: "load" });
  // The dev tuning bus's startup fetch clears overrides; wait it out first.
  await page.waitForTimeout(1800);
  await page.evaluate((sc) => window.__viz.setParams({ scene: sc, autoPin: false, settings: {} }), scene);
  await page.waitForTimeout(4000);
  const probe = await page.evaluate(() => window.__viz.probe());
  const vals = probe.settings ?? {};
  console.log(`-- ${label} (scene ${probe.scene})`);
  for (const [k, v] of Object.entries(vals)) {
    console.log(`  ${k.padEnd(8)} ${v.mode.padEnd(7)} base ${(+v.base).toFixed(3)} resolved ${(+v.resolved).toFixed(3)}`);
  }
  await ctx.close();
  return Object.keys(vals);
}

const keys = await run("fresh profile", null);
await run("Auto switched on", keys);
await browser.close();
