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
/* The panel sits in the scrolling page (#deskLower, #627): its columns lay out
 * in the page's flow, in the order the page reads. */
body.desk .vc-root {
  position: relative; top: auto; right: auto; z-index: auto;
  max-height: none; width: 100%;
  justify-content: space-between; align-items: flex-start;
  pointer-events: auto;
}
body.desk .vc-cols-wrap { display: contents; }
body.desk .vc-spectrum-col { position: static; order: 1; max-height: none; }
body.desk .vc-spectrum-col > .vc-meters { max-height: none; overflow: visible; }
body.desk .vc-shape-col {
  position: static !important; order: 2;
  left: auto !important; top: auto !important; width: 300px !important;
  max-height: none !important; overflow: visible;
}
body.desk .vc-power-col { order: 3; max-height: none; }
body.desk .vc-controls-col { order: 4; max-height: none; overflow: visible; }
/* Cables start at the panel's jacks, which now sit below the monitors; none may cross them. */
body.desk .vc-cable-layer { clip-path: inset(var(--desk-top) 0 0 0); }
:root.vc-desk, :root.vc-desk.vc-glass-blur {
  --vc-glass-bg: #0b0f0d;
  --vc-glass-filter: none;
}
:root.vc-desk .vc-glass-pane {
  -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
}
.desk-live {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
}
.desk-row {
  display: grid; grid-template-columns: 1fr auto auto; column-gap: 4px;
  padding: 4px 6px; border-radius: 3px;
  background: rgba(245, 158, 11, 0.09); border: 1px solid rgba(245, 158, 11, 0.28);
}
.desk-row-name { grid-column: 1; font-size: 12.5px; }
.desk-row-vals {
  grid-column: 1; grid-row: 2;
  font: 11px ${FONT_MONO}; color: #a7b0aa;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.desk-row-vals s { color: #8a958e; }
.desk-row-vals b { color: #e9eee9; font-weight: 400; }
.desk-row-one, .desk-row-x {
  grid-row: 1 / span 2; width: 24px; height: 24px; align-self: center;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0e1311; font-size: 13px; line-height: 1; cursor: pointer;
}
.desk-row-one { color: #22c55e; }
.desk-row-x { color: #a7b0aa; }
.desk-count.some {
  color: #160c00; background: #f59e0b; padding: 0 6px; border-radius: 8px;
}
#deskLower, #deskView {
  position: fixed; left: 0; right: 0; top: var(--desk-top); bottom: 0;
  overflow-y: auto; padding: 0 16px 72px;
  display: flex; flex-direction: column; gap: 14px;
}
#deskView { display: none; }
#desk.view-pads #deskView, #desk.view-orch #deskView { display: flex; }
#desk.view-pads #deskLower, #desk.view-orch #deskLower { display: none; }
#desk:not(.view-pads) .desk-pads-view { display: none; }
#desk:not(.view-orch) .desk-orch-view { display: none; }
#deskLower.desk-nodes .desk-jump,
#deskLower.desk-nodes .desk-mixer,
#deskLower.desk-nodes .desk-sec-pads,
#deskLower.desk-nodes .desk-sec-orch { display: none; }
.desk-view-btn {
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: transparent; padding: 3px 9px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.08em; color: #a7b0aa; cursor: pointer;
}
.desk-view-btn.on { color: #070908; background: #e9eee9; border-color: #e9eee9; }
/* Above the panel's cards, which otherwise paint over the bar when they scroll under it. */
.desk-jump {
  position: sticky; top: 0; z-index: 40;
  display: flex; gap: 6px; padding: 4px 0;
  background: #070908;
}
.desk-jump-btn {
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0b0f0d; padding: 3px 9px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.08em; color: #a7b0aa; cursor: pointer;
}
/* Jump targets clear the sticky jump bar above them. */
.desk-page-section { display: flex; flex-direction: column; gap: 8px; scroll-margin-top: 44px; }
.desk-mixer {
  display: grid; grid-template-columns: minmax(0, 1fr) 300px;
  gap: 14px; align-items: start;
}
.desk-mixer-row { display: flex; gap: 14px; align-items: flex-start; min-width: 0; }
.desk-strips { display: flex; gap: 8px; flex: 1 1 auto; min-width: 0; overflow-x: auto; }
.desk-strip {
  width: 96px; flex: none; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 5px; padding: 6px;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 4px; background: #0b0f0d;
}
.desk-strip.differs { border-color: #f59e0b; }
.desk-strip.is-live { border-color: #ef4444; }
.desk-strip.hl { outline: 2px solid #f59e0b; outline-offset: 1px; }
.desk-strip-head { display: flex; gap: 5px; align-items: baseline; min-width: 0; }
.desk-strip-num { font: 11px ${FONT_MONO}; color: #8a958e; }
.desk-strip-name {
  font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.desk-strip-tag {
  min-height: 12px; font: 10px ${FONT_MONO}; letter-spacing: 0.1em; color: #f59e0b;
}
.desk-strip.is-live .desk-strip-tag { color: #ef4444; }
.desk-strip-input {
  display: flex; align-items: center; gap: 4px; min-width: 0;
  font: 10.5px ${FONT_MONO}; color: #a7b0aa; white-space: nowrap; overflow: hidden;
}
.desk-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: #8a92a3; }
.desk-strip-body { display: flex; gap: 12px; justify-content: center; align-items: stretch; height: 170px; }
.desk-track {
  position: relative; flex: none; width: 6px; height: 170px;
  border-radius: 3px; background: rgba(232, 238, 234, 0.14); cursor: ns-resize; touch-action: none;
}
.desk-track:focus-visible { outline: 1px solid #e9eee9; outline-offset: 4px; }
.desk-thumb {
  position: absolute; left: -14px; width: 34px; height: 16px; box-sizing: border-box;
  border-radius: 3px; background: #d9e0db; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  transform: translateY(50%); pointer-events: none;
}
.desk-live-mark {
  position: absolute; left: -10px; width: 26px; height: 3px;
  background: #ef4444; transform: translateY(50%); pointer-events: none;
}
.desk-meter {
  position: relative; flex: none; width: 8px; height: 170px; overflow: hidden;
  border-radius: 2px; background: rgba(232, 238, 234, 0.08);
}
.desk-meter-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: #c3a5f9; }
.desk-chips { display: flex; flex-direction: column; justify-content: center; gap: 4px; flex: 1 1 auto; min-width: 0; }
.desk-opt {
  height: 24px; border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: transparent; font: 11px ${FONT_MONO}; color: #a7b0aa; cursor: pointer;
}
.desk-opt.on { color: #070908; background: #e9eee9; border-color: #e9eee9; }
.desk-opt.live { box-shadow: inset 0 -3px 0 #ef4444; }
.desk-strip-val { font: 11px ${FONT_MONO}; color: #e9eee9; text-align: center; min-height: 14px; }
.desk-strip-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
.desk-strip-btn {
  height: 24px; border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0e1311; font: 11.5px ${FONT_MONO}; color: #a7b0aa; cursor: pointer;
}
.desk-strip-btn.on { color: #070908; background: #e9eee9; border-color: #e9eee9; }
.desk-strip-btn:disabled { opacity: 0.35; cursor: default; }
.desk-master { display: flex; gap: 10px; flex: none; }
.desk-dial { width: 70px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.desk-dial-name { font: 11px ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: #a7b0aa; }
.desk-fx { min-width: 0; }
body.desk #fxBar {
  position: static; transform: none; display: grid !important;
  grid-template-columns: 1fr 1fr; gap: 8px; max-width: none;
  opacity: 1; pointer-events: auto;
}
body.desk .fxKey { height: 64px; -webkit-backdrop-filter: none; backdrop-filter: none; background: #0f1412; }
body.desk .fxKey.on { background: #fff; }
body.desk.chrome-idle #fxBar { opacity: 1; pointer-events: auto; }
.desk-pads-row { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
.desk-pads-tiles { display: grid; gap: 8px; flex: 1 1 auto; min-width: 0; align-items: start; }
.desk-pads-tiles-row { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.desk-pads-tiles-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.desk-pads-tools { display: flex; flex-direction: column; gap: 6px; flex: none; width: 150px; }
.desk-pads-btn {
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0e1311; padding: 4px 9px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.06em; color: #a7b0aa; cursor: pointer;
}
.desk-pads-btn:disabled { opacity: 0.35; cursor: default; }
.desk-pads-note { min-height: 12px; font: 10.5px ${FONT_MONO}; color: #f59e0b; }
.desk-pad {
  position: relative; display: flex; flex-direction: column; min-width: 0;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 6px; background: #0b0f0d;
}
.desk-pad.queued { border-color: #22c55e; background: rgba(34, 197, 94, 0.06); }
.desk-pads-tiles.beat-on .desk-pad.queued { background: rgba(34, 197, 94, 0.28); }
.desk-pad.auto-next { border: 2px dashed #59bbfb; }
.desk-pad.live { border-color: #ef4444; box-shadow: 0 0 0 1px #ef4444; }
.desk-pad.editing { box-shadow: inset 0 0 0 1px #c3a5f9; }
.desk-pad.live.editing { box-shadow: 0 0 0 1px #ef4444, inset 0 0 0 1px #c3a5f9; }
.desk-pad-main {
  display: flex; flex-direction: column; gap: 4px; min-width: 0;
  padding: 5px; border: 0; background: transparent; color: inherit; text-align: left;
  font: inherit; cursor: pointer;
}
.desk-pad-pic { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 4px; overflow: hidden; }
.desk-pad-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.desk-pad-pic canvas[hidden] { display: none; }
.desk-pad-key, .desk-pad-status {
  position: absolute; top: 4px; padding: 1px 5px; border-radius: 2px;
  font: 10px ${FONT_MONO}; letter-spacing: 0.06em; color: #e9eee9; background: rgba(0, 0, 0, 0.62);
}
.desk-pad-key { left: 4px; }
.desk-pad-status { right: 4px; }
.desk-pad-status:empty { display: none; }
/* The pill takes the colour of the word it shows (queued over AUTO over LIVE), so the rules run in that order. */
.desk-pad.live .desk-pad-status { background: #ef4444; color: #fff; }
.desk-pad.auto-next .desk-pad-status { background: #59bbfb; color: #041018; }
.desk-pad.queued .desk-pad-status { background: #22c55e; color: #04140a; }
.desk-pad-name { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desk-pad-scene {
  font: 10.5px ${FONT_MONO}; color: #a7b0aa;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.desk-pad-edit {
  align-self: flex-end; margin: 0 5px 5px;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px; background: #0e1311;
  padding: 0 7px; font-size: 12px; line-height: 20px; color: #c3a5f9; cursor: pointer;
}
.desk-pads-view { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.desk-pads-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
.desk-pads-label {
  font: 11px ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase; color: #a7b0aa;
}
.desk-pads-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
.desk-pads-side {
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 4px; background: #0b0f0d;
}
.desk-pads-upnext { font-size: 13px; color: #e9eee9; }
.desk-orch-view { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.desk-orch-tabs { display: flex; gap: 6px; }
.desk-orch-tab {
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: transparent; padding: 3px 9px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.08em; color: #a7b0aa; cursor: pointer;
}
.desk-orch-tab.on { color: #070908; background: #e9eee9; border-color: #e9eee9; }
.desk-orch-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.desk-orch-pane[hidden] { display: none; }
.desk-orch-shelf { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
.desk-orch-chip {
  flex: none; width: 112px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 4px; padding: 4px;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 4px; background: #0b0f0d;
  cursor: grab; touch-action: none; user-select: none;
}
.desk-orch-chip-pic { display: block; width: 100%; aspect-ratio: 16 / 9; border-radius: 3px; background: #0e1311; }
.desk-orch-chip-name {
  font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.desk-orch-ghost {
  position: fixed; z-index: 60; pointer-events: none;
  padding: 3px 8px; border-radius: 3px;
  background: #22c55e; color: #04140a; font: 11px ${FONT_MONO};
}
.desk-orch-ghost[hidden] { display: none; }
.desk-orch-lanes { position: relative; width: 100%; background: #0b0f0d; border-radius: 3px; overflow: hidden; }
.desk-orch-lane-label {
  position: absolute; left: 0; box-sizing: border-box;
  display: flex; align-items: flex-start; padding: 4px 0 0 8px;
  font: 10px ${FONT_MONO}; letter-spacing: 0.1em; color: #a7b0aa;
  border-bottom: 1px solid rgba(232, 238, 234, 0.08);
}
.desk-orch-canvas { position: absolute; top: 0; display: block; }
.desk-orch-pickbtns { position: absolute; display: flex; gap: 3px; }
.desk-orch-pickbtns[hidden] { display: none; }
.desk-orch-pick-btn {
  width: 16px; height: 16px; box-sizing: border-box; padding: 0;
  border: 1px solid #59bbfb; border-radius: 3px; background: #041018;
  font: 11px ${FONT_MONO}; line-height: 14px; color: #59bbfb; cursor: pointer;
}
.desk-orch-next { font-size: 13px; color: #e9eee9; }
.desk-orch-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font: 10.5px ${FONT_MONO}; color: #a7b0aa; }
.desk-orch-key { display: inline-flex; align-items: center; gap: 5px; }
.desk-orch-sw { display: inline-block; width: 12px; height: 8px; border-radius: 2px; box-sizing: border-box; }
.desk-orch-sw.live { border: 2px solid #ef4444; }
.desk-orch-sw.queued { background: rgba(34, 197, 94, 0.32); border: 1px solid #22c55e; }
.desk-orch-sw.pick { border: 1px dashed #59bbfb; }
.desk-orch-sw.phrase { width: 2px; height: 12px; background: rgba(232, 238, 234, 0.35); }
.desk-orch-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.desk-orch-pill {
  border: 1px solid #59bbfb; border-radius: 999px; background: transparent;
  padding: 3px 11px; font: 11px ${FONT_MONO}; letter-spacing: 0.08em; color: #59bbfb; cursor: pointer;
}
.desk-orch-pill.on { background: #59bbfb; color: #041018; }
.desk-orch-open {
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px;
  background: #0e1311; padding: 3px 9px;
  font: 11px ${FONT_MONO}; letter-spacing: 0.08em; color: #a7b0aa; cursor: pointer;
}
.desk-orch-mini { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 14px; align-items: start; }
.desk-orch-mini-left { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.desk-orch-mini-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.desk-orch-map { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.desk-orch-map.full { width: 400px; flex: none; }
.desk-orch-mappane { flex-direction: row; gap: 16px; align-items: flex-start; }
.desk-orch-mapside { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.desk-orch-map.mini { width: 220px; }
.desk-orch-field {
  position: relative; width: 100%; aspect-ratio: 1 / 1; box-sizing: border-box; overflow: hidden;
  border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 4px; background-color: #0b0f0d;
  background-image:
    linear-gradient(rgba(232, 238, 234, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(232, 238, 234, 0.08) 1px, transparent 1px);
  background-size: calc(100% / 12) calc(100% / 12);
  touch-action: none; cursor: crosshair; user-select: none;
}
.desk-orch-axis {
  position: absolute; pointer-events: none;
  font: 10px ${FONT_MONO}; letter-spacing: 0.12em; color: #8a958e;
}
.desk-orch-axis-tl { left: 6px; top: 6px; }
.desk-orch-axis-bl { left: 6px; bottom: 6px; }
.desk-orch-caption { display: flex; justify-content: space-between; font: 10px ${FONT_MONO}; letter-spacing: 0.12em; color: #8a958e; }
.desk-orch-dot {
  position: absolute; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none;
}
.desk-orch-dot-pic { display: block; border-radius: 50%; border: 1px solid rgba(232, 238, 234, 0.25); box-sizing: border-box; }
.desk-orch-dot.near .desk-orch-dot-pic { border: 2px solid #e9eee9; }
.desk-orch-dot-name {
  font: 10px ${FONT_MONO}; color: #e9eee9; white-space: nowrap;
  background: rgba(0, 0, 0, 0.5); padding: 0 3px; border-radius: 2px;
}
.desk-orch-dot-share { font: 10px ${FONT_MONO}; color: #f59e0b; min-height: 12px; }
.desk-orch-puck {
  position: absolute; width: 22px; height: 22px; box-sizing: border-box;
  transform: translate(-50%, -50%); border: 2px solid #e9eee9; border-radius: 50%; pointer-events: none;
}
.desk-orch-puck::before, .desk-orch-puck::after { content: ""; position: absolute; background: #e9eee9; }
.desk-orch-puck::before { left: 50%; top: -7px; bottom: -7px; width: 1px; transform: translateX(-50%); }
.desk-orch-puck::after { top: 50%; left: -7px; right: -7px; height: 1px; transform: translateY(-50%); }
`;

/** Injects the desk's stylesheet once. */
export function ensureDeskStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}
