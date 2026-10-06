# python3 cutsum.py <out.json> — summarises a realmusic.mjs log for Cut: when
# it cut and how far apart, the Cut signal's hit peaks, where the dotted line
# sat, and the standout detector's learned floor and peak.
import json
import sys

rows = json.load(open(sys.argv[1]))
cuts = []
prev = None
for r in rows:
    if prev is not None and r["cuts"] > prev["cuts"]:
        cuts.append(r["t"])
    prev = r
sig = [r["cutSignal"] for r in rows]
line = [r["cutLine"] for r in rows]
peaks = [b["t"] for a, b, c in zip(rows, rows[1:], rows[2:]) if b["cutSignal"] >= a["cutSignal"] and b["cutSignal"] > c["cutSignal"] and b["cutSignal"] > 0.1]
print("rows", len(rows), "span", rows[0]["t"], "-", rows[-1]["t"])
print("cuts", rows[-1]["cuts"], "at", cuts)
print("signal max", round(max(sig), 3), "peaks>0.1:", len(peaks), peaks[:30])
print("line min/median/max", round(min(line), 3), round(sorted(line)[len(line) // 2], 3), round(max(line), 3))
print("speed median", round(sorted(r["speed"] for r in rows)[len(rows) // 2], 3))
gaps = [round(b - a, 2) for a, b in zip(cuts, cuts[1:])]
print("gaps between cuts", gaps)
if "floor" in rows[0]:
    late = rows[len(rows) // 3 :]
    print("floor median", round(sorted(r["floor"] for r in late)[len(late) // 2], 3), "peak median", round(sorted(r["peak"] for r in late)[len(late) // 2], 3))
# Peaks of the cut signal near each cut vs. the median hit peak.
pk = sorted(b["cutSignal"] for a, b, c in zip(rows, rows[1:], rows[2:]) if b["cutSignal"] >= a["cutSignal"] and b["cutSignal"] > c["cutSignal"] and b["cutSignal"] > 0.1)
if pk:
    print("hit peaks median", round(pk[len(pk) // 2], 3), "count", len(pk))
