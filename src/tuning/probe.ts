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
import { getPin } from "./pins.ts";
import { isAutoEnabled, resolveSceneSetting } from "../render/autoTune.ts";

export interface ProbeInput {
  sceneId: string;
  settings: SceneSetting[];
  quality: string;
  fps: number;
  vis: FeatureFrame | null;
  anim: AnimFrame | null;
  /** Governor-controlled canvas scale (1 = full detected-preset resolution)
   *  and step index (0 = no downgrade yet) — surfaced so a capture session
   *  can tell "the scene looks soft" apart from "the governor quietly
   *  downgraded it" instead of guessing from pixels. */
  renderScale: number;
  govLevel: number;
}

export interface ProbeSettingValue {
  base: number;
  resolved: number;
  /** "override" (pinned by the tuning bus, incl. auto-pin), "pin" (typed
   *  into the row past its spec range — see tuning/pins.ts), "auto"
   *  (music-driven), or "manual" (auto disabled for this key,
   *  resolved === base). */
  mode: "override" | "pin" | "auto" | "manual";
}

export interface ProbeSnapshot {
  t: number;
  fps: number;
  quality: string;
  scene: string;
  renderScale: number;
  govLevel: number;
  bands: { low: number; mid: number; high: number; energy: number };
  beat: { fired: boolean; bpm: number; phase: number; onGrid: boolean };
  section: number;
  drop: number;
  centroid: number;
  settings: Record<string, ProbeSettingValue>;
}

export function buildProbeSnapshot(input: ProbeInput): ProbeSnapshot {
  const { sceneId, settings, vis, anim } = input;
  const settingValues: Record<string, ProbeSettingValue> = {};
  for (const spec of settings) {
    const base = getSceneSetting(sceneId, spec);
    const resolved = resolveSceneSetting(sceneId, spec);
    // A macro-driven spec (spec.macro) is auto-capable the same way an
    // `auto` one is — see autoTune.ts's header — so it counts here too, or
    // every sparkle sub-param would misreport as "manual" while it's
    // actively tracking its driver.
    // Mirrors resolve()'s precedence exactly (autoTune.ts): an override
    // beats a pin beats auto-pin, so this can't mislabel a row whose value
    // actually came from a pin as "override" just because auto-pin also
    // happens to be on.
    const mode: ProbeSettingValue["mode"] =
      getOverride(sceneId, spec.key) !== undefined
        ? "override"
        : getPin(sceneId, spec.key) !== undefined
          ? "pin"
          : isAutoPinned()
            ? "override"
            : (spec.auto || spec.macro) && isAutoEnabled(sceneId, spec.key)
              ? "auto"
              : "manual";
    settingValues[spec.key] = { base, resolved, mode };
  }

  return {
    t: vis?.time ?? 0,
    fps: input.fps,
    quality: input.quality,
    scene: sceneId,
    renderScale: input.renderScale,
    govLevel: input.govLevel,
    bands: { low: anim?.low ?? 0, mid: anim?.mid ?? 0, high: anim?.high ?? 0, energy: vis?.energy ?? 0 },
    beat: { fired: anim?.onset ?? false, bpm: vis?.bpm ?? 0, phase: anim?.beatPhase ?? 0, onGrid: anim?.onGrid ?? false },
    section: anim?.sectionIntensity ?? 0,
    drop: anim?.dropPulse ?? 0,
    centroid: anim?.centroid ?? 0,
    settings: settingValues,
  };
}

/** One-line-per-setting text rendering — this is what actually goes back to
 *  the tuning session, not the raw JSON: cheap to read, cheap to send. */
export function formatProbe(snap: ProbeSnapshot): string {
  const lines: string[] = [];
  lines.push(
    `t=${snap.t.toFixed(2)} fps=${snap.fps.toFixed(0)} quality=${snap.quality} scene=${snap.scene} scale=${snap.renderScale.toFixed(2)} gov=${snap.govLevel}`,
  );
  lines.push(
    `low=${snap.bands.low.toFixed(2)} mid=${snap.bands.mid.toFixed(2)} high=${snap.bands.high.toFixed(2)} energy=${snap.bands.energy.toFixed(2)}`,
  );
  lines.push(
    `beat=${snap.beat.fired ? 1 : 0}${snap.beat.onGrid ? "(grid)" : ""} bpm=${snap.beat.bpm.toFixed(1)} phase=${snap.beat.phase.toFixed(2)} | section=${snap.section.toFixed(2)} drop=${snap.drop.toFixed(2)} centroid=${snap.centroid.toFixed(2)}`,
  );
  for (const [key, v] of Object.entries(snap.settings)) {
    const tag =
      v.mode === "override"
        ? "pinned"
        : v.mode === "pin"
          ? "typed"
          : v.mode === "auto"
            ? `auto ${(v.resolved - v.base >= 0 ? "+" : "") + (v.resolved - v.base).toFixed(2)}`
            : "manual";
    lines.push(`  ${key}=${v.resolved.toFixed(3)} (base ${v.base.toFixed(3)}, ${tag})`);
  }
  return lines.join("\n");
}
