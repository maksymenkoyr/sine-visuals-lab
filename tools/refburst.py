"""
refburst: the *temporal* half of the reference picture — see what happens
between the frames tools/ref-scan.py measures at VIS_FPS, without paying
one image per frame. ref-scan.py calls it once per bundle and writes

    slitscan.png     the whole clip at the decode rate in one image: fixed
                     pixel lines from every frame, stacked left to right
                     (x = time). Lanes: the centre row, a ring at r = 0.5
                     unrolled by angle, a spoke from the centre to the top
                     edge. Strobes, pulses, zoom and spin read as texture
                     at frame resolution; a hard cut is a vertical seam,
                     a fade a soft one.
    bursts/<t0>/     a "burst": one short window decoded at every source
                     frame (BURST_S at BURST_FPS, BURST_PIXELS per frame,
                     more than the scan's budget) around a moment the data
                     chose — a strobe, a transition, a phrase start.
        timing.png   every frame of the window on one sheet, cuts marked
                     (a run of change frames is a *cut* only when one
                     frame carries CUT_SHARE of it, else a *fade* — the
                     report counts both): answers when / in what order /
                     how many frames. The
                     window is BURST_S long; MOTION_WIN frames each side of
                     the first cut feed the projections.
        detail.png   DETAIL_TILES frames of the same window, large: the
                     frame after each cut first, then an even stride:
                     answers what it looks like mid-transition.
        motion.png   three tiles: max-projection (moving lights become
                     paths: spin and zoom direction), mean-projection
                     (the static skeleton), and t-1/t/t+1 in R/G/B at
                     the window's central event (grey = still, colour
                     fringes = motion, their side = direction).
    report.md        "## Bursts": one line per burst, numbers first —
                     hard cuts at BURST_FPS, fades and their spans, hold
                     lengths, brightness range — so a burst is opened for
                     a reason. And a CUTS / NO HARD CUTS finding from the
                     whole decode.

Why bursts are placed by data, not by a fixed interval: the scan already
knows where the picture changes (transitions, strobes) and where the music
would make it change (phrase starts); a burst there is worth ten at random
times. place_bursts() merges overlapping windows and keeps at most
BURSTS_MAX by priority — strobes, then the strongest transitions, then
phrase starts (or a fixed interval when the clip is silent and the beat
grid is invented). `ref-scan.py <bundle> --burst T[,DUR]` adds one more
where a finding points at a time no default burst covered.

Why every sheet is packed to SHEET_PIXELS / SHEET_BOX: an image costs
about one token per 750 pixels and is scaled down first when it exceeds
either the long-edge or the area limit, so a sheet taller than the box
pays the full price for pixels the reader never gets. pack_grid() picks
the largest tile that keeps a sheet inside both limits; the rank sheets
and key-frame sheet in ref-scan.py use it too.

Hard cuts: a frame whose colour histogram (HIST_BINS per channel, on a
shrunken frame) moves by at least CUT_HIST in L1 from the previous frame.
A histogram ignores motion — a zoom or a spin of the same picture keeps
its colours — and sees a cut, a flash or a hue flip, which is what a hard
change is here. No smoothing and no local-maximum rule: two consecutive
cuts are two cuts (a one-frame flash is A→B→A), so holds are stated to
one frame at the burst's frame rate. Pixel differencing was tried and
rejected — on neon over black most pixels never change, so it missed the
one-frame hue flashes.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from reflook import decode_at, luminance

SHEET_BOX = 1568  # long edge, px — beyond this the reader gets a scaled copy
SHEET_PIXELS = 1_150_000  # area budget, px — same reason
BURST_S = 3.0  # window length, s
BURST_FPS = 30
BURST_PIXELS = 640 * 360  # decode budget per burst frame
BURSTS_MAX = 8  # default bursts per scan; more via --burst
SILENT_BURST_EVERY_S = 10.0  # cadence when there is no audio to place them by
BURST_OVERLAP = 0.5  # windows overlapping by more than this share of BURST_S merge
DETAIL_TILES = 16
HIST_BINS = 4  # per RGB channel → 64 colour bins, as ref-scan.py's cut metric
CUT_HIST = 0.2  # L1 histogram distance (0..2) from the previous frame that counts as a change frame
CUT_SHARE = 0.6  # a run of change frames is a hard cut only when one frame carries this share of the run's change; otherwise it is a fade
DARK_LUM = 0.08  # a cut whose brighter side stays under this mean luminance is a change in the dark: the eye never sees a seam
CUT_PIX = 0.1  # mean |pixel change| (0..1) a cut frame must reach: the histogram distance exaggerates a dark-to-lit step, the first frame of a strobe ramp
MOTION_WIN = 15  # frames each side of the event for the max / mean projections (1 s at 30 fps)
TILE_PAD = 3
LINE_H = 14  # label line height, px
SLIT_LANES = (("centre row (x across)", 200), ("ring r=0.5 (angle 0..360)", 180), ("spoke centre>top edge", 135))
BG = (16, 16, 20)


def font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


# ---- cuts --------------------------------------------------------------------------


def colour_change(frames: np.ndarray, step: int = 4) -> np.ndarray:
    """L1 distance of each frame's colour histogram from the previous one's (d[0] = 0)."""
    n = len(frames)
    q = (frames[:, ::step, ::step, :].astype(np.int64) * HIST_BINS) // 256
    bins = (q[..., 0] * HIST_BINS * HIST_BINS + q[..., 1] * HIST_BINS + q[..., 2]).reshape(n, -1)
    h = np.stack([np.bincount(b, minlength=HIST_BINS ** 3) for b in bins]).astype(np.float64)
    h /= h.sum(axis=1, keepdims=True) + 1e-9
    d = np.zeros(n)
    if n > 1:
        d[1:] = np.abs(np.diff(h, axis=0)).sum(axis=1)
    return d


def pixel_change(frames: np.ndarray) -> np.ndarray:
    """Mean absolute pixel change of each frame from the previous one (p[0] = 0), on a coarse grid."""
    small = frames[:, ::8, ::8, :].astype(np.float32) / 255
    p = np.zeros(len(frames))
    if len(frames) > 1:
        p[1:] = np.abs(np.diff(small, axis=0)).mean(axis=(1, 2, 3))
    return p


def find_events(d: np.ndarray, lum: np.ndarray | None = None, pix: np.ndarray | None = None) -> list[dict]:
    """Runs of consecutive change frames (d >= CUT_HIST), each a cut or a fade.

    A fast fade crosses the threshold on every frame it spans, so counting
    frames counted a three-frame fade as three cuts (the VJ-loop misread of
    2026-09-08: a source with no cut at all reported 24). A run is a hard cut
    only when a single frame carries CUT_SHARE of its change; `at` is that
    frame for a cut, the run's first frame for a fade; `span` is in frames.
    With `lum` (mean luminance per frame) a cut whose brighter neighbour stays
    under DARK_LUM is flagged `dark` instead: a VJ loop cuts in the black and
    fades the next picture up, which reads as a morph, not a seam. With `pix`
    (mean pixel change per frame) a cut frame must also move CUT_PIX of the
    picture, or it is the first frame of a fade."""
    hot = np.where(d >= CUT_HIST)[0]
    hot = hot[hot > 0]
    events = []
    i = 0
    while i < len(hot):
        j = i
        while j + 1 < len(hot) and hot[j + 1] - hot[j] <= 1:
            j += 1
        a, b = int(hot[i]), int(hot[j])
        seg = d[a:b + 1]
        share = float(seg.max() / (seg.sum() + 1e-9))
        at = a + int(np.argmax(seg))
        cut = b == a or share >= CUT_SHARE
        if cut and pix is not None and float(pix[at]) < CUT_PIX:
            cut = False
        dark = bool(cut and lum is not None and float(lum[max(0, a - 2):b + 3].max()) < DARK_LUM)
        events.append({"at": at if cut else a, "start": a, "span": b - a + 1, "share": round(share, 3),
                       "cut": cut and not dark, "dark": dark})
        i = j + 1
    return events


def find_cuts(d: np.ndarray, lum: np.ndarray | None = None, pix: np.ndarray | None = None) -> list[int]:
    return [e["at"] for e in find_events(d, lum, pix) if e["cut"]]


def fade_stats(d: np.ndarray, lum: np.ndarray | None = None, pix: np.ndarray | None = None) -> dict:
    """Counts of the non-cut events: fades and their spans, changes in the dark."""
    ev = find_events(d, lum, pix)
    spans = [e["span"] for e in ev if not e["cut"] and not e["dark"]]
    return {"fades": len(spans), "fadeMinFr": min(spans) if spans else None, "fadeMedFr": int(np.median(spans)) if spans else None,
            "fadeMaxFr": max(spans) if spans else None, "darkChanges": sum(1 for e in ev if e["dark"])}


def mean_lum(frames: np.ndarray) -> np.ndarray:
    return luminance(frames[:, ::4, ::4]).mean(axis=(1, 2))


def holds_ms(cuts: list[int], fps: float) -> list[int]:
    return [int(round((b - a) * 1000 / fps)) for a, b in zip(cuts, cuts[1:])]


def cut_summary(frames: np.ndarray, fps: float) -> dict:
    """The CUTS finding for the whole decode: how many, the densest second, hold lengths."""
    d = colour_change(frames)
    lum = mean_lum(frames)
    pix = pixel_change(frames)
    cuts = find_cuts(d, lum, pix)
    per_sec = np.bincount([int(c / fps) for c in cuts], minlength=int(len(frames) / fps) + 1) if cuts else np.zeros(1, dtype=int)
    hold = holds_ms(cuts, fps)
    return {
        "fps": fps, "n": len(cuts), "t": [round(c / fps, 3) for c in cuts], **fade_stats(d, lum, pix),
        "perSecMax": int(per_sec.max()), "perSecMaxT": float(int(np.argmax(per_sec))),
        "holdMinMs": min(hold) if hold else None, "holdMedMs": int(np.median(hold)) if hold else None, "holdMaxMs": max(hold) if hold else None,
    }


def cut_line(c: dict | None, dur: float, vis_fps: float) -> str | None:
    if not c:
        return None
    fades = fade_line(c)
    if c["n"] == 0:
        return (f"NO HARD CUTS at {c['fps']:g} fps in {dur:.0f} s{fades}: every transition below is a fade or a motion"
                " — build it with envelopes and travel, never a switch")
    hold = (f"holds between cuts {c['holdMinMs']}–{c['holdMaxMs']} ms (median {c['holdMedMs']})" if c["holdMedMs"] is not None else "one cut")
    return (f"CUTS at {c['fps']:g} fps: {c['n']} hard cuts in {dur:.0f} s, densest second {c['perSecMax']} cuts at {c['perSecMaxT']:.0f}s; {hold}{fades}"
            f" — the transition list below is measured at {vis_fps:g} fps and merges anything closer than that; the bursts resolve them")


def fade_line(c: dict) -> str:
    """'; N fades over a–b frames (median m)' for a cut summary or a burst record, or ''."""
    out = ""
    ms = 1000 / c["fps"]
    if c.get("fades"):
        out += (f"; {c['fades']} fade{'s' if c['fades'] != 1 else ''} over {c['fadeMinFr']}–{c['fadeMaxFr']} frames "
                f"({c['fadeMinFr'] * ms:.0f}–{c['fadeMaxFr'] * ms:.0f} ms, median {c['fadeMedFr']})")
    if c.get("darkChanges"):
        out += f"; {c['darkChanges']} change{'s' if c['darkChanges'] != 1 else ''} in the dark (under {DARK_LUM:g} luminance — a seam the eye never sees)"
    return out


# ---- placing bursts ------------------------------------------------------------------


def place_bursts(D: dict, dur: float, max_bursts: int = BURSTS_MAX) -> list[dict]:
    """[{t0, dur, why, prio, anchor}] — strobes, then transitions by novelty,
    then phrase starts (or a fixed interval without audio); overlapping
    windows merge into the higher-priority one; at most `max_bursts`."""
    win = min(BURST_S, dur)
    cands = []
    for tr in D["transitions"]:
        if tr["kind"] == "strobe":
            cands.append({"t0": tr["t"] - 0.25, "why": f"strobe {tr['t']:.2f}–{tr['tEnd']:.2f}s, flashes every {tr['spacingS']:.2f}s", "prio": 0,
                          "anchor": "strobe", "score": tr["novelty"]})
        else:
            cands.append({"t0": tr["t"] - win / 2, "why": f"transition at {tr['t']:.2f}s (beat #{tr['beat']} r{tr['rank']}, novelty {tr['novelty']:.1f})",
                          "prio": 1, "anchor": "transition", "score": tr["novelty"]})
    if D["hasAudio"]:
        for b in D["beats"]:
            if b["rank"] >= 16:
                cands.append({"t0": b["t"] - 0.5, "why": f"phrase start, beat #{b['i']} ({b['t']:.2f}s)", "prio": 2, "anchor": "phrase", "score": -b["t"]})
    else:
        for k in range(int(dur // SILENT_BURST_EVERY_S) + 1):
            cands.append({"t0": k * SILENT_BURST_EVERY_S, "why": f"every {SILENT_BURST_EVERY_S:g} s (no audio to place by)", "prio": 2, "anchor": "interval",
                          "score": -k})
    for c in cands:
        c["t0"] = round(float(np.clip(c["t0"], 0.0, max(0.0, dur - win))), 2)
        c["dur"] = round(win, 2)
    cands.sort(key=lambda c: (c["prio"], -c["score"]))
    kept: list[dict] = []
    for c in cands:
        home = next((k for k in kept if min(k["t0"] + k["dur"], c["t0"] + c["dur"]) - max(k["t0"], c["t0"]) > BURST_OVERLAP * win), None)
        if home is not None:
            home["why"] += f"; also {c['why']}"
            continue
        kept.append(c)
    kept = kept[:max_bursts]
    kept.sort(key=lambda c: c["t0"])
    for c in kept:
        c.pop("score", None)
    return kept


# ---- one burst -----------------------------------------------------------------------


def burst_size(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, math.sqrt(BURST_PIXELS / (width * height)))
    return int(round(scale * width / 2)) * 2, int(round(scale * height / 2)) * 2


def measure_burst(frames: np.ndarray, fps: float) -> dict:
    d = colour_change(frames)
    lum = mean_lum(frames)
    pix = pixel_change(frames)
    cuts = find_cuts(d, lum, pix)
    fs = fade_stats(d, lum, pix)
    hold = holds_ms(cuts, fps)
    span = float(lum.max() - lum.min()) if len(lum) else 0.0
    kind = "cuts" if len(cuts) >= 2 else "cut" if cuts else "fades" if fs["fades"] or fs["darkChanges"] else "flash" if span >= 0.1 else "continuous"
    return {
        "kind": kind, "cuts": cuts, "holdsMs": hold, "fps": fps, **fs,
        "holdMinMs": min(hold) if hold else None, "holdMedMs": int(np.median(hold)) if hold else None, "holdMaxMs": max(hold) if hold else None,
        "brightMin": round(float(lum.min()), 3) if len(lum) else 0.0, "brightMax": round(float(lum.max()), 3) if len(lum) else 0.0,
        "changeMean": round(float(d[1:].mean()), 4) if len(d) > 1 else 0.0,
    }


def make_burst(src: Path, start: float, width: int, height: int, spec: dict, bundle: Path) -> dict | None:
    """Decode, measure and write one burst; returns the record for audio.json."""
    w, h = burst_size(width, height)
    n = int(round(spec["dur"] * BURST_FPS))
    frames = decode_at(src, start + spec["t0"], w, h, n, fps=BURST_FPS)
    if len(frames) < 2:
        return None
    m = measure_burst(frames, BURST_FPS)
    rel = f"bursts/{spec['t0']:06.2f}"
    out = bundle / rel
    out.mkdir(parents=True, exist_ok=True)
    write_timing_grid(frames, spec["t0"], BURST_FPS, m["cuts"], out / "timing.png")
    write_detail_grid(frames, spec["t0"], BURST_FPS, m["cuts"], out / "detail.png")
    k = m["cuts"][0] if m["cuts"] else len(frames) // 2
    write_motion_tiles(frames, k, spec["t0"], BURST_FPS, out / "motion.png")
    rec = dict(spec)
    rec.update(m)
    rec.update({"frames": int(len(frames)), "fps": BURST_FPS, "size": [w, h], "cutT": [round(spec["t0"] + c / BURST_FPS, 3) for c in m["cuts"]],
                "files": {name: f"{rel}/{name}.png" for name in ("timing", "detail", "motion")}})
    return rec


def burst_lines(bursts: list[dict]) -> list[str]:
    L = []
    for b in bursts:
        t1 = b["t0"] + b["dur"]
        if b["kind"] == "continuous":
            what = f"no hard cut; brightness {b['brightMin']:.2f}–{b['brightMax']:.2f}, colour change {b['changeMean']:.3f}/frame (cut ≥ {CUT_HIST:g})"
        elif b["kind"] == "flash":
            what = f"no hard cut but brightness swings {b['brightMin']:.2f}–{b['brightMax']:.2f}"
        elif b["kind"] == "fades":
            what = f"no hard cut{fade_line(b)}; brightness {b['brightMin']:.2f}–{b['brightMax']:.2f}"
        elif b["holdMedMs"] is None:
            what = f"1 hard cut at {b['cutT'][0]:.2f}s{fade_line(b)}; brightness {b['brightMin']:.2f}–{b['brightMax']:.2f}"
        else:
            what = (f"{len(b['cuts'])} hard cuts, holds {b['holdMinMs']}–{b['holdMaxMs']} ms (median {b['holdMedMs']}){fade_line(b)}; "
                    f"brightness {b['brightMin']:.2f}–{b['brightMax']:.2f}")
        L.append(f"- **{b['t0']:.2f}–{t1:.2f}s** — {b['why']} — {what} — `{b['files']['timing']}` (every frame), "
                 f"`{b['files']['detail']}` (large), `{b['files']['motion']}` (paths / skeleton / t±1 in RGB)")
    return L


# ---- sheets ----------------------------------------------------------------------------


def fit_tile(n: int, aspect: float, cols: int, label_h: int, pad: int = TILE_PAD, box: int = SHEET_BOX, area: int = SHEET_PIXELS) -> int:
    """Largest tile width so that `n` tiles in `cols` columns fit both limits."""
    rows = math.ceil(n / cols)
    tw = int(min((box - pad) / cols - pad, ((box - pad) / rows - pad - label_h) / aspect))
    while tw > 8 and (cols * (tw + pad) + pad) * (rows * (int(tw * aspect) + label_h + pad) + pad) > area:
        tw -= 1
    return max(8, tw)


def pack_grid(tiles: list[np.ndarray], labels: list[list[tuple[str, tuple[int, int, int]]]], cols: int | None = None,
              hot: set[int] = frozenset(), pad: int = TILE_PAD):
    """Tiles (same aspect) on one sheet inside SHEET_BOX × SHEET_PIXELS, each
    with its label lines under it; `hot` tiles get a red border. Returns a
    PIL image. cols=None picks the column count that gives the largest tile."""
    from PIL import Image, ImageDraw

    n = len(tiles)
    aspect = tiles[0].shape[0] / tiles[0].shape[1]
    lines = max(len(l) for l in labels) if labels else 0
    label_h = lines * LINE_H + (2 if lines else 0)
    if cols is None:
        cols = max(range(1, n + 1), key=lambda c: (fit_tile(n, aspect, c, label_h, pad), -c))
    tw = fit_tile(n, aspect, cols, label_h, pad)
    th = int(tw * aspect)
    rows = math.ceil(n / cols)
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + label_h + pad) + pad), BG)
    d = ImageDraw.Draw(sheet)
    f = font(11)
    for i, tile in enumerate(tiles):
        x = pad + (i % cols) * (tw + pad)
        y = pad + (i // cols) * (th + label_h + pad)
        sheet.paste(Image.fromarray(np.ascontiguousarray(tile)).resize((tw, th), Image.BILINEAR), (x, y))
        if i in hot:
            d.rectangle([(x - 1, y - 1), (x + tw, y + th)], outline=(255, 80, 80), width=2)
        for li, (text, col) in enumerate(labels[i] if i < len(labels) else []):
            d.text((x + 2, y + th + 1 + li * LINE_H), text, fill=col, font=f)
    return sheet


def write_timing_grid(frames: np.ndarray, t0: float, fps: float, cuts: list[int], path: Path) -> None:
    cutset = set(cuts)
    labels = [[(f"{t0 + i / fps:.2f}s" + (" CUT" if i in cutset else ""), (255, 120, 120) if i in cutset else (170, 175, 190))] for i in range(len(frames))]
    pack_grid(list(frames), labels, hot=cutset).save(path)


def write_detail_grid(frames: np.ndarray, t0: float, fps: float, cuts: list[int], path: Path) -> None:
    n = len(frames)
    picks = []
    for c in cuts:
        if c < n and c not in picks:
            picks.append(c)
        if len(picks) >= DETAIL_TILES:
            break
    if len(picks) < DETAIL_TILES:
        for i in np.linspace(0, n - 1, DETAIL_TILES).astype(int):
            if len(picks) >= DETAIL_TILES:
                break
            if int(i) not in picks:
                picks.append(int(i))
    picks.sort()
    cutset = set(cuts)
    labels = [[(f"{t0 + i / fps:.2f}s  frame {i}" + ("  after cut" if i in cutset else ""), (255, 120, 120) if i in cutset else (170, 175, 190))] for i in picks]
    pack_grid([frames[i] for i in picks], labels, hot={j for j, i in enumerate(picks) if i in cutset}).save(path)


def write_motion_tiles(frames: np.ndarray, k: int, t0: float, fps: float, path: Path) -> None:
    n = len(frames)
    k = int(np.clip(k, 1, n - 2)) if n >= 3 else 0
    w0, w1 = max(0, k - MOTION_WIN), min(n, k + MOTION_WIN + 1)
    mx = frames[w0:w1].max(axis=0)
    mean = frames[w0:w1].mean(axis=0).astype(np.uint8)
    if n >= 3:
        g = luminance(frames[k - 1 : k + 2]) * 255
        rgb = np.stack([g[0], g[1], g[2]], axis=-1).clip(0, 255).astype(np.uint8)
    else:
        rgb = frames[0]
    c = (190, 200, 220)
    labels = [[(f"max-projection {t0 + w0 / fps:.2f}-{t0 + w1 / fps:.2f}s: light paths, spin/zoom direction", c)],
              [("mean-projection: the static skeleton", c)],
              [(f"t-1/t/t+1 in R/G/B at {t0 + k / fps:.2f}s: grey = still, fringes = motion", c)]]
    pack_grid([mx, mean, rgb], labels, cols=3).save(path)


# ---- slit-scan -----------------------------------------------------------------------


def write_slitscan(frames: np.ndarray, fps: float, beats: list[dict], trans: list[dict], has_audio: bool, path: Path) -> dict:
    """x = frame (decimated by an integer factor when the clip is longer than
    SHEET_BOX frames), three lanes of fixed pixel lines, a second ruler, beat
    lines for rank >= 4 (audio only) and transition markers. Returns what
    the report should say about it."""
    from PIL import Image, ImageDraw

    n, H, W = frames.shape[:3]
    step = max(1, math.ceil(n / SHEET_BOX))
    fr = frames[::step]
    m = len(fr)
    cy, cx = H / 2, W / 2
    row = fr[:, H // 2, :, :]
    ang = np.linspace(0, 2 * np.pi, 360, endpoint=False)
    rr = 0.5 * H / 2
    ring = fr[:, (cy + rr * np.sin(ang)).astype(int).clip(0, H - 1), (cx + rr * np.cos(ang)).astype(int).clip(0, W - 1), :]
    sp = np.linspace(0, H / 2 - 1, 135)
    spoke = fr[:, (cy - sp).astype(int).clip(0, H - 1), np.full(135, int(cx)), :]
    lanes = [(SLIT_LANES[0][0], row, SLIT_LANES[0][1]), (SLIT_LANES[1][0], ring, SLIT_LANES[1][1]), (SLIT_LANES[2][0], spoke, SLIT_LANES[2][1])]
    gap, ruler = 20, 18
    Hs = 12 + sum(h + gap for _, _, h in lanes) + ruler
    im = Image.new("RGB", (m, Hs), BG)
    d = ImageDraw.Draw(im)
    f = font(11)
    y = 12
    for name, arr, h in lanes:
        a = Image.fromarray(np.ascontiguousarray(arr.transpose(1, 0, 2))).resize((m, h), Image.BILINEAR)
        im.paste(a, (0, y + gap - 6))
        d.text((4, y + 1), name, fill=(190, 200, 220), font=f)
        y += h + gap
    px = fps / step  # image px per second
    for s in range(int(n / fps) + 1):
        x = int(s * px)
        d.line([(x, 12), (x, Hs - ruler)], fill=(140, 140, 170) if s % 5 == 0 else (60, 60, 80), width=1)
        if s % 5 == 0:
            d.text((x + 2, Hs - ruler + 3), f"{s}s", fill=(160, 160, 180), font=f)
    if has_audio:
        for b in beats:
            if b["rank"] >= 4:
                x = int(b["t"] * px)
                col = (255, 255, 255) if b["rank"] >= 16 else (200, 200, 210) if b["rank"] >= 8 else (120, 120, 140)
                d.line([(x, 12), (x, 12 + 6)], fill=col, width=2 if b["rank"] >= 8 else 1)
    for tr in trans:
        x = int(tr["t"] * px)
        if tr["kind"] == "strobe":
            d.rectangle([(x, 2), (int(tr["tEnd"] * px), 7)], fill=(255, 70, 70))
        else:
            d.polygon([(x - 4, 1), (x + 4, 1), (x, 9)], fill=(255, 70, 70))
    note = f"x = time, {fps / step:g} columns per second" + (f" (every {step}th frame)" if step > 1 else " (every frame)")
    d.text((max(4, m - 8 - 6 * len(note)), 1), note, fill=(120, 120, 130), font=f)
    im.save(path)
    return {"step": step, "colsPerSec": fps / step, "size": [m, Hs]}
