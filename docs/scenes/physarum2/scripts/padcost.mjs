// Frame-time budget for the Pairs pads (src/ui/widgets/pairPads.ts) — same
// method as the physarum2 record's own Phase 3 measurement (itemBoxes.ts's
// specimen-box previews): mean/median/p95 over 480 rAF frames at
// ?quality=low, panel closed vs the Scene card open and scrolled to the
// pads (all six stepping), both plain and under CDP 4x CPU throttling (a
// phone stand-in). Budget: <= +1 ms mean unthrottled.
//
// Under 4x throttle, closed-vs-open-at-pads alone overstates the pads' own
// cost: opening the device menu AT ALL (nothing Physarum2-specific even on
// screen) already costs several ms under 4x throttle — a pre-existing,
// scene-independent characteristic of the panel, out of this scene's scope.
// This script adds a control, "open @ boxes (no pads)" (the Strains
// specimen boxes visible and stepping, same as before this widget existed),
// so the reported "delta vs open@boxes" isolates what the Pairs pads
// themselves add on top of that baseline — that number is what the plan's
// ~4 ms p95-growth fallback (step pads every third tick, or cut agents to
// 1000) actually gates.
//   node padcost.mjs --port 5342 [--frames 480]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5342");
const frames = parseInt(opt("--frames", "480"), 10);

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: [
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120&quality=low#/v/physarum2`);
await page.waitForTimeout(1500);

// menuBtn TOGGLES — every open/close helper checks aria-pressed first so two
// calls in a row (open @ boxes, then open @ pairs, with no close between)
// don't cancel each other out.
async function ensurePanelOpen() {
  const open = await page.evaluate(() => document.getElementById("menuBtn")?.getAttribute("aria-pressed") === "true");
  if (!open) {
    await page.evaluate(() => document.getElementById("menuBtn")?.click());
    await page.waitForTimeout(500);
  }
}

async function openPanelAtPairs() {
  await ensurePanelOpen();
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("div")];
    const heading = els.find((e) => e.textContent?.trim() === "Affinity" && e.children.length === 0);
    heading?.scrollIntoView({ block: "start" });
  });
  await page.waitForTimeout(300);
}

// Control: the panel open at the Strains boxes (Scene card head) — no Pairs
// pad is on screen or stepping, but the specimen boxes' own previews are —
// isolates "cost of opening the panel at all" from "cost the Pairs pads add
// on top of that", since the two turned out to be easy to conflate under
// throttling (see the header comment/Measurements).
async function openPanelAtBoxes() {
  await ensurePanelOpen();
  await page.evaluate(() => {
    document.querySelectorAll(".vc-card-head").forEach((h) => {
      if (h.textContent?.includes("Scene")) h.scrollIntoView({ block: "start" });
    });
  });
  await page.waitForTimeout(300);
}

async function closePanel() {
  // The controls column stays in the DOM either way (deviceMenu.ts toggles
  // a `vc-open` class on its root, not the column's presence) — menuBtn's
  // own aria-pressed mirrors open()/close() exactly.
  const menuOpen = await page.evaluate(() => document.getElementById("menuBtn")?.getAttribute("aria-pressed") === "true");
  if (menuOpen) {
    await page.evaluate(() => document.getElementById("menuBtn")?.click());
    await page.waitForTimeout(300);
  }
}

async function measure(n) {
  return page.evaluate(async (count) => {
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      let i = 0;
      const step = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        i++;
        if (i < count) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    times.shift(); // first delta is since an arbitrary earlier point
    const sorted = [...times].sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return { mean, median, p95 };
  }, n);
}

function fmt(r) {
  return `mean=${r.mean.toFixed(2)}ms median=${r.median.toFixed(2)}ms p95=${r.p95.toFixed(2)}ms`;
}

// --- Unthrottled ---
await closePanel();
await page.waitForTimeout(500);
const closedPlain = await measure(frames);
console.log("closed, plain:       ", fmt(closedPlain));

await openPanelAtPairs();
await page.waitForTimeout(3000); // let all six pads' cultures start stepping
const openPlain = await measure(frames);
console.log("open @ pairs, plain: ", fmt(openPlain));
console.log(`  delta mean: ${(openPlain.mean - closedPlain.mean).toFixed(2)} ms (budget: <= 1.00 ms)`);

// --- 4x CPU throttled (a phone stand-in) ---
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await closePanel();
await page.waitForTimeout(500);
const closedThrottled = await measure(frames);
console.log("closed, 4x throttle:      ", fmt(closedThrottled));

await openPanelAtBoxes();
await page.waitForTimeout(1500);
const openBoxesThrottled = await measure(frames);
console.log("open @ boxes (no pads), 4x:", fmt(openBoxesThrottled));
console.log(`  delta mean vs closed: ${(openBoxesThrottled.mean - closedThrottled.mean).toFixed(2)} ms (pre-existing: opening the panel at all under 4x throttle)`);

await openPanelAtPairs();
await page.waitForTimeout(3000);
const openThrottled = await measure(frames);
console.log("open @ pairs, 4x:          ", fmt(openThrottled));
console.log(`  delta mean vs closed:      ${(openThrottled.mean - closedThrottled.mean).toFixed(2)} ms`);
console.log(`  delta mean vs open@boxes:  ${(openThrottled.mean - openBoxesThrottled.mean).toFixed(2)} ms (the Pairs pads' OWN marginal cost)`);
console.log(`  delta p95 vs open@boxes:   ${(openThrottled.p95 - openBoxesThrottled.p95).toFixed(2)} ms (fallback trigger: > ~4 ms)`);

await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
await browser.close();
