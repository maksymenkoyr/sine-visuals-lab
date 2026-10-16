// Promo segment 4d, wiring + scene: one wire at a brisk pace (every
// slider drag 1.3 s), then three SCENE settings changed so the
// picture visibly answers, and the monitors column scrolled so the Hits, Tempo
// and Character cards are seen alive as well as Bands and Dynamics.
// Panel setup: both panel columns stay open (no --folds: an absent key = open).
// The monitors column is made one scrollable piece, because the app caps it at
// 100vh, which under CSS zoom is taller than the frame, and with Bands and
// Dynamics open the Hits, Tempo and Character cards sit below the fold; it is
// scrolled through during the shot, like the settings column. The panel's hover
// hints are hidden: a hint opening under the cursor grows a card by a paragraph.
// The hidden-column trick: in a vertical frame only one column fits, so the
// other is slid off the frame's edge with its pointer events off, and its
// controls are driven in the page at the instants the cursor would act, so the
// cables still run out of the jacks toward the edge where the ports sit.
// The cable-zoom fix: under --zoom the app's cable layer (an svg in <body>,
// drawn in viewport pixels) would be scaled by the zoom and land in the wrong
// place, so its zoom is cancelled here. The cable layer's pointer events are
// also off: a cable path lies over the Bass hits jack and would swallow the
// real press, so the jack never plugged.
// The window starts at an exact song time: the page waits until DELTA seconds
// after the mic stamp before ctx.startAt(), so clip t=0 is --wav-start + DELTA.
// The takes share this script and the song window, so cutting between them
// lines up; pick one with --keys (none, L or R):
//   (none)  both columns on screen: every action is real. Recorded at
//           2880x1620 --zoom 1.5 (the 1920x1080 layout at 1.5x the pixels, so
//           an edit can push in on a column without blur).
//   L       1080x1920 zoom 1.6, monitors column only; the settings column's
//           controls are driven in the page at the same instants.
//   R       1080x1920 zoom 1.6, settings column only; the jack is clicked in
//           the page when the cursor would.
// Clip t=0 is --wav-start + DELTA (song 62.00 with --wav-start 54). Timeline:
//   0.60  press the Caustic density port (its wires box opens)
//   1.40  press the Bass hits jack (the cable is drawn, the picture pumps)
//   2.00  arrive on that wire's strength slider; 2.10-3.40 drag it up
//   3.70  press the Threshold ON toggle
//   4.10  arrive on the threshold slider; 4.15-5.45 drag it up (sparser kicks)
//   5.75  press the port again: the wires box closes (else the next press
//         closes it and the rows jump)
//   6.65  arrive on Beat ripple; 6.75-8.05 drag it up (every kick throws rings)
//   8.70  press the Ring style "Wave" chip
//   9.30  arrive on Fog (the column scrolls to it); 9.40-10.70 drag it down (clearer)
//   11.0  end
// The monitors column eases down 4.2-5.2 s so Tempo and Character come into
// view (Hits stays on screen: the cable is anchored on its jack). Marks and
// the on-screen boxes (frame pixels) of what the camera may aim at print at
// the end ("BOX name x y w h").
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4d.mjs --from auto \
//     --seconds 11 --size 2880x1620 --zoom 1.5 --port 4173 --wav-start 54 --grant-mic --out seg4d-h.mp4
//   (vertical: --size 1080x1920 --zoom 1.6 --keys L, or --keys R)
const DELTA = 8.0; // seconds from the mic stamp to clip t=0

export default async function (ctx) {
  const { page, W, H, zoom } = ctx;
  const mode = ctx.keys[0] || "H";
  const realLeft = mode !== "R", realRight = mode !== "L";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = () => ctx.t() - ctx.fromAt;
  let maxLate = 0;
  const until = async (t) => { while (T() < t) await sleep(4); maxLate = Math.max(maxLate, T() - t); if (T() - t > 0.3) console.log(`  slot ${t} late ${(T() - t).toFixed(2)}`); };

  const colMax = `calc(${H / zoom}px - 76px)`;
  await ctx.css(`
    .vc-power-col, #sceneVersion { visibility: hidden !important; }
    .vc-spectrum-col { max-height: ${colMax} !important; overflow-y: auto !important; scrollbar-width: none !important; }
    .vc-meters { overflow: visible !important; max-height: none !important; }
    .vc-controls-col { max-height: ${colMax} !important; scrollbar-width: none !important; }
    .vc-hint { display: none !important; }
    .vc-cable-layer, .vc-cable-layer * { pointer-events: none !important; }
    ${zoom !== 1 ? `.vc-cable-layer { zoom: ${1 / zoom} !important; width: 100vw !important; height: 100vh !important; }` : ""}
    ${mode === "L" ? ".vc-controls-col { transform: translateX(calc(100% + 60px)); pointer-events: none !important; }" : ""}
    ${mode === "R" ? ".vc-spectrum-col { transform: translateX(calc(-100% - 60px)); pointer-events: none !important; }" : ""}
  `);
  await page.evaluate(() => {
    const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    // Eased in-page scroll, started without waiting for it.
    window.__scrollTo = (sel, to, ms) => {
      const el = document.querySelector(sel), y0 = el.scrollTop, t0 = performance.now();
      window.__sc = window.__sc || {};
      window.__sc[sel] = (window.__sc[sel] || 0) + 1;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        el.scrollTop = y0 + (to - y0) * ease(k);
        if (k < 1) requestAnimationFrame(step); else window.__sc[sel]--;
      };
      step();
    };
    // Rows are found by their own label.
    const tag = () => document.querySelectorAll(".vc-row").forEach((r) => { const l = r.querySelector(".vc-label"); if (l) r.dataset.promo = l.textContent.trim(); });
    tag();
    setInterval(tag, 100);
    // A slider move made in the page: the input events a drag makes, eased.
    window.__slide = (sel, to, ms) => new Promise((res) => {
      const el = document.querySelector(sel), v0 = +el.value, t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        el.value = String(v0 + (to - v0) * ease(k));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        if (k < 1) requestAnimationFrame(step);
        else { el.dispatchEvent(new Event("change", { bubbles: true })); res(); }
      };
      step();
    });
    // Letting go of a drive row's slider pins that row (its wires box opens and
    // the column scrolls to it): the app's own habit, but it would move the
    // rows under the cursor mid-shot, so the scene sliders used here keep the
    // click to themselves.
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.matches && t.matches("input.vc-slider") && ["Beat ripple", "Fog"].includes(t.closest(".vc-row")?.dataset.promo)) e.stopPropagation();
    }, true);
    // A button/toggle click made in the page.
    window.__click = (sel) => document.querySelector(sel).click();
  });

  const L_SCROLL = ".vc-spectrum-col", R_SCROLL = ".vc-controls-col";
  const rowSel = (n) => `.vc-row[data-promo="${n}"]`;
  const ROW = "Caustic density";
  const port = `${rowSel(ROW)} .vc-drive-port`;
  const jack = `.vc-jack[aria-label^="Plug Bass hits into"]`;
  const strengthSel = `${rowSel(ROW)} input[aria-label="Bass hits weight"]`;
  const onBtnSel = `${rowSel(ROW)} [aria-label="Threshold on/off"] button:text-is("On")`;
  const thrSel = `${rowSel(ROW)} input[aria-label="Threshold"]`;

  const rippleSel = `${rowSel("Beat ripple")} input.vc-slider`;
  const fogSel = `${rowSel("Fog")} input.vc-slider`;
  const waveChip = `${rowSel("Ring style")} button:text-is("Wave")`;
  const waitScrolls = () => page.waitForFunction(() => !Object.values(window.__sc || {}).some((v) => v > 0), null, { timeout: 2000 }).catch(() => {});
  // The on-screen box (frame pixels) of an element, recorded for the report.
  const boxes = [], boxJobs = [];
  const addBox = (name, b, t) => b && boxes.push({ name, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), t: t.toFixed(2) });
  // Not awaited: a measurement never delays the timeline; the jobs are
  // awaited at the end.
  const boxStats = (name, sel) => {
    const t = T();
    boxJobs.push(page.locator(sel).first().boundingBox({ timeout: 1500 }).then((b) => addBox(name, b, t), () => {}));
  };
  const cardBox = (name, head) => {
    const t = T();
    boxJobs.push(page.evaluate(({ sel, head }) => {
      const c = [...document.querySelectorAll(sel)].find((e) => (e.querySelector(".vc-card-head")?.textContent || "").trim().startsWith(head));
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, { sel: ".vc-spectrum-col .vc-card", head }).then((b) => addBox(name, b, t), () => {}));
  };
  // Latency of one cursor step (the last mouse move lands this much after its
  // requested time, more on the big frame): measured off the record, then
  // subtracted from every glide so each lands on its mark.
  let lat = 0;

  const rowScrollTarget = (text, offset) => page.evaluate(({ text, offset, sel, z }) => {
    const col = document.querySelector(sel);
    const row = col.querySelector(`.vc-row[data-promo="${text}"]`);
    return col.scrollTop + (row.getBoundingClientRect().top - col.getBoundingClientRect().top) / z - offset;
  }, { text, offset, sel: R_SCROLL, z: zoom });

  // ---- setup, off the record
  await ctx.cursor.place(W * 0.5, H - 8);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  // With the mic permission granted (--grant-mic) the page starts the mic by
  // itself on entering the scene; otherwise the start prompt is tapped.
  const micOn = await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 3000 }).then(() => true, () => false);
  if (!micOn) await page.locator("#audioPromptMicBtn").click();
  await ctx.wait(2200);
  await page.locator("#menuBtn").click();
  await ctx.wait(900);
  await page.evaluate(({ sel, y }) => { document.querySelector(sel).scrollTop = y; }, { sel: L_SCROLL, y: H > W ? 0 : 330 });
  await page.evaluate(({ sel, y }) => { document.querySelector(sel).scrollTop = y; }, { sel: R_SCROLL, y: await rowScrollTarget(ROW, (H / zoom - 76) * 0.3) });
  await ctx.wait(500);

  {
    const ms = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      await ctx.cursor.moveTo(W * (i % 2 ? 0.45 : 0.55), H * 0.5, 300);
      ms.push(performance.now() - t0 - 300);
    }
    ms.sort((a, b) => a - b);
    lat = Math.max(0, ms[Math.floor(ms.length / 2)]) / 1000;
    console.log(`  cursor step latency ${(lat * 1000).toFixed(0)} ms`);
  }

  // The first cursor spot: a visible glide away from the port (or mid-frame in
  // the L take).
  const pb = await page.locator(port).first().boundingBox();
  const start0 = realRight ? { x: pb.x - 320 * Math.min(1, zoom), y: pb.y + 150 } : { x: W * 0.5, y: H * 0.42 };
  await ctx.cursor.place(Math.max(30, start0.x), start0.y);
  await ctx.wait(500);

  // ---- hold until DELTA after the mic stamp: that instant is t=0
  await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 15000 });
  const micEpoch = await page.evaluate(() => performance.timeOrigin + window.__micT0);
  while (Date.now() < micEpoch + DELTA * 1000) await sleep(2);
  ctx.startAt();
  console.log(`  t=0 is ${((Date.now() - micEpoch) / 1000).toFixed(3)} s after the mic stamp`);

  // ---- the actions
  let maxPressLate = 0;
  const arrive = async (P) => { await until(P); maxPressLate = Math.max(maxPressLate, T() - P); };
  const rest = (fx, fy) => ({ x: W * fx, y: H * fy });
  const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const clickIn = (sel) => page.locator(sel).first().evaluate((e) => e.click());
  const glide = (x, y, from, to) => ctx.cursor.moveTo(x, y, Math.max(80, Math.round((to - T() - lat) * 1000)));

  // A press on a target: glide [g0, P], press at P. real: on a visible side;
  // otherwise the cursor glides to restPt and the click is made in the page.
  const pressAt = async (g0, P, sel, label, { real, restPt, shift = 0, wait = true }) => {
    await until(g0 - 0.1);
    if (wait) await waitScrolls();
    boxStats(label, sel);
    const c0 = real ? await centre(sel) : restPt;
    const c = { x: c0.x, y: c0.y + shift };
    await until(g0);
    await glide(c.x, c.y, g0, P);
    await arrive(P);
    if (real) {
      ctx.mark(`press ${label}`);
      await page.mouse.down(); await sleep(90); await page.mouse.up();
    } else {
      await clickIn(sel);
      ctx.mark(`(hidden) press ${label}`);
    }
  };

  // A slow slider move: glide [g0, P] onto the thumb, press at P, hold until
  // d0, drag to fraction `to` of the range until d1, release.
  const dragAt = async (g0, P, d0, d1, sel, to, label, restPt, { wait = true, afterMeasure = null } = {}) => {
    let shift = 0;
    await until(g0 - 0.1);
    if (wait) await waitScrolls();
    const s = page.locator(sel).first();
    const { v, min, max } = await s.evaluate((e) => ({ v: +e.value, min: +e.min, max: +e.max }));
    const b = realRight ? await s.boundingBox() : null;
    if (afterMeasure) shift = await afterMeasure();
    if (realRight) {
      const pad = 9;
      const at = (f) => ({ x: b.x + pad + (b.width - 2 * pad) * f, y: b.y + b.height / 2 + shift });
      await until(g0);
      await glide(at((v - min) / (max - min)).x, at(0).y, g0, P);
      await arrive(P);
      ctx.mark(`on ${label} slider`);
      await page.mouse.down();
      await until(d0);
      ctx.mark(`drag ${label} start`);
      await ctx.cursor.moveTo(at(to).x, at(0).y, Math.max(100, Math.round((d1 - T() - lat) * 1000)));
      ctx.mark(`drag ${label} end`);
      await page.mouse.up();
    } else {
      await until(g0);
      await glide(restPt.x, restPt.y, g0, P);
      await arrive(P);
      ctx.mark(`(hidden) on ${label} slider`);
      await until(d0);
      ctx.mark(`(hidden) drag ${label} start`);
      await page.evaluate(([s, val, ms]) => window.__slide(s, val, ms), [sel, min + (max - min) * to, Math.round((d1 - d0) * 1000)]);
      ctx.mark(`(hidden) drag ${label} end`);
    }
  };

  // The wires box and its threshold row must be on screen: one eased scroll in
  // the settings column, only if the box would run past the band's foot.
  const ensureBox = async () => {
    const y = await page.evaluate(({ sel, n, z }) => {
      const col = document.querySelector(sel), cr = col.getBoundingClientRect();
      const row = col.querySelector(`.vc-row[data-promo="${n}"]`);
      const rr = row.getBoundingClientRect();
      if (rr.top > cr.top + 10 && rr.bottom < cr.bottom - 30) return null;
      return col.scrollTop + (rr.top - cr.top - 30 * z) / z;
    }, { sel: R_SCROLL, n: ROW, z: zoom });
    if (y == null) return;
    console.log(`  ensure box scrolls to ${Math.round(y)} at ${T().toFixed(2)}`);
    await page.evaluate(({ sel, y }) => window.__scrollTo(sel, y, 450), { sel: R_SCROLL, y });
  };

  // 1. the port
  await pressAt(0.00, 0.60, port, "port Caustic density", { real: realRight, restPt: rest(0.5, 0.5) });
  // 2. the jack: the cable is drawn
  await pressAt(0.75, 1.40, jack, "jack Bass hits", { real: realLeft, restPt: rest(0.4, 0.5) });
  await until(1.45);
  await ensureBox();
  // the monitors column eases down 4.2-5.2 s, alongside the threshold drag:
  // Tempo and Character come into view
  const leftScroll = (async () => {
    await until(4.2);
    // Hits at the column's top edge: Hits, Tempo and Character below it.
    const to = await page.evaluate(({ sel, z }) => {
      const c = document.querySelector(sel);
      const hits = [...c.querySelectorAll(".vc-card")].find((e) => (e.querySelector(".vc-card-head")?.textContent || "").trim().startsWith("Hits"));
      const y = c.scrollTop + (hits.getBoundingClientRect().top - c.getBoundingClientRect().top) / z - 14;
      return Math.min(y, c.scrollHeight - c.clientHeight);
    }, { sel: L_SCROLL, z: zoom });
    await page.evaluate(({ sel, y }) => window.__scrollTo(sel, y, 1000), { sel: L_SCROLL, y: to });
  })();
  // 3. strength up
  await dragAt(1.55, 2.00, 2.10, 3.40, strengthSel, 0.95, "strength", rest(0.45, 0.58));
  // 4. threshold on, then up
  await pressAt(3.45, 3.70, onBtnSel, "threshold ON", { real: realRight, restPt: rest(0.5, 0.55) });
  await dragAt(3.85, 4.10, 4.15, 5.45, thrSel, 0.7, "threshold", rest(0.45, 0.6));
  // 5. close the wires box (press its port again), scroll to the scene
  // settings, then three changes. Any press on another row collapses an open
  // patch panel and shifts the rows under it; closing it first keeps the
  // layout still while the sliders are dragged.
  await pressAt(5.50, 5.75, port, "close wires box", { real: realRight, restPt: rest(0.5, 0.45) });
  cardBox("Hits card", "Hits");
  boxStats("settings column", R_SCROLL);
  // The scene settings scroll into place while the cursor glides to the
  // first one: the row is measured first, the scroll starts, and the cursor
  // aims at where the slider will be.
  const toRow = (name, frac) => async () => {
    const sc0 = await page.evaluate((sel) => document.querySelector(sel).scrollTop, R_SCROLL);
    const y = await rowScrollTarget(name, (H / zoom - 76) * frac);
    await page.evaluate(({ sel, y }) => window.__scrollTo(sel, y, 450), { sel: R_SCROLL, y });
    return (sc0 - y) * zoom; // frame pixels the rows move
  };
  // Beat ripple (the page keeps its slider's click to itself, see above).
  await dragAt(6.20, 6.65, 6.75, 8.05, rippleSel, 0.95, "Beat ripple", rest(0.45, 0.45), { wait: false, afterMeasure: toRow("Beat ripple", 0.12) });
  await waitScrolls();
  boxStats("Beat ripple", rowSel("Beat ripple"));
  await pressAt(8.35, 8.70, waveChip, "Ring style Wave", { real: realRight, restPt: rest(0.55, 0.5) });
  boxStats("Ring style", rowSel("Ring style"));
  // Fog is further down: the column scrolls to it on the way.
  await dragAt(8.85, 9.30, 9.40, 10.70, fogSel, 0.15, "Fog", rest(0.5, 0.55), { wait: false, afterMeasure: toRow("Fog", 0.3) });
  await waitScrolls();
  boxStats("Fog", rowSel("Fog"));
  await leftScroll;
  await until(11.0);
  console.log(`SLOTS max lateness ${maxLate.toFixed(2)} s, press lateness ${maxPressLate.toFixed(2)} s`);
  await Promise.all(boxJobs);
  for (const b of boxes) console.log(`BOX ${b.name} ${b.x} ${b.y} ${b.w} ${b.h}  (t=${b.t})`);
}
