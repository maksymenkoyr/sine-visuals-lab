/**
 * The compact SVG "who follows whom" overview for an itemBoxes widget's
 * `options.relations` block (see itemBoxes.ts's header) — nodes in each
 * item's own colour, a curved arrow per ordered pair (green follows / red
 * avoids, width by |value|, dashed near zero), a small self-loop per item
 * for its own "diagonal" pair, and the selected item's own arrows/loop lit
 * while every other pair dims. Clicking a node selects that item (the
 * caller re-renders — see registry.ts's WidgetCtx.rerender). Rebuilt whole
 * on every call rather than patched in place — cheap at the row counts an
 * item widget has, and it keeps this module free of any retained state.
 */

const NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) el.setAttribute(k, attrs[k]!);
  return el;
}

const NODE_R = 24;
const VIEW = 220;

function nodePositions(count: number): { x: number; y: number }[] {
  const cx = VIEW / 2;
  const cy = VIEW / 2;
  const r = VIEW / 2 - NODE_R - 8;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

/** Green follows / red avoids / dim ignores — same thresholds as
 *  relationRows.ts's own word anchors treat as "near enough to Ignores". */
function relColour(v: number): string {
  return v > 0.08 ? "#8ce6a0" : v < -0.08 ? "#ef6a6a" : "rgba(255,255,255,0.35)";
}
function relWord(v: number): string {
  return v > 0.08 ? "follows" : v < -0.08 ? "avoids" : "ignores";
}
function fmtSigned(v: number): string {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
}

export interface RelationWebSpec {
  count: number;
  /** CSS colour per item, same order as `labels`. */
  colours: readonly string[];
  labels: readonly string[];
  selected: number;
  /** Reads the stored `i -> j` value (the affinity/attraction setting). */
  get(i: number, j: number): number;
  onSelect(i: number): void;
}

export function buildRelationWeb(spec: RelationWebSpec): SVGSVGElement {
  const { count, colours, labels, selected, get, onSelect } = spec;
  const svg = svgEl("svg", { viewBox: `0 0 ${VIEW} ${VIEW}`, role: "img", "aria-label": "Affinity overview" });
  svg.classList.add("vc-relweb");
  const pos = nodePositions(count);
  const cx = VIEW / 2;
  const cy = VIEW / 2;

  for (let i = 0; i < count; i++) {
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const v = get(i, j);
      const p0 = pos[i]!;
      const p1 = pos[j]!;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const bend = (i < j ? 1 : -1) * 14;
      const sx = p0.x + ux * NODE_R;
      const sy = p0.y + uy * NODE_R;
      const ex = p1.x - ux * NODE_R;
      const ey = p1.y - uy * NODE_R;
      const mx = (sx + ex) / 2 + px * bend;
      const my = (sy + ey) / 2 + py * bend;
      const col = relColour(v);
      const cls = `vc-relweb-arrow ${i === selected ? "vc-relweb-sel" : "vc-relweb-dim"}`;
      const path = svgEl("path", {
        d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`,
        class: cls,
        fill: "none",
        stroke: col,
        "stroke-width": (1 + Math.abs(v) * 3).toFixed(2),
      });
      if (Math.abs(v) <= 0.08) path.setAttribute("stroke-dasharray", "3,4");
      const title = svgEl("title", {});
      title.textContent = `${labels[i]} ${relWord(v)} ${labels[j]} (${fmtSigned(v)})`;
      path.appendChild(title);
      svg.appendChild(path);

      const tx = ex - mx;
      const ty = ey - my;
      const tl = Math.hypot(tx, ty) || 1;
      const hx = tx / tl;
      const hy = ty / tl;
      const h1x = ex - hx * 7 + hy * 4;
      const h1y = ey - hy * 7 - hx * 4;
      const h2x = ex - hx * 7 - hy * 4;
      const h2y = ey - hy * 7 + hx * 4;
      svg.appendChild(
        svgEl("polygon", {
          points: `${ex.toFixed(1)},${ey.toFixed(1)} ${h1x.toFixed(1)},${h1y.toFixed(1)} ${h2x.toFixed(1)},${h2y.toFixed(1)}`,
          fill: col,
          class: cls,
        }),
      );
    }
  }

  for (let i = 0; i < count; i++) {
    const v = get(i, i);
    const p = pos[i]!;
    const ox = p.x - cx;
    const oy = p.y - cy;
    const ol = Math.hypot(ox, oy) || 1;
    const nx = ox / ol;
    const ny = oy / ol;
    const lcx = p.x + nx * (NODE_R + 9);
    const lcy = p.y + ny * (NODE_R + 9);
    const col = relColour(v);
    const loop = svgEl("circle", {
      cx: lcx.toFixed(1),
      cy: lcy.toFixed(1),
      r: "8",
      fill: "none",
      stroke: col,
      "stroke-width": (1 + Math.abs(v) * 2).toFixed(2),
      class: `vc-relweb-loop ${i === selected ? "vc-relweb-sel" : "vc-relweb-dim"}`,
    });
    const title = svgEl("title", {});
    title.textContent = `${labels[i]} → own trail: ${relWord(v)} (${fmtSigned(v)})`;
    loop.appendChild(title);
    svg.appendChild(loop);
  }

  for (let i = 0; i < count; i++) {
    const p = pos[i]!;
    const col = colours[i] ?? "#fff";
    const g = svgEl("g", {});
    const c = svgEl("circle", {
      cx: String(p.x),
      cy: String(p.y),
      r: String(NODE_R),
      fill: col,
      class: "vc-relweb-node",
      tabindex: "0",
      role: "button",
      "aria-label": `Select ${labels[i]}`,
    });
    c.style.filter = `drop-shadow(0 0 6px ${col})`;
    c.style.cursor = "pointer";
    c.addEventListener("click", () => onSelect(i));
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect(i);
        e.preventDefault();
      }
    });
    g.appendChild(c);
    if (i === selected) {
      g.appendChild(
        svgEl("circle", {
          cx: String(p.x),
          cy: String(p.y),
          r: String(NODE_R + 4),
          fill: "none",
          stroke: "#fff",
          opacity: "0.55",
          "stroke-width": "1.5",
        }),
      );
    }
    const label = svgEl("text", { x: String(p.x), y: String(p.y + 4), "text-anchor": "middle", class: "vc-relweb-label" });
    label.textContent = labels[i] ?? "";
    g.appendChild(label);
    svg.appendChild(g);
  }

  return svg;
}
