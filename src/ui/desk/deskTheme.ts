/**
 * The desk's stylesheet (desk.ts). The desk is the main window's layout while
 * a pop-out output is open: the NEXT monitor is the scene canvas itself, fixed
 * at the top left, with the Cue/Play column and the LIVE slot beside it, and
 * the controls panel below that top row, opaque. Every rule is scoped to
 * `body.desk` or `:root.vc-desk`, so with no output open nothing here applies
 * and the layout is the one controlsTheme.ts and index.html give.
 *
 * The NEXT slot is empty on purpose: #gl is drawn over it, so its tag and
 * picture row stay in #desk while the canvas keeps every pointer event the
 * scene might use.
 */
import { FONT_LABEL, FONT_MONO } from "../controlsTheme.ts";

const STYLE_ID = "desk-styles";

const stylesheet = `
:root {
  --desk-mon-w: clamp(320px, 33.75vw, 560px);
  --desk-mon-h: calc(var(--desk-mon-w) * 9 / 16);
  --desk-top: calc(54px + var(--desk-mon-h) + 34px);
}
body.desk #gl {
  position: fixed; left: 16px; top: 54px;
  width: var(--desk-mon-w); height: var(--desk-mon-h);
  transform: none;
  outline: 1px solid rgba(232, 238, 234, 0.14);
}
#desk { display: none; }
body.desk #desk {
  display: block; position: fixed; inset: 0; z-index: 4;
  pointer-events: none;
  color: #e9eee9; font-family: ${FONT_LABEL};
}
body.desk #desk > * { pointer-events: auto; }
/* The two rules below win over the line above: the top row and tags must not
 * catch clicks meant for the canvas under the NEXT slot. */
body.desk #desk > .desk-top, body.desk #desk > .desk-tag { pointer-events: none; }
.desk-tag {
  position: absolute; left: 8px; top: 8px; z-index: 5;
  padding: 2px 7px; border-radius: 2px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.14em;
  background: rgba(0, 0, 0, 0.62);
  pointer-events: none;
}
.desk-tag-next { position: fixed; left: 24px; top: 62px; }
.desk-slot.live .desk-tag { background: #ef4444; color: #fff; }
.desk-top {
  position: fixed; left: 16px; right: 16px; top: 54px;
  height: calc(var(--desk-mon-h) + 24px);
  display: grid;
  grid-template-columns: var(--desk-mon-w) minmax(0, 1fr) var(--desk-mon-w);
  gap: 12px;
  pointer-events: none;
}
.desk-top > * { pointer-events: auto; }
.desk-mon.next, .desk-mon.next * { pointer-events: none; }
.desk-mon {
  display: grid; grid-template-rows: var(--desk-mon-h) auto; gap: 5px;
  min-height: 0;
}
.desk-slot {
  position: relative;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: transparent;
}
.desk-slot.live {
  border-color: #ef4444; box-shadow: 0 0 0 1px #ef4444; background: #000;
}
.desk-pic {
  display: flex; gap: 14px;
  font: 10.5px ${FONT_MONO}; letter-spacing: 0.06em;
  color: #a7b0aa; min-height: 14px;
}
.desk-mid {
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 7px;
  min-height: 0;
  padding: 8px 10px 10px;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0b0f0d;
}
.desk-mid-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font: 11px ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: #a7b0aa;
}
.desk-list {
  list-style: none; margin: 0; padding: 0;
  overflow: auto; min-height: 0;
  display: grid; align-content: start; gap: 4px;
}
.desk-empty {
  border: 1px dashed rgba(232, 238, 234, 0.14); border-radius: 3px;
  padding: 4px 6px;
  color: #a7b0aa; font-size: 12px; line-height: 1.4;
}
.desk-keys { display: flex; justify-content: center; }
.desk-fade {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
  font: 11px ${FONT_MONO}; color: #a7b0aa;
}
.desk-chip {
  border: 1px solid rgba(232, 238, 234, 0.14); background: transparent;
  border-radius: 999px; padding: 2px 8px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.06em;
  color: #a7b0aa; cursor: pointer;
}
.desk-chip.on {
  color: #070908; background: #e9eee9; border-color: #e9eee9;
}
.desk-bar {
  position: fixed; top: 0; right: 16px; height: 44px;
  display: flex; align-items: center; gap: 10px;
  font: 12px ${FONT_MONO}; color: #a7b0aa;
}
body.desk #outBar {
  position: static; transform: none; pointer-events: auto; opacity: 1;
  gap: 4px;
}
body.desk.chrome-idle #outBar { opacity: 1; pointer-events: auto; }
body.desk .vc-root {
  top: var(--desk-top);
  max-height: calc(var(--vc-vh) - var(--desk-top) - 16px);
}
body.desk .vc-power-col, body.desk .vc-controls-col {
  max-height: calc(var(--vc-vh) - var(--desk-top) - 16px);
}
body.desk .vc-spectrum-col {
  top: var(--desk-top);
  max-height: calc(var(--vc-vh) - var(--desk-top) - 16px);
}
body.desk .vc-shape-col {
  top: var(--desk-top) !important;
  max-height: calc(var(--vc-vh) - var(--desk-top) - 16px) !important;
}
:root.vc-desk, :root.vc-desk.vc-glass-blur {
  --vc-glass-bg: #0b0f0d;
  --vc-glass-filter: none;
}
:root.vc-desk .vc-glass-pane {
  -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
}
`;

/** Injects the desk's stylesheet once. */
export function ensureDeskStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}
