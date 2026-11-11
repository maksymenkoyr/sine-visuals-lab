# Oil Drops — scripts

The scripts the oil-droplet clips were measured with for issue #824 (the
numbers in `docs/scenes/oildrops.md`, Measurements), plus the scene's own
sign-off scripts. The reference video itself is never in this repo (the
record's Materials section says where it lives).

Run a Python script with:

    uv run -q --with numpy --with opencv-python-headless --with scipy --with scikit-image python -I <script> ...

Paths inside the Python scripts are absolute to the session's work folder
that wrote them (`…/tmp/oil/`); point `ROOT`/`sys.path` lines at your own
copy of the downloaded slice and detections before use.

| script | what it does |
|---|---|
| `cuts.py` | frame-accurate cuts in the slice |
| `repeat.py` | is one clip the same footage as another (correlation over time shifts) |
| `drops.py` | per-colour masks (candidates for `circles.py`) |
| `circles.py` | finds drops as circles, kept only when real edges support the rim |
| `see2.py` | one frame through the detector, with an overlay to check by eye |
| `run.py` | detection over a time window at 5 fps, in parallel; `runall.sh` lists the windows |
| `analyze.py` | links circles into tracks; counts, sizes, motion, contacts, nesting, merges |
| `profile.py` | brightness across a drop: rim, ring, highlight, shadow, per colour family |
| `bysize.py` | shading against drop radius |
| `flow.py` | paint flow between the drops, and whether drops ride it |
| `field.py` | fits a translation, a slide-turn-spread and an affine flow to the tracks |
| `continuity.py` | do two windows show one continuing take |
| `merges.py` | before/after crops of merge candidates |
| `vanish.py` | before/after crops of drops that vanish away from the frame edge |
| `assets.py`, `assets_pal.py`, `pagedata.py`, `sketch.py`, `grab.py` | the study page's sheets, palettes, numbers, sketches and full-resolution frames |
| `stats.mts` | our population's own numbers from the simulation under node (count, cover, radii, touching, nesting, speed): `node --experimental-strip-types stats.mts` |
| `shot.mjs` | stills of the scene headlessly on the Metal GPU, with console errors: `node shot.mjs <outPrefix> --repo <checkout> --port P [--settings JSON]` |
| `automodes.mjs` | the Auto sign-off (every setting `manual` fresh, the weighted ones `auto` after): `node automodes.mjs --repo <checkout> --port P --scene oildrops` |
