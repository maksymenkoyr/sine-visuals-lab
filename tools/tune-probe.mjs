// Numeric-only read of a running visualization — the cheapest of the three
// tuning drivers. Opens the URL headless, waits for the render loop to
// settle, then prints window.__viz.probeText() (src/tuning/probe.ts).
//
//   node tools/tune-probe.mjs <url> [--settle MS]
//
// Typical use: point at a synthetic-audio URL so the numbers are
// reproducible run to run —
//   node tools/tune-probe.mjs "https://localhost:5173/?audio=synthetic&bpm=120#/v/mesh"
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [url] = args;
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const settle = flag("--settle", 3000);

if (!url) {
  console.error("usage: node tools/tune-probe.mjs <url> [--settle MS]");
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
  await page.mouse.click(640, 400); // first-gesture audio start, harmless if synthetic
} catch {}
await page.waitForTimeout(settle);

await page.waitForFunction(() => typeof window.__viz?.probeText === "function", { timeout: 10000 });
const text = await page.evaluate(() => window.__viz.probeText());
console.log(text);

await browser.close();
