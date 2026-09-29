import type { FeatureFrame } from "../audio/types.ts";
import type { QualitySettings } from "./quality.ts";
import type { Palette } from "./palette.ts";
import { registerVariant, type SceneSetting } from "./sceneSettings.ts";
import type { AnimFrame } from "./animClock.ts";
import type { SceneDrives } from "./drives.ts";

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
  quality: QualitySettings;
}

/** One custom group in the device menu's Scene card, rendered ahead of the
 *  plain per-setting loop — see src/render/sceneItems.ts's header for the
 *  item/panel split this exists for, and src/ui/widgets/registry.ts for how
 *  `widget` is resolved to an actual builder. Plain data: nothing here
 *  touches the DOM, so a scene stays importable under node (every test) and
 *  ignorable by the TV/a paid private scene, which never open a device menu
 *  at all. `items` names the `SceneSetting.item.family` this section claims
 *  — every setting in the scene's own `settings` array carrying that family
 *  is hidden from the flat loop and left to the widget instead. */
export interface PanelSection {
  /** A registered id in src/ui/widgets/registry.ts (e.g. "itemBoxes"). */
  widget: string;
  /** The group heading shown above this section, same voice as
   *  SceneSetting.group ("Strains", "Affinity") — not restricted to
   *  SETTING_GROUPS, since a panel section names the scene's own concept
   *  rather than the closed Form/Motion/Look/Camera/Post vocabulary. */
  title: string;
  hint?: string;
  /** The SceneSetting.item.family this section claims and renders. Omit
   *  for a future widget with nothing item-shaped to claim. */
  items?: string;
  /** Keys of plain (non-item) settings this section renders itself (through
   *  `WidgetCtx.appendRow`, next to what they belong with) — the Scene card's
   *  flat list skips them so they aren't shown twice. */
  settings?: readonly string[];
  /** Widget-specific configuration — each widget's own module documents its
   *  shape (e.g. itemBoxes.ts's ItemBoxesOptions). */
  options?: unknown;
}

export interface Scene {
  id: string;
  name: string;
  /** Lowest quality preset this scene is willing to run on; omitted = runs everywhere. */
  minQuality?: "mid" | "low" | "floor";
  /** User-tunable parameters shown in the device menu, uploaded as uniform float u<Key>. */
  settings?: SceneSetting[];
  /** Custom Scene-card groups this scene declares, rendered ahead of the
   *  plain per-setting rows — see PanelSection above. Omit for a scene with
   *  nothing custom to show (every setting renders as an ordinary row). */
  panel?: readonly PanelSection[];
  /** Optional read-only snapshot of live scene-internal state for the device
   *  menu's own widgets (Physarum 2's specimen-box POP/TERR readouts —
   *  src/ui/widgets/registry.ts's `WidgetCtx.probe`) — phone-local only, the
   *  TV never calls this and neither does a Look/setting. Must be cheap:
   *  a widget may call it every tick. A scene is free to return stale values
   *  and throttle its own expensive work internally (see physarum2.ts's
   *  territory readback) rather than doing it here. Omit for a scene with
   *  nothing to report. */
  probe?(): Record<string, number> | null;
  /** Optional one-shot command from a widget (Physarum 2's pipette/
   *  Rebalance buttons — `WidgetCtx.command`) — phone-local only; the TV
   *  never calls this and it never becomes part of a setting or a Look.
   *  `args` are always plain numbers, this scene's own settings convention —
   *  a scene documents its own command names/args in its file header. Must
   *  be cheap: queue the actual work for the next render() rather than doing
   *  it here (see physarum2.ts's pendingInject/pendingRebalance). Omit for a
   *  scene with no commands. */
  command?(name: string, args: Record<string, number>): void;
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
    /** Resolved SceneSetting.drive values for this render — see
     *  src/render/drives.ts. Optional and defaults to a Scene-only
     *  passthrough (drives.ts's PASSTHROUGH_DRIVES) for every caller not
     *  wired to a real DriveEngine (gallery previews, tests, probes), which
     *  renders exactly as if this scene had no drive settings at all. */
    drives?: SceneDrives,
  ): void;
  dispose(ctx: SceneContext): void;
}

const registry = new Map<string, Scene>();

export function registerScene(scene: Scene): void {
  registry.set(scene.id, scene);
  registerVariant(scene.id, scene.settings);
}

export function getScene(id: string): Scene | undefined {
  return registry.get(id);
}

export function listScenes(): Scene[] {
  return [...registry.values()];
}
