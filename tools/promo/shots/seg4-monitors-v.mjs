// Promo segment 4 extra, vertical frame: the Hits and Tempo monitor cards
// pulsing, alone in one column (the controls column is hidden with a style —
// at this width the two columns overlap — and Bands/Dynamics/Character are
// folded with --folds). Mic on and panel open are setup, off the record.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg4-monitors-v.mjs --from auto \
//     --seconds 3 --out seg4-monitors-v.mp4 --size 1080x1920 --zoom 1.6 --port 4173 --wav-start 56 \
//     --folds {\"bands\":true,\"signal\":true,\"character\":true}
export default async function (ctx) {
  const { page, W, H } = ctx;
  await ctx.css("#sceneVersion { visibility: hidden !important; } .vc-controls-col { display: none !important; }");
  await ctx.cursor.place(W * 0.5, H - 10);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  await page.locator("#audioPromptMicBtn").click();
  await ctx.wait(2200);
  await page.locator("#menuBtn").click();
  await ctx.cursor.moveTo(W * 0.5, H - 10, 10);
  await ctx.wait(1800);
  ctx.startAt();
  await ctx.wait(3200);
}
