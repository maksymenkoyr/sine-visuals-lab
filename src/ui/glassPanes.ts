import type { GlassPane } from "../render/glassBackdrop.ts";

/**
 * Where the panel's glass surfaces are, for the renderer to draw Panel blur's
 * "Fast" look under them (render/glassBackdrop.ts; the looks are
 * glassPref.ts's). A surface opts in with GLASS_PANE_CLASS: the cards
 * (controlsKit.ts's createCard) and the Auto bar, which sit straight on the
 * scene. A surface that floats over other panel content (the sticky footer
 * dock and its keys list, the Room dialog, a pill inside a card) keeps the
 * browser's blur in every look, since a blur drawn into the canvas cannot see
 * the cards between it and the scene; those are small, so they cost little.
 *
 * readGlassPanes() runs once per drawn frame, in app.ts's tick before the
 * panel writes its own styles for the frame, so the layout it reads is the
 * one the browser already has and asking for it costs no extra layout. Per
 * surface it reports:
 * - the border box, from getBoundingClientRect (so a Web Animation on the
 *   box's size, like Power's fold, is followed);
 * - the visible part: the box cut by every ancestor that clips its overflow
 *   (the scrolling columns) up to the first fixed-position one, and by the
 *   canvas's own box;
 * - its opacity times its ancestors', and nothing at all while it is
 *   invisible.
 * The clipping ancestors and the corner radius are looked up once per
 * surface and again when it moves to another parent (a dragged card) or the
 * window resizes (the stacked layout clips differently). Everything is in CSS
 * px relative to the canvas box; glassBackdrop.ts maps it onto the drawing
 * buffer after the canvas has been sized for the frame.
 */

export const GLASS_PANE_CLASS = "vc-glass-pane";

interface PaneInfo {
  parent: Element | null;
  epoch: number;
  clips: Element[];
  radius: number;
}

const infos = new WeakMap<Element, PaneInfo>();
const styles = new WeakMap<Element, CSSStyleDeclaration>();
/** Bumped on a window resize, which can change what clips what. */
let epoch = 0;
let listening = false;
let surfaces: HTMLCollectionOf<Element> | null = null;
/** Per call: each clipping ancestor's box and each element's opacity, so a
 *  column shared by many cards is measured once. */
const clipBoxes = new Map<Element, DOMRect>();
const opacities = new Map<Element, number>();

function styleOf(el: Element): CSSStyleDeclaration {
  let s = styles.get(el);
  if (!s) {
    s = getComputedStyle(el);
    styles.set(el, s);
  }
  return s;
}

function infoOf(el: Element): PaneInfo {
  const parent = el.parentElement;
  const known = infos.get(el);
  if (known && known.parent === parent && known.epoch === epoch) return known;
  const clips: Element[] = [];
  if (styleOf(el).position !== "fixed") {
    for (let a = parent; a && a !== document.documentElement; a = a.parentElement) {
      const s = styleOf(a);
      if (s.display !== "contents" && (s.overflowX !== "visible" || s.overflowY !== "visible")) clips.push(a);
      if (s.position === "fixed") break;
    }
  }
  const info = { parent, epoch, clips, radius: parseFloat(styleOf(el).borderTopLeftRadius) || 0 };
  infos.set(el, info);
  return info;
}

/** `el`'s opacity times every ancestor's. */
function opacityOf(el: Element | null): number {
  if (!el) return 1;
  const known = opacities.get(el);
  if (known !== undefined) return known;
  const own = parseFloat(styleOf(el).opacity);
  const value = (Number.isFinite(own) ? own : 1) * opacityOf(el.parentElement);
  opacities.set(el, value);
  return value;
}

function clipBoxOf(el: Element): DOMRect {
  let r = clipBoxes.get(el);
  if (!r) {
    r = el.getBoundingClientRect();
    clipBoxes.set(el, r);
  }
  return r;
}

/** Fills `out` with the visible glass surfaces, relative to `canvas`'s box,
 *  and returns how many; `box` gets that box's size. Reuses the objects
 *  already in `out`. */
export function readGlassPanes(canvas: HTMLElement, out: GlassPane[], box: { w: number; h: number }): number {
  if (!listening) {
    listening = true;
    window.addEventListener("resize", () => {
      epoch++;
    });
    surfaces = document.getElementsByClassName(GLASS_PANE_CLASS);
  }
  const c = canvas.getBoundingClientRect();
  box.w = c.width;
  box.h = c.height;
  clipBoxes.clear();
  opacities.clear();
  let n = 0;
  const list = surfaces!;
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (styleOf(el).visibility !== "visible") continue;
    const alpha = opacityOf(el);
    if (alpha <= 0) continue;
    const info = infoOf(el);
    let x0 = Math.max(r.left, c.left);
    let y0 = Math.max(r.top, c.top);
    let x1 = Math.min(r.right, c.right);
    let y1 = Math.min(r.bottom, c.bottom);
    for (const a of info.clips) {
      const b = clipBoxOf(a);
      x0 = Math.max(x0, b.left);
      y0 = Math.max(y0, b.top);
      x1 = Math.min(x1, b.right);
      y1 = Math.min(y1, b.bottom);
    }
    if (x1 <= x0 || y1 <= y0) continue;
    let p = out[n];
    if (!p) {
      p = { x: 0, y: 0, w: 0, h: 0, clipX0: 0, clipY0: 0, clipX1: 0, clipY1: 0, radius: 0, alpha: 1 };
      out[n] = p;
    }
    p.x = r.left - c.left;
    p.y = r.top - c.top;
    p.w = r.width;
    p.h = r.height;
    p.clipX0 = x0 - c.left;
    p.clipY0 = y0 - c.top;
    p.clipX1 = x1 - c.left;
    p.clipY1 = y1 - c.top;
    p.radius = info.radius;
    p.alpha = alpha;
    n++;
  }
  return n;
}
