import { describe, it, expect, beforeEach } from "vitest";
import { isMicAuto, setMicAuto, type MicAutoMembers } from "../src/audio/micAuto.ts";
import { isAutoGainAuto, setAutoGainAuto } from "../src/audio/autoGain.ts";
import { isSilenceGateAuto, setSilenceGateAuto } from "../src/audio/silenceGate.ts";
import {
  isAutoEnabled,
  setAutoEnabled,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
} from "../src/render/autoTune.ts";

// Real store functions, not mocks: micAuto.ts is a pure aggregator over its
// injected members (see its own header), so exercising it through its
// actual dependencies is both simpler and a better regression guard than
// faking them out. `onSettingAutoToggle` here is the plain setAutoEnabled
// path rather than app.ts's own seed-on-enable wrapper — that wrapper's
// seeding is app.ts's integration concern (verified separately, e.g. by the
// isSceneAuto-style behavior in tests/autoTune.test.ts), not something
// isMicAuto/setMicAuto themselves need to exercise.
const members: MicAutoMembers = {
  isAutoGainAuto,
  setAutoGainAuto,
  isSilenceGateAuto,
  setSilenceGateAuto,
  getSensitivitySpec,
  getExpansionSpec,
  getSmoothingSpec,
  isSettingAutoEnabled: isAutoEnabled,
  onSettingAutoToggle: (sceneId, spec, on) => setAutoEnabled(sceneId, spec.key, on),
};

// Modelled on tests/autoTune.test.ts's isSceneAuto test — same "false by
// default, true only once every member is on, false again the moment any
// one member goes back to manual" contract, just over micAuto.ts's own
// fixed member list instead of an arbitrary specs array.
describe("isMicAuto / setMicAuto", () => {
  const sceneId = "mic-auto-test-scene";

  beforeEach(() => {
    setAutoGainAuto(false);
    setSilenceGateAuto(false);
    setAutoEnabled(sceneId, getSensitivitySpec().key, false);
    setAutoEnabled(sceneId, getExpansionSpec().key, false);
    setAutoEnabled(sceneId, getSmoothingSpec().key, false);
  });

  it("is false by default", () => {
    expect(isMicAuto(sceneId, members)).toBe(false);
  });

  it("is true on a genuinely untouched scene — every member defaults to auto (the point of this whole change)", () => {
    // AutoGain/the gate are device-wide, so restore their own real default
    // here rather than trusting this describe block's beforeEach reset,
    // which forces them off to isolate the other tests above.
    setAutoGainAuto(true);
    setSilenceGateAuto(true);
    const freshScene = "mic-auto-fresh-scene";
    expect(isMicAuto(freshScene, members)).toBe(true);
  });

  it("is true only once every member is switched to auto, one at a time", () => {
    setAutoGainAuto(true);
    expect(isMicAuto(sceneId, members)).toBe(false);
    setSilenceGateAuto(true);
    expect(isMicAuto(sceneId, members)).toBe(false);
    setAutoEnabled(sceneId, getSensitivitySpec().key, true);
    expect(isMicAuto(sceneId, members)).toBe(false);
    setAutoEnabled(sceneId, getExpansionSpec().key, true);
    expect(isMicAuto(sceneId, members)).toBe(false);
    setAutoEnabled(sceneId, getSmoothingSpec().key, true);
    expect(isMicAuto(sceneId, members)).toBe(true);
  });

  it("flips back to false the moment any one member is taken back to manual", () => {
    setMicAuto(sceneId, true, members);
    expect(isMicAuto(sceneId, members)).toBe(true);
    setAutoGainAuto(false);
    expect(isMicAuto(sceneId, members)).toBe(false);
    setAutoGainAuto(true);
    expect(isMicAuto(sceneId, members)).toBe(true);
    setAutoEnabled(sceneId, getSmoothingSpec().key, false);
    expect(isMicAuto(sceneId, members)).toBe(false);
  });

  it("is scoped to the scene it's asked about — a different scene's members don't count", () => {
    setAutoGainAuto(true); // device-wide, so this one does carry over
    setSilenceGateAuto(true);
    setAutoEnabled(sceneId, getSensitivitySpec().key, true);
    setAutoEnabled(sceneId, getExpansionSpec().key, true);
    setAutoEnabled(sceneId, getSmoothingSpec().key, true);
    // The pseudo-params default to auto for a scene that's never been
    // touched at all (autoTune.ts's DEFAULT_AUTO_KEYS), so an untouched
    // "some-other-scene" would read as mic-auto regardless of scoping —
    // an explicit manual choice on one of its own rows is what actually
    // proves sceneId's auto choices above didn't leak into it.
    setAutoEnabled("some-other-scene", getSensitivitySpec().key, false);
    expect(isMicAuto(sceneId, members)).toBe(true);
    expect(isMicAuto("some-other-scene", members)).toBe(false);
  });

  it("setMicAuto(sceneId, true, ...) writes every member on", () => {
    setMicAuto(sceneId, true, members);
    expect(isAutoGainAuto()).toBe(true);
    expect(isSilenceGateAuto()).toBe(true);
    expect(isAutoEnabled(sceneId, getSensitivitySpec().key)).toBe(true);
    expect(isAutoEnabled(sceneId, getExpansionSpec().key)).toBe(true);
    expect(isAutoEnabled(sceneId, getSmoothingSpec().key)).toBe(true);
  });

  it("setMicAuto(sceneId, false, ...) writes every member off, regardless of their prior state", () => {
    setAutoGainAuto(true);
    setSilenceGateAuto(false);
    setAutoEnabled(sceneId, getSensitivitySpec().key, true);
    setAutoEnabled(sceneId, getExpansionSpec().key, false);
    setAutoEnabled(sceneId, getSmoothingSpec().key, true);

    setMicAuto(sceneId, false, members);
    expect(isAutoGainAuto()).toBe(false);
    expect(isSilenceGateAuto()).toBe(false);
    expect(isAutoEnabled(sceneId, getSensitivitySpec().key)).toBe(false);
    expect(isAutoEnabled(sceneId, getExpansionSpec().key)).toBe(false);
    expect(isAutoEnabled(sceneId, getSmoothingSpec().key)).toBe(false);
  });
});
