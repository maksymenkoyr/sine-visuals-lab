// Promo segment 2, input montage raw material: scene open on demo audio, tap
// Screen (the source switches to a screen share), stop it, tap the Mic button
// (the scene starts reacting to the track), open the panel to the Input card.
// Wall clock; setup (tile tap) happens before ctx.startAt(). Use --from auto.
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg2-input.mjs --from auto \
//     --seconds 7.6 --out seg2.mp4 --size 1920x1080 --port 4173 --wav-start 52
//   (vertical: --size 1080x1920 --zoom 1.6 --folds {\"column:meters\":true})
export default async function (ctx) {
  const { page, W, H, keys } = ctx;
  await ctx.cursor.place(W * 0.86, H * 0.84);
  await page.locator(".gal-tile:has-text('Caustics')").click();
  await page.locator("#audioPromptDisplayBtn").waitFor({ state: "visible" });
  await ctx.css("#sceneVersion { visibility: hidden !important; }");
  await ctx.wait(900);
  ctx.startAt();
  await ctx.wait(300);
  await ctx.tap("#audioPromptDisplayBtn", { ms: 550, label: "Screen button" });
  await ctx.wait(700);
  await ctx.tap("#stopBtn", { ms: 450, label: "Stop share" });
  await ctx.wait(300);
  await ctx.tap("#audioPromptMicBtn", { ms: 450, label: "Mic button" });
  await ctx.wait(1100);
  await ctx.tap("#menuBtn", { ms: 600, label: "panel button" });
  await ctx.wait(400);
  for (const k of keys) await ctx.press(k);
  // Off the button (no tooltip hanging on the shot) and along the bottom edge, under the columns, so no row's hover hint opens on the way.
  await ctx.cursor.moveTo(W * 0.5, H - 8, 800);
  await ctx.wait(1000);
}
