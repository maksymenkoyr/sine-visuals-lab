/**
 * Compact numeric snapshot of one frame's state — the primitive behind
 * "answer with numbers, not pixels" (see the plan). Pure formatting/shaping
 * logic over data app.ts already has each tick; app.ts supplies it via
 * ProbeInput rather than this module reaching into app.ts's internals.
 */
import type { FeatureFrame } from "../audio/types.ts";
import type { AnimFrame } from "../render/animClock.ts";
import type { SceneSetting } from "../render/sceneSettings.ts";
import { getSceneSetting } from "../render/sceneSettings.ts";
import { getOverride, isAutoPinned } from "./overrides.ts";
import { isFocused } from "./focus.ts";
import { isAutoEnabled, resolveSceneSetting } from "../render/autoTune.ts";

export interface ProbeInput {
  sceneId: string;
  settings: SceneSetting[];
  tier: string;
  fps: number;
  vis: FeatureFrame | null;
  anim: AnimFrame | null;
}

export interface ProbeSettingValue {
  base: number;
  resolved: number;
  /** "override" (pinned by the tuning bus), "auto" (music-driven), or
   *  "manual" (auto disabled for this key, resolved === base). */
  mode: "override" | "auto" | "manual";
  /** Spotlighted by the current tuning session (focus.ts). Carried here so a
   *  probe answers "did the dial we're discussing actually move" in one read,
   *  rather than needing the params file open alongside it. */
  focused?: boolean;
}

export interface ProbeSnapshot {
  t: number;
  fps: number;
  tier: string;
  scene: string;
  bands: { low: number; mid: number; high: number; energy: number };
  beat: { fired: boolean; bpm: number; phase: number };
  section: number;
  drop: number;
  settings: Record<string, ProbeSettingValue>;
}

export function buildProbeSnapshot(input: ProbeInput): ProbeSnapshot {
  const { sceneId, settings, vis, anim } = input;
  const settingValues: Record<string, ProbeSettingValue> = {};
  for (const spec of settings) {
    const base = getSceneSetting(sceneId, spec);
    const resolved = resolveSceneSetting(sceneId, spec);
    const mode: ProbeSettingValue["mode"] =
      getOverride(sceneId, spec.key) !== undefined || isAutoPinned()
        ? "override"
        : spec.auto && isAutoEnabled(sceneId, spec.key)
          ? "auto"
          : "manual";
    settingValues[spec.key] = isFocused(spec.key)
      ? { base, resolved, mode, focused: true }
      : { base, resolved, mode };
  }

  return {
    t: vis?.time ?? 0,
    fps: input.fps,
    tier: input.tier,
    scene: sceneId,
    bands: { low: anim?.low ?? 0, mid: anim?.mid ?? 0, high: anim?.high ?? 0, energy: vis?.energy ?? 0 },
    beat: { fired: vis?.beat ?? false, bpm: vis?.bpm ?? 0, phase: anim?.beatPhase ?? 0 },
    section: anim?.sectionIntensity ?? 0,
    drop: anim?.dropPulse ?? 0,
    settings: settingValues,
  };
}

/** One-line-per-setting text rendering — this is what actually goes back to
 *  the tuning session, not the raw JSON: cheap to read, cheap to send. */
export function formatProbe(snap: ProbeSnapshot): string {
  const lines: string[] = [];
  lines.push(
    `t=${snap.t.toFixed(2)} fps=${snap.fps.toFixed(0)} tier=${snap.tier} scene=${snap.scene}`,
  );
  lines.push(
    `low=${snap.bands.low.toFixed(2)} mid=${snap.bands.mid.toFixed(2)} high=${snap.bands.high.toFixed(2)} energy=${snap.bands.energy.toFixed(2)}`,
  );
  lines.push(
    `beat=${snap.beat.fired ? 1 : 0} bpm=${snap.beat.bpm.toFixed(1)} phase=${snap.beat.phase.toFixed(2)} | section=${snap.section.toFixed(2)} drop=${snap.drop.toFixed(2)}`,
  );
  for (const [key, v] of Object.entries(snap.settings)) {
    const tag = v.mode === "override" ? "pinned" : v.mode === "auto" ? `auto ${(v.resolved - v.base >= 0 ? "+" : "") + (v.resolved - v.base).toFixed(2)}` : "manual";
    // Spotlighted rows lead with a marker so they're findable by eye in a
    // long readout — the same rows the device menu is highlighting.
    const mark = v.focused ? "->" : "  ";
    lines.push(`${mark} ${key}=${v.resolved.toFixed(3)} (base ${v.base.toFixed(3)}, ${tag})`);
  }
  return lines.join("\n");
}
