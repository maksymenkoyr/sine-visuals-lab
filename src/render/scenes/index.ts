import { listScenes, registerScene } from "../scene.ts";
import { collectPrivateScenes } from "./privateScenes.ts";
import { echoesScene } from "./echoes/index.ts";
import { codeRainScene } from "./coderain/index.ts";
import { longPlayScene } from "./longplay/index.ts";
import { swarmScene } from "./swarm/index.ts";
import { coilScene } from "./coil/index.ts";
import { tesseraScene } from "./tessera/index.ts";
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
import { physarum2Scene } from "./physarum2.ts";
import { stormScene } from "./storm.ts";
import { ambienceScene } from "./ambience.ts";
import { kaleidoscopeScene } from "./kaleido/index.ts";
import { slatsScene } from "./slats/index.ts";
import { shardsScene } from "./shards/index.ts";
import { petriScene } from "./petri.ts";
import { inkScene } from "./ink.ts";
import { crystalScene } from "./crystal/index.ts";
import { fluidScene } from "./fluid.ts";
import { silkScene } from "./silk/index.ts";
import { skyScene } from "./sky/sky.ts";
import { gatesScene } from "./gates/index.ts";
import { toonraveScene } from "./toonrave/index.ts";
import { sweepScene } from "./sweep/index.ts";
import { tangleScene } from "./tangle/index.ts";
import { chaikinScene } from "./chaikin/index.ts";
import { alienScene } from "./alien/index.ts";

// Registration order is display order within each gallery section
// (listScenes() preserves Map insertion order; sceneStage(), below, picks the
// section) — the featured scenes go first, the rest follow. Within each group
// the newest scene comes first: a scene you just added goes at the top of the
// drafts, so it's the first tile behind the gallery's draft toggle.
// (Registering it here is also what lets vite-scene-links-plugin.ts print its
// link when you start `npm run dev` with its files changed.)
registerScene(physarum2Scene);
registerScene(skyScene);
registerScene(echoesScene);
registerScene(codeRainScene);
registerScene(sweepScene);
registerScene(chaikinScene);
registerScene(alienScene);
registerScene(tangleScene);
registerScene(toonraveScene);
registerScene(longPlayScene);
registerScene(swarmScene);
registerScene(coilScene);
registerScene(silkScene);
registerScene(slatsScene);
registerScene(physarumScene);
registerScene(chladniScene);
registerScene(causticsScene);
registerScene(fluidScene);
registerScene(gatesScene);
registerScene(tesseraScene);
registerScene(moireScene);
registerScene(petriScene);
registerScene(shardsScene);
registerScene(inkScene);
registerScene(crystalScene);
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

/** Scenes being worked on now: the gallery shows them open, in their own
 *  "In development" section between the released scenes and the drafts. A
 *  scene sits in this set or in draftIds below, never both. */
const inDevelopmentIds = new Set([
  "chaikin",
  "alien",
  "tangle",
  "toonrave",
  "longplay",
  "swarm",
  "coil",
  "shards",
  "ambience",
]);

/** Scenes still rough enough to sit behind the gallery's "draft" toggle —
 *  the featured scenes registered above it are deliberately absent. Paid
 *  scenes checked out locally add themselves below (see privateScenes.ts). */
const draftIds = new Set([
  "echoes",
  "coderain",
  "sweep",
  "silk",
  "slats",
  "physarum",
  "gates",
  "tessera",
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
  "kaleidoscope",
  "petri",
  "crystal",
  "fluid",
]);

// Paid scenes: whatever is checked out under ./private/ (gitignored here —
// see privateScenes.ts). Nothing matches in the public repo, its CI or the
// deployed site, so they're only ever in a local build. Registered after the
// built-ins, so each lands at the end of its gallery group.
const privateScenes = collectPrivateScenes(
  import.meta.glob("./private/*/index.ts", { eager: true }),
  new Set(listScenes().map((s) => s.id)),
);
for (const scene of privateScenes.scenes) registerScene(scene);
for (const id of privateScenes.draftIds) draftIds.add(id);
for (const error of privateScenes.errors) console.warn(`[private scenes] ${error}`);

export const DRAFT_SCENE_IDS: ReadonlySet<string> = draftIds;
export const IN_DEVELOPMENT_SCENE_IDS: ReadonlySet<string> = inDevelopmentIds;

/** Which gallery section a scene sits in: released (featured), in
 *  development, or draft — the two sets above decide. */
export type SceneStage = "released" | "development" | "draft";

export function sceneStage(id: string): SceneStage {
  if (draftIds.has(id)) return "draft";
  if (inDevelopmentIds.has(id)) return "development";
  return "released";
}

// Ids of the scenes collected from ./private/ above — tools/master-sweep.mjs
// skips these by default (--include-paid opts back in): nothing measured
// about a paid scene may land in this public repo.
export const PAID_SCENE_IDS: ReadonlySet<string> = new Set(privateScenes.scenes.map((s) => s.id));

export {
  echoesScene,
  codeRainScene,
  sweepScene,
  chaikinScene,
  alienScene,
  tangleScene,
  toonraveScene,
  longPlayScene,
  swarmScene,
  coilScene,
  skyScene,
  silkScene,
  tesseraScene,
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
  physarum2Scene,
  stormScene,
  ambienceScene,
  kaleidoscopeScene,
  slatsScene,
  shardsScene,
  petriScene,
  inkScene,
  crystalScene,
  fluidScene,
  gatesScene,
};
