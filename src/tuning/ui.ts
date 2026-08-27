/**
 * Tiny dev-only overlay: this page's tuning slot (session.ts), a switch for
 * the clip buffer (see capture.ts — it's a continuous background sample loop,
 * so it's opt-in rather than always-on), and a flash toast confirming a
 * mark/clip actually saved. Mounted once from debug.ts's initTuning(); never
 * imported in prod.
 */

export interface TuningUI {
  /** Briefly shows `label` in the corner. ok=false renders it as an error. */
  flash(label: string, ok?: boolean): void;
}

export function mountTuningUI(onBufferToggle: (on: boolean) => void, slot?: string | null): TuningUI {
  const panel = document.createElement("div");
  panel.className = "__tuning-overlay";
  panel.style.cssText =
    "position:fixed;top:58px;left:12px;z-index:99999;font:12px/1.4 -apple-system,monospace;" +
    "background:rgba(0,0,0,.7);color:#fff;padding:6px 10px;border-radius:6px;" +
    "display:flex;align-items:center;gap:6px;user-select:none;transition:opacity .4s;";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "__tuning-clip-buffer";
  checkbox.addEventListener("change", () => onBufferToggle(checkbox.checked));

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;";
  label.textContent = "clip buffer";
  label.prepend(checkbox);

  // Two tuning windows look identical otherwise, and telling them apart
  // matters the moment you're driving one while a tool drives the other.
  // Absent slot = not a tuning session, so there's nothing to badge.
  if (slot) {
    const badge = document.createElement("span");
    badge.textContent = slot;
    badge.title = `Tuning slot ${slot}`;
    badge.style.cssText =
      "font-weight:600;letter-spacing:.06em;background:#fbbf24;color:#000;" +
      "border-radius:4px;padding:1px 5px;margin-right:2px;";
    panel.appendChild(badge);
  }

  panel.appendChild(label);
  document.body.appendChild(panel);

  // Fade the panel along with the rest of the chrome in immersed/fullscreen
  // mode (see src/ui/fullscreen.ts and the mirrored .iconBtn rule in
  // index.html) — it's dev-only, not part of the shipped chrome, so the rule
  // lives here rather than in index.html.
  const style = document.createElement("style");
  style.textContent = "body.chrome-idle .__tuning-overlay { opacity: 0; pointer-events: none; }";
  document.head.appendChild(style);

  const toast = document.createElement("div");
  toast.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;" +
    "font:13px/1.4 -apple-system,monospace;color:#fff;padding:6px 12px;border-radius:6px;" +
    "opacity:0;pointer-events:none;transition:opacity .15s ease;";
  document.body.appendChild(toast);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(text: string, ok = true): void {
    toast.textContent = text;
    toast.style.background = ok ? "rgba(22,163,74,.92)" : "rgba(220,38,38,.92)";
    toast.style.opacity = "1";
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toast.style.opacity = "0";
    }, 900);
  }

  return { flash };
}
