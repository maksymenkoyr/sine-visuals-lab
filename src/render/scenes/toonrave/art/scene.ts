// The whole Toon Rave drawing as one SVG string: the defs, the tilted world group and every rig, fx
// group and cel. This is the prototype's page assembly (its src/app.js, "build the SVG"), ported
// as is. The drawing code in lib.ts, room.ts and cast.ts keeps module-level state (the seeded
// random, the line width, the gradient id counter, the defs list and the metadata below), so
// buildSceneSvg() resets all of it first and a second call returns the same string.
//
// The metadata (ANCHORS, HERO, LAMPS, LEDS, LASERS, CONFETTI) is filled while the markup is built:
// call buildSceneSvg() before reading it. Pure: no DOM, no wall time.
import { ART, DEFS, _ellCache, _glowCache } from "./lib";
import { ANCHORS, CONFETTI, HERO, dj, flagRaver, glowstick, pompadour, roundRaver, slamFx, debris } from "./cast";
import { LAMPS, LASERS, LEDS, backCrowd, blast, booth, button, buttonGlow, floor, lasers, room } from "./room";

export { ANCHORS, CONFETTI, HERO, LAMPS, LASERS, LEDS };
export { BX, BY, railY } from "./room";
export { GUY, KID, RAVER } from "./cast";

/** The impact frame filters' matrix and table values (the prototype's `two()` in app.js). */
export const IMPACT_MATRIX = [0.3, 0.59, 0.11, 0, 0, 0.3, 0.59, 0.11, 0, 0, 0.3, 0.59, 0.11, 0, 0, 0, 0, 0, 0, 1] as const;
export const IMPACT_A = { lo: [0.06, 0.01, 0.05], hi: [1, 0.18, 0.64] } as const;
export const IMPACT_B = { lo: [1, 0.93, 0.97], hi: [0.06, 0.01, 0.05] } as const;
/** The tilted world group's transform, and the art's size. */
export const WORLD_TRANSFORM = "rotate(-7,800,450) translate(800,450) scale(1.1) translate(-800,-450)";
export const ART_W = 1600;
export const ART_H = 900;

function resetArtState(): void {
  ART.LW = 7;
  ART.id = 0;
  ART.seed = 7;
  DEFS.length = 0;
  for (const k of Object.keys(_glowCache)) delete _glowCache[k];
  for (const k of Object.keys(_ellCache)) delete _ellCache[k];
  LAMPS.length = 0;
  LEDS.length = 0;
  CONFETTI.length = 0;
  for (const k of Object.keys(HERO)) delete HERO[k];
  ANCHORS.raverMitten = {};
  ANCHORS.kidHead = {};
}

const two = (id: string, lo: readonly number[], hi: readonly number[]) =>
  `<filter id="${id}" x="0" y="0" width="1600" height="900" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${IMPACT_MATRIX.join(" ")}"/><feComponentTransfer><feFuncR type="discrete" tableValues="${lo[0]} ${hi[0]} ${hi[0]}"/><feFuncG type="discrete" tableValues="${lo[1]} ${hi[1]} ${hi[1]}"/><feFuncB type="discrete" tableValues="${lo[2]} ${hi[2]} ${hi[2]}"/></feComponentTransfer></filter>`;

export function buildSceneSvg(): string {
  resetArtState();
  const world = [room(), backCrowd(), floor(), lasers(), blast(), flagRaver(), booth(), '<g id="djBack"></g>', buttonGlow(), button(), slamFx(), debris(),
    `<g id="djFront">${dj()}</g>`, pompadour(), '<g id="stickBack"></g>', roundRaver(), `<g id="stickFront">${glowstick()}</g>`].join("");
  DEFS.push(two("impactA", IMPACT_A.lo, IMPACT_A.hi), two("impactB", IMPACT_B.lo, IMPACT_B.hi));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"><defs>${DEFS.join("")}</defs><rect width="1600" height="900" fill="#14060f"/><g id="cam"><g transform="${WORLD_TRANSFORM}">${world}</g></g></svg>`;
}
