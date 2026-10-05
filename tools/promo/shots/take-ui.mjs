// The six interface takes (`ui_*`): the phone panel at a control while the scene pulses behind it on the
// synthetic feed, one table entry per take. The setup and script code is record.mjs's T table, copied
// verbatim; the entry's track kind (the rectangle installTracker follows) sits with it, its scene and the
// sizes in tools/promo/takes.json. Run by `capture.mjs --take NAME --work DIR` (shot contract: ctx in,
// {casts, gate} out; see its header), flow as record.mjs once() without music: open, setup, tracker,
// beat clock, cast, script, then track.json. Page helpers: shots/lib/app.mjs.
import { open, setMouse, openPanel, beatClock, sleep, moveTo, drag, centerOf, scrollTextTo, clickText, press, P, BPM, PX, sliderOf, installTracker } from "./lib/app.mjs";

const at = (bc, b) => bc.waitBeat(b);

const UI = {
  ui_strains: {
    track: "strains", beats: 8,
    setup: async (page) => { await openPanel(page); await sleep(900); await scrollTextTo(page, "Sensor range", "start"); await sleep(600); },
    script: async (page, bc) => {
      const X = (v) => 291 + v * 206;
      const thumbs = () => page.evaluate(() => [...document.querySelectorAll(".vc-sc-thumb")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }).filter((t) => t.w > 0 && t.y > 20 && t.y < 980));
      const job = async (b, idx, v1, ms) => { await at(bc, b); const t = (await thumbs())[idx]; await drag(page, t.x, t.y, X(v1), t.y, ms); };
      await job(0.0, 0, 0.95, 560); await job(1.5, 1, 0.85, 560); await job(3.0, 2, 0.15, 560); await job(4.5, 3, 0.7, 560); await job(6.0, 8, 0.85, 560);
    },
  },

  ui_palettes: {
    track: "palettes", beats: 8,
    setup: async (page) => { await openPanel(page); await sleep(900); await scrollTextTo(page, "Palette", "center"); await sleep(700); },
    script: async (page, bc) => {
      const names = ["Sunset", "Ice", "Amethyst", "Ember"];   // a tap every other beat, so each colour lands on a beat
      for (let i = 0; i < names.length; i++) {
        const b = i * 2;
        await at(bc, b - 0.5);
        const c = await centerOf(page, names[i], { minX: PX });
        if (c) await moveTo(page, c.x, c.y, 0.4 * P);
        await at(bc, b);
        await clickText(page, names[i]);
      }
    },
  },

  ui_pads: {
    track: "pads", beats: 8,
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
  },

  ui_wire: {
    park: true, track: "wire", beats: 8,
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
  },

  ui_hits: {
    park: true, track: "hits", beats: 8,
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
  },

  ui_master: {
    park: true, track: "master", beats: 8,
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
  },
};

export default async function (ctx) {
  const { page, name } = ctx;
  const t = UI[name];
  if (!t) throw new Error(`take-ui: no take ${name}`);
  const scene = ctx.entry.scene;
  await open(page, scene);
  await t.setup(page);
  if (t.park) setMouse(120, 500);   // setup left the real mouse here, so the first glide starts at the visible cursor
  await sleep(500);
  await installTracker(page, t.track);
  const bc = await beatClock(page, 1800);
  await ctx.startCast(page, name);
  await t.script(page, bc);
  await at(bc, t.beats + 0.6);
  await ctx.saveTrack(page, name);
  const meta = { name, scene, beats: t.beats, P, bpm: BPM, epochT0: bc.epochT0, view: ctx.view };
  return { casts: { [name]: meta }, gate: { t0: bc.epochT0, beats: t.beats } };
}
