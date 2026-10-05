// The renderer main thread's own time, from a Chrome trace: what a CPU
// profile lumps into "(program)" — forced style and layout
// (Blink.ForcedStyleAndLayout), the frame's own style/layout/paint — next to
// the rAF callback. Panel open with Panel blur on, optionally scrolled to a
// card. The 2026-10-04 Measurements' "84% → 60% busy" came from here.
//
// node paneltrace.mjs [--port 5402] [--card <title prefix>] [--seconds 5]
// Writes trace-<port>.json beside the current directory.
const { chromium } = await import(new URL("../../../../../node_modules/playwright/index.mjs", import.meta.url));
const { readFileSync } = await import("node:fs");

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = arg("--port", "5402");
const card = arg("--card", null);
const seconds = Number(arg("--seconds", "5"));

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1456, height: 902 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("vibe.panelBlur", "1"));
const page = await ctx.newPage();
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=124&quality=high#/v/physarum2`);
await page.waitForTimeout(7000);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(2500);
if (card) {
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll(".vc-card")].find((e) => e.querySelector(".vc-card-head")?.textContent?.trim().startsWith(name));
    el?.scrollIntoView({ block: "start" });
  }, card);
  await page.waitForTimeout(1500);
}
const path = `trace-${port}.json`;
await browser.startTracing(page, { path, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "blink", "v8"] });
await page.waitForTimeout(seconds * 1000);
await browser.stopTracing();
await browser.close();

const trace = JSON.parse(readFileSync(path, "utf8"));
const events = trace.traceEvents ?? trace;
const mainThreads = new Set(events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
const byName = new Map();
let t0 = Infinity;
let t1 = -Infinity;
for (const e of events) {
  if (e.ph !== "X" || !mainThreads.has(`${e.pid}:${e.tid}`)) continue;
  t0 = Math.min(t0, e.ts);
  t1 = Math.max(t1, e.ts + (e.dur ?? 0));
  byName.set(e.name, (byName.get(e.name) ?? 0) + (e.dur ?? 0));
}
const wall = (t1 - t0) / 1000;
console.log(`port ${port} ${card ? "@" + card : "top"}: ${wall.toFixed(0)} ms traced (RunTask = busy; events nest, so shares overlap)`);
for (const [k, us] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  console.log(`${(us / 1000).toFixed(0).padStart(7)} ms ${((us / 1000 / wall) * 100).toFixed(1).padStart(5)}%  ${k}`);
}
