// Contact sheet: one tiled PNG of N frames over time, via
// window.__viz.capture() (src/tuning/capture.ts). Same primitive the Alt+M
// mark hotkey uses, just driven headlessly with more frames.
//
//   node tools/tune-sheet.mjs <url> <outPath> [--frames N] [--every MS] [--settle MS]
import { chromium } from "playwright";
import fs from "node:fs";

const args = process.argv.slice(2);
const [url, outPath] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const frames = flag("--frames", 9);
const every = flag("--every", 400);
const settle = flag("--settle", 3000);

if (!url || !outPath) {
  console.error("usage: node tools/tune-sheet.mjs <url> <outPath> [--frames N] [--every MS] [--settle MS]");
  process.exit(1);
}

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
  viewport: { width: 1280, height: 800 },
  permissions: ["microphone"],
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.mouse.click(640, 400);
} catch {}
await page.waitForTimeout(settle);

await page.waitForFunction(() => typeof window.__viz?.capture === "function", { timeout: 10000 });
const dataUrl = await page.evaluate(
  ([frames, every]) => window.__viz.capture({ frames, intervalMs: every }),
  [frames, every],
);

const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
fs.writeFileSync(outPath, Buffer.from(base64, "base64"));
console.log("wrote", outPath);

await browser.close();
