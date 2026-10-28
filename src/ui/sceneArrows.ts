/**
 * The arrow keys move whatever the scene on screen names in its card's
 * `arrows` (src/render/scene.ts's SceneArrows): Alien's camera, for one. app.ts
 * calls handleSceneArrows from its keydown handler, in a scene only.
 *
 * A focused control that moves on the arrows itself keeps them: a slider, a
 * text field, a row of chips (controlsKit.ts's picker strip), or anything
 * that already claimed the press (defaultPrevented). Anywhere else (the
 * picture, a button, nothing focused) they reach the scene. A press writes
 * the setting as the panel's own rows do, so a saved look and the output
 * window see it; the panel doesn't watch the store, so app.ts then tells it
 * which row to re-read (DeviceMenu.settingChanged).
 */
import type { SceneArrows, SceneCard } from "../render/scene.ts";
import type { SceneSetting } from "../render/sceneSettings.ts";

const ARROWS: Record<string, { pair: "leftRight" | "upDown"; sign: 1 | -1 }> = {
  ArrowRight: { pair: "leftRight", sign: 1 },
  ArrowLeft: { pair: "leftRight", sign: -1 },
  ArrowUp: { pair: "upDown", sign: 1 },
  ArrowDown: { pair: "upDown", sign: -1 },
};

const SHIFTED = { leftRight: "shiftLeftRight", upDown: "shiftUpDown" } as const;

/** Controls that already move on the arrows. */
const OWN_ARROWS = "input, textarea, select, [contenteditable], [role=radiogroup], [role=listbox], [role=slider]";

/** The setting `key` (an e.key) moves and by how much, or null when the
 *  scene gives that key nothing. */
export function arrowNudge(arrows: SceneArrows | undefined, key: string, shift: boolean): { setting: string; by: number } | null {
  const arrow = ARROWS[key];
  if (!arrows || !arrow) return null;
  const slot = arrows[shift ? SHIFTED[arrow.pair] : arrow.pair];
  return slot ? { setting: slot.setting, by: slot.by * arrow.sign } : null;
}

function controlKeepsArrows(e: KeyboardEvent): boolean {
  return e.defaultPrevented || (e.target instanceof Element && e.target.closest(OWN_ARROWS) !== null);
}

export interface SceneArrowDeps {
  get(sceneId: string, spec: SceneSetting): number;
  set(sceneId: string, spec: SceneSetting, value: number): void;
}

/** Moves the setting a press names and claims the press. Returns the
 *  setting and its new value, or null when the press isn't the scene's. */
export function handleSceneArrows(e: KeyboardEvent, card: SceneCard, deps: SceneArrowDeps): { spec: SceneSetting; value: number } | null {
  const nudge = arrowNudge(card.arrows, e.key, e.shiftKey);
  if (!nudge || controlKeepsArrows(e)) return null;
  const spec = card.settings?.find((s) => s.key === nudge.setting);
  if (!spec) return null;
  e.preventDefault();
  // Rounded so twenty presses of 0.05 store 1, not 1.0000000000000002.
  const value = Math.min(spec.max, Math.max(spec.min, Number((deps.get(card.id, spec) + nudge.by).toFixed(6))));
  deps.set(card.id, spec, value);
  return { spec, value };
}
