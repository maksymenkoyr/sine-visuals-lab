// Promo segment 4c, wiring, slow: one wire shown as a whole, unhurried process.
// Same three takes as seg4b-wiring.mjs (pick with --keys; read its header for
// the panel setup, the hidden-column trick and the cable-zoom fix, all reused
// here unchanged; plus the cable layer's pointer events off: a cable path lies
// over the Bass hits jack and swallowed the real press, so the jack never plugged):
//   (none)  1920x1080 zoom 1, both columns on screen: every action is real.
//   L       1080x1920 zoom 1.6, monitors column only; the settings column's
//           port, sliders and toggle are driven in the page at the same instants.
//   R       1080x1920 zoom 1.6, settings column only; the jack is clicked in
//           the page when the cursor would.
// One wire, Bass hits -> Caustic density, at an easy pace: every glide is
// 0.5-0.8 s, every action is followed by a pause so the picture's answer is
// seen. The slow drags run between tDown and tEnd; the press and the drag
// start are separate instants (the press shows, then the thumb moves).
//   0.60  press the Caustic density port (its wires box opens)
//   1.70  press the Bass hits jack (the cable is drawn, the picture pumps)
//   2.90  arrive on that wire's strength slider; 3.30-5.20 drag it up
//   5.90  press the Threshold ON toggle
//   6.70  arrive on the threshold slider; 6.80-8.70 drag it up (sparser kicks)
//   9.80  back on the strength slider; 10.00-11.40 drag it down a little
// The window starts at an exact song time as in seg4b: clip t=0 is
// --wav-start + DELTA.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4c-slow.mjs --from auto \
//     --seconds 12 --size 1920x1080 --port 4173 --wav-start 54 --grant-mic --out seg4c-h.mp4
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
  const glide = (x, y, from, to) => ctx.cursor.moveTo(x, y, Math.round((to - from) * 1000));

  // A press on a target: glide [g0, P], press at P. real: on a visible side;
  // otherwise the cursor glides to restPt and the click is made in the page.
  const pressAt = async (g0, P, sel, label, { real, restPt }) => {
    await until(g0 - 0.1);
    const c = real ? await centre(sel) : restPt;
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
  const dragAt = async (g0, P, d0, d1, sel, to, label, restPt) => {
    await until(g0 - 0.1);
    const s = page.locator(sel).first();
    const { v, min, max } = await s.evaluate((e) => ({ v: +e.value, min: +e.min, max: +e.max }));
    if (realRight) {
      const b = await s.boundingBox();
      const pad = 9;
      const at = (f) => ({ x: b.x + pad + (b.width - 2 * pad) * f, y: b.y + b.height / 2 });
      await until(g0);
      await glide(at((v - min) / (max - min)).x, at(0).y, g0, P);
      await arrive(P);
      ctx.mark(`on ${label} slider`);
      await page.mouse.down();
      await until(d0);
      ctx.mark(`drag ${label} start`);
      await ctx.cursor.moveTo(at(to).x, at(0).y, Math.round((d1 - d0) * 1000));
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
  await pressAt(0.95, 1.70, jack, "jack Bass hits", { real: realLeft, restPt: rest(0.4, 0.5) });
  await until(1.85);
  await ensureBox();
  // 3. strength up
  await dragAt(2.25, 2.90, 3.30, 5.20, strengthSel, 0.95, "strength", rest(0.45, 0.58));
  // 4. threshold on, then up
  await pressAt(5.35, 5.90, onBtnSel, "threshold ON", { real: realRight, restPt: rest(0.5, 0.55) });
  await dragAt(6.20, 6.70, 6.80, 8.70, thrSel, 0.7, "threshold", rest(0.45, 0.6));
  // 5. one more slow adjustment: ease the strength back a little
  await dragAt(9.20, 9.80, 10.00, 11.40, strengthSel, 0.65, "strength back", rest(0.5, 0.5));
  await until(11.9);
  console.log(`SLOTS max lateness ${maxLate.toFixed(2)} s, press lateness ${maxPressLate.toFixed(2)} s`);
}
