"""The resolved cut list every promo video is rendered from, and the helpers that write and read it.

    python3 tools/promo/cuts.py table|cues --work DIR [--fmt v]

A Shape compiler (shapes/<video>.py) turns a video's own input file into <work>/cuts.json; cards.mjs,
compose.py, showcase/edit.py, check.py, promo.mjs, deliver.mjs and this file read it. `table` prints the
approval table (| Time (s) | On screen | Caption | Song @ time |), `cues` writes <work>/CUES.md from the same
rows, so the plan the user approves and the cue sheet cannot drift apart.

cuts.json = {schema:1, video, renderer:'frames'|'graph', work, fps, formats, maxSec, lag:'none'|'take',
dropBeat, song:{file (resolved), bpm, dropTime} (frames only),
frames?:{ss (dropTime - dropBeat*(60.0/bpm)), totalBeats, endBeats, nFrames (round(totalBeats*(60.0/bpm)*fps)),
  list?:{dwell,row},
  segments:[{kind (legacy name: look|version|demo|list|end|opening|proof), take, t0 (take beat),
    beats, start (video beat), backdrop:'take'|'devices', second:'popout'|'tv'|null, camera:'lean'|'steady',
    layers:[{op:'title',png} | {op:'card',png,at} | {op:'caption',png|null,prev|null,y|null,bottom|null}
      | {op:'list',key,n}], text, group}]},
graph?:{songs{id:abs path}, loudnessLufs, caps (abs dir), texts{caption id: text},
  v|h:{V:[[file,in,dur]], A:[[song,start,dur]], C:[[id,from,to]], FADE:{id:fade}, END, bed_len, total,
    anchors:{name:s}}},
cues:[{t0,t1,picture,text,song,songTime}] (v format)}.

The layers, as compose.py draws them: `title` is laid over the frame; `card` fades in from beat `at` of its
segment with the frame dimmed; `caption` slides in as `prev` slides out, over a darkened band, from y (or
ending at `bottom`); `list` is the release scroller for group `key` of `n` rows.

Floats are written with Python's default repr, so they read back exactly: the shapes replay the legacy
arithmetic and a regression compares the lists by repr.

song.json is {file, bpm, period, phi, dropTime, duration, mix?} (song.py or mix.py write it). If its `file`
is gone, <work>/song.wav stands in and a note says so (song()).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def style():
    return json.load(open(os.path.join(HERE, "style.json")))


def song(work):
    s = json.load(open(f"{work}/song.json"))
    if not os.path.exists(s["file"]):
        print(f"note: song.json file {s['file']} is gone; using {work}/song.wav", file=sys.stderr)
        s["file"] = f"{work}/song.wav"
    return s


def write_cuts(work, d):
    d = dict(d)
    d["cues"] = rows(d, "v")
    json.dump(d, open(f"{work}/cuts.json", "w"), indent=1)
    return d


def load_cuts(work):
    return json.load(open(f"{work}/cuts.json"))


def segment(kind, take, t0, beats, start, layers, text="", group=None):
    """One frames-renderer segment; the backdrop and camera follow from the take's name."""
    second = {"cuep": "popout", "room": "tv"}.get(take)
    return dict(kind=kind, take=take, t0=t0, beats=beats, start=start,
                backdrop="devices" if second else "take", second=second,
                camera="lean" if take.startswith("ui_") else "steady", layers=layers, text=text, group=group)


def fmt_t(t):
    return f"{t:.2f}"


def rows(d, fmt="v"):
    """The approval rows: {t0, t1, picture, text, song, songTime} per segment or video piece."""
    out = []
    if d["renderer"] == "frames":
        f = d["frames"]
        P = 60.0 / d["song"]["bpm"]
        name = os.path.basename(d["song"]["file"])
        for sg in f["segments"]:
            pic = sg["take"] if sg["kind"] in ("proof", "demo") else f"{sg['take']} ({sg['kind']})"
            out.append(dict(t0=sg["start"] * P, t1=(sg["start"] + sg["beats"]) * P, picture=pic, text=sg.get("text") or "",
                            song=name, songTime=f["ss"] + sg["start"] * P))
        return out
    g = d["graph"][fmt]
    texts = d["graph"].get("texts", {})
    bed_len = g["bed_len"]
    t = 0.0
    shuffle = 0
    for i, (file, _, dur) in enumerate(g["V"]):
        base = os.path.basename(file)
        pic = base[:-len(f"-{fmt}.mp4")] if base.endswith(f"-{fmt}.mp4") else base
        on = [texts.get(cid, cid) for cid, a, b in g["C"] if a < t + dur - 1e-9 and b > t + 1e-9]
        if t < bed_len - 1e-9:
            sid, start, _ = g["A"][0]
            st = start + t
        else:
            shuffle += 1
            sid, st, _ = g["A"][shuffle]
        out.append(dict(t0=t, t1=t + dur, picture=pic, text=" / ".join(on), song=sid, songTime=st))
        t += dur
    sid, st, _ = g["A"][-1]
    out.append(dict(t0=t, t1=t + g["END"], picture="end card", text=" / ".join(texts.get(cid, cid) for cid, a, b in g["C"] if a < t + g["END"] - 1e-9 and b > t + 1e-9),
                    song=sid, songTime=st + (g["A"][-1][2] - g["END"])))
    return out


def table(cuts, fmt="v"):
    lines = ["| Time (s) | On screen | Caption | Song @ time |", "|---|---|---|---|"]
    for r in rows(cuts, fmt):
        lines.append(f"| {fmt_t(r['t0'])}-{fmt_t(r['t1'])} | {r['picture']} | {r['text']} | {r['song']} @ {fmt_t(r['songTime'])}s |")
    return "\n".join(lines)


def cues(cuts, fmt="v"):
    title = f"# Cue sheet: {cuts['video']}"
    lines = [title, "", "| Video time | Picture | Text | Song | Song time |", "|---|---|---|---|---|"]
    for r in rows(cuts, fmt):
        lines.append(f"| {fmt_t(r['t0'])}-{fmt_t(r['t1'])} | {r['picture']} | {r['text']} | {r['song']} | {fmt_t(r['songTime'])}s |")
    lines += ["", "Picture-to-music offset: run `promo.mjs check` (sync) and copy its numbers here. The songs are commercial and "
              "unlicensed here: check the rights before posting, or use the silent master and add your own sound.", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) < 3 or a[0] not in ("table", "cues") or a[1] != "--work":
        sys.exit("usage: cuts.py table|cues --work DIR [--fmt v]")
    work = os.path.abspath(a[2])
    fmt = a[a.index("--fmt") + 1] if "--fmt" in a else "v"
    c = load_cuts(work)
    if a[0] == "table":
        print(table(c, fmt))
    else:
        open(f"{work}/CUES.md", "w").write(cues(c, fmt))
        print(f"{work}/CUES.md")
