# Reads a song's beat grid and its first drop → song.json, the clock the whole promo is cut on.
#
#   uv run -q --with librosa --with numpy --with soundfile python tools/promo/song.py <audio> <out.json>
#
# bpm / period: the tempo, refined to a few thousandths by fitting a comb of beats to the onset
#   envelope over the loudest stretch of the track (a tracker's per-beat times jitter by tens of
#   milliseconds; a fitted comb doesn't). The synthetic feed the recorder runs on takes this bpm, so
#   the app's own beat lands where the song's beat does.
# phi: seconds into the song of beat 0 of that comb.
# dropTime: the first comb beat after the intro where the low band (30–120 Hz) comes in hard — the
#   kick that opens the first drop. promo.mjs places it on a chosen video beat.
# Half/double-time is not resolved here: if the fitted bpm is half what you count, pass --bpm.
import json, sys
import librosa, numpy as np

path, out = sys.argv[1], sys.argv[2]
forced = float(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else None

y, sr = librosa.load(path, sr=22050, mono=True)
dur = len(y) / sr
hop = 128
ft = hop / sr
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)

if forced:
    p0 = 60.0 / forced
else:
    tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop, units="time")
    p0 = float(np.median(np.diff(beats)))
    while 60 / p0 < 90: p0 /= 2     # a tracker that counts half-time reports a slow tempo

# the loudest ~90 s: that is where the comb is least ambiguous
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
win = int(90 / ft)
if len(rms) > win:
    cs = np.cumsum(np.insert(rms, 0, 0))
    lo_i = int(np.argmax(cs[win:] - cs[:-win]))
else:
    lo_i = 0
lo, hi = lo_i * ft, min(dur, lo_i * ft + 90)

def score(P, phi):
    ts = np.arange(lo + (phi - lo) % P, hi, P)
    return float(oenv[np.round(ts / ft).astype(int)].mean())

best = (0.0, p0, 0.0)
for P in np.arange(p0 * 0.985, p0 * 1.015, 0.00004):
    for phi in np.arange(0, P, 0.002):
        sc = score(P, phi)
        if sc > best[0]: best = (sc, P, phi)
_, P, phi = best
for phi2 in np.arange(phi - 0.004, phi + 0.004, 0.0005):
    if score(P, phi2) > score(P, phi): phi = phi2
phi %= P

# first drop: first comb beat after 8 s whose low band is above half the track's low-band peak
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop)) ** 2
f = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = S[(f > 30) & (f < 120)].sum(0)
drop = None
k = int(np.ceil((8 - phi) / P))
while phi + k * P < dur - 5:
    i = int((phi + k * P) / ft)
    if low[i:i + 20].max() / low.max() > 0.5:
        drop = phi + k * P
        break
    k += 1

json.dump(dict(file=path, bpm=round(60 / P, 3), period=round(P, 6), phi=round(phi, 4), dropTime=round(drop, 3) if drop else None, duration=round(dur, 1)),
          open(out, "w"), indent=1)
print(open(out).read())
