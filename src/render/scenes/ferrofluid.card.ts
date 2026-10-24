// Ferrofluid's card: what every page needs before the scene's code loads (src/render/lazyScene.ts).
import type { Scene, SceneCard } from "../scene.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "draft", added: "2026-08-27" } as const;

// The heaviest of the small raymarch scenes (see ferrofluid.ts's header) — worse than tunnel.ts, which
// itself is gated to minQuality "low". uMaxSteps alone isn't enough protection:
// gate the gallery/scene picker too, or a floor-quality device can select it.
export const card: SceneCard = {
  id: "ferrofluid",
  name: "Ferrofluid",
  minQuality: "mid",
};

export const loadBody = (): Promise<Scene> => import("./ferrofluid.ts").then((m) => m.ferrofluidScene);
