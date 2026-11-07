/**
 * Walking through a scene and looking round it by hand, like in a game: the
 * half with no DOM, so a scene stays importable under node. src/ui/freeLook.ts
 * fills the input from the mouse and the keys, only while the pointer is
 * locked to the picture of a scene whose card says `freeLook` (SceneCard).
 * The scene drains it once a frame with `takeFreeLook` and moves its camera
 * with a `createWalker`; with no input the walker stands still.
 *
 * One input per page: a page shows one walkable scene at a time, and a page
 * that never binds the keys (the pop-out output, a TV, the gallery's tiles)
 * never fills it, so the scene there stands where it starts.
 */

/** A way to move; src/ui/freeLook.ts says which keys hold each. */
export type MoveKey = "forward" | "back" | "left" | "right" | "up" | "down";

/** What the hand asked for since the last take. */
export interface FreeLookInput {
  /** Turn, radians: + turns right, + looks up. */
  yaw: number;
  pitch: number;
  /** The held keys as axes, each -1, 0 or 1: + walks forward, steps right, goes up. */
  forward: number;
  right: number;
  up: number;
}

const held: Record<MoveKey, boolean> = { forward: false, back: false, left: false, right: false, up: false, down: false };
const taken: FreeLookInput = { yaw: 0, pitch: 0, forward: 0, right: 0, up: 0 };
let turnYaw = 0;
let turnPitch = 0;

export function addLook(yaw: number, pitch: number): void {
  turnYaw += yaw;
  turnPitch += pitch;
}

export function setMoveKey(key: MoveKey, down: boolean): void {
  held[key] = down;
}

/** Lets go of every key and drops any turn not taken yet. */
export function releaseFreeLook(): void {
  for (const key of Object.keys(held) as MoveKey[]) held[key] = false;
  turnYaw = 0;
  turnPitch = 0;
}

const axis = (plus: boolean, minus: boolean): number => (plus ? 1 : 0) - (minus ? 1 : 0);

/** The input since the last take: the turn is spent, the keys stay held.
 *  One object, reused by every take. */
export function takeFreeLook(): FreeLookInput {
  taken.yaw = turnYaw;
  taken.pitch = turnPitch;
  taken.forward = axis(held.forward, held.back);
  taken.right = axis(held.right, held.left);
  taken.up = axis(held.up, held.down);
  turnYaw = 0;
  turnPitch = 0;
  return taken;
}

export interface WalkerOptions {
  /** World units a second, along the ground and straight up or down. */
  walkSpeed: number;
  climbSpeed: number;
  /** Pitch stops here either way, radians, or the view flips over. */
  pitchMax: number;
  /** A world that repeats every `period` units in x and z: x and z wrap into
   *  [0, period), so the numbers a long walk sends to the GPU stay small. */
  period?: number;
}

/** Where the walker stands and looks: yaw 0 looks down -z, + turns towards +x. */
export interface WalkerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface Walker {
  step(dt: number, input: FreeLookInput): WalkerPose;
}

/** How long the walk takes to reach its speed or to stop, seconds: short
 *  enough to feel like the keys, long enough that a tap doesn't jolt. */
const EASE_TAU = 0.12;

export function createWalker(opts: WalkerOptions): Walker {
  const pose: WalkerPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  let vx = 0;
  let vy = 0;
  let vz = 0;
  return {
    step(dt, input) {
      pose.yaw += input.yaw;
      pose.pitch = Math.max(-opts.pitchMax, Math.min(opts.pitchMax, pose.pitch + input.pitch));
      // Along the ground whatever the pitch, and a diagonal is no faster.
      const n = Math.max(1, Math.hypot(input.forward, input.right));
      const f = input.forward / n;
      const r = input.right / n;
      const s = Math.sin(pose.yaw);
      const c = Math.cos(pose.yaw);
      const ease = 1 - Math.exp(-dt / EASE_TAU);
      vx += ((s * f + c * r) * opts.walkSpeed - vx) * ease;
      vz += ((-c * f + s * r) * opts.walkSpeed - vz) * ease;
      vy += (input.up * opts.climbSpeed - vy) * ease;
      pose.x += vx * dt;
      pose.y += vy * dt;
      pose.z += vz * dt;
      if (opts.period) {
        pose.x -= Math.floor(pose.x / opts.period) * opts.period;
        pose.z -= Math.floor(pose.z / opts.period) * opts.period;
      }
      return pose;
    },
  };
}
