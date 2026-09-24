const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url).href);
const port = process.argv[2] ?? "5232";
const quality = process.argv[3] ?? "high";
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=${quality}#/v/pour`);
await page.waitForTimeout(8000);
for (let i = 0; i < 3; i++) {
  const line = await page.evaluate(() => window.__viz.probeText().split("\n")[0]);
  console.log(line);
  await page.waitForTimeout(2000);
}
await browser.close();
