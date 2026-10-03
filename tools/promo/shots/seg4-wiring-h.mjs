// Promo segment 4, wiring, horizontal frame: panel open on Caustics with the
// Hits and Tempo monitors in the left column (the other left cards folded) and
// the Scene card on the right. The cursor taps "Caustic density" (pins it, the
// cable of what already drives it lights up), taps the Bass hits jack (a new
// wire runs across the picture to the setting), then drags the setting's
// slider up so the mesh visibly changes. Setup is off the record; use --from auto.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4-wiring-h.mjs --from auto \
//     --seconds 8.5 --out seg4-h.mp4 --size 1920x1080 --port 4173 --wav-start 56 \
//     --folds {\"bands\":true,\"signal\":true,\"character\":true}
// Wiring here is click-to-pin then click-a-jack (src/ui/deviceMenu.ts's header),
// not a drag: the cable is drawn by the app when the jack is pressed.
export default async function (ctx) {
  const { page, W, H } = ctx;
  await ctx.cursor.place(W * 0.5, H - 8);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  await page.locator("#audioPromptMicBtn").click();
  await ctx.wait(2200);
  await page.locator("#menuBtn").click();
  await ctx.wait(900);
  // Scene card to the top of the right column.
  await page.evaluate(() => { document.querySelector(".vc-controls-col").scrollTop = 880; });
  await ctx.cursor.moveTo(W * 0.5, H - 8, 10);
  await ctx.wait(1200);
  ctx.startAt();
  await ctx.wait(500);

  await ctx.tap(".vc-row:has-text('Caustic density') .vc-drive-port", { ms: 800, label: "Caustic density port (pin)" });
  await ctx.wait(900);
  await ctx.tap('.vc-jack[aria-label^="Plug Bass hits into"]', { ms: 1000, label: "Bass hits jack (wire connects)" });
  await ctx.wait(1700);

  // The setting's main slider: thumb at its current value, dragged up.
  const s = page.locator(".vc-row:has-text('Caustic density') input.vc-slider").first();
  const b = await s.boundingBox();
  const { v, min, max } = await s.evaluate((e) => ({ v: +e.value, min: +e.min, max: +e.max }));
  const at = (f) => ({ x: b.x + 8 + (b.width - 16) * f, y: b.y + b.height / 2 });
  await ctx.drag(at((v - min) / (max - min)), at(0.9), 1100);
  await ctx.wait(1200);
}
