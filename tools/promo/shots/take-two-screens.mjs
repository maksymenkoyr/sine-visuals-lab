// The two-screen takes (`cuep`, `room`): a landscape laptop (on a phone layout the panel covers the PLAY
// bar), its panel at the palettes, and the second screen it plays to, both on the song (a room's TV never
// gets the synthetic feed) and both cast: <name>_main and <name>_out. record.mjs's twoScreens with the two
// openers and scripts verbatim; the retry loop is capture.mjs's now. Run by `capture.mjs --take NAME --work
// DIR` (shot contract: ctx in, {casts, gate} out; see its header). Timed to where the take's first
// segment sits in the video (rec.slots, from cuts.json), since compose cuts it by song time; `script`
// counts beats from there and returns where it ends. Key presses go into meta.keys ([epoch s, key, down])
// so compose can light the laptop's Space and Option keys. Page helpers: shots/lib/app.mjs.
import { BASE, open, setMouse, openPanel, beatClock, sleep, moveTo, centerOf, scrollTextTo, press, P, BPM } from "./lib/app.mjs";

const at = (bc, b) => bc.waitBeat(b);

async function twoScreens(ctx, second, script) {
  const { name, rec } = ctx;
  const MIC = rec.mic;
  const d0 = rec.slots?.[name];
  if (d0 == null) throw new Error(`${name}: no segment uses it`);
  const vb = (b) => d0 + b + MIC.pre;   // take beat of proof beat b
  const { browser, context, page } = ctx;
  await open(page, ctx.entry.scene, { music: true });
  await page.addStyleTag({ content: ".pv-cur{width:18px!important;height:18px!important;margin:-9px 0 0 -9px!important}" });
  await openPanel(page); await sleep(1200); await scrollTextTo(page, "Palette", "start"); await sleep(600);
  await page.keyboard.press("m"); await sleep(600);   // hide the panel's left column: the laptop's own picture shows
  const other = await second({ browser, ctx: context, page });
  await page.bringToFront();
  await page.mouse.move(640, 400); setMouse(640, 400);
  const bc = await beatClock(page, 0, { at: MIC.lead, late: true });   // the action starts well after
  if (await page.evaluate(() => performance.now()) > bc.T0 + vb(-1.5) * P) throw new Error(`${name}: setup ran past the proof's start`);
  await ctx.startCast(page, `${name}_main`);
  await ctx.startCast(other, `${name}_out`);
  const keys = [];
  const key = async (k, down) => {
    keys.push([await page.evaluate(() => (performance.timeOrigin + performance.now()) / 1000), k, down]);
    await (down ? page.keyboard.down(k) : page.keyboard.up(k));
  };
  const atB = (b) => at(bc, vb(b));
  const tap = async (b, text, opts) => {
    await atB(b - 0.5);
    const c = await centerOf(page, text, opts);
    if (!c) { console.log(`${name}: no "${text}"`); return; }
    await moveTo(page, c.x, c.y, 0.4 * P);
    await atB(b); await press(page, 120);
  };
  const end = await script({ page, at: atB, tap, key });
  await atB(end);
  const meta = { name, beats: vb(end), P, bpm: BPM, epochT0: bc.epochT0, songT0: MIC.songT0 + MIC.lead * P / 1000, keys };
  return { casts: { [`${name}_main`]: meta, [`${name}_out`]: { ...meta, name: `${name}_out` } }, gate: { t0: bc.epochT0 + vb(-1) * P / 1000, beats: end + 1 } };
}

const SHOTS = {
  // add the TV by its code; then a palette on the laptop (the TV keeps its look) and a tap of Option (Play), twice
  room: (ctx) => twoScreens(ctx, async ({ browser, page }) => {
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    const tv = await ctxB.newPage();
    await tv.goto(`${BASE}/tv`, { waitUntil: "load" });
    await sleep(3500);
    const code = ((await tv.evaluate(() => document.body.innerText.slice(0, 400))).match(/\n([A-Z0-9]{4})\n/) || [])[1];
    await page.evaluate(() => document.querySelector("#panelBtn")?.click()); await sleep(2000);   // the Room view, over the panel
    await page.locator('input[placeholder="CODE"]').first().fill(code); await sleep(400);
    await page.evaluate(() => { const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); [...document.querySelectorAll("*")].find((e) => /add a tv by its code/i.test(own(e)))?.scrollIntoView({ block: "center" }); });
    await sleep(600);
    return tv;
  }, async ({ page, at, tap, key }) => {
    const btn = await centerOf(page, "Add screen");
    await at(-0.8); await moveTo(page, btn.x, btn.y, 0.6 * P);
    await at(0.4); await press(page, 120);
    await at(3.5); await page.evaluate(() => document.querySelector("#panelBtn")?.click());   // close the Room view
    const play = async (b) => { await at(b); await key("Alt", true); await sleep(150); await key("Alt", false); };
    await tap(4.5, "Ice", { minX: 640 }); await play(5.75);
    await tap(7, "Ember", { minX: 640 }); await play(8.25);
    return 10;
  }),

  // A palette on the laptop leaves the pop-out alone; holding Space (Cue) shows it there only while held
  // (outputKeys.ts: a peek, the output goes back on release); a tap of Option (Play) sends it for good.
  cuep: (ctx) => twoScreens(ctx, async ({ ctx, page }) => {
    let pop = null; ctx.on("page", (p) => { pop = p; });
    await page.evaluate(() => document.querySelector("#outBtn")?.click());
    for (let i = 0; i < 60 && !pop; i++) await sleep(100);
    await sleep(3500);
    return pop;
  }, async ({ at, tap, key }) => {
    await tap(0.5, "Ice", { minX: 640 });
    await at(2); await key("Space", true); await at(3.5); await key("Space", false);
    await at(4.5); await key("Alt", true); await sleep(150); await key("Alt", false);
    return 7;
  }),
};

export default async function (ctx) {
  const shot = SHOTS[ctx.name];
  if (!shot) throw new Error(`take-two-screens: no take ${ctx.name}`);
  return shot(ctx);
}
