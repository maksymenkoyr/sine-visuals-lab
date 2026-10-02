/**
 * Dev-only entry point for the tuning kit: wires the HMR param bus, exposes
 * window.__viz for Playwright drivers (tools/tune-*.mjs), and binds the
 * mark/clip/bake hotkeys and the clip-buffer toggle UI. Only ever imported
 * from app.ts behind `if (import.meta.env.DEV)`, via a dynamic import — see
 * that guard for why this keeps the whole kit out of a production build.
 *
 * Alt+D bakes the active scene's current settings into its source file (see
 * bakeDefaults.ts) — a two-press flow, since a write here ships as the app's
 * default for every user, not just a local change. The first press is a dry
 * run: it captures the edit list and shows it in ui.ts's notice() without
 * writing anything. A second Alt+D within BAKE_CONFIRM_MS commits that exact
 * list; anything else (Esc, the window expiring, a scene change) drops it.
 * The commit triggers Vite's full reload (no scene module has an HMR accept
 * boundary) — kept deliberately, since that's what resyncs the running
 * bundle's spec.default with disk, which is what makes a later bake's `from`
 * guard trustworthy. The confirmation is relayed across that reload through
 * sessionStorage and re-shown as a notice(), since it needs to still be
 * readable once the reload lands, not a flash() gone in under a second.
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
import { clearAllPins } from "./pins.ts";
import { mountTuningUI } from "./ui.ts";
import { bakeDefaults, bakeEdits, type BakeResponse, type DefaultEdit } from "./bakeDefaults.ts";
import { PICTURE_MEASURES, type PictureMeasure, type PictureReading } from "../render/pictureMeter.ts";

export interface TuningDeps {
  getInput: () => ProbeInput;
  /** The Master card's Picture block's own live state — see
   *  src/render/pictureMeter.ts. Optional: absent whenever app.ts hasn't
   *  wired it (there's only ever one caller, but the shape stays optional so
   *  a `pictureForce`/`picture`/`pictureReset` call from a stale page fails
   *  with a clear error rather than a silent no-op). */
  picture?: {
    force: (on: boolean) => void;
    read: () => { latest: PictureReading | null; mean: PictureReading; samples: number };
    reset: () => void;
  };
  /** tools/master-sweep.mjs's own knobs — see api.setMaster/api.scenes below. */
  setMaster?: (v: number) => void;
  scenes?: () => { id: string; name: string; draft: boolean; paid: boolean }[];
}

/** Cheap, side-effect-free onset readout for a headless driver polling every
 *  rAF tick — see audioProbe's own comment on api below for why this is a
 *  separate method from probe(). */
export interface AudioProbeSnapshot {
  onset: boolean;
  time: number;
  fluxRatio: number | null;
}

/** The deep time-domain buffer behind AudioProbeSnapshot, split into its own
 *  call so the (relatively costly, 32768-element) copy across the
 *  page.evaluate boundary only happens when a caller actually detected an
 *  onset edge on this tick — see audioBuffer's own comment on api below. */
export interface AudioBufferSnapshot {
  mono: number[] | null;
  sampleRate: number | null;
}

interface VizDebugApi {
  probe(): ProbeSnapshot;
  probeText(): string;
  capture(opts?: CaptureOpts): Promise<string>;
  mark(): Promise<{ ok: boolean; ts: number }>;
  clip(opts?: ClipCaptureOpts): Promise<{ ok: boolean; ts: number }>;
  setParams(params: TuningParams): void;
  setClipBuffer(on: boolean): void;
  /** Drops every typed-in dev pin (tuning/pins.ts) on every scene — for a
   *  headless driver to neutralize a developer's leftover pins before a run. */
  clearPins(): void;
  /** Dry-runs a bake of the active scene's current settings (see
   *  bakeDefaults.ts) and returns the would-be result without writing —
   *  what Alt+D's first press does, exposed for a headless driver to check
   *  deterministically instead of scraping the notice panel. */
  bakeDefaults(): Promise<BakeResponse>;
  /** For tools/audio-latency.mjs: this tick's raw FeatureFrame.onset/.time
   *  and the extractor's fluxRatio, read directly off deps.getInput() rather
   *  than through probe()/buildProbeSnapshot — that path resolves every
   *  scene setting (resolveSceneSetting), which advances the auto-tune slew
   *  map (autoTune.ts) as a side effect on every call. Polling that every
   *  rAF tick would perturb the running scene; this doesn't. Also distinct
   *  from probe().beat.fired, which is the raw anim.onset (renderLatch-latched,
   *  no grid) rather than this pre-latch FeatureFrame flag. */
  audioProbe(): AudioProbeSnapshot;
  /** The deep waveform buffer behind the tick audioProbe() just reported —
   *  call only on a detected onset edge, not every tick (see
   *  AudioBufferSnapshot's own comment). */
  audioBuffer(): AudioBufferSnapshot;
  /** Samples the picture even with the panel closed (normally only an open
   *  panel pays for it) — what tools/master-sweep.mjs turns on before it
   *  starts averaging a (scene, master value) point. Throws if deps.picture
   *  isn't wired. */
  pictureForce(on: boolean): void;
  /** This tick's picture reading plus the running mean since the last
   *  pictureReset() — see src/render/pictureMeter.ts's PictureReading/
   *  PictureAverager. Throws if deps.picture isn't wired. */
  picture(): { latest: PictureReading | null; mean: PictureReading; samples: number };
  /** Zeroes the running mean pictureReset() reads back via picture().mean —
   *  tools/master-sweep.mjs calls this once a (scene, master value) point has
   *  settled, so the mean it reads afterward only covers its own measurement
   *  window. Throws if deps.picture isn't wired. */
  pictureReset(): void;
  /** The five measures' labels/fullScale/description, straight off
   *  PICTURE_MEASURES — what tools/master-sweep.mjs's sweep.json records so a
   *  reader doesn't have to already know pictureMeter.ts's own constants. */
  pictureMeasures(): { key: PictureMeasure["key"]; label: string; fullScale: number; description: string }[];
  /** Sets the device-wide scene master (sceneSettings.ts's getSceneMaster) —
   *  the scripted twin of dragging the Master card's Scale row. (The sweep
   *  itself pins the value in localStorage before load instead, so a point
   *  starts at its value from the first frame.) Throws if deps.setMaster
   *  isn't wired. */
  setMaster(v: number): void;
  /** Every registered scene's id/name/draft/paid — tools/master-sweep.mjs's
   *  scene list (`--scenes all|featured|id,id` resolves against this).
   *  Throws if deps.scenes isn't wired. */
  scenes(): { id: string; name: string; draft: boolean; paid: boolean }[];
}

type CaptureMeta = ProbeSnapshot & { kind: "mark" | "clip" };

async function saveCapture(
  kind: "mark" | "clip",
  png: string,
  meta: ProbeSnapshot,
): Promise<{ ok: boolean; ts: number }> {
  const body: { png: string; meta: CaptureMeta } = { png, meta: { ...meta, kind } };
  const res = await fetch("/__tuning/mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`tuning/debug: ${kind} save failed (${res.status})`);
  return res.json() as Promise<{ ok: boolean; ts: number }>;
}

// Sessions carry the post-write confirmation across the full reload a
// commit triggers — see the module header.
const BAKE_TOAST_KEY = "vibe.bakeToast";

// Input types that never accept text — a hotkey firing on a checkbox row is
// fine (this is deliberately broader than deviceMenu.ts's twin below), but
// anything that *can* take typed characters must still guard.
const NON_TEXT_INPUT_TYPES = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
]);

// Twin of isTypingTarget in src/ui/deviceMenu.ts (kept separate rather than
// shared — this one's prod-adjacent module boundary isn't worth crossing for
// one predicate). The previous version here bailed on *any* focused <input>,
// which killed every hotkey below the instant a slider had focus — exactly
// when you'd reach for Alt+D or Alt+M. Exempting range/checkbox (and every
// other non-text input type) while still guarding TEXTAREA, contenteditable,
// and text-accepting inputs is what deviceMenu.ts already does for its own
// A/R/T keys; this mirrors it.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA" || target.isContentEditable) return true;
  if (target.tagName === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

function skippedNote(res: BakeResponse): string {
  const parts: string[] = [];
  if (res.skipped && res.skipped.length > 0) parts.push(`${res.skipped.join(", ")}: pinned/overridden`);
  if (res.skippedGenerated && res.skippedGenerated.length > 0) {
    parts.push(`${res.skippedGenerated.join(", ")}: generated — edit the item table in the scene`);
  }
  return parts.length > 0 ? ` (skipped ${parts.join("; ")})` : "";
}

/** Lines for the confirmation notice — shown immediately on a successful
 *  commit, and replayed after the reload via sessionStorage. */
function describeBakeResult(res: BakeResponse): { lines: string[]; ok: boolean } {
  if (!res.ok) {
    const first = res.results?.find((r) => r.status !== "applied" && r.status !== "already");
    const detail = first
      ? `${first.key} (${first.status}${first.found !== undefined ? `: found ${first.found}` : ""})`
      : res.error ?? "failed";
    return { lines: [`bake failed: ${detail}`], ok: false };
  }
  const applied = res.results?.filter((r) => r.status === "applied") ?? [];
  if (applied.length === 0) return { lines: [`nothing to bake${skippedNote(res)}`], ok: true };
  const byKey = new Map((res.edits ?? []).map((e) => [e.key, e]));
  const detail = applied.map((r) => {
    const e = byKey.get(r.key);
    return e ? `${r.key} ${e.from}→${e.to}` : r.key;
  });
  return { lines: [`✓ baked ${applied.length} → ${res.file}`, "  " + detail.join(" · ") + skippedNote(res)], ok: true };
}

/** Lines for the pre-write preview — always the full edit list, since a dry
 *  run's `results` are all "applied" (or the whole request was refused). */
function describeBakePreview(res: BakeResponse): string[] {
  const edits = res.edits ?? [];
  const lines = [`bake → ${res.file}`, ...edits.map((e) => `  ${e.key}   ${e.from} → ${e.to}`)];
  lines.push("Alt+D again to write · Esc to cancel" + skippedNote(res));
  return lines;
}

// How long a bake preview (Alt+D's first press) stays live, waiting for the
// confirming second press, before it's dropped as if Esc had been pressed.
const BAKE_CONFIRM_MS = 8000;

export function initTuning(deps: TuningDeps): void {
  initTuningBus();

  const ui = mountTuningUI((on) => {
    if (on) startClipBuffer();
    else stopClipBuffer();
  });

  // Replay a bake confirmation stashed just before the write that triggered
  // this reload — see the module header. Read-and-clear so a later manual
  // reload doesn't resurface a stale message.
  try {
    const stashed = sessionStorage.getItem(BAKE_TOAST_KEY);
    if (stashed) {
      sessionStorage.removeItem(BAKE_TOAST_KEY);
      const { lines, ok } = JSON.parse(stashed) as { lines: string[]; ok: boolean };
      ui.notice(lines, ok);
    }
  } catch {
    // sessionStorage unavailable (Safari private mode, etc.) — the terminal
    // console.info from the plugin is still the durable record.
  }

  const mark = () => captureSheet({ frames: 1 }).then((png) => saveCapture("mark", png, buildProbeSnapshot(deps.getInput())));
  const clip = (opts?: ClipCaptureOpts) =>
    captureClip(opts).then((png) => saveCapture("clip", png, buildProbeSnapshot(deps.getInput())));
  const dryRunBake = () => {
    const { sceneId, settings } = deps.getInput();
    return bakeDefaults(sceneId, settings, { dryRun: true });
  };

  // The state a first Alt+D leaves behind for a confirming second one — see
  // the module header for the two-press flow this drives.
  let pending: { sceneId: string; edits: DefaultEdit[]; timer: ReturnType<typeof setTimeout> } | null = null;
  function clearPending(): void {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  const api: VizDebugApi = {
    probe: () => buildProbeSnapshot(deps.getInput()),
    probeText: () => formatProbe(buildProbeSnapshot(deps.getInput())),
    capture: (opts) => captureSheet(opts),
    mark,
    clip,
    setParams: (params) => applyTuningParams(params),
    setClipBuffer: (on) => (on ? startClipBuffer() : stopClipBuffer()),
    clearPins: () => clearAllPins(),
    bakeDefaults: dryRunBake,
    audioProbe: () => {
      const input = deps.getInput();
      return { onset: input.vis?.onset ?? false, time: input.vis?.time ?? 0, fluxRatio: input.fluxRatio ?? null };
    },
    audioBuffer: () => {
      const input = deps.getInput();
      return { mono: input.deepMono ? Array.from(input.deepMono) : null, sampleRate: input.sampleRate ?? null };
    },
    pictureForce: (on) => {
      if (!deps.picture) throw new Error("tuning/debug: picture not wired");
      deps.picture.force(on);
    },
    picture: () => {
      if (!deps.picture) throw new Error("tuning/debug: picture not wired");
      return deps.picture.read();
    },
    pictureReset: () => {
      if (!deps.picture) throw new Error("tuning/debug: picture not wired");
      deps.picture.reset();
    },
    pictureMeasures: () => PICTURE_MEASURES.map(({ key, label, fullScale, description }) => ({ key, label, fullScale, description })),
    setMaster: (v) => {
      if (!deps.setMaster) throw new Error("tuning/debug: setMaster not wired");
      deps.setMaster(v);
    },
    scenes: () => {
      if (!deps.scenes) throw new Error("tuning/debug: scenes not wired");
      return deps.scenes();
    },
  };
  (window as unknown as { __viz: VizDebugApi }).__viz = api;

  window.addEventListener("keydown", (e) => {
    // Ignored while a genuinely typing-capable field has focus — see
    // isTypingTarget's own comment for why this is narrower than "any
    // <input>" (a focused slider or checkbox should still take a hotkey).
    if (isTypingTarget(e.target)) return;

    // e.code (the physical key) rather than e.key: on macOS, Option remaps
    // the character a key produces (Option+M -> "µ"), so e.key never equals
    // "m"/"c"/"d" while Alt/Option is held. e.code is unaffected by that
    // remap and by layout, so it's the reliable way to detect "this key,
    // plus Alt/Option" across platforms.
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
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      const { sceneId } = deps.getInput();

      if (pending && pending.sceneId === sceneId) {
        // Second press within the window: commit exactly the edits the
        // preview showed, not a freshly rebuilt list — a slider nudged in
        // between must not smuggle a different number past what was shown.
        const { edits } = pending;
        clearPending();
        bakeEdits(sceneId, edits)
          .then((res) => {
            const { lines, ok } = describeBakeResult(res);
            const wroteFile = res.ok && (res.results ?? []).some((r) => r.status === "applied");
            if (wroteFile) {
              // The write lands a moment before Vite's watcher reloads the
              // page — stash now so the reload can replay it regardless of
              // that timing.
              try {
                sessionStorage.setItem(BAKE_TOAST_KEY, JSON.stringify({ lines, ok }));
              } catch {
                // Not fatal — the terminal line from the plugin still stands.
              }
            }
            ui.notice(lines, ok);
          })
          .catch((err) => {
            console.error("[tuning] bake failed", err);
            ui.notice(["bake failed: " + String(err)], false);
          });
        return;
      }

      // First press (or a stale one left over from a different scene):
      // dry-run only, never writes.
      clearPending();
      dryRunBake()
        .then((res) => {
          const edits = res.edits ?? [];
          if (edits.length === 0) {
            ui.flash(describeBakeResult(res).lines.join(" "), res.ok);
            return;
          }
          if (!res.ok) {
            ui.notice(describeBakeResult(res).lines, false);
            return;
          }
          const timer = setTimeout(() => {
            clearPending();
            ui.notice(["bake preview expired"], true);
          }, BAKE_CONFIRM_MS);
          pending = { sceneId, edits, timer };
          ui.notice(describeBakePreview(res), true);
        })
        .catch((err) => {
          console.error("[tuning] bake preview failed", err);
          ui.notice(["bake preview failed: " + String(err)], false);
        });
    } else if (e.code === "Escape" && pending) {
      clearPending();
      ui.notice(["bake cancelled"], true);
    }
  });

  console.info(
    "[tuning] live — window.__viz ready, Option/Alt+M to mark a frame, Option/Alt+C to clip, Option/Alt+D to bake the active scene's current settings into its source (press again to confirm — see the switch, top-left, for before/after)",
  );
}
