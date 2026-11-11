# Do the two red-sphere windows show one continuing take? Lines up the large drops of A1's last sample with A2's first.
import json, sys
import numpy as np
A1 = json.load(open(sys.argv[1]))["frames"][-1]; A2 = json.load(open(sys.argv[2]))["frames"][0]
a = [d for d in A1["drops"] if d["r"] >= 24 and not d.get("lens")]; b = [d for d in A2["drops"] if d["r"] >= 24 and not d.get("lens")]
best = (0, None)
for dx in range(-600, 601, 6):
    for dy in range(-400, 401, 6):
        n = 0
        for p in a:
            for q in b:
                if abs(p["x"] + dx - q["x"]) <= 10 and abs(p["y"] + dy - q["y"]) <= 10 and abs(p["r"] - q["r"]) <= 0.12 * p["r"]:
                    n += 1; break
        if n > best[0]: best = (n, (dx, dy))
print(f"A1 last t={A1['t']}  A2 first t={A2['t']}  large drops {len(a)} / {len(b)}; best shared shift {best[1]} px lines up {best[0]} of them")
