/**
 * Dev-only entry point for the tuning kit: wires the HMR param bus, exposes
 * window.__viz for Playwright drivers (tools/tune-*.mjs), and binds the
 * mark/clip hotkeys and the clip-buffer toggle UI. Only ever imported from
 * app.ts behind `if (import.meta.env.DEV)`, via a dynamic import — see that
 * guard for why this keeps the whole kit out of a production build.
 */
import {
  captureClip,
  captureSheet,
  isClipBufferRunning,
  startClipBuffer,
  stopClipBuffer,
  type CaptureOpts,
  type ClipCaptureOpts,
} from "./capture.ts";
import { buildProbeSnapshot, formatProbe, type ProbeInput, type ProbeSnapshot } from "./probe.ts";
import { applyTuningParams, initTuningBus, type TuningParams } from "./bus.ts";
import { DEFAULT_SLOT, tuningSlot } from "./session.ts";
import { mountTuningUI } from "./ui.ts";

export interface TuningDeps {
  getInput: () => ProbeInput;
}

interface VizDebugApi {
  probe(): ProbeSnapshot;
  probeText(): string;
  capture(opts?: CaptureOpts): Promise<string>;
  mark(): Promise<{ ok: boolean; ts: number }>;
  clip(opts?: ClipCaptureOpts): Promise<{ ok: boolean; ts: number }>;
  setParams(params: TuningParams): void;
  setClipBuffer(on: boolean): void;
}

type CaptureMeta = ProbeSnapshot & { kind: "mark" | "clip" };

async function saveCapture(
  kind: "mark" | "clip",
  png: string,
  meta: ProbeSnapshot,
): Promise<{ ok: boolean; ts: number }> {
  const body: { png: string; meta: CaptureMeta; slot: string } = {
    png,
    meta: { ...meta, kind },
    // Tags the file on disk, so two sessions' captures stay tellable apart.
    slot: tuningSlot() ?? DEFAULT_SLOT,
  };
  const res = await fetch("/__tuning/mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`tuning/debug: ${kind} save failed (${res.status})`);
  return res.json() as Promise<{ ok: boolean; ts: number }>;
}

export function initTuning(deps: TuningDeps): void {
  initTuningBus();

  const ui = mountTuningUI((on) => {
    if (on) startClipBuffer();
    else stopClipBuffer();
  }, tuningSlot());

  const mark = () => captureSheet({ frames: 1 }).then((png) => saveCapture("mark", png, buildProbeSnapshot(deps.getInput())));
  const clip = (opts?: ClipCaptureOpts) =>
    captureClip(opts).then((png) => saveCapture("clip", png, buildProbeSnapshot(deps.getInput())));

  const api: VizDebugApi = {
    probe: () => buildProbeSnapshot(deps.getInput()),
    probeText: () => formatProbe(buildProbeSnapshot(deps.getInput())),
    capture: (opts) => captureSheet(opts),
    mark,
    clip,
    setParams: (params) => applyTuningParams(params),
    setClipBuffer: (on) => (on ? startClipBuffer() : stopClipBuffer()),
  };
  (window as unknown as { __viz: VizDebugApi }).__viz = api;

  window.addEventListener("keydown", (e) => {
    // Ignored while a text field / slider has focus (device menu etc) so the
    // hotkeys don't fire while you're typing a label or dragging a range.
    const target = e.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    if (typing) return;

    // e.code (the physical key) rather than e.key: on macOS, Option remaps
    // the character a key produces (Option+M -> "µ"), so e.key never equals
    // "m"/"c" while Alt/Option is held. e.code is unaffected by that remap
    // and by layout, so it's the reliable way to detect "this key, plus
    // Alt/Option" across platforms.
    if (e.altKey && e.code === "KeyM") {
      e.preventDefault();
      mark()
        .then(() => ui.flash("mark saved"))
        .catch((err) => {
          console.error("[tuning] mark failed", err);
          ui.flash("mark failed", false);
        });
    } else if (e.altKey && e.code === "KeyC") {
      e.preventDefault();
      if (!isClipBufferRunning()) ui.flash("clip (buffer off — after-only)", true);
      clip()
        .then(() => ui.flash("clip saved"))
        .catch((err) => {
          console.error("[tuning] clip failed", err);
          ui.flash("clip failed", false);
        });
    }
  });

  console.info(
    "[tuning] live — window.__viz ready, Option/Alt+M to mark a frame, Option/Alt+C to clip (see the switch, top-left, for before/after)",
  );
}
