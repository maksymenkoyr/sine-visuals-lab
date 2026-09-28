import { describe, it, expect, beforeEach } from "vitest";
import {
  getInputDevicePref,
  setInputDevicePref,
  inputDeviceOptions,
  defaultInputLabel,
  resolveInputDeviceId,
  isMissingDeviceError,
  inputKind,
  deviceLabel,
  isInputHidden,
  setInputHidden,
} from "../src/audio/inputDevice.ts";

describe("hidden inputs", () => {
  it("hides and shows by label", () => {
    expect(isInputHidden("Steam Streaming Microphone")).toBe(false);
    setInputHidden("Steam Streaming Microphone", true);
    expect(isInputHidden("Steam Streaming Microphone")).toBe(true);
    expect(isInputHidden("MacBook Pro Microphone")).toBe(false);
    setInputHidden("Steam Streaming Microphone", false);
    expect(isInputHidden("Steam Streaming Microphone")).toBe(false);
  });
});

describe("deviceLabel", () => {
  it("gives the default input's track the real device's own name", () => {
    expect(deviceLabel("Default - MacBook Pro Microphone (Built-in)")).toBe("MacBook Pro Microphone (Built-in)");
    expect(deviceLabel("USB Audio CODEC")).toBe("USB Audio CODEC");
  });
});

type Device = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

const mic = (deviceId: string, label: string): Device => ({ kind: "audioinput", deviceId, label });

// What Chrome on a Mac lists once the mic permission is granted, with a USB
// interface plugged in.
const CHROME_GRANTED: Device[] = [
  mic("default", "Default - MacBook Pro Microphone (Built-in)"),
  mic("builtin-id", "MacBook Pro Microphone (Built-in)"),
  mic("uca-id", "USB Audio CODEC (08bb:29c2)"),
  { kind: "audiooutput", deviceId: "spk-id", label: "MacBook Pro Speakers (Built-in)" },
];

// Before any grant browsers list placeholders with no id or label.
const NOT_GRANTED: Device[] = [mic("", ""), { kind: "audiooutput", deviceId: "", label: "" }];

describe("inputDeviceOptions", () => {
  it("lists real inputs only — no aliases, no outputs", () => {
    expect(inputDeviceOptions(CHROME_GRANTED)).toEqual([
      { deviceId: "builtin-id", label: "MacBook Pro Microphone (Built-in)" },
      { deviceId: "uca-id", label: "USB Audio CODEC (08bb:29c2)" },
    ]);
  });

  it("drops Windows' communications alias too", () => {
    expect(inputDeviceOptions([mic("communications", "Communications - Mic"), mic("a", "Mic")])).toEqual([
      { deviceId: "a", label: "Mic" },
    ]);
  });

  it("is empty before the permission is granted", () => {
    expect(inputDeviceOptions(NOT_GRANTED)).toEqual([]);
  });
});

describe("defaultInputLabel", () => {
  it("strips Chrome's 'Default - ' prefix", () => {
    expect(defaultInputLabel(CHROME_GRANTED)).toBe("MacBook Pro Microphone (Built-in)");
  });

  it("is null where no default alias is listed", () => {
    expect(defaultInputLabel([mic("a", "Mic")])).toBeNull();
    expect(defaultInputLabel(NOT_GRANTED)).toBeNull();
  });
});

describe("resolveInputDeviceId", () => {
  const uca = { deviceId: "uca-id", label: "USB Audio CODEC (08bb:29c2)" };

  it("no choice = the system default", () => {
    expect(resolveInputDeviceId(null, CHROME_GRANTED)).toEqual({ deviceId: null });
  });

  it("finds the chosen device by id", () => {
    expect(resolveInputDeviceId(uca, CHROME_GRANTED)).toEqual({ deviceId: "uca-id" });
  });

  it("finds it by label when its id has rotated", () => {
    const rekeyed = CHROME_GRANTED.map((d) => (d.deviceId === "uca-id" ? { ...d, deviceId: "new-uca-id" } : d));
    expect(resolveInputDeviceId(uca, rekeyed)).toEqual({ deviceId: "new-uca-id" });
  });

  it("reports an unplugged device as missing", () => {
    const unplugged = CHROME_GRANTED.filter((d) => d.deviceId !== "uca-id");
    expect(resolveInputDeviceId(uca, unplugged)).toBe("missing");
  });

  it("tries the stored id when the list can't tell (no grant yet)", () => {
    expect(resolveInputDeviceId(uca, NOT_GRANTED)).toEqual({ deviceId: "uca-id" });
  });
});

describe("isMissingDeviceError", () => {
  it("matches Chrome/Firefox and Safari's not-there errors", () => {
    expect(isMissingDeviceError({ name: "OverconstrainedError" })).toBe(true);
    expect(isMissingDeviceError({ name: "NotFoundError" })).toBe(true);
  });

  it("never swallows a denied permission", () => {
    expect(isMissingDeviceError({ name: "NotAllowedError" })).toBe(false);
    expect(isMissingDeviceError(null)).toBe(false);
    expect(isMissingDeviceError("boom")).toBe(false);
  });
});

describe("inputKind", () => {
  it("guesses from the device name", () => {
    expect(inputKind("MacBook Pro Microphone")).toBe("mic");
    expect(inputKind("USB Audio CODEC")).toBe("line");
    expect(inputKind("Scarlett Solo USB")).toBe("line");
    expect(inputKind("DJM-450")).toBe("line");
    expect(inputKind("BlackHole 2ch")).toBe("loopback");
    expect(inputKind("Stereo Mix (Realtek)")).toBe("loopback");
    expect(inputKind("AirPods Pro")).toBe("mic");
  });
});

// Global per device like sourcePref — reset first so no test leaks the last
// one's choice (vitest shares the module-level cache within a file). Runs
// under environment "node": no localStorage at all, which the module must
// tolerate.
describe("input device preference", () => {
  beforeEach(() => setInputDevicePref(null));

  it("defaults to the system default", () => {
    expect(getInputDevicePref()).toBeNull();
  });

  it("round-trips a choice", () => {
    setInputDevicePref({ deviceId: "uca-id", label: "USB Audio CODEC" });
    expect(getInputDevicePref()).toEqual({ deviceId: "uca-id", label: "USB Audio CODEC" });
  });

  it("treats an empty id as the system default", () => {
    setInputDevicePref({ deviceId: "", label: "whatever" });
    expect(getInputDevicePref()).toBeNull();
  });
});
