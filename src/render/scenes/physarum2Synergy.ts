/**
 * Stain Synergy for Physarum 2: the four strains' stains pulled toward the
 * nearest colour harmony. Pure — no GL, no DOM — so physarum2.ts (the dish),
 * the Strain Console's hue wheel (src/ui/widgets/) and tests/physarum2Synergy
 * all read the one fit. Ported from the Strain Console prototype
 * (docs/scenes/physarum2/artifacts/strain-console.html, "stain synergy").
 *
 * The stored stains stay exactly what the person set (the `stain<k>`
 * settings); what the dish shows is those pulled toward the nearest harmony by
 * the Synergy setting (0 = exactly what was set, 1 = exactly the harmony), so
 * turning Synergy back down gives the set colours back. "Nearest" tries every
 * harmony in HARMONIES, every way of giving the four strains its four places,
 * and — with no anchor — the best rotation; with an anchor (the stain last
 * changed by hand) the rotation is fixed so that stain stays exactly where it
 * was put and the other three move. The current harmony is kept unless another
 * fits clearly better (HARMONY_STICK), so a drag doesn't flicker between two
 * that fit about as well.
 *
 * Hues are in turns (0..1) throughout. A Physarum 2 stain is a hue *shift*
 * over the strain's own base colour (`hueRotateRGB` in physarum2.ts), so the
 * tracker below takes each strain's base hue and works on base + shift.
 */

export interface Harmony {
  name: string;
  /** Hue offsets in degrees from the first place — four places, one per strain. */
  at: readonly number[];
}

export const HARMONIES: readonly Harmony[] = [
  { name: "Square", at: [0, 90, 180, 270] },
  { name: "Rectangle", at: [0, 60, 180, 240] },
  { name: "Two pairs", at: [0, 30, 180, 210] },
  { name: "Split", at: [0, 150, 180, 210] },
  { name: "Analogous", at: [0, 30, 60, 90] },
];

/** Every way of giving four strains four places. */
const PERMS: number[][] = [];
(function perm(a: number[], rest: number[]): void {
  if (!rest.length) {
    PERMS.push(a);
    return;
  }
  rest.forEach((x, i) => perm([...a, x], rest.filter((_, j) => j !== i)));
})([], [0, 1, 2, 3]);

/** A different harmony must fit this much better (cost ratio) to replace the
 *  current one. */
export const HARMONY_STICK = 1.6;

/** The shortest signed distance between two hues, in turns: (-0.5, 0.5]. */
export const wrapTurn = (d: number): number => d - Math.round(d);
export const unitTurn = (h: number): number => ((h % 1) + 1) % 1;

export interface HarmonyFit {
  cost: number;
  name: string;
  /** Where each strain lands, in turns 0..1. */
  target: number[];
}

/** The nearest harmony to four hues (turns). `anchor` is the index of the hue
 *  that must stay exactly where it is (-1 for none: the best rotation);
 *  `keep` is the current harmony's name, kept unless another fits clearly
 *  better (HARMONY_STICK). */
export function nearestHarmony(h: readonly number[], anchor: number, keep?: string): HarmonyFit {
  let best: HarmonyFit | null = null;
  let kept: HarmonyFit | null = null;
  for (const hm of HARMONIES) {
    for (const pm of PERMS) {
      const off = pm.map((j) => hm.at[j]! / 360);
      let rot: number;
      if (anchor >= 0) {
        rot = h[anchor]! - off[anchor]!;
      } else {
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < 4; i++) {
          const a = (h[i]! - off[i]!) * 2 * Math.PI;
          sx += Math.cos(a);
          sy += Math.sin(a);
        }
        rot = Math.atan2(sy, sx) / (2 * Math.PI);
      }
      let cost = 0;
      for (let i = 0; i < 4; i++) cost += wrapTurn(rot + off[i]! - h[i]!) ** 2;
      const fit: HarmonyFit = { cost, name: hm.name, target: off.map((o) => unitTurn(rot + o)) };
      if (!best || cost < best.cost) best = fit;
      if (hm.name === keep && (!kept || cost < kept.cost)) kept = fit;
    }
  }
  return kept && kept.cost <= best!.cost * HARMONY_STICK + 1e-5 ? kept : best!;
}

export interface SynergyResult {
  /** Each strain's stain shift as shown, in turns: the set shift pulled toward
   *  the harmony. Exactly the set shift at synergy 0. */
  shift: number[];
  /** Index into HARMONIES of the harmony the four hues are being pulled toward. */
  harmony: number;
}

export interface SynergyTracker {
  /** `rawShift` are the four stored stain shifts (turns), `synergy` 0..1. */
  update(rawShift: readonly number[], synergy: number): SynergyResult;
}

/** Remembers, between frames, which stain was changed last (the anchor) and
 *  which harmony is current (the sticky choice). A stain is "changed by hand"
 *  when it alone moved; several moving together (Link, Alt, a Look, a reset)
 *  frees the rotation instead. */
export function createSynergyTracker(baseHue: readonly number[]): SynergyTracker {
  let prev: number[] | null = null;
  let anchor = -1;
  let keep: string | undefined;
  let lastKey = "";
  let last: SynergyResult = { shift: baseHue.map(() => 0), harmony: 0 };
  return {
    update(rawShift, synergy) {
      if (prev) {
        const changed: number[] = [];
        for (let k = 0; k < rawShift.length; k++) if (Math.abs(rawShift[k]! - prev[k]!) > 1e-6) changed.push(k);
        if (changed.length === 1) anchor = changed[0]!;
        else if (changed.length > 1) anchor = -1;
      }
      prev = rawShift.slice();
      const key = `${rawShift.join(",")}|${synergy}|${anchor}`;
      if (key === lastKey) return last;
      lastKey = key;
      const hues = rawShift.map((s, k) => baseHue[k]! + s);
      const fit = nearestHarmony(hues, anchor, keep);
      keep = fit.name;
      const s = Math.max(0, Math.min(1, synergy));
      const shift = rawShift.map((raw, k) => raw + s * wrapTurn(fit.target[k]! - hues[k]!));
      last = { shift, harmony: Math.max(0, HARMONIES.findIndex((hm) => hm.name === fit.name)) };
      return last;
    },
  };
}
