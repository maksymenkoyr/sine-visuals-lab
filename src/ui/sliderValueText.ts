/**
 * What a screen reader says for a panel slider: the number the row's readout
 * shows, with its unit, or "Off" wherever the readout says Off (the row is
 * muted with T, or it sits on an Off stop). It is the aria-valuetext that
 * createControlRow (deviceMenu.ts) sets on each native range slider.
 *
 * The text is built from the setting's own value, never the native
 * slider.value: a log row's slider is a hidden position (posToValue and
 * valueToPos in createControlRow), so the native value would be read as that
 * position rather than the number on screen. The patch panel's own linear
 * sliders (deviceMenu.ts) and powerCard.ts's Resolution slider set their
 * valuetext from the text their own output shows instead.
 *
 * isOffReadout is the one rule for "the readout says Off", shared by this
 * text and createControlRow's own setReadout, so the two cannot drift.
 *
 * Pure (no DOM), so tests/sliderValueText.test.ts checks it in node.
 */

/** True when the row's readout shows "Off": muted (T) or an Off stop. */
export function isOffReadout(value: number, muted: boolean, zeroAtMin: boolean | undefined): boolean {
  return muted || (!!zeroAtMin && value <= 0);
}

/** "%" and "×" read fine glued to the number; a word unit ("s", "ms") needs a space. */
export function sliderValueText(
  value: number,
  o: { format: (v: number) => string; unit?: string; muted?: boolean; zeroAtMin?: boolean },
): string {
  if (isOffReadout(value, o.muted ?? false, o.zeroAtMin)) return "Off";
  const u = o.unit ?? "";
  const sep = u === "" || u === "%" || u === "×" ? "" : " ";
  return `${o.format(value)}${sep}${u}`;
}
