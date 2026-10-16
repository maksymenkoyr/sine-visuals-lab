/**
 * Focus: where a narrow crop of a shot should look.
 *
 * The picture is 16:9. On a portrait phone coverView() crops it to a narrow
 * column, and the middle of the frame is often the wrong column (the wide shot's
 * middle is the porthole; the DJ stands left of it). Every shot therefore has a
 * focus point in art units: the thing the shot is about. frameFocus() maps it
 * through the shot's camera (shake left out, so the crop does not wobble) into
 * the 1600x900 frame, and coverView() centres its crop there, clamped so the
 * crop stays inside the frame.
 *
 * A shot with no entry (the crowd) is a pan: its focus is the centre of the
 * shot's source rectangle, which travels with the pan. Pure: no DOM.
 */
import { FRAME_W, FRAME_H, type Camera, type ShotId } from "./motion.ts";

/** Art-unit focus points. The DJ and the button share one focus; the others
 *  look at the face they cut to. Missing = follow the shot's centre. */
const DJ_FOCUS: [number, number] = [445, 470];
export const SHOT_FOCUS: Partial<Record<ShotId, [number, number]>> = {
  wide: DJ_FOCUS,
  dj: DJ_FOCUS,
  djUp: DJ_FOCUS,
  button: [476, 586],
  raver: [1270, 690],
  pomp: [1080, 360],
};

/** The focus point in frame units (the 1600x900 picture after the shot's camera, no shake). */
export function frameFocus(cam: Camera): { x: number; y: number } {
  const { src } = cam;
  const f = SHOT_FOCUS[cam.shot];
  const s = FRAME_W / src.w;
  const fx = f ? f[0] : src.x + src.w / 2;
  const fy = f ? f[1] : src.y + src.h / 2;
  return { x: FRAME_W / 2 + (fx - (src.x + src.w / 2)) * s, y: FRAME_H / 2 + (fy - (src.y + src.h / 2)) * s };
}

/**
 * The centre of a crop, one axis. The crop is `visible` long and must lie inside
 * [lo, lo + size]; it is centred on `focus` where it can be, else pushed to the
 * nearest edge. A crop as long as the range (or longer) is centred on the range.
 */
export function clampCentre(focus: number, visible: number, lo: number, size: number): number {
  if (visible >= size) return lo + size / 2;
  return Math.min(lo + size - visible / 2, Math.max(lo + visible / 2, focus));
}
