/**
 * Which audio input the Mic source opens — the system default, or one
 * specific device: a USB audio interface fed from a DJ mixer's REC/Booth out,
 * a mixer's own built-in USB sound card, a loopback driver. Global per device
 * like sourcePref.ts's mic-vs-screen choice (which input a device listens to
 * describes the device, not one scene's look), and it only ever refines "mic":
 * Screen capture has no device to pick.
 *
 * The stored choice is the device's id AND its label. An id alone doesn't
 * survive the things that happen between a sound check and a set: Chrome
 * scopes ids per origin and re-keys them when site data is cleared, so a
 * reload on a different host, or after a reset, sees a new id for the same
 * interface. resolveInputDeviceId() falls back to the label for exactly that.
 *
 * Nothing here opens a capture — src/app.ts's startMic() resolves the choice
 * against a fresh enumerateDevices() list, opens it through capture.ts's
 * captureMic(), and falls back to the system default (saying so) when the
 * chosen device isn't plugged in, so a missing interface never leaves the
 * scene deaf. The Input card's Source row (src/ui/deviceMenu.ts) is the
 * picker.
 *
 * Same in-memory-cache-over-localStorage pattern as sourcePref.ts.
 */

/** One stored choice. Absent (null from getInputDevicePref) = the system
 *  default input, whatever the OS currently has selected. */
export interface InputDevicePref {
  deviceId: string;
  label: string;
}

/** One entry the picker can offer — a real device, never the browser's
 *  "default"/"communications" aliases (see inputDeviceOptions). */
export interface InputDeviceOption {
  deviceId: string;
  label: string;
}

/** The two aliases Chromium lists next to the real devices: "default" (the
 *  OS's current default, which the picker's own "System default" entry
 *  already stands for) and "communications" (Windows' separate default for
 *  calls). Offering either would duplicate a real device under a second name. */
const ALIAS_IDS = new Set(["default", "communications"]);

/** Chromium labels the "default" alias "Default - <real device label>". */
const DEFAULT_LABEL_PREFIX = /^Default\s*-\s*/;

const STORAGE_KEY = "vibe.audioInputDevice";

function loadInitial(): InputDevicePref | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as InputDevicePref).deviceId === "string" &&
      typeof (parsed as InputDevicePref).label === "string" &&
      (parsed as InputDevicePref).deviceId !== ""
    ) {
      const { deviceId, label } = parsed as InputDevicePref;
      return { deviceId, label };
    }
    return null;
  } catch {
    return null;
  }
}

let cache: InputDevicePref | null = loadInitial();

function persist(): void {
  try {
    if (cache) localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not fatal — the choice just won't persist across reloads.
  }
}

export function getInputDevicePref(): InputDevicePref | null {
  return cache;
}

/** Null (or an empty id) goes back to the system default. */
export function setInputDevicePref(next: InputDevicePref | null): void {
  cache = next && next.deviceId !== "" ? { deviceId: next.deviceId, label: next.label } : null;
  persist();
}

/** The real, pickable inputs out of an enumerateDevices() list, in the
 *  browser's order. Empty until the mic permission has been granted once —
 *  before that browsers hand back placeholder entries with no id or label,
 *  which is nothing a person could choose between. */
export function inputDeviceOptions(devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]): InputDeviceOption[] {
  const out: InputDeviceOption[] = [];
  for (const d of devices) {
    if (d.kind !== "audioinput" || d.deviceId === "" || d.label === "" || ALIAS_IDS.has(d.deviceId)) continue;
    out.push({ deviceId: d.deviceId, label: d.label });
  }
  return out;
}

/** The real device the OS default currently points at, by label ("MacBook
 *  Pro Microphone"), for the picker's "System default (…)" entry — or null
 *  where the browser lists no "default" alias (Firefox, Safari). */
export function defaultInputLabel(devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[]): string | null {
  const alias = devices.find((d) => d.kind === "audioinput" && d.deviceId === "default" && d.label !== "");
  return alias ? alias.label.replace(DEFAULT_LABEL_PREFIX, "") : null;
}

/** What a stored choice resolves to against the devices listed right now:
 *  - `{ deviceId }`: open that device — the stored id when it's listed, or
 *    the id now carrying the stored label (the re-keyed case in this file's
 *    header), or the stored id as-is when the list can't say (no labels yet:
 *    the permission isn't granted, so let getUserMedia itself find out).
 *  - `missing`: the list is readable and the device isn't in it — unplugged.
 *  Null pref = the system default: nothing to resolve. */
export function resolveInputDeviceId(
  pref: InputDevicePref | null,
  devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[],
): { deviceId: string | null } | "missing" {
  if (!pref) return { deviceId: null };
  const options = inputDeviceOptions(devices);
  if (options.length === 0) return { deviceId: pref.deviceId };
  if (options.some((o) => o.deviceId === pref.deviceId)) return { deviceId: pref.deviceId };
  const byLabel = options.find((o) => o.label === pref.label);
  return byLabel ? { deviceId: byLabel.deviceId } : "missing";
}

/** getUserMedia's rejection for an exact deviceId that isn't there: Chrome
 *  and Firefox raise OverconstrainedError, Safari NotFoundError. Anything
 *  else (a denied permission above all) is a real failure, not a reason to
 *  quietly fall back to another input. */
export function isMissingDeviceError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/** What kind of input a device's name sounds like — the browser gives only a
 *  name, never a device category, so this is a guess from it, not a fact.
 *  Checked in order: a loopback driver's name (BlackHole, Loopback,
 *  Soundflower, VB-Cable, a generic "virtual" device, Windows' Stereo Mix,
 *  "What U Hear") is checked first because some carry "mic" in their own
 *  name too (e.g. a virtual "microphone" driver); a mic-shaped name (mic,
 *  microphone, headset, AirPods, a webcam/camera's built-in mic) next;
 *  anything else — a USB audio interface, a mixer's own sound card — is
 *  "line": a cable feeding in something that isn't this device's own
 *  mic. Used for the Input card's Source row (src/ui/deviceMenu.ts) and the
 *  labels named after it in src/app.ts (the stop button, the start prompt's
 *  Mic button, the gallery masthead's picker). */
export type InputKind = "mic" | "line" | "loopback";

const LOOPBACK_RE = /blackhole|loopback|soundflower|vb-?cable|virtual|stereo mix|what u hear/i;
const MIC_RE = /mic|microphone|headset|airpods|webcam|camera/i;

export function inputKind(label: string): InputKind {
  if (LOOPBACK_RE.test(label)) return "loopback";
  if (MIC_RE.test(label)) return "mic";
  return "line";
}

/** The Source row's per-kind tag + tooltip, and the words src/app.ts's
 *  labels name a kind by (its `tag`, upper- or lower-cased to fit). */
export const INPUT_KIND_TEXT: Record<InputKind, { tag: string; title: string }> = {
  mic: { tag: "MIC", title: "A microphone — hears the room" },
  line: {
    tag: "LINE IN",
    title: "A cable input — e.g. a USB audio interface fed from the DJ mixer",
  },
  loopback: {
    tag: "LOOPBACK",
    title:
      "A virtual input carrying this computer's own sound (BlackHole, Loopback, Stereo Mix) — hears what this computer plays, no mic or screen share needed",
  },
};
