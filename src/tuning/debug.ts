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
  /** Drops every typed-in dev pin (tuning/pins.ts) on every scene — for a
   *  headless driver to neutralize a developer's leftover pins before a run. */
  clearPins(): void;
  /** Dry-runs a bake of the active scene's current settings (see
   *  bakeDefaults.ts) and returns the would-be result without writing —
   *  what Alt+D's first press does, exposed for a headless driver to check
   *  deterministically instead of scraping the notice panel. */
  bakeDefaults(): Promise<BakeResponse>;
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
  return res.skipped && res.skipped.length > 0 ? ` (skipped ${res.skipped.join(", ")}: pinned/overridden)` : "";
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
