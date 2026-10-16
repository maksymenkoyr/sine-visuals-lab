# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "scipy>=1.11", "librosa>=0.10", "soundfile>=0.12"]
# ///
"""Whole-set cadence: when does the *view* change (slow picture regime), and
when does the *track* change (slow audio timbre novelty)? 1 Hz picture
descriptors (8x8 colour thumbnail), checkerboard novelty on both, peaks,
and the nearest-peak distances between the two sets."""
import os, subprocess, sys, numpy as np, librosa, scipy.signal as ss

SRC = sys.argv[1]; OUT = sys.argv[2]
ENV = dict(os.environ, DYLD_FALLBACK_LIBRARY_PATH=os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", ""))
os.makedirs(OUT, exist_ok=True)

# --- picture, 1 Hz, 16x9 RGB
W, H = 16, 9
raw = subprocess.run(["ffmpeg", "-v", "error", "-skip_frame", "nokey", "-i", SRC, "-vf", f"fps=1,scale={W}:{H}",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, env=ENV).stdout
pic = np.frombuffer(raw, np.uint8).reshape(-1, H * W * 3).astype(np.float32) / 255
print("picture frames", len(pic))
# --- audio, 1 Hz MFCC + chroma means
wav = f"{OUT}/mix.wav"
if not os.path.exists(wav):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", SRC, "-vn", "-ac", "1", "-ar", "11025", wav], env=ENV, check=True)
y, sr = librosa.load(wav, sr=11025, mono=True)
mf = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
ch = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=512)
fps = sr / 512
n = int(len(y) / sr)
def per_sec(F):
    return np.stack([F[:, int(i * fps):int((i + 1) * fps)].mean(1) for i in range(n)])
aud = np.hstack([per_sec(mf) / 50, per_sec(ch)])
print("audio seconds", n)

def novelty(X, half):
    X = (X - X.mean(0)) / (X.std(0) + 1e-6)
    out = np.zeros(len(X))
    for i in range(half, len(X) - half):
        a, b = X[i - half:i].mean(0), X[i:i + half].mean(0)
        out[i] = np.linalg.norm(a - b)
    return out
res = {}
for nm, X, half in [("pic", pic, 30), ("aud", aud, 30)]:
    nv = novelty(X, half)
    pk, _ = ss.find_peaks(nv, distance=60, prominence=np.percentile(nv, 85) * 0.5)
    pk = pk[np.argsort(-nv[pk])][:40]
    res[nm] = np.sort(pk)
    np.savetxt(f"{OUT}/{nm}_novelty.txt", nv, fmt="%.3f")
fmt = lambda s: f"{s // 60:02d}:{s % 60:02d}"
print("PICTURE regime changes:", " ".join(fmt(int(s)) for s in res["pic"]))
print("AUDIO track changes   :", " ".join(fmt(int(s)) for s in res["aud"]))
d = [int(np.min(np.abs(res["aud"] - p))) for p in res["pic"]]
print("picture change -> nearest audio change (s):", d)
print("median", np.median(d), "within 20 s:", sum(x <= 20 for x in d), "/", len(d))
# chance baseline: random picture times
rng = np.random.default_rng(0)
rd = [int(np.min(np.abs(res["aud"] - r))) for r in rng.integers(0, n, 2000)]
print("chance median", np.median(rd), "chance within 20 s:", np.mean(np.array(rd) <= 20))
