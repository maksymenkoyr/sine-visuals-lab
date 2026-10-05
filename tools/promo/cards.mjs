// The promo's text cards: one entry point for the three videos, each rendered by its own template module.
//   node tools/promo/cards.mjs --work <work dir> [--video release|hook|explainer]
//
// The video comes from the flag, else from <work>/cuts.json "video"; PROMO_WORK stands in for --work.
// Each module in cards/ is the renderer that made that video's approved look, moved as it was, and
// exports render(work). It reads its own input and writes its own PNGs (each module's header says which):
//   cards/release.mjs    /video-release: <work>/lines.json (demos, groups) -> <work>/cards/
//   cards/hook.mjs       /video-hook-stable: <work>/lines.json (opening, proofs) -> <work>/cards/
//   cards/explainer.mjs  /video-explainer: <work>/showcase.json (captions) -> <work>/caps/
// The modules keep their own CSS and Chromium call order on purpose: identical calls give identical PNGs,
// which the regressions in regress.py compare. A new video adds a module here, nothing is shared.
import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

const dir = arg("--work") || process.env.PROMO_WORK;
if (!dir) {
  console.error("usage: node tools/promo/cards.mjs --work <work dir> [--video release|hook|explainer]");
  process.exit(2);
}
const work = path.resolve(dir);
let video = arg("--video");
if (!video) {
  try {
    video = JSON.parse(fs.readFileSync(`${work}/cuts.json`, "utf8")).video;
  } catch {
    // no cuts.json yet: the flag is required
  }
}
if (!video || !fs.existsSync(new URL(`./cards/${video}.mjs`, import.meta.url))) {
  console.error(`cards: unknown or missing video "${video}" (pass --video release|hook|explainer, or write ${work}/cuts.json first)`);
  process.exit(2);
}
const mod = await import(`./cards/${video}.mjs`);
await mod.render(work);
