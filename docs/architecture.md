# Architecture

The one thing no single file shows: how a sound in the room becomes a pixel on
screen, and how that pixel ends up on a second device. Everything here is a map of
*relationships between files*. For what any one module actually does, read that
module's header — this doc doesn't restate it.

## Mic to pixel, on one device

`src/audio/capture.ts` opens the mic or, on a desktop host, a shared screen/tab's
audio — a user choice persisted by `src/audio/sourcePref.ts`, surfaced in the start
prompt and the Input card's Source row — and hands back a raw stream.
`src/audio/analyser.ts` runs the FFT and splits it into bands
(`src/audio/bandSplit.ts` / `bandScale.ts` decide the band edges). `src/audio/
features.ts` turns raw bands into a `FeatureFrame` — this is where the adaptive
floor/peak AGC lives, so everything downstream sees a signal already normalized to
the room's own loudness. `src/audio/sensitivity.ts` applies the user's Sensitivity/
Expansion/Smoothing controls on top of that.

Each render tick, `src/render/animClock.ts`'s `createAnimClock` takes the current
`FeatureFrame` and produces one `AnimFrame` — flow phase, phase-locked beat/bar
clock, per-band energy and onset pulses, section intensity, spectral centroid
(`src/render/spectralCentroid.ts`). Scenes never read
`FeatureFrame` fields directly for anything animated; they read `AnimFrame`,
because it's already shaped for motion (see the field comments in `animClock.ts`
for why each one is derived rather than a straight passthrough).

`src/render/sceneHost.ts`'s `SceneHost` owns the actual `mount`/`render`/`unmount`
calls against a `Scene` (`src/render/scene.ts`) — the interface every scene in
`src/render/scenes/` implements. Most scenes are built via `src/render/
fullscreenScene.ts`'s `createFullscreenScene`, which wraps a single fragment
shader body with the common uniform plumbing (`src/render/sceneCommon.ts`) and the
setting → uniform wiring described in `docs/adding-a-scene.md`. `src/render/
autoTune.ts` sits between a scene's declared `settings` and what actually reaches
the shader, resolving each one against `src/render/musicProfile.ts`'s dials unless
the user (or `src/tuning/overrides.ts` in dev) has pinned it manually. A
setting that opts into `SceneSetting.rate` reacts on a chosen beat multiple or
subdivision instead of always the one it was hardcoded to — `src/render/
beatGrid.ts` is the seam between `beatClock.ts`'s free-running beat count and
that per-setting choice.

`src/router.ts` decides which scene mounts (`#/` → gallery, `#/v/<sceneId>` → one
scene), read by `src/app.ts`, which is the phone/controller/gallery entry
(`index.html`).

The controls panel's meters (`src/ui/audioMeters.ts`, under the spectrum card
in `src/ui/deviceMenu.ts`) are the one place that reads outside this pipeline:
their Scope card is fed by `src/audio/waveformAnalyser.ts` (math in
`waveform.ts`), which reads time-domain samples straight off this device's own
mic, entirely separate from
`FeatureFrame`/`AnimFrame` and never touching the wire in "Phone to TV" below —
a viewer with no local mic doesn't get that card at all. Their Signal card's
history trace likewise reads `FeatureExtractor.fixedEnergy`, a local
diagnostic off this device's own extractor (see `src/audio/features.ts`), not a
`FeatureFrame` field. The Loudness card is the same kind of read: BS.1770 LUFS
from `src/audio/lufsAnalyser.ts` (math in `lufs.ts`), a K-weighting chain off
this device's own capture, hidden on a mic-less renderer like the Scope.

`src/render/signals.ts` is the seam between those meters and a scene's own
`settings`: a scene can mark a `SceneSetting` with `reads`, naming which of
this file's `FeatureFrame`/`AnimFrame` values actually drive it, and the
device menu renders that as a live pill pointing back at the meter row above.

## Phone to TV

`src/tv.ts` is the paired-display entry (`tv.html`). The two devices don't share a
process — they share a `FeatureFrame` stream over a WebSocket, relayed through a
Cloudflare Durable Object.

- `src/net/protocol.ts` encodes/decodes `FeatureFrame` to/from a fixed-size binary
  frame. Read its header comment before touching the wire format — it documents
  the current layout and a legacy-decode fallback with its own sunset condition.
- `server/room.ts` (the Durable Object, class `Room`, bound as `ROOM` per
  `wrangler.toml`) relays frames between whichever device is host and whichever
  are renderers. It never parses a `FeatureFrame` — bytes pass through untouched,
  so protocol changes on the client side don't require a worker deploy.
- `src/net/room.ts` (client side) is where the phone/TV split becomes concrete:
  `RENDER_DELAY_MS` and the jitter/slew machinery (`src/net/jitterBuffer.ts`,
  `src/net/slewLimiter.ts`) exist so a renderer's `uTime` moves smoothly even
  when packets don't arrive smoothly. `src/net/clock.ts` (`ClockSync`) is what
  lets a renderer interpret a host's `roomTimeMs` as its own local time.

A device that's alone in a room (no pairing) never touches any of this — `src/
app.ts` drives `AnimFrame` straight from its own local `FeatureFrame`s.

## Where the quality/perf ceiling comes from

`src/render/quality.ts` (`detectQuality`) picks a quality preset once at
startup; `src/render/qualityPref.ts` lets the user override it from the Power
card, defaulting to Auto (the detected preset); `src/render/governor.ts` (the
quality governor) can step the effective preset down at runtime under
sustained frame-time pressure, judged against the render-rate cap that `src/
render/framePace.ts` owns — probing that a step down actually helped before
trusting it, so a pace this page doesn't control (a browser energy-saver mode,
an OS refresh-rate cap) can't be mistaken for GPU load. A scene's `minQuality`
(on the `Scene` interface) opts it out of running below a given preset at all.
`src/render/powerMode.ts` is the user-facing override — Energy saving's
Auto/On/Off in the controls panel's Power card (`src/ui/powerCard.ts`) — that
takes the governor out of the loop entirely rather than fighting it.
