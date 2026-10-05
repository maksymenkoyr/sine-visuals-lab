// The auto/manual sign-off from docs/adding-a-scene.md for Chaikin Curves:
// prints every setting's probe mode and value with the dev auto-pin cleared
// (all should read "manual" at their defaults), then with every setting
// switched to auto in vibe.sceneAuto — the store the device menu's Auto
// chips write (the weighted ones should read "auto" and move with the
// music; the rest stay "manual").
//
//   node docs/scenes/chaikin/scripts/probe-auto.mjs [--port 5173] [--bpm 124]
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const port = opt("port", "5173");
const bpm = opt("bpm", "124");
const scene = "chaikin";

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 800, height: 600 } });
const page = await ctx.newPage();
const open = async () => {
  await page.waitForFunction(() => window.__viz && window.__viz.probe, null, { timeout: 30000 });
  await page.evaluate((sc) => window.__viz.setParams({ scene: sc, autoPin: false, settings: {} }), scene);
};
const read = () =>
  page.evaluate(() =>
    Object.fromEntries(Object.entries(window.__viz.probe().settings).map(([k, v]) => [k, `${v.mode} ${v.resolved.toFixed(3)}`])),
  );

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/${scene}`);
await open();
await page.waitForTimeout(1500);
console.log("auto off:", JSON.stringify(await read(), null, 1));

const keys = await page.evaluate(() => Object.keys(window.__viz.probe().settings));
await page.evaluate(
  ([sc, ks]) => localStorage.setItem("vibe.sceneAuto", JSON.stringify({ [sc]: Object.fromEntries(ks.map((k) => [k, true])) })),
  [scene, keys],
);
await page.reload();
await open();
await page.waitForTimeout(6000);
console.log("auto on:", JSON.stringify(await read(), null, 1));
await browser.close();
