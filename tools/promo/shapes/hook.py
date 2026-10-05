"""Hook Shape compiler: <work>/lines.json (+ plan.json) -> <work>/cuts.json.

    python3 tools/promo/shapes/hook.py --work DIR [--drop-beat N] [--print-segs]

The hook video opens on the user's look with one line over it, proves the line with short clips from the
drop on, and ends on the opening's scene with the version card (.claude/commands/video-hook-stable.md says
why). This file lays that out on the song's beats, replaying the arithmetic of main's compose.py in the same
order, so the floats match.

Reads <work>: song.json (tempo), lines.json {title, subtitle, opening ('\n' = break), proofs:[{take, beats,
from?, text?}]} (shapes/hook.example.json is a copy), plan.json (optional):

  { "opening": {take, t0}, "look", "end", "hold" }

Defaults: DEFAULTS below. opening = the take (and its start) behind the opening and the end, look =
beats of the opening before the drop, end = the least beats of the end, hold = how many of them show the
opening's scene alone before the version card comes in. A proof
without `text` runs without a caption. The captions end where style.json's storiesBand ends. The drop goes
on the first proof: --drop-beat or look.

--print-segs prints the segments in the shape tools/promo/regress.py compares and writes nothing.
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import cuts


DEFAULTS = dict(opening={"take": "intro", "t0": 0}, look=4, end=16, hold=4)   # what a plan.json key left out falls back to


def compile_hook(work, drop_beat=None):
    sty = cuts.style()
    vid = sty["videos"]["hook"]
    song = cuts.song(work)
    P = 60.0 / song["bpm"]
    FPS = vid["fps"]
    plan = json.load(open(f"{work}/plan.json")) if os.path.exists(f"{work}/plan.json") else {}
    LOOK, END, HOLD = plan.get("look", DEFAULTS["look"]), plan.get("end", DEFAULTS["end"]), plan.get("hold", DEFAULTS["hold"])
    LINES = json.load(open(f"{work}/lines.json"))
    DROP_BEAT = int(drop_beat or LOOK)
    SS = song["dropTime"] - DROP_BEAT * P
    proofs = LINES.get("proofs", [])

    OPENING = plan.get("opening") or DEFAULTS["opening"]
    SEGS = [("opening", (OPENING["take"], OPENING["t0"]), None, LOOK)]
    for i, h in enumerate(proofs):
        SEGS.append(("proof", (h["take"], h.get("from", 0)), i, h["beats"]))
    end = END
    while (sum(sg[3] for sg in SEGS) + end - DROP_BEAT) % 4: end += 1
    SEGS.append(("end", (OPENING["take"], OPENING["t0"]), None, end))
    TOTAL_BEATS = sum(sg[3] for sg in SEGS)

    bottom = sty["storiesBand"]["bottomPx"]
    segments, b0 = [], 0
    for kind, (tk, tb), arg, dur in SEGS:
        layers, text = [], ""
        if kind == "opening":
            if LINES.get("opening"):
                layers = [dict(op="title", png="opening.png")]
            text = (LINES.get("opening") or "").replace("\n", " ")
        elif kind == "proof":
            has = bool(proofs[arg].get("text"))
            prev = arg > 0 and bool(proofs[arg - 1].get("text"))
            layers = [dict(op="caption", png=f"proof_{arg}.png" if has else None, prev=f"proof_{arg - 1}.png" if prev else None,
                           y=None, bottom=bottom)]
            text = proofs[arg].get("text") or ""
        else:
            layers = [dict(op="card", png="version.png", at=HOLD)]
            text = LINES.get("title", "")
        segments.append(cuts.segment(kind, tk, tb, dur, b0, layers, text))
        b0 += dur
    n_frames = round(TOTAL_BEATS * P * FPS)
    d = dict(schema=1, video="hook", work=os.path.abspath(work), renderer=vid["renderer"], fps=FPS, formats=vid["formats"],
             maxSec=vid["maxSec"], lag=vid["lag"], dropBeat=DROP_BEAT,
             song=dict(file=song["file"], bpm=song["bpm"], dropTime=song["dropTime"]),
             frames=dict(ss=SS, totalBeats=TOTAL_BEATS, endBeats=end, nFrames=n_frames, segments=segments))
    return d, SEGS, P


def main(argv):
    if "--work" not in argv:
        sys.exit("usage: hook.py --work DIR [--drop-beat N] [--print-segs]")
    work = os.path.abspath(argv[argv.index("--work") + 1])
    drop = argv[argv.index("--drop-beat") + 1] if "--drop-beat" in argv else None
    d, SEGS, P = compile_hook(work, drop)
    f = d["frames"]
    if "--print-segs" in argv:
        print(json.dumps(dict(segs=[[sg[0], sg[1][0], sg[1][1], sg[3]] for sg in SEGS], totalBeats=f["totalBeats"],
                              endBeats=f["endBeats"], dropBeat=d["dropBeat"], nFrames=f["nFrames"]), indent=1))
        return
    cuts.write_cuts(work, d)
    print(f"{f['totalBeats']} beats ({f['endBeats']} held at the end) = {f['totalBeats'] * P:.3f}s = {f['nFrames']} frames @ {d['fps']}; drop on beat {d['dropBeat']}")


if __name__ == "__main__":
    main(sys.argv[1:])
