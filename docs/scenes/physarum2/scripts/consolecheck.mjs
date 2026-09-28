// Opens artifacts/strain-console.html headless, samples the live headcount
// split (window.strainConsole) over time, then pins Switching to 0 and checks
// the split stops moving; screenshots the page at the end.
//   node consolecheck.mjs <out.png> [--seconds 40]
const { chromium } = await import(new URL("../../../../node_modules/playwright/index.mjs", import.meta.url));

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith("--")) ?? "console.png";
const i = args.indexOf("--seconds");
const seconds = i >= 0 ? Number(args[i + 1]) : 40;
const page_ = new URL("../artifacts/strain-console.html", import.meta.url).href;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(page_);
await page.waitForFunction(() => window.strainConsole);
const fmt = (s) => s.map((x) => Math.round(x * 100)).join("/");
for (let t = 0; t < seconds; t += 5) {
  await page.waitForTimeout(5000);
  console.log(`t=${t + 5}s`, fmt(await page.evaluate(() => window.strainConsole.shares())));
}
await page.evaluate(() => window.strainConsole.setSwitching(0));
const a = await page.evaluate(() => window.strainConsole.shares());
await page.waitForTimeout(5000);
const b = await page.evaluate(() => window.strainConsole.shares());
console.log("switching 0:", fmt(a), "->", fmt(b), a.every((x, k) => x === b[k]) ? "(frozen)" : "(MOVED)");
await page.evaluate(() => window.strainConsole.setSwitching(0.4));
await page.hover("#shareRow");
await page.waitForTimeout(400);
await page.screenshot({ path: out });
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
