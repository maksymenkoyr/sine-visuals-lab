/**
 * Every wire from an input arrives through a modifier. Window, Smoothness,
 * Length and Height live on modifiers (the panel's middle column), so a wire
 * plugged straight from an input would leave the user pressing "+ Modifier"
 * before they could shape it. Instead the window the user edits in puts each
 * plain input wire through a modifier: a scene's default wires (a scene still
 * declares plain wires in `SceneSetting.drive.default`, its recipe), wires
 * saved before modifiers existed, and each wire plugged in from an input jack.
 *
 * The modifiers are shared: one neutral modifier per input (and per Height),
 * reused by every wire from that input in every scene, as a Vizibeat chain is
 * built once and read anywhere. Neutral means what "+ Modifier" makes for a
 * wire with no window of its own: window off and Length off, so it reads
 * exactly what the plain wire read and the picture does not change; a hit
 * input's own edges pass through it (drives.ts's `fired()`). Editing it
 * changes every setting plugged into it, and the next wire from that input
 * then finds no neutral one and makes a fresh one. "+ New modifier" in the
 * column is the way to give one setting a modifier of its own.
 *
 * Only catalogue wires go through a modifier: a beat grid, the drawn line and
 * a Beat wave with its own every-N-beats divider have no modifier input, so
 * they stay plain. With the device's modifiers full (SHAPING_NODES_MAX), a
 * wire stays plain too.
 *
 * "Is this setting still its default?" (the Reset link, a Look leaving the
 * setting out) reads a wire through a neutral modifier as the plain wire it
 * stands for (isDefaultDriveSetting). So a Look stays the same, and applying
 * it resets the setting, which puts it back through a modifier here.
 *
 * Only the main window calls the store functions here (app.ts: after a mount,
 * a Look, a Reset, any wire edit, or a room's Main it follows). The pop-out and a room's TV get the
 * result through the synced stores, and until it arrives they read the plain
 * wires, which draw the same picture.
 */
import { defaultDriveSetting, isShapedChoice, normalizeDriveSetting, sameDriveSetting, type DriveSetting, type DriveSource, type HitHeight } from "./drives.ts";
import { getDriveSetting, setDriveSetting } from "./driveStore.ts";
import type { SceneSetting } from "./sceneSettings.ts";
import { addShapingNode, getShapingNode, listShapingNodes, sameShapingNodeDef, type ShapingNodeDef } from "./shapingNodes.ts";
import { GENERIC_SMOOTHNESS_DEFAULT, GENERIC_THRESHOLD_DEFAULT, GENERIC_WINDOW_MAX_DEFAULT } from "./gateWindow.ts";
import type { SignalId } from "./signals.ts";

/** The modifier that reads exactly what a plain wire from `src` reads:
 *  "+ Modifier"'s starting values with the window off. */
export function neutralModifierDef(src: SignalId, height: HitHeight = "graded"): ShapingNodeDef {
  return {
    src,
    windowOn: false,
    min: GENERIC_THRESHOLD_DEFAULT,
    max: GENERIC_WINDOW_MAX_DEFAULT,
    smoothOn: true,
    smoothness: GENERIC_SMOOTHNESS_DEFAULT,
    height,
    length: 0,
  };
}

function canGoThroughModifier(src: DriveSource): src is DriveSource & { choice: SignalId } {
  return typeof src.choice === "string" && (src.every === undefined || src.every === 1);
}

/** `setting` with each plain catalogue wire re-pointed at the modifier
 *  `modifierFor` names (null keeps that wire plain). Weight, role and mute
 *  stay on the wire; Height moves into the modifier. */
export function throughModifiers(setting: DriveSetting, modifierFor: (def: ShapingNodeDef) => string | null): DriveSetting {
  if (setting === "scene") return "scene";
  const sources = setting.sources.map((src): DriveSource => {
    if (!canGoThroughModifier(src)) return src;
    const id = modifierFor(neutralModifierDef(src.choice, src.height ?? "graded"));
    if (id === null) return src;
    return { choice: { source: "shaped", id }, weight: src.weight, ...(src.when ? { when: true as const } : {}), ...(src.off ? { off: true as const } : {}) };
  });
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** The inverse, for comparing with a scene's default: each wire through a
 *  neutral modifier becomes the plain wire it stands for. */
export function withoutNeutralModifiers(setting: DriveSetting, modifierDef: (id: string) => ShapingNodeDef | undefined): DriveSetting {
  if (setting === "scene") return "scene";
  const sources = setting.sources.map((src): DriveSource => {
    if (!isShapedChoice(src.choice)) return src;
    const def = modifierDef(src.choice.id);
    if (!def || !sameShapingNodeDef(def, neutralModifierDef(def.src, def.height))) return src;
    return {
      choice: def.src,
      weight: src.weight,
      ...(def.height !== "graded" ? { height: def.height } : {}),
      ...(src.when ? { when: true as const } : {}),
      ...(src.off ? { off: true as const } : {}),
    };
  });
  return normalizeDriveSetting({ mix: setting.mix, sources });
}

/** Whether `setting` is `spec`'s scene default, with or without its wires
 *  through neutral modifiers. */
export function isDefaultDriveSetting(spec: SceneSetting, setting: DriveSetting): boolean {
  const def = defaultDriveSetting(spec);
  return sameDriveSetting(setting, def) || sameDriveSetting(withoutNeutralModifiers(setting, getShapingNode), def);
}

/** The first neutral modifier like `def` on this device, or a new one;
 *  null when the device has no room for another. */
function sharedModifier(def: ShapingNodeDef): string | null {
  const same = listShapingNodes().find((n) => sameShapingNodeDef(n, def));
  return same ? same.id : (addShapingNode(def.src, def)?.id ?? null);
}

/** Each setting in `specs` gets its plain input wires through shared
 *  modifiers, whether they are the scene's default or the user's. */
export function wiresThroughModifiers(sceneId: string, specs: readonly SceneSetting[]): void {
  for (const spec of specs) {
    if (!spec.drive) continue;
    const setting = getDriveSetting(sceneId, spec);
    if (setting === "scene" || !setting.sources.some(canGoThroughModifier)) continue;
    const through = throughModifiers(setting, sharedModifier);
    if (!sameDriveSetting(through, setting)) setDriveSetting(sceneId, spec, through);
  }
}

/** The wire from input `src` in `setting`, through whichever modifier, or -1. */
export function wireFromInput(setting: DriveSetting, src: SignalId): number {
  if (setting === "scene") return -1;
  return setting.sources.findIndex((s) => s.choice === src || (isShapedChoice(s.choice) && getShapingNode(s.choice.id)?.src === src));
}
