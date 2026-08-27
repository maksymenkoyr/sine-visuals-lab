import type { FeatureFrame } from "../audio/types.ts";
import type { TierSettings } from "./tier.ts";
import type { Palette } from "./palette.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import type { AnimFrame } from "./animClock.ts";

/** A room-space rectangle this device is responsible for drawing. Full-frame is {x:0,y:0,w:1,h:1}. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEWPORT: Viewport = { x: 0, y: 0, w: 1, h: 1 };

export interface SceneContext {
  gl: WebGL2RenderingContext;
  tier: TierSettings;
}

export interface Scene {
  id: string;
  name: string;
  /** Lowest tier this scene is willing to run on; omitted = runs everywhere. */
  minTier?: "mid" | "low" | "floor";
  /** User-tunable parameters shown in the device menu, uploaded as uniform float u<Key>. */
  settings?: SceneSetting[];
  init(ctx: SceneContext): void;
  render(
    ctx: SceneContext,
    frame: FeatureFrame,
    viewport: Viewport,
    palette: Palette,
    /** Bundled per-frame animation state — flow phase, phase-locked beat/bar
     *  clock, per-band-group energy/pulses, and section intensity. See
     *  animClock.ts for what composes it and why each piece is derived
     *  rather than read straight off FeatureFrame. */
    anim: AnimFrame,
  ): void;
  dispose(ctx: SceneContext): void;
}

const registry = new Map<string, Scene>();

export function registerScene(scene: Scene): void {
  registry.set(scene.id, scene);
}

export function getScene(id: string): Scene | undefined {
  return registry.get(id);
}

export function listScenes(): Scene[] {
  return [...registry.values()];
}
