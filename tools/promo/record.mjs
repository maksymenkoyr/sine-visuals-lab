// Records the takes the promo is cut from: node tools/promo/record.mjs <take>…|all
// (BPM comes from the environment; promo.mjs sets it from the song). Portrait phone layout, for the
// 1080x1920 cut. Output: <work>/takes/<take>/ — jpg frames + frames.json (real timestamps; the
// beat-aligned start is meta.epochT0) and, for panel shots, track.json (in-page rectangles).
// Every take is re-recorded until it plays smoothly (`run`), because a stuttering take can't be fixed
// in the edit. `intro` is the opening look: PROMO_LOOK is a share link from the Looks card
// (?look=<code>#/v/<scene>), loaded through the app's own ?look= parameter.
//
// Scene takes (`intro`, `song_*`) hear the song itself: promo.mjs cuts <work>/mic.wav from the song so
// that it starts MIC_LEAD beats (time for the app's analyser and beat clock to settle) before song time
// MIC_SONG_T0 + MIC_LEAD·P, and each scene take films MIC_SPAN beats from there — a stretch that covers
// the whole video, so compose.py can take any moment of it at the song time the video plays there
// (meta.songT0). Their script beats count from that start, which is MIC_PRE beats before video beat 0.
// Panel takes keep the synthetic feed: they show the interface, and only pulse on the grid behind it.
import fs from "node:fs";
import {
  BASE, launch, open, openPanel, hideChrome, beatClock, startCast, sleep, moveTo, drag, centerOf, scrollTextTo, clickText, press, P, BPM,
} from "./lib.mjs";

const WORK = process.env.PROMO_WORK || new URL("../.cache/promo/", import.meta.url).pathname;
const OUT = `${WORK}/takes/`;
const MIC = process.env.MIC_WAV ? {
  wav: process.env.MIC_WAV, lead: Number(process.env.MIC_LEAD), span: Number(process.env.MIC_SPAN),
  pre: Number(process.env.MIC_PRE), drop: Number(process.env.DROP_BEAT), songT0: Number(process.env.MIC_SONG_T0),
} : null;
const UI_VIEW = { width: 576, height: 1024, dsf: 1 };
const FB_VIEWS = [{ width: 720, height: 1280, dsf: 1 }, { width: 576, height: 1024, dsf: 1 }];
const at = (bc, b) => bc.waitBeat(b);
const PX = 250; // the phone panel column starts around here

function smooth(frames, t0, beats) {
  const w = frames.filter((f) => f.t >= t0 && f.t <= t0 + beats * P / 1000);
  if (w.length < 3) return { fps: 0, slow: 1 };
  const gaps = []; for (let i = 1; i < w.length; i++) gaps.push((w[i].t - w[i - 1].t) * 1000);
  return { fps: (w.length - 1) / (w.at(-1).t - w[0].t), slow: gaps.filter((g) => g > 34).length / gaps.length, max: Math.max(...gaps) };
}
async function once(name, scene, { setup, script, beats, view, lead = 1800, track: cfg_track, query = "", music = false }) {
  const { browser, page } = await launch({ ...(view || {}), wav: music ? MIC.wav : null });
  page.on("pageerror", (e) => console.log(name, "pageerror", e.message));
  try {
    await open(page, scene, { query, music });
    await setup?.(page);
    await sleep(500);
    if (cfg_track) await installTracker(page, cfg_track);
    const bc = await beatClock(page, lead, music ? { at: MIC.lead } : {});
    const cast = await startCast(page, `${OUT}${name}`);
    await script(page, bc);
    await at(bc, beats + 0.6);
    const songT0 = music ? MIC.songT0 + MIC.lead * P / 1000 : undefined;
    const frames = await cast.stop({ name, scene, beats, P, bpm: BPM, epochT0: bc.epochT0, view, songT0 });
    if (cfg_track) await saveTrack(page, name);
    return { st: smooth(frames, bc.epochT0, beats) };
  } finally { await browser.close(); }
}
async function run(name, scene, cfg) {
  const views = cfg.views || [cfg.view];
  for (let i = 0; i < views.length; i++) for (let a = 0; a < 2; a++) {
    const r = await once(name, scene, { ...cfg, view: views[i] });
    const ok = r.st.fps >= 50 && r.st.slow <= 0.12;
    console.log(`${name} view${i} try${a} fps ${r.st.fps.toFixed(1)} slow ${(r.st.slow * 100).toFixed(0)}% maxgap ${Math.round(r.st.max || 0)}ms ${ok ? "OK" : "SLOW"}`);
    if (ok) return;
  }
  console.log(name, "kept best-effort take");
}

const FB_SETUP = async (page) => { await openPanel(page); await sleep(1200); await hideChrome(page); await sleep(500); };
const every = (step, names, from = 0) => names.map((n, i) => [from + i * step, n]);
// Video beat where the first demo using `take` starts: demos run in lines.json order from DEMO_START.
const demoStart = (take) => {
  const lines = JSON.parse(fs.readFileSync(`${WORK}/lines.json`, "utf8"));
  let b = Number(process.env.DEMO_START);
  for (const d of lines.demos || []) { if (d.take === take) return b; b += d.beats; }
  return null;
};
// A two-screen demo: a landscape laptop (on a phone layout the panel covers the PLAY bar), its panel at
// the palettes, and the second screen it plays to (`second` opens it and returns its page), both on the
// song (a room's TV never gets the synthetic feed) and both cast — <name>_main and <name>_out. Timed to
// where the take's demos sit in the video (lines.json), since compose cuts it by song time; `script`
// counts beats from the first of them and returns where it ends. Key presses go into meta.keys
// ([epoch s, key, down]) so compose can light the laptop's Space and Option keys.
async function twoScreens(name, second, script) {
  if (!MIC) { console.log(`${name}: no MIC_WAV — run it through promo.mjs record`); return; }
  const d0 = demoStart(name);
  if (d0 == null) { console.log(`${name}: no demo in lines.json uses it`); return; }
  const vb = (b) => d0 + b + MIC.pre;   // take beat of demo beat b
  for (let tryN = 0; tryN < 2; tryN++) {
    const { browser, ctx, page } = await launch({ width: 1280, height: 720, dsf: 1, wav: MIC.wav });
    try {
      page.on("pageerror", (e) => console.log(name, "pageerror", e.message));
      await open(page, "caustics", { music: true });
      await page.addStyleTag({ content: ".pv-cur{width:18px!important;height:18px!important;margin:-9px 0 0 -9px!important}" });
      await openPanel(page); await sleep(1200); await scrollTextTo(page, "Palette", "start"); await sleep(600);
      await page.keyboard.press("m"); await sleep(600);   // hide the panel's left column: the laptop's own picture shows
      const other = await second({ browser, ctx, page });
      await page.bringToFront();
      await page.mouse.move(640, 400);
      const bc = await beatClock(page, 0, { at: MIC.lead, late: true });   // the action starts well after
      if (await page.evaluate(() => performance.now()) > bc.T0 + vb(-1.5) * P) throw new Error(`${name}: setup ran past the demo's start`);
      const castA = await startCast(page, `${OUT}${name}_main`);
      const castB = await startCast(other, `${OUT}${name}_out`);
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
      const frames = await castA.stop(meta); await castB.stop({ ...meta, name: `${name}_out` });
      const st = smooth(frames, bc.epochT0 + vb(-1) * P / 1000, end + 1);
      const ok = st.fps >= 50 && st.slow <= 0.12;
      console.log(`${name} try${tryN} fps ${st.fps.toFixed(1)} slow ${(st.slow * 100).toFixed(0)}% ${ok ? "OK" : "SLOW"}`);
      if (ok) return;
    } finally { await browser.close(); }
  }
}
// A scene take on the song. `flips` are [video beat, button text] — the drop is video beat MIC.drop.
const song = (name, scene, flips, { query = "" } = {}) => {
  if (!MIC) { console.log(`${name}: no MIC_WAV — run it through promo.mjs record`); return; }
  return run(name, scene, {
    music: true, beats: MIC.span, views: FB_VIEWS, setup: FB_SETUP, query,
    script: async (page, bc) => { for (const [b, n] of flips) { await at(bc, b + MIC.pre); await clickText(page, n); } },
  });
};

/** Slider span for the row labelled `label` in the phone panel: the nearest wide canvas below the label. */
const sliderOf = (page, label) => page.evaluate(([label, PX]) => {
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const lab = [...document.querySelectorAll("*")].find((e) => own(e) === label && e.getBoundingClientRect().x > PX - 40 && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().y > 0 && e.getBoundingClientRect().y < 1000);
  if (!lab) return null;
  const lr = lab.getBoundingClientRect();
  const ins = [...document.querySelectorAll("input.vc-slider")].map((i) => ({ i, r: i.getBoundingClientRect() })).filter(({ r }) => r.width > 150 && r.y >= lr.y - 4 && r.y < lr.y + 60);
  ins.sort((a, b) => a.r.y - b.r.y);
  if (!ins[0]) return null;
  const { i, r } = ins[0];
  const frac = (Number(i.value) - Number(i.min || 0)) / ((Number(i.max || 1) - Number(i.min || 0)) || 1);
  return { x0: r.left + 8, w: r.width - 16, y: r.y + r.height / 2, frac };
}, [label, PX]);


/** In-page tracker: every 70 ms logs [epoch seconds, x, y, w, h] of the part of the interface a call-out should outline. */
const installTracker = (page, kind) => page.evaluate((kind) => {
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const R = (e) => e.getBoundingClientRect();
  const vis = (r) => r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight;
  const byText = (t) => [...document.querySelectorAll("*")].filter((e) => own(e) === t && vis(R(e)));
  const union = (rs) => { rs = rs.filter(Boolean); if (!rs.length) return null; const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), r2 = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom)); return { x: l, y: t, w: r2 - l, h: b - t }; };
  const card = (t) => { const e = byText(t).find((x) => R(x).x > 200); const c = e && e.closest(".vc-card"); return c ? R(c) : null; };
  const row = (t) => { const e = byText(t).find((x) => R(x).x > 200); const c = e && e.closest(".vc-row"); return c ? R(c) : null; };
  const resolve = {
    strains: () => union([...document.querySelectorAll(".vc-sc-row")].map(R).filter(vis)),
    palettes: () => union([card("Palette")]),
    pads: () => { const e = document.querySelector(".vc-pads"); return e && vis(R(e)) ? union([R(e)]) : null; },
    wire: () => { const e = document.querySelector(".vc-row.vc-drive-pinned"); const r = e && R(e); return r && vis(r) ? union([r]) : null; },
    hits: () => union(["Envelope", "Beat", "Low", "Mid", "High"].map(row)),
    master: () => union([card("Scale")]),
    cuep: () => union(["CUE", "PLAY"].map((t) => { const e = byText(t)[0]; const b = e && (e.closest("button") || e.parentElement); return b ? R(b) : null; })),
    room: () => { const g = (t) => { const e = byText(t)[0]; if (!e) return null; let n = e; for (let i = 0; i < 3 && n.parentElement; i++) n = n.parentElement; return R(n); }; const m = byText("the room's look")[0]; return union([m && R(m.parentElement), g("Mac"), g("TV")]); },
  }[kind];
  window.__trk = [];
  setInterval(() => {
    let r = null; try { r = resolve(); } catch (e) {}
    const root = document.querySelector(".vc-root.vc-open"); const rb = root ? R(root) : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const clip = kind === "cuep" || kind === "room" ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : { left: Math.max(0, rb.left), top: Math.max(0, rb.top), right: Math.min(innerWidth, rb.right), bottom: Math.min(innerHeight, rb.bottom) };
    if (r) { const l = Math.max(r.x, clip.left), t = Math.max(r.y, clip.top), rr = Math.min(r.x + r.w, clip.right), b = Math.min(r.y + r.h, clip.bottom); r = rr - l > 8 && b - t > 8 ? [l, t, rr - l, b - t] : null; } else r = null;
    window.__trk.push([(performance.timeOrigin + performance.now()) / 1000, ...(r || [])]);
  }, 70);
}, kind);
const saveTrack = async (page, name) => fs.writeFileSync(`${OUT}${name}/track.json`, JSON.stringify(await page.evaluate(() => window.__trk || [])));

const T = {
  // the user's look, untouched, on the song (without PROMO_LOOK: Physarum 2 as it opens)
  intro: async () => {
    const look = process.env.PROMO_LOOK;
    if (!look) { console.log("intro: no PROMO_LOOK — a stand-in Physarum 2 opening"); return song("intro", "physarum2", []); }
    const u = new URL(look);
    const scene = decodeURIComponent((u.hash.match(/\/v\/([^/?]+)/) || [])[1] || "physarum2");
    return song("intro", scene, [], { query: `&look=${u.searchParams.get("look")}` });
  },
  // Re-rolls every two bars from the drop: a dish needs a few beats to grow into its pattern, and one
  // re-rolled every beat or two never does (the first cut's Physarum takes looked flat for that reason).
  // From the user's look when it is a Physarum 2 one: its drives (speed boost/pump, seed, flash) are what
  // make the dish answer the music — the scene's defaults barely pulse (pulse 1.08 vs the look's 1.48).
  song_p2r: () => {
    const look = process.env.PROMO_LOOK && new URL(process.env.PROMO_LOOK);
    const query = look && /\/v\/physarum2\b/.test(look.hash) ? `&look=${look.searchParams.get("look")}` : "";
    return song("song_p2r", "physarum2", every(8, Array(12).fill("Random"), MIC?.drop ?? 0), { query });
  },
  song_chl: () => song("song_chl", "chladni", every(8, ["Ice", "Fire", "Acid", "Amethyst", "Sunset", "Malachite", "Arcade", "Ember", "Ice", "Fire", "Acid", "Amethyst"], MIC?.drop ?? 0)),
  song_cau: () => song("song_cau", "caustics", every(8, ["Sunset", "Ice", "Amethyst", "Ember", "Acid", "Halation", "Fire", "Arcade", "Sunset", "Ice", "Amethyst", "Ember"], MIC?.drop ?? 0)),

  ui_strains: () => run("ui_strains", "physarum2", {
    track: "strains", beats: 8, view: UI_VIEW,
    setup: async (page) => { await openPanel(page); await sleep(900); await scrollTextTo(page, "Sensor range", "start"); await sleep(600); },
    script: async (page, bc) => {
      const X = (v) => 291 + v * 206;
      const thumbs = () => page.evaluate(() => [...document.querySelectorAll(".vc-sc-thumb")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }).filter((t) => t.w > 0 && t.y > 20 && t.y < 980));
      const job = async (b, idx, v1, ms) => { await at(bc, b); const t = (await thumbs())[idx]; await drag(page, t.x, t.y, X(v1), t.y, ms); };
      await job(0.0, 0, 0.95, 560); await job(1.5, 1, 0.85, 560); await job(3.0, 2, 0.15, 560); await job(4.5, 3, 0.7, 560); await job(6.0, 8, 0.85, 560);
    },
  }),

  ui_palettes: () => run("ui_palettes", "caustics", {
    track: "palettes", beats: 8, view: UI_VIEW,
    setup: async (page) => { await openPanel(page); await sleep(900); await scrollTextTo(page, "Palette", "center"); await sleep(700); },
    script: async (page, bc) => {
      const names = ["Sunset", "Ice", "Amethyst", "Ember", "Acid"];
      for (let i = 0; i < names.length; i++) {
        const b = i * 1.6;
        await at(bc, b - 0.5);
        const c = await centerOf(page, names[i], { minX: PX });
        if (c) await moveTo(page, c.x, c.y, 0.4 * P);
        await at(bc, b);
        await clickText(page, names[i]);
      }
    },
  }),

  ui_pads: () => run("ui_pads", "physarum2", {
    track: "pads", beats: 8, views: [UI_VIEW, { width: 504, height: 896, dsf: 1 }, { width: 432, height: 768, dsf: 1 }],
    setup: async (page) => { await openPanel(page); await sleep(900); await scrollTextTo(page, "Pairs", "start"); await sleep(700); },
    script: async (page, bc) => {
      const pads = () => page.evaluate(() => [...document.querySelectorAll("canvas.vc-pad-canvas")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }).filter((p) => p.y > 30 && p.y < 990));
      const corner = [[-0.42, -0.4], [0.42, 0.4], [0.4, -0.42], [-0.4, 0.42]];
      for (let j = 0; j < 5; j++) {
        const b = j * 1.6;
        await at(bc, b - 0.5);
        const ps = await pads(); const p = ps[j % ps.length];
        await moveTo(page, p.x, p.y, 0.4 * P);
        await at(bc, b);
        await page.mouse.down(); await sleep(40);
        const c = corner[j % 4];
        await moveTo(page, p.x + c[0] * p.w, p.y + c[1] * p.w, 0.9 * P);
        await page.mouse.up();
      }
    },
  }),

  ui_wire: () => run("ui_wire", "caustics", {
    track: "wire", beats: 8, view: UI_VIEW,
    setup: async (page) => { await openPanel(page); await sleep(900); await page.mouse.move(430, 500); await page.mouse.wheel(0, 640); await sleep(900); await page.mouse.move(120, 500); },
    script: async (page, bc) => {
      const portNear = (label) => page.evaluate(([label, PX]) => {
        const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
        const lab = [...document.querySelectorAll("*")].find((e) => own(e) === label && e.getBoundingClientRect().x > PX - 40);
        if (!lab) return null;
        const ly = lab.getBoundingClientRect().y + lab.getBoundingClientRect().height / 2;
        const ports = [...document.querySelectorAll(".vc-drive-port")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        ports.sort((a, b) => Math.abs(a.y - ly) - Math.abs(b.y - ly));
        return ports[0] && Math.abs(ports[0].y - ly) < 30 ? ports[0] : null;
      }, [label, PX]);
      const plan = [[0.0, "Caustic density", null], [4.2, "Beat ripple", null]];
      for (const [b, label, close] of plan) {
        await at(bc, b);
        const p = await portNear(label);
        if (!p) { console.log("no port for", label); continue; }
        await moveTo(page, p.x, p.y, 0.8 * P);
        await press(page, 220);
        if (close != null) { await at(bc, close); await page.keyboard.press("Escape"); }
      }
    },
  }),

  ui_hits: () => run("ui_hits", "caustics", {
    track: "hits", beats: 8, view: UI_VIEW,
    setup: async (page) => {
      await openPanel(page); await sleep(900);
      await page.evaluate(() => { const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); [...document.querySelectorAll("*")].find((e) => /show shape/i.test(own(e)))?.click(); });
      await sleep(600);
      await page.evaluate(() => { const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); [...document.querySelectorAll("*")].filter((e) => own(e) === "ms" && e.getBoundingClientRect().width > 0)[0]?.scrollIntoView({ block: "center" }); });
      await sleep(900); await page.mouse.move(120, 500);
    },
    script: async (page, bc) => {
      const job = async (b, name, f1, ms) => {
        await at(bc, b);
        const s = await sliderOf(page, name);
        if (!s) { console.log("no slider", name); return; }
        await drag(page, s.x0 + s.w * s.frac, s.y, s.x0 + s.w * f1, s.y, ms);
      };
      await job(0.0, "Beat", 0.95, 600); await job(2.2, "Low", 0.2, 600); await job(4.4, "Mid", 0.9, 600); await job(6.4, "Beat", 0.1, 600);
    },
  }),

  ui_master: () => run("ui_master", "caustics", {
    track: "master", beats: 8, view: UI_VIEW,
    setup: async (page) => { await openPanel(page); await sleep(1100); await page.mouse.move(120, 500); },
    script: async (page, bc) => {
      const job = async (b, name, f0, f1, ms) => {
        await at(bc, b);
        const s = await sliderOf(page, name);
        if (!s) { console.log("no slider", name); return; }
        await drag(page, s.x0 + s.w * s.frac, s.y, s.x0 + s.w * f1, s.y, ms);
      };
      await job(0.0, "Scale", 0.5, 0.95, 700); await job(2.0, "Expansion", 0.5, 0.1, 700); await job(4.0, "Scale", 0.95, 0.1, 700); await job(6.0, "Expansion", 0.1, 0.92, 700);
    },
  }),

  // add the TV by its code; then a palette on the laptop (the TV keeps its look) and a tap of Option (Play), twice
  room: () => twoScreens("room", async ({ browser, page }) => {
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
  cuep: () => twoScreens("cuep", async ({ ctx, page }) => {
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

fs.mkdirSync(OUT, { recursive: true });
for (const n of process.argv.slice(2)) {
  if (n === "all") { for (const k of Object.keys(T)) await T[k](); continue; }
  if (!T[n]) { console.log("unknown take", n); continue; }
  await T[n]();
}
