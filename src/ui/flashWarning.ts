/**
 * The photosensitivity warning: several scenes and the held effects cut hard
 * between bright and dark frames (strobes, flicker, beat flashes), and the
 * picture is often shown to a room that never opened the app. The line goes
 * where a visitor or an operator sees it before the picture starts: the
 * gallery's footer (ui/gallery.ts) and a TV's pairing screen
 * (ui/joinScreen.ts). One string, so every place says the same thing.
 */
export const FLASH_WARNING =
  "Contains flashing and strobe effects that may affect people with photosensitive epilepsy.";
