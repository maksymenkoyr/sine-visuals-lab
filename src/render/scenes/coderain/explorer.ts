// Code Rain's explorer: the scripted walk the camera takes through the rain.
// Legs follow each other from a seeded generator, so a mount always walks
// the same way: a walk (curves, rolls over low hills, steps with a bob and a
// sway), a look round (strolling on, gazing from point to point all round,
// high into the rain and down below, then ahead again), and a rise (floating
// up or sinking through the columns, gazing the way it goes). It never stops:
// each leg has its own pace and the walk glides from one to the next
// (PACE_TAU), so it only ever speeds up or slows down.
//
// The head works like a person's: it picks a gaze point, turns to it briskly
// and holds it, then picks the next (each leg's list of `Glance`s). A
// critically damped spring (HEAD_OMEGA) carries yaw, pitch and roll between
// points, so a turn starts and settles smoothly and never overshoots.
//
// `step` takes explorer seconds, not real ones: index.ts scales them by the
// Speed setting, so one number makes the explorer walk, look and rise faster,
// and moves the camera itself (body heading x WALK_PACE x pace), so a drop's
// Turn bends the path without swinging it round the origin.

/** Walking pace, world units per explorer second: ~5 glyph widths, which
 *  reads as walking rather than drifting. */
export const WALK_PACE = 1.3;
/** Steps a second; the bob's height and the sway's roll, per step. */
const STEP_HZ = 1.7;
const BOB = 0.035;
const SWAY = (1.2 * Math.PI) / 180;
/** The hills a walk rolls over: height and length, world units. */
const HILL = 0.7;
const HILL_LEN = 9;
/** Leg lengths, explorer seconds: [shortest, longest]. */
const WALK_DUR = [7, 13] as const;
const LOOK_DUR = [5, 9] as const;
const RISE_DUR = [6, 10] as const;
/** After a walk, the share of next legs that are rises, not look rounds. */
const RISE_SHARE = 0.4;
/** A rise climbs or sinks this far, world units, and keeps the explorer's
 *  height inside HEIGHT_BAND (where the columns stay dense round it). */
const RISE_BY = [3, 7] as const;
const HEIGHT_BAND = [-5, 9] as const;
/** Each leg's pace, a share of WALK_PACE: [slowest, fastest]. A look round
 *  strolls and a rise drifts, so they read as slowing down to look; the low
 *  ends stay well clear of 0, since the walk must never read as a stop. */
const WALK_SPEED = [0.85, 1.15] as const;
const LOOK_SPEED = [0.45, 0.6] as const;
const RISE_SPEED = [0.35, 0.5] as const;
/** How long the pace takes to settle on a new leg's, explorer seconds. */
const PACE_TAU = 1.8;
/** A walk's curve: peak turn rate, radians per explorer second. */
const CURL_MAX = 0.22;
/** Head spring stiffness, rad/s: a 90-degree turn settles in ~1 s. Its
 *  speed is capped (rad per explorer second), so a swing from one side to
 *  the other glides instead of whipping past. */
const HEAD_OMEGA = 4;
const HEAD_MAX_RATE = 2.6;
/** Pitch never passes this, radians, so the view never flips over. */
const PITCH_LIMIT = (62 * Math.PI) / 180;

const DEG = Math.PI / 180;

interface ExplorerPose {
  /** Height: the rises, the hills and the step bob. */
  y: number;
  /** Where the explorer walks and where it looks, radians (0 = -z). */
  body: number;
  gaze: number;
  /** Pitch on top of the Tilt setting, radians (+ looks up). */
  pitch: number;
  /** Head roll, radians (+ tips the view clockwise). */
  roll: number;
  /** Horizontal speed, a share of WALK_PACE; never 0. */
  pace: number;
}

export interface Explorer {
  step(dt: number): ExplorerPose;
}

/** A gaze point: yaw from the body, pitch, roll, and how long it holds. */
interface Glance {
  yaw: number;
  pitch: number;
  roll: number;
  hold: number;
}

type LegKind = "walk" | "look" | "rise";

interface Leg {
  kind: LegKind;
  dur: number;
  /** Walk: turn rate at the leg's middle. */
  curl: number;
  pace: number;
  /** Rise: height at the start and the climb (+ up). */
  from: number;
  climb: number;
  glances: Glance[];
}

interface Spring {
  x: number;
  v: number;
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** Substepped, so a long frame at a high Speed stays stable. */
function springTo(s: Spring, target: number, dt: number): void {
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (HEAD_OMEGA * HEAD_OMEGA * (target - s.x) - 2 * HEAD_OMEGA * s.v) * h;
    s.v = Math.max(-HEAD_MAX_RATE, Math.min(HEAD_MAX_RATE, s.v));
    s.x += s.v * h;
  }
}

export function createExplorer(rng: () => number): Explorer {
  const pose: ExplorerPose = { y: 0, body: 0, gaze: 0, pitch: 0, roll: 0, pace: 1 };
  const yaw: Spring = { x: 0, v: 0 };
  const pitch: Spring = { x: 0, v: 0 };
  const roll: Spring = { x: 0, v: 0 };
  let height = 0;
  let walked = 0;
  /** 1 while stepping, 0 while floating; glides, so the bob fades in and out. */
  let stepping = 1;
  let stepPhase = 0;
  let legTime = 0;
  let glance = 0;
  let glanceTime = 0;

  const between = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rng();
  const side = (): number => (rng() < 0.5 ? -1 : 1);

  /** Gaze points for a leg, their holds stretched to fill its length. */
  function glancesFor(kind: LegKind, dur: number, climb: number): Glance[] {
    const out: Glance[] = [];
    if (kind === "walk") {
      // Mostly ahead, with a glance aside, up or down now and then.
      let t = 0;
      while (t < dur) {
        const aside = out.length % 2 === 1 && rng() < 0.7;
        const g: Glance = aside
          ? { yaw: side() * between([25, 70]) * DEG, pitch: between([-18, 38]) * DEG, roll: side() * between([0, 3]) * DEG, hold: between([0.7, 1.5]) }
          : { yaw: side() * between([0, 6]) * DEG, pitch: between([-4, 6]) * DEG, roll: 0, hold: between([1.6, 3.6]) };
        out.push(g);
        t += g.hold;
      }
    } else if (kind === "look") {
      // Points all round, alternating sides, often high into the rain; the
      // last is back ahead, where it walks on.
      const count = 3 + Math.floor(rng() * 3);
      let s = side();
      for (let i = 0; i < count - 1; i++) {
        const up = rng() < 0.65;
        out.push({
          yaw: s * between([30, 140]) * DEG,
          pitch: (up ? between([15, 55]) : -between([12, 35])) * DEG,
          roll: side() * between([0, 5]) * DEG,
          hold: between([0.8, 2]),
        });
        if (rng() < 0.75) s = -s;
      }
      out.push({ yaw: side() * between([0, 6]) * DEG, pitch: between([-3, 5]) * DEG, roll: 0, hold: between([1, 1.8]) });
    } else {
      // Gaze the way it goes: up through the rain or down past its feet.
      const dir = climb > 0 ? 1 : -1;
      const count = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < count; i++) {
        out.push({
          yaw: side() * between([0, 60]) * DEG,
          pitch: dir * (dir > 0 ? between([25, 55]) : between([18, 40])) * DEG,
          roll: side() * between([0, 4]) * DEG,
          hold: between([1.5, 3]),
        });
      }
      out.push({ yaw: 0, pitch: 0, roll: 0, hold: 1.5 });
    }
    const total = out.reduce((a, g) => a + g.hold, 0);
    for (const g of out) g.hold *= dur / total;
    return out;
  }

  function nextLeg(kind: LegKind): Leg {
    const dur = between(kind === "walk" ? WALK_DUR : kind === "look" ? LOOK_DUR : RISE_DUR);
    let climb = 0;
    if (kind === "rise") {
      // Lean towards the middle of the band, so it wanders but stays in it.
      const mid = (HEIGHT_BAND[0] + HEIGHT_BAND[1]) / 2;
      const up = rng() < 0.5 + (mid - height) / (HEIGHT_BAND[1] - HEIGHT_BAND[0]);
      climb = (up ? 1 : -1) * between(RISE_BY);
      climb = Math.max(HEIGHT_BAND[0], Math.min(HEIGHT_BAND[1], height + climb)) - height;
    }
    return {
      kind,
      dur,
      curl: kind === "walk" ? side() * CURL_MAX * (0.25 + 0.75 * rng()) : 0,
      pace: between(kind === "walk" ? WALK_SPEED : kind === "look" ? LOOK_SPEED : RISE_SPEED),
      from: height,
      climb,
      glances: glancesFor(kind, dur, climb),
    };
  }

  let leg = nextLeg("walk");

  return {
    step(dt: number): ExplorerPose {
      legTime += dt;
      glanceTime += dt;
      if (legTime >= leg.dur) {
        legTime -= leg.dur;
        if (leg.kind === "rise") height = leg.from + leg.climb;
        leg = nextLeg(leg.kind !== "walk" ? "walk" : rng() < RISE_SHARE ? "rise" : "look");
        glance = 0;
        glanceTime = 0;
      }
      while (glance < leg.glances.length - 1 && glanceTime >= leg.glances[glance].hold) {
        glanceTime -= leg.glances[glance].hold;
        glance++;
      }
      const g = leg.glances[glance];

      const u = legTime / leg.dur;
      const settle = 1 - Math.exp(-dt / PACE_TAU);
      pose.pace += (leg.pace - pose.pace) * settle;
      stepping += ((leg.kind === "rise" ? 0 : 1) - stepping) * settle;
      const stride = stepping * pose.pace;
      if (leg.kind === "walk") pose.body += leg.curl * Math.sin(Math.PI * u) * pose.pace * dt;
      if (leg.kind === "rise") height = leg.from + leg.climb * smoothstep(u);
      walked += WALK_PACE * pose.pace * dt;

      springTo(yaw, g.yaw, dt);
      springTo(pitch, g.pitch, dt);
      springTo(roll, g.roll, dt);
      stepPhase += STEP_HZ * Math.PI * stride * dt;
      pose.gaze = pose.body + yaw.x;
      pose.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch.x));
      pose.roll = roll.x + SWAY * stride * Math.sin(stepPhase);
      pose.y = height + HILL * Math.sin((walked * 2 * Math.PI) / HILL_LEN) + BOB * stride * Math.abs(Math.sin(stepPhase));
      return pose;
    },
  };
}
