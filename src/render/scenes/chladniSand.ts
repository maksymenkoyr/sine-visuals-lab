// The Chladni sand rule's numbers and its zones, shared by the sim shader
// (chladni.ts's SIM_FRAG) and the Scene card's Sand zones gauge
// (src/ui/widgets/sandZones.ts), so the gauge's grains move by the very rule
// the plate's grains do. Pure, no GL.
//
// The zones. How the sand behaves depends on one number, the plate's drive
// (chladni.ts's plateDrive: Vibration × the music plus Bass kick). Measured on
// a CPU port of SIM_FRAG at the reference grain (see docs/scenes/chladni.md,
// Measurements), there are three regimes: below FREEZE_REF the grains barely
// rattle and the figure on the plate holds; between the two edges they wander
// and the sand drifts onto a new figure over seconds; past SNAP_REF a scattered
// bed is half on the lines within a second, two beats. Freeze edge and Snap
// edge let a person move those two boundaries: zoneDrive remaps the plate's
// drive piecewise-linearly so that the drive at the user's freeze edge acts as
// FREEZE_REF and the drive at their snap edge acts as SNAP_REF. At the default
// edges it is the identity — the plate as it was before the zones were dials.
// Above the snap edge the remap keeps slope 1, so a harder drive still throws
// harder. The remap lives in plateDrive, so everything that reads the drive
// (the bounce, the pull, air streaming, the grain's drawn motion) agrees.

/** Plate acceleration (amplitude × drive, g-ish units) at the knee between a
 *  grain rattling in place and bouncing free. This is what leaves sand lying
 *  between the lines at a moderate drive. */
export const LIFT_THRESHOLD = 0.05;
/** Plate-space units per second of bounce displacement per unit bounce, at
 *  the 60 fps reference step. */
export const HOP_RATE = 1.0;
/** On a fully lifted antinode, each bounce lands this fraction of its own
 *  length downhill of |field| — the bias of the random walk. It fades to zero
 *  toward the lift knee, so quiet sand never migrates. (It was 0.3 times a
 *  Settling pull dial at 0.5; that dial moved the snap edge, which is now
 *  Snap edge itself.) */
export const PULL_BIAS = 0.15;

/** Drive below which the reference grain moves under 2% of a nodal cell a
 *  second: the figure holds. */
export const FREEZE_REF = 0.2;
/** Drive at which half of a scattered bed reaches the lines within a second. */
export const SNAP_REF = 1.5;
/** The narrowest the drift zone may get, in drive units. */
export const ZONE_MIN_GAP = 0.1;
/** The gauge's fixed axis, in drive units (never rescaled). */
export const ZONE_AXIS_MAX = 3;

/** The edges as the shader reads them: freeze at least a little above 0,
 *  snap at least ZONE_MIN_GAP above freeze. */
export function clampZoneEdges(freeze: number, snap: number): { freeze: number; snap: number } {
  const f = Math.max(0.01, freeze);
  return { freeze: f, snap: Math.max(snap, f + ZONE_MIN_GAP) };
}

/** The plate's drive as the sand feels it — see the header. Mirrors zoneDrive
 *  in ZONE_DRIVE_GLSL. */
export function zoneDrive(d: number, freezeEdge: number, snapEdge: number): number {
  const { freeze, snap } = clampZoneEdges(freezeEdge, snapEdge);
  if (d < freeze) return (d * FREEZE_REF) / freeze;
  if (d < snap) return FREEZE_REF + ((d - freeze) * (SNAP_REF - FREEZE_REF)) / (snap - freeze);
  return SNAP_REF + (d - snap);
}

/** GLSL twin of zoneDrive; reads the uFreezeEdge and uSnapEdge setting uniforms. */
export const ZONE_DRIVE_GLSL = `
float zoneDrive(float d) {
  float fz = max(uFreezeEdge, 0.01);
  float sn = max(uSnapEdge, fz + ${ZONE_MIN_GAP.toFixed(2)});
  if (d < fz) return d * ${FREEZE_REF.toFixed(2)} / fz;
  if (d < sn) return ${FREEZE_REF.toFixed(2)} + (d - fz) * ${(SNAP_REF - FREEZE_REF).toFixed(2)} / (sn - fz);
  return ${SNAP_REF.toFixed(2)} + (d - sn);
}
`;

/** The plate's drive before the zones, from the resolved Vibration and Bass
 *  kick settings and their drive readings. Mirrors plateDrive in chladni.ts's
 *  GRAIN_MOTION_GLSL, minus its final zoneDrive. */
export function rawPlateDrive(shake: number, shakeReading: number, kick: number, kickReading: number): number {
  return Math.pow(shake, 1.5) * 2 * (0.25 + 2.4 * shakeReading) + kick * kickReading * 1.5;
}

/** The soft lift: accel²/T below the knee (a rattle in place), accel − T
 *  above it (a free bounce). Mirrors grainBounce in GRAIN_MOTION_GLSL. */
export function grainBounce(accel: number, lift: number): number {
  return (accel * accel) / (accel + lift);
}
