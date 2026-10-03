// Promo segment 1, "Open. Tap. Running.": the gallery, the cursor glides to the
// Caustics tile and taps it, the scene opens already moving on its demo audio.
// Wall clock, no mic. The start prompt is hidden so the opening frame is clean
// (seg 2 is the one that shows it).
//   node tools/promo/capture.mjs <wav> --actions tools/promo/shots/seg1-quickstart.mjs \
//     --out seg1.mp4 --size 1920x1080 --seconds 4 --port 4173
//   (vertical: --size 1080x1920 --zoom 2)
export default async function (ctx) {
  const { W, H } = ctx;
  await ctx.css("#audioPrompt { display: none !important; }");
  await ctx.cursor.place(W * 0.86, H * 0.84);
  await ctx.wait(700);
  await ctx.tap(".gal-tile:has-text('Caustics')", { ms: 1100, label: "Caustics tile" });
  await ctx.wait(1700);
}
