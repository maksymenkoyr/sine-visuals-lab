// Screenshots a scene at fixed wall-clock offsets after load (steady-state
// look, not beat-synced) — or, with --gallery, opens the gallery root and
// scrolls to a tile. Scene-agnostic via --scene, though the --gallery tile
// search text is hardcoded below (it was written for the Kaleidoscope
// gallery card) and will need updating for another scene.
// Rescued from a working session on 2026-09-04.
// usage: node steady.mjs <outPrefix> [--port P] [--bpm N] [--quality Q] [--scene S] [--at 8,20,30] [--gallery]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5210");
const bpm = opt("--bpm", "124");
const quality = opt("--quality", "high");
const scene = opt("--scene", "powder");
const ats = opt("--at", "8,20").split(",").map(Number);
const gallery = args.includes("--gallery");
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 2000)));
page.on("console", (m) => { if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 600)); });
const hash = gallery ? "" : `#/v/${scene}`;
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}&quality=${quality}${hash}`, { waitUntil: "load" });
const t0 = Date.now();
if (gallery) {
  await page.waitForTimeout(1500);
  // Expand the draft fold if present so the new tile renders.
  await page.evaluate(() => { const b = [...document.querySelectorAll("button, summary")].find((el) => /draft/i.test(el.textContent || "")); b?.click(); });
}
for (const at of ats) {
  await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
  if (gallery) await page.evaluate(() => { const el = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && n.textContent?.trim() === "Kaleidoscope"); el?.scrollIntoView({ block: "center" }); });
  if (gallery) await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-${at}s.png` });
  console.log(`shot at ${at}s`);
}
console.log(await page.evaluate(() => location.hash));
await browser.close();
console.log("STEADY_OK");
