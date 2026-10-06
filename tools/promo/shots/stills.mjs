// Still pictures of the app for a release's notes (/release, .claude/commands/release.md): one JPEG per
// entry of a shot list, taken from the build that ships — Insiders, unless --base says otherwise — on
// the synthetic feed, so the scene moves to a steady beat while the picture is taken.
//
//   node tools/promo/shots/stills.mjs --shots <shots.json> --out <dir> [--base <url>] [--only name,name]
//
// shots.json is a list; each entry:
//   name   the file: <out>/<name>.jpg
//   scene  the scene id the page opens on; omit it, and `path` (e.g. "#/") opens without one
//   query  extra query, "&look=…" (the synthetic feed's own ?audio= and ?bpm= are always there)
//   panel  open the panel and scroll this visible text to the top of it (omit for the picture alone)
//   click  visible texts to click in order, once the panel is open (a card's fold, the scene's name)
//   keys   keys to press after that (a pad's number, an effect key); "Shift+1" style chords work
//   hide   true: hide the page's own buttons, HUD, effects bar and Record row, for a scene on its own
//   css    extra CSS for the page, to hide or frame anything else
// Every picture hides the version label (it names the Insiders build, not the release) and the room
// code. tools/promo/shots/stills.example.json is one release's whole list.
//   steps  then, in order, each with optional `times` and `wait`: {click:"text"} {sel:"css"} {key:"k"}
//          {scene:"id"} {scroll:"text"} {type:["placeholder","text"]} — for a card that needs filling
//   wait   ms to let the picture settle after the last action (default 2500)
//   size   [width, height] of the viewport in CSS pixels (default 1280×720); the file is `--scale` × that
// A text that isn't on the page is reported and the picture still taken, so a run never stops halfway:
// look at every picture before it goes anywhere. Page helpers: shots/lib/app.mjs.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: o } = parseArgs({
  options: {
    shots: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "https://insiders.sinevisualslab.com" },
    only: { type: "string" },
    scale: { type: "string", default: "1.5" },
    quality: { type: "string", default: "85" },
  },
});
if (!o.shots || !o.out) {
  console.error("usage: node tools/promo/shots/stills.mjs --shots <shots.json> --out <dir> [--base <url>] [--only a,b]");
  process.exit(2);
}
// app.mjs reads BASE when it loads.
process.env.BASE = o.base.replace(/\/$/, "");
const { open, openPanel, hideChrome, scrollTextTo, clickText, sleep } = await import("./lib/app.mjs");

const only = o.only ? new Set(o.only.split(",")) : null;
const shots = JSON.parse(readFileSync(o.shots, "utf8")).filter((s) => !only || only.has(s.name));
mkdirSync(o.out, { recursive: true });

// The take flags of capture.mjs: Metal Chromium and fake media devices.
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const missing = [];
try {
  for (const s of shots) {
    const [width, height] = s.size ?? [1280, 720];
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(o.scale), permissions: ["microphone"] });
    // open() waits for the synthetic feed's start stamp, which reading ?bpm= sets (capture.mjs's INIT).
    await context.addInitScript(() => {
      const get = URLSearchParams.prototype.get;
      URLSearchParams.prototype.get = function (k) {
        if (k === "bpm") window.__S = performance.now();
        return get.call(this, k);
      };
    });
    const page = await context.newPage();
    if (s.scene) await open(page, s.scene, { query: s.query ?? "" });
    else {
      await page.goto(`${process.env.BASE}/${s.query ? `?${s.query.replace(/^&/, "")}` : ""}${s.path ?? ""}`, { waitUntil: "load" });
      await sleep(3500);
    }
    await page.addStyleTag({ content: "#sceneVersion,#roomCode{display:none!important}" });
    if (s.hide) {
      await hideChrome(page);
      await page.addStyleTag({ content: "#fxBar,#recRow{display:none!important}" });
    }
    if (s.css) await page.addStyleTag({ content: s.css });
    if (s.panel) {
      await openPanel(page);
      await sleep(900);
      if (!(await scrollTextTo(page, s.panel, "start"))) missing.push(`${s.name}: panel text "${s.panel}"`);
      await sleep(500);
    }
    for (const text of s.click ?? []) {
      if (!(await clickText(page, text))) missing.push(`${s.name}: click "${text}"`);
      await sleep(600);
    }
    for (const key of s.keys ?? []) {
      await page.keyboard.press(key);
      await sleep(400);
    }
    for (const st of s.steps ?? []) {
      for (let i = 0; i < (st.times ?? 1); i++) {
        if (st.click !== undefined) {
          if (!(await clickText(page, st.click))) missing.push(`${s.name}: step click "${st.click}"`);
        } else if (st.sel !== undefined) {
          if (!(await page.evaluate((q) => { const e = document.querySelector(q); e?.click(); return !!e; }, st.sel))) missing.push(`${s.name}: step sel "${st.sel}"`);
        } else if (st.key !== undefined) await page.keyboard.press(st.key);
        else if (st.scroll !== undefined) { if (!(await scrollTextTo(page, st.scroll, "center"))) missing.push(`${s.name}: step scroll "${st.scroll}"`); }
        else if (st.scene !== undefined) await page.evaluate((id) => { location.hash = `#/v/${id}`; }, st.scene);
        else if (st.type !== undefined) {
          const f = page.locator(`input[placeholder="${st.type[0]}"]`).first();
          if (await f.count()) { await f.fill(st.type[1]); await f.press("Enter"); } else missing.push(`${s.name}: step type field "${st.type[0]}"`);
        }
        await sleep(st.wait ?? 700);
      }
    }
    await sleep(s.wait ?? 2500);
    const file = join(o.out, `${s.name}.jpg`);
    await page.screenshot({ path: file, type: "jpeg", quality: Number(o.quality) });
    console.log(`OK ${file}`);
    await context.close();
  }
} finally {
  await browser.close();
}
if (missing.length) {
  console.error(`not on the page:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
