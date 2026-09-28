# Sine Visuals Lab

A browser-based, real-time audio visualizer rendered with WebGL2: point it at
a microphone or a shared screen and a gallery of scenes follows the beat,
tempo and tone of the music. (An experimental mode also pairs a phone with a
second screen over a WebSocket link.)

A gallery of audio-reactive scenes, each with per-scene sensitivity, contrast,
and smoothing controls, plus an auto-tune engine that adapts those controls to
the music's own character in real time. Scenes absent from `DRAFT_SCENE_IDS`
(in `src/render/scenes/index.ts`) are featured; the rest sit behind the
gallery's draft toggle.

## Quick start

```
npm install
npm run dev          # visualizer + controller, served over HTTPS for mic access
npm run dev:worker    # Cloudflare Worker backend, for phone/TV room pairing
```

`npm run build` produces a static bundle (`tsc -b && vite build`). Two
deployed channels: pushing to `main` ships the **Insider** channel
(insider.sinevisualslab.com) automatically, on every push — see
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The **Stable**
channel (sinevisualslab.com — also what a local `npm run deploy` ships to)
only updates when `main` is merged into the `production` branch
(`npm run release` opens that pull request; merge it with a merge commit) —
see [`.github/workflows/release.yml`](.github/workflows/release.yml) and
`src/version.ts`. Every merge to `main` bumps the patch version, every release
bumps the minor, and the major is set by hand in `package.json`. Every open pull request also gets its own throwaway preview
Worker (URL posted as a comment on the PR).

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

[`AGENTS.md`](AGENTS.md) carries the working rules ([`CLAUDE.md`](CLAUDE.md)
imports them for Claude Code); [`docs/index.md`](docs/index.md)
is the documentation map.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require agreeing to the
Contributor License Agreement in [CLA.md](CLA.md) — the why and how are
explained there.

## Privacy

Audio — from the microphone or a shared tab — is processed entirely on your
device and never transmitted; see [PRIVACY.md](PRIVACY.md) for the full
statement, including what pairing sends and what the host sees.

## License

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
— see [LICENSE](LICENSE). Copyright © 2026 Yaroslav Maksymenko.

Third-party dependencies bundled into the client build are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The AGPL license grants no trademark rights (see AGPL-3.0 §7(e)): the Sine
Visuals Lab name and logo are trademarks of Yaroslav Maksymenko, so modified
versions and forks — welcome under the license — must ship under their own
name.
