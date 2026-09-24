# Reference-video motion/audio analyser: used while building the Kaleidoscope
# scene's infinite-zoom styles to check what a reference short's camera and
# audio actually do (zoom/rotation rate vs onsets, tempo, cross-correlation).
# Rescued from a working session on 2026-09-04; scene-agnostic (any --scene).
# May need adjusting to current code.
#
# usage: uv run --with numpy,scipy,librosa,pillow python refanalyse.py <video.mp4> <outPrefix> [--start S --dur D]
# Per-frame motion metrics (zoom rate, rotation rate, activity, brightness)
# at 15 fps, audio onset envelope + tempo, and lagged cross-correlation of
# each visual metric with the onset envelope and with the low-band energy.
import sys, subprocess, os, json
import numpy as np
from scipy import ndimage, signal
import librosa

video = sys.argv[1]
out = sys.argv[2]
def opt(k, d):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
start = float(opt("--start", "0"))
dur = float(opt("--dur", "30"))
FPS = 15
W = 192

# ---- frames: raw grey at 15fps, downscaled, square-cropped around the centre
cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", video,
       "-vf", f"fps={FPS},crop=min(iw\\,ih):min(iw\\,ih),scale={W}:{W}", "-pix_fmt", "gray", "-f", "rawvideo", "-"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
n = len(raw) // (W * W)
frames = np.frombuffer(raw[: n * W * W], dtype=np.uint8).reshape(n, W, W).astype(np.float32) / 255.0
print("frames", n)

# log-polar resample so zoom = shift along rho, rotation = shift along theta
R, T = 96, 180
cy = cx = (W - 1) / 2
rmax = W / 2 - 1
rhos = np.exp(np.linspace(np.log(2.0), np.log(rmax), R))
thetas = np.linspace(0, 2 * np.pi, T, endpoint=False)
yy = cy + rhos[:, None] * np.sin(thetas)[None, :]
xx = cx + rhos[:, None] * np.cos(thetas)[None, :]
def logpolar(f):
    return ndimage.map_coordinates(f, [yy, xx], order=1, mode="nearest")
lp = np.stack([logpolar(f) for f in frames])
lp -= lp.mean(axis=(1, 2), keepdims=True)
drho = np.log(rmax / 2.0) / (R - 1)   # log-scale units per rho bin
dth = 2 * np.pi / T

def best_shift(a, b, axis, maxs):
    # sub-bin shift of b relative to a along axis by parabolic peak on correlation
    best = None
    scores = []
    for s in range(-maxs, maxs + 1):
        bb = np.roll(b, s, axis=axis)
        if axis == 0:  # rho isn't periodic: ignore wrapped rows
            lo, hi = max(0, s), R + min(0, s)
            sc = np.mean(a[lo:hi] * bb[lo:hi])
        else:
            sc = np.mean(a * bb)
        scores.append(sc)
    scores = np.array(scores)
    i = int(np.argmax(scores))
    if 0 < i < len(scores) - 1:
        y0, y1, y2 = scores[i - 1], scores[i], scores[i + 1]
        den = (y0 - 2 * y1 + y2)
        frac = 0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0.0
    else:
        frac = 0.0
    return (i - maxs) + frac, scores[i] / (np.sqrt(np.mean(a * a) * np.mean(b * b)) + 1e-9)

zoom = np.zeros(n); rot = np.zeros(n); act = np.zeros(n); conf = np.zeros(n)
bright = frames.mean(axis=(1, 2))
for i in range(1, n):
    a, b = lp[i - 1], lp[i]
    sr, c1 = best_shift(a, b, 0, 6)
    st, c2 = best_shift(a, b, 1, 8)
    # +shift along rho means content moved outward => zooming IN (scale up)
    zoom[i] = sr * drho * FPS          # log-scale units per second
    rot[i] = st * dth * FPS            # radians per second
    conf[i] = max(c1, c2)
    act[i] = np.mean(np.abs(frames[i] - frames[i - 1]))

# ---- audio
wav = out + "-audio.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(dur), "-i", video, "-ac", "1", "-ar", "22050", wav], check=True)
y, sr_ = librosa.load(wav, sr=22050, mono=True)
hop = int(round(sr_ / FPS))
onset = librosa.onset.onset_strength(y=y, sr=sr_, hop_length=hop)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr_, hop_length=hop)
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop)) ** 2
freqs = librosa.fft_frequencies(sr=sr_, n_fft=2048)
def band(lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return np.log1p(S[m].sum(axis=0))
low = band(20, 150); mid = band(150, 2000); high = band(2000, 8000)
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
m = min(n, len(onset), len(low))
onset = onset[:m]; low = low[:m]; mid = mid[:m]; high = high[:m]; rms = rms[:m]
zoom = zoom[:m]; rot = rot[:m]; act = act[:m]; bright = bright[:m]
tempo_v = float(np.atleast_1d(tempo)[0])
print(f"tempo ~{tempo_v:.1f} bpm, {len(beats)} beats")

def z(x):
    x = np.asarray(x, dtype=np.float64)
    return (x - x.mean()) / (x.std() + 1e-9)
def xcorr(a, b, maxlag=15):
    a, b = z(a), z(b)
    res = []
    for lag in range(-maxlag, maxlag + 1):
        if lag >= 0:
            r = np.mean(a[lag:] * b[: len(b) - lag]) if lag < len(a) else 0
        else:
            r = np.mean(a[: lag] * b[-lag:])
        res.append((lag, r))
    best = max(res, key=lambda t: abs(t[1]))
    return best, res

report = {}
vis = {"zoom": zoom, "rot": rot, "activity": act, "brightness": bright,
       "abszoom": np.abs(zoom), "absrot": np.abs(rot),
       "dbright": np.gradient(bright), "dzoom": np.gradient(zoom)}
aud = {"onset": onset, "low": low, "mid": mid, "high": high, "rms": rms, "dlow": np.gradient(low)}
print("\nvisual summary:")
for k, v in vis.items():
    print(f"  {k:10s} mean {v.mean():+.4f} std {v.std():.4f} min {v.min():+.4f} max {v.max():+.4f}")
print(f"  conf mean {conf.mean():.3f}")
print("\ncross-correlation (lag in frames at 15fps; +lag = visual follows audio):")
for vk, vv in vis.items():
    row = []
    for ak, av in aud.items():
        (lag, r), _ = xcorr(vv, av)
        row.append(f"{ak}:{r:+.2f}@{lag:+d}")
        report[f"{vk}~{ak}"] = (lag, r)
    print(f"  {vk:10s} " + "  ".join(row))

# beat-locked average: visual metric averaged in a window around each detected beat
bt = np.array(beats)
bt = bt[(bt > 8) & (bt < m - 8)]
print("\nbeat-locked average (frames -6..+8 around librosa beats), z-scored:")
for vk in ["activity", "abszoom", "absrot", "brightness", "zoom", "dbright"]:
    vz = z(vis[vk])
    prof = np.mean([vz[b - 6: b + 9] for b in bt], axis=0)
    print(f"  {vk:10s} " + " ".join(f"{p:+.2f}" for p in prof))

# time series dump for eyeballing
np.savetxt(out + "-series.tsv",
           np.column_stack([np.arange(m) / FPS, zoom, rot, act, bright, onset, low, mid, high]),
           fmt="%.4f", delimiter="\t", header="t\tzoom\trot\tact\tbright\tonset\tlow\tmid\thigh")
# also autocorrelation of onset and of activity to compare periodicities
def period(x, lo=4, hi=60):
    xz = z(x)
    ac = np.correlate(xz, xz, mode="full")[len(xz) - 1:] / len(xz)
    i = lo + int(np.argmax(ac[lo:hi]))
    return i / FPS, ac[i]
print("\nperiodicity (autocorr peak, seconds):")
for k, v in [("onset", onset), ("low", low), ("activity", act), ("brightness", bright), ("abszoom", np.abs(zoom))]:
    p, a = period(v)
    print(f"  {k:10s} {p:.2f}s (r={a:+.2f})  -> {60/p:.0f} bpm-equivalent")
