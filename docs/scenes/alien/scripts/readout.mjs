// node readout.mjs <wav> <outPrefix> --port P [--at 12,34]
// Fake mic plays <wav>; opens the panel and reads the Move readout (text + a
// shot of it) at each listed second after the mic opens.
import { launchWithMic } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const [wav, out] = args;
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5361");
const at = opt("at", "12,34").split(",").map(Number);

const { browser, ctx } = await launchWithMic(wav, { width: 1512, height: 945 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(`https://localhost:${port}/?quality=high&loop=0#/v/alien`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.mouse.click(756, 470);
await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
const t0 = Date.now();
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector("#menuBtn")?.click());
await page.waitForTimeout(1500);
for (const s of at) {
  const wait = s * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const box = await page.evaluateHandle(() => {
    const span = [...document.querySelectorAll("span")].find((e) => /^speed \d/.test(e.textContent ?? ""));
    return span?.parentElement?.parentElement ?? null;
  });
  const el = box.asElement();
  if (!el) {
    console.log(s, "no readout found");
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  const texts = [];
  for (let i = 0; i < 3; i++) {
    texts.push(await el.evaluate((e) => [...e.querySelectorAll("div")].map((d) => d.textContent).join(" | ")));
    await page.waitForTimeout(400);
  }
  await el.screenshot({ path: `${out}-${s}s.png` });
  console.log(s, JSON.stringify(texts));
}
await browser.close();
