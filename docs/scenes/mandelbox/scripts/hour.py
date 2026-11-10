# Whole-loop low-res pass over a long reference: every shot change (cut vs fade),
# shot lengths, colour and mirror symmetry per shot, and the audio's loudness,
# novelty and pulse clarity on the same time axis -- to see the structure before
# choosing a ref-scan window, and whether shot changes follow the music.
# usage: python hour.py <video_url_file> <audio_url_file> <outdir> <dur_s>
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, signal

FF = "ffmpeg"
FPS = 5
W, H = 64, 36
SR = 22050

vurl = Path(sys.argv[1]).read_text().strip()
aurl = Path(sys.argv[2]).read_text().strip()
out = Path(sys.argv[3])
dur = float(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)


def frames():
    cache = out / "frames.npy"
    if cache.exists():
        return np.load(cache)
    cmd = [FF, "-hide_banner", "-loglevel", "error", "-t", str(dur), "-i", vurl,
           "-vf", f"fps={FPS},scale={W}:{H}:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    f = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    np.save(cache, f)
    return f


def audio():
    cache = out / "audio.npy"
    if cache.exists():
        return np.load(cache)
    cmd = [FF, "-hide_banner", "-loglevel", "error", "-t", str(dur), "-i", aurl,
           "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    np.save(cache, a)
    return a


f = frames()
n = len(f)
t = np.arange(n) / FPS
ff = f.astype(np.float32) / 255
lum = ff @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# joint RGB histogram, 4 bins per channel -> total-variation distance in [0, 1]
q = (f // 64).astype(np.int32)
idx = q[..., 0] * 16 + q[..., 1] * 4 + q[..., 2]
hist = np.stack([np.bincount(i.ravel(), minlength=64) for i in idx]).astype(np.float32) / (W * H)


def tv(a, b):
    return 0.5 * np.abs(a - b).sum(-1)


def corr(a, b):
    a = a - a.mean(axis=(-2, -1), keepdims=True)
    b = b - b.mean(axis=(-2, -1), keepdims=True)
    return (a * b).sum(axis=(-2, -1)) / (np.sqrt((a * a).sum(axis=(-2, -1)) * (b * b).sum(axis=(-2, -1))) + 1e-9)


small = lum.reshape(n, H // 4, 4, W // 4, 4).mean(axis=(2, 4))  # 9x16 structure
step = np.r_[0, tv(hist[1:], hist[:-1])]
stepS = np.r_[0, 1 - corr(small[1:], small[:-1])]
K = 2 * FPS  # compare 2 s before vs 2 s after
D = np.zeros(n)
DS = np.zeros(n)
D[K:-K] = tv(hist[2 * K:], hist[:-2 * K])
DS[K:-K] = 1 - corr(small[2 * K:], small[:-2 * K])
score = D / (np.median(D) + 1e-6) + DS / (np.median(DS) + 1e-6)
mirrorLR = corr(lum, lum[:, :, ::-1])
mirrorTB = corr(lum, lum[:, ::-1, :])

# shot boundaries: peaks of the 4 s-span score, at least 6 s apart, well above the floor
thr = np.median(score) + 4 * (np.percentile(score, 75) - np.percentile(score, 25))
pk, _ = signal.find_peaks(score, height=thr, distance=6 * FPS)
bounds = []
for p in pk:
    lo, hi = max(1, p - K), min(n, p + K + 1)
    st = step[lo:hi]
    total = tv(hist[min(n - 1, p + K)], hist[max(0, p - K)])
    big = st > max(0.04, 0.25 * st.max())
    span_frames = np.flatnonzero(big)
    span = (span_frames[-1] - span_frames[0] + 1) / FPS if len(span_frames) else 0
    share = st.max() / (st.sum() + 1e-9)
    kind = "cut" if share > 0.5 else "fade"
    centre = lo + int(np.argmax(st))
    if kind == "fade" and len(span_frames):
        centre = lo + int((span_frames[0] + span_frames[-1]) / 2)
    bounds.append(dict(t=round(centre / FPS, 1), kind=kind, span=round(span, 1), share=round(float(share), 2),
                       jump=round(float(total), 2), score=round(float(score[p]), 1)))

edges = [0.0] + [b["t"] for b in bounds] + [n / FPS]
shots = []
for a, b in zip(edges[:-1], edges[1:]):
    i0, i1 = int(a * FPS) + FPS, max(int(a * FPS) + FPS + 1, int(b * FPS) - FPS)
    seg = ff[i0:i1]
    m = seg.reshape(-1, 3).mean(0)
    hsv_s = np.ptp(seg.reshape(-1, 3), axis=-1) if False else None
    flow = float(np.median(stepS[i0:i1]))
    shots.append(dict(t0=round(a, 1), dur=round(b - a, 1), rgb="#%02x%02x%02x" % tuple((m * 255).astype(int)),
                      lum=round(float(lum[i0:i1].mean()), 3), mirrorLR=round(float(np.median(mirrorLR[i0:i1])), 2),
                      mirrorTB=round(float(np.median(mirrorTB[i0:i1])), 2), change_per_frame=round(flow, 4)))

# ---- audio
a = audio()
hop = SR // 2  # 0.5 s
na = len(a) // hop
rms = np.sqrt((a[: na * hop].reshape(na, hop) ** 2).mean(1) + 1e-12)
rms_db = 20 * np.log10(rms)
# log-spaced band energies per 0.5 s, then novelty between the 10 s before and after
nfft = 4096
win = np.hanning(nfft).astype(np.float32)
freqs = np.fft.rfftfreq(nfft, 1 / SR)
edges_hz = np.geomspace(40, 10000, 33)
band_of = np.digitize(freqs, edges_hz) - 1
spec = np.zeros((na, 32), np.float32)
for i in range(na):
    s = a[i * hop: i * hop + nfft]
    if len(s) < nfft:
        break
    p = np.abs(np.fft.rfft(s * win)) ** 2
    spec[i] = np.bincount(band_of[(band_of >= 0) & (band_of < 32)], weights=p[(band_of >= 0) & (band_of < 32)], minlength=32)
lspec = np.log10(spec + 1e-9)
L = 20  # 10 s
nov = np.zeros(na)
for i in range(L, na - L):
    x, y = lspec[i - L:i].mean(0), lspec[i:i + L].mean(0)
    nov[i] = np.linalg.norm(x - y)
nthr = np.median(nov) + 3 * (np.percentile(nov, 75) - np.percentile(nov, 25))
apk, _ = signal.find_peaks(nov, height=nthr, distance=20 * 2)
abounds = [round(i / 2, 1) for i in apk]
# quiet gaps (track changes): rms 15 dB under its 60 s running median
med = ndimage.median_filter(rms_db, size=120)
gaps = np.flatnonzero(rms_db < med - 15)
gap_t = []
for g in gaps:
    if not gap_t or g / 2 - gap_t[-1][1] > 2:
        gap_t.append([g / 2, g / 2])
    else:
        gap_t[-1][1] = g / 2

# onset envelope (spectral flux, hop 512) -> pulse clarity per 30 s window
h2, n2 = 512, 1024
m2 = (len(a) - n2) // h2
fr = np.lib.stride_tricks.as_strided(a, shape=(m2, n2), strides=(a.strides[0] * h2, a.strides[0]))
mag = np.log1p(100 * np.abs(np.fft.rfft(fr * np.hanning(n2).astype(np.float32), axis=1)))
flux = np.r_[0, np.maximum(0, np.diff(mag, axis=0)).sum(1)]
fps2 = SR / h2
wlen = int(30 * fps2)
pulse = []
for s0 in range(0, m2 - wlen, wlen):
    x = flux[s0:s0 + wlen] - flux[s0:s0 + wlen].mean()
    ac = np.correlate(x, x, "full")[wlen - 1:]
    ac /= ac[0] + 1e-9
    lo, hi = int(fps2 * 60 / 180), int(fps2 * 60 / 60)
    j = lo + int(np.argmax(ac[lo:hi]))
    pulse.append(dict(t=round(s0 / fps2, 1), clarity=round(float(ac[j]), 2), bpm=round(60 * fps2 / j, 1)))

# agreement: picture boundaries within +-3 s of an audio novelty peak or a gap, vs chance
aud = np.array(abounds + [(g0 + g1) / 2 for g0, g1 in gap_t])
pic = np.array([b["t"] for b in bounds])
tol = 3.0
hit = int(sum(np.any(np.abs(aud - p) <= tol) for p in pic)) if len(aud) else 0
chance = min(1.0, len(aud) * 2 * tol / (n / FPS)) * len(pic)

durs = np.array([s["dur"] for s in shots])
summary = dict(
    frames=n, seconds=n / FPS, shots=len(shots),
    shot_dur=dict(median=float(np.median(durs)), p10=float(np.percentile(durs, 10)), p90=float(np.percentile(durs, 90)),
                  min=float(durs.min()), max=float(durs.max())),
    cuts=sum(b["kind"] == "cut" for b in bounds), fades=sum(b["kind"] == "fade" for b in bounds),
    fade_span_median=float(np.median([b["span"] for b in bounds if b["kind"] == "fade"] or [0])),
    mirrored_LR_share=float(np.mean([s["mirrorLR"] > 0.8 for s in shots])),
    mirrored_TB_share=float(np.mean([s["mirrorTB"] > 0.8 for s in shots])),
    audio_rms_db=dict(p10=float(np.percentile(rms_db, 10)), median=float(np.median(rms_db)), p90=float(np.percentile(rms_db, 90))),
    audio_novelty_peaks=len(abounds), audio_gaps=len(gap_t),
    pulse_clarity_median=float(np.median([p["clarity"] for p in pulse])),
    pic_bounds_near_audio=hit, expected_by_chance=round(chance, 1),
)
json.dump(dict(summary=summary, bounds=bounds, shots=shots, audio_bounds=abounds, audio_gaps=gap_t, pulse=pulse),
          open(out / "hour.json", "w"), indent=1)

# ---- picture: one row per half hour; colour barcode, change score, mirror, rms, novelty, pulse
PX = 2  # seconds per pixel
half = int(np.ceil(n / FPS / 2))
cols = half // PX
lanes = [("colour", 40), ("change", 40), ("mirror LR/TB", 30), ("rms dB", 30), ("audio novelty", 30), ("pulse", 20)]
lane_h = sum(h for _, h in lanes) + 6 * len(lanes)
img = Image.new("RGB", (cols + 90, 2 * (lane_h + 30)), (16, 16, 16))
d = ImageDraw.Draw(img)


def col_of(sec):
    return int(sec // PX)


for row in range(2):
    y0 = row * (lane_h + 30) + 20
    t0 = row * half
    d.text((2, y0 - 16), f"{t0 // 60:.0f}:00 - {(t0 + half) // 60:.0f}:00   (1 px = {PX} s)", fill=(220, 220, 220))
    y = y0
    for name, lh in lanes:
        d.text((cols + 4, y), name, fill=(180, 180, 180))
        for c in range(cols):
            sec = t0 + c * PX
            i = int(sec * FPS)
            ia = int(sec * 2)
            if i >= n:
                break
            x = c
            if name == "colour":
                rgb = tuple(int(v) for v in f[i].reshape(-1, 3).mean(0))
                d.line((x, y, x, y + lh), fill=rgb)
            elif name == "change":
                v = min(1, score[i] / (4 * thr))
                d.line((x, y + lh, x, y + lh - v * lh), fill=(200, 200, 90))
            elif name == "mirror LR/TB":
                for val, colr in ((mirrorLR[i], (90, 200, 255)), (mirrorTB[i], (255, 120, 200))):
                    yy = y + lh - max(0, val) * lh
                    d.point((x, yy), fill=colr)
            elif name == "rms dB" and ia < na:
                v = np.clip((rms_db[ia] + 60) / 60, 0, 1)
                d.line((x, y + lh, x, y + lh - v * lh), fill=(120, 220, 120))
            elif name == "audio novelty" and ia < na:
                v = min(1, nov[ia] / (3 * nthr))
                d.line((x, y + lh, x, y + lh - v * lh), fill=(255, 160, 80))
            elif name == "pulse":
                k = min(len(pulse) - 1, int(sec / 30))
                v = max(0, pulse[k]["clarity"]) if pulse else 0
                d.line((x, y + lh, x, y + lh - v * lh), fill=(200, 120, 255))
        y += lh + 6
    for b in bounds:
        if t0 <= b["t"] < t0 + half:
            x = col_of(b["t"] - t0)
            d.line((x, y0, x, y0 + 86), fill=(255, 255, 255) if b["kind"] == "cut" else (255, 80, 80))
    for ab in abounds:
        if t0 <= ab < t0 + half:
            x = col_of(ab - t0)
            d.line((x, y0 + 86, x, y0 + lane_h), fill=(255, 220, 0))
    for m in range(0, half // 60 + 1, 5):
        x = col_of(m * 60)
        d.text((x, y0 + lane_h - 8), f"{(t0 // 60 + m):.0f}m", fill=(150, 150, 150))
img.save(out / "hour.png")
print(json.dumps(summary, indent=1))
