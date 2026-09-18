import { registerScene } from "../scene.ts";
import { spectrumScene } from "./spectrum.ts";
import { particlesScene } from "./particles.ts";
import { tunnelScene } from "./tunnel.ts";
import { cymaticsScene } from "./cymatics.ts";
import { moireScene } from "./moire.ts";
import { moire2Scene } from "./moire2.ts";
import { causticsScene } from "./caustics.ts";
import { risoScene } from "./riso.ts";
import { ferrofluidScene } from "./ferrofluid.ts";
import { meshGridScene } from "./meshGrid.ts";
import { chladniScene } from "./chladni.ts";
import { dancersScene } from "./dancers/index.ts";
import { powderScene } from "./powder.ts";
import { physarumScene } from "./physarum.ts";
import { stormScene } from "./storm.ts";
import { ambienceScene } from "./ambience.ts";
import { kaleidoscopeScene } from "./kaleido/index.ts";
import { slatsScene } from "./slats/index.ts";
import { shardsScene } from "./shards/index.ts";
import { petriScene } from "./petri.ts";
import { inkScene } from "./ink.ts";

// Registration order is gallery display order (listScenes() preserves Map
// insertion order) — the featured scenes (those absent from DRAFT_SCENE_IDS,
// below) go first, drafts follow. Within each group the newest scene comes
// first: a scene you just added goes at the top of the drafts, so it's the
// first tile behind the gallery's draft toggle. (Registering it here is also
// what lets vite-scene-links-plugin.ts print its link when you start
// `npm run dev` with its files changed.)
registerScene(slatsScene);
registerScene(physarumScene);
registerScene(chladniScene);
registerScene(causticsScene);
registerScene(moireScene);
registerScene(petriScene);
registerScene(shardsScene);
registerScene(inkScene);
registerScene(kaleidoscopeScene);
registerScene(powderScene);
registerScene(ambienceScene);
registerScene(stormScene);
registerScene(dancersScene);
registerScene(meshGridScene);
registerScene(spectrumScene);
registerScene(particlesScene);
registerScene(tunnelScene);
registerScene(cymaticsScene);
registerScene(moire2Scene);
registerScene(risoScene);
registerScene(ferrofluidScene);

/** Scenes still rough enough to sit behind the gallery's "draft" toggle —
 *  the featured scenes registered above it are deliberately absent. */
export const DRAFT_SCENE_IDS: ReadonlySet<string> = new Set([
  "ink",
  "mesh",
  "spectrum",
  "particles",
  "tunnel",
  "cymatics",
  "moire",
  "moire2",
  "riso",
  "ferrofluid",
  "dancers",
  "powder",
  "storm",
  "ambience",
  "kaleidoscope",
  "shards",
  "petri",
]);

export {
  spectrumScene,
  particlesScene,
  tunnelScene,
  cymaticsScene,
  moireScene,
  moire2Scene,
  causticsScene,
  risoScene,
  ferrofluidScene,
  meshGridScene,
  chladniScene,
  dancersScene,
  powderScene,
  physarumScene,
  stormScene,
  ambienceScene,
  kaleidoscopeScene,
  slatsScene,
  shardsScene,
  petriScene,
  inkScene,
};
