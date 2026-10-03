// A pure-picture scene shot: apply a saved look, let it develop off the record,
// then open the recorded window. No panel, no cursor, no chrome.
//   PROMO_LOOKS=variants_x.json PROMO_LABEL="War of colours" PROMO_LEAD=18 \
//   node tools/promo/capture.mjs <song.wav> --scene physarum2 --time mic --chrome none \
//     --wav-start <window start - lead> --from auto --seconds 10 --actions tools/promo/shots/scene-look.mjs ...
// The look file is a JSON array of { label, palette, settings } entries. The
// mic starts at clock 0 (mic mode), so the window opens at clock = PROMO_LEAD,
// which is song second wav-start + lead. Physarum 2 gets "Fresh dish" first so
// its colony grows from a clean plate during the lead.
import { readFileSync } from "node:fs";

export default async function (ctx) {
  const { page } = ctx;
  const looks = JSON.parse(readFileSync(process.env.PROMO_LOOKS, "utf8"));
  const look = looks.find((l) => l.label === process.env.PROMO_LABEL);
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
  if (look.palette && !(await clickBtn(look.palette))) console.log("palette button not found", look.palette);
  await page.evaluate(({ s, scene }) => window.__viz.setParams({ scene, autoPin: true, settings: s }), { s: look.settings, scene });
  if (scene === "physarum2") console.log("fresh dish", await clickBtn("Fresh dish"));
  await ctx.wait(400);
  await page.evaluate(() => document.getElementById("menuBtn")?.click());
  while (ctx.t() < lead) await ctx.wait(Math.min(250, (lead - ctx.t()) * 1000));
  ctx.startAt();
}
