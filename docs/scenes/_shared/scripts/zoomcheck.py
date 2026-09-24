# Sanity check for refanalyse.py's zoom-sign convention: scales a real frame
# up 5% about the centre and confirms best_shift() reports the expected
# direction. Used while building Kaleidoscope's infinite-zoom styles, but the
# check itself is scene-agnostic (any reference video).
# Rescued from a working session on 2026-09-04. Usage: python3 zoomcheck.py <video.mp4>
# May need adjusting to current code.
import sys, subprocess, tempfile, os
import numpy as np
from scipy import ndimage
video = sys.argv[1]
W = 192
cmd = ["ffmpeg", "-v", "error", "-ss", "5", "-t", "0.1", "-i", video,
       "-vf", f"fps=15,crop=min(iw\\,ih):min(iw\\,ih),scale={W}:{W}", "-pix_fmt", "gray", "-f", "rawvideo", "-"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
f = np.frombuffer(raw[: W * W], dtype=np.uint8).reshape(W, W).astype(np.float32) / 255.0
R, T = 96, 180
cy = cx = (W - 1) / 2
rmax = W / 2 - 1
rhos = np.exp(np.linspace(np.log(2.0), np.log(rmax), R))
thetas = np.linspace(0, 2 * np.pi, T, endpoint=False)
yy = cy + rhos[:, None] * np.sin(thetas)[None, :]
xx = cx + rhos[:, None] * np.cos(thetas)[None, :]
def logpolar(g):
    return ndimage.map_coordinates(g, [yy, xx], order=1, mode="nearest")
# zoom in by 5%: sample the source at coordinates shrunk toward the centre
def scaled(g, s):
    Y, X = np.mgrid[0:W, 0:W].astype(np.float64)
    return ndimage.map_coordinates(g, [cy + (Y - cy) / s, cx + (X - cx) / s], order=1, mode="nearest")
a = logpolar(f); a -= a.mean()
b = logpolar(scaled(f, 1.05)); b -= b.mean()
drho = np.log(rmax / 2.0) / (R - 1)
scores = []
for s in range(-6, 7):
    bb = np.roll(b, s, axis=0)
    lo, hi = max(0, s), R + min(0, s)
    scores.append(np.mean(a[lo:hi] * bb[lo:hi]))
i = int(np.argmax(scores)) - 6
print("zoom-in 5%: best rho shift", i, "bins =", i * drho, "log units (expected +0.0488)")

wav = os.path.join(tempfile.gettempdir(), "zoomcheck-audio.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-ac", "1", "-ar", "8000", wav], check=True)
import wave
w = wave.open(wav); n = w.getnframes(); y = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
sec = 8000
rms = [float(np.sqrt(np.mean(y[i:i + sec] ** 2))) for i in range(0, len(y) - sec, sec)]
print("audio rms per second:", " ".join(f"{r:.3f}" for r in rms))
