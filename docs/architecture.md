# Architecture

The one thing no single file shows: how a sound in the room becomes a pixel on
screen, and how that pixel ends up on a second device. Everything here is a map of
*relationships between files*. For what any one module actually does, read that
module's header — this doc doesn't restate it.

## Mic to pixel, on one device

`src/audio/capture.ts` opens the mic or, on a desktop host, a shared screen/tab's
audio — a user choice persisted by `src/audio/sourcePref.ts`, surfaced in the start
prompt and the Input card's Source row, where `src/audio/inputDevice.ts` also picks
which input device the mic means (e.g. a USB interface fed from a DJ mixer) — and
hands back a raw stream.
`src/audio/analyser.ts` runs the FFT and splits it into bands
(`src/audio/bandSplit.ts` / `bandScale.ts` decide the band edges). `src/audio/
features.ts` turns raw bands into a `FeatureFrame` — this is where the adaptive
floor/peak AGC lives, so everything downstream sees a signal already normalized to
the room's own loudness. That same adaptive shape is why `src/audio/
silenceGate.ts` exists: its two marks weight `features.ts`'s own broadband onset,
and (via `src/render/animClock.ts`) `src/render/bandEnergy.ts`'s per-band onsets,
against `FeatureFrame.level` — the one absolute-loudness reading in the pipeline —
so a quiet room's own hiss can't fire on its own. Both marks can also be handed
to an auto mode (on by default) that tracks the room's own quiet level instead
of a manual drag, fed each tick by `feedSilenceGateMeasurement` — mirroring
`src/audio/autoGain.ts`'s own auto flag rather than resolving through
`musicProfile.ts`'s dials. `src/audio/sensitivity.ts` applies the user's
Sensitivity/Expansion/Smoothing controls on top of that.

Each render tick, `src/render/animClock.ts`'s `createAnimClock` takes the current
`FeatureFrame` and produces one `AnimFrame` — flow phase, phase-locked beat/bar
clock (`src/render/beatClock.ts`), the always-evenly-spaced metronome built on
top of it (`src/render/metronome.ts`), per-band energy and onset pulses, section
intensity, spectral centroid (`src/render/spectralCentroid.ts`). Scenes never read
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
the user (or `src/tuning/overrides.ts` in dev) has pinned it manually.

`src/router.ts` decides which scene mounts (`#/` → gallery, `#/v/<sceneId>` → one
scene), read by `src/app.ts`, which is the laptop/phone/gallery entry
(`index.html`).

The controls panel's meters (`src/ui/audioMeters.ts`, under the spectrum card
in `src/ui/deviceMenu.ts`) are the one place that reads outside this pipeline:
their Dynamics card's Waveform row is fed by `src/audio/waveformAnalyser.ts`
(math in `waveform.ts`), which reads time-domain samples straight off this
device's own mic, entirely separate from
`FeatureFrame`/`AnimFrame` and never touching the wire in "Laptop, phone and TV" below —
a viewer with no local mic doesn't get that row at all. The same card's
History trace likewise reads `FeatureExtractor.fixedEnergy`, a local
diagnostic off this device's own extractor (see `src/audio/features.ts`), not a
`FeatureFrame` field — its own Gate row right after it reads
that same extractor's `gateDimmer` diagnostic the same way. Its Loudness row
is the same kind of read: BS.1770 LUFS
from `src/audio/lufsAnalyser.ts` (math in `lufs.ts`), a K-weighting chain off
this device's own capture, hidden on a mic-less renderer like the Waveform row.

`src/render/signals.ts` is the seam between those meters and a scene's own
`settings`: a scene can mark a `SceneSetting` with `reads`, naming which of
this file's `FeatureFrame`/`AnimFrame` values actually drive it, and the
device menu renders that as a live pill pointing back at the meter row above.

## Laptop, phone and TV

A room's devices don't share a process; they share a WebSocket, relayed through a
Cloudflare Durable Object, and each has a role (`RoomRole`: host, controller or
renderer). The laptop is the **host**: it listens, runs everything in the first
section, and streams its `FeatureFrame`s (`HostConnection`). A phone is a
**controller**: `src/app.ts` in its mic-less renderer mode, with the whole panel
(`ControllerConnection`); what it edits becomes the room's *look*. A TV is a
**renderer** (`src/tv.ts`, `tv.html`): it draws the host's frames with the room's
look and has no panel or audio of its own.

- `src/net/protocol.ts` encodes/decodes `FeatureFrame` to/from a fixed-size binary
  frame. Read its header comment before touching the wire format — it documents
  the current layout and a legacy-decode fallback with its own sunset condition.
- `server/room.ts` (the Durable Object, class `Room`, bound as `ROOM` per
  `wrangler.toml`) is only the Cloudflare adapter. What a room does is
  `server/roomCore.ts`, which the tests drive with fake sockets; who may join and
  who may send what is `server/roomRules.ts`. The room still never parses a
  `FeatureFrame` — bytes pass through untouched — so a frame change within
  `LOOK_LIMITS.maxBinaryBytes` (`server/lookDoc.ts`) needs no worker deploy; the
  room drops a frame longer than that cap, so a layout that outgrows it needs the
  cap raised and the worker deployed too. A change to the JSON messages or to the
  rules always does, because the room validates those.
- `server/lookDoc.ts` is the look: a scene id, a palette id and the raw text of
  every localStorage store that changes how a scene looks. Which keys count is
  `isRoomKey` in `src/net/syncedStores.ts`; the room never interprets a setting.
  A claimed room keeps its look (and the hashes of its keys), so a TV that joins
  late or reconnects gets the current state without asking the phone.
- `src/net/lookSync.ts` keeps a device and the room's look in step: the phone's
  publisher (patches, acks, the merge after a reconnect) and the TV's replica. A
  phone and a TV also install `src/net/roomStorage.ts`'s overlay first, so
  applying a room's look never overwrites the device's own saved settings.
- `src/net/roomMessages.ts` is the JSON vocabulary spoken beside the frames.
- `src/net/room.ts` (client side) holds a connection class per role, with
  `src/net/reconnect.ts` for the ones that rejoin on their own. `RENDER_DELAY_MS`
  and the jitter/slew machinery (`src/net/jitterBuffer.ts`,
  `src/net/slewLimiter.ts`) exist so a renderer's `uTime` moves smoothly even
  when packets don't arrive smoothly. `src/net/clock.ts` (`ClockSync`) is what
  lets a renderer interpret a host's `roomTimeMs` as its own local time.

Pairing is done by scanning QR codes, or by typing the code a waiting TV shows
into the laptop's room view. The laptop shows a QR that makes a phone its
controller (`src/net/hostRoom.ts` keeps the laptop's room across reloads); the TV
shows its own, and the phone that scans it tells the TV which room to join
(`src/net/adopt.ts`, `src/net/pendingSlot.ts`, `src/net/tvPhase.ts`) — the request
is delivered only to the waiting screen that holds the QR's nonce. Either side can
start over: the TV's Reset forgets its room, and the laptop's Reset room ends the
room for every device (`endRoom` in `src/net/roomMessages.ts`) before opening a new
one. `src/net/bootPlan.ts` decides what a page's URL means, `src/net/sessions.ts`
keeps the secrets a rejoin needs, and `src/ui/joinScreen.ts` draws the QR and the
code field.

Not everything travels. What stays on the laptop — its audio input and its own
auto-tracked analysis marks — is named by `PRIVATE_KEYS` and `VOLATILE_PREFIXES`
in `syncedStores.ts` (`isRoomKey` there is the question of what joins the look),
and the TV resolves Sensitivity, Expansion and Smoothing itself from the frames,
so its Auto readouts are its own.

A device that's alone in a room (no pairing) never touches any of this — `src/
app.ts` drives `AnimFrame` straight from its own local `FeatureFrame`s.

## Pop-out output window

The same-machine cousin of the TV: `output.html` → `src/output.ts`, a chrome-free
second window fed by the main window over a BroadcastChannel instead of the room
socket, with Cue/Play to hold or send what it shows. Everything about it — why
`tv.ts` itself couldn't be reused, the message layer, what crosses — is the header
of `src/net/outputSync.ts`; `src/net/outputBridge.ts` is the main window's end.
The keys and the hold-to-glide gesture are the header of `src/ui/outputKeys.ts`;
what a glide may and may not move smoothly is the header of `src/net/outputGlide.ts`.
While an output is open the main window renders only a cheap preview (its own
Quality and Resolution, in a smaller box), and the output has its own Quality,
Resolution and Energy saving, set from the Output Power card;
`src/render/outputPower.ts` owns those settings.

The Record button (bottom right) saves a clip of the picture with the sound: it
records the output's canvas while a pop-out is open, because the main window
shows only the preview then. Why and how is the header of `src/ui/clipRecorder.ts`.

## Where the quality/perf ceiling comes from

`src/render/quality.ts` (`detectQuality`) picks a quality preset once at
startup; `src/render/qualityPref.ts` lets the user override it from the Power
card — `QUALITY_CHOICE_DEFAULT` in that file decides what a fresh device
starts on, Auto being the choice that instead follows the detected preset;
`src/render/governor.ts` (the quality governor) can step the effective preset
down at runtime under sustained frame-time pressure, judged against the
render-rate cap that `src/render/framePace.ts` owns — probing that a step
down actually helped before trusting it, so a pace this page doesn't control
(a browser energy-saver mode, an OS refresh-rate cap) can't be mistaken for
GPU load. A scene's `minQuality` (on the `Scene` interface) opts it out of
running below a given preset at all. `src/render/powerMode.ts` is the
user-facing override — Energy saving's Auto/On/Off in the controls panel's
Power card (`src/ui/powerCard.ts`) — that takes the governor out of the loop
entirely rather than fighting it; `POWER_MODE_DEFAULT` in that file decides
whether the governor is in the loop at all on a fresh device.
