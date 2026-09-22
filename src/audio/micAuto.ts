import type { SceneSetting } from "../render/sceneSettings.ts";

/**
 * The Input card's own "Auto" button (src/ui/deviceMenu.ts) hands the whole
 * mic to auto in one tap. "The whole mic" is a fixed list of members, and
 * this file is where that list lives — nowhere else should ever need to
 * enumerate it again: src/audio/autoGain.ts's own auto flag,
 * src/audio/silenceGate.ts's own auto flag (both device-wide), and the
 * Sensitivity/Expansion/Smoothing pseudo-params src/render/autoTune.ts
 * already tracks per scene (getSensitivitySpec/getExpansionSpec/
 * getSmoothingSpec there). It deliberately does NOT cover a scene's own
 * settings (caustics' focus, mesh grid's density, …) — that's the separate,
 * pre-existing scene master button (autoTune.ts's isSceneAuto/setSceneAuto,
 * wired to deviceMenu.ts's autoMasterBtn), which this button overlaps only
 * on those same Sensitivity/Expansion/Smoothing rows. The two buttons can
 * therefore both be lit, both unlit, or disagree, depending on the
 * non-overlapping members (a scene setting vs. Auto-gain/the gate) — that's
 * a feature, not a bug: they answer two different questions ("is this
 * scene's own look on auto" vs. "is the whole input on auto"), and
 * deviceMenu.ts refreshes each one whenever the other's toggle could have
 * moved it. Every member defaults ON (each one's own module owns that
 * default — src/audio/autoGain.ts, src/audio/silenceGate.ts, autoTune.ts's
 * DEFAULT_AUTO_KEYS), so on a fresh profile the Input card's Auto button
 * itself starts lit.
 *
 * Pure and DOM-free, like autoTune.ts's own isSceneAuto/setSceneAuto: every
 * member is an injected getter/setter (MicAutoMembers) rather than an
 * import, so this is unit-testable without a browser and so app.ts (the
 * only real caller) can wire each member straight from its own existing
 * store functions instead of this module importing them redundantly.
 * `onSettingAutoToggle` in particular must be app.ts's own function of that
 * name (or an equivalent) — the one that seeds autoTune.ts's slew from the
 * current manual value before flipping a pseudo-param's flag — so enabling
 * mic auto never jumps the Sensitivity/Expansion/Smoothing rows the way a
 * bare setAutoEnabled(..., true) would.
 *
 * setMicAuto only ever writes members; it never reads one back to decide
 * what to write, so turning the whole mic off is always exactly "every
 * member off," regardless of what state any individual member happened to
 * be in beforehand — same all-or-nothing contract as autoTune.ts's own
 * setSceneAuto. isMicAuto is lit only when every member is currently on
 * auto — same contract as isSceneAuto — so taking any single member back to
 * manual (its own row's "A" chip, a drag, this button) unlights it.
 */
export interface MicAutoMembers {
  isAutoGainAuto: () => boolean;
  setAutoGainAuto: (on: boolean) => void;
  isSilenceGateAuto: () => boolean;
  setSilenceGateAuto: (on: boolean) => void;
  getSensitivitySpec: () => SceneSetting;
  getExpansionSpec: () => SceneSetting;
  getSmoothingSpec: () => SceneSetting;
  isSettingAutoEnabled: (sceneId: string, key: string) => boolean;
  /** Same shape as app.ts's own onSettingAutoToggle — pass that function
   *  straight through (see this file's header) rather than duplicating its
   *  seed-on-enable logic here. */
  onSettingAutoToggle: (sceneId: string, spec: SceneSetting, on: boolean) => void;
}

function pseudoSpecs(members: MicAutoMembers): SceneSetting[] {
  return [members.getSensitivitySpec(), members.getExpansionSpec(), members.getSmoothingSpec()];
}

/** Whether every member of "the whole mic" (see this file's header) is
 *  currently on auto for this scene — drives the Input card's Auto button. */
export function isMicAuto(sceneId: string, members: MicAutoMembers): boolean {
  return (
    members.isAutoGainAuto() &&
    members.isSilenceGateAuto() &&
    pseudoSpecs(members).every((spec) => members.isSettingAutoEnabled(sceneId, spec.key))
  );
}

/** Writes every member of "the whole mic" to `on`, both directions. */
export function setMicAuto(sceneId: string, on: boolean, members: MicAutoMembers): void {
  members.setAutoGainAuto(on);
  members.setSilenceGateAuto(on);
  for (const spec of pseudoSpecs(members)) members.onSettingAutoToggle(sceneId, spec, on);
}
