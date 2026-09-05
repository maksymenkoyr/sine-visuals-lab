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

Output lands in tools/.cache/refs/<name>/ (gitignored via tools/.cache/):

    audio.wav      the clip's audio, 48 kHz mono s16 — analysed here, and the
                   exact file tools/ref-shoot.mjs feeds into one of *our*
                   scenes as a fake microphone, so both sides hear the same
                   samples from the same t=0.
    audio.json     tempo, the beat grid with each beat's rank (below), what
                   the audio did at every beat, onset events, section
                   boundaries, and the paths of the frames grabbed at it.
    frames/        one JPEG per (beat, offset): b<idx>_r<rank>_<offset ms>.jpg
    sheets/        rank<N>.png — every beat of rank >= N, one row per beat,
                   one column per offset, labelled with beat/time/audio.
                   rank16 shows only phrase starts; rank1 shows everything.
    timeline.png   audio lanes over visual lanes on one time axis, with beat
                   lines by rank and markers for transitions / regime
                   changes / section boundaries — where to look first when
                   asking "what happened at 12.4 s?".
    series.tsv     the per-frame numbers behind the timeline, 15 fps.
    report.md      the findings in prose + tables: what the picture does per
                   beat rank, what it correlates with, and every visual
                   transition annotated with the audio at that moment.

Why frames are taken on beats, not every N seconds: a music visual changes
*at* beats — cuts, flashes, direction flips land on the 1, the bar, the
phrase. Fixed-interval sampling straddles those moments and shows two half
states; sampling at beat ± small offsets (`--offsets`, ms) shows the state
just before, on, and just after the hit, which is what a scene has to
reproduce. Three frames per beat at three ranks beats thirty at random.

Beat rank: counted from the estimated downbeat, a beat's rank is the
largest power of two (up to MAX_RANK) that divides its index — 16 = phrase
start, 8 = half phrase, 4 = bar start, 2 = mid-bar, 1 = the off-beats. A
visual that "changes every 8 beats" shows up as rank-8 beats reading
differently from rank-4 ones in report.md's rank table. Rank is only as
good as the downbeat estimate (kick-weighted onset strength mod 4, then
spectral novelty mod 8 and mod 16); the report prints the confidence, and
`--phase N` (index of a beat you can see is a phrase start) overrides it.

Zoom sign: the motion estimate is a log-polar shift, whose sign depends on
resample conventions that are easy to get backwards. Rather than document a
convention, the script calibrates at run time: it scales frame 0 up by 5 %,
measures the shift, and flips the sign so that positive `zoom` always means
zooming *in*. Rotation is left as radians/s, positive = counter-clockwise on
screen (PIL image coordinates, y down).

Silent videos (no audio stream, or all-zero RMS) still get frames and
motion metrics on a uniform grid at `--bpm` (120 if not given), and the
report says so — don't read sync into a grid that was invented.

Companion: tools/ref-shoot.mjs replays audio.wav into a scene of ours and
shoots the same beats, tiling them beside these frames. The command file
.claude/commands/ref.md walks the whole loop.
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
        run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate",
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
    # Timbre per beat for the downbeat / section estimates below.
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOP)
    feat = np.vstack([zscore_rows(mfcc), zscore_rows(chroma)])
    feat_b = librosa.util.sync(feat, beat_frames, aggregate=np.mean)
    return {
        "sr": sr, "tempo": tempo, "beat_frames": beat_frames, "beat_t": beat_t,
        "onset_env": onset_env[:n], "low": low[:n], "mid": mid[:n], "high": high[:n], "rms": rms[:n],
        "low_flux": low_flux, "onsets_t": onsets_t, "feat_b": feat_b, "n": n,
    }


def zscore_rows(m: np.ndarray) -> np.ndarray:
    return (m - m.mean(axis=1, keepdims=True)) / (m.std(axis=1, keepdims=True) + 1e-9)


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
    return {"n": n, "zoom": zoom, "rot": rot, "act": act, "bright": bright, "sat": sat, "cut": cut, "conf": conf, "sign": sign}


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
            "t": round(t, 3), "novelty": round(float(h), 2), "beat": bi, "rank": rank[bi],
            "offMs": int(round(off * 1000)), "offBeats": round(off / period, 2), "onBeat": bool(on_beat),
            "onsetZ": round(float(z["onset_env"][max(0, p - 1) : p + 2].max()), 2),
            "lowD": round(float(z["low"][i2] - z["low"][i0]), 2),
            "midD": round(float(z["mid"][i2] - z["mid"][i0]), 2),
            "highD": round(float(z["high"][i2] - z["high"][i0]), 2),
            "rmsZ": round(float(z["rms"][p]), 2),
            "section": near_section,
            "brightD": round(float(zscore(v["bright"])[i2] - zscore(v["bright"])[i0]), 2),
            "cutZ": round(float(zscore(v["cut"])[p]), 2),
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


def read_transition(tr: dict) -> str:
    bits = []
    if tr["kind"] == "strobe":
        # Spacing is quantised to the metric frame rate, so "locked to a
        # half beat" can only be claimed to within that resolution — say so.
        res = tr["spacingResBeats"]
        k = min((0.25, 0.5, 1.0, 2.0), key=lambda k: abs(tr["spacingBeats"] - k))
        near = abs(tr["spacingBeats"] - k) <= max(0.08, res) and tr["spacingJitter"] <= max(0.1, res)
        verdict = f"≈ {k:g} beat within the ±{res:.2f}-beat resolution of {VIS_FPS} fps" if near else "no simple fraction of a beat → own timer"
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


# ---- frames, sheets, timeline ---------------------------------------------------


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


def write_timeline(v: dict, aud: dict, beats: list[dict], trans: list[dict], regimes: list[dict], section_t: np.ndarray, out: Path) -> None:
    from PIL import Image, ImageDraw

    n = v["n"]
    px = 3
    left, lane_h, gap = 70, 44, 4
    lanes = [
        ("onset", aud["onset_env"], (255, 170, 80)), ("low", aud["low"], (255, 120, 90)),
        ("mid", aud["mid"], (255, 200, 120)), ("high", aud["high"], (255, 235, 170)),
        ("activity", v["act"], (120, 190, 255)), ("cut", v["cut"], (150, 150, 255)),
        ("bright", v["bright"], (220, 220, 240)), ("sat", v["sat"], (200, 140, 255)),
        ("zoom ±", v["zoom"], (110, 240, 200)), ("rot ±", v["rot"], (240, 200, 110)),
    ]
    W, H = left + n * px + 10, 26 + len(lanes) * (lane_h + gap) + 16
    im = Image.new("RGB", (W, H), (16, 16, 20))
    d = ImageDraw.Draw(im)
    f = font(12)
    # beat lines, taller and brighter with rank
    for b in beats:
        x = left + int(b["t"] * VIS_FPS * px)
        strength = {16: 255, 8: 190, 4: 130, 2: 70, 1: 40}[b["rank"]]
        d.line([(x, 20), (x, H - 16)], fill=(strength, strength, strength), width=1 if b["rank"] < 4 else 2)
    for t in section_t:
        x = left + int(t * VIS_FPS * px)
        d.line([(x, 20), (x, H - 16)], fill=(120, 255, 160), width=2)
    for li, (name, series, col) in enumerate(lanes):
        y0 = 26 + li * (lane_h + gap)
        d.text((4, y0 + lane_h // 2 - 7), name, fill=col, font=f)
        s = np.asarray(series, dtype=np.float64)[:n]
        signed = name.endswith("±")
        if signed:
            m = np.max(np.abs(s)) + 1e-9
            mid_y = y0 + lane_h // 2
            d.line([(left, mid_y), (left + n * px, mid_y)], fill=(60, 60, 70))
            for i in range(n):
                x = left + i * px
                yv = int(mid_y - s[i] / m * (lane_h // 2 - 1))
                d.line([(x, mid_y), (x, yv)], fill=col)
        else:
            lo, hi = float(s.min()), float(s.max()) + 1e-9
            for i in range(n):
                x = left + i * px
                h = int((s[i] - lo) / (hi - lo) * (lane_h - 2))
                d.line([(x, y0 + lane_h - 1), (x, y0 + lane_h - 1 - h)], fill=col)
    for tr in trans:
        x = left + int(tr["t"] * VIS_FPS * px)
        if tr["kind"] == "strobe":
            x1 = left + int(tr["tEnd"] * VIS_FPS * px)
            d.rectangle([(x, 10), (x1, 16)], fill=(255, 70, 70))
        else:
            d.polygon([(x - 5, 8), (x + 5, 8), (x, 18)], fill=(255, 70, 70))
    for rg in regimes:
        x = left + int(rg["t"] * VIS_FPS * px)
        d.polygon([(x - 5, H - 14), (x + 5, H - 14), (x, H - 4)], fill=(255, 160, 60))
    for s_ in range(int(n / VIS_FPS) + 1):
        x = left + int(s_ * VIS_FPS * px)
        d.text((x + 2, H - 14), f"{s_}s", fill=(120, 120, 130), font=f)
    d.text((left, 2), "red (top) = visual transition, bar = strobe stretch   orange (bottom) = regime change on a bar/phrase beat   beat lines brighter = higher rank   green = audio section boundary", fill=(160, 160, 170), font=f)
    im.save(out)


# ---- report ---------------------------------------------------------------------


def write_report(bundle: Path, meta: dict, a: dict | None, v: dict, aud: dict, beats: list[dict], trans: list[dict],
                 regimes: list[dict], section_beats: list[int], sheets: list[str], phase_notes: list[str]) -> None:
    L = []
    L.append(f"# ref bundle: {meta['name']}\n")
    L.append(f"source `{meta['source']}` — start {meta['start']:.1f}s, dur {meta['dur']:.1f}s, {meta['nframes']} frames at {VID_FPS} fps, "
             f"zoom sign calibrated ({'+' if v['sign'] > 0 else '-'}shift = in).\n")
    if a is None:
        L.append(f"**No usable audio** ({meta['audioNote']}). Beats below are a uniform {meta['bpm']:.0f} bpm grid invented for frame "
                 "sampling — do not read sync into them.\n")
    else:
        L.append(f"tempo **{a['tempo']:.1f} bpm** (beat {60 / a['tempo']:.3f}s), {len(beats)} beats, {len(a['onsets_t'])} onset events. "
                 f"Downbeat/phrase phase = beat {meta['phase']} ({'given' if meta['phaseGiven'] else 'estimated'}); "
                 f"section boundaries at beats {', '.join(map(str, section_beats)) or '—'}.\n")
        L.append("Phase estimate: " + "; ".join(phase_notes) + ". Low margin → eyeball `sheets/rank4.png` and re-run with `--phase N`.\n")

    L.append("## What the picture does per beat rank\n")
    L.append("z-scored metric in the 0..+250 ms window after beats of exactly that rank (higher = the picture reacts harder there). "
             "A visual that changes every bar shows rank 4/8/16 well above rank 1/2.\n")
    L.append("| rank | n | activity | cut | brightness | \\|zoom\\| | \\|rot\\| |")
    L.append("|---|---|---|---|---|---|---|")
    zs = {k: zscore(v[k]) for k in ("act", "cut", "bright")}
    zs["abszoom"], zs["absrot"] = zscore(np.abs(v["zoom"])), zscore(np.abs(v["rot"]))
    win = int(VIS_FPS * 0.25) + 1
    for r in (16, 8, 4, 2, 1):
        sel = [b for b in beats if b["rank"] == r]
        if not sel:
            continue
        cells = []
        for k in ("act", "cut", "bright", "abszoom", "absrot"):
            vals = []
            for b in sel:
                f0 = int(b["t"] * VIS_FPS)
                if f0 + win <= v["n"]:
                    vals.append(zs[k][f0 : f0 + win].max())
            cells.append(f"{np.mean(vals):+.2f}" if vals else "—")
        L.append(f"| {r} | {len(sel)} | " + " | ".join(cells) + " |")
    L.append("")

    if a is not None:
        L.append("## Visual ↔ audio cross-correlation\n")
        L.append(f"Best |r| within ±1 s; lag in frames at {VIS_FPS} fps, positive = picture follows sound. Ignore |r| < 0.2.\n")
        vis = {"zoom": v["zoom"], "abszoom": np.abs(v["zoom"]), "rot": v["rot"], "absrot": np.abs(v["rot"]),
               "activity": v["act"], "cut": v["cut"], "brightness": v["bright"], "dbright": np.gradient(v["bright"]), "sat": v["sat"]}
        au = {"onset": aud["onset_env"], "low": aud["low"], "mid": aud["mid"], "high": aud["high"], "rms": aud["rms"], "dlow": np.gradient(aud["low"])}
        L.append("| visual \\ audio | " + " | ".join(au) + " |")
        L.append("|---|" + "---|" * len(au))
        for vk, vv in vis.items():
            row = []
            for ak, av in au.items():
                lag, r = xcorr(vv, av, VIS_FPS)
                row.append(f"**{r:+.2f}@{lag:+d}**" if abs(r) >= 0.2 else f"{r:+.2f}@{lag:+d}")
            L.append(f"| {vk} | " + " | ".join(row) + " |")
        L.append("")

    L.append("## Visual transitions, with the audio at that moment\n")
    if not trans:
        L.append("None above the novelty threshold — the picture evolves continuously. Read the rank table and the correlations instead.\n")
    else:
        L.append("Peaks of frame-to-frame novelty (activity + colour-histogram change); a run of flashes closer than a beat is one "
                 "STROBE row. `off` is the distance to the nearest beat; Δ columns are the z-scored band level change across the "
                 "moment; `read` is a first interpretation, not a verdict.\n")
        L.append("| t | beat | off ms | rank | onset z | low Δ | mid Δ | high Δ | read |")
        L.append("|---|---|---|---|---|---|---|---|---|")
        for tr in trans:
            L.append(f"| {tr['t']:.2f} | #{tr['beat']} | {tr['offMs']:+d} | {tr['rank']} | {tr['onsetZ']:+.1f} | {tr['lowD']:+.1f} | "
                     f"{tr['midD']:+.1f} | {tr['highD']:+.1f} | {read_transition(tr)} |")
        L.append("")

    L.append("## Regime changes on bar/phrase beats\n")
    if not regimes:
        L.append("None — no bar/phrase beat where the following two beats look sustainedly different from the two before.\n")
    else:
        L.append("Mean metric over the 2 beats after vs the 2 before, in std units. A sign flip in `zoom` is a zoom direction change.\n")
        for rg in regimes:
            L.append(f"- beat #{rg['beat']} (r{rg['rank']}, t {rg['t']:.2f}s): " + ", ".join(f"{k} {d:+.1f}σ" for k, d in rg["deltas"].items()))
        L.append("")

    L.append("## Files\n")
    L.append("- `timeline.png` — start here; `series.tsv` has the numbers.")
    for s in sheets:
        L.append(f"- `{s}`")
    L.append("- `audio.json` — beats with rank + audio + frame paths; `audio.wav` — what `tools/ref-shoot.mjs` replays.")
    L.append("")
    (bundle / "report.md").write_text("\n".join(L))


# ---- main ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", help="local video file or a URL yt-dlp understands")
    ap.add_argument("--name", help="bundle name (default: the file stem)")
    ap.add_argument("--out", help="bundle directory (default tools/.cache/refs/<name>)")
    ap.add_argument("--start", type=float, default=0.0, help="clip start, seconds")
    ap.add_argument("--dur", type=float, default=30.0, help="clip length, seconds (0 = to the end; memory grows with it)")
    ap.add_argument("--offsets", default="-80,0,160", help="frame offsets around each beat, ms")
    ap.add_argument("--min-rank", type=int, default=1, help="only grab frames at beats of at least this rank")
    ap.add_argument("--phase", type=int, help="beat index of a phrase start, overriding the estimate")
    ap.add_argument("--bpm", type=float, help="tempo hint for the beat tracker (and the grid for silent video)")
    ap.add_argument("--max-rows", type=int, default=20, help="rows per sheet image before splitting")
    args = ap.parse_args()

    src = resolve_source(args.video)
    name = args.name or src.stem
    bundle = Path(args.out).resolve() if args.out else CACHE / name
    # Clear only what this script writes: an `ours-<scene>/` from
    # tools/ref-shoot.mjs survives a rescan (its beat indices may not — if
    # the tempo or phase changed, shoot again).
    if bundle.exists():
        for p in bundle.iterdir():
            if p.name.startswith("ours-"):
                continue
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    bundle.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    dur = min(args.dur if args.dur > 0 else info["duration"], info["duration"] - args.start)
    if dur <= 0:
        sys.exit(f"ref-scan: --start {args.start} is past the end ({info['duration']:.1f}s)")
    offsets = [int(x) for x in args.offsets.split(",")]
    if 0 not in offsets:
        offsets.append(0)
    offsets.sort()

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
    if a is None and info["has_audio"]:
        # keep the wav so ref-shoot still has something to play, but the grid is invented
        pass

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
        beats.append({
            "i": i, "t": round(float(t), 4), "rank": rank[i], "section": i in section_beats,
            "onsetZ": round(float(zaud["onset_env"][w_].max()) if w_.stop > w_.start else 0.0, 2),
            "lowZ": round(float(zaud["low"][w_].mean()) if w_.stop > w_.start else 0.0, 2),
            "midZ": round(float(zaud["mid"][w_].mean()) if w_.stop > w_.start else 0.0, 2),
            "highZ": round(float(zaud["high"][w_].mean()) if w_.stop > w_.start else 0.0, 2),
            "rmsZ": round(float(zaud["rms"][w_].mean()) if w_.stop > w_.start else 0.0, 2),
            "actZ": round(float(zact[w_].max()) if w_.stop > w_.start else 0.0, 2),
            "cutZ": round(float(zcut[w_].max()) if w_.stop > w_.start else 0.0, 2),
        })

    trans = find_transitions(v, beat_t, rank, aud, section_t, period)
    regimes = regime_changes(v, beat_t, rank, period)
    log(f"{len(trans)} transitions, {len(regimes)} regime changes")

    grab_frames(frames, beats, offsets, args.min_rank, bundle / "frames")
    sheets = write_sheets(beats, offsets, bundle, args.max_rows)
    write_timeline(v, aud, beats, trans, regimes, section_t, bundle / "timeline.png")

    with open(bundle / "series.tsv", "w") as fh:
        fh.write("t\tzoom\trot\tact\tbright\tsat\tcut\tonset\tlow\tmid\thigh\trms\tbeatRank\n")
        rank_at = np.zeros(v["n"], dtype=int)
        for b in beats:
            f0 = int(b["t"] * VIS_FPS)
            if 0 <= f0 < v["n"]:
                rank_at[f0] = max(rank_at[f0], b["rank"])
        for i in range(v["n"]):
            fh.write("\t".join([f"{i / VIS_FPS:.3f}", f"{v['zoom'][i]:.4f}", f"{v['rot'][i]:.4f}", f"{v['act'][i]:.4f}", f"{v['bright'][i]:.4f}",
                                f"{v['sat'][i]:.4f}", f"{v['cut'][i]:.4f}", f"{aud['onset_env'][i]:.4f}", f"{aud['low'][i]:.4f}",
                                f"{aud['mid'][i]:.4f}", f"{aud['high'][i]:.4f}", f"{aud['rms'][i]:.4f}", str(rank_at[i])]) + "\n")

    meta = {
        "name": name, "source": str(src), "start": args.start, "dur": float(dur), "nframes": int(len(frames)),
        "phase": int(phase), "phaseGiven": args.phase is not None, "phaseMargin": None if math.isinf(conf) or math.isnan(conf) else round(conf, 2),
        "audioNote": audio_note, "bpm": (a["tempo"] if a else (args.bpm or 120.0)),
    }
    (bundle / "audio.json").write_text(json.dumps({
        "name": name, "source": str(src), "start": args.start, "dur": float(dur),
        "hasAudio": a is not None, "audioNote": audio_note,
        "tempo": meta["bpm"], "period": period, "phase": int(phase), "phaseMargin": meta["phaseMargin"],
        "offsetsMs": offsets, "visFps": VIS_FPS, "zoomSign": v["sign"],
        "onsets": [round(float(t), 3) for t in (a["onsets_t"] if a else [])],
        "sections": [{"beat": i, "t": round(float(beat_t[i]), 3)} for i in section_beats],
        "beats": beats, "transitions": trans, "regimeChanges": regimes,
    }, indent=1))
    write_report(bundle, meta, a, v, aud, beats, trans, regimes, section_beats, sheets, notes)
    log(f"wrote {bundle}")
    log(f"  read {bundle / 'report.md'} and {bundle / 'timeline.png'} first")


if __name__ == "__main__":
    main()
