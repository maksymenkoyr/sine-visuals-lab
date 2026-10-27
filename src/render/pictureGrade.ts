/**
 * The projector grade: corrections the Output card applies to the pop-out's
 * finished picture, in compositor.ts's last pass, for a cheap projector. Such
 * a projector lays a scene's dim haze over the whole wall as a grey sheet,
 * sinks the middle greys into the room's light and washes colour out. The
 * pass applies the three in this order:
 *
 * - floor: everything at or below it turns black, and the rest is stretched
 *   back so white stays white.
 * - mids: a power curve on the greys between, black and white kept. The
 *   exponent is 2^-mids, so a positive value brightens them.
 * - colour: saturation against Rec. 709 luma, on the sRGB values the canvas
 *   holds; 1 leaves it as it was.
 *
 * NEUTRAL_GRADE is no pass at all, so an output nobody graded costs nothing
 * extra on the GPU. Like its Quality, the grade belongs to the output window:
 * it travels in the `power` message (net/outputSync.ts), never in a look, a
 * Cue or a room.
 */

export interface PictureGrade {
  floor: number;
  mids: number;
  colour: number;
}

export const NEUTRAL_GRADE: PictureGrade = { floor: 0, mids: 0, colour: 1 };

/** Past this the floor eats the dim half of most scenes, not their haze. */
export const GRADE_FLOOR_MAX = 0.3;
export const GRADE_MIDS_MAX = 1;
export const GRADE_COLOUR_MAX = 2;

function clampTo(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

/** Each field into its range; a missing or non-number field (a `power`
 *  message from an older main window, junk in storage) is the neutral one. */
export function clampGrade(value: unknown): PictureGrade {
  const g = typeof value === "object" && value !== null ? (value as Partial<Record<keyof PictureGrade, unknown>>) : {};
  return {
    floor: clampTo(g.floor, 0, GRADE_FLOOR_MAX, NEUTRAL_GRADE.floor),
    mids: clampTo(g.mids, -GRADE_MIDS_MAX, GRADE_MIDS_MAX, NEUTRAL_GRADE.mids),
    colour: clampTo(g.colour, 0, GRADE_COLOUR_MAX, NEUTRAL_GRADE.colour),
  };
}

export function isNeutralGrade(g: PictureGrade): boolean {
  return g.floor === NEUTRAL_GRADE.floor && g.mids === NEUTRAL_GRADE.mids && g.colour === NEUTRAL_GRADE.colour;
}

/** The pass's `uGrade`: the floor, the mids exponent and the colour. */
export function gradeUniform(g: PictureGrade): [number, number, number] {
  return [g.floor, Math.pow(2, -g.mids), g.colour];
}
