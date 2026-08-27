# Audio Visualization

A browser-based, real-time audio visualizer rendered with WebGL2, with a
phone-to-TV pairing mode: point a phone's microphone at a room, and drive a
full-screen visualization on a paired TV over a low-latency WebSocket link.

A gallery of audio-reactive scenes, each with per-scene sensitivity, contrast,
and smoothing controls, plus an auto-tune engine that adapts those controls to
the music's own character in real time. Caustics and Mesh Grid are featured;
the rest sit behind the gallery's draft toggle (`DRAFT_SCENE_IDS` in
`src/render/scenes/index.ts`).

## Quick start

```
npm install
npm run dev          # visualizer + controller, served over HTTPS for mic access
npm run dev:worker    # Cloudflare Worker backend, for phone/TV room pairing
```

`npm run build` produces a static bundle (`tsc -b && vite build`);
`npm run deploy` ships the Worker via Wrangler.

## Architecture

- `src/audio/` — mic capture, FFT band extraction, sensitivity/contrast shaping.
- `src/render/` — the WebGL2 scenes, auto-tune engine, and shared render pipeline.
- `src/net/` — clock sync, jitter buffering, and the room protocol for phone→TV pairing.
- `src/ui/` — control panel, device picker, QR-code pairing screen.
- `server/` — the Cloudflare Worker + Durable Object that brokers pairing rooms.
- `src/tuning/` + `tools/` — a live tuning workflow (param bus, numeric probe,
  contact-sheet capture) for dialing in per-scene defaults against real audio.

Two entry points: `index.html` (the phone/controller view) and `tv.html`
(the paired display).

## Documentation

[`CLAUDE.md`](CLAUDE.md) carries the working rules; [`docs/index.md`](docs/index.md)
is the documentation map.

## License

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
— see [LICENSE](LICENSE). Copyright © 2026 Yaroslav Maksymenko.

Third-party dependencies bundled into the client build are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
