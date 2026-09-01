/**
 * Tiny dev-only overlay: a switch for the clip buffer (see capture.ts —
 * it's a continuous background sample loop, so it's opt-in rather than
 * always-on), a flash toast confirming a mark/clip actually saved, and a
 * persistent notice() panel for Alt+D's bake preview/confirmation — flash()
 * fades in under a second, too brief to read a multi-line preview and gone
 * before the page reload a real bake triggers, so that flow gets its own
 * dismissible block instead. Mounted once from debug.ts's initTuning();
 * never imported in prod.
 */

export interface NoticeHandle {
  close(): void;
}

export interface TuningUI {
  /** Briefly shows `label` in the corner. ok=false renders it as an error. */
  flash(label: string, ok?: boolean): void;
  /** Shows a persistent, dismissible block of `lines` under the clip-buffer
   *  switch — replaces whatever notice is already showing. ok=false renders
   *  it as an error. */
  notice(lines: string[], ok?: boolean): NoticeHandle;
}

export function mountTuningUI(onBufferToggle: (on: boolean) => void): TuningUI {
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

  // The persistent sibling to flash() above — appended to the same top-left
  // panel as the clip-buffer switch, so it survives a full page reload
  // reattaching this module (debug.ts relays the text through
  // sessionStorage; this just renders whatever it's handed).
  const noticeBox = document.createElement("div");
  noticeBox.style.cssText =
    "display:none;flex-direction:column;gap:2px;margin-top:4px;padding-top:4px;" +
    "border-top:1px solid rgba(255,255,255,.2);white-space:pre;";
  panel.appendChild(noticeBox);

  function notice(lines: string[], ok = true): NoticeHandle {
    noticeBox.textContent = "";
    noticeBox.style.color = ok ? "#fff" : "#f88";
    const text = document.createElement("div");
    text.textContent = lines.join("\n");
    const close = document.createElement("span");
    close.textContent = "✕";
    close.style.cssText = "cursor:pointer;opacity:.7;align-self:flex-end;";
    close.addEventListener("click", () => {
      noticeBox.style.display = "none";
    });
    noticeBox.appendChild(text);
    noticeBox.appendChild(close);
    noticeBox.style.display = "flex";
    return {
      close(): void {
        noticeBox.style.display = "none";
      },
    };
  }

  return { flash, notice };
}
