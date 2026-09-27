/**
 * Colour swatches in hint text: every hint that names a colour ("Green
 * ticks are beats that fired", "glows hot red instead of ice blue") shows
 * a small dot of that colour just before the word, so the reader matches
 * the word to the picture without guessing which red is meant.
 *
 * One entry point, `setHintText`, used by every hint surface in place of
 * `textContent =`: the panel rows' `.vc-hint` (controlsKit.ts,
 * audioMeters.ts, powerCard.ts, deviceMenu.ts), the patch bay's instant
 * tooltip (tooltip.ts) and the pinned patch panel's bottom hint line
 * (deviceMenu.ts's buildPatchPanel). A new hint that goes through it gets
 * its swatches with no extra work. Native `title` tooltips can't hold an
 * element, so they stay plain text.
 *
 * `COLOUR_WORDS` is the generic word → colour table. A hint whose words
 * stand for something drawn in a specific colour — a meter's red beat
 * ticks are `HOT_RED`, its blue grid `AUTO_SKY` — passes `colors` to swap
 * in the real one, keyed by the lower-case phrase as it appears in
 * `COLOUR_WORDS`. Words that also mean something else in this app's hints
 * ("sky" above a terrain, "neon" as a style) are deliberately left out.
 *
 * `splitHintText` is the pure half (text → runs), tested in
 * tests/hintSwatches.test.ts; `setHintText` only turns runs into DOM.
 */

/** Longer phrases first, so "ice blue" wins over "blue" and "white-hot"
 *  over "white" — the regex below tries alternatives in this order. */
export const COLOUR_WORDS: Readonly<Record<string, string>> = {
  "ice-blue": "#9fd8ff",
  "ice blue": "#9fd8ff",
  "white-hot": "#fff1d6",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f9b96c",
  yellow: "#eab308",
  gold: "#e6b422",
  green: "#4ade80",
  lime: "#a3e635",
  teal: "#2dd4bf",
  cyan: "#22d3ee",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  magenta: "#e040fb",
  pink: "#f472b6",
  coral: "#ff7f6b",
  white: "#ffffff",
  black: "#000000",
  grey: "#9ca3af",
  gray: "#9ca3af",
};

const COLOUR_RE = new RegExp(
  `\\b(${Object.keys(COLOUR_WORDS)
    .map((w) => w.replace(/[-\s]/g, (c) => (c === "-" ? "-" : "[\\s-]")))
    .join("|")})\\b`,
  "gi",
);

export type HintRun = { text: string } | { text: string; color: string };

/** Splits `text` into plain runs and colour-word runs, in order. A colour
 *  run's `color` is `colors[phrase]` when given, else `COLOUR_WORDS`. */
export function splitHintText(text: string, colors?: Readonly<Record<string, string>>): HintRun[] {
  const runs: HintRun[] = [];
  let last = 0;
  for (const m of text.matchAll(COLOUR_RE)) {
    const at = m.index ?? 0;
    const key = m[0].toLowerCase().replace(/\s+/g, " ");
    const lookup = key in COLOUR_WORDS ? key : key.replace("-", " ");
    const color = colors?.[lookup] ?? COLOUR_WORDS[lookup];
    if (!color) continue;
    if (at > last) runs.push({ text: text.slice(last, at) });
    runs.push({ text: m[0], color });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs;
}

/** Fills `el` with `text`, a swatch before each colour word. */
export function setHintText(el: HTMLElement, text: string, colors?: Readonly<Record<string, string>>): void {
  el.replaceChildren(
    ...splitHintText(text, colors).map((run) => {
      if (!("color" in run)) return document.createTextNode(run.text);
      const word = document.createElement("span");
      word.className = "vc-swatch-word";
      const dot = document.createElement("span");
      dot.className = "vc-swatch";
      dot.style.background = run.color;
      dot.setAttribute("aria-hidden", "true");
      word.append(dot, run.text);
      return word;
    }),
  );
}
