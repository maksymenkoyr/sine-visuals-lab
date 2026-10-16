// A pure-picture scene shot: apply a saved look, let it develop off the record,
// then open the recorded window. No panel, no cursor, no chrome.
//   PROMO_LOOKS=variants_x.json PROMO_LABEL="War of colours" PROMO_LEAD=18 \
//   node tools/promo/capture.mjs <song.wav> --scene physarum2 --time mic --chrome none \
//     --wav-start <window start - lead> --from auto --seconds 10 --actions tools/promo/shots/scene-look.mjs ...
// The look file is a JSON array of { label, palette, settings } entries. The
// mic starts at clock 0 (mic mode), so the window opens at clock = PROMO_LEAD,
// which is song second wav-start + lead. A share code (a look entry's `code`,
// or PROMO_LOOK_CODE, which promo.mjs record sets from a clip entry's
// look.code; then no look file is needed) was already loaded by capture.mjs
// --look, so the palette click and __viz.setParams are skipped. A look
// without one is applied through window.__viz, which only a dev build has, so
// it needs a dev server (--base); on Stable it fails with a message. Physarum
// 2 gets "Fresh dish" first so its colony grows from a clean plate during the
// lead.
import { readFileSync } from "node:fs";

export default async function (ctx) {
  const { page } = ctx;
  const shared = process.env.PROMO_LOOK_CODE;
  const looks = process.env.PROMO_LOOKS ? JSON.parse(readFileSync(process.env.PROMO_LOOKS, "utf8")) : [];
  const look = looks.find((l) => l.label === process.env.PROMO_LABEL) || (shared ? { label: "share code", code: shared } : null);
  if (!look) throw new Error(`no look ${process.env.PROMO_LABEL}`);
  const scene = process.env.PROMO_SCENE;
  const lead = +(process.env.PROMO_LEAD || 16);
  const clickBtn = (text) => page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
    if (b) { b.click(); return true; }
    return false;
  }, text);
  // The panel's buttons exist only while it is open.
  await page.evaluate(() => document.getElementById("menuBtn")?.click());
  await ctx.wait(500);
  await ctx.css("body > :not(canvas), body > :not(canvas) * { visibility: hidden !important; } #__cur { display: none !important; }");
  if (!look.code && !shared) {
    if (!(await page.evaluate(() => !!window.__viz))) throw new Error(`look ${look.label} has no share code and this site has no window.__viz (dev builds only): save it as a Stable share code or pass --base a dev server`);
    if (look.palette && !(await clickBtn(look.palette))) console.log("palette button not found", look.palette);
    await page.evaluate(({ s, scene }) => window.__viz.setParams({ scene, autoPin: true, settings: s }), { s: look.settings, scene });
  }
  if (scene === "physarum2") console.log("fresh dish", await clickBtn("Fresh dish"));
  await ctx.wait(400);
  await page.evaluate(() => document.getElementById("menuBtn")?.click());
  while (ctx.t() < lead) await ctx.wait(Math.min(250, (lead - ctx.t()) * 1000));
  ctx.startAt();
}
