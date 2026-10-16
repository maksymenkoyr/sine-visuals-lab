// Presses the Strains card's one Random (.vc-roll) several times with real
// presses and reads every Smell value back after each roll, then shoots the
// Affinity card. Prints, per roll, the four own trails and the twelve
// other-strain values, and a tally at the end: how many own trails came out
// negative, and where the other-strain values landed (below 0, the live
// 0…+1 band, above +1). Also prints the Pairs card's mix-row buttons.
// Used 2026-10-03 for "Random over the whole range" (record, Decisions).
//
//   node rollshot.mjs --port 5391 --out /path/to/prefix [--rolls 12]
//     <prefix>-card.png        the Affinity card before any roll
//     <prefix>-card-rolled.png the Affinity card after the last roll
//     <prefix>-scene.png       the whole window 8 s after the last roll
// From a worktree with no node_modules of its own, point PLAYWRIGHT at the
// main checkout's node_modules/playwright/index.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT ?? new URL("../../../../node_modules/playwright/index.mjs", import.meta.url).href);

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const port = opt("--port", "5391");
const out = opt("--out", "./rollshot");
const rolls = Number(opt("--rolls", "12"));

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("8787") && !/Failed to load resource.*403/.test(m.text())) errors.push(m.text());
});
await page.goto(`https://localhost:${port}/?audio=synthetic&bpm=120#/v/physarum2`);
await page.waitForTimeout(2000);
await page.evaluate(() => document.getElementById("menuBtn")?.click());
await page.waitForTimeout(800);

// The Pairs pads' own card — the widget card holding .vc-pair (the first
// .vc-widget-card is the Strain Console's).
async function card() {
  await page.evaluate(() => document.querySelector(".vc-pair")?.closest(".vc-widget-card")?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  return page.locator(".vc-widget-card", { has: page.locator(".vc-pair") }).first();
}

// A real press: down, hold, up — see the headless notes on panel clicks.
async function press(sel) {
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel);
  await page.waitForTimeout(250);
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`no ${sel}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function readSmell() {
  return page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("vibe.sceneSettings") || "{}").physarum2 ?? {};
    const t = [];
    for (let i = 0; i < 4; i++) {
      const row = [];
      for (let j = 0; j < 4; j++) row.push(store[`att${i}${j}`]);
      t.push(row);
    }
    return t;
  });
}

const mixButtons = await (await card()).locator(".vc-mix-row button").allTextContents();
console.log(`mix row: ${mixButtons.map((s) => s.trim()).join(" | ")}`);
await (await card()).screenshot({ path: `${out}-card.png` });

let ownNeg = 0;
let ownAll = 0;
const other = { neg: 0, live: 0, high: 0, all: 0 };
for (let r = 1; r <= rolls; r++) {
  await press(".vc-roll");
  const t = await readSmell();
  const own = t.map((row, i) => row[i]);
  const offs = [];
  t.forEach((row, i) => row.forEach((v, j) => { if (i !== j) offs.push(v); }));
  const fmt = (v) => (v === undefined ? "    -" : v.toFixed(2).padStart(5));
  for (const v of own) { if (v === undefined) continue; ownAll++; if (v < 0) ownNeg++; }
  for (const v of offs) { if (v === undefined) continue; other.all++; if (v < 0) other.neg++; else if (v <= 1) other.live++; else other.high++; }
  console.log(`roll ${String(r).padStart(2)}  own ${own.map(fmt).join(" ")}   others ${offs.map(fmt).join(" ")}`);
}
console.log(`own trails negative: ${ownNeg}/${ownAll}`);
console.log(`other-strain values: below 0 ${other.neg}, 0…+1 ${other.live}, above +1 ${other.high} (of ${other.all})`);
await (await card()).screenshot({ path: `${out}-card-rolled.png` });
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}-scene.png` });
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
