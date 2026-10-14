// Sky's scene module (scenes/sceneModules.ts): the scene itself lives in
// sky.ts, kept there so its history (and its version count) stays on that file.
export { skyScene } from "./sky.ts";

// This scene's gallery section and the day it was added (scenes/sceneModules.ts).
export const gallery = { stage: "released", added: "2026-09-27" } as const;
