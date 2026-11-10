# Does the reference's picture follow its audio over the whole loop?
# Morph rate (1 - structure corr frame to frame, 5 fps) and brightness vs the
# audio's loudness and onset flux, at lags; and the hard cuts vs audio events.
# usage: python hour3.py <hour_dir>
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

d = Path(sys.argv[1])
FPS, SR = 5, 22050
f = np.load(d / "frames.npy").astype(np.float32) / 255
a = np.load(d / "audio.npy")
h = json.load(open(d / "hour.json"))
n = len(f)
lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
small = lum.reshape(n, 9, 4, 16, 4).mean(axis=(2, 4)).reshape(n, -1)
z = small - small.mean(1, keepdims=True)
z /= np.linalg.norm(z, axis=1, keepdims=True) + 1e-9
step = np.r_[0, 1 - (z[1:] * z[:-1]).sum(1)]
bright = lum.mean((1, 2))

hop = SR // FPS
na = min(n, len(a) // hop)
rms = np.sqrt((a[: na * hop].reshape(na, hop) ** 2).mean(1) + 1e-12)
db = 20 * np.log10(rms)
# onset flux at 5 fps from a 1024-pt STFT every hop/4, summed per picture frame
n2, h2 = 1024, hop // 4
m2 = (len(a) - n2) // h2
fr = np.lib.stride_tricks.as_strided(a, shape=(m2, n2), strides=(a.strides[0] * h2, a.strides[0]))
mag = np.log1p(100 * np.abs(np.fft.rfft(fr * np.hanning(n2).astype(np.float32), axis=1)))
flux = np.r_[0, np.maximum(0, np.diff(mag, axis=0)).sum(1)]
flux = flux[: (len(flux) // 4) * 4].reshape(-1, 4).sum(1)
m = min(na, len(flux), n)


def sm(x, s):
    return ndimage.uniform_filter1d(x.astype(np.float64), int(s * FPS))


def zc(x):
    return (x - x.mean()) / (x.std() + 1e-12)


print("Pearson r between picture and audio series (both smoothed), audio leading by lag:")
for label, pic in (("morph rate", step[:m]), ("brightness", bright[:m])):
    for s in (0.4, 2, 10):
        row = []
        for aud_label, aud in (("loudness", db[:m]), ("onset flux", flux[:m])):
            best = []
            for lag in (0, 1, 2, 5, 10):
                p, q = zc(sm(pic, s)), zc(sm(aud, s))
                r = float(np.mean(p[lag:] * q[: m - lag]))
                best.append(f"{r:+.2f}")
            row.append(f"{aud_label} lag0/0.2/0.4/1/2s: {' '.join(best)}")
        print(f"  {label:<10} smooth {s:>4}s | " + " | ".join(row))

# shuffle baseline for the strongest: shift the audio by a random offset
rng = np.random.default_rng(0)
p = zc(sm(step[:m], 2))
null = []
for _ in range(200):
    k = rng.integers(60 * FPS, m - 60 * FPS)
    q = zc(sm(np.roll(db[:m], k), 2))
    null.append(np.mean(p * q))
print(f"  null (audio circularly shifted) for morph-vs-loudness@2s: |r| p95 {np.percentile(np.abs(null), 95):.2f}")

# beat-scale: is the morph rate modulated at the music's pulse? spectrum of step around the onset tempo
fl = flux[:m] - flux[:m].mean()
st = step[:m] - step[:m].mean()
cs = np.abs(np.fft.rfft(st * np.hanning(m)))
cf = np.abs(np.fft.rfft(fl * np.hanning(m)))
fq = np.fft.rfftfreq(m, 1 / FPS)
band = (fq > 0.8) & (fq < 2.4)
print(f"\npeak of onset-flux spectrum in 48-144 bpm: {60 * fq[band][np.argmax(cf[band])]:.1f} bpm; "
      f"morph-rate spectrum peak there: {60 * fq[band][np.argmax(cs[band])]:.1f} bpm (ratio to its band median {cs[band].max() / np.median(cs[band]):.1f}x)")

# hard cuts vs audio events
cuts = [869.8, 1678.4, 1841.0, 2741.0, 2768.0, 2861.2, 2893.0, 3297.4, 3600.0]
ab = h["audio_bounds"]
gaps = [(g0 + g1) / 2 for g0, g1 in h["audio_gaps"]]
print("\naudio novelty peaks (s):", ab)
print("audio quiet gaps (s):", [round(g, 1) for g in gaps])
for c in cuts:
    near = [x for x in ab + gaps if abs(x - c) <= 5]
    i = int(c * FPS)
    print(f"  cut {c:7.1f}s ({int(c // 60)}:{c % 60:04.1f}) nearest audio event within 5 s: {near or '-'}; "
          f"loudness {db[max(0, i - 10):i].mean():.1f} -> {db[i:i + 10].mean():.1f} dB")
