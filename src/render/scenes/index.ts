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

registerScene(spectrumScene);
registerScene(particlesScene);
registerScene(tunnelScene);
registerScene(cymaticsScene);
registerScene(moireScene);
registerScene(causticsScene);
registerScene(risoScene);
registerScene(ferrofluidScene);
registerScene(meshGridScene);

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
};
