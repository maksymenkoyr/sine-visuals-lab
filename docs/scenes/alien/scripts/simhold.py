# python3 simhold.py key line run.json[:t0:t1] ... — rising crossing over the line, at most once per hold
import json
import sys

key, line = sys.argv[1], float(sys.argv[2])
for spec in sys.argv[3:]:
    path, *rng = spec.split(":")
    t0, t1 = (float(rng[0]), float(rng[1])) if rng else (0, 1e9)
    rows = [r for r in json.load(open(path)) if "sig" in r and t0 <= r["t"] < t1]
    span = rows[-1]["t"] - rows[0]["t"]
    out = []
    for hold in (0, 1.5, 2.0, 3.0):
        cuts, prev, last = [], None, -1e9
        for r in rows:
            v = r["sig"][key]
            if prev is not None and prev <= line < v and r["t"] - last >= hold:
                cuts.append(r["t"])
                last = r["t"]
            prev = v
        gaps = sorted(b - a for a, b in zip(cuts, cuts[1:]))
        med = gaps[len(gaps) // 2] if gaps else float("nan")
        mx = gaps[-1] if gaps else float("nan")
        out.append(f"hold {hold}: {len(cuts) * 60 / span:3.0f}/min med {med:4.1f} max {mx:4.1f}")
    print(f"{spec:18s}", " | ".join(out))
