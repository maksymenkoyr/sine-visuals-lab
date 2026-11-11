# Shading against drop size: does a big drop look flatter than a small one?
import json, sys
import numpy as np
root = "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/out/"
rows = {}
for w, key in (("A1", "A"), ("A2", "A"), ("B", "B")):
    for t in json.load(open(root + f"pr_{w}.json"))["tracks_detail"]:
        if t["tilt"] is None: continue
        rows.setdefault(key, []).append((t["fam"], t["r"], t["tilt"], t["peak"], t["falloff"]))
out = {}
bins = [(30, 60), (60, 96), (96, 400)]
for clip, rr in rows.items():
    out[clip] = {}
    for fam in sorted({r[0] for r in rr}):
        f = [r for r in rr if r[0] == fam]
        if len(f) < 4: continue
        out[clip][fam] = {}
        for a, b in bins:
            m = [r for r in f if a <= r[1] < b]
            if len(m) >= 2:
                out[clip][fam][f"{a}-{b}"] = {"n": len(m), "tilt": round(float(np.median([x[2] for x in m])), 3), "peak": round(float(np.median([x[3] for x in m])), 3), "edge_falloff": round(float(np.median([x[4] for x in m])), 3)}
    all_ = np.array([(r[1], r[2], r[3], r[4]) for r in rr])
    lr = np.log(all_[:, 0])
    out[clip]["corr_log_r_vs_tilt_peak_falloff"] = [round(float(np.corrcoef(lr, all_[:, k])[0, 1]), 2) for k in (1, 2, 3)]
    out[clip]["tracks"] = len(rr)
json.dump(out, open(root + "bysize.json", "w"), indent=1)
print(json.dumps(out, indent=0))
