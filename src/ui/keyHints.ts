import { hideTooltip, showTooltip } from "./tooltip.ts";

/**
 * Every shortcut hint surface in the controls panel (src/ui/deviceMenu.ts)
 * and the chrome buttons around it (index.html's #menuBtn/#fsBtn) — the
 * single owner, so a new shortcut only ever needs touching here plus one
 * `data-key`/`data-keycap` tag on the control that performs it.
 *
 * SHORTCUTS is the registry the interactive keys list (deviceMenu.ts's
 * keysCard) is built from, one row per entry. Any element carrying
 * `data-key="<id>"` *is* the control that performs that shortcut — tagged
 * once, at the point each control is created, never looked up by class or
 * id elsewhere. `data-keycap` (usually the entry's own `key` — "A", "S",
 * "R", never the button's own glyph: the reset chip shows "↺" but wears
 * `data-keycap="R"`) is what the hold-to-reveal keycap below prints; a
 * control that already shows its own key some other way skips it — the
 * .vc-block digit badge (deviceMenu.ts's markBlock) carries `data-key`
 * (for the hover tooltip) but never `data-keycap`, since it's already
 * showing its own digit as plain text. A control that prints its own key
 * and has nothing to add by hover also wears `data-key-shown` — the pop-out
 * bar's CUE and PLAY pads (index.html's #outBar), whose key sits under each
 * pad — and gets no hover/focus badge either: the badge would only repeat
 * it, over the bar's state line. It still counts toward the light
 * suggestions below.
 *
 * installKeyHints(), called once from deviceMenu.ts, wires three
 * independent, document-level behaviours that don't know about each other:
 *  - a hover/focus badge: one delegated pointerover/pointerout and one
 *    focusin/focusout pair show/hide tooltip.ts's shared tooltip over
 *    whichever `[data-key]` ancestor the pointer or focus currently sits
 *    on — reused, never a second tooltip implementation;
 *  - hold-to-reveal: holding Shift alone for HOLD_MS adds `vc-keys-reveal`
 *    to `<body>`, which controlsTheme.ts's stylesheet turns into a
 *    `content: attr(data-keycap)` `::after` on every tagged control at
 *    once. Cancelled by releasing Shift, pressing any other key (so
 *    Shift+Tab and "?" — which browsers report as their own keydown, not a
 *    second Shift one — still cancel the reveal and still reach their own
 *    handlers untouched; this never calls preventDefault), losing window
 *    focus, or the tab going hidden;
 *  - light suggestions: noteKeyUse(id)/noteMouseUse(id), called whenever a
 *    shortcut fires by keyboard or a tagged control is clicked with a
 *    mouse — deviceMenu.ts and app.ts call the keyboard half at each of
 *    their own key handlers; the mouse half is automatic here, off one
 *    delegated click listener, skipped for a touch pointer (which has no
 *    "you could have pressed a key instead" story). The first time an id
 *    goes through noteMouseUse twice without its key ever having been
 *    pressed, `onTip` (deviceMenu.ts's showToast, given more time on
 *    screen than its default) gets one "Tip: press <key> — <label>" line.
 *    Both "used" and "tipped" are per id, not per DOM element — clicking
 *    any one of a scene's several reset chips counts toward the same
 *    "reset" id — and persist (localStorage's "vibe.keyTips", the
 *    in-memory-cache-over-storage pattern of panelFolds.ts) so a tip or
 *    the first-open welcome (welcomeOnce) never repeats once shown, and no
 *    two tips ever land within TIP_COOLDOWN_MS of each other regardless of
 *    which id earned them.
 */

export interface Shortcut {
  /** Display form for the keys list row and, for an id whose tagged
   *  control(s) all share one key (everything but the block badges, which
   *  print their own digit instead), the hold-to-reveal keycap too. */
  key: string;
  /** Matches the `data-key` value of the control(s) this entry describes. */
  id: string;
  /** Short name — the hover tooltip's line reads "<label> · <key>". */
  label: string;
  /** Longer description — what the keys list row shows beside the key. */
  hint: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { key: "S", id: "panel", label: "Panel", hint: "Open / close the panel" },
  { key: "H", id: "hide", label: "Hide UI", hint: "Hide the interface" },
  { key: "M", id: "left", label: "Hide left", hint: "Hide / show the left panel" },
  { key: "O", id: "solo", label: "Solo", hint: "Show only the pinned setting (or the Scene card)" },
  { key: "F", id: "fullscreen", label: "Fullscreen", hint: "Fullscreen" },
  { key: "Tab", id: "tab", label: "Next control", hint: "Next control (⇧ previous)" },
  { key: "1–9", id: "block", label: "Jump to block", hint: "Jump to a numbered block" },
  { key: "A", id: "auto", label: "Auto", hint: "Auto-tune the focused row" },
  { key: "R", id: "reset", label: "Reset", hint: "Reset the focused row" },
  { key: "T", id: "mute", label: "Mute", hint: "Mute the focused row, press again to restore" },
  { key: "Z X C", id: "zxc", label: "Slider jump", hint: "Slider to middle · max · pointer" },
  { key: "Esc", id: "esc", label: "Unpin", hint: "Unpin the pinned setting" },
  { key: "?", id: "keys", label: "Keys", hint: "This list" },
  { key: "B", id: "beat-one", label: "The 1", hint: "This beat is the 1 (⇧ clears ×2/÷2, nudge and a tapped tempo)" },
  { key: "[ ]", id: "tempo-x", label: "Tempo ÷2 ×2", hint: "Halve / double the beat" },
  { key: ", .", id: "beat-nudge", label: "Nudge", hint: "Beats 10 ms earlier / later" },
  { key: "⌃ Ctrl", id: "tap", label: "Tap tempo", hint: "Tap on every beat to set the tempo (the Tempo card's Tap does the same)" },
  { key: "Space", id: "cue", label: "Cue", hint: "Hold the output window while you tune — leaving Cue sends nothing (K does the same)" },
  { key: "⌥ Option", id: "go", label: "Play", hint: "Send this look to the output window: tap = at once, hold = glide there over twice as long (G sends at once)" },
];

function shortcutFor(id: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.id === id);
}

function taggedAncestor(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>("[data-key]") : null;
}

// ---- hover/focus badge ----

let hovered: HTMLElement | null = null;

/** "<label> · <key>" for anything in SHORTCUTS, or "Jump to block · <n>"
 *  for a .vc-block badge, which has no SHORTCUTS entry of its own (many
 *  badges, one shared "block" id, each with a different digit). */
function hintLine(el: HTMLElement): string | null {
  const id = el.dataset.key;
  if (!id || el.hasAttribute("data-key-shown")) return null;
  if (id === "block") {
    const digit = el.textContent?.trim();
    return digit ? `Jump to block · ${digit}` : null;
  }
  const s = shortcutFor(id);
  // The gear turns into a close cross while the panel is open (index.html's
  // #menuBtn rules) — the hint follows it.
  if (s && id === "panel" && el.getAttribute("aria-pressed") === "true") return `Close controls · ${s.key}`;
  // Solo's eye floats on <body>, outside the panel, so it carries its own
  // on/off state rather than sitting under .vc-solo.
  if (s && id === "solo" && (el.closest(".vc-solo") || el.classList.contains("vc-solo-eye-on"))) return `Show all · ${s.key}`;
  if (s && id === "solo" && el.classList.contains("vc-solo-eye")) return `Show only this · ${s.key}`;
  return s ? `${s.label} · ${s.key}` : null;
}

function showHint(el: HTMLElement): void {
  const line = hintLine(el);
  if (line) showTooltip(el, "#fff", [line]);
}

// ---- hold-to-reveal ----

const HOLD_MS = 350;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function cancelHold(): void {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  document.body.classList.remove("vc-keys-reveal");
}

// ---- light suggestions ----

interface KeyTipsState {
  /** ids whose keyboard shortcut has actually been pressed — once true,
   *  that id can never earn a tip again (the tip only exists to point at a
   *  key nobody's found yet). */
  used: Record<string, boolean>;
  /** ids that have already produced a tip, ever — at most one per id. */
  tipped: Record<string, boolean>;
  welcomed: boolean;
}

const STORAGE_KEY = "vibe.keyTips";

function loadInitial(): KeyTipsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { used: {}, tipped: {}, welcomed: false };
    const parsed = JSON.parse(raw);
    return {
      used: parsed?.used && typeof parsed.used === "object" ? parsed.used : {},
      tipped: parsed?.tipped && typeof parsed.tipped === "object" ? parsed.tipped : {},
      welcomed: parsed?.welcomed === true,
    };
  } catch {
    return { used: {}, tipped: {}, welcomed: false };
  }
}

// Same in-memory-cache-over-localStorage pattern as panelFolds.ts: the
// cache is the source of truth within a session, seeded once, so behavior
// stays correct even where localStorage throws (private mode, the node
// test env).
let cache: KeyTipsState = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — tips just won't stay quiet across reloads.
  }
}

// How many times each id's tagged control has been mouse-clicked this
// session — in-memory only, not part of KeyTipsState/localStorage. Only
// "never tip this id again" and "already welcomed" need to survive a
// reload; a fresh page load gets a fresh count toward the 2nd-use tip.
const mouseUses: Record<string, number> = {};

const TIP_COOLDOWN_MS = 60_000;
let lastTipMs = 0;
let onTip: ((text: string) => void) | null = null;

/** True when the tip was actually handed to `onTip` — false inside the
 *  cooldown, or before installKeyHints has supplied a `onTip`. A caller that
 *  spends something on showing a tip (noteMouseUse's "never again" mark)
 *  does so only on true. */
function tip(text: string): boolean {
  const now = Date.now();
  if (now - lastTipMs < TIP_COOLDOWN_MS || !onTip) return false;
  lastTipMs = now;
  onTip(text);
  return true;
}

/** Call when `id`'s shortcut key itself was pressed — deviceMenu.ts's
 *  onKeyDown and wireRowKeys, app.ts's F/S handlers. */
export function noteKeyUse(id: string): void {
  if (cache.used[id]) return;
  cache = { ...cache, used: { ...cache.used, [id]: true } };
  persist();
}

/** Call when `id`'s tagged control was clicked with a mouse.
 *  installKeyHints wires this automatically off every `[data-key]` click
 *  (skipping touch) — exported for symmetry with noteKeyUse and for
 *  tests/keyHints.test.ts. */
export function noteMouseUse(id: string): void {
  if (cache.used[id] || cache.tipped[id]) return;
  mouseUses[id] = (mouseUses[id] ?? 0) + 1;
  if (mouseUses[id] < 2) return;
  const s = shortcutFor(id);
  if (!s) return;
  // Only an id whose tip was actually shown is retired: one swallowed by the
  // cooldown (or arriving before installKeyHints) keeps its count, so the
  // next click after the cooldown earns it again.
  if (!tip(`Tip: press ${s.key} — ${s.label}`)) return;
  cache = { ...cache, tipped: { ...cache.tipped, [id]: true } };
  persist();
}

/** The first-ever panel open — deviceMenu.ts's open(). Independent of the
 *  tip cooldown above (a different message, for a different reason) — a
 *  tip can still land right after it. */
export function welcomeOnce(): void {
  if (cache.welcomed) return;
  cache = { ...cache, welcomed: true };
  persist();
  onTip?.("Press ? for shortcuts · hold Shift to see them all");
}

/** Wires the hover badge, hold-to-reveal, and the automatic mouse half of
 *  the light-suggestion tracking — see this file's header. `tipCallback`
 *  is deviceMenu.ts's showToast, called with a longer duration than its
 *  own default (a tip takes longer to read than the panel's usual toasts). */
export function installKeyHints(tipCallback: (text: string) => void): void {
  onTip = tipCallback;

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = taggedAncestor(e.target);
    if (el === hovered) return;
    hovered = el;
    if (el) showHint(el);
    else hideTooltip();
  });
  document.addEventListener("pointerout", (e) => {
    // Nothing tagged hovered → this pointerout isn't ours; hiding here would
    // kill the shared tooltip of another surface (the version label's hint
    // vanished whenever the pointer crossed between its child spans).
    if (!hovered || taggedAncestor(e.target) !== hovered) return;
    const related = e.relatedTarget;
    if (related instanceof Node && hovered?.contains(related)) return;
    hovered = null;
    hideTooltip();
  });
  document.addEventListener("focusin", (e) => {
    const el = taggedAncestor(e.target);
    if (el) showHint(el);
  });
  document.addEventListener("focusout", (e) => {
    if (taggedAncestor(e.target)) hideTooltip();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Shift" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (holdTimer || document.body.classList.contains("vc-keys-reveal")) return;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        document.body.classList.add("vc-keys-reveal");
      }, HOLD_MS);
      return;
    }
    // Any other key — Shift+Tab and "?" (itself Shift+/ on most layouts)
    // included — cancels rather than extending the hold. Never
    // preventDefault: the key still reaches whatever else is listening.
    cancelHold();
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") cancelHold();
  });
  window.addEventListener("blur", cancelHold);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelHold();
  });

  // The mouse half of noteMouseUse — pointerdown fires before click, so by
  // the time click runs, lastPointerType already names the device that's
  // about to fire it.
  let lastPointerType = "mouse";
  document.addEventListener("pointerdown", (e) => {
    lastPointerType = e.pointerType;
  });
  document.addEventListener("click", (e) => {
    if (lastPointerType === "touch") return;
    const el = taggedAncestor(e.target);
    if (el?.dataset.key) noteMouseUse(el.dataset.key);
    // A toggle's own handler has already run (this listener is on the
    // document, so it hears the click last) — redraw the hint in case the
    // click just flipped what it says (the gear, Solo's eye).
    if (el && el === hovered) showHint(el);
  });
}
