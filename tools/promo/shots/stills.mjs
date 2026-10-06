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
//   steps  then, in order, each with optional `times` and `wait`: {click:"text"} {sel:"css"} {key:"k"}
//          {scene:"id"} {scroll:"text"} {type:["placeholder","text"]} {js:"code"} (runs in the page)
//          {slider:["label", value]} (a panel slider by its label, once the panel is open; Insiders has
//          no __viz) — for a card that needs filling
//   clip   crop the picture — the notes show pictures small (/release's Shape), so a card only reads
//          cropped to it: {text:"Set"} to the card holding that visible text, {text, after:true} to a
//          block heading in a card of many plus the element after it, {sel:"#css"} to an element, each
//          with `margin` CSS px of the scene around it (default 24), or {box:[x,y,w,h]}
//   phone  {size:[w,h], wait:ms}: after the steps, open the room this page hosts, by the QR's controller
//          link, in a second phone-sized window and shoot that window instead (the host page stays open)
//   wait   ms to let the picture settle after the last action (default 2500)
//   size   [width, height] of the viewport in CSS pixels (default 1280×720); the file is `--scale` × that
// Every picture hides the version label (it names the Insiders build, not the release) and the room
// code, and scrolls without smoothing. tools/promo/shots/stills.example.json is one release's whole list.
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
    // Smooth scrolling would leave a crop on a panel that is still moving.
    await page.addStyleTag({ content: "#sceneVersion,#roomCode{display:none!important}*{scroll-behavior:auto!important}" });
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
        else if (st.js !== undefined) await page.evaluate(st.js);
        else if (st.slider !== undefined) {
          if (!(await page.evaluate(([label, v]) => { const e = document.querySelector(`input.vc-slider[aria-label="${label}"]`); if (e) { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); } return !!e; }, st.slider))) missing.push(`${s.name}: step slider "${st.slider[0]}"`);
        }
        else if (st.type !== undefined) {
          const f = page.locator(`input[placeholder="${st.type[0]}"]`).first();
          if (await f.count()) { await f.fill(st.type[1]); await f.press("Enter"); } else missing.push(`${s.name}: step type field "${st.type[0]}"`);
        }
        await sleep(st.wait ?? 700);
      }
    }
    await sleep(s.wait ?? 2500);
    let shot = page, phoneContext = null;
    if (s.phone) {
      const { room, roomKey } = JSON.parse((await page.evaluate(() => localStorage.getItem("svl.hostRoom"))) ?? "{}");
      const [pw, ph] = s.phone.size ?? [390, 844];
      phoneContext = await browser.newContext({ viewport: { width: pw, height: ph }, deviceScaleFactor: Number(o.scale), isMobile: true, hasTouch: true, // the app tells a phone by its user agent (net/deviceKind.ts)
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
      shot = await phoneContext.newPage();
      if (room && roomKey) await shot.goto(`${process.env.BASE}/?room=${room}&role=controller&k=${encodeURIComponent(roomKey)}`, { waitUntil: "load" });
      else missing.push(`${s.name}: no hosted room to join`);
      await sleep(s.phone.wait ?? 8000);
    }
    const file = join(o.out, `${s.name}.jpg`);
    const clip = s.clip ? await clipBox(shot, s.clip, ...(s.phone ? s.phone.size ?? [390, 844] : [width, height])) : undefined;
    if (s.clip && !clip) missing.push(`${s.name}: clip ${JSON.stringify(s.clip)}`);
    await shot.screenshot({ path: file, type: "jpeg", quality: Number(o.quality), ...(clip ? { clip } : {}) });
    console.log(`OK ${file}`);
    await phoneContext?.close();
    await context.close();
  }
} finally {
  await browser.close();
}
/** The `clip` field's rectangle in CSS px, inside the viewport; null when its element isn't there. */
async function clipBox(page, clip, width, height) {
  let r;
  const m = clip.margin ?? 24;
  if (clip.box) {
    const [x, y, w, h] = clip.box;
    r = { x, y, width: w, height: h };
  } else {
    const box = await page.evaluate(({ text, sel, after }) => {
      // The text match is app.mjs's own: an element whose own text nodes read `text`.
      const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim().toLowerCase();
      const hit = sel ? document.querySelector(sel) : [...document.querySelectorAll("*")].find((e) => own(e) === text.toLowerCase() && e.getBoundingClientRect().width > 0);
      const el = sel ? hit : after ? hit?.closest(".vc-block") : hit?.closest(".vc-card");
      let b = el?.getBoundingClientRect();
      const nx = after && !sel ? el?.nextElementSibling?.getBoundingClientRect() : null;
      if (b && nx) b = { x: Math.min(b.x, nx.x), y: b.y, width: Math.max(b.right, nx.right) - Math.min(b.x, nx.x), height: nx.bottom - b.y };
      return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
    }, clip);
    if (!box) return null;
    r = { x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m };
  }
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  return { x, y, width: Math.min(width, r.x + r.width) - x, height: Math.min(height, r.y + r.height) - y };
}

if (missing.length) {
  console.error(`not on the page:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
