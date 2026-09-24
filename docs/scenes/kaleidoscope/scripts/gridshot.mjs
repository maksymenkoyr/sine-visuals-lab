// Kaleidoscope: opens the scene with the panel, clicks a Beat grid chip,
// screenshots the Rhythm card, and prints the probe for a few seconds (to
// check beat=1(grid) lines land where expected).
// Rescued from a working session on 2026-09-04.
// usage: node gridshot.mjs <outPrefix> [--port P] [--scene S] [--bpm N] [--grid IDX]
// May need adjusting to current code.
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = opt("--port", "5197");
const scene = opt("--scene", "kaleidoscope");
const bpm = opt("--bpm", "124");
const grid = +opt("--grid", "4");
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/${scene}`, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(600);
const clicked = await page.evaluate((g) => {
  const strip = document.querySelector('.vc-picker[aria-label="Beat grid"]');
  if (!strip) return "no Beat grid strip";
  strip.children[g]?.click();
  strip.closest(".vc-row")?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
  return `clicked chip ${g}: ${strip.children[g]?.textContent}`;
}, grid);
console.log(clicked);
await page.waitForTimeout(1500);
// Probe a few times to catch grid-fired beats.
let gridBeats = 0, rawBeats = 0;
for (let i = 0; i < 240; i++) {
  const p = await page.evaluate(() => { const s = window.__viz?.probe(); return s ? { fired: s.beat.fired, onGrid: s.beat.onGrid } : null; });
  if (p?.fired) { if (p.onGrid) gridBeats++; else rawBeats++; }
  await page.waitForTimeout(16);
}
console.log(`probe: fired on grid ${gridBeats}, raw ${rawBeats}`);
console.log(await page.evaluate(() => window.__viz?.probeText?.().split("\n").slice(0, 3).join("\n")));
// Rhythm card screenshot: locate by its title.
const card = await page.evaluateHandle(() => [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && n.textContent?.trim() === "Rhythm")?.closest(".vc-card") ?? document.body);
const box = await card.boundingBox();
await page.screenshot({ path: `${out}-rhythm.png`, clip: box ? { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: Math.min(box.height + 8, 720 - box.y) } : undefined });
await page.screenshot({ path: `${out}-full.png` });
await browser.close();
console.log("GRIDSHOT_OK");
