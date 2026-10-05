# How much a take moves, and how closely that movement follows the song — the numbers behind
# "this scene looks flat / doesn't sync" (the user's complaint about the first cut's Chladni and
# Physarum footage).
#
#   uv run -q --with numpy --with pillow --with librosa python tools/promo/motion.py <take>… [--from B] [--beats N]
#
# Reads <work>/song.json and <work>/takes/<take>/frames.json (PROMO_WORK, default the cache folder).
# Per take, over beats [from, from+beats) of the take:
#   motion  mean frame-to-frame change of the picture (0..255 grey levels, 90x160 thumbnails)
#   sync    best correlation (−1..1) between the motion envelope and the song's onset strength, over
#           lags of 0..250 ms (the picture follows the sound), with that lag
#   pulse   how much more the picture moves in the quarter-beat after each beat than at other times
#           (1.0 = no beat pulse)
# A take recorded on the song (meta.songT0) is compared at the song time it heard; a synthetic take is
# compared as if beat 0 sat on the song's drop (it pulsed on a grid, not on this music).
import json, os, sys
import numpy as np
from PIL import Image

WORK = os.environ.get("PROMO_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "promo")
args = sys.argv[1:]
opt = lambda k, d: float(args[args.index(k) + 1]) if k in args else d
B_FROM, B_N = opt("--from", 0), opt("--beats", 32)
names = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))]

song = json.load(open(f"{WORK}/song.json"))
P = song["period"]
import librosa
if not os.path.exists(song["file"]):
    print(f"note: song.json file {song['file']} is gone; using {WORK}/song.wav", file=sys.stderr)
    song["file"] = f"{WORK}/song.wav"
y, sr = librosa.load(song["file"], sr=22050, mono=True)
HOP = 256
onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
onset_t = np.arange(len(onset)) * HOP / sr

for name in names:
    d = f"{WORK}/takes/{name}"
    j = json.load(open(f"{d}/frames.json"))
    m = j["meta"]; t0 = m["epochT0"]
    song_at = (lambda t: m["songT0"] + (t - t0)) if m.get("songT0") is not None else (lambda t: song["dropTime"] + (t - t0))
    fr = [f for f in j["frames"] if t0 + B_FROM * P <= f["t"] < t0 + (B_FROM + B_N) * P]
    prev, ts, mv = None, [], []
    for f in fr:
        g = np.asarray(Image.open(f"{d}/{f['file']}").convert("L").resize((90, 160)), dtype=np.float32)
        if prev is not None: ts.append(song_at(f["t"])); mv.append(float(np.abs(g - prev).mean()))
        prev = g
    ts, mv = np.array(ts), np.array(mv)
    grid = np.arange(ts[0], ts[-1], 0.01)
    mot = np.interp(grid, ts, mv)
    best = (-1, 0)
    for lag in range(0, 26):   # ×10 ms
        on = np.interp(grid - lag * 0.01, onset_t, onset)
        c = float(np.corrcoef(mot, on)[0, 1])
        if c > best[0]: best = (c, lag * 10)
    phase = ((grid - song["phi"]) / P) % 1.0
    pulse = mot[phase < 0.25].mean() / max(1e-6, mot[phase >= 0.25].mean())
    kind = "song" if m.get("songT0") is not None else "synthetic"
    print(f"{name:12s} {kind:9s} motion {mv.mean():5.2f}  sync {best[0]:+.2f} @ {best[1]:3d} ms  pulse {pulse:.2f}")
