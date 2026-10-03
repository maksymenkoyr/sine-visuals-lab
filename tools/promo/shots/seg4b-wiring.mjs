// Promo segment 4b, wiring: one timeline for three takes (pick with --keys).
//   (none)  1920x1080 zoom 1, both panel columns on screen: every cursor
//           action is real.
//   L       1080x1920 zoom 1.6, the monitors column only. Its jacks are tapped
//           by the cursor; the settings column is slid off the right edge (no
//           pointer events) and its ports, sliders and chip are driven in the
//           page at the same instants, so the cables still run out of the jacks
//           toward the right edge, where the ports sit.
//   R       1080x1920 zoom 1.6, the settings column only. Ports, sliders and
//           the chip are real cursor actions; the monitors column is slid off
//           the left edge and its jacks are clicked in the page when the
//           cursor would; the cables come in from the left edge.
// Under --zoom the app's cable layer (an svg in <body>, drawn in viewport
// pixels) would be scaled by the zoom and land in the wrong place, so its
// zoom is cancelled here. The panel's hover hints are hidden: a hint opening
// under the cursor grows a card by a paragraph.
// The takes share this script and the song window, so cutting between them
// lines up. Every panel card stays open (no --folds: an absent key = open). The
// monitors column is made one scrollable piece, because the app caps it at
// 100vh, which under CSS zoom is taller than the frame, and with Bands and
// Dynamics open the Hits, Tempo and Character cards sit below the fold; it is
// scrolled through during the shot, like the settings column (the tall frame
// starts at the top, Bands showing; the wide one starts at Dynamics so the Hits
// jacks are on screen).
//
// The window starts at an exact song time: the page waits until DELTA seconds
// after the mic stamp before ctx.startAt(), so clip t=0 is --wav-start + DELTA.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4b-wiring.mjs --from auto \
//     --seconds 9 --size 1920x1080 --port 4173 --wav-start 54 --out seg4b-h.mp4
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
    // Rows are found by their own label (has-text also matches a row whose hint
    // mentions another setting's name).
    const tag = () => document.querySelectorAll(".vc-row").forEach((r) => { const l = r.querySelector(".vc-label"); if (l) r.dataset.promo = l.textContent.trim(); });
    tag();
    setInterval(tag, 100);
    // A slider move made in the page: the input events a drag makes.
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
  });

  const L_SCROLL = ".vc-spectrum-col", R_SCROLL = ".vc-controls-col";
  const rowScrollTarget = (text, offset) => page.evaluate(({ text, offset, sel, z }) => {
    const col = document.querySelector(sel);
    const row = col.querySelector(`.vc-row[data-promo="${text}"]`);
    return col.scrollTop + (row.getBoundingClientRect().top - col.getBoundingClientRect().top) / z - offset;
  }, { text, offset, sel: R_SCROLL, z: zoom });
  const rowSel = (n) => `.vc-row[data-promo="${n}"]`;
  const port = (n) => `${rowSel(n)} .vc-drive-port`;
  const jack = (n) => `.vc-jack[aria-label^="Plug ${n} into"]`;
  const sliderSel = (n) => `${rowSel(n)} input.vc-slider`;
  const chip = (row, txt) => `${rowSel(row)} button:text-is("${txt}")`;

  // Keeps a settings row inside the column's visible band (an inline wires panel
  // opening above it can push it out): a short eased scroll, only when needed.
  const ensure = async (n) => {
    while (await page.evaluate((sel) => (window.__sc?.[sel] || 0) > 0, R_SCROLL)) await sleep(15);
    const y = await page.evaluate(({ sel, n, z }) => {
      const col = document.querySelector(sel), cr = col.getBoundingClientRect();
      const row = col.querySelector(`.vc-row[data-promo="${n}"]`);
      const rr = row.getBoundingClientRect();
      if (rr.top > cr.top + 50 && rr.bottom < cr.bottom - 40) return null;
      return col.scrollTop + (rr.top - cr.top - cr.height * 0.3) / z;
    }, { sel: R_SCROLL, n, z: zoom });
    if (y == null) return;
    console.log(`  ensure ${n} scrolls to ${Math.round(y)} at ${T().toFixed(2)}`);
    await page.evaluate(({ sel, y }) => window.__scrollTo(sel, y, 300), { sel: R_SCROLL, y });
    await sleep(330);
  };

  // ---- setup, off the record
  await ctx.cursor.place(W * 0.5, H - 8);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  await page.locator("#audioPromptMicBtn").click();
  await ctx.wait(2200);
  await page.locator("#menuBtn").click();
  await ctx.wait(900);
  await page.evaluate(({ sel, y }) => { document.querySelector(sel).scrollTop = y; }, { sel: L_SCROLL, y: H > W ? 0 : 330 });
  await page.evaluate(({ sel, y }) => { document.querySelector(sel).scrollTop = y; }, { sel: R_SCROLL, y: await rowScrollTarget("Caustic density", (H / zoom - 76) * 0.3) });
  await ctx.wait(500);

  // The first cursor spot: close to the first port (or mid-frame in the L take),
  // so the first press lands inside the first half second.
  const pb = await page.locator(port("Caustic density")).first().boundingBox();
  await ctx.cursor.place(realRight ? pb.x + 120 : W * 0.5, realRight ? pb.y + 60 : H * 0.45);
  await ctx.wait(500);

  // ---- hold until DELTA after the mic stamp: that instant is t=0
  const micEpoch = await page.evaluate(() => performance.timeOrigin + window.__micT0);
  while (Date.now() < micEpoch + DELTA * 1000) await sleep(2);
  ctx.startAt();
  console.log(`  t=0 is ${((Date.now() - micEpoch) / 1000).toFixed(3)} s after the mic stamp`);

  // ---- the actions. Every press happens at a fixed clip time P (the cursor
  // starts its glide early enough to arrive by then), so the three takes press
  // at the same instants. In a take where a side is hidden, that side's press
  // is done in the page at P and the cursor glides toward its next real target.
  let maxPressLate = 0;
  const arrive = async (P) => { await until(P); maxPressLate = Math.max(maxPressLate, T() - P); };
  const rest = (fx, fy) => ({ x: W * fx, y: H * fy });
  const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const clickIn = (sel) => page.locator(sel).first().evaluate((e) => e.click());

  // A tap on a target on a visible side, or an in-page click on a hidden one.
  const tapAt = async (P, sel, label, { real, restPt, ms = 240 }) => {
    await until(P - ms / 1000 - 0.12);
    if (real) {
      const c = await centre(sel);
      await until(P - ms / 1000 - 0.03);
      await ctx.cursor.moveTo(c.x, c.y, ms);
      await arrive(P);
      ctx.mark(`tap ${label}`);
      await page.mouse.down(); await sleep(60); await page.mouse.up();
    } else {
      await ctx.cursor.moveTo(restPt.x, restPt.y, ms);
      await arrive(P);
      await clickIn(sel);
      ctx.mark(`(hidden) ${label}`);
    }
  };
  // A slider move from its value to fraction `to` of its range, 360 ms long.
  const slideAt = async (P, n, to, label, restPt) => {
    await until(P - 0.45);
    const s = page.locator(sliderSel(n)).first();
    const { v, min, max } = await s.evaluate((e) => ({ v: +e.value, min: +e.min, max: +e.max }));
    if (realRight) {
      const b = await s.boundingBox();
      const at = (f) => ({ x: b.x + 10 + (b.width - 20) * f, y: b.y + b.height / 2 });
      await until(P - 0.25);
      await ctx.cursor.moveTo(at((v - min) / (max - min)).x, at(0).y, 220);
      await arrive(P);
      ctx.mark(`drag start ${label}`);
      await page.mouse.down(); await sleep(60);
      await ctx.cursor.moveTo(at(to).x, at(0).y, 360);
      await page.mouse.up();
    } else {
      await ctx.cursor.moveTo(restPt.x, restPt.y, 250);
      await arrive(P);
      ctx.mark(`(hidden) drag start ${label}`);
      await sleep(60);
      await page.evaluate(([sel, val, ms]) => window.__slide(sel, val, ms), [sliderSel(n), min + (max - min) * to, 360]);
    }
  };
  const port_ = (P, n, restPt) => tapAt(P, port(n), `port ${n}`, { real: realRight, restPt, ms: 220 });
  const jack_ = (P, n, restPt) => tapAt(P, jack(n), `jack ${n}`, { real: realLeft, restPt, ms: 280 });
  const ensureAt = async (t, n) => { await until(t); await ensure(n); };

  // 1. Bass hits -> Caustic density, then pull the density up
  await port_(0.40, "Caustic density", rest(0.5, 0.5));
  await jack_(1.05, "Bass hits", rest(0.45, 0.5));
  await slideAt(1.60, "Caustic density", 0.8, "Caustic density", rest(0.45, 0.6));
  // 2. Any hit -> Beat ripple, ring style Wave
  await port_(2.55, "Beat ripple", rest(0.5, 0.55));
  await jack_(3.15, "Any hit", rest(0.45, 0.45));
  await ensureAt(3.45, "Ring style");
  await tapAt(4.25, chip("Ring style", "Wave"), "chip Ring style Wave", { real: realRight, restPt: rest(0.4, 0.5), ms: 260 });
  // 3. Drift speed
  await slideAt(4.80, "Drift speed", 0.95, "Drift speed", rest(0.5, 0.45));
  // the monitors column scrolls on while the settings column follows to the next region
  await until(5.35);
  page.evaluate(({ sel }) => window.__scrollTo(sel, 800, 700), { sel: L_SCROLL });
  ctx.mark("scroll monitors column");
  await ensureAt(5.40, "Treble sparkle");
  // 4. Treble hits -> Treble sparkle, then Fog and the sparkle level
  await port_(6.20, "Treble sparkle", rest(0.5, 0.5));
  await jack_(6.85, "Treble hits", rest(0.45, 0.5));
  page.evaluate(({ sel }) => window.__scrollTo(sel, 0, 1300), { sel: L_SCROLL });
  await ensureAt(7.00, "Fog");
  await slideAt(7.55, "Fog", 0.95, "Fog", rest(0.45, 0.4));
  await slideAt(8.30, "Treble sparkle", 0.95, "Treble sparkle", rest(0.45, 0.4));
  await until(9.2);
  console.log(`SLOTS max lateness ${maxLate.toFixed(2)} s, press lateness ${maxPressLate.toFixed(2)} s`);
}
