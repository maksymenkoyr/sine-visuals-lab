# Audio Visualization

A browser-based, real-time audio visualizer rendered with WebGL2, with a
phone-to-TV pairing mode: point a phone's microphone at a room, and drive a
full-screen visualization on a paired TV over a low-latency WebSocket link.

Nine scenes — caustics, cymatics, ferrofluid, a wireframe mesh dome, moiré,
particles, riso-print halftone, spectrum, and tunnel — each audio-reactive,
with per-scene sensitivity, contrast, and smoothing controls, plus an
auto-tune engine that adapts those controls to the music's own character
(tempo, dynamics, brightness) in real time.

## Quick start

```
npm install
npm run dev          # visualizer + controller, served over HTTPS for mic access
npm run dev:worker    # Cloudflare Worker backend, for phone/TV room pairing
```

`npm run build` produces a static bundle (`tsc -b && vite build`);
`npm run deploy` builds and ships the Worker via Wrangler. Pushing to `main`
does the same automatically — see [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

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

Start at [`CLAUDE.md`](CLAUDE.md) — it routes to everything else:
[`docs/architecture.md`](docs/architecture.md) (how mic input becomes a pixel,
and how it gets to a second device), [`docs/adding-a-scene.md`](docs/adding-a-scene.md),
[`docs/tuning.md`](docs/tuning.md) (the live-tuning workflow), and
[`docs/status.md`](docs/status.md) (what's in flight right now).

## License

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
— see [LICENSE](LICENSE). Copyright © 2026 Yaroslav Maksymenko.

Third-party dependencies bundled into the client build are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
