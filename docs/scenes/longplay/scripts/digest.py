"""Compact digest of every alt-* bundle: header line, Findings, and per regime
(top 3) the hues / stroke / glow / rings+fold / flow lines, trimmed."""
import re, sys, pathlib
R = pathlib.Path(__file__).resolve().parents[4] / "tools" / ".cache" / "refs"
names = sys.argv[1:] or sorted(p.name for p in R.glob("alt-*"))
for n in names:
    rp = R / n / "report.md"
    if not rp.exists():
        print(f"== {n}: no report"); continue
    t = rp.read_text().splitlines()
    print(f"\n== {n}")
    hdr = next((l for l in t if "tempo" in l and "bpm" in l), "")
    m = re.search(r"tempo \*\*([\d.]+) bpm.*?(\d+) beats.*?margin ([\d.]+)", hdr)
    if m: print(f"bpm {m.group(1)} beats {m.group(2)} phase-margin {m.group(3)}")
    sec = None; reg = 0
    for l in t:
        if l.startswith("## "):
            sec = l[3:]
        elif sec == "Findings" and l.startswith("- "):
            print(" F", l[2:][:230])
        elif sec and sec.startswith("Picture") and l.startswith("### Regime"):
            reg += 1
            if reg <= 3: print(" R", re.sub(r" — `.*", "", l[4:]))
        elif sec and sec.startswith("Picture") and reg <= 3 and l.startswith("- "):
            k = l[2:].split(" ")[0]
            if k in ("hues", "stroke", "rings", "flow", "streak") or "lit objects" in l:
                s = l[2:]
                s = re.sub(r"; by r →.*?(;|$)", r"\1", s)
                print("   ", s[:200])
