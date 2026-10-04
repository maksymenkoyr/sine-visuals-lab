---
description: Make the app showcase promo — mic/screen intro, scenes cut to the user's songs, deep-customisation wiring, song shuffle, end card — in 9:16 and 16:9
---

Make the showcase promo video: what the app is and what it can do, cut to songs the user picks (not a
release changelog — that is `/release-promo`). The agreed shape is the **Scenario** below: the user's calls
over ten rounds on the 2026-10-04 video, with what they turned down. **Don't redesign it** — change only
what the user asks for, change it narrowly (one round added shots nobody asked for and was "further from
what I wanted"), and record each new call in the Scenario with what it replaced.

The machinery: the recorder `tools/promo/capture.mjs` (read its header) with the shot scripts in
`tools/promo/shots/`, and the editor in `tools/promo/showcase/` (read the header of `edit.py`). One config,
`showcase.json` in the work dir (`tools/.cache/showcase/`, gitignored), holds every per-video choice —
copy `tools/promo/showcase/showcase.example.json` to start.

## Inputs

- **Songs** — the user names them. Download/convert them into the work dir (`yt-dlp` via `uvx`, bestaudio
  m4a; then 48 kHz mono s16 loudness-normalised for the recorder's fake mic and 48 kHz stereo for the mix).
  Say once that commercial songs will get the post muted or claimed; offer the silent master + cue sheet
  for adding licensed music in the platform's editor. Never commit songs, clips or recordings.
- **Two screen recordings from the user** (Cmd+Shift+5, Chrome, live site): (1) Mic → Chrome's mic prompt →
  Allow, then Share a tab → picker → Window → a music window → app audio on → Share with audio; (2) the
  gallery, the pointer moving to a scene tile, the click, the scene running. Chrome's own prompts can't
  be captured headlessly, and clicking a permission prompt by synthesized input is blocked — ask the user
  to record; don't try to drive their screen. No "show mouse clicks" markers ("too ugly").
- **Looks** for each scene shot — the user's share codes, or explore extremes (Random rolls, Master Scale
  and Expansion pushed up) and show contact sheets to pick from.

## Scenario (v10, ~39 s, both 9:16 and 16:9, true 60 fps, every cut on a beat)

1. **Use mic. / Or share screen.** (from recording 1) — one continuous shot per input: on the button, then
   one smooth glide (smootherstep, ~0.9 s, a soft pull-back swell mid-way, never a stop) to Chrome's prompt,
   an eased slow-motion (to ~0.3×, +0.5 s, motion-interpolated) around the final click. Fast-forward the
   dull part (choosing the window) only after the camera has arrived. *Rejected*: hard cuts button → prompt;
   freezes before the click; a black "or" title card ("or" rides on the share shot's caption); extra
   LISTENING shots.
2. **No install. Right in the browser.** (from recording 2) — wide on the whole page with the user's real
   pointer visible, then zoom in following the tracked pointer to the tile; the scene opens at that zoom
   and eases out (pointer erased there). Crop away browser chrome, Chrome's sharing bar, the room badge,
   the scene toolbar's ROOM button and the status line. *Rejected*: a synthetic white tap dot; "Tap a scene.
   It's running."
3. **The drop** — the bed song's drop lands on the first scene; one-bar then half-bar cuts across the
   showcase scenes, each shot recorded with its own song as the fake mic (real reactions).
4. **Deep customisation** / *Wire any signal to any setting* — one wire built in full on the current
   panel: pin a setting's port, wire a signal jack (the cable shows), drag the wire's strength, threshold on
   and up, then 2–3 scene settings with big visible effects (Beat ripple, Ring style, Fog). Sliders ~1.3 s
   each ("50% faster" than 2 s), short pauses so each response shows. Every monitor card open the whole
   time. Horizontal is captured at 1.5× (`--zoom 1.5`, 2880×1620) and the camera pushes into the wiring
   box, the monitors, the scene settings, and pulls back wide; vertical cuts on beats between the monitor
   column take (L) and the settings column take (R). *Rejected*: many quick actions ("chaotic"), a dead
   last move that changes nothing, hiding monitors.
5. **Any song. Any scene.** — six ~1.2 s shots, each swapping song AND scene, each starting on a strong
   bass hit of its song.
6. **End card** — logo + sinevisualslab.com, 4.3 s, the last song at full level to the last frame (no fade).

Text: the system font (SF Pro), sentence case, on a dark translucent box, placed where it covers no action
(horizontal share caption top right). *Rejected*: Chakra Petch / Share Tech Mono ("I hate it").

## Rules that cost a round each

- **Record from current `origin/main`** — rebase the capture branch and re-check right before every capture
  batch; v1–v7 were recorded 69 commits behind and the user called the panel "super old".
- Looks are code-dependent: after main changes, compare 3 stills per scene shot with the intended look and
  report what no longer reproduces (on 2026-10-04 Chladni's `settle` key was gone and Physarum P09 washed
  out) — don't silently invent a replacement.
- Never show phone→TV pairing: hide `#roomCode`, the ROOM button, `host (XXXX)` status.
- Other windows in Chrome's share picker are blurred.
- One capture at a time; another headless browser or a heavy encode on the machine drops frames.

## Steps

All from the repo root; `CFG` = `tools/.cache/showcase/showcase.json`. Python runs through `uv` (Homebrew
ffmpeg is broken here; the scripts use imageio-ffmpeg). Outputs land in the work dir.

1. **Songs** into the work dir; fill `songs`, `bed` (bpm, drop time — find the drop from the bass energy,
   not the coarse beat tracker), `shuffle` (each shot's start on a strong bass hit).
2. **Scene shots**, one per (look, song, window), both sizes, against a dev server of current main
   (`window.__viz` exists only there): `tools/promo/shots/scene-look.mjs` through `capture.mjs`
   (`PROMO_LOOKS` / `PROMO_LABEL` / `PROMO_SCENE` / `PROMO_LEAD`; ~18 s lead for Physarum 2, Fresh dish).
   Put them in `clips.dir`, windows in `clips.windows`.
3. **Wiring takes** (`tools/promo/shots/seg4d.mjs`, its header has the three commands: h at 2880×1620
   `--zoom 1.5`, vertical `--keys L` and `--keys R`), against the clean build (`tools/promo/build-clean.mjs`,
   `vite preview` on 4173). Aim `camera.views` / `camera.keys` from the take's `BOX` and `mark` log lines.
4. **The user's recordings**: set `intro` (source times, camera points, click times, blur boxes for other
   windows in the share picker) and `gallery` (crop boxes, ranges, tracking template frames) by looking at
   frames, then:
   ```
   uv run -q --with imageio-ffmpeg --with opencv-python-headless --with scipy --with numpy python tools/promo/showcase/track_pointer.py CFG
   uv run -q --with pillow --with imageio-ffmpeg python tools/promo/showcase/intro.py CFG v   # and h
   uv run -q --with imageio-ffmpeg --with opencv-python-headless --with scipy --with numpy python tools/promo/showcase/gallery.py CFG
   uv run -q --with pillow --with imageio-ffmpeg python tools/promo/showcase/camera.py CFG
   node tools/promo/showcase/captions.mjs CFG
   uv run -q --with imageio-ffmpeg --with pyloudnorm --with soundfile python tools/promo/showcase/edit.py CFG v   # and h
   ```
5. **Checks** (`uv run -q --with imageio-ffmpeg --with numpy --with pillow python tools/promo/showcase/check.py CFG …`):
   `sync v|h`, `repeats v|h`, `strip <video> <t1,t2,…> <height> <cols> <out.png>`.

## Checks before showing the user

- `check.py sync` — every scene shot's audio matches the bed (offset under one frame; was 5–7 ms).
- `check.py repeats` — repeated-frame share per shot (consecutive mean abs diff < 0.05 at 160×90 gray):
  aim < 5%; the app's scene-open hitch and the 1.5× take run a little higher.
- `check.py strip` — look at frames across every segment in both formats (captions covering an action,
  UI that shouldn't be there, washed-out looks).

## Deliver

`~/Movies/sine-visuals-lab-showcase-<date>/`: `promo-{v,h}-with-music.mp4` (master),
`*-with-music-share.mp4` (CRF 21), `*-silent.mp4`, `preview-{v,h}-720.mp4` (send these — the send limit is
30 MB), `CUES.md` (shot, text, song and song time per cut), earlier versions in `vN/`.
