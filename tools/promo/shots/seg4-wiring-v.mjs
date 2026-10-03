// Promo segment 4, wiring, vertical frame: one readable column (--zoom 1.6 with
// the left meters column folded away, --folds {"column:meters":true}). Taps
// "Caustic density" (pins it; its wires panel opens inline), opens "+ Add by
// name" and taps the Bass hits chip (the wire; the picture starts pumping with
// the kick), then drags the setting's slider up. Setup is off the record.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4-wiring-v.mjs --from auto \
//     --seconds 8.5 --out seg4-v.mp4 --size 1080x1920 --zoom 1.6 --port 4173 --wav-start 56 \
//     --folds {\"column:meters\":true}
export default async function (ctx) {
  const { page, W, H } = ctx;
  await ctx.css("#sceneVersion { visibility: hidden !important; }");
  await ctx.cursor.place(W * 0.3, H - 10);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  await page.locator("#audioPromptMicBtn").click();
  await ctx.wait(2200);
  await page.locator("#menuBtn").click();
  await ctx.wait(900);
  await page.locator(".vc-row:has-text('Caustic density')").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await ctx.cursor.moveTo(W * 0.3, H - 10, 10);
  await ctx.wait(1200);
  ctx.startAt();
  await ctx.wait(500);

  await ctx.tap(".vc-row:has-text('Caustic density') .vc-drive-port", { ms: 800, label: "Caustic density port (pin)" });
  await ctx.wait(700);
  await ctx.tap("text=+ Add by name", { ms: 700, label: "+ Add by name" });
  await ctx.wait(500);
  await ctx.tap("button:text-is('Bass hits')", { ms: 700, label: "Bass hits chip (wire connects)" });
  await ctx.wait(1500);

  const s = page.locator(".vc-row:has-text('Caustic density') input.vc-slider").first();
  const b = await s.boundingBox();
  const { v, min, max } = await s.evaluate((e) => ({ v: +e.value, min: +e.min, max: +e.max }));
  const at = (f) => ({ x: b.x + 12 + (b.width - 24) * f, y: b.y + b.height / 2 });
  await ctx.drag(at((v - min) / (max - min)), at(0.9), 1100);
  await ctx.wait(1000);
}
