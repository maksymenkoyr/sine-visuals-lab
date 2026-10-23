# The audio subsystem

`audio-subsystem/` is the code that turns sound into numbers, kept as one
folder that lifts out whole: capture and input choice, the analyser and the
feature frame it fills (`audio-subsystem/src/types.ts`), the per-band and per-scene gain
stores, the silence gate, hit strength, loudness, the tempo tracker (the
AudioWorklet analyser, `beatClock.ts`, `tempoSettle.ts`, `metronome.ts`) and
the synthetic feed. Its tests are in `audio-subsystem/tests/`;
`tests/tempoEval.test.ts` stays with the app's tests, since it also drives
render code.

## The boundary

The app imports the subsystem; the subsystem imports nothing from the app.
`rules/audio-subsystem-self-contained.yml` fails `npm run check` on an import
that climbs out of the folder. Code that also reads the picture's clock or
settings stays in the app and imports from here: `src/render/beatListener.ts`,
`musicProfile.ts`, `tapTempo.ts` and the drives, for example.

What it needs from its host comes in two ways:

- **Store reloads.** The settings stores keep in-memory caches seeded once
  from localStorage. A host that rewrites their keys from outside calls
  `reloadAudioStores()` (`audio-subsystem/src/storeReload.ts`). Here
  `src/net/syncedStores.ts`'s `reloadSyncedStores()` does, so the pop-out
  output and a room's TV re-seed them along with every other store.
- **The tempo worklet's URL.** `createTempoSource()` takes a function that
  resolves to it. `src/app.ts` builds `tempoWorklet.ts` with Vite's
  `?worker&url` and pins it (the `src/pinnedAssets.ts` header says why); the
  size check in `tools/check.mjs` finds that pin there.

`micAuto.ts` is generic over the setting it toggles: it reads only `key`, so
the app's `SceneSetting` passes through without the subsystem knowing it.

## What it still assumes

A browser (Web Audio, `localStorage`, `navigator.mediaDevices`), Vite
(`import.meta.env`), and the app's `vibe.*` localStorage key names. Using it
in another project means bringing those along or replacing them.

## Importing it

By relative path, `../audio-subsystem/src/features.ts` from `src/`. There is
no alias, so tsc, Vite, vitest and the Node tools resolve it with no config.
It isn't an npm workspace either: a worktree's `node_modules` is a symlink to
the main checkout's, so a workspace link would hand every worktree the main
checkout's copy.
