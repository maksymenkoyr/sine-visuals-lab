import { EFFECTS, effectForCode, NO_EFFECTS, sameEffects, type EffectId, type HeldEffects } from "../render/heldEffects.ts";

/**
 * The hold-to-use half of the held effects (render/heldEffects.ts says what
 * they are): the on-screen buttons in index.html's #fxBar, bottom centre, and
 * the keys. Unlike the Cue/Play bar (outputControls.ts, only there once an
 * output window or room is open) this bar is up whenever a scene is, so the
 * effects work with no output window at all.
 *
 * Every effect is on only while held: a key down or a pointer down on its
 * button turns it on, key up, pointer up, the pointer leaving the button,
 * a cancelled pointer, the window losing focus or the tab hiding turns it off
 * (a held effect must never get stuck on a key-up that will not come). Keys
 * are bare: Cmd, Ctrl or Option held makes one not ours, and one pressed while
 * typing in a field is left alone. A button and its key can both hold an
 * effect; it stays on until both let go.
 *
 * `onChange` hears the combined set of engaged effects whenever it changes —
 * app.ts hands it to the compositor and to the output window. The buttons
 * light while their effect is engaged. This file builds the buttons itself
 * from EFFECTS, so the list lives in one place.
 */

export interface EffectControlsOptions {
  /** The container the buttons are built into (index.html's #fxBar). */
  bar: HTMLElement;
  /** Keys only act while this is true (a scene is on screen). */
  enabled(): boolean;
  /** True for a target the user is typing into (ui/deviceMenu.ts's isTypingTarget). */
  isTyping(target: EventTarget | null): boolean;
  onChange(effects: HeldEffects): void;
  /** A key (not a button) engaged this effect: for the shortcut tips (ui/keyHints.ts's noteKeyUse). */
  onKeyUse?(id: EffectId): void;
}

export interface EffectControls {
  /** Show the bar only while a scene is on screen; hiding lets everything go. */
  setVisible(visible: boolean): void;
  /** Lets every effect go (window blur, leaving the scene). */
  releaseAll(): void;
  engaged(): HeldEffects;
}

/** The `data-key` an effect's button carries — the id of its keys-card entry (ui/keyHints.ts). */
export function effectShortcutId(id: EffectId): string {
  return `fx-${id}`;
}

export function createEffectControls(opts: EffectControlsOptions): EffectControls {
  const { bar } = opts;
  const byKey: Record<EffectId, boolean> = { ...NO_EFFECTS };
  const byPointer: Record<EffectId, boolean> = { ...NO_EFFECTS };
  const buttons = new Map<EffectId, HTMLButtonElement>();
  let current: HeldEffects = { ...NO_EFFECTS };

  function recompute(): void {
    const next = { ...NO_EFFECTS };
    for (const d of EFFECTS) next[d.id] = byKey[d.id] || byPointer[d.id];
    if (sameEffects(next, current)) return;
    current = next;
    for (const d of EFFECTS) {
      const b = buttons.get(d.id);
      if (!b) continue;
      b.setAttribute("aria-pressed", String(next[d.id]));
      b.classList.toggle("on", next[d.id]);
    }
    bar.classList.toggle("attn", EFFECTS.some((d) => next[d.id]));
    opts.onChange({ ...next });
  }

  function releaseAll(): void {
    for (const d of EFFECTS) {
      byKey[d.id] = false;
      byPointer[d.id] = false;
    }
    recompute();
  }

  for (const d of EFFECTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fxKey";
    b.dataset.fx = d.id;
    b.dataset.key = effectShortcutId(d.id);
    b.dataset.keycap = d.key;
    b.setAttribute("aria-pressed", "false");
    b.title = d.hint;
    const name = document.createElement("b");
    name.textContent = d.label;
    const key = document.createElement("small");
    key.textContent = d.key;
    b.append(name, key);
    const down = (e: PointerEvent): void => {
      if (e.button > 0) return;
      byPointer[d.id] = true;
      recompute();
    };
    const up = (): void => {
      byPointer[d.id] = false;
      recompute();
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
    // A long press on a touch screen must not open the context menu mid-hold.
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    bar.appendChild(b);
    buttons.set(d.id, b);
  }

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const d = effectForCode(e.code);
    if (!d || !opts.enabled() || opts.isTyping(e.target)) return;
    e.preventDefault();
    if (e.repeat || byKey[d.id]) return;
    byKey[d.id] = true;
    opts.onKeyUse?.(d.id);
    recompute();
  });
  // Released by the key itself, whatever modifiers are down by then.
  window.addEventListener("keyup", (e) => {
    const d = effectForCode(e.code);
    if (!d || !byKey[d.id]) return;
    byKey[d.id] = false;
    recompute();
  });
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });

  return {
    setVisible(visible) {
      bar.style.display = visible ? "flex" : "none";
      if (!visible) releaseAll();
    },
    releaseAll,
    engaged: () => ({ ...current }),
  };
}
