#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "scipy>=1.11", "librosa>=0.10", "pillow>=10.1", "soundfile>=0.12"]
# ///
"""
ref-scan: turn a reference video into a beat-indexed *bundle* so a scene can
be adapted from it by measurement instead of by guessing from a contact sheet.

    uv run tools/ref-scan.py <video.mp4 | URL> [--name X] [--start S] [--dur D]
                             [--offsets -80,0,160] [--min-rank 1] [--phase N]
                             [--bpm HINT] [--max-rows 20] [--out DIR]
                             [--hear hears.json] [--report-only]

Output lands in tools/.cache/refs/<name>/ (gitignored via tools/.cache/).
Read in this order — the first three are meant to be enough:

    report.md      Findings first: every sync rule the measurements support,
                   one line each, with what *our* analyser hears at the same
                   moments when `--hear` was given. Then the look as numbers
                   (palette, symmetry, motion), the per-rank table, the
                   correlations that matter, the transitions with the audio
                   at that moment, and a hint per image on when to open it.
    keyframes.png  one sheet, a handful of tiles the scan chose: a
                   representative frame per visual regime, before/after of
                   each transition, phrase starts — labelled with why.
    timeline.png   audio lanes over visual lanes on one time axis, with beat
                   lines by rank and markers for transitions / regime
                   changes / section boundaries (and our onsets, with --hear).

    sheets/        rank<N>.png — every beat of rank >= N, one row per beat,
                   one column per offset. Drill-down only; the report says
                   which one is worth opening.
    frames/        the JPEGs behind the sheets and key frames.
    audio.json     everything numeric: beats with rank + audio + frame paths,
                   transitions, regime changes, key frames, look descriptors.
    series.tsv     the per-frame numbers behind the timeline, 15 fps.
    audio.wav      the clip's audio, 48 kHz mono s16 — what tools/ref-hear.mjs
                   and tools/ref-shoot.mjs play into the app as the microphone.

Why frames are taken on beats, not every N seconds: a music visual changes
*at* beats — cuts, flashes, direction flips land on the 1, the bar, the
phrase. Fixed-interval sampling straddles those moments; sampling at beat ±
small offsets (`--offsets`, ms) shows the state just before, on, and just
after the hit. And why transitions are found from the picture and then
checked against the audio, not the other way round: a flash that lands
between beats with no onset under it is a timer, and only the picture can
say it happened.

Beat rank: counted from the estimated downbeat, a beat's rank is the
largest power of two (up to MAX_RANK) that divides its index — 16 = phrase
start, 8 = half phrase, 4 = bar start, 2 = mid-bar, 1 = the off-beats. Rank
is only as good as the downbeat estimate (kick-weighted onset strength mod
4, then spectral novelty mod 8 and mod 16); the report prints the margin,
and `--phase N` (index of a beat you can see is a phrase start) overrides it.

What ours hears (`--hear`): tools/ref-hear.mjs plays audio.wav into the app
and samples the probe (src/tuning/probe.ts) every frame. Joined here per
beat and per transition — did our onset fire, what bpm we held, how our
energy moved — and summarised as an onset hit rate by rank, an onset lag
(ours minus librosa's), the share of time our tempo sat at ×1 / ×½ / ×2 of
the reference's, and how close our `section` signal came to the reference's
section boundaries. One run of one analyser: the tempo lock in particular
has come out differently on two runs of the same clip, so treat it as a
sample, not a spec. `--report-only` rebuilds report/timeline/keyframes from
an existing bundle (no video decode) — the way to add `--hear` afterwards.

Zoom sign: the motion estimate is a log-polar shift whose sign depends on
resample conventions that are easy to get backwards. The script calibrates
at run time: it scales frame 0 up by 5 %, measures the shift, and flips the
sign so that positive `zoom` always means zooming *in*. Rotation is
radians/s, positive = counter-clockwise on screen (image coordinates, y down).

Silent videos (no audio stream, or all-zero RMS) still get frames and
motion metrics on a uniform grid at `--bpm` (120 if not given), and the
report says so — don't read sync into a grid that was invented.

Companions: tools/ref-hear.mjs (above), tools/ref-shoot.mjs (replays
audio.wav into a scene of ours and shoots the same beats beside these
frames). The command file .claude/commands/ref.md walks the whole loop.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage, signal
from scipy.cluster.vq import kmeans2

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "refs"
DL_DIR = CACHE / "_downloads"

VID_FPS = 30  # decode rate → frame-grab timing precision of ±1/60 s
VIS_FPS = 15  # motion-metric rate (every 2nd decoded frame)
FRAME_PIXELS = 480 * 270  # decode budget per frame; sheets scale from this
LP_W = 192  # log-polar working size (square crop of the frame centre)
LP_R, LP_T = 96, 180  # log-polar bins along rho (scale) and theta (angle)
MAX_RANK = 16
SR = 22050
HOP = 512

# Findings thresholds — a rule is stated only when the numbers clear these.
RANK_REACT_MARGIN = 0.4  # z difference, bar/phrase beats vs off-beats
CORR_MIN = 0.2  # |r| below this is noise for a 20-30 s clip at 15 fps
ENVELOPE_MIN_Z = 0.3  # onset-locked rise in z to count as a flash
PHASE_CONTRAST_MIN = 0.5  # (max-min)/std across beat-phase bins to count as pulsed
MOTION_MIN = 0.5  # |mean| / std for "continuous" zoom / rotation
KEY_TILES_MAX = 16
HEAR_WINDOW_S = 0.07  # ± around a moment when reading what ours heard
ONSET_MATCH_S = 0.06  # ours and librosa onsets closer than this are the same hit
BPM_LOCK_TOL = 0.04  # ±4 % counts as the same tempo
LAG_MAX_MS = 500  # a correlation peaking further out than this is noise, not a lag


def log(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


# ---- source -------------------------------------------------------------------


def resolve_source(video: str) -> Path:
    """A local file is used as is; a URL is fetched once into the download
    cache with yt-dlp (video ≤720p *plus audio* — a bare `bv*` has no
    audio stream and the whole point is the audio)."""
    if not video.startswith(("http://", "https://")):
        p = Path(video).expanduser().resolve()
        if not p.exists():
            sys.exit(f"ref-scan: no such file {p}")
        return p
    DL_DIR.mkdir(parents=True, exist_ok=True)
    log(f"downloading {video}")
    out = run(
        [
            "uvx", "yt-dlp", "-q", "--no-simulate", "--no-playlist",
            "-f", "bv*[height<=720]+ba/b", "--merge-output-format", "mp4",
            "-o", str(DL_DIR / "%(id)s.%(ext)s"),
            "--print", "after_move:filepath", video,
        ],
        capture_output=True, text=True,
    ).stdout.strip().splitlines()
    if not out:
        sys.exit("ref-scan: yt-dlp printed no output path")
    return Path(out[-1])


def probe(path: Path) -> dict:
    j = json.loads(
        run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
             "-of", "json", str(path)], capture_output=True, text=True).stdout
    )
    vid = next((s for s in j["streams"] if s["codec_type"] == "video"), None)
    if vid is None:
        sys.exit(f"ref-scan: {path} has no video stream")
    return {
        "duration": float(j["format"]["duration"]),
        "width": int(vid["width"]),
        "height": int(vid["height"]),
        "has_audio": any(s["codec_type"] == "audio" for s in j["streams"]),
    }


def extract_audio(src: Path, start: float, dur: float, out: Path) -> None:
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "48000", "-sample_fmt", "s16", str(out)])


def decode_video(src: Path, start: float, dur: float, w: int, h: int) -> np.ndarray:
    """Every frame of the clip at VID_FPS, RGB, `w`×`h` — one decode serves
    the motion metrics, the frame grabs and the sheets."""
    raw = run(
        ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
         "-vf", f"fps={VID_FPS},scale={w}:{h}", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        capture_output=True,
    ).stdout
    n = len(raw) // (w * h * 3)
    return np.frombuffer(raw[: n * w * h * 3], dtype=np.uint8).reshape(n, h, w, 3)


# ---- audio -------------------------------------------------------------------


def zscore(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    return (x - x.mean()) / (x.std() + 1e-9)


def zscore_rows(m: np.ndarray) -> np.ndarray:
    return (m - m.mean(axis=1, keepdims=True)) / (m.std(axis=1, keepdims=True) + 1e-9)


def analyse_audio(wav: Path, bpm_hint: float | None) -> dict | None:
    import librosa

    y, sr = librosa.load(str(wav), sr=SR, mono=True)
    if y.size == 0 or float(np.sqrt(np.mean(y * y))) < 1e-4:
        return None
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, start_bpm=bpm_hint or 120.0, units="frames"
    )
    tempo = float(np.atleast_1d(tempo)[0])
    beat_t = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    if len(beat_t) < 4:
        return None
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)

    def band(lo, hi):
        m = (freqs >= lo) & (freqs < hi)
        return np.log1p(S[m].sum(axis=0))

    low, mid, high = band(20, 150), band(150, 2000), band(2000, 8000)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    n = min(len(onset_env), len(low), len(rms))
    low_flux = np.maximum(np.diff(low[:n], prepend=low[0]), 0)
    onsets_t = librosa.frames_to_time(
        librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="frames"),
        sr=sr, hop_length=HOP,
    )
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOP)
    feat = np.vstack([zscore_rows(mfcc), zscore_rows(chroma)])
    feat_b = librosa.util.sync(feat, beat_frames, aggregate=np.mean)
    return {
        "sr": sr, "tempo": tempo, "beat_frames": beat_frames, "beat_t": beat_t,
        "onset_env": onset_env[:n], "low": low[:n], "mid": mid[:n], "high": high[:n], "rms": rms[:n],
        "low_flux": low_flux, "onsets_t": onsets_t, "feat_b": feat_b, "n": n,
    }


def at_frame(series: np.ndarray, f: int, halo: int = 1, reduce=np.max) -> float:
    lo, hi = max(0, f - halo), min(len(series), f + halo + 1)
    return float(reduce(series[lo:hi])) if hi > lo else 0.0


def estimate_phase(a: dict, nbeats: int) -> tuple[int, float, list[str]]:
    """Which beat is a phrase start. Stage 1 (mod 4): the bar's first beat
    carries the kick — score each of the 4 phases by onset strength + low
    flux at its beats. Stage 2 (mod 8) and 3 (mod 16): the phrase starts
    where the timbre changes most — score by the distance between the mean
    beat-synced feature before and after the candidate beats."""
    notes = []
    bf = a["beat_frames"]
    strength = zscore(np.array([at_frame(a["onset_env"], f) for f in bf]))
    kick = zscore(np.array([at_frame(a["low_flux"], f) for f in bf]))
    score4 = np.array([np.mean((strength + kick)[p::4]) for p in range(4)])
    order = np.argsort(score4)[::-1]
    p4 = int(order[0])
    spread = float(score4.std()) + 1e-9
    conf = float((score4[order[0]] - score4[order[1]]) / spread)
    notes.append(f"bar phase {p4} (mod 4) by kick-weighted onset strength; margin {conf:.2f}σ over the runner-up")

    feat = a["feat_b"]

    def novelty(i: int, half: int) -> float:
        lo, hi = i - half, i + half
        if lo < 0 or hi > feat.shape[1]:
            return float("nan")
        return float(np.linalg.norm(feat[:, lo:i].mean(axis=1) - feat[:, i:hi].mean(axis=1)))

    def pick(base: int, step: int, half: int) -> int:
        cands = [base, base + step // 2]
        sc = []
        for c in cands:
            vals = [novelty(i, half) for i in range(c, nbeats, step)]
            vals = [v for v in vals if not math.isnan(v)]
            sc.append(np.mean(vals) if vals else -1)
        best = cands[int(np.argmax(sc))]
        notes.append(f"phase {best} (mod {step}) by timbre novelty {max(sc):.2f} vs {min(sc):.2f}")
        return best

    p8 = pick(p4, 8, 4)
    p16 = pick(p8, 16, 8)
    return p16 % MAX_RANK, conf, notes


def rank_of(i: int, phase: int) -> int:
    d = i - phase
    for k in (16, 8, 4, 2):
        if d % k == 0:
            return k
    return 1


# ---- video --------------------------------------------------------------------


def to_grey_square(frame: np.ndarray) -> np.ndarray:
    from PIL import Image

    h, w = frame.shape[:2]
    s = min(h, w)
    y0, x0 = (h - s) // 2, (w - s) // 2
    g = Image.fromarray(frame[y0 : y0 + s, x0 : x0 + s]).convert("L").resize((LP_W, LP_W), Image.BILINEAR)
    return np.asarray(g, dtype=np.float32) / 255.0


class LogPolar:
    def __init__(self):
        cy = cx = (LP_W - 1) / 2
        self.rmax = LP_W / 2 - 1
        rhos = np.exp(np.linspace(np.log(2.0), np.log(self.rmax), LP_R))
        thetas = np.linspace(0, 2 * np.pi, LP_T, endpoint=False)
        self.yy = cy + rhos[:, None] * np.sin(thetas)[None, :]
        self.xx = cx + rhos[:, None] * np.cos(thetas)[None, :]
        self.drho = np.log(self.rmax / 2.0) / (LP_R - 1)  # log-scale units per rho bin
        self.dth = 2 * np.pi / LP_T

    def __call__(self, f: np.ndarray) -> np.ndarray:
        lp = ndimage.map_coordinates(f, [self.yy, self.xx], order=1, mode="nearest")
        return lp - lp.mean()


def best_shift(a: np.ndarray, b: np.ndarray, axis: int, maxs: int) -> tuple[float, float]:
    """Sub-bin shift of b relative to a along `axis`, by parabolic
    interpolation of the correlation peak; also the peak's normalised
    correlation as a confidence."""
    scores = []
    for s in range(-maxs, maxs + 1):
        bb = np.roll(b, s, axis=axis)
        if axis == 0:  # rho isn't periodic: ignore wrapped rows
            lo, hi = max(0, s), LP_R + min(0, s)
            scores.append(np.mean(a[lo:hi] * bb[lo:hi]))
        else:
            scores.append(np.mean(a * bb))
    scores = np.array(scores)
    i = int(np.argmax(scores))
    frac = 0.0
    if 0 < i < len(scores) - 1:
        y0, y1, y2 = scores[i - 1], scores[i], scores[i + 1]
        den = y0 - 2 * y1 + y2
        frac = 0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0.0
    return (i - maxs) + frac, float(scores[i] / (np.sqrt(np.mean(a * a) * np.mean(b * b)) + 1e-9))


def zoom_sign(lp: LogPolar, grey0: np.ndarray) -> float:
    """Calibrate: a 5 % enlargement of frame 0 must read as zoom *in*."""
    from PIL import Image

    big = Image.fromarray((grey0 * 255).astype(np.uint8)).resize((int(LP_W * 1.05), int(LP_W * 1.05)), Image.BILINEAR)
    o = (big.width - LP_W) // 2
    zoomed = np.asarray(big.crop((o, o, o + LP_W, o + LP_W)), dtype=np.float32) / 255.0
    s, _ = best_shift(lp(grey0), lp(zoomed), 0, 6)
    return 1.0 if s > 0 else -1.0


SYMMETRY_MIN_R = 0.3  # angular correlation below this is texture, not symmetry


def symmetry(lps: list[np.ndarray]) -> dict:
    """Radial symmetry from the log-polar frames, per frame (a subsample),
    median over frames — averaging frames first blurs it away. Two kinds:
    rotational (a k-fold pattern repeats every LP_T/k theta bins) and
    mirror (theta → −theta about some axis; a kaleidoscope built from
    mirrors has this and often no rotational symmetry at all). Returns the
    fold, the number of mirror axes, and each one's correlation."""
    sample = lps[:: max(1, len(lps) // 20)] or lps
    rot = {k: [] for k in range(2, 13) if abs(LP_T / k - round(LP_T / k)) < 1e-9}
    refl = []
    axes = []
    for m in sample:
        m = m - m.mean(axis=1, keepdims=True)
        den = float(np.mean(m * m)) + 1e-9
        for k in rot:
            rot[k].append(float(np.mean(m * np.roll(m, LP_T // k, axis=1))) / den)
        flipped = m[:, ::-1]
        curve = np.array([float(np.mean(m * np.roll(flipped, s, axis=1))) / den for s in range(LP_T)])
        refl.append(float(curve.max()))
        peaks, _ = signal.find_peaks(np.concatenate([curve, curve[:LP_T // 8]]), height=max(SYMMETRY_MIN_R, 0.6 * curve.max()), distance=LP_T // 16)
        axes.append(int(np.sum(peaks < LP_T)))
    rot_med = {k: float(np.median(v)) for k, v in rot.items()}
    best_k = max(rot_med, key=lambda k: rot_med[k])
    fold = best_k if rot_med[best_k] >= SYMMETRY_MIN_R else 1
    refl_med = float(np.median(refl))
    return {"fold": fold, "foldR": round(rot_med[best_k], 2),
            "mirrorAxes": int(np.median(axes)) if refl_med >= SYMMETRY_MIN_R else 0, "mirrorR": round(refl_med, 2)}


def palette(frames_rgb: np.ndarray, k: int = 5) -> list[dict]:
    """Dominant colours of a pixel subsample, as hex with share."""
    px = frames_rgb[:, ::6, ::6, :].reshape(-1, 3).astype(np.float64)
    if len(px) > 20000:
        px = px[np.random.default_rng(0).choice(len(px), 20000, replace=False)]
    cent, lab = kmeans2(px, k, minit="++", seed=0)
    out = []
    for i in range(k):
        share = float(np.mean(lab == i))
        c = np.clip(cent[i], 0, 255).astype(int)
        out.append({"hex": "#%02x%02x%02x" % tuple(c), "share": round(share, 2)})
    return sorted(out, key=lambda c: -c["share"])


def analyse_video(frames: np.ndarray) -> dict:
    lp = LogPolar()
    vis = frames[::2]  # VID_FPS → VIS_FPS
    n = len(vis)
    grey = [to_grey_square(f) for f in vis]
    sign = zoom_sign(lp, grey[0]) if n else 1.0
    lps = [lp(g) for g in grey]
    zoom, rot, act, conf = np.zeros(n), np.zeros(n), np.zeros(n), np.zeros(n)
    bright = np.array([g.mean() for g in grey])
    small = vis[:, ::4, ::4, :].astype(np.float32)
    mx, mn = small.max(axis=3), small.min(axis=3)
    sat = ((mx - mn) / (mx + 1e-3)).mean(axis=(1, 2))
    q = (small // 64).astype(np.int64)
    bins = (q[..., 0] * 16 + q[..., 1] * 4 + q[..., 2]).reshape(n, -1)
    hists = np.stack([np.bincount(b, minlength=64) for b in bins]).astype(np.float64)
    hists /= hists.sum(axis=1, keepdims=True) + 1e-9
    cut = np.zeros(n)
    for i in range(1, n):
        sr_, c1 = best_shift(lps[i - 1], lps[i], 0, 6)
        st, c2 = best_shift(lps[i - 1], lps[i], 1, 8)
        zoom[i] = sign * sr_ * lp.drho * VIS_FPS  # log-scale units per second, + = in
        rot[i] = st * lp.dth * VIS_FPS  # radians per second
        conf[i] = max(c1, c2)
        act[i] = float(np.mean(np.abs(grey[i] - grey[i - 1])))
        cut[i] = float(np.abs(hists[i] - hists[i - 1]).sum())
    # Look descriptors (numbers instead of pictures).
    yy, xx = np.mgrid[0:LP_W, 0:LP_W]
    rr = np.hypot(yy - (LP_W - 1) / 2, xx - (LP_W - 1) / 2) / (LP_W / 2)
    centre, edge = rr < 0.25, rr > 0.45
    g_mean = np.mean(grey, axis=0)
    look = {
        "palette": palette(vis[:: max(1, n // 12)]),
        "symmetry": symmetry(lps),
        "centreBright": round(float(g_mean[centre].mean()), 3), "edgeBright": round(float(g_mean[edge].mean()), 3),
        "meanBright": round(float(bright.mean()), 3), "darkShare": round(float(np.mean(bright < 0.08)), 2),
        "meanSat": round(float(sat.mean()), 3),
        "zoomMean": round(float(zoom[1:].mean()), 4), "zoomAbs": round(float(np.abs(zoom[1:]).mean()), 4),
        "rotMean": round(float(rot[1:].mean()), 4), "rotAbs": round(float(np.abs(rot[1:]).mean()), 4),
        "actMean": round(float(act[1:].mean()), 4),
    }
    return {"n": n, "zoom": zoom, "rot": rot, "act": act, "bright": bright, "sat": sat, "cut": cut, "conf": conf,
            "sign": sign, "hists": hists, "look": look}


# ---- joining the two ----------------------------------------------------------


def audio_at_vis_rate(a: dict, n: int) -> dict:
    idx = np.clip(np.round(np.arange(n) / VIS_FPS * a["sr"] / HOP).astype(int), 0, a["n"] - 1)
    return {k: a[k][idx] for k in ("onset_env", "low", "mid", "high", "rms")}


def xcorr(x: np.ndarray, y: np.ndarray, maxlag: int) -> tuple[int, float]:
    x, y = zscore(x), zscore(y)
    best = (0, 0.0)
    for lag in range(-maxlag, maxlag + 1):
        if lag >= 0:
            r = float(np.mean(x[lag:] * y[: len(y) - lag])) if lag < len(x) else 0.0
        else:
            r = float(np.mean(x[:lag] * y[-lag:]))
        if abs(r) > abs(best[1]):
            best = (lag, r)
    return best


def find_transitions(v: dict, beat_t: np.ndarray, rank: list[int], aud: dict, section_t: np.ndarray, period: float) -> list[dict]:
    nov = zscore(v["act"]) + zscore(v["cut"])
    nov = ndimage.uniform_filter1d(nov, 2)
    # Prominence, not height: a flashing stretch keeps novelty high for
    # seconds, and every bump in it is not a transition. Half a beat apart
    # at least — closer than that and it's the same event.
    peaks, props = signal.find_peaks(nov, height=1.5, prominence=1.5, distance=max(2, int(VIS_FPS * period * 0.5)))
    out = []
    z = {k: zscore(aud[k]) for k in aud}
    zb = zscore(v["bright"])
    zc = zscore(v["cut"])
    for p, h in zip(peaks, props["peak_heights"]):
        t = p / VIS_FPS
        bi = int(np.argmin(np.abs(beat_t - t)))
        off = t - beat_t[bi]
        # "On the beat" can't be finer than the frame rate: allow 1.5 frames
        # or 15 % of a beat, whichever is looser.
        on_beat = abs(off) <= max(0.15 * period, 1.5 / VIS_FPS)
        i2, i0 = min(v["n"] - 1, p + 1), max(0, p - 2)
        near_section = bool(len(section_t)) and float(np.min(np.abs(section_t - t))) < period * 0.6
        out.append({
            "t": round(t, 3), "frame": int(p), "novelty": round(float(h), 2), "beat": bi, "rank": rank[bi],
            "offMs": int(round(off * 1000)), "offBeats": round(off / period, 2), "onBeat": bool(on_beat),
            "onsetZ": round(float(z["onset_env"][max(0, p - 1) : p + 2].max()), 2),
            "lowD": round(float(z["low"][i2] - z["low"][i0]), 2),
            "midD": round(float(z["mid"][i2] - z["mid"][i0]), 2),
            "highD": round(float(z["high"][i2] - z["high"][i0]), 2),
            "rmsZ": round(float(z["rms"][p]), 2),
            "section": near_section,
            "brightD": round(float(zb[i2] - zb[i0]), 2),
            "cutZ": round(float(zc[p]), 2),
            "kind": "single",
        })
    return group_strobes(out, period)


def group_strobes(trans: list[dict], period: float) -> list[dict]:
    """A run of three or more peaks each within a beat of the last is one
    event — a strobe/flash stretch — not a list of transitions. The row
    keeps the audio of the first flash and adds the flash spacing in
    beats, which is the question that matters: are the flashes on the beat
    (spacing ≈ 1 or 0.5) or on a timer of their own?"""
    out, run_ = [], []

    def flush():
        if len(run_) >= 3:
            gaps = np.diff([r["t"] for r in run_])
            first = dict(run_[0])
            first.update({
                "kind": "strobe", "tEnd": run_[-1]["t"], "flashes": len(run_),
                "spacingS": round(float(gaps.mean()), 3), "spacingBeats": round(float(gaps.mean() / period), 2),
                "spacingJitter": round(float(gaps.std() / period), 2),
                "spacingResBeats": round(1 / VIS_FPS / period, 2),
                "onBeatShare": round(sum(1 for r in run_ if r["onBeat"]) / len(run_), 2),
            })
            out.append(first)
        else:
            out.extend(run_)
        run_.clear()

    for tr in trans:
        if run_ and tr["t"] - run_[-1]["t"] > period * 1.05:
            flush()
        run_.append(tr)
    flush()
    return out


def strobe_verdict(tr: dict) -> tuple[str, bool]:
    res = tr["spacingResBeats"]
    k = min((0.25, 0.5, 1.0, 2.0), key=lambda k: abs(tr["spacingBeats"] - k))
    near = abs(tr["spacingBeats"] - k) <= max(0.08, res) and tr["spacingJitter"] <= max(0.1, res)
    return (f"≈ {k:g} beat within the ±{res:.2f}-beat resolution of {VIS_FPS} fps" if near
            else "no simple fraction of a beat → own timer"), near


def read_transition(tr: dict) -> str:
    bits = []
    if tr["kind"] == "strobe":
        verdict, _ = strobe_verdict(tr)
        bits.append(f"STROBE to {tr['tEnd']:.2f}s: {tr['flashes']} flashes every {tr['spacingS']:.2f}s = {tr['spacingBeats']:.2f} beat ({verdict})")
        bits.append(f"starts {'on' if tr['onBeat'] else 'off'} beat r{tr['rank']}")
    else:
        bits.append(f"on beat (r{tr['rank']})" if tr["onBeat"] else f"off-beat ({tr['offBeats']:+.2f} beat from r{tr['rank']})")
    if tr["onsetZ"] >= 1.5:
        bits.append("hard onset")
    elif tr["onsetZ"] >= 0.7:
        bits.append("onset")
    else:
        bits.append("no onset")
    for k, name in (("lowD", "low"), ("midD", "mid"), ("highD", "high")):
        if tr[k] >= 1.0:
            bits.append(f"{name} jumps")
        elif tr[k] <= -1.0:
            bits.append(f"{name} drops")
    if tr["section"]:
        bits.append("section boundary")
    if tr["cutZ"] >= 3:
        bits.append("looks like a cut")
    if tr["brightD"] >= 1:
        bits.append("flash")
    elif tr["brightD"] <= -1:
        bits.append("blackout")
    if tr["kind"] == "single" and not tr["onBeat"] and tr["onsetZ"] < 0.7:
        bits.append("→ probably not audio-driven")
    if tr.get("ours"):
        o = tr["ours"]
        bits.append(f"ours: onset {'yes' if o['onset'] else 'no'}, bpm {o['bpm']:.0f}")
    return ", ".join(bits)


def regime_changes(v: dict, beat_t: np.ndarray, rank: list[int], period: float) -> list[dict]:
    """On bar/phrase beats, does the picture *stay* different afterwards?
    Mean of each metric over the two beats before vs the two after, in
    units of that metric's own std over the clip."""
    out = []
    metrics = {"bright": v["bright"], "sat": v["sat"], "act": v["act"], "zoom": v["zoom"], "abszoom": np.abs(v["zoom"]), "rot": v["rot"]}
    stds = {k: float(np.std(m)) + 1e-9 for k, m in metrics.items()}
    for i, t in enumerate(beat_t):
        if rank[i] < 4:
            continue
        a0, a1 = int((t - 2 * period) * VIS_FPS), int(t * VIS_FPS)
        b1 = int((t + 2 * period) * VIS_FPS)
        if a0 < 0 or b1 > v["n"]:
            continue
        deltas = {k: (float(m[a1:b1].mean()) - float(m[a0:a1].mean())) / stds[k] for k, m in metrics.items()}
        strong = {k: round(d, 2) for k, d in deltas.items() if abs(d) >= 0.8}
        if strong:
            out.append({"beat": i, "t": round(float(t), 3), "rank": rank[i], "deltas": strong})
    return out


def onset_envelope(v: dict, onsets_t: np.ndarray, zaud_onset: np.ndarray) -> dict:
    """Brightness and activity averaged around the reference's strong
    onsets: how fast the picture rises after a hit and how long it takes to
    settle — a scene's attack/release, read off the reference."""
    pre, post = int(0.2 * VIS_FPS), int(0.8 * VIS_FPS)
    out = {}
    strong = [t for t in onsets_t if 0 <= int(t * VIS_FPS) < len(zaud_onset) and zaud_onset[int(t * VIS_FPS)] >= 1.0]
    for name in ("bright", "act"):
        z = zscore(v[name])
        wins = [z[f - pre : f + post + 1] for t in strong for f in [int(round(t * VIS_FPS))] if f - pre >= 0 and f + post < len(z)]
        if len(wins) < 3:
            out[name] = None
            continue
        prof = np.mean(wins, axis=0)
        base = prof[:pre].mean()
        peak_i = int(np.argmax(prof[pre:])) + pre
        rise = prof[peak_i] - base
        if rise < ENVELOPE_MIN_Z:
            out[name] = {"n": len(wins), "riseZ": round(float(rise), 2), "attackMs": None, "decayMs": None}
            continue
        half = base + rise / 2
        after = np.where(prof[peak_i:] <= half)[0]
        out[name] = {
            "n": len(wins), "riseZ": round(float(rise), 2),
            "attackMs": int((peak_i - pre) / VIS_FPS * 1000),
            "decayMs": int(after[0] / VIS_FPS * 1000) if len(after) else None,
        }
    return out


def beat_phase_profile(v: dict, beat_t: np.ndarray, period: float) -> dict:
    """Each visual metric as a function of beat phase (0 = on the beat) in a
    few bins: flat means continuous motion, a peak at 0 means pulsed on the
    beat, a peak at 0.5 means pulsed on the off-beat."""
    n = v["n"]
    t = np.arange(n) / VIS_FPS
    idx = np.searchsorted(beat_t, t, side="right") - 1
    ok = idx >= 0
    phase = np.zeros(n)
    phase[ok] = ((t[ok] - beat_t[idx[ok]]) / period) % 1.0
    nb = 8
    b = np.minimum((phase * nb).astype(int), nb - 1)
    out = {}
    for name in ("act", "bright", "abszoom"):
        series = np.abs(v["zoom"]) if name == "abszoom" else v[name]
        z = zscore(series)[ok]
        prof = np.array([z[b[ok] == i].mean() if np.any(b[ok] == i) else 0.0 for i in range(nb)])
        out[name] = {"bins": [round(float(p), 2) for p in prof], "peakPhase": round(float(np.argmax(prof) / nb), 2),
                     "contrast": round(float(prof.max() - prof.min()), 2)}
    return out


# ---- what ours hears ------------------------------------------------------------


def load_hears(path: Path) -> dict:
    h = json.loads(path.read_text())
    S = np.array(h["samples"], dtype=np.float64)
    H = {c: S[:, i] for i, c in enumerate(h["columns"])}
    H["scene"] = h.get("scene", "?")
    # Consecutive samples can re-read the same analyser frame: collapse
    # onsets closer than 50 ms into one event.
    ot = H["t"][H["onset"] > 0]
    events = []
    for t in ot:
        if not events or t - events[-1] > 0.05:
            events.append(float(t))
    H["onsetEvents"] = np.array(events)
    return H


def hear_at(H: dict, t: float) -> dict | None:
    m = (H["t"] >= t - HEAR_WINDOW_S) & (H["t"] <= t + HEAR_WINDOW_S)
    if not m.any():
        return None
    near = H["onsetEvents"]
    return {
        "onset": bool(len(near)) and bool(np.min(np.abs(near - t)) <= HEAR_WINDOW_S),
        "bpm": round(float(np.median(H["bpm"][m])), 1),
        "energy": round(float(H["energy"][m].mean()), 3),
        "section": round(float(H["section"][m].mean()), 3),
    }


def hear_summary(H: dict, D: dict) -> dict:
    tempo, beats = D["tempo"], D["beats"]
    settled = H["t"] >= 2.0
    bpm = H["bpm"][settled]
    valid = bpm > 0
    ratio = bpm[valid] / tempo

    def share(target):
        return float(np.mean(np.abs(ratio - target) <= BPM_LOCK_TOL * target)) if valid.any() else 0.0

    lock = {"x1": round(share(1.0), 2), "half": round(share(0.5), 2), "double": round(share(2.0), 2)}
    lock["other"] = round(max(0.0, 1 - lock["x1"] - lock["half"] - lock["double"]), 2)
    # Onset agreement: recall (reference onsets we also fired on), precision
    # (our onsets that sit on a reference one) and the lag of the matches.
    # Tight window — at 160 bpm a loose one matches everything.
    ref = np.array(D["onsets"])
    ours = H["onsetEvents"]
    lags, hits = [], 0
    for t in ref:
        if len(ours) == 0:
            break
        d = ours - t
        j = int(np.argmin(np.abs(d)))
        if abs(d[j]) <= ONSET_MATCH_S:
            hits += 1
            lags.append(d[j])
    precise = sum(1 for t in ours if len(ref) and np.min(np.abs(ref - t)) <= ONSET_MATCH_S)
    by_rank = {}
    for r in (16, 8, 4, 2, 1):
        sel = [b for b in beats if b["rank"] == r and b.get("ours")]
        if sel:
            by_rank[r] = {"n": len(sel), "hit": sum(1 for b in sel if b["ours"]["onset"])}
    # Section signal: where ours rises, vs the reference's boundaries.
    sec = ndimage.uniform_filter1d(H["section"], 30)
    rises = []
    for i in range(1, len(sec)):
        if sec[i] - sec[max(0, i - 60)] >= 0.4 and (not rises or H["t"][i] - rises[-1] > 1.0):
            rises.append(float(H["t"][i]))
    sec_match = []
    for s in D["sections"]:
        if rises:
            d = min(rises, key=lambda r: abs(r - s["t"])) - s["t"]
            sec_match.append({"beat": s["beat"], "t": s["t"], "oursRiseDelta": round(d, 2) if abs(d) <= 2.0 else None})
        else:
            sec_match.append({"beat": s["beat"], "t": s["t"], "oursRiseDelta": None})
    return {
        "scene": H["scene"], "samples": int(len(H["t"])), "onsets": int(len(ours)), "refOnsets": int(len(ref)),
        "onsetHitRate": round(hits / len(ref), 2) if len(ref) else None,
        "onsetPrecision": round(precise / len(ours), 2) if len(ours) else None,
        "onsetLagMs": int(np.median(lags) * 1000) if lags else None,
        "onsetLagSpreadMs": int(np.std(lags) * 1000) if lags else None,
        "bpmLock": lock, "bpmMedian": round(float(np.median(bpm[valid])), 1) if valid.any() else None,
        "hitByRank": by_rank, "sections": sec_match,
    }


# ---- key frames, sheets, timeline -----------------------------------------------


def font(size: int):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def grab_frames(frames: np.ndarray, beats: list[dict], offsets: list[int], min_rank: int, out: Path) -> None:
    from PIL import Image

    out.mkdir(parents=True, exist_ok=True)
    for b in beats:
        b["frames"] = {}
        if b["rank"] < min_rank:
            continue
        for off in offsets:
            fi = int(round((b["t"] + off / 1000) * VID_FPS))
            if not 0 <= fi < len(frames):
                continue
            name = f"b{b['i']:03d}_r{b['rank']:02d}_{off:+04d}.jpg"
            Image.fromarray(frames[fi]).save(out / name, quality=85)
            b["frames"][str(off)] = f"frames/{name}"


def choose_keyframes(frames: np.ndarray, v: dict, beats: list[dict], trans: list[dict], dur: float, bundle: Path) -> list[dict]:
    """The few frames worth a look: one per visual regime (clusters of
    colour histogram + brightness/saturation/activity), the before/after of
    each transition, and phrase starts not already covered. Saved as
    frames/key_<n>.jpg; the order is the priority order."""
    from PIL import Image

    n = v["n"]
    feat = np.hstack([v["hists"] * 4, zscore(v["bright"])[:, None] * 0.5, zscore(v["sat"])[:, None] * 0.5, zscore(v["act"])[:, None] * 0.5])
    k = int(np.clip(round(dur / 6), 2, 5))
    cent, lab = kmeans2(feat, k, minit="++", seed=0)
    # Budget: every regime (they are the look), then the strongest few
    # transitions as before/after pairs (a pair is one tile of information
    # split in two — never de-duplicate one half against the other), then
    # phrase starts to fill up. Regimes are never de-duplicated either: two
    # regimes can sit a frame apart inside a strobe (flash vs gap).
    picks = []
    for c in range(k):
        members = np.where(lab == c)[0]
        if len(members) == 0:
            continue
        rep = int(members[np.argmin(np.linalg.norm(feat[members] - cent[c], axis=1))])
        picks.append({"t": rep / VIS_FPS, "why": f"regime {len(picks) + 1}: {100 * len(members) / n:.0f}% of the clip", "prio": 0, "pair": None})
    pairs_budget = max(2, (KEY_TILES_MAX - len(picks)) // 2 - 1)
    for pi, tr in enumerate(sorted(trans, key=lambda t: -t["novelty"])[:pairs_budget]):
        f = tr["frame"]
        if tr["kind"] == "strobe":
            f1 = int(tr["tEnd"] * VIS_FPS)
            seg = v["bright"][f : f1 + 1]
            if len(seg) >= 2:
                picks.append({"t": (f + int(np.argmax(seg))) / VIS_FPS, "why": f"strobe {tr['t']:.1f}-{tr['tEnd']:.1f}s: flash", "prio": 1, "pair": pi})
                picks.append({"t": (f + int(np.argmin(seg))) / VIS_FPS, "why": f"strobe {tr['t']:.1f}-{tr['tEnd']:.1f}s: gap", "prio": 1, "pair": pi})
        else:
            picks.append({"t": max(0, f - 2) / VIS_FPS, "why": f"before transition at {tr['t']:.2f}s (beat #{tr['beat']} r{tr['rank']})", "prio": 1, "pair": pi})
            picks.append({"t": min(n - 1, f + 1) / VIS_FPS, "why": f"after transition at {tr['t']:.2f}s", "prio": 1, "pair": pi})
    for b in beats:
        if b["rank"] >= 16:
            picks.append({"t": b["t"], "why": f"phrase start, beat #{b['i']}", "prio": 2, "pair": None})
    picks.sort(key=lambda p: (p["prio"], p["t"]))
    chosen = []
    for p in picks:
        if len(chosen) >= KEY_TILES_MAX:
            break
        if p["prio"] > 0 and any(abs(p["t"] - c["t"]) < 0.4 and (p["pair"] is None or c["pair"] != p["pair"]) for c in chosen):
            continue
        chosen.append(p)
    chosen.sort(key=lambda p: p["t"])
    (bundle / "frames").mkdir(exist_ok=True)
    out = []
    for i, p in enumerate(chosen):
        fi = int(np.clip(round(p["t"] * VID_FPS), 0, len(frames) - 1))
        name = f"frames/key_{i:02d}.jpg"
        Image.fromarray(frames[fi]).save(bundle / name, quality=88)
        bi = int(np.argmin([abs(b["t"] - p["t"]) for b in beats])) if beats else -1
        out.append({"t": round(p["t"], 3), "why": p["why"], "file": name, "beat": bi, "rank": beats[bi]["rank"] if bi >= 0 else 0})
    return out


def write_keyframes_sheet(keys: list[dict], bundle: Path, out: Path, cols: int = 4, tile_h: int = 200) -> None:
    from PIL import Image, ImageDraw

    if not keys:
        return
    import textwrap

    f = font(12)
    with Image.open(bundle / keys[0]["file"]) as im:
        th = min(tile_h, im.height)
        tw = max(150, int(im.width * th / im.height))  # room for the label under a portrait tile
    chars = max(12, tw // 7)
    label_h = 14 * 3 + 6
    rows = math.ceil(len(keys) / cols)
    sheet = Image.new("RGB", (cols * (tw + 6) + 6, rows * (th + label_h + 6) + 6), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate(keys):
        x = 6 + (i % cols) * (tw + 6)
        y = 6 + (i // cols) * (th + label_h + 6)
        with Image.open(bundle / k["file"]) as im:
            iw = int(im.width * th / im.height)
            sheet.paste(im.resize((iw, th), Image.BILINEAR), (x + (tw - iw) // 2, y))
        d.text((x + 2, y + th + 2), f"{k['t']:.2f}s  beat #{k['beat']} r{k['rank']}", fill=(255, 255, 255), font=f)
        for li, line in enumerate(textwrap.wrap(k["why"], chars)[:2]):
            d.text((x + 2, y + th + 16 + li * 14), line, fill=(180, 200, 255), font=f)
    sheet.save(out)


def write_sheets(beats: list[dict], offsets: list[int], bundle: Path, max_rows: int, thumb_h: int = 200) -> list[str]:
    """One row per beat, one column per offset. Thumbs are capped by
    height so a portrait short doesn't make a sheet thousands of px tall."""
    from PIL import Image, ImageDraw

    (bundle / "sheets").mkdir(exist_ok=True)
    written = []
    seen_counts = set()
    label_w = 150
    f_small = font(13)
    for r in (16, 8, 4, 2, 1):
        rows = [b for b in beats if b["rank"] >= r and b["frames"]]
        if not rows or len(rows) in seen_counts:
            continue
        seen_counts.add(len(rows))
        first = next(iter(rows[0]["frames"].values()))
        with Image.open(bundle / first) as im:
            th = min(thumb_h, im.height)
            thumb_w = int(im.width * th / im.height)
        chunks = [rows[i : i + max_rows] for i in range(0, len(rows), max_rows)]
        for ci, chunk in enumerate(chunks):
            W = label_w + thumb_w * len(offsets)
            H = th * len(chunk) + 18
            sheet = Image.new("RGB", (W, H), (18, 18, 22))
            d = ImageDraw.Draw(sheet)
            for c, off in enumerate(offsets):
                d.text((label_w + c * thumb_w + 4, 2), f"{off:+d} ms", fill=(200, 200, 210), font=f_small)
            for ri, b in enumerate(chunk):
                y = 18 + ri * th
                d.text((6, y + 4), f"#{b['i']}  r{b['rank']}", fill=(255, 255, 255), font=f_small)
                d.text((6, y + 22), f"t {b['t']:.2f}s", fill=(200, 200, 210), font=f_small)
                d.text((6, y + 40), f"onset {b['onsetZ']:+.1f}", fill=(255, 190, 120), font=f_small)
                d.text((6, y + 58), f"low {b['lowZ']:+.1f} hi {b['highZ']:+.1f}", fill=(255, 190, 120), font=f_small)
                d.text((6, y + 76), f"act {b['actZ']:+.1f} cut {b['cutZ']:+.1f}", fill=(140, 200, 255), font=f_small)
                if b.get("section"):
                    d.text((6, y + 94), "SECTION", fill=(120, 255, 160), font=f_small)
                for c, off in enumerate(offsets):
                    p = b["frames"].get(str(off))
                    if not p:
                        continue
                    with Image.open(bundle / p) as im:
                        sheet.paste(im.resize((thumb_w, th), Image.BILINEAR), (label_w + c * thumb_w, y))
            name = f"sheets/rank{r}{'' if len(chunks) == 1 else f'-{ci + 1}'}.png"
            sheet.save(bundle / name)
            written.append(name)
    return written


def write_timeline(v: dict, aud: dict, beats: list[dict], trans: list[dict], regimes: list[dict], section_t: np.ndarray,
                   H: dict | None, out: Path) -> None:
    from PIL import Image, ImageDraw

    n = v["n"]
    px = 3
    left, lane_h, gap = 70, 44, 4
    lanes = [
        ("onset", aud["onset_env"], (255, 170, 80)), ("low", aud["low"], (255, 120, 90)),
        ("mid", aud["mid"], (255, 200, 120)), ("high", aud["high"], (255, 235, 170)),
    ]
    if H is not None:
        t = np.arange(n) / VIS_FPS
        ours_energy = np.interp(t, H["t"], H["energy"])
        lanes.append(("ours energy", ours_energy, (140, 255, 220)))
    lanes += [
        ("activity", v["act"], (120, 190, 255)), ("cut", v["cut"], (150, 150, 255)),
        ("bright", v["bright"], (220, 220, 240)), ("sat", v["sat"], (200, 140, 255)),
        ("zoom ±", v["zoom"], (110, 240, 200)), ("rot ±", v["rot"], (240, 200, 110)),
    ]
    W, H_ = left + n * px + 10, 26 + len(lanes) * (lane_h + gap) + 16
    im = Image.new("RGB", (W, H_), (16, 16, 20))
    d = ImageDraw.Draw(im)
    f = font(12)
    for b in beats:
        x = left + int(b["t"] * VIS_FPS * px)
        strength = {16: 255, 8: 190, 4: 130, 2: 70, 1: 40}[b["rank"]]
        d.line([(x, 20), (x, H_ - 16)], fill=(strength, strength, strength), width=1 if b["rank"] < 4 else 2)
    for t in section_t:
        x = left + int(t * VIS_FPS * px)
        d.line([(x, 20), (x, H_ - 16)], fill=(120, 255, 160), width=2)
    for li, (name, series, col) in enumerate(lanes):
        y0 = 26 + li * (lane_h + gap)
        d.text((4, y0 + lane_h // 2 - 7), name, fill=col, font=f)
        s = np.asarray(series, dtype=np.float64)[:n]
        if name.endswith("±"):
            m = np.max(np.abs(s)) + 1e-9
            mid_y = y0 + lane_h // 2
            d.line([(left, mid_y), (left + n * px, mid_y)], fill=(60, 60, 70))
            for i in range(n):
                x = left + i * px
                d.line([(x, mid_y), (x, int(mid_y - s[i] / m * (lane_h // 2 - 1)))], fill=col)
        else:
            lo, hi = float(s.min()), float(s.max()) + 1e-9
            for i in range(n):
                x = left + i * px
                h = int((s[i] - lo) / (hi - lo) * (lane_h - 2))
                d.line([(x, y0 + lane_h - 1), (x, y0 + lane_h - 1 - h)], fill=col)
        if name == "ours energy" and H is not None:
            for t in H["onsetEvents"]:
                x = left + int(t * VIS_FPS * px)
                d.line([(x, y0), (x, y0 + 8)], fill=(255, 255, 255), width=2)
    for tr in trans:
        x = left + int(tr["t"] * VIS_FPS * px)
        if tr["kind"] == "strobe":
            d.rectangle([(x, 10), (left + int(tr["tEnd"] * VIS_FPS * px), 16)], fill=(255, 70, 70))
        else:
            d.polygon([(x - 5, 8), (x + 5, 8), (x, 18)], fill=(255, 70, 70))
    for rg in regimes:
        x = left + int(rg["t"] * VIS_FPS * px)
        d.polygon([(x - 5, H_ - 14), (x + 5, H_ - 14), (x, H_ - 4)], fill=(255, 160, 60))
    for s_ in range(int(n / VIS_FPS) + 1):
        x = left + int(s_ * VIS_FPS * px)
        d.text((x + 2, H_ - 14), f"{s_}s", fill=(120, 120, 130), font=f)
    d.text((left, 2), "red (top) = visual transition, bar = strobe stretch   orange (bottom) = regime change on a bar/phrase beat   "
           "beat lines brighter = higher rank   green = audio section boundary   white ticks on 'ours energy' = our onsets",
           fill=(160, 160, 170), font=f)
    im.save(out)


# ---- findings + report -----------------------------------------------------------


def rank_table(v: dict, beats: list[dict]) -> dict[int, dict[str, float]]:
    zs = {k: zscore(v[k]) for k in ("act", "cut", "bright")}
    zs["abszoom"], zs["absrot"] = zscore(np.abs(v["zoom"])), zscore(np.abs(v["rot"]))
    win = int(VIS_FPS * 0.25) + 1
    out = {}
    for r in (16, 8, 4, 2, 1):
        sel = [b for b in beats if b["rank"] == r]
        if not sel:
            continue
        row = {"n": len(sel)}
        for k in zs:
            vals = [zs[k][int(b["t"] * VIS_FPS) : int(b["t"] * VIS_FPS) + win].max() for b in sel if int(b["t"] * VIS_FPS) + win <= v["n"]]
            row[k] = float(np.mean(vals)) if vals else float("nan")
        out[r] = row
    return out


def correlations(v: dict, aud: dict) -> list[dict]:
    vis = {"zoom": v["zoom"], "abszoom": np.abs(v["zoom"]), "rot": v["rot"], "absrot": np.abs(v["rot"]),
           "activity": v["act"], "cut": v["cut"], "brightness": v["bright"], "sat": v["sat"]}
    au = {"onset": aud["onset_env"], "low": aud["low"], "mid": aud["mid"], "high": aud["high"], "rms": aud["rms"]}
    out = []
    for vk, vv in vis.items():
        for ak, av in au.items():
            lag, r = xcorr(vv, av, VIS_FPS)
            out.append({"visual": vk, "audio": ak, "r": round(r, 2), "lagMs": int(lag / VIS_FPS * 1000)})
    return out


def findings(D: dict, v: dict, aud: dict, rt: dict, corr: list[dict], hs: dict | None) -> list[str]:
    F = []
    has_audio = D["hasAudio"]
    look = D["look"]
    beats, trans, regimes = D["beats"], D["transitions"], D["regimeChanges"]

    def hit_clause(ranks: tuple[int, ...]) -> str:
        if not hs:
            return ""
        n = sum(hs["hitByRank"].get(r, {}).get("n", 0) for r in ranks)
        h = sum(hs["hitByRank"].get(r, {}).get("hit", 0) for r in ranks)
        return f" — ours: onset fires on {h}/{n} of those beats" if n else ""

    # 1. Reaction by rank.
    if has_audio and rt:
        hi = [rt[r] for r in (16, 8, 4) if r in rt]
        lo = [rt[r] for r in (2, 1) if r in rt]
        for k, name in (("bright", "brightness"), ("act", "activity"), ("abszoom", "zoom speed"), ("cut", "colour change")):
            a = np.nanmean([x[k] for x in hi]) if hi else float("nan")
            b = np.nanmean([x[k] for x in lo]) if lo else float("nan")
            if not (np.isnan(a) or np.isnan(b)) and a - b >= RANK_REACT_MARGIN:
                F.append(f"{name} pops harder on bar/phrase beats (z {a:+.2f} on rank ≥4 vs {b:+.2f} on rank ≤2){hit_clause((16, 8, 4))}")
        if 16 in rt and 4 in rt:
            for k, name in (("bright", "brightness"), ("abszoom", "zoom speed"), ("cut", "colour change")):
                if rt[16][k] - rt[4][k] >= RANK_REACT_MARGIN:
                    F.append(f"{name} reacts most at phrase starts (rank 16 z {rt[16][k]:+.2f} vs rank 4 {rt[4][k]:+.2f}){hit_clause((16,))}")
        if not any("bar/phrase" in f or "phrase starts" in f for f in F):
            allr = [rt[r]["act"] for r in rt]
            F.append(f"no beat-rank preference: the picture reacts about the same on every beat (activity z {min(allr):+.2f}..{max(allr):+.2f})")

    # 2. What follows which band, with lag.
    if has_audio:
        best = {}
        for c in corr:
            if abs(c["r"]) >= CORR_MIN and abs(c["lagMs"]) <= LAG_MAX_MS and abs(c["r"]) > abs(best.get(c["visual"], {"r": 0})["r"]):
                best[c["visual"]] = c
        for vk, c in best.items():
            direction = "follows" if c["r"] > 0 else "moves against"
            lag = f"{c['lagMs']:+d} ms" if c["lagMs"] else "no lag"
            F.append(f"{vk} {direction} {c['audio']} (r {c['r']:+.2f}, {lag})")
        if not best:
            F.append(f"no visual metric tracks a band continuously (all |r| < {CORR_MIN}) — the sync, if any, is event-based")

    # 3. Transitions: strobes and singles.
    strobes = [t for t in trans if t["kind"] == "strobe"]
    singles = [t for t in trans if t["kind"] == "single"]
    if strobes:
        spacing_s = float(np.mean([s["spacingS"] for s in strobes]))
        where = "at t " + ", ".join(f"{s['t']:.1f}" for s in strobes)
        if has_audio:
            sp = np.mean([s["spacingBeats"] for s in strobes])
            verdict, _ = strobe_verdict(strobes[0])
            starts = sum(1 for s in strobes if s["onBeat"])
            F.append(f"{len(strobes)} strobe stretch(es), flashes every {spacing_s:.2f} s ≈ {sp:.2f} beat ({verdict}); "
                     f"{starts}/{len(strobes)} start on a beat, {where}")
        else:
            F.append(f"{len(strobes)} strobe stretch(es), flashes every {spacing_s:.2f} s ({1 / spacing_s:.1f} Hz), {where}")
    if singles:
        if has_audio:
            on = [t for t in singles if t["onBeat"] and t["onsetZ"] >= 0.7]
            timer = [t for t in singles if not t["onBeat"] and t["onsetZ"] < 0.7]
            line = f"{len(singles)} single transitions: {len(on)} on a beat with an onset, {len(timer)} off-beat with no onset (timer/scripted)"
            if hs:
                heard = [t for t in singles if t.get("ours")]
                line += f" — ours: onset fired at {sum(1 for t in heard if t['ours']['onset'])}/{len(heard)} of them"
        else:
            line = f"{len(singles)} single transitions at t " + ", ".join(f"{t['t']:.1f}" for t in singles)
        F.append(line)
    if not trans:
        F.append("no discrete transitions: the picture evolves continuously")

    # 4. Sections → regime changes.
    if D["sections"]:
        matched = 0
        for s in D["sections"]:
            if any(abs(r["t"] - s["t"]) <= D["period"] for r in regimes):
                matched += 1
        line = f"picture changes regime at {matched}/{len(D['sections'])} audio section boundaries"
        if hs:
            close = [s for s in hs["sections"] if s["oursRiseDelta"] is not None]
            line += (f" — ours: `section` rises within {max(abs(s['oursRiseDelta']) for s in close):.1f} s at {len(close)}/{len(hs['sections'])} of them"
                     if close else " — ours: `section` shows no rise near any of them")
        F.append(line)
    for rg in regimes:
        if "zoom" in rg["deltas"] and abs(rg["deltas"]["zoom"]) >= 1.2:
            F.append(f"zoom direction changes at beat #{rg['beat']} (r{rg['rank']}, {rg['t']:.1f}s, {rg['deltas']['zoom']:+.1f}σ)")

    # 5. Onset-locked envelope.
    env = D.get("onsetEnvelope") or {}
    for k, name in (("bright", "brightness"), ("act", "activity")):
        e = env.get(k)
        if not e:
            continue
        if e["attackMs"] is None:
            F.append(f"{name} does not flash on onsets (rise z {e['riseZ']:+.2f} over {e['n']} strong onsets)")
        else:
            frame_ms = int(1000 / VIS_FPS)
            attack = f"within one {frame_ms} ms frame" if e["attackMs"] <= frame_ms else f"in ~{e['attackMs']} ms"
            decay = ("does not settle within 0.8 s" if e["decayMs"] is None else
                     f"settles within one frame" if e["decayMs"] <= frame_ms else f"settles in ~{e['decayMs']} ms")
            F.append(f"{name} flashes on onsets: rises z {e['riseZ']:+.2f} {attack}, {decay} ({e['n']} strong onsets averaged)")

    # 6. Beat-phase profile.
    for k, name in (("act", "activity"), ("bright", "brightness"), ("abszoom", "zoom speed")):
        p = (D.get("beatPhase") or {}).get(k)
        if not p:
            continue
        if p["contrast"] >= PHASE_CONTRAST_MIN:
            where = "on the beat" if p["peakPhase"] < 0.13 or p["peakPhase"] > 0.87 else ("on the off-beat" if abs(p["peakPhase"] - 0.5) < 0.13 else f"at phase {p['peakPhase']:.2f}")
            F.append(f"{name} is pulsed, peaking {where} (contrast {p['contrast']:.2f}σ across the beat)")
        else:
            F.append(f"{name} is continuous across the beat (contrast {p['contrast']:.2f}σ)")

    # 7. Continuous motion.
    zs, rs = float(np.std(v["zoom"])) + 1e-9, float(np.std(v["rot"])) + 1e-9
    if abs(look["zoomMean"]) / zs >= MOTION_MIN:
        F.append(f"zooms {'in' if look['zoomMean'] > 0 else 'out'} continuously ({look['zoomMean']:+.3f} log-scale/s, i.e. ×{math.exp(abs(look['zoomMean'])):.2f} per second)")
    if abs(look["rotMean"]) / rs >= MOTION_MIN:
        F.append(f"rotates {'counter-clockwise' if look['rotMean'] > 0 else 'clockwise'} continuously ({math.degrees(look['rotMean']):+.1f}°/s)")

    # 8. Tempo lock.
    if hs:
        lk = hs["bpmLock"]
        F.append(f"ours: tempo at ×1 for {int(lk['x1'] * 100)}% of the clip, ×½ {int(lk['half'] * 100)}%, ×2 {int(lk['double'] * 100)}%, elsewhere {int(lk['other'] * 100)}% "
                 f"(median {hs['bpmMedian']} vs reference {D['tempo']:.1f}); our onset lands within {int(ONSET_MATCH_S * 1000)} ms of "
                 f"{int((hs['onsetHitRate'] or 0) * 100)}% of the reference's onsets, and {int((hs['onsetPrecision'] or 0) * 100)}% of ours sit on one of theirs; "
                 f"lag {hs['onsetLagMs']:+d} ms ±{hs['onsetLagSpreadMs']}"
                 if hs["onsetLagMs"] is not None else
                 f"ours: tempo at ×1 for {int(lk['x1'] * 100)}% of the clip; our onsets never landed within {int(ONSET_MATCH_S * 1000)} ms of the reference's")
    if not has_audio:
        F.insert(0, f"NO USABLE AUDIO ({D['audioNote']}): the beat grid is a uniform {D['tempo']:.0f} bpm placeholder; only the visual findings mean anything")
    return F


def write_report(bundle: Path, D: dict, v: dict, aud: dict, hs: dict | None, sheets: list[str]) -> None:
    rt = rank_table(v, D["beats"])
    corr = correlations(v, aud) if D["hasAudio"] else []
    F = findings(D, v, aud, rt, corr, hs)
    look = D["look"]
    L = [f"# ref bundle: {D['name']}\n"]
    L.append(f"`{D['source']}` — {D['start']:.1f}+{D['dur']:.1f}s. "
             + (f"tempo **{D['tempo']:.1f} bpm** (beat {D['period']:.3f}s), {len(D['beats'])} beats, phrase phase = beat {D['phase']} "
                f"({'given' if D['phaseGiven'] else f'estimated, margin {D['phaseMargin']}σ'}); sections at beats "
                f"{', '.join(str(s['beat']) for s in D['sections']) or '—'}."
                if D["hasAudio"] else f"no usable audio ({D['audioNote']})."))
    if hs:
        L.append(f"Ours heard through `{hs['scene']}`: {hs['samples']} probe samples, {hs['onsets']} onsets vs the reference's {hs['refOnsets']}.")
    L.append("")
    L.append("## Findings\n")
    L.append("Each line is a rule the numbers support; \"ours:\" is what our analyser did at the same moments (one run — a sample, not a spec).\n")
    for f in F:
        L.append(f"- {f}")
    L.append("")

    L.append("## Look, in numbers\n")
    pal = " ".join(f"`{c['hex']}`×{c['share']:.2f}" for c in look["palette"])
    L.append(f"- palette (share of pixels): {pal}")
    s = look["symmetry"]
    parts = []
    if s["fold"] > 1:
        parts.append(f"{s['fold']}-fold rotational symmetry (r {s['foldR']:.2f})")
    if s["mirrorAxes"]:
        parts.append(f"mirror symmetry, ~{s['mirrorAxes']} {'axes' if s['mirrorAxes'] > 1 else 'axis'} (r {s['mirrorR']:.2f})")
    sym = "; ".join(parts) if parts else f"no radial symmetry (rotational r {s['foldR']:.2f}, mirror r {s['mirrorR']:.2f})"
    L.append(f"- {sym}; centre brightness {look['centreBright']:.2f} vs edge {look['edgeBright']:.2f}; mean brightness {look['meanBright']:.2f}, "
             f"dark frames {int(look['darkShare'] * 100)}%; saturation {look['meanSat']:.2f}")
    L.append(f"- motion: zoom mean {look['zoomMean']:+.3f} (|zoom| {look['zoomAbs']:.3f}) log-scale/s, rotation mean {math.degrees(look['rotMean']):+.1f}° "
             f"(|rot| {math.degrees(look['rotAbs']):.1f}°)/s, frame-to-frame activity {look['actMean']:.3f}")
    L.append("")

    if rt:
        L.append("## Reaction per beat rank\n")
        L.append("z-scored metric in the 0..+250 ms window after beats of exactly that rank.\n")
        L.append("| rank | n | activity | cut | brightness | \\|zoom\\| | \\|rot\\| |" + (" ours onset |" if hs else ""))
        L.append("|---|---|---|---|---|---|---|" + ("---|" if hs else ""))
        for r, row in rt.items():
            cells = " | ".join(f"{row[k]:+.2f}" if not np.isnan(row[k]) else "—" for k in ("act", "cut", "bright", "abszoom", "absrot"))
            ours = ""
            if hs:
                hr = hs["hitByRank"].get(r)
                ours = f" {hr['hit']}/{hr['n']} |" if hr else " — |"
            L.append(f"| {r} | {row['n']} | {cells} |{ours}")
        L.append("")

    strong = [c for c in corr if abs(c["r"]) >= CORR_MIN and abs(c["lagMs"]) <= LAG_MAX_MS]
    if strong:
        L.append("## Correlations that clear the noise\n")
        L.append(f"|r| ≥ {CORR_MIN} within ±{LAG_MAX_MS} ms; lag positive = picture follows sound.\n")
        for c in sorted(strong, key=lambda c: -abs(c["r"])):
            L.append(f"- {c['visual']} ~ {c['audio']}: r {c['r']:+.2f} at {c['lagMs']:+d} ms")
        L.append("")

    L.append("## Transitions, with the audio at that moment\n")
    if not D["transitions"]:
        L.append("None above the novelty threshold.\n")
    else:
        L.append("| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        for tr in D["transitions"]:
            L.append(f"| {tr['t']:.2f} | #{tr['beat']} | {tr['offMs']:+d} | {tr['rank']} | {tr['onsetZ']:+.1f} | {tr['lowD']:+.1f} | "
                     f"{tr['midD']:+.1f} | {tr['highD']:+.1f} | {read_transition(tr)} |")
        L.append("")

    if D["regimeChanges"]:
        L.append("## Regime changes on bar/phrase beats\n")
        L.append("Mean metric over the 2 beats after vs the 2 before, in std units.\n")
        for rg in D["regimeChanges"]:
            L.append(f"- beat #{rg['beat']} (r{rg['rank']}, {rg['t']:.2f}s): " + ", ".join(f"{k} {d:+.1f}σ" for k, d in rg["deltas"].items()))
        L.append("")

    ev = [b for b in D["beats"] if b["rank"] >= 4 or b.get("section")]
    if ev and D["hasAudio"]:
        L.append("## Bar and phrase beats\n")
        L.append("| beat | t | rank | onset z | low z | high z | act z | cut z |" + (" ours onset | ours bpm |" if hs else ""))
        L.append("|---|---|---|---|---|---|---|---|" + ("---|---|" if hs else ""))
        for b in ev:
            o = b.get("ours")
            ours = (f" {'yes' if o['onset'] else 'no'} | {o['bpm']:.0f} |" if o else " — | — |") if hs else ""
            L.append(f"| #{b['i']}{' S' if b.get('section') else ''} | {b['t']:.2f} | {b['rank']} | {b['onsetZ']:+.1f} | {b['lowZ']:+.1f} | {b['highZ']:+.1f} | "
                     f"{b['actZ']:+.1f} | {b['cutZ']:+.1f} |{ours}")
        L.append("")

    L.append("## Files\n")
    L.append(f"- `keyframes.png` — {len(D['keyframes'])} tiles: regimes, transition before/after, phrase starts. Open this first.")
    L.append("- `timeline.png` — open when a finding names a time and you want to see the neighbours.")
    top = max(rt, key=lambda r: rt[r]["act"]) if rt else None
    for s in sheets:
        hint = " ← the rank that reacts hardest" if top and s == f"sheets/rank{top}.png" else ""
        L.append(f"- `{s}`{hint}")
    L.append("- `audio.json` — every number above, per beat; `series.tsv` — per frame.")
    if not hs:
        L.append("- no `hears.json` yet: run `node tools/ref-hear.mjs <bundle> --port P`, then `ref-scan.py --report-only --hear <bundle>/hears.json` for the ours: clauses.")
    L.append("")
    (bundle / "report.md").write_text("\n".join(L))


# ---- bundle I/O ----------------------------------------------------------------------


def write_series(bundle: Path, v: dict, aud: dict, beats: list[dict]) -> None:
    rank_at = np.zeros(v["n"], dtype=int)
    for b in beats:
        f0 = int(b["t"] * VIS_FPS)
        if 0 <= f0 < v["n"]:
            rank_at[f0] = max(rank_at[f0], b["rank"])
    with open(bundle / "series.tsv", "w") as fh:
        fh.write("t\tzoom\trot\tact\tbright\tsat\tcut\tonset\tlow\tmid\thigh\trms\tbeatRank\n")
        for i in range(v["n"]):
            fh.write("\t".join([f"{i / VIS_FPS:.3f}", f"{v['zoom'][i]:.4f}", f"{v['rot'][i]:.4f}", f"{v['act'][i]:.4f}", f"{v['bright'][i]:.4f}",
                                f"{v['sat'][i]:.4f}", f"{v['cut'][i]:.4f}", f"{aud['onset_env'][i]:.4f}", f"{aud['low'][i]:.4f}",
                                f"{aud['mid'][i]:.4f}", f"{aud['high'][i]:.4f}", f"{aud['rms'][i]:.4f}", str(rank_at[i])]) + "\n")


def load_series(bundle: Path) -> tuple[dict, dict]:
    S = np.loadtxt(bundle / "series.tsv", skiprows=1)
    cols = ["t", "zoom", "rot", "act", "bright", "sat", "cut", "onset", "low", "mid", "high", "rms", "beatRank"]
    c = {k: S[:, i] for i, k in enumerate(cols)}
    v = {"n": len(S), "zoom": c["zoom"], "rot": c["rot"], "act": c["act"], "bright": c["bright"], "sat": c["sat"], "cut": c["cut"]}
    aud = {"onset_env": c["onset"], "low": c["low"], "mid": c["mid"], "high": c["high"], "rms": c["rms"]}
    return v, aud


def attach_hears(D: dict, H: dict) -> dict:
    for b in D["beats"]:
        b["ours"] = hear_at(H, b["t"])
    for tr in D["transitions"]:
        tr["ours"] = hear_at(H, tr["t"])
    hs = hear_summary(H, D)
    D["hears"] = hs
    return hs


def render_outputs(bundle: Path, D: dict, v: dict, aud: dict, H: dict | None) -> None:
    hs = attach_hears(D, H) if H else None
    section_t = np.array([s["t"] for s in D["sections"]])
    write_keyframes_sheet(D["keyframes"], bundle, bundle / "keyframes.png")
    write_timeline(v, aud, D["beats"], D["transitions"], D["regimeChanges"], section_t, H, bundle / "timeline.png")
    write_report(bundle, D, v, aud, hs, D["sheets"])
    (bundle / "audio.json").write_text(json.dumps(D, indent=1))


# ---- main ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", help="local video file or a URL yt-dlp understands (with --report-only: the bundle name or dir)")
    ap.add_argument("--name", help="bundle name (default: the file stem)")
    ap.add_argument("--out", help="bundle directory (default tools/.cache/refs/<name>)")
    ap.add_argument("--start", type=float, default=0.0, help="clip start, seconds")
    ap.add_argument("--dur", type=float, default=30.0, help="clip length, seconds (0 = to the end; memory grows with it)")
    ap.add_argument("--offsets", default="-80,0,160", help="frame offsets around each beat, ms")
    ap.add_argument("--min-rank", type=int, default=1, help="only grab frames at beats of at least this rank")
    ap.add_argument("--phase", type=int, help="beat index of a phrase start, overriding the estimate")
    ap.add_argument("--bpm", type=float, help="tempo hint for the beat tracker (and the grid for silent video)")
    ap.add_argument("--max-rows", type=int, default=20, help="rows per sheet image before splitting")
    ap.add_argument("--hear", help="hears.json from tools/ref-hear.mjs, to add the ours: clauses")
    ap.add_argument("--report-only", action="store_true", help="rebuild report/timeline/keyframes from an existing bundle")
    args = ap.parse_args()

    if args.report_only:
        p = Path(args.video)
        bundle = p.resolve() if p.exists() and p.is_dir() else CACHE / (args.name or p.stem)
        if not (bundle / "audio.json").exists():
            sys.exit(f"ref-scan: no bundle at {bundle}")
        D = json.loads((bundle / "audio.json").read_text())
        v, aud = load_series(bundle)
        H = load_hears(Path(args.hear)) if args.hear else (load_hears(bundle / "hears.json") if (bundle / "hears.json").exists() else None)
        render_outputs(bundle, D, v, aud, H)
        log(f"rebuilt {bundle / 'report.md'}" + (" with ours: clauses" if H else ""))
        return

    src = resolve_source(args.video)
    name = args.name or src.stem
    bundle = Path(args.out).resolve() if args.out else CACHE / name
    # Clear only what this script writes: `ours-<scene>/` from ref-shoot.mjs
    # and hears.json from ref-hear.mjs survive a rescan (their beat indices
    # may not — if the tempo or phase changed, run them again).
    if bundle.exists():
        for p in bundle.iterdir():
            if p.name.startswith("ours-") or p.name == "hears.json":
                continue
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    bundle.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    dur = min(args.dur if args.dur > 0 else info["duration"], info["duration"] - args.start)
    if dur <= 0:
        sys.exit(f"ref-scan: --start {args.start} is past the end ({info['duration']:.1f}s)")
    offsets = sorted({int(x) for x in args.offsets.split(",")} | {0})

    log(f"{name}: {src.name} {info['width']}x{info['height']} {info['duration']:.1f}s → clip {args.start:.1f}+{dur:.1f}s")
    # Decode at a fixed pixel budget so a portrait short costs the same as a
    # landscape one (30 s ≈ 350 MB in memory either way).
    scale = math.sqrt(FRAME_PIXELS / (info["width"] * info["height"]))
    w = int(round(min(1.0, scale) * info["width"] / 2)) * 2
    h = int(round(min(1.0, scale) * info["height"] / 2)) * 2
    frames = decode_video(src, args.start, dur, w, h)
    log(f"decoded {len(frames)} frames at {VID_FPS} fps ({frames.nbytes / 1e6:.0f} MB)")

    a = None
    audio_note = "no audio stream"
    if info["has_audio"]:
        extract_audio(src, args.start, dur, bundle / "audio.wav")
        a = analyse_audio(bundle / "audio.wav", args.bpm)
        audio_note = "audio is silent or has no beat" if a is None else ""

    if a is not None:
        beat_t = a["beat_t"]
        period = 60.0 / a["tempo"]
        nb = len(beat_t)
        k = int(np.clip(round(nb / 16) + 1, 2, 8))
        import librosa

        bounds = librosa.segment.agglomerative(a["feat_b"], k) if nb > k else np.array([0])
        section_beats = [int(b) for b in bounds if b > 0]
        if args.phase is not None:
            phase, conf, notes = args.phase % MAX_RANK, float("inf"), ["given on the command line"]
        else:
            phase, conf, notes = estimate_phase(a, nb)
        log(f"tempo {a['tempo']:.1f} bpm, {nb} beats, phase {phase} (margin {conf:.2f}σ), sections at beats {section_beats}")
    else:
        bpm = args.bpm or 120.0
        period = 60.0 / bpm
        beat_t = np.arange(0, dur, period)
        nb = len(beat_t)
        section_beats, phase, conf, notes = [], 0, float("nan"), ["uniform grid, no audio"]
        log(f"{audio_note}: uniform {bpm:.0f} bpm grid, {nb} beats")

    log("measuring motion…")
    v = analyse_video(frames)
    if a is not None:
        aud = audio_at_vis_rate(a, v["n"])
    else:
        z_ = np.zeros(v["n"])
        aud = {"onset_env": z_, "low": z_, "mid": z_, "high": z_, "rms": z_}
    section_t = np.array([beat_t[i] for i in section_beats]) if section_beats else np.array([])

    rank = [rank_of(i, phase) for i in range(nb)]
    zaud = {k: zscore(aud[k]) for k in aud}
    zact, zcut = zscore(v["act"]), zscore(v["cut"])
    beats = []
    for i, t in enumerate(beat_t):
        f0 = int(t * VIS_FPS)
        w_ = slice(max(0, f0 - 1), min(v["n"], f0 + 4))
        ok = w_.stop > w_.start
        beats.append({
            "i": i, "t": round(float(t), 4), "rank": rank[i], "section": i in section_beats,
            "onsetZ": round(float(zaud["onset_env"][w_].max()) if ok else 0.0, 2),
            "lowZ": round(float(zaud["low"][w_].mean()) if ok else 0.0, 2),
            "midZ": round(float(zaud["mid"][w_].mean()) if ok else 0.0, 2),
            "highZ": round(float(zaud["high"][w_].mean()) if ok else 0.0, 2),
            "rmsZ": round(float(zaud["rms"][w_].mean()) if ok else 0.0, 2),
            "actZ": round(float(zact[w_].max()) if ok else 0.0, 2),
            "cutZ": round(float(zcut[w_].max()) if ok else 0.0, 2),
        })

    trans = find_transitions(v, beat_t, rank, aud, section_t, period)
    regimes = regime_changes(v, beat_t, rank, period)
    log(f"{len(trans)} transitions, {len(regimes)} regime changes")

    grab_frames(frames, beats, offsets, args.min_rank, bundle / "frames")
    sheets = write_sheets(beats, offsets, bundle, args.max_rows)
    keyframes = choose_keyframes(frames, v, beats, trans, dur, bundle)
    write_series(bundle, v, aud, beats)

    D = {
        "name": name, "source": str(src), "start": args.start, "dur": float(dur), "nframes": int(len(frames)),
        "hasAudio": a is not None, "audioNote": audio_note,
        "tempo": (a["tempo"] if a else (args.bpm or 120.0)), "period": period,
        "phase": int(phase), "phaseGiven": args.phase is not None,
        "phaseMargin": None if math.isinf(conf) or math.isnan(conf) else round(conf, 2), "phaseNotes": notes,
        "offsetsMs": offsets, "visFps": VIS_FPS, "zoomSign": v["sign"],
        "onsets": [round(float(t), 3) for t in (a["onsets_t"] if a else [])],
        "sections": [{"beat": i, "t": round(float(beat_t[i]), 3)} for i in section_beats],
        "beats": beats, "transitions": trans, "regimeChanges": regimes,
        "onsetEnvelope": onset_envelope(v, a["onsets_t"], zaud["onset_env"]) if a else {},
        "beatPhase": beat_phase_profile(v, beat_t, period) if a else {},
        "look": v["look"], "keyframes": keyframes, "sheets": sheets,
    }
    H = None
    hear_path = Path(args.hear) if args.hear else bundle / "hears.json"
    if hear_path.exists():
        H = load_hears(hear_path)
        log(f"joining what ours heard ({hear_path.name})")
    render_outputs(bundle, D, v, aud, H)
    log(f"wrote {bundle}")
    log(f"  read report.md, then keyframes.png, then timeline.png")


if __name__ == "__main__":
    main()
