/**
 * Text that a live refresh rewrites (every frame, a ~100ms tick, a timer)
 * inside something the user clicks: write it with `setLiveText`, never with
 * `textContent =`.
 *
 * Assigning textContent swaps in a new text node even when the text is the
 * same, and WebKit drops a click whose press began on a node that has since
 * left the DOM. So on Safari, a press that straddles a refresh on a live
 * number — a slider's readout on an Auto row, the REC button's clock, a
 * strain box's stats — did nothing. `setLiveText` keeps the element's one
 * text node and changes its data, so the node under the press survives.
 * When the element holds anything else (another element, several nodes), it
 * falls back to textContent once, and every write after that is in place.
 */

const TEXT_NODE = 3;

export function setLiveText(el: Element, text: string): void {
  const node = el.firstChild;
  if (node && node.nodeType === TEXT_NODE && node === el.lastChild) {
    if ((node as Text).data !== text) (node as Text).data = text;
  } else el.textContent = text;
}
