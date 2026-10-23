# Signal-level half of the mic-vs-direct comparison: reads a
# tools/mic-gap.mjs session and measures, per segment and per app band
# (bandEdgesHz in audio-subsystem/src/bandScale.ts, passed in with --edges), how the mic
# leg differs from the tab-share leg — delay and its drift, gain, the room's
# noise floor, signal-to-noise, coherence (how much of the mic is the music
# at all), envelope agreement and how much dynamic range survives. The app's
# own detectors run on the same files in tools/mic-gap-analyze.ts.
#
#   uv run -q --with numpy python tools/mic-gap-signal.py <session dir> --edges '[40,…,16000]'
#        [--noise-from <session dir>] [--songs <promo-songs dir>]
#
# Writes <session dir>/signal.json and prints a summary.
import json
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
NFFT = 2048  # the app's analyser size
HOP = 480  # 10 ms frames


def read(path):
    w = wave.open(str(path))
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768


def lag_of(ref, sig, max_lag=SR // 5):
    """Samples by which `sig` trails `ref` (positive = sig later), and how
    clearly: the peak's share of the correlation's energy. Phase-transform
    weighted (GCC-PHAT) — plain correlation of music through a small speaker
    and a room peaks weakly and on the wrong beat subdivision."""
    n = min(len(ref), len(sig))
    a, b = ref[:n], sig[:n]
    x = np.fft.rfft(b, 2 * n) * np.conj(np.fft.rfft(a, 2 * n))
    c = np.fft.irfft(x / (np.abs(x) + 1e-12))
    c = np.concatenate([c[-max_lag:], c[: max_lag + 1]])
    i = int(np.argmax(c))
    return i - max_lag, float(c[i] / (np.sqrt(np.mean(c**2)) * np.sqrt(len(c)) + 1e-12))


def song_time_at_tab0(tab, song_path, song_start):
    """The song's own time at the tab take's first sample, found by matching
    a stretch of the take inside the source file around where the player
    was told to start — so the song's beat grid (song.json) can be placed
    in the take."""
    w = wave.open(str(song_path))
    raw = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768
    src = raw.reshape(-1, w.getnchannels()).mean(axis=1)
    rate = w.getframerate()
    t = np.arange(int((song_start - 2) * SR), int((song_start + 22) * SR)) / SR
    win = np.interp(t, np.arange(len(src)) / rate, src)
    chunk = tab[2 * SR : 17 * SR]
    n = len(win)
    c = np.fft.irfft(np.fft.rfft(win, 2 * n) * np.conj(np.fft.rfft(chunk, 2 * n)))[: n - len(chunk)]
    p = int(np.argmax(c))
    return song_start - 2 + p / SR - 2


def stft_power(x):
    win = 0.42 - 0.5 * np.cos(2 * np.pi * np.arange(NFFT) / NFFT) + 0.08 * np.cos(4 * np.pi * np.arange(NFFT) / NFFT)
    n = (len(x) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    spec = np.fft.rfft(x[idx] * win, axis=1)
    return (np.abs(spec) / NFFT) ** 2


def band_db(power, edges):
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (freqs >= lo) & (freqs < hi)
        if not sel.any():
            sel = np.abs(freqs - (lo + hi) / 2) == np.abs(freqs - (lo + hi) / 2).min()
        out.append(10 * np.log10(power[:, sel].mean(axis=1) + 1e-20))
    return np.stack(out, axis=1)  # frames x bands


def coherence_per_band(a, b, edges, lags, seg=8192):
    """Magnitude-squared coherence, Welch-averaged, then averaged per band.
    Each Welch block takes the mic at its own window's delay (`lags`: one
    per second, samples): the tab capture's delay wanders by tens of ms
    within a take, and one fixed alignment would read that as incoherence."""
    hop = seg // 2
    win = np.hanning(seg)
    n = (min(len(a), len(b)) - seg - SR // 5) // hop
    sxx = syy = sxy = 0
    for k in range(n):
        s = k * hop
        lag = lags[min(len(lags) - 1, s // SR)]
        if s + lag < 0:
            continue
        A = np.fft.rfft(a[s : s + seg] * win)
        B = np.fft.rfft(b[s + lag : s + lag + seg] * win)
        sxx = sxx + np.abs(A) ** 2
        syy = syy + np.abs(B) ** 2
        sxy = sxy + A * np.conj(B)
    coh = np.abs(sxy) ** 2 / (sxx * syy + 1e-30)
    freqs = np.fft.rfftfreq(seg, 1 / SR)
    return [float(coh[(freqs >= lo) & (freqs < hi)].mean()) for lo, hi in zip(edges[:-1], edges[1:])]


def corr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-12))


def sweep_response(tab, mic, edges):
    """Mic over tab, per band, from the sine sweep: the speaker+room+mic
    response with no music spectrum in the way."""
    lag, _ = lag_of(tab, mic)
    if lag > 0:
        mic = mic[lag:]
    n = min(len(tab), len(mic))
    T = np.abs(np.fft.rfft(tab[:n])) ** 2
    M = np.abs(np.fft.rfft(mic[:n])) ** 2
    freqs = np.fft.rfftfreq(n, 1 / SR)
    per_band = [float(10 * np.log10(M[(freqs >= lo) & (freqs < hi)].sum() / (T[(freqs >= lo) & (freqs < hi)].sum() + 1e-30))) for lo, hi in zip(edges[:-1], edges[1:])]
    # A finer curve for the report: 1/6-octave points from 30 Hz to 16 kHz.
    pts = []
    f = 30.0
    while f < 16000:
        lo, hi = f / 2 ** (1 / 12), f * 2 ** (1 / 12)
        sel = (freqs >= lo) & (freqs < hi)
        pts.append([round(f, 1), float(10 * np.log10(M[sel].sum() / (T[sel].sum() + 1e-30)))])
        f *= 2 ** (1 / 6)
    return {"lagMs": lag / SR * 1000, "bands": per_band, "curve": pts}


def main():
    d = Path(sys.argv[1])
    edges = json.loads(sys.argv[sys.argv.index("--edges") + 1])
    session = json.loads((d / "session.json").read_text())
    noise_dir = Path(sys.argv[sys.argv.index("--noise-from") + 1]) if "--noise-from" in sys.argv else d
    noise_mic = read(noise_dir / "noise.mic.wav")
    # A session sits in tools/.cache/mic-gap/<stamp>, beside promo-songs.
    songs_dir = Path(sys.argv[sys.argv.index("--songs") + 1]) if "--songs" in sys.argv else d.parent.parent / "promo-songs"
    noise_bands = band_db(stft_power(noise_mic[SR:]), edges)  # skip the first second (track start)
    noise = {
        "rmsDb": float(20 * np.log10(np.sqrt(np.mean(noise_mic[SR:] ** 2)) + 1e-12)),
        "bandsDb": np.median(noise_bands, axis=0).tolist(),
    }
    out = {"edges": edges, "noise": noise, "sweeps": {}, "songs": []}
    for seg in session["segments"]:
        if seg["kind"] == "noise":
            continue
        tab = read(d / f"{seg['name']}.tab.wav")
        mic = read(d / f"{seg['name']}.mic.wav")
        if seg["kind"] == "sweep":
            out["sweeps"][str(seg["volume"])] = sweep_response(tab, mic, edges)
            continue
        song_at_tab0 = song_time_at_tab0(tab, songs_dir / f"{seg['song']}.wav", seg["songStart"])
        # Skip the start (the player seeking) and line the legs up on the global lag.
        tab, mic = tab[SR:], mic[SR:]
        lag, peak = lag_of(tab, mic)
        windows = []
        for s in range(0, min(len(tab), len(mic)) - 3 * SR, SR):
            l, p = lag_of(tab[s : s + 3 * SR], mic[s : s + 3 * SR], max_lag=SR // 10)
            windows.append([s / SR, l / SR * 1000, p])
        # One delay per second for the coherence blocks: each window's own,
        # median-filtered over five so one ambiguous window can't jump it.
        raw = np.array([w[1] for w in windows]) * SR / 1000
        lags = [int(np.median(raw[max(0, i - 2) : i + 3])) for i in range(len(raw))] or [lag]
        if lag > 0:
            mic_a, tab_a = mic[lag:], tab[: len(mic) - lag]
        else:
            mic_a, tab_a = mic, tab
        n = min(len(mic_a), len(tab_a))
        mic_a, tab_a = mic_a[:n], tab_a[:n]
        bt = band_db(stft_power(tab_a), edges)
        bm = band_db(stft_power(mic_a), edges)
        loud = bt >= np.percentile(bt, 50, axis=0)
        gain = [float(np.median((bm - bt)[loud[:, b], b])) for b in range(bt.shape[1])]
        music_mic = [float(np.percentile(bm[:, b], 75)) for b in range(bt.shape[1])]
        snr = [m - nz for m, nz in zip(music_mic, noise["bandsDb"])]
        flux_t = np.maximum(np.diff(bt, axis=0), 0)
        flux_m = np.maximum(np.diff(bm, axis=0), 0)
        out["songs"].append({
            "name": seg["name"], "song": seg["song"], "bpm": seg["bpm"], "period": seg["period"], "phi": seg["phi"], "volume": seg["volume"],
            "songTimeAtTab0": song_at_tab0,
            "lagMs": lag / SR * 1000, "lagPeak": peak,
            "lagWindows": windows,
            "rmsDb": {"tab": float(20 * np.log10(np.sqrt(np.mean(tab_a ** 2)) + 1e-12)), "mic": float(20 * np.log10(np.sqrt(np.mean(mic_a ** 2)) + 1e-12))},
            "crestDb": {k: float(20 * np.log10(np.abs(x).max() / (np.sqrt(np.mean(x ** 2)) + 1e-12))) for k, x in (("tab", tab_a), ("mic", mic_a))},
            "gainDb": gain,
            "snrDb": snr,
            "coherence": coherence_per_band(tab, mic, edges, lags),
            "coherenceFixedLag": coherence_per_band(tab, mic, edges, [lag]),
            "levelCorr": [corr(bt[:, b], bm[:, b]) for b in range(bt.shape[1])],
            "fluxCorr": [corr(flux_t[:, b], flux_m[:, b]) for b in range(bt.shape[1])],
            "rangeDb": {
                "tab": [float(np.percentile(bt[:, b], 90) - np.percentile(bt[:, b], 10)) for b in range(bt.shape[1])],
                "mic": [float(np.percentile(bm[:, b], 90) - np.percentile(bm[:, b], 10)) for b in range(bt.shape[1])],
            },
        })
    (d / "signal.json").write_text(json.dumps(out))

    def row(label, vals, fmt="{:6.1f}"):
        print(f"{label:>14} " + " ".join(fmt.format(v) for v in vals))

    print("band Hz        " + " ".join(f"{int(e):>6}" for e in edges[:-1]))
    row("noise dBFS", noise["bandsDb"])
    for v, s in out["sweeps"].items():
        row(f"sweep v{v} dB", s["bands"])
    for v in sorted({s["volume"] for s in out["songs"]}):
        songs = [s for s in out["songs"] if s["volume"] == v]
        mean = lambda k: np.mean([s[k] for s in songs], axis=0)
        print(f"-- volume {v}: lag {np.mean([s['lagMs'] for s in songs]):.1f} ms, rms tab {np.mean([s['rmsDb']['tab'] for s in songs]):.1f} mic {np.mean([s['rmsDb']['mic'] for s in songs]):.1f}")
        row("gain dB", mean("gainDb"))
        row("snr dB", mean("snrDb"))
        row("coherence", mean("coherence"), "{:6.2f}")
        row("flux corr", mean("fluxCorr"), "{:6.2f}")
        row("range tab", np.mean([s["rangeDb"]["tab"] for s in songs], axis=0))
        row("range mic", np.mean([s["rangeDb"]["mic"] for s in songs], axis=0))
    for s in out["songs"]:
        w = np.array(s["lagWindows"])
        good = w[w[:, 2] > np.median(w[:, 2])]
        print(f"{s['name']:>22} lag {s['lagMs']:6.1f} ms (peak {s['lagPeak']:.2f}); windows {np.median(good[:,1]) if len(good) else float('nan'):.1f} ms ±{np.std(good[:,1]) if len(good) else float('nan'):.1f}, crest tab {s['crestDb']['tab']:.1f} mic {s['crestDb']['mic']:.1f}")


main()
