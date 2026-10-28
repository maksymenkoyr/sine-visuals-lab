/**
 * The camera by hand: the Camera group's sliders in card.ts (some moved by
 * the arrow keys too, its `arrows`) as offsets on whichever view is on screen,
 * the View chip's camera or each dance's own. Orbit walks the camera round
 * the point it looks at, Tilt swings it over or under, Distance scales how
 * far it stands, Height lifts camera and aim together, and Zoom scales the
 * lens. At their defaults the view is exactly the loop's camera.
 *
 * The scene eases the offsets toward the sliders (`easeHand`), so a key held
 * down, which moves a slider in steps, glides. A cut or a new View chip still
 * jumps: only the offsets ease. Pure — tests/alien.test.ts drives it.
 */
import type { LoopCamera } from "./reel.ts";

export interface CameraHand {
  /** Degrees round the vertical through the aim point. */
  orbit: number;
  /** Degrees up (over him) or down (under him), on top of the view's own. */
  tilt: number;
  /** Times the view's own distance from the aim point. */
  distance: number;
  /** Metres the camera and the aim point both rise. */
  height: number;
  /** Times the view's own focal length. */
  zoom: number;
}

export const HAND_AT_REST: Readonly<CameraHand> = { orbit: 0, tilt: 0, distance: 1, height: 0, zoom: 1 };

/** How far Tilt may swing the camera from level: straight up or down, the
 *  view basis (renderer.ts's cameraBasis) has no right-hand side. */
const PITCH_LIMIT = (80 * Math.PI) / 180;

/** Seconds the offsets take to get most of the way to the sliders. */
const HAND_EASE_SEC = 0.15;

const DEG = Math.PI / 180;

/** `base` moved by `hand`. */
export function handCamera(base: LoopCamera, hand: CameraHand): LoopCamera {
  const [tx, ty, tz] = base.target;
  const dx = base.eye[0] - tx, dy = base.eye[1] - ty, dz = base.eye[2] - tz;
  const flat = Math.hypot(dx, dz);
  const radius = Math.hypot(flat, dy) * hand.distance;
  const yaw = Math.atan2(dx, dz) + hand.orbit * DEG;
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(dy, flat) + hand.tilt * DEG));
  const aimY = ty + hand.height;
  return {
    eye: [tx + radius * Math.cos(pitch) * Math.sin(yaw), aimY + radius * Math.sin(pitch), tz + radius * Math.cos(pitch) * Math.cos(yaw)],
    target: [tx, aimY, tz],
    focal: base.focal * hand.zoom,
  };
}

/** One tick of `hand` easing toward `to` (exponential, frame-rate independent). */
export function easeHand(hand: CameraHand, to: CameraHand, dtSec: number): void {
  const k = 1 - Math.exp(-Math.max(0, dtSec) / HAND_EASE_SEC);
  hand.orbit += (to.orbit - hand.orbit) * k;
  hand.tilt += (to.tilt - hand.tilt) * k;
  hand.distance += (to.distance - hand.distance) * k;
  hand.height += (to.height - hand.height) * k;
  hand.zoom += (to.zoom - hand.zoom) * k;
}
