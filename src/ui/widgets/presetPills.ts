import { registerWidget, type WidgetCtx } from "./registry.ts";
import type { PanelSection } from "../../render/scene.ts";
import type { SceneSetting } from "../../render/sceneSettings.ts";
import { quantize, valuesMatch } from "./consoleMath.ts";

/**
 * A row of preset pills for a scene's Scene card (Sweep's Presets: the
 * pieces of the reel it was built from, src/render/scenes/sweep/pieces.ts).
 * A press writes every setting its preset lists through the same path a
 * slider drag uses, so those settings leave Auto, reach the pop-out output
 * and a room's TV, and are kept in a saved Look. A press never touches a
 * wire. A preset meant to bring back a whole picture lists every setting it
 * governs, defaults included; one that lists a few keys nudges only those.
 *
 * A press that changes anything rebuilds the whole card (`ctx.rerender()`,
 * registry.ts's header), the same as a Look apply, since it can change most
 * rows at once. The pill whose values the stored settings still hold reads
 * as pressed and shows its hint under the row, like the Strain Console's
 * presets (strainConsole.ts). The section's `options` are a
 * `PresetPillsOptions`.
 */

export interface PanelPreset {
  name: string;
  /** One line under the row while this preset is pressed; also the pill's
   *  tooltip. */
  hint: string;
  /** Setting key → the value a press writes. */
  values: Readonly<Record<string, number>>;
}

export interface PresetPillsOptions {
  presets: readonly PanelPreset[];
}

type Get = (spec: SceneSetting) => number;

/** What a press of `preset` writes: each listed setting the scene has, snapped
 *  to its step, skipping the ones already there (so a press doesn't pin
 *  untouched settings out of Auto). */
export function presetWrites(preset: PanelPreset, specs: readonly SceneSetting[], get: Get): [SceneSetting, number][] {
  const out: [SceneSetting, number][] = [];
  for (const [key, v] of Object.entries(preset.values)) {
    const spec = specs.find((s) => s.key === key);
    if (!spec) continue;
    const q = quantize(v, spec);
    if (q !== get(spec)) out.push([spec, q]);
  }
  return out;
}

/** The first preset whose every listed setting still holds its value (to half
 *  a step), or −1. */
export function pressedPreset(presets: readonly PanelPreset[], specs: readonly SceneSetting[], get: Get): number {
  return presets.findIndex((preset) =>
    Object.entries(preset.values).every(([key, v]) => {
      const spec = specs.find((s) => s.key === key);
      return !spec || valuesMatch([get(spec)], [quantize(v, spec)], spec);
    }),
  );
}

function buildPresetPills(container: HTMLElement, section: PanelSection, ctx: WidgetCtx): void {
  const presets = (section.options as PresetPillsOptions | undefined)?.presets ?? [];
  if (!presets.length) return;

  const pills = document.createElement("div");
  pills.className = "vc-exp-pills";
  const hint = document.createElement("p");
  hint.className = "vc-exp-hyp";
  const buttons = presets.map((preset) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vc-exp-pill";
    b.textContent = preset.name;
    b.title = preset.hint;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      const writes = presetWrites(preset, ctx.specs, ctx.get);
      for (const [spec, v] of writes) ctx.set(spec, v);
      // Rebuild the card the way a Look apply does: a chip picker (Shape,
      // Palette) only redraws its pick on a rebuild.
      if (writes.length) ctx.rerender();
    });
    pills.appendChild(b);
    return b;
  });
  container.append(pills, hint);

  const watched = [...new Set(presets.flatMap((p) => Object.keys(p.values)))]
    .map((key) => ctx.specs.find((s) => s.key === key))
    .filter((s): s is SceneSetting => !!s);
  let lastSig = "";
  const sync = (): void => {
    const sig = watched.map((s) => ctx.get(s)).join(",");
    if (sig === lastSig) return;
    lastSig = sig;
    const active = pressedPreset(presets, ctx.specs, ctx.get);
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === active)));
    hint.textContent = active >= 0 ? presets[active]!.hint : "";
  };
  sync();
  ctx.onTick(sync);
}

registerWidget("presetPills", buildPresetPills);
