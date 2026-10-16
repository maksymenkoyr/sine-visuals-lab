// The pieces of the Colorem reel as Sweep knob values: the Presets row at the
// top of Sweep's Scene card (src/ui/widgets/presetPills.ts), and the values
// docs/scenes/sweep/scripts/ shoots and pairs against the reel (lookcodes.ts
// prints them as Look links, or as JSON for shoot_pieces.mjs and
// pair_pieces.py).
//
// A piece lists only the knobs it moves off their defaults. `presetValues`
// fills in every other setting at its default, so a press brings back the
// whole picture rather than nudging a few knobs on top of whatever was set.
// It leaves the settings in KEPT_BY_PIECES alone, and never touches a wire.
// Each piece carries the path seed it was tuned on, so a press shows the
// stack where it was judged against the reel; New path rolls on from there.
//
// The values are by eye against the reel (the record's Tuning notes), not
// measured: starting points.
import type { SceneSetting } from "../../sceneSettings.ts";
import { OUTLINE_STYLES, PALETTES, SHAPES } from "./stack.ts";

export interface Piece {
  name: string;
  /** Seconds into the reel where this piece is: the frame pair_pieces.py
   *  sets ours beside. */
  ref: number;
  /** One line under the Presets row while this piece is pressed. */
  hint: string;
  /** The path seed the piece was tuned on. */
  path: number;
  /** The knobs this piece moves off their defaults. */
  values: Readonly<Record<string, number>>;
}

const shape = (name: (typeof SHAPES)[number]): number => SHAPES.indexOf(name);
const outlineStyle = (name: (typeof OUTLINE_STYLES)[number]): number => OUTLINE_STYLES.indexOf(name);
function palette(name: string): number {
  const i = PALETTES.findIndex((p) => p.name === name);
  if (i < 0) throw new Error(`sweep: unknown palette ${name}`);
  return i;
}

/** In the reel's order. */
export const PIECES: readonly Piece[] = [
  {
    name: "Smear",
    ref: 1.0,
    hint: "Discs smeared along a curve, the tail soft and fading out",
    path: 100,
    values: {
      shape: shape("Disc"),
      copies: 40,
      size: 0.28,
      taper: 0.1,
      travel: 0.6,
      bend: 0.5,
      palette: palette("Mint"),
      bandCount: 0.6,
      head: 0,
      rim: 0.45,
      sheen: 0.15,
      outline: 0.006,
      outlineStyle: outlineStyle("Ink"),
      outlineReach: 0.08,
      blur: 0.18,
      fade: 0.85,
    },
  },
  {
    name: "Contours",
    ref: 3.5,
    hint: "Drops in bevelled bands, the colours holding still",
    path: 101,
    values: { rim: 0.8, colourFlow: 0 },
  },
  {
    name: "Halo",
    ref: 5.0,
    hint: "A few blobs turning on a short path, outlined in the palette's colours",
    path: 102,
    values: {
      shape: shape("Blob"),
      copies: 14,
      size: 0.2,
      taper: -0.6,
      twist: 30,
      travel: 0.15,
      bend: 0,
      palette: palette("Opal"),
      bandCount: 1,
      head: 0.4,
      rim: 0.6,
      sheen: 0.2,
      outline: 0.011,
      outlineStyle: outlineStyle("Palette"),
      blur: 0.02,
    },
  },
  {
    name: "Drip",
    ref: 7.5,
    hint: "Small drops shrinking along a long curve, the tail soft and faded",
    path: 103,
    values: {
      shape: shape("Drop"),
      copies: 48,
      size: 0.07,
      taper: -1,
      travel: 1.1,
      bend: 0.6,
      palette: palette("Honey"),
      shift: 0.62,
      bandCount: -0.6,
      head: 0.5,
      rim: 0.3,
      sheen: 0.15,
      outline: 0.005,
      outlineStyle: outlineStyle("Ink"),
      outlineReach: 0.3,
      blur: 0.14,
      fade: 0.8,
      colourFlow: 0,
    },
  },
  {
    name: "Rings",
    ref: 9.5,
    hint: "Big see-through discs spreading both ways, in many colour bands",
    path: 104,
    values: {
      shape: shape("Disc"),
      copies: 22,
      size: 0.47,
      taper: 0,
      travel: 0.5,
      bend: 0,
      spread: 1,
      palette: palette("Prism"),
      bandCount: 2.5,
      head: 0.6,
      rim: 0.3,
      sheen: 0.3,
      opacity: 0.1,
      outline: 0.011,
      outlineStyle: outlineStyle("Palette"),
      fade: 0.2,
    },
  },
  {
    name: "Candy",
    ref: 11.0,
    hint: "Blobs drawn in flat horizontal steps",
    path: 105,
    values: {
      shape: shape("Blob"),
      copies: 30,
      size: 0.4,
      taper: -0.5,
      travel: 0.6,
      bend: 0.4,
      palette: palette("Candy"),
      bandCount: 2,
      head: 0,
      rim: 0.6,
      outline: 0.006,
      outlineStyle: outlineStyle("Palette"),
      steps: 0.35,
    },
  },
  {
    name: "Panels",
    ref: 13.8,
    hint: "Two stacks of boxes leaving the middle, darker where they overlap",
    path: 106,
    values: {
      shape: shape("Box"),
      copies: 28,
      size: 0.26,
      taper: 0.8,
      travel: 0.3,
      bend: 0,
      aim: 1,
      pair: 1,
      palette: palette("Pool"),
      bandCount: 0.15,
      head: 0,
      opacity: 0.82,
      multiply: 1,
      outline: 0.005,
      outlineStyle: outlineStyle("Ink"),
      outlineReach: 0.1,
      blur: 0.1,
      fade: 0.95,
      colourFlow: 0,
    },
  },
  {
    name: "Cubes",
    ref: 15.3,
    hint: "Two long stacks of cubes coming in to the middle, darker where they overlap",
    path: 107,
    values: {
      shape: shape("Cube"),
      copies: 64,
      size: 0.2,
      taper: 0,
      travel: 1.3,
      bend: 0.5,
      aim: -1,
      pair: 1,
      palette: palette("Ember"),
      bandCount: 1,
      head: 0,
      faces: 1,
      multiply: 1,
      outline: 0.004,
      outlineStyle: outlineStyle("Ink"),
      outlineReach: 0.05,
      blur: 0.08,
      fade: 0.55,
      colourFlow: 0,
    },
  },
  {
    name: "Haze",
    ref: 16.8,
    hint: "A few big cubes, blurred from the tail right up to the head",
    path: 108,
    values: {
      shape: shape("Cube"),
      copies: 10,
      size: 0.7,
      taper: 0.05,
      travel: 1.0,
      bend: 0.4,
      pair: 1,
      palette: palette("Peach"),
      bandCount: 0.9,
      head: 0,
      rim: 0.2,
      sheen: 0.4,
      faces: 0.2,
      opacity: 0.9,
      multiply: 0.5,
      outline: 0,
      blur: 0.5,
      headBlur: 0.7,
      fade: 0.4,
    },
  },
  {
    name: "Flame",
    ref: 19.0,
    hint: "Dense drops packed into stripes, the colours flowing",
    path: 109,
    values: {
      shape: shape("Drop"),
      copies: 120,
      size: 0.9,
      taper: -2,
      travel: 0.5,
      bend: 0.2,
      aim: 1,
      palette: palette("Flame"),
      bandCount: 4,
      head: 0,
      rim: 0,
      outline: 0,
      colourFlow: 0.4,
    },
  },
];

/** Settings a piece leaves as they are: how often the path re-rolls is the
 *  performer's call, not part of the picture. */
export const KEPT_BY_PIECES: readonly string[] = ["newPath"];

/** Everything a press of `piece` writes: every setting but KEPT_BY_PIECES at
 *  its default, then the piece's own knobs and its path seed. */
export function presetValues(piece: Piece, settings: readonly SceneSetting[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of settings) if (!KEPT_BY_PIECES.includes(s.key)) out[s.key] = s.default;
  return Object.assign(out, piece.values, { path: piece.path });
}
