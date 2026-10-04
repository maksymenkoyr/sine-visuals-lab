// Side-effect import: registers every built-in widget (mirrors
// src/render/scenes/index.ts's own registration pattern) so importing this
// one module is enough to reach the full registry — tests/sceneKeys.test.ts
// imports this rather than each widget file by name.
import "./itemBoxes.ts";
import "./sandZones.ts";

export * from "./registry.ts";
