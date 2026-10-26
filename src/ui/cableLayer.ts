/**
 * The patch bay's cables (src/ui/deviceMenu.ts's own plan doc): one `<svg>`
 * fixed over the whole viewport, appended to `document.body` above
 * `.vc-root` (controlsTheme.ts's z-index), drawing a soft bezier from a
 * source's own jack to a setting's row port. Lives outside `.vc-root` on
 * purpose — every card is `overflow: hidden` (controlsTheme.ts), and a
 * cable has to cross from a meter jack, over the open middle between the
 * docked settings/meters columns, to a scene row's port, which a card's own
 * clipping would cut.
 *
 * recompute() takes two independent groups — pinned and preview — rather
 * than one "shown" set, so both can be on screen together: hovering a
 * different setting than whatever's pinned draws both at once (see
 * deviceMenu.ts's refreshMeta/togglePin/previewDrive for how "pinned" vs
 * "the active preview" are told apart, and controlsTheme.ts's
 * `.vc-drive-pinned`/`.vc-drive-preview` for the matching row treatment).
 * The pinned group keeps this file's full glow/core/flow structure, dimmed
 * to `.vc-cable-dimmed` while a preview is also live so it doesn't compete
 * with it; the preview group is a single thin dashed `.vc-cable-preview`
 * path per source — no glow layer, no flow dash, so a transient hover never
 * costs the tick loop anything and never looks as "committed" as a pinned
 * patch. A source key is namespaced per group (`pinned:`/`preview:`) so the
 * same physical jack can carry both a pinned and a preview cable at once
 * without their flow offsets colliding.
 *
 * A third group, `fan`, answers "where does this signal go": while a
 * signal's row is lit (deviceMenu.ts's own lit-row tracking — the same
 * hover/focus glow controlsTheme.ts's `.vc-row:hover/:focus-within` draws),
 * every wire that leaves its jack is drawn to every port it reaches in the
 * scene — one jack fanning out, where pinned/preview are many jacks into
 * one port. It is drawn under the other two, flat and static like a
 * preview (`.vc-cable-fan`, solid where a preview is dashed), so it costs
 * the tick loop nothing.
 *
 * A source carrying its own onUnplug (CableSourceSpec below) is pressable:
 * it's drawn inside a `.vc-cable-g` group with a transparent hit stroke over
 * it (controlsTheme.ts's .vc-cable-hit — the layer itself stays
 * pointer-events:none, so only that stroke answers the pointer, and its width
 * is what makes a thin cable easy to hit) and a plug at each end (plugEl,
 * bindPlug), on the stub just out from the jack and the port. A click on the
 * stroke opens the cable's knot; a cable without one does nothing. A click on
 * a plug unplugs, and so does a pull that takes it PULL_OUT_PX from where it
 * was pressed; a shorter pull puts it back. While held, the pulled end
 * follows the pointer and the rest of the cable stays put (drawPull).
 * deviceMenu.ts wires onUnplug to the same patch toggle the source line's ×
 * button takes. The hit stroke answers only in the open gap between the
 * cable's jack card and its port card (pressBandFor; a `<clipPath>` per cable):
 * the layer paints over every card, so a cable crossing a card (Bass level's
 * runs straight over Mid and Treble) would otherwise take a press meant for the
 * jack, fader or slider under it. The plugs sit over those cards' edges, so
 * they answer only while their cable is armed.
 *
 * Hovering a pressable cable arms it (arm, disarmSoon): its group takes
 * `.vc-cable-armed`, which shows and enables its plugs and carries the hover
 * lift (controlsTheme.ts — a neon-ish bloom in the cable's own colour, a
 * thicker core, a brighter glow, and the flow beads lightened so the signal
 * still visibly runs inside it), and the shared tooltip (tooltip.ts) says what
 * a click and a pull do. The group holds the cable's colour as its CSS
 * `color` so the bloom's currentColor resolves per cable. While one cable is
 * armed, every other cable's stroke stops answering (`.vc-cable-has-armed`):
 * a setting's cables all meet at its port and run within a few pixels of
 * each other for the last stretch before it, where whichever was drawn last
 * would otherwise take the pointer, and with it the port plug, from the cable
 * followed in. A leave disarms after ARM_GRACE_MS, so the pointer can cross
 * from the stroke to a plug that doesn't quite touch it. A touch never arms:
 * a tap on the stroke still opens the knot, and the knot's Unplug unplugs.
 * deviceMenu.ts only ever sets onUnplug on the pinned group's real patch
 * sources: a preview cable and a display-only scene mix are decoration, not
 * something a press should edit.
 *
 * An unplug plays a short retract (playUnplug): a copy of the cable's core
 * runs back from the unplugged end into the other, a spark rings the socket
 * it left and the plug pops out. The copy lives in `ghosts`, which
 * recompute() never clears: the unplug's own rebuild lands a frame later,
 * and a rebuilt copy would restart its animation. deviceMenu.ts plays it for
 * every unplug of a drawn cable (its jack, the line's ×, the knot's Unplug).
 * Reduced motion skips it.
 *
 * Resting the pointer on a pressable cable — still, for REVEAL_REST_MS —
 * scrolls its two ends into view (revealEnds): the signal's jack in the
 * meters column and the setting's port in the settings column, each only
 * if it's out of its column's visible band (where endpointFor clamps it).
 * The pointer is never moved; a move of more than REVEAL_STILL_PX restarts
 * the wait, and one rest reveals once. The wait lives in the layer, not on
 * the elements, because the scroll's own recompute() rebuilds every path —
 * including the one under the pointer.
 *
 * A pinned source with a knot (CableSourceSpec.knot, cableKnots.ts) and a
 * press band is drawn in two halves: jack to the knot's left edge, and the
 * knot's right edge to the port, each through cablePathD so each keeps its
 * stubs (and the second its detour under Power). The knot rests on the whole
 * cable's bend (cablePointAt), one setting's knots spread along their cables
 * (KNOT_SPREAD_T) since those cables all meet at one port and would stack
 * their knots at the middle; it is HTML in its own layer (knotEl), so
 * it can grow into a panel; as it springs open and shut, tick() rewrites the
 * halves' `d` to follow its sides. A peek leaves the halves where they are. The first half's flow rides the wire's
 * input, the second's its output, so the knot visibly changes the signal.
 * Both halves keep the hit stroke: a click on either opens the knot and
 * hovering either peeks it (setPeek). The knot also opens from its own click
 * or from deviceMenu.ts's summary chip (openKnot). A source without a knot
 * draws as one path.
 *
 * Every cable leaves its jack and enters its port through a short straight
 * CABLE_STUB_PX run before the bezier takes over (cablePathD) — a real
 * patch cable doesn't leave a socket at an angle. The bezier's own travel
 * direction (and so which way each stub points) is derived from the
 * resolved endpoints' actual x positions, not assumed left-to-right: the
 * meters column docks left of the settings column in the ordinary case
 * (controlsTheme.ts's wide layout), but a jack's own endpoint can still
 * clamp to the right of its port in an edge case (endpointFor below, e.g. a
 * jack scrolled past its column's visible band) — deriving the direction
 * keeps the stub/bend leaving "outward" (toward the port) and arriving
 * "inward" (from the jack's side) with no kink either way, rather than
 * assuming the common case always holds.
 *
 * Power (.vc-power-col) sits fixed in the screen's own top-right corner,
 * right beside the settings column, while the settings column scrolls
 * independently underneath/past it — so a port can end up rendered at any
 * y a user scrolls it to, including right behind Power's own card. Since
 * the cable layer paints above every card (its whole reason for living
 * outside .vc-root — see this file's header), a straight bezier into such
 * a port would visibly run across Power's glass rather than the open
 * middle. cablePathD detours a cable whose *port* end falls in Power's own
 * vertical band (with a small margin) down under its bottom edge first —
 * a jack's own end is never checked, since Power sits beside the settings
 * column, nowhere near the meters side a jack lives on.
 *
 * Geometry (every `getBoundingClientRect` read) only happens in recompute(),
 * called by deviceMenu.ts on a selection/patch change and on its own list
 * of layout triggers (scroll, resize, fold, ResizeObserver, a Scene-card
 * rebuild) — never per frame. Each call is one batch of reads (endpointFor)
 * then one batch of writes (the `<path>` elements it builds, and the knots'
 * sync()). tick() is the only per-frame entry point, and it only ever writes
 * — the pinned group's `stroke-dashoffset`, the knots' styles, a split
 * cable's `d` when its knot moved — never reads, so it can run every rAF
 * tick for free; the preview group never animates, so it never needs a tick
 * write either. A pull's pointermove only writes too (drawPull).
 *
 * A jack being dragged (deviceMenu.ts's jack drag) draws one temporary
 * dashed `.vc-cable-drag` path from its own jack to the pointer (setDrag).
 * It sits outside `cables`, the group recompute() rebuilds, so a rebuild
 * leaves it in place.
 */

import { createCableKnotLayer, type CableKnotGeometry, type CableKnotPlacement, type CableKnotSpec } from "./cableKnots.ts";
import { hideTooltipIfShowing, showTooltipAt } from "./tooltip.ts";

/** Which end of a cable: the jack it leaves or the port it enters. */
export type CableEnd = "jack" | "port";

export interface CableSourceSpec {
  /** Unique per cable within one recompute() call — carries a flowing
   *  dash's offset across a rebuild so a patch edit elsewhere doesn't
   *  visibly restart this cable's flow. */
  key: string;
  color: string;
  /** A scene-mix source (drives.ts's sceneSources) — dashed, dimmer, no
   *  "just plugged" draw-on. Only meaningful on the pinned group; a preview
   *  cable is always drawn in its own flat style regardless. */
  soft: boolean;
  /** This is one of an Only when patch's own gate conditions (drives.ts's
   *  gateConditionIndices — there can be more than one now) — a longer dash
   *  on the core than `soft`'s, so the gate reads distinctly in the cables
   *  too (controlsTheme.ts's .vc-cable-cond). Mutually exclusive with `soft`
   *  in practice (a scene mix has no patch sources to gate —
   *  deviceMenu.ts's cableGroupFor). */
  cond?: boolean;
  /** This source is muted (drives.ts's `DriveSource.off`) — draws in the
   *  flat, dashed `.vc-cable-muted` style instead of the usual glow/core/
   *  flow structure (no glow, no flow animation), overriding `cond`/`soft`
   *  outright: mute is the more specific fact about this cable right now.
   *  Only ever true on the pinned group — deviceMenu.ts's cableGroupFor
   *  only builds this from a real patch's own sources, never a preview's
   *  flat style (which has no mute concept of its own). */
  muted?: boolean;
  jackEl: HTMLElement;
  /** Read every tick — flow speed rides this source's own live value.
   *  Unused for a preview cable (it never animates). */
  getValue: () => number;
  /** Unplugs the source: a click or a pull on either of the cable's plugs
   *  (see this file's header). When set, the cable is wrapped in a
   *  `.vc-cable-g` group with a `.vc-cable-hit` stroke and two plugs that
   *  answer the pointer; when absent the paths stay plain and
   *  click-transparent. deviceMenu.ts's cableGroupFor only ever sets it on
   *  the pinned group's real patch sources. */
  onUnplug?: () => void;
  /** The wire's name, for the hint a pressable cable shows. */
  label?: string;
  /** This source was just toggled on — draws on over ~250ms
   *  (controlsTheme.ts's vc-cable-new rule) instead of appearing instantly.
   *  Only ever true on the pinned group — a preview is never mid-edit. */
  isNew?: boolean;
  /** A knot in this cable (cableKnots.ts) — see this file's header. Only
   *  drawn for a pressable source with a press band; a click on the cable
   *  opens it. */
  knot?: CableKnotSpec;
}

/** One end of a cable group: its sources and the port they all point at.
 *  Empty `sources` or a null `portEl` draws nothing for that group. */
export interface CableGroupSpec {
  sources: readonly CableSourceSpec[];
  portEl: HTMLElement | null;
}

export interface CableLayer {
  el: SVGSVGElement;
  /** Full rebuild — see this file's header. `preview` is drawn on top of
   *  `pinned`, and `fan` (a lit signal's wires, one group per port it
   *  reaches) under both; pass an empty-sources group (or no fan groups)
   *  to draw only the others (or none). */
  recompute(pinned: CableGroupSpec, preview: CableGroupSpec, fan?: readonly CableGroupSpec[]): void;
  /** Per-tick dash-offset advance for the pinned group's own flow, speed ∝
   *  each source's own live value — no DOM reads. A no-op under
   *  prefers-reduced-motion. */
  tick(dtSec: number): void;
  setVisible(v: boolean): void;
  /** The cable a jack drag pulls (deviceMenu.ts): from `from`'s jack to the pointer at (x, y), dashed, drawn over every other cable; null removes it. Survives recompute(). */
  setDrag(drag: { from: HTMLElement; x: number; y: number; color: string } | null): void;
  /** The knot layer (cableKnots.ts), its own element for `document.body`. */
  knotEl: HTMLElement;
  /** Opens the knot in a pinned source's cable, by its CableSourceSpec key. */
  openKnot(sourceKey: string): void;
  closeKnot(): void;
  knotOpen(): boolean;
  /** The unplug retract (see this file's header) for a pinned cable, by its
   *  CableSourceSpec key, from `end`; nothing for a cable not drawn. Call it
   *  before the patch edit that removes the cable. */
  playUnplug(sourceKey: string, end: CableEnd): void;
  /** A plug is held, pulled or not yet (see this file's header). */
  pulling(): boolean;
  /** Puts a held plug back, as letting go of a short pull does. */
  cancelPull(): void;
}

const NS = "http://www.w3.org/2000/svg";
// One MediaQueryList for the file, made on first use (matchMedia() parses the
// query and allocates a list per call, and tick() asks every frame). `.matches`
// on a held list is live, so an OS setting change is still picked up; the lazy
// init keeps `window` untouched at import time.
let reduceMotionMQ: MediaQueryList | null = null;
const reduceMotion = () => (reduceMotionMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;

/** How far a cable runs straight out of its jack (and straight into its
 *  port) before the bezier bend starts — see this file's header. */
const CABLE_STUB_PX = 14;

/** How long the pointer must rest on a pressable cable before its ends
 *  scroll into view, and how far it may drift and still count as resting —
 *  see this file's header. */
const REVEAL_REST_MS = 350;
const REVEAL_STILL_PX = 3;
/** Room kept between a revealed end and its column's edge, so the jack or
 *  port lands clear of the edge rather than flush against it. */
const REVEAL_MARGIN_PX = 40;

/** How far out along its stub a plug's centre sits from its jack's or
 *  port's centre: clear of the jack's ring, so a plug never covers a jack. */
const PLUG_INSET_PX = 14;
/** The drawn sleeve, and its press target: short along the stub so it stays
 *  off the jack's ring, tall across it for an easy grab. */
const PLUG_LEN_PX = 9;
const PLUG_THICK_PX = 6;
const PLUG_HIT_LEN_PX = 12;
const PLUG_HIT_CROSS_PX = 16;
const PLUG_POP_PX = 8;
const SPARK_R_PX = 6;
/** Movement that turns a press on a plug into a pull, and how far a pull
 *  must go to unplug when let go. */
const PULL_START_PX = 4;
const PULL_OUT_PX = 24;
/** Room to cross from a cable's stroke to a plug that doesn't quite touch it. */
const ARM_GRACE_MS = 120;
/** When an unplug's retract is removed: well after controlsTheme.ts's
 *  .vc-cable-ghost animations have ended. */
const GHOST_MAX_MS = 600;
const CABLE_ENDS: readonly CableEnd[] = ["jack", "port"];

/** Extra clearance kept above/below Power's own card before a port counts
 *  as "in its band" (cablePathD's own detour) — enough that the detoured
 *  cable's curve doesn't itself brush the card it's avoiding. */
const CABLE_AVOID_MARGIN_PX = 14;

/** Power's own current screen band, or null while it isn't rendered (a
 *  folded panel) — read once per recompute() alongside every other
 *  endpoint, not per cable. See this file's header for why cablePathD
 *  needs it at all. */
function powerAvoidBand(): { top: number; bottom: number } | null {
  const el = document.querySelector<HTMLElement>(".vc-power-col");
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - CABLE_AVOID_MARGIN_PX, bottom: r.bottom + CABLE_AVOID_MARGIN_PX };
}

/** A jack or port's own centre in viewport coordinates — matching the
 *  `<svg>`'s own fixed, unscaled coordinate space (see createCableLayer's
 *  own element, `position: fixed; inset: 0`, no viewBox). In the plan's own
 *  words:
 *   - a jack inside a folded card has no layout box at all
 *     (`.vc-card-body{display:none}`) — same "no client rects" probe
 *     ringElements() (deviceMenu.ts) already uses — so the cable ends at
 *     that card's own header instead (and, if the header has no box either
 *     — the column itself is hidden — there is no endpoint and no cable);
 *   - a jack scrolled outside its column's own visible band (`.vc-meters`/
 *     `.vc-controls-col`) — the cable ends at the column's
 *     visible edge;
 *   - otherwise, the element's own centre. */
function endpointFor(el: HTMLElement): { x: number; y: number } | null {
  if (el.getClientRects().length === 0) {
    const header = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head");
    // The header has no box either when the whole column is hidden (M, or
    // every card folded away) — its rect would be all zeros and the cable
    // would run to the viewport's top-left corner, so draw nothing instead.
    if (!header || header.getClientRects().length === 0) {
      return null;
    }
    const r = header.getBoundingClientRect();
    return { x: r.right - 8, y: r.top + r.height / 2 };
  }
  const r = el.getBoundingClientRect();
  let y = r.top + r.height / 2;
  const scroller = el.closest<HTMLElement>(".vc-meters, .vc-controls-col");
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    if (y < sr.top) y = sr.top + 2;
    else if (y > sr.bottom) y = sr.bottom - 2;
  }
  return { x: r.left + r.width / 2, y };
}

/** The jack->port path, stub-out, bend, stub-in — see this file's header.
 *  `dir` (+1 rightward, -1 leftward) is which way the cable actually
 *  travels between these two *resolved* endpoints, so a cable still gets a
 *  stub that leaves the jack outward and a matching tangent into the port
 *  rather than a kink even when clamping (endpointFor) puts one on the
 *  "wrong" side of the other. */
function cablePathD(
  pt: { x: number; y: number },
  port: { x: number; y: number },
  avoidBand: { top: number; bottom: number } | null,
): string {
  const dir = port.x >= pt.x ? 1 : -1;
  const jackStubX = pt.x + dir * CABLE_STUB_PX;
  const portStubX = port.x - dir * CABLE_STUB_PX;
  if (avoidBand && port.y >= avoidBand.top && port.y <= avoidBand.bottom) {
    // Two smooth cubics via a waypoint under Power's own bottom edge,
    // rather than one straight bezier into the port — see this file's
    // header. Horizontal tangents at the waypoint (both control points
    // share its y) keep the dip-then-rise seamless, the same C1-continuity
    // trick the single-cubic path below gets for free from its own stubs.
    const wpX = (jackStubX + portStubX) / 2;
    const wpY = avoidBand.bottom;
    const dx1 = Math.max(30, Math.abs(wpX - jackStubX) * 0.6);
    const dx2 = Math.max(30, Math.abs(portStubX - wpX) * 0.6);
    return (
      `M${pt.x},${pt.y} H${jackStubX} ` +
      `C${jackStubX + dir * dx1},${pt.y} ${wpX - dir * dx1},${wpY} ${wpX},${wpY} ` +
      `C${wpX + dir * dx2},${wpY} ${portStubX - dir * dx2},${port.y} ${portStubX},${port.y} ` +
      `H${port.x}`
    );
  }
  const dx = Math.max(40, Math.abs(portStubX - jackStubX) * 0.55);
  const cp1x = jackStubX + dir * dx;
  const cp2x = portStubX - dir * dx;
  return `M${pt.x},${pt.y} H${jackStubX} C${cp1x},${pt.y} ${cp2x},${port.y} ${portStubX},${port.y} H${port.x}`;
}

/** The point at `t` along the cubic from (x0, y0) to (x3, y3) whose control
 *  points share the ends' y, as every cubic in cablePathD does. */
function flatCubicAt(x0: number, y0: number, x1: number, x2: number, x3: number, y3: number, t: number): { x: number; y: number } {
  const u = 1 - t;
  const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
  return { x, y: y0 + (y3 - y0) * t * t * (3 - 2 * t) };
}

/** The point at `t` (0..1) along cablePathD's own bend, its stubs left out:
 *  one cubic, or the two halves of the detour under Power. A knot's rest
 *  point. */
function cablePointAt(
  pt: { x: number; y: number },
  port: { x: number; y: number },
  avoidBand: { top: number; bottom: number } | null,
  t: number,
): { x: number; y: number } {
  const dir = port.x >= pt.x ? 1 : -1;
  const jackStubX = pt.x + dir * CABLE_STUB_PX;
  const portStubX = port.x - dir * CABLE_STUB_PX;
  if (avoidBand && port.y >= avoidBand.top && port.y <= avoidBand.bottom) {
    const wpX = (jackStubX + portStubX) / 2;
    const wpY = avoidBand.bottom;
    if (t < 0.5) {
      const dx1 = Math.max(30, Math.abs(wpX - jackStubX) * 0.6);
      return flatCubicAt(jackStubX, pt.y, jackStubX + dir * dx1, wpX - dir * dx1, wpX, wpY, t * 2);
    }
    const dx2 = Math.max(30, Math.abs(portStubX - wpX) * 0.6);
    return flatCubicAt(wpX, wpY, wpX + dir * dx2, portStubX - dir * dx2, portStubX, port.y, t * 2 - 1);
  }
  const dx = Math.max(40, Math.abs(portStubX - jackStubX) * 0.55);
  return flatCubicAt(jackStubX, pt.y, jackStubX + dir * dx, portStubX - dir * dx, portStubX, port.y, t);
}

/** Where a plug rests on the cable from `jack` to `port`: on the stub at
 *  `end`, out from its socket toward the other end. */
export function plugPoint(jack: { x: number; y: number }, port: { x: number; y: number }, end: CableEnd): { x: number; y: number } {
  const dir = port.x >= jack.x ? 1 : -1;
  return end === "jack" ? { x: jack.x + dir * PLUG_INSET_PX, y: jack.y } : { x: port.x - dir * PLUG_INSET_PX, y: port.y };
}

/** A press on a plug becomes a pull once it moves this far from the press. */
export function pullStarts(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > PULL_START_PX;
}

/** What letting go of a pressed plug does, from how far it is from the
 *  press: a press that never became a pull is a click, and a pull unplugs
 *  only once it went PULL_OUT_PX. */
export function pullRelease(dx: number, dy: number, moved: boolean): "click" | "unplug" | "back" {
  if (!moved) return "click";
  return Math.hypot(dx, dy) >= PULL_OUT_PX ? "unplug" : "back";
}

/** How far apart, along their cables, one setting's knots rest. Its cables
 *  all meet at one port, so at the same `t` the knots of neighbouring jacks
 *  would stack; spread along the cables they sit apart. */
const KNOT_SPREAD_T = 0.12;
const KNOT_T_MIN = 0.25;
const KNOT_T_MAX = 0.75;
/** Room kept between a resting knot and the gap's edge. */
const KNOT_GAP_INSET_PX = 16;

function pathEl(cls: string, d: string, color: string): SVGPathElement {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", cls);
  p.setAttribute("d", d);
  p.setAttribute("stroke", color);
  return p;
}

/** One drawn cable's own wrapper group — see this file's header. Holds
 *  the glow/core/flow (or flat) paths and, for a pressable source, the
 *  hit stroke and plugs that answer the pointer; `.vc-cable-armed` on it
 *  (arm) carries the hover lift. The cable's own colour also rides the
 *  group as CSS `color`, so the hover bloom's currentColor drop-shadow
 *  (controlsTheme.ts) resolves per cable without that rule ever naming
 *  a colour. */
function groupEl(color: string): SVGGElement {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "vc-cable-g");
  g.style.color = color;
  return g;
}

/** A `w` × `h` rect centred on its group's origin. */
function rectEl(cls: string, w: number, h: number, fill: string): SVGRectElement {
  const r = document.createElementNS(NS, "rect");
  r.setAttribute("class", cls);
  r.setAttribute("x", String(-w / 2));
  r.setAttribute("y", String(-h / 2));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("rx", "2");
  r.setAttribute("fill", fill);
  return r;
}

/** One end's plug: a group at the plug's centre, so a pull moves it with
 *  one write, holding the drawn sleeve (bindPlug adds the press target). */
function plugEl(color: string): SVGGElement {
  const el = document.createElementNS(NS, "g");
  el.setAttribute("class", "vc-cable-end");
  el.append(rectEl("vc-cable-plug", PLUG_LEN_PX, PLUG_THICK_PX, color));
  return el;
}

/** Scrolls one cable end (a jack or a port) into its column's visible band
 *  if it's outside it — see this file's header. An end inside a folded card
 *  has no box, so its card's header stands in, as in endpointFor. */
function revealEnd(el: HTMLElement): void {
  let target: HTMLElement | null = el;
  if (el.getClientRects().length === 0) {
    target = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head") ?? null;
    if (!target || target.getClientRects().length === 0) return;
  }
  const scroller = target.closest<HTMLElement>(".vc-meters, .vc-controls-col");
  if (!scroller) return;
  const r = target.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  let dy = 0;
  if (r.top < sr.top + REVEAL_MARGIN_PX) dy = r.top - sr.top - REVEAL_MARGIN_PX;
  else if (r.bottom > sr.bottom - REVEAL_MARGIN_PX) dy = r.bottom - sr.bottom + REVEAL_MARGIN_PX;
  if (Math.abs(dy) < 1) return;
  // scrollTo per column rather than scrollIntoView: two smooth
  // scrollIntoView calls in one frame can cancel each other in Chromium.
  scroller.scrollTo({ top: scroller.scrollTop + dy, behavior: reduceMotion() ? "auto" : "smooth" });
}

/** Shared by every pressable cable in one layer — see this file's header
 *  for why the rest wait can't live on a cable's own elements. */
interface RevealState {
  timer: number;
  /** Where the pointer last started resting, or last revealed from. */
  x: number;
  y: number;
}

/** What a pressable cable's hit stroke does (attachHit). */
interface HitHandlers {
  click(): void;
  enter(e: PointerEvent): void;
  leave(): void;
}

/** The transparent press target over one pressable cable — see this
 *  file's header. mousedown is dropped like jack.ts does its own, so a
 *  press never moves focus off whatever row was focused (focus opening/
 *  closing a row's hint would slide the port out from under the held
 *  button); Tab still never reaches the layer (aria-hidden). Resting on
 *  it scrolls the cable's ends into view (revealEnd). */
function attachHit(
  g: SVGGElement,
  d: string,
  ends: { jackEl: HTMLElement; portEl: HTMLElement },
  reveal: RevealState,
  clipId: string,
  on: HitHandlers,
): SVGPathElement {
  const hit = pathEl("vc-cable-hit", d, "transparent");
  hit.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "touch") on.enter(e);
  });
  hit.addEventListener("pointerleave", () => on.leave());
  hit.addEventListener("mousedown", (e) => e.preventDefault());
  hit.setAttribute("clip-path", `url(#${clipId})`);
  hit.addEventListener("click", (e) => {
    e.stopPropagation();
    on.click();
  });
  const rest = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    // A rebuilt cable under a still pointer, or a sub-pixel jitter, isn't
    // a move — only a real move restarts the wait.
    if (reveal.timer && Math.hypot(e.clientX - reveal.x, e.clientY - reveal.y) <= REVEAL_STILL_PX) return;
    window.clearTimeout(reveal.timer);
    reveal.x = e.clientX;
    reveal.y = e.clientY;
    reveal.timer = window.setTimeout(() => {
      if (!ends.jackEl.isConnected || !ends.portEl.isConnected) return;
      revealEnd(ends.jackEl);
      revealEnd(ends.portEl);
    }, REVEAL_REST_MS);
  };
  hit.addEventListener("pointerenter", rest);
  hit.addEventListener("pointermove", rest);
  hit.addEventListener("pointerleave", (e) => {
    // The scroll this wait starts slides the cable away; that leave must
    // not undo a reveal already under way, only a wait still pending.
    if (Math.hypot(e.clientX - reveal.x, e.clientY - reveal.y) > REVEAL_STILL_PX) {
      window.clearTimeout(reveal.timer);
      reveal.timer = 0;
    }
  });
  g.append(hit);
  return hit;
}

/** A pulled end, at the pointer. */
interface PullAt {
  end: CableEnd;
  x: number;
  y: number;
}

/** A pinned cable drawn in two halves around its knot: the paths of each
 *  half (strands and hit stroke) and the knot geometry they were last
 *  written for. */
interface Split {
  key: string;
  pt: { x: number; y: number };
  portPt: { x: number; y: number };
  avoidBand: { top: number; bottom: number } | null;
  a: SVGPathElement[];
  b: SVGPathElement[];
  geom: CableKnotGeometry | null;
  /** The pulled end, drawn at the pointer instead of in its socket. */
  pull: PullAt | null;
}

/** A pressable pinned cable: what arming, a pull and playUnplug need of it.
 *  Its paths are `whole`'s, or `split`'s halves around a knot. */
interface Wire {
  key: string;
  src: CableSourceSpec;
  g: SVGGElement;
  pt: { x: number; y: number };
  portPt: { x: number; y: number };
  avoidBand: { top: number; bottom: number } | null;
  whole: SVGPathElement[];
  split: Split | null;
  plugs: Record<CableEnd, SVGGElement>;
}

interface Resolved {
  src: CableSourceSpec;
  pt: { x: number; y: number };
  /** Where this cable may answer a press: the open gap between its jack's
   *  card and its port's card, or null when they leave none. */
  pressBand: { left: number; right: number } | null;
}

/** The open gap between two ends' own cards — see this file's header for
 *  why a cable answers the pointer only there. */
function pressBandFor(jackEl: HTMLElement, portEl: HTMLElement): { left: number; right: number } | null {
  const jackCard = jackEl.closest<HTMLElement>(".vc-card");
  const portCard = portEl.closest<HTMLElement>(".vc-card");
  if (!jackCard || !portCard) return null;
  const j = jackCard.getBoundingClientRect();
  const p = portCard.getBoundingClientRect();
  if (j.right < p.left) return { left: j.right, right: p.left };
  if (p.right < j.left) return { left: p.right, right: j.left };
  return null;
}

function resolveGroup(group: CableGroupSpec): { portPt: { x: number; y: number }; resolved: Resolved[] } | null {
  if (!group.portEl || !group.sources.length) return null;
  const portEl = group.portEl;
  const portPt = endpointFor(portEl);
  if (!portPt) return null;
  const resolved: Resolved[] = [];
  for (const src of group.sources) {
    const pt = endpointFor(src.jackEl);
    if (!pt) continue;
    resolved.push({ src, pt, pressBand: src.onUnplug ? pressBandFor(src.jackEl, portEl) : null });
  }
  return { portPt, resolved };
}

export function createCableLayer(): CableLayer {
  const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("class", "vc-cable-layer");
  svg.setAttribute("aria-hidden", "true");
  // recompute() rebuilds `cables` alone: an unplug's retract in `ghosts`
  // outlives the rebuild that unplug causes (see this file's header).
  const cables = document.createElementNS(NS, "g");
  const ghosts = document.createElementNS(NS, "g");
  svg.append(cables, ghosts);

  let flows: { el: SVGPathElement; key: string; getValue: () => number }[] = [];
  // The jack drag's own cable (setDrag), kept on top of both groups.
  let dragPath: SVGPathElement | null = null;
  // Keyed by source key (namespaced per group — see this file's header) so
  // a rebuild (a patch edit, a scroll) doesn't snap a still-connected
  // cable's flow back to 0 — only a cable that stops existing loses its
  // offset.
  const offsets = new Map<string, number>();
  const reveal: RevealState = { timer: 0, x: 0, y: 0 };
  const knots = createCableKnotLayer();
  let splits: Split[] = [];
  /** The pinned group's pressable cables, by CableSourceSpec key. */
  const wires = new Map<string, Wire>();
  /** The cable under the pointer (see this file's header); `timer` is a pending disarm. */
  let armed: { wire: Wire; timer: number } | null = null;
  /** A press on a plug: a pull once it `moved`, last drawn at `at`. */
  let pull: { wire: Wire; end: CableEnd; pointerId: number; x0: number; y0: number; moved: boolean; at: PullAt | null } | null = null;
  /** The id of the hint this layer showed last (tooltip.ts): a disarm comes
   *  a grace after the leave, by when the pointer may be on a jack whose own
   *  tooltip must stay. */
  let tip = 0;

  /** Rewrites a split cable's two halves to the knot's current sides, only
   *  when they moved since the last write. Writes only. */
  function writeSplit(sp: Split): void {
    const g = knots.geometry(sp.key);
    if (!g) return;
    const last = sp.geom;
    if (last && last.left === g.left && last.right === g.right && last.entryY === g.entryY) return;
    sp.geom = g;
    const a = sp.pull?.end === "jack" ? sp.pull : sp.pt;
    const b = sp.pull?.end === "port" ? sp.pull : sp.portPt;
    // The first half ends at the knot, which sits in the open gap, so only
    // the second half can need the detour under Power, and only while it
    // still ends in the port.
    const dA = cablePathD(a, { x: g.left, y: g.entryY }, null);
    const dB = cablePathD({ x: g.right, y: g.entryY }, b, sp.pull?.end === "port" ? null : sp.avoidBand);
    for (const p of sp.a) p.setAttribute("d", dA);
    for (const p of sp.b) p.setAttribute("d", dB);
  }

  function arm(w: Wire): void {
    if (armed && armed.wire !== w) disarmNow();
    if (armed) {
      window.clearTimeout(armed.timer);
      armed.timer = 0;
      return;
    }
    armed = { wire: w, timer: 0 };
    w.g.classList.add("vc-cable-armed");
    svg.classList.add("vc-cable-has-armed");
  }

  function disarmSoon(w: Wire): void {
    if (armed?.wire !== w || pull) return;
    window.clearTimeout(armed.timer);
    armed.timer = window.setTimeout(() => {
      if (armed?.wire === w) disarmNow();
    }, ARM_GRACE_MS);
  }

  function disarmNow(): void {
    if (!armed) return;
    window.clearTimeout(armed.timer);
    armed.wire.g.classList.remove("vc-cable-armed");
    svg.classList.remove("vc-cable-has-armed");
    armed = null;
    hideTooltipIfShowing(tip);
  }

  function bodyHint(w: Wire): string[] {
    const lines = w.src.label ? [w.src.label] : [];
    if (w.split) lines.push("Click to open its Height and modifier");
    lines.push("Click or pull an end to unplug");
    return lines;
  }

  /** Puts a cable's plugs where `at` leaves them: the pulled one at the
   *  pointer, the other on its stub. Writes only. */
  function placePlugs(w: Wire, at: PullAt | null): void {
    for (const end of CABLE_ENDS) {
      const p = at && at.end === end ? at : plugPoint(w.pt, w.portPt, end);
      w.plugs[end].setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    }
  }

  /** Redraws a cable for a pull at `at`, or back in its sockets for null.
   *  Writes only. */
  function drawPull(w: Wire, at: PullAt | null): void {
    if (w.split) {
      w.split.pull = at;
      w.split.geom = null;
      writeSplit(w.split);
    } else {
      const a = at?.end === "jack" ? at : w.pt;
      const b = at?.end === "port" ? at : w.portPt;
      const d = cablePathD(a, b, at?.end === "port" ? null : w.avoidBand);
      for (const p of w.whole) p.setAttribute("d", d);
    }
    placePlugs(w, at);
  }

  /** A plug's press target: arms its cable, says what it does, and starts a pull. */
  function bindPlug(w: Wire, end: CableEnd): void {
    const hit = rectEl("vc-cable-plug-hit", PLUG_HIT_LEN_PX, PLUG_HIT_CROSS_PX, "transparent");
    hit.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch" || pull) return;
      arm(w);
      const p = plugPoint(w.pt, w.portPt, end);
      tip = showTooltipAt(p.x, p.y - PLUG_HIT_CROSS_PX / 2, w.src.color, [w.src.label ? `Click or pull to unplug ${w.src.label}` : "Click or pull to unplug"]);
    });
    hit.addEventListener("pointerleave", () => disarmSoon(w));
    hit.addEventListener("pointerdown", (e) => startPull(w, end, e));
    w.plugs[end].append(hit);
  }

  function startPull(w: Wire, end: CableEnd, e: PointerEvent): void {
    if (e.button !== 0 || e.pointerType === "touch" || pull) return;
    // As the hit stroke's mousedown: a press on a plug never moves focus.
    e.preventDefault();
    pull = { wire: w, end, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, at: null };
    window.addEventListener("pointermove", onPullMove);
    window.addEventListener("pointerup", onPullUp);
    window.addEventListener("pointercancel", onPullCancel);
  }

  function onPullMove(e: PointerEvent): void {
    const p = pull;
    if (!p || e.pointerId !== p.pointerId) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!p.moved) {
      if (!pullStarts(dx, dy)) return;
      p.moved = true;
      document.body.classList.add("vc-cable-pulling");
      hideTooltipIfShowing(tip);
    }
    p.at = { end: p.end, x: e.clientX, y: e.clientY };
    p.wire.g.classList.toggle("vc-cable-loose", pullRelease(dx, dy, true) === "unplug");
    drawPull(p.wire, p.at);
  }

  function onPullUp(e: PointerEvent): void {
    const p = pull;
    if (!p || e.pointerId !== p.pointerId) return;
    const outcome = pullRelease(e.clientX - p.x0, e.clientY - p.y0, p.moved);
    endPull();
    if (outcome === "back") {
      drawPull(p.wire, null);
      return;
    }
    playUnplug(p.wire.key, p.end);
    p.wire.src.onUnplug?.();
  }

  function onPullCancel(e: PointerEvent): void {
    if (pull && e.pointerId === pull.pointerId) cancelPull();
  }

  /** Lets go of a held plug, leaving the cable as it is drawn. */
  function endPull(): void {
    const p = pull;
    if (!p) return;
    pull = null;
    window.removeEventListener("pointermove", onPullMove);
    window.removeEventListener("pointerup", onPullUp);
    window.removeEventListener("pointercancel", onPullCancel);
    document.body.classList.remove("vc-cable-pulling");
    p.wire.g.classList.remove("vc-cable-loose");
    disarmNow();
  }

  function cancelPull(): void {
    const p = pull;
    if (!p) return;
    endPull();
    drawPull(p.wire, null);
  }

  function playUnplug(sourceKey: string, end: CableEnd): void {
    const w = wires.get(sourceKey);
    if (!w || reduceMotion()) return;
    const ghost = document.createElementNS(NS, "g");
    ghost.setAttribute("class", end === "jack" ? "vc-cable-ghost-g vc-cable-ghost-rev" : "vc-cable-ghost-g");
    for (const p of w.g.querySelectorAll<SVGPathElement>(".vc-cable-core, .vc-cable-muted")) {
      const copy = pathEl("vc-cable-ghost", p.getAttribute("d") ?? "", w.src.color);
      copy.setAttribute("pathLength", "100");
      ghost.append(copy);
    }
    const socket = end === "jack" ? w.pt : w.portPt;
    const spark = document.createElementNS(NS, "circle");
    spark.setAttribute("class", "vc-cable-spark");
    spark.setAttribute("cx", socket.x.toFixed(1));
    spark.setAttribute("cy", socket.y.toFixed(1));
    spark.setAttribute("r", String(SPARK_R_PX));
    spark.setAttribute("stroke", w.src.color);
    const plug = plugEl(w.src.color);
    plug.classList.add("vc-cable-end-pop");
    plug.setAttribute("transform", w.plugs[end].getAttribute("transform") ?? "");
    // Out of the socket: along the stub, away from it.
    const out = (w.portPt.x >= w.pt.x ? 1 : -1) * (end === "jack" ? 1 : -1);
    plug.style.setProperty("--pop", `${out * PLUG_POP_PX}px`);
    ghost.append(spark, plug);
    ghosts.append(ghost);
    window.setTimeout(() => ghost.remove(), GHOST_MAX_MS);
  }

  function recompute(pinnedGroup: CableGroupSpec, previewGroup: CableGroupSpec, fanGroups: readonly CableGroupSpec[] = []): void {
    // Pass 1 — every getBoundingClientRect() read (resolveGroup,
    // powerAvoidBand), none of it interleaved with a DOM write (this
    // file's own header, and the carried rule against layout thrashing),
    // for both groups, before a single path element is built.
    const pinnedResolved = resolveGroup(pinnedGroup);
    const previewResolved = resolveGroup(previewGroup);
    const fanResolved = fanGroups.map(resolveGroup).filter((g) => g !== null);
    const avoidBand = pinnedResolved || previewResolved || fanResolved.length ? powerAvoidBand() : null;
    const viewport = { w: window.innerWidth, h: window.innerHeight };

    // Pass 2 — every write: clear the old cables, build and append the new
    // ones, forget any carried flow offset nothing still uses.
    // A rebuilt cable is an element the pointer hasn't entered; a held pull
    // carries over to its rebuilt cable at the end.
    if (!pull) disarmNow();
    cables.textContent = "";
    wires.clear();
    flows = [];
    splits = [];
    const defs = document.createElementNS(NS, "defs");
    cables.append(defs);
    let clipCount = 0;
    /** One cable's press band as a clip for its hit stroke (attachHit):
     *  the band's full height, so only x limits where it answers. */
    const pressClip = (band: { left: number; right: number }): string => {
      const id = `vc-cable-press-${clipCount++}`;
      const clip = document.createElementNS(NS, "clipPath");
      clip.id = id;
      clip.setAttribute("clipPathUnits", "userSpaceOnUse");
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", band.left.toFixed(1));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", (band.right - band.left).toFixed(1));
      rect.setAttribute("height", "100%");
      clip.append(rect);
      defs.append(clip);
      return id;
    };
    const liveKeys = new Set<string>();

    // The lit signal's fan first, so the pinned/preview cables it may
    // share a jack and port with draw over it — see this file's header.
    for (const { portPt, resolved } of fanResolved) {
      for (const { src, pt } of resolved) cables.append(pathEl("vc-cable-fan", cablePathD(pt, portPt, avoidBand), src.color));
    }

    // The pinned group dims once a preview is also on screen, so it never
    // competes with the cable that's actually being previewed right now —
    // see controlsTheme.ts's .vc-cable-dimmed.
    const dimmed = pinnedResolved !== null && previewResolved !== null;
    const knotPlacements: CableKnotPlacement[] = [];
    if (pinnedResolved) {
      const { portPt, resolved } = pinnedResolved;
      // resolveGroup only resolves a group that has a port.
      const portEl = pinnedGroup.portEl!;
      const ends = (src: CableSourceSpec) => ({ jackEl: src.jackEl, portEl });
      /** One cable's (or one half's) strands into `g`: flat for a muted
       *  source — no glow/flow layer, no offset to carry, overriding
       *  cond/soft outright (CableSourceSpec.muted) — else glow/core/flow,
       *  the flow carrying its offset under `key`. */
      const strands = (g: SVGGElement, src: CableSourceSpec, d: string, key: string, getValue: () => number): SVGPathElement[] => {
        if (src.muted) {
          const p = pathEl("vc-cable-muted", d, src.color);
          g.append(p);
          return [p];
        }
        liveKeys.add(key);
        const soft = src.soft ? " vc-cable-soft" : "";
        const cond = src.cond ? " vc-cable-cond" : "";
        const dimCls = dimmed ? " vc-cable-dimmed" : "";
        const isNew = !!src.isNew && !reduceMotion();
        const newCls = isNew ? " vc-cable-new" : "";
        const glow = pathEl(`vc-cable-glow${soft}${dimCls}${newCls}`, d, src.color);
        const core = pathEl(`vc-cable-core${soft}${cond}${dimCls}${newCls}`, d, src.color);
        core.setAttribute("pathLength", "100");
        const flow = pathEl(`vc-cable-flow${soft}${dimCls}${newCls}`, d, src.color);
        if (isNew) {
          glow.style.setProperty("--o", "0.13");
          flow.style.setProperty("--o", src.soft ? "0.4" : "0.9");
        }
        flow.setAttribute("stroke-dashoffset", (offsets.get(key) ?? 0).toFixed(2));
        g.append(glow, core, flow);
        flows.push({ el: flow, key, getValue });
        return [glow, core, flow];
      };
      // Top jack first, so the spread runs the same way down the meters.
      const knotted = resolved.filter((r) => r.src.knot && r.src.onUnplug && r.pressBand).sort((a, b) => a.pt.y - b.pt.y);
      const knotT = new Map(
        knotted.map((r, i) => [r.src.key, Math.min(KNOT_T_MAX, Math.max(KNOT_T_MIN, 0.5 + (i - (knotted.length - 1) / 2) * KNOT_SPREAD_T))]),
      );
      for (const { src, pt, pressBand } of resolved) {
        const key = `pinned:${src.key}`;
        const g = groupEl(src.color);
        if (!src.onUnplug || !pressBand) {
          strands(g, src, cablePathD(pt, portPt, avoidBand), key, src.getValue);
          cables.append(g);
          continue;
        }
        const clipId = pressClip(pressBand);
        const w: Wire = { key: src.key, src, g, pt, portPt, avoidBand, whole: [], split: null, plugs: { jack: plugEl(src.color), port: plugEl(src.color) } };
        wires.set(src.key, w);
        const on: HitHandlers = {
          click: () => {
            if (w.split) knots.open(w.key);
          },
          enter: (e) => {
            if (pull) return;
            arm(w);
            tip = showTooltipAt(e.clientX, e.clientY, src.color, bodyHint(w));
            if (w.split) knots.setPeek(w.key, true);
          },
          leave: () => {
            disarmSoon(w);
            if (w.split) knots.setPeek(w.key, false);
          },
        };
        const knot = src.knot;
        if (!knot) {
          const d = cablePathD(pt, portPt, avoidBand);
          w.whole = strands(g, src, d, key, src.getValue);
          w.whole.push(attachHit(g, d, ends(src), reveal, clipId, on));
        } else {
          g.classList.add("vc-cable-knotted");
          const rest = cablePointAt(pt, portPt, avoidBand, knotT.get(src.key) ?? 0.5);
          const restX = Math.min(pressBand.right - KNOT_GAP_INSET_PX, Math.max(pressBand.left + KNOT_GAP_INSET_PX, rest.x));
          knotPlacements.push({ key: src.key, color: src.color, anchor: { x: restX, y: rest.y }, gap: pressBand, spec: knot });
          // The halves' `d` waits for the knot's geometry, which sync() below
          // settles; writeSplit fills it in.
          const split: Split = { key: src.key, pt, portPt, avoidBand, a: [], b: [], geom: null, pull: null };
          splits.push(split);
          w.split = split;
          split.a = strands(g, src, "", `${key}:a`, () => knot.read()?.input ?? src.getValue());
          split.b = strands(g, src, "", `${key}:b`, () => knot.read()?.output ?? src.getValue());
          split.a.push(attachHit(g, "", ends(src), reveal, clipId, on));
          split.b.push(attachHit(g, "", ends(src), reveal, clipId, on));
        }
        for (const end of CABLE_ENDS) bindPlug(w, end);
        g.append(w.plugs.jack, w.plugs.port);
        placePlugs(w, null);
        cables.append(g);
      }
    }
    // Runs even with nothing pinned, so a knot whose cable went away goes too.
    knots.sync(knotPlacements, viewport);
    for (const sp of splits) writeSplit(sp);
    // The preview group: one flat, static path per source — see this
    // file's header for why it carries no glow/flow layer of its own.
    if (previewResolved) {
      const { portPt, resolved } = previewResolved;
      for (const { src, pt } of resolved) {
        liveKeys.add(`preview:${src.key}`);
        const d = cablePathD(pt, portPt, avoidBand);
        cables.append(pathEl("vc-cable-preview", d, src.color));
      }
    }
    // Forget any source's carried offset that no longer has a cable —
    // otherwise a long session leaks one Map entry per source ever shown.
    for (const k of [...offsets.keys()]) if (!liveKeys.has(k)) offsets.delete(k);
    // A rebuild mid-pull (a scroll, a card resizing): the held plug carries
    // on with the rebuilt cable, or lets go if that cable is gone.
    if (pull) {
      const w = wires.get(pull.wire.key);
      if (!w) {
        endPull();
      } else {
        pull.wire = w;
        if (armed) armed.wire = w;
        w.g.classList.add("vc-cable-armed");
        if (pull.at) {
          w.g.classList.toggle("vc-cable-loose", pullRelease(pull.at.x - pull.x0, pull.at.y - pull.y0, true) === "unplug");
          drawPull(w, pull.at);
        }
      }
    }
  }

  function setDrag(drag: { from: HTMLElement; x: number; y: number; color: string } | null): void {
    const pt = drag ? endpointFor(drag.from) : null;
    if (!drag || !pt) {
      dragPath?.remove();
      dragPath = null;
      return;
    }
    const d = cablePathD(pt, { x: drag.x, y: drag.y }, null);
    if (!dragPath) {
      dragPath = pathEl("vc-cable-drag", d, drag.color);
    } else {
      dragPath.setAttribute("d", d);
      dragPath.setAttribute("stroke", drag.color);
    }
    if (svg.lastChild !== dragPath) svg.append(dragPath);
  }

  return {
    el: svg,
    recompute,
    tick(dtSec) {
      knots.tick(dtSec);
      for (const sp of splits) writeSplit(sp);
      if (!flows.length || reduceMotion()) return;
      for (const f of flows) {
        const v = Math.max(0, Math.min(1.5, f.getValue()));
        const next = (offsets.get(f.key) ?? 0) - (6 + 70 * v) * dtSec;
        offsets.set(f.key, next);
        f.el.setAttribute("stroke-dashoffset", next.toFixed(2));
      }
    },
    setVisible(v) {
      svg.style.display = v ? "" : "none";
      knots.setVisible(v);
      if (!v) {
        cancelPull();
        disarmNow();
      }
    },
    setDrag,
    knotEl: knots.el,
    openKnot: (sourceKey) => knots.open(sourceKey),
    closeKnot: () => knots.close(),
    knotOpen: () => knots.openKey() !== null,
    playUnplug,
    pulling: () => pull !== null,
    cancelPull,
  };
}
