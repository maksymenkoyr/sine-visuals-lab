// Prints each cloud setting's probe mode/value on synthetic audio, with Auto
// off (fresh store) and with every auto-weighted key switched on.
//   node modes.mjs <port>
import { chromium } from "playwright";

const port = process.argv[2];
const AUTO_KEYS = ["scale", "warp", "filaments", "churn", "surge", "glow", "flare"];

async function run(bpm, seedAuto) {
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required",
      "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 960, height: 540 } });
  if (seedAuto) {
    await ctx.addInitScript((keys) => {
      localStorage.setItem("vibe.sceneAuto", JSON.stringify({ cloud: Object.fromEntries(keys.map((k) => [k, true])) }));
    }, AUTO_KEYS);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/cloud`);
  await page.waitForFunction(() => window.__viz?.probe, null, { timeout: 20000 });
  await page.evaluate(() => window.__viz.setParams({ scene: "cloud", autoPin: false, settings: {} }));
  await page.waitForTimeout(8000);
  const p = await page.evaluate(() => window.__viz.probe());
  const s = p.settings ?? p.scene?.settings ?? {};
  const row = Object.entries(s).map(([k, v]) => `${k}=${v.mode}:${Number(v.resolved).toFixed(2)}`).join(" ");
  console.log(`bpm ${bpm} auto ${seedAuto ? "on " : "off"} scene=${p.scene?.id ?? p.sceneId ?? "?"} | ${row}`);
  const real = errors.filter((e) => !e.includes("8787") && !e.includes("ERR_CONNECTION_REFUSED"));
  if (real.length) console.log("  console errors:", real.slice(0, 3).join(" / "));
  await browser.close();
}

for (const bpm of [100, 140]) {
  await run(bpm, false);
  await run(bpm, true);
}
