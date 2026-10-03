// Draws Toon Rave's SVG artwork with Canvas2D, one frame at a time.
//
// The art is a single SVG string (art/scene.ts: buildSceneSvg). compileScene() reads it once, in
// the browser, into a tree of draw nodes with precomputed Path2D shapes; drawProgram() then paints
// that tree for one FrameState (motion.ts), applying the state the way the prototype's DOM writer
// did: rig matrices (data-x), fx opacities (data-o), the cel shown per part (data-cel), the LED
// meters (data-led), the ray fade (data-ray), the crowd rows' eye classes, the DJ and the glowstick
// moving between a back and a front slot, and the camera matrix on g#cam.
//
// What it handles is only what the art uses: g, path, circle, ellipse, rect (with rx/ry) and line;
// matrix/rotate/translate/scale transform chains; fill and stroke (with width, join, cap, dash and
// paint-order); opacity and display:none; clip-path to a clipPath; radialGradient in
// objectBoundingBox units; and mix-blend-mode: screen. The impact-frame filter is NOT drawn here:
// the scene's GL pass does it from DrawProgram.impact (the filters' matrix and table values, read
// out of the markup's defs).
//
// Group opacity. SVG fades a group as a unit, so overlapping children do not show through each
// other. Where a group's painted parts overlap (checked once at compile time from their bounding
// boxes) it is drawn into a reusable offscreen layer, cropped to the group's box, and composited
// at its opacity; where they cannot overlap, the opacity just multiplies down the tree. The
// screen-blended ray groups always take a layer.
//
// Browser only: compileScene() needs DOMParser and a live <svg> for getBBox, and drawProgram()
// creates layer canvases. The parsers at the top (parseTransform, parseStyle, ...) are pure and
// are what the node tests cover. Nothing at module scope touches the DOM.
import { cameraMatrix, type FrameState, type Mat } from "./motion";

// --- pure helpers ----------------------------------------------------------------------------
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** A*B for SVG-order matrices: apply B first, then A. */
export function mulMat(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/**
 * Parses an SVG transform list (matrix, translate, scale, rotate, skewX, skewY; commas or spaces)
 * into one matrix. An empty or null string is the identity. An unknown function throws.
 */
export function parseTransform(str: string | null | undefined): Mat {
  let M: Mat = IDENTITY;
  if (!str) return M;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const name = m[1];
    const a = m[2].trim().split(/[\s,]+/).filter((s) => s !== "").map(Number);
    let T: Mat;
    switch (name) {
      case "matrix":
        if (a.length !== 6) throw new Error("bad matrix()");
        T = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "translate":
        T = [1, 0, 0, 1, a[0], a.length > 1 ? a[1] : 0];
        break;
      case "scale":
        T = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
        break;
      case "rotate": {
        const r = (a[0] * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        T = [c, s, -s, c, 0, 0];
        if (a.length >= 3) {
          T = mulMat(mulMat([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]);
        }
        break;
      }
      case "skewX":
        T = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        T = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        throw new Error(`unsupported transform ${name}`);
    }
    M = mulMat(M, T);
  }
  return M;
}

/** Parses a style attribute ("display:none; opacity: .5") into lower-case keys. */
export function parseStyle(str: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!str) return out;
  for (const part of str.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** An SVG number or a percentage ("50%" is 0.5), for objectBoundingBox lengths. */
export function parseFraction(str: string | null | undefined, fallback: number): number {
  if (str === null || str === undefined || str === "") return fallback;
  const s = str.trim();
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return fallback;
  return s.endsWith("%") ? v / 100 : v;
}

/** A hex colour (#rgb or #rrggbb) with an opacity as an rgba() string; other colours pass through. */
export function colorWithOpacity(color: string, opacity: number): string {
  const c = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** How the prototype writes an fx opacity: toFixed(3), and no opacity at all at 0.999 or more. */
export function roundedOpacity(op: number): number {
  return op >= 0.999 ? 1 : Number(op.toFixed(3));
}

/** A rounded rect's path data, with rx/ry clamped to half the size as SVG says. */
export function roundRectPath(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null): string {
  let rx = rxIn;
  let ry = ryIn;
  if (rx === null && ry === null) return `M${x},${y}h${w}v${h}h${-w}z`;
  if (rx === null) rx = ry;
  if (ry === null) ry = rx;
  rx = Math.min(rx as number, w / 2);
  ry = Math.min(ry as number, h / 2);
  return (
    `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}` +
    `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}` +
    `V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}z`
  );
}

/** An axis-aligned box [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

/** The box of a box under a matrix (the box of its four transformed corners). */
export function transformBox(b: Box, m: Mat): Box {
  const xs = [b[0], b[2], b[0], b[2]];
  const ys = [b[1], b[1], b[3], b[3]];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const x = m[0] * xs[i] + m[2] * ys[i] + m[4];
    const y = m[1] * xs[i] + m[3] * ys[i] + m[5];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export const unionBox = (a: Box | null, b: Box): Box =>
  a === null ? b : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** True when two boxes share area (touching edges do not count). */
export const boxesOverlap = (a: Box, b: Box): boolean =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-6 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-6;

// --- the compiled program ----------------------------------------------------------------------
interface Gradient {
  cx: number;
  cy: number;
  r: number;
  fx: number;
  fy: number;
  stops: Array<[number, string]>;
  cache: WeakMap<object, CanvasGradient>;
}

interface Item {
  box: Box;
  self: boolean;
}

interface DrawNode {
  /** A leaf paints a shape; a group draws its children. */
  path: Path2D | null;
  children: DrawNode[];
  /** Own transform (a rig's is replaced by the frame state's matrix). */
  tr: Mat | null;
  /** The opacity attribute (1 when absent). */
  opacity: number;
  /** Initially display:none. */
  hidden: boolean;
  screen: boolean;
  clip: Path2D | null;
  // paint (leaves; inherited values are resolved at compile time)
  fill: string | Gradient | null;
  stroke: string | null;
  sw: number;
  join: CanvasLineJoin;
  cap: CanvasLineCap;
  dash: number[] | null;
  strokeFirst: boolean;
  /** A gradient fill's path in the gradient's unit space, and the matrix from there. */
  unitPath: Path2D | null;
  unitMat: Mat | null;
  // dynamic attributes
  rig?: string;
  fx?: string;
  celPart?: string;
  celName?: string;
  led?: [number, number];
  rayBase?: number;
  isRays?: boolean;
  isCam?: boolean;
  /** The crowd rig's initial eye class, and a descendant's eye index (class e0, e1, e2). */
  evInit?: number;
  eIdx?: number;
  /** A slot group (djFront, djBack, stickFront, stickBack): which item, and which side. */
  slotItem?: "dj" | "stick";
  slotSide?: "front" | "back";
  // layering
  /** Local box (after the node's own transform), null when unknown. */
  box: Box | null;
  /** True when the box cannot be trusted: the node holds moving rigs, a slot or the camera. */
  dyn: boolean;
  /** True when the node's own transform comes from the frame state (a rig, the camera). */
  moves: boolean;
  /** True when the painted parts may overlap, so a faded group needs a layer. */
  overlap: boolean;
  items: Item[];
}

/** What the impact filters do, read from the markup's defs. */
export interface ImpactFilters {
  matrix: number[];
  a: { lo: number[]; hi: number[] };
  b: { lo: number[]; hi: number[] };
}

export interface DrawProgram {
  root: DrawNode;
  /** The colour behind the art (the markup's first rect), which drawProgram floods the canvas with. */
  background: string;
  impact: ImpactFilters;
  /** The art's own size (the viewBox). */
  width: number;
  height: number;
  /** Cels per part, and the one shown initially. */
  celNames: Record<string, string[]>;
  celInit: Record<string, string>;
  /** The DJ's and the glowstick's rig nodes, drawn into whichever slot the state names. */
  slotItems: { dj: DrawNode | null; stick: DrawNode | null };
  /** Counts from the last drawProgram call, for the harness. */
  stats: { layers: number; leaves: number };
  layers: Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pen: Pen }>;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_ITEMS = 64;

function newNode(): DrawNode {
  return {
    path: null, children: [], tr: null, opacity: 1, hidden: false, screen: false, clip: null,
    fill: null, stroke: null, sw: 1, join: "miter", cap: "butt", dash: null, strokeFirst: false,
    unitPath: null, unitMat: null, box: null, dyn: false, moves: false, overlap: false, items: [],
  };
}

interface Inherited {
  fill: string;
  stroke: string;
  sw: number;
  join: CanvasLineJoin;
  cap: CanvasLineCap;
  dash: number[] | null;
}

const attrNum = (el: Element, name: string, fallback = 0): number => {
  const v = el.getAttribute(name);
  if (v === null || v === "") return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Compiles the art into a draw program. Browser only: it parses the markup with DOMParser and
 * attaches a hidden <svg> to document.body for the length of the call, to measure bounding boxes
 * (and removes it before returning).
 */
export function compileScene(markup: string): DrawProgram {
  // Parsed as HTML, the way the prototype's innerHTML did: the art repeats an attribute on a
  // few elements (stroke-linecap twice), which the HTML parser forgives (the first one wins) and
  // an XML parser rejects.
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const root = parsed.querySelector("svg");
  if (!root) throw new Error("toonrave: the art has no <svg>");
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  const holder = document.createElementNS(SVG_NS, "svg");
  holder.setAttribute("width", "0");
  holder.setAttribute("height", "0");
  holder.setAttribute("style", "position:absolute;left:-99999px;top:0;overflow:hidden;visibility:hidden;pointer-events:none");
  holder.setAttribute("aria-hidden", "true");
  holder.appendChild(svg);
  document.body.appendChild(holder);
  try {
    return compileLive(svg);
  } finally {
    document.body.removeChild(holder);
  }
}

function compileLive(svg: SVGSVGElement): DrawProgram {
  // Read every style attribute first, then drop them so hidden cels can be measured.
  const styles = new Map<Element, Record<string, string>>();
  svg.querySelectorAll("[style]").forEach((el) => {
    styles.set(el, parseStyle(el.getAttribute("style")));
    el.removeAttribute("style");
  });

  // Gradients and clip paths, by id.
  const gradients: Record<string, Gradient> = {};
  svg.querySelectorAll("radialGradient").forEach((g) => {
    const stops: Array<[number, string]> = [];
    g.querySelectorAll("stop").forEach((s) => {
      const off = parseFraction(s.getAttribute("offset"), 0);
      const op = parseFloat(s.getAttribute("stop-opacity") ?? "1");
      stops.push([off, colorWithOpacity(s.getAttribute("stop-color") ?? "#000", Number.isFinite(op) ? op : 1)]);
    });
    const cx = parseFraction(g.getAttribute("cx"), 0.5);
    const cy = parseFraction(g.getAttribute("cy"), 0.5);
    gradients[g.id] = {
      cx, cy, r: parseFraction(g.getAttribute("r"), 0.5),
      fx: parseFraction(g.getAttribute("fx"), cx), fy: parseFraction(g.getAttribute("fy"), cy),
      stops, cache: new WeakMap(),
    };
  });
  const clips: Record<string, Path2D> = {};
  svg.querySelectorAll("clipPath").forEach((c) => {
    const p = new Path2D();
    c.querySelectorAll("path").forEach((pe) => {
      const t = parseTransform(pe.getAttribute("transform"));
      p.addPath(new Path2D(pe.getAttribute("d") ?? ""), { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] });
    });
    clips[c.id] = p;
  });

  const prog: DrawProgram = {
    root: newNode(), background: "#000", impact: readImpact(svg), width: 1600, height: 900,
    celNames: {}, celInit: {}, slotItems: { dj: null, stick: null }, stats: { layers: 0, leaves: 0 }, layers: [],
  };
  const vb = (svg.getAttribute("viewBox") ?? "0 0 1600 900").split(/[\s,]+/).map(Number);
  prog.width = vb[2];
  prog.height = vb[3];

  const oIds = new Set<string>();
  svg.querySelectorAll("[data-o]").forEach((el) => oIds.add(el.getAttribute("data-o") as string));
  const rigNodes: DrawNode[] = [];
  let firstRect = true;

  function build(el: Element, inh: Inherited): DrawNode | null {
    const tag = el.localName;
    const isGroup = tag === "g" || tag === "svg";
    if (!isGroup && tag !== "path" && tag !== "circle" && tag !== "ellipse" && tag !== "rect" && tag !== "line") return null;
    const n = newNode();
    const style = styles.get(el) ?? {};
    const trAttr = el.getAttribute("transform");
    if (trAttr) n.tr = parseTransform(trAttr);
    const opAttr = el.getAttribute("opacity");
    if (opAttr !== null) n.opacity = parseFloat(opAttr);
    if (style.opacity !== undefined) n.opacity = parseFloat(style.opacity);
    n.hidden = style.display === "none";
    n.screen = style["mix-blend-mode"] === "screen";
    const cp = el.getAttribute("clip-path");
    if (cp) {
      const id = /url\(#([^)]+)\)/.exec(cp)?.[1];
      if (id && clips[id]) n.clip = clips[id];
    }

    // inherited presentation attributes
    const here: Inherited = { ...inh };
    const fillA = el.getAttribute("fill");
    if (fillA !== null) here.fill = fillA;
    const strokeA = el.getAttribute("stroke");
    if (strokeA !== null) here.stroke = strokeA;
    const swA = el.getAttribute("stroke-width");
    if (swA !== null) here.sw = parseFloat(swA);
    const joinA = el.getAttribute("stroke-linejoin");
    if (joinA !== null) here.join = joinA as CanvasLineJoin;
    const capA = el.getAttribute("stroke-linecap");
    if (capA !== null) here.cap = capA as CanvasLineCap;
    const dashA = el.getAttribute("stroke-dasharray");
    if (dashA !== null) here.dash = dashA === "none" ? null : dashA.split(/[\s,]+/).map(Number);

    // dynamic attributes, as the prototype's registry reads them
    const rig = el.getAttribute("data-x");
    if (rig !== null) { n.rig = rig; rigNodes.push(n); n.moves = true; }
    const fx = el.getAttribute("data-o");
    if (fx !== null) n.fx = fx;
    const cel = el.getAttribute("data-cel");
    if (cel !== null) {
      const [part, name] = cel.split(":");
      n.celPart = part;
      n.celName = name;
      (prog.celNames[part] ||= []).push(name);
      if (!n.hidden) prog.celInit[part] = name;
    }
    const led = el.getAttribute("data-led");
    if (led !== null) { const [j, i] = led.split(":").map(Number); n.led = [j, i]; }
    const ray = el.getAttribute("data-ray");
    if (ray !== null) n.rayBase = +ray;
    if (rig === "rays") n.isRays = true;
    if (el.id === "cam") { n.isCam = true; n.moves = true; }
    const cls = el.getAttribute("class");
    if (cls) {
      const ev = /^ev([0-2])$/.exec(cls);
      if (ev) n.evInit = +ev[1];
      const e = /^e([0-2])$/.exec(cls);
      if (e) n.eIdx = +e[1];
    }
    if (el.id === "djFront" || el.id === "djBack") { n.slotItem = "dj"; n.slotSide = el.id === "djFront" ? "front" : "back"; n.dyn = true; }
    if (el.id === "stickFront" || el.id === "stickBack") { n.slotItem = "stick"; n.slotSide = el.id === "stickFront" ? "front" : "back"; n.dyn = true; }

    if (isGroup) {
      let box: Box | null = null;
      let unknown = false;
      let many = false;
      const items: Item[] = [];
      for (const child of Array.from(el.children)) {
        const c = build(child, here);
        if (!c) continue;
        // the DJ and the glowstick are drawn into whichever slot the state names, not as children
        if (n.slotItem && c.rig === n.slotItem) { prog.slotItems[n.slotItem] = c; continue; }
        n.children.push(c);
      }
      if (n.slotItem) { n.dyn = true; unknown = true; }
      else if (n.children.length === 0) return null;
      for (const c of n.children) {
        if (c.moves || c.dyn || c.box === null) { n.dyn = true; unknown = true; many = true; continue; }
        const cb = c.tr ? transformBox(c.box, c.tr) : c.box;
        box = unionBox(box, cb);
        if (c.items.length > MAX_ITEMS || c.overlap && c.items.length === 0) many = true;
        else for (const it of c.items) items.push({ box: c.tr ? transformBox(it.box, c.tr) : it.box, self: it.self });
      }
      n.box = unknown ? null : box;
      if (many || items.length > MAX_ITEMS) { n.overlap = true; n.items = []; }
      else {
        n.items = items;
        n.overlap = items.some((a) => a.self);
        for (let i = 0; i < items.length && !n.overlap; i++) {
          for (let j = i + 1; j < items.length; j++) if (boxesOverlap(items[i].box, items[j].box)) { n.overlap = true; break; }
        }
      }
      return n;
    }

    // leaves
    let bb: Box;
    if (tag === "path") {
      const d = el.getAttribute("d") ?? "";
      n.path = new Path2D(d);
      const r = (el as unknown as SVGGraphicsElement).getBBox();
      bb = [r.x, r.y, r.x + r.width, r.y + r.height];
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = attrNum(el, "cx");
      const cy = attrNum(el, "cy");
      const rx = tag === "circle" ? attrNum(el, "r") : attrNum(el, "rx");
      const ry = tag === "circle" ? rx : attrNum(el, "ry");
      n.path = new Path2D();
      n.path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      bb = [cx - rx, cy - ry, cx + rx, cy + ry];
    } else if (tag === "rect") {
      const x = attrNum(el, "x");
      const y = attrNum(el, "y");
      const w = attrNum(el, "width");
      const h = attrNum(el, "height");
      const rxA = el.getAttribute("rx");
      const ryA = el.getAttribute("ry");
      n.path = new Path2D(roundRectPath(x, y, w, h, rxA === null ? null : parseFloat(rxA), ryA === null ? null : parseFloat(ryA)));
      bb = [x, y, x + w, y + h];
    } else {
      const x1 = attrNum(el, "x1");
      const y1 = attrNum(el, "y1");
      const x2 = attrNum(el, "x2");
      const y2 = attrNum(el, "y2");
      n.path = new Path2D(`M${x1},${y1}L${x2},${y2}`);
      bb = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    }

    // paint
    n.sw = here.sw;
    n.join = here.join;
    n.cap = here.cap;
    n.dash = here.dash;
    n.strokeFirst = el.getAttribute("paint-order") === "stroke";
    if (tag !== "line") n.fill = resolvePaint(here.fill, gradients);
    n.stroke = here.stroke === "none" || here.stroke.startsWith("url(") ? null : here.stroke;
    if (n.sw <= 0) n.stroke = null;
    if (n.fill === null && n.stroke === null) return null;
    if (n.fill && typeof n.fill !== "string") {
      // objectBoundingBox: the gradient's unit square is the shape's box
      const w = bb[2] - bb[0];
      const h = bb[3] - bb[1];
      if (w <= 0 || h <= 0) n.fill = null;
      else {
        n.unitMat = [w, 0, 0, h, bb[0], bb[1]];
        n.unitPath = new Path2D();
        n.unitPath.addPath(n.path, { a: 1 / w, b: 0, c: 0, d: 1 / h, e: -bb[0] / w, f: -bb[1] / h });
      }
      if (n.fill === null && n.stroke === null) return null;
    }
    if (firstRect && tag === "rect" && typeof n.fill === "string") { prog.background = n.fill; firstRect = false; }
    let m = 0;
    if (n.stroke) m = n.sw * (n.join === "miter" ? 2 : 0.5) + 0.5;
    n.box = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
    // a leaf's own fill and stroke overlap where the stroke's inner half meets the fill
    n.items = [{ box: n.box, self: n.fill !== null && n.stroke !== null }];
    n.overlap = n.items[0].self;
    return n;
  }

  prog.root = build(svg, { fill: "#000", stroke: "none", sw: 1, join: "miter", cap: "butt", dash: null }) ?? newNode();
  for (const r of rigNodes) if (r.fx === undefined && r.rig !== undefined && !oIds.has(r.rig)) r.fx = r.rig;
  return prog;
}

function resolvePaint(v: string, gradients: Record<string, Gradient>): string | Gradient | null {
  if (v === "none") return null;
  const id = /^url\(#([^)]+)\)$/.exec(v)?.[1];
  if (id) return gradients[id] ?? null;
  return v;
}

function readImpact(svg: Element): ImpactFilters {
  const table = (id: string): { lo: number[]; hi: number[] } => {
    const f = svg.querySelector(`filter[id="${id}"]`);
    const lo: number[] = [];
    const hi: number[] = [];
    f?.querySelectorAll("feFuncR, feFuncG, feFuncB").forEach((fn) => {
      const t = (fn.getAttribute("tableValues") ?? "0 1 1").trim().split(/\s+/).map(Number);
      lo.push(t[0]);
      hi.push(t[1]);
    });
    return { lo, hi };
  };
  const cm = svg.querySelector("feColorMatrix")?.getAttribute("values") ?? "";
  return { matrix: cm.trim().split(/\s+/).map(Number), a: table("impactA"), b: table("impactB") };
}

// --- drawing -------------------------------------------------------------------------------------
/** Where to place the art on the canvas: art units times `scale`, plus a shift in pixels. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** What a context currently has set, so repeated sets can be skipped. */
export interface Pen {
  lw: number;
  join: string;
  cap: string;
  dashed: boolean;
  alpha: number;
  fs: string | null;
  ss: string | null;
  tm: Mat | null;
  frame: number;
}

function newPen(ctx: CanvasRenderingContext2D, frame: number): Pen {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.miterLimit = 4; // SVG's default; canvas defaults to 10
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return { lw: 1, join: "miter", cap: "butt", dashed: false, alpha: 1, fs: null, ss: null, tm: null, frame };
}

/** Forgets what is cached, after a save/restore pair put the context's state back. */
function dirtyPen(p: Pen): void {
  p.lw = -1;
  p.join = "";
  p.cap = "";
  p.alpha = -1;
  p.fs = null;
  p.ss = null;
  p.tm = null;
}

interface Rt {
  prog: DrawProgram;
  st: FrameState;
  sel: Record<string, string>;
  ctx: CanvasRenderingContext2D;
  pen: Pen;
  depth: number;
  w: number;
  h: number;
  frame: number;
}

let frameCounter = 0;

/** Paints one frame of the compiled art. `view` maps art units to canvas pixels. */
export function drawProgram(ctx: CanvasRenderingContext2D, prog: DrawProgram, state: FrameState, view: View): void {
  const canvas = ctx.canvas;
  const frame = ++frameCounter;
  const pen = newPen(ctx, frame);
  ctx.fillStyle = prog.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sel: Record<string, string> = {};
  for (const part in prog.celNames) {
    const want = state.cel[part];
    sel[part] = want !== undefined && prog.celNames[part].indexOf(want) >= 0 ? want : prog.celInit[part];
  }
  prog.stats.layers = 0;
  prog.stats.leaves = 0;
  const rt: Rt = { prog, st: state, sel, ctx, pen, depth: 0, w: canvas.width, h: canvas.height, frame };
  drawNode(rt, prog.root, [view.scale, 0, 0, view.scale, view.tx, view.ty], 1, -1);
}

function drawNode(rt: Rt, n: DrawNode, cur: Mat, alpha: number, evIn: number): void {
  const st = rt.st;
  let op = n.opacity;
  let hidden = n.hidden;
  // the prototype's DOM writer (app.js apply), in its order
  if (n.fx !== undefined) {
    const v = st.o[n.fx];
    if (v !== undefined) {
      hidden = v <= 0.003;
      if (!hidden && v < 0.999) op = Number(v.toFixed(3));
    }
  }
  if (n.celPart !== undefined) hidden = rt.sel[n.celPart] !== n.celName;
  if (n.led !== undefined) {
    const col = st.led[n.led[0]];
    if (col !== undefined && col[n.led[1]] !== undefined) hidden = !col[n.led[1]];
  }
  if (n.isRays) hidden = st.rayOp <= 0.003;
  if (n.rayBase !== undefined) op = Number((n.rayBase * st.rayOp).toFixed(3));
  if (hidden || op <= 0) return;
  let ev = evIn;
  if (n.evInit !== undefined) {
    const cls = n.rig !== undefined ? st.cls[n.rig] : undefined;
    ev = cls !== undefined ? +cls[2] : n.evInit;
  }
  if (n.eIdx !== undefined && ev >= 0 && ev !== n.eIdx) return;

  let m = cur;
  let tr = n.tr;
  if (n.rig !== undefined) {
    const s = st.x[n.rig];
    if (s !== undefined) tr = s;
  }
  if (n.isCam) tr = cameraMatrix(st.camera);
  if (tr !== null) m = mulMat(cur, tr);

  const ctx = rt.ctx;
  const a = alpha * op;
  if (a <= 0.003) return;
  if (!(n.screen || (op < 0.999 && n.overlap))) {
    if (n.clip) {
      ctx.save();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.clip(n.clip);
      drawBody(rt, n, m, a, ev);
      ctx.restore();
      dirtyPen(rt.pen);
    } else drawBody(rt, n, m, a, ev);
    return;
  }

  // a faded group whose parts overlap: draw it opaque into a layer, then composite at its opacity
  let x0 = 0;
  let y0 = 0;
  let x1 = rt.w;
  let y1 = rt.h;
  if (n.box !== null && !n.dyn) {
    const b = transformBox(n.box, m);
    x0 = Math.max(0, Math.floor(b[0]) - 1);
    y0 = Math.max(0, Math.floor(b[1]) - 1);
    x1 = Math.min(rt.w, Math.ceil(b[2]) + 1);
    y1 = Math.min(rt.h, Math.ceil(b[3]) + 1);
    if (x1 <= x0 || y1 <= y0) return;
  }
  const prog = rt.prog;
  let layer = prog.layers[rt.depth];
  if (!layer) {
    const canvas = document.createElement("canvas");
    const lctx = canvas.getContext("2d");
    if (!lctx) {
      drawBody(rt, n, m, a, ev);
      return;
    }
    layer = { canvas, ctx: lctx, pen: newPen(lctx, 0) };
    prog.layers[rt.depth] = layer;
  }
  if (layer.canvas.width !== rt.w || layer.canvas.height !== rt.h) {
    layer.canvas.width = rt.w;
    layer.canvas.height = rt.h;
    layer.pen = newPen(layer.ctx, rt.frame);
  } else if (layer.pen.frame !== rt.frame) layer.pen = newPen(layer.ctx, rt.frame);
  const lctx = layer.ctx;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.pen.tm = null;
  lctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  prog.stats.layers++;
  const inner: Rt = { ...rt, ctx: lctx, pen: layer.pen, depth: rt.depth + 1 };
  drawBody(inner, n, m, 1, ev);

  ctx.save();
  if (n.clip) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.clip(n.clip);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = n.screen ? "screen" : "source-over";
  ctx.drawImage(layer.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
  dirtyPen(rt.pen);
}

function drawBody(rt: Rt, n: DrawNode, m: Mat, alpha: number, ev: number): void {
  if (n.path !== null) {
    rt.prog.stats.leaves++;
    paintLeaf(rt, n, m, alpha);
    return;
  }
  const ch = n.children;
  for (let i = 0; i < ch.length; i++) drawNode(rt, ch[i], m, alpha, ev);
  if (n.slotItem !== undefined && rt.st.slot[n.slotItem] === n.slotSide) {
    const it = rt.prog.slotItems[n.slotItem];
    if (it) drawNode(rt, it, m, alpha, ev);
  }
}

function setTm(ctx: CanvasRenderingContext2D, pen: Pen, m: Mat): void {
  if (pen.tm !== m) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    pen.tm = m;
  }
}

function gradientFor(g: Gradient, ctx: CanvasRenderingContext2D): CanvasGradient {
  let cg = g.cache.get(ctx);
  if (!cg) {
    cg = ctx.createRadialGradient(g.fx, g.fy, 0, g.cx, g.cy, g.r);
    for (const [off, col] of g.stops) cg.addColorStop(off, col);
    g.cache.set(ctx, cg);
  }
  return cg;
}

function fillLeaf(rt: Rt, n: DrawNode, m: Mat): void {
  const ctx = rt.ctx;
  const pen = rt.pen;
  const f = n.fill;
  if (f === null || n.path === null) return;
  if (typeof f === "string") {
    setTm(ctx, pen, m);
    if (pen.fs !== f) {
      ctx.fillStyle = f;
      pen.fs = f;
    }
    ctx.fill(n.path);
  } else if (n.unitPath !== null && n.unitMat !== null) {
    // objectBoundingBox gradient: paint in the shape's unit square
    const um = mulMat(m, n.unitMat);
    ctx.setTransform(um[0], um[1], um[2], um[3], um[4], um[5]);
    pen.tm = um;
    ctx.fillStyle = gradientFor(f, ctx);
    pen.fs = null;
    ctx.fill(n.unitPath);
  }
}

function strokeLeaf(rt: Rt, n: DrawNode, m: Mat): void {
  const ctx = rt.ctx;
  const pen = rt.pen;
  if (n.stroke === null || n.path === null) return;
  setTm(ctx, pen, m);
  if (pen.ss !== n.stroke) {
    ctx.strokeStyle = n.stroke;
    pen.ss = n.stroke;
  }
  if (pen.lw !== n.sw) {
    ctx.lineWidth = n.sw;
    pen.lw = n.sw;
  }
  if (pen.join !== n.join) {
    ctx.lineJoin = n.join;
    pen.join = n.join;
  }
  if (pen.cap !== n.cap) {
    ctx.lineCap = n.cap;
    pen.cap = n.cap;
  }
  if (n.dash !== null) {
    ctx.setLineDash(n.dash);
    pen.dashed = true;
  } else if (pen.dashed) {
    ctx.setLineDash([]);
    pen.dashed = false;
  }
  ctx.stroke(n.path);
}

function paintLeaf(rt: Rt, n: DrawNode, m: Mat, alpha: number): void {
  const pen = rt.pen;
  if (pen.alpha !== alpha) {
    rt.ctx.globalAlpha = alpha;
    pen.alpha = alpha;
  }
  if (n.strokeFirst) {
    strokeLeaf(rt, n, m);
    fillLeaf(rt, n, m);
  } else {
    fillLeaf(rt, n, m);
    strokeLeaf(rt, n, m);
  }
}
