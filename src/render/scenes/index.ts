import { registerScene } from "../scene.ts";
import { spectrumScene } from "./spectrum.ts";
import { particlesScene } from "./particles.ts";
import { tunnelScene } from "./tunnel.ts";
import { cymaticsScene } from "./cymatics.ts";
import { moireScene } from "./moire.ts";
import { causticsScene } from "./caustics.ts";
import { risoScene } from "./riso.ts";
import { ferrofluidScene } from "./ferrofluid.ts";
import { meshGridScene } from "./meshGrid.ts";
import { chladniScene } from "./chladni.ts";
import { dancersScene } from "./dancers/index.ts";
import { powderScene } from "./powder.ts";

// Registration order is gallery display order (listScenes() preserves Map
// insertion order) — the featured scenes (those absent from DRAFT_SCENE_IDS,
// below) go first, drafts follow.
registerScene(chladniScene);
registerScene(causticsScene);
registerScene(meshGridScene);
registerScene(spectrumScene);
registerScene(particlesScene);
registerScene(tunnelScene);
registerScene(cymaticsScene);
registerScene(moireScene);
registerScene(risoScene);
registerScene(ferrofluidScene);
registerScene(dancersScene);
registerScene(powderScene);

/** Scenes still rough enough to sit behind the gallery's "draft" toggle —
 *  the featured scenes registered above it are deliberately absent. */
export const DRAFT_SCENE_IDS: ReadonlySet<string> = new Set([
  "spectrum",
  "particles",
  "tunnel",
  "cymatics",
  "moire",
  "riso",
  "ferrofluid",
  "dancers",
  "powder",
]);

export {
  spectrumScene,
  particlesScene,
  tunnelScene,
  cymaticsScene,
  moireScene,
  causticsScene,
  risoScene,
  ferrofluidScene,
  meshGridScene,
  chladniScene,
  dancersScene,
  powderScene,
};
