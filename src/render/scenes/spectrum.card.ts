// Spectrum's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-08-27" } as const;

export const card: SceneCard = {
  id: "spectrum",
  name: "Spectrum",
};

export const loadBody = (): Promise<Scene> => import("./spectrum.ts").then((m) => m.spectrumScene);
