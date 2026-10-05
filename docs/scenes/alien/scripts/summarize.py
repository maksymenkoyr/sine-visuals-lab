# python3 summarize.py run.json — per-2s windows: mean speed, cut-signal max, cuts, frames advanced
import json
import sys

rows = json.load(open(sys.argv[1]))
win = 2.0
t_end = rows[-1]["t"]
print(" t0    speed   cutMax  line  loop cuts  headΔ")
t = 0.0
prev = None
while t < t_end:
    w = [r for r in rows if t <= r["t"] < t + win]
    if w:
        sp = sum(r["speed"] for r in w) / len(w)
        cm = max(r["cutSignal"] for r in w)
        cuts = w[-1]["cuts"] - (prev["cuts"] if prev else w[0]["cuts"])
        moved = sum(1 for a, b in zip(w, w[1:]) if a["loop"] == b["loop"] and abs(b["head"] - a["head"]) > 1e-6)
        print(f"{t:5.1f}  {sp:6.3f}  {cm:6.3f}  {w[-1]['cutLine']:.2f}  {w[-1]['loop']}    {cuts:3d}   {moved}/{len(w) - 1} moving")
        prev = w[-1]
    t += win
# Distribution of cut-signal peaks (local maxima above 0.1)
peaks = [b["cutSignal"] for a, b, c in zip(rows, rows[1:], rows[2:]) if b["cutSignal"] >= a["cutSignal"] and b["cutSignal"] > c["cutSignal"] and b["cutSignal"] > 0.1]
peaks.sort()
if peaks:
    q = lambda p: peaks[min(len(peaks) - 1, int(p * len(peaks)))]
    print(f"cut-signal peaks n={len(peaks)} p25={q(0.25):.2f} p50={q(0.5):.2f} p75={q(0.75):.2f} p90={q(0.9):.2f} max={peaks[-1]:.2f}")
