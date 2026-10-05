"""Regression tooling for the promo engine: proves a rebuilt step reproduces an approved one.

    uv run -q --with numpy --with pillow==12.3.0 --with imageio-ffmpeg==0.6.0 --with soundfile --with pyloudnorm \
        python tools/promo/regress.py <subcommand> ...        (run from the repo root; the pins are the versions that made the masters)

One file holds every comparison the promo engine's rebuilds were proved with. Baseline code is a `git archive` copy
of an approved revision (tools/promo plus public/icon-512.png) under tools/.cache/promo-baseline/<rev>/, so
the old scripts run unchanged and find the logo three levels above themselves. Regression data is cloned
into tools/.cache/promo/regress/<name>/, never edited in place.

Building and running the old code
  clone SRC DST [--skip a,b] [--rename a=b]   Copy a work dir: media is hard-linked (nothing is duplicated),
                                    json, txt and md are copied, cards/ is copied (a card renderer rewrites
                                    its PNGs in place, which would reach the original through a link).
                                    --skip names top-level folders to leave out, --rename renames one.
  fix-song WORK                     Points WORK/song.json "file" at WORK/song.wav (the cached file's recorded
                                    path is a dead worktree).
  legacy WORK SCRIPT [--env K=V]... [--stdout FILE] [-- args]
                                    Runs a baseline .mjs (node) or .py (this python) with PROMO_WORK=WORK,
                                    cwd at the repo root, stdio inherited (or stdout to FILE).
  legacy-edit-args EDITPY CONFIG FMT OUT.json [--no-run]
                                    Runs a baseline showcase edit.py with its subprocess.run wrapped, and
                                    saves the ffmpeg argument list it built to OUT.json. --no-run builds the
                                    arguments and the cut list but encodes nothing.
  segs-legacy COMPOSE WORK [--drop-beat N] [--out FILE]
                                    Executes a baseline compose.py up to its frames section and prints the
                                    segment list, total and end beats, drop beat and frame count as json.
                                    Proves what a Shape compiler must reproduce.

Comparing results
  frames A B / pngs A B [--ignore GLOB]
                                    md5 per file over two folders; on any difference prints how many files
                                    differ, the first name and the max abs pixel difference, and exits 1.
                                    frames proves a renderer, pngs proves a card renderer.
  video A B                         framemd5 of the picture and md5 of the audio of two encodes; for encodes
                                    with no rate control (edit.py), where equal input must give equal bits.
  psnr A B                          Frame counts, durations and per-frame PSNR (min, mean) of two encodes of
                                    the same picture; for encodes that vary run to run (x264 with VBV).
  repeats FILE [--from S]           Share of consecutive frames that read as repeats (check.py repeats rule).

Stand-ins for media that no longer exist (the explainer's approved clips)
  standins CONFIG LISTS_PATTERN OUT
                                    From the real explainer config (CONFIG) builds test-pattern clips, wiring
                                    takes, intro and gallery files, with the real songs' audio, and writes
                                    showcase.C0.json / showcase.C1.json for two work dirs beside OUT.
                                    LISTS_PATTERN is the approved cut lists' path with {fmt} in it.
  v10-lists CONFIG LISTS_PATTERN OUT
                                    Runs the baseline cut arithmetic on CONFIG with the approved cut's own
                                    intro and gallery lengths and compares the cut list with the approved
                                    video's (informational: that video came from another script).

Looking
  sheet A B --beats b1,b2,... OUT.png
                                    Two takes side by side, the frame nearest each beat of each.
  strip VIDEO [--n N] OUT.png       A labelled contact sheet of one video at even times.
"""
import fnmatch, glob, hashlib, json, math, os, re, runpy, shutil, subprocess, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BASELINE = os.path.join(REPO, "tools", ".cache", "promo-baseline")
SIZES = {"v": (1080, 1920), "h": (1920, 1080)}
TEXT_EXT = (".json", ".txt", ".md")


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def flag(argv, name, default=None):
    """Pops `name value` out of argv and returns the value."""
    if name in argv:
        i = argv.index(name)
        v = argv[i + 1]
        del argv[i:i + 2]
        return v
    return default


def flags(argv, name):
    out = []
    while name in argv:
        out.append(flag(argv, name))
    return out


# ---- building and running -----------------------------------------------------------------------------

def link_or_copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def clone(argv):
    skip = [s for s in (flag(argv, "--skip") or "").split(",") if s]
    renames = dict(r.split("=", 1) for r in flags(argv, "--rename"))
    src, dst = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    n = [0, 0]
    for root, _, files in os.walk(src):
        rel = os.path.relpath(root, src)
        top = "" if rel == "." else rel.split(os.sep)[0]
        if top in skip:
            continue
        rel_out = rel if not top else os.path.join(renames.get(top, top), *rel.split(os.sep)[1:])
        for f in files:
            to = os.path.normpath(os.path.join(dst, rel_out, f))
            if f.endswith(TEXT_EXT) or top == "cards":
                os.makedirs(os.path.dirname(to), exist_ok=True)
                shutil.copy2(os.path.join(root, f), to)
                n[1] += 1
            else:
                link_or_copy(os.path.join(root, f), to)
                n[0] += 1
    print(f"clone {src} -> {dst}: {n[0]} linked, {n[1]} copied")


def fix_song(argv):
    work = os.path.abspath(argv[0])
    p = f"{work}/song.json"
    j = json.load(open(p))
    j["file"] = f"{work}/song.wav"
    json.dump(j, open(p, "w"), indent=1)
    print("song.json file ->", j["file"])


def legacy(argv):
    work, script = os.path.abspath(argv[0]), argv[1]
    rest = argv[2:]
    extra = [a for a in rest[:rest.index("--")]] if "--" in rest else rest
    passed = rest[rest.index("--") + 1:] if "--" in rest else []
    env = dict(os.environ, PROMO_WORK=work)
    stdout_file = flag(extra, "--stdout")
    for kv in flags(extra, "--env"):
        k, v = kv.split("=", 1)
        env[k] = v
    cmd = (["node"] if script.endswith(".mjs") else [sys.executable]) + [script] + passed
    out = open(stdout_file, "w") if stdout_file else None
    try:
        run(cmd, env=env, cwd=REPO, stdout=out)
    finally:
        if out:
            out.close()


def segs_legacy(argv):
    drop = flag(argv, "--drop-beat")
    outf = flag(argv, "--out")
    compose, work = argv[0], os.path.abspath(argv[1])
    src = open(compose).read().split("\n")
    cut = next(i for i, l in enumerate(src) if l.startswith("# ---- frames"))
    old = {k: os.environ.get(k) for k in ("PROMO_WORK", "DROP_BEAT")}
    os.environ["PROMO_WORK"] = work
    if drop is not None:
        os.environ["DROP_BEAT"] = drop
    else:
        os.environ.pop("DROP_BEAT", None)
    g = {"__file__": os.path.abspath(compose), "__name__": "legacy_compose"}
    try:
        exec(compile("\n".join(src[:cut]), compose, "exec"), g)
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    segs = [[sg[0], sg[1][0], sg[1][1], sg[3]] for sg in g["SEGS"]]
    res = dict(segs=segs, totalBeats=g["TOTAL_BEATS"], endBeats=g["end"], dropBeat=g["DROP_BEAT"],
               nFrames=round(g["TOTAL_BEATS"] * g["P"] * 30))
    text = json.dumps(res, indent=1)
    if outf:
        open(outf, "w").write(text)
    print(text)


def legacy_edit_args(argv):
    no_run = "--no-run" in argv
    argv = [a for a in argv if a != "--no-run"]
    editpy, config, fmt, out = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2], os.path.abspath(argv[3])
    saved = []
    real = subprocess.run

    def fake(args, *a, **kw):
        saved.append([str(x) for x in args])
        if no_run:
            return subprocess.CompletedProcess(args, 0)
        return real(args, *a, **kw)

    subprocess.run = fake
    sys.modules.pop("config", None)
    sys.path.insert(0, os.path.dirname(editpy))
    old_argv = sys.argv
    sys.argv = [editpy, config, fmt]
    try:
        runpy.run_path(editpy, run_name="__main__")
    finally:
        subprocess.run = real
        sys.argv = old_argv
        sys.path.pop(0)
        sys.modules.pop("config", None)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(saved[0] if len(saved) == 1 else saved, open(out, "w"), indent=1)
    print(f"saved {len(saved)} command(s) to {out}")


# ---- comparing -------------------------------------------------------------------------------------------

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def max_diff(a, b):
    import numpy as np
    from PIL import Image
    x, y = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if x.size != y.size:
        return None
    return int(np.abs(np.asarray(x).astype(int) - np.asarray(y).astype(int)).max())


def compare_dirs(argv, what):
    ignore = flag(argv, "--ignore")
    a, b = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    ext = ("*.jpg", "*.png")
    names = lambda d: sorted(f for e in ext for f in (os.path.basename(p) for p in glob.glob(f"{d}/{e}"))
                             if not (ignore and fnmatch.fnmatch(f, ignore)))
    na, nb = names(a), names(b)
    problems = []
    if na != nb:
        problems.append(f"name sets differ: only in A {sorted(set(na) - set(nb))[:5]}, only in B {sorted(set(nb) - set(na))[:5]}")
    common = [n for n in na if n in set(nb)]
    diff = [n for n in common if md5(f"{a}/{n}") != md5(f"{b}/{n}")]
    print(f"{what}: {len(common) - len(diff)}/{len(common)} identical ({len(na)} in A, {len(nb)} in B)")
    if diff:
        d = [max_diff(f"{a}/{n}", f"{b}/{n}") for n in diff]
        known = [x for x in d if x is not None]
        print(f"{len(diff)} differ; first {diff[0]}; max abs pixel diff {max(known) if known else 'size differs'}")
        print("differing:", diff[:12])
    for p in problems:
        print(p)
    return 0 if not diff and not problems else 1


def frame_md5s(path):
    r = subprocess.run([ffmpeg(), "-loglevel", "error", "-i", path, "-map", "0:v", "-f", "framemd5", "-"], capture_output=True, text=True, check=True)
    return [l.split(",")[-1].strip() for l in r.stdout.splitlines() if l and not l.startswith("#")]


def audio_md5(path):
    r = subprocess.run([ffmpeg(), "-loglevel", "error", "-i", path, "-map", "0:a", "-f", "md5", "-"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def video(argv):
    a, b = argv[0], argv[1]
    fa, fb = frame_md5s(a), frame_md5s(b)
    first = next((i for i, (x, y) in enumerate(zip(fa, fb)) if x != y), None)
    if first is None and len(fa) != len(fb):
        first = min(len(fa), len(fb))
    aa, ab = audio_md5(a), audio_md5(b)
    print(f"frames {len(fa)} vs {len(fb)}: " + ("identical" if first is None else f"first difference at frame {first}"))
    print(f"audio md5 {aa} vs {ab}: " + ("identical" if aa == ab else "DIFFERENT"))
    return 0 if first is None and aa == ab else 1


def probe(path):
    """(width, height, fps, duration s, video frames) of a file, from ffmpeg's own report."""
    r = subprocess.run([ffmpeg(), "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"], capture_output=True, text=True)
    t = r.stderr
    size = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", t)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", t)
    dur = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", t)
    frames = re.findall(r"frame=\s*(\d+)", t)
    d = int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])
    return int(size[1]), int(size[2]), float(fps[1]), d, int(frames[-1])


def psnr(argv):
    a, b = os.path.abspath(argv[0]), os.path.abspath(argv[1])
    wa, ha, fpsa, da, na = probe(a)
    wb, hb, fpsb, db, nb = probe(b)
    print(f"A: {wa}x{ha} {fpsa} fps {da:.3f}s {na} frames; B: {wb}x{hb} {fpsb} fps {db:.3f}s {nb} frames; duration diff {da - db:+.3f}s ({(da - db) * fpsa:+.2f} frames)")
    import tempfile
    stats = os.path.join(tempfile.mkdtemp(), "psnr.stats.txt")   # never beside A: it may sit in ~/Movies
    run([ffmpeg(), "-loglevel", "error", "-i", a, "-i", b, "-lavfi",
         f"[0:v]fps={fpsa},setpts=PTS-STARTPTS[a];[1:v]fps={fpsa},scale={wa}:{ha},setpts=PTS-STARTPTS[b];[a][b]psnr=stats_file={stats}",
         "-f", "null", "-"])
    vals = []
    for l in open(stats):
        m = re.search(r"psnr_avg:(\S+)", l)
        if m:
            vals.append(float("inf") if m[1] == "inf" else float(m[1]))
    os.remove(stats)
    finite = [min(v, 100.0) for v in vals]
    print(f"PSNR over {len(vals)} frames: min {min(finite):.2f} dB, mean {sum(finite) / len(finite):.2f} dB (inf capped at 100)")


def repeats(argv):
    import numpy as np
    f = argv[0]
    # --from S scores only the pairs from S seconds on: a test track's silent lead-in repeats by design.
    start = float(argv[argv.index("--from") + 1]) if "--from" in argv else 0.0
    w, h, fps, *_ = probe(f)
    W, H = (90, 160) if h > w else (160, 90)
    raw = subprocess.run([ffmpeg(), "-loglevel", "error", "-i", f, "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.int16)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    d = d[np.arange(1, len(fr)) / fps >= start]
    print(f"{os.path.basename(f)}: {100 * (d < 0.05).sum() / max(1, len(d)):.1f}% repeated frame pairs ({len(fr)} frames, from {start:g} s)")


# ---- stand-ins -------------------------------------------------------------------------------------------

def hue_of(name):
    return int(hashlib.md5(name.encode()).hexdigest()[:6], 16) % 360


def make_clip(out, w, h, dur, hue=0, audio=None, rate=60):
    """A test-pattern clip (hue rotated per name) with an optional audio cut: (song path, start s)."""
    if os.path.exists(out):
        return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    args = [ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate={rate}:duration={dur:.3f},hue=h={hue}"]
    if audio:
        args += ["-ss", f"{audio[1]:.4f}", "-t", f"{dur:.3f}", "-i", audio[0], "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-ar", "48000"]
    args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-t", f"{dur:.3f}", out]
    run(args)


def approved_lists(pattern):
    return {f: json.load(open(pattern.format(fmt=f))) for f in "vh"}


def write_intro_gallery(work, fmt, lists, media):
    """intro-<fmt>.mp4.json and gallery-<fmt>.mp4.json from the approved cut's own durations; media optional."""
    L = lists[fmt]
    idur, gdur = L["video"][0][2], L["video"][1][2]
    mic_to = next(c[2] for c in L["captions"] if c[0] == "mic")
    json.dump({"dur": idur, "marks": [0, mic_to, idur]}, open(f"{work}/intro-{fmt}.mp4.json", "w"))
    json.dump({"dur": gdur, "frames": round(gdur * 60)}, open(f"{work}/gallery-{fmt}.mp4.json", "w"))
    if media:
        w, h = SIZES[fmt]
        make_clip(f"{work}/intro-{fmt}.mp4", w, h, idur, hue_of("intro"))
        make_clip(f"{work}/gallery-{fmt}.mp4", w, h, gdur, hue_of("gallery"))


def standins(argv):
    cfg = json.load(open(argv[0]))
    out = os.path.abspath(argv[2])
    root = os.path.dirname(out)
    lists = approved_lists(argv[1])
    clips, wiring = f"{out}/clips", f"{out}/wiring"
    BED = cfg["bed"]
    BAR = 4 * 60 / BED["bpm"]
    WIN = cfg["clips"]["windows"]
    SHOT = cfg["shuffle"]["shot"]
    # in-points exactly as edit.py computes them
    need = {}   # clip name -> (song id, longest in+dur)
    s = BED["drop"]
    for name, bars in cfg["drop"]["shots"]:
        d = bars * BAR
        need[name] = (BED["song"], max(need.get(name, (0, 0))[1], s - WIN[name] + d))
        s += d
    for name, sid, st in cfg["shuffle"]["shots"]:
        need[name] = (sid, max(need.get(name, (0, 0))[1], st - WIN[name] + SHOT))
    WR = cfg["wiring"]
    w0 = s - WR["t0"]
    wire_dur = w0 + WR["beats"] * 60 / BED["bpm"] + 1
    for name, (sid, longest) in need.items():
        for fmt, (w, h) in SIZES.items():
            make_clip(f"{clips}/{name}-{fmt}.mp4", w, h, longest + 1, hue_of(name), audio=(cfg["songs"][sid], WIN[name]))
    make_clip(f"{wiring}/wiring-h.mp4", *cfg["camera"]["sourceSize"], wire_dur, hue_of("wiring-h"))
    make_clip(f"{wiring}/wiring-vL.mp4", 1080, 1920, wire_dur, hue_of("wiring-vL"))
    make_clip(f"{wiring}/wiring-vR.mp4", 1080, 1920, wire_dur, hue_of("wiring-vR"))
    for tag in ("C0", "C1"):
        work = f"{root}/{tag}"
        os.makedirs(work, exist_ok=True)
        for fmt in "vh":
            write_intro_gallery(work, fmt, lists, media=False)
            for kind in ("intro", "gallery"):
                if tag == "C0":
                    make_clip(f"{work}/{kind}-{fmt}.mp4", *SIZES[fmt], lists[fmt]["video"][0 if kind == "intro" else 1][2], hue_of(kind))
                else:
                    link_or_copy(f"{root}/C0/{kind}-{fmt}.mp4", f"{work}/{kind}-{fmt}.mp4")
        c = json.loads(json.dumps(cfg))
        c["work"] = work
        c["clips"]["dir"] = clips
        c["wiring"]["h"]["take"] = f"{wiring}/wiring-h.mp4"
        c["wiring"]["v"]["takes"] = {"L": f"{wiring}/wiring-vL.mp4", "R": f"{wiring}/wiring-vR.mp4"}
        json.dump(c, open(f"{out}/showcase.{tag}.json", "w"), indent=1)
    print("stand-ins in", out)


def same(a, b):
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-9
    return a == b


def v10_lists(argv):
    out = os.path.abspath(argv[2])
    work = f"{out}/Cv10"
    os.makedirs(work, exist_ok=True)
    cfg = json.load(open(argv[0]))
    cfg["work"] = work
    json.dump(cfg, open(f"{work}/showcase.json", "w"), indent=1)
    lists = approved_lists(argv[1])
    editpy = f"{BASELINE}/main/tools/promo/showcase/edit.py"
    report = []
    for fmt in "vh":
        write_intro_gallery(work, fmt, lists, media=False)
        legacy_edit_args([editpy, f"{work}/showcase.json", fmt, f"{work}/args-{fmt}.json", "--no-run"])
        mine = json.load(open(f"{work}/out/promo-{fmt}.mp4.json"))
        theirs = lists[fmt]
        for key in ("total", "bed_len", "audio", "captions"):
            ok = same(mine[key], theirs[key])
            report.append(f"{fmt} {key}: {'PASS' if ok else 'DIFF'}")
            if not ok:
                report.append(f"    computed {mine[key]}\n    approved {theirs[key]}")
        # video pieces: paths ignored, compare in and dur piece by piece
        mv, tv = [x[1:] for x in mine["video"]], [x[1:] for x in theirs["video"]]
        if len(mv) != len(tv):
            report.append(f"{fmt} video: DIFF, {len(mv)} pieces computed, {len(tv)} approved")
        else:
            bad = [i for i, (x, y) in enumerate(zip(mv, tv)) if not same(x, y)]
            report.append(f"{fmt} video: {'PASS' if not bad else 'DIFF'}")
            for i in bad:
                report.append(f"    piece {i} {os.path.basename(mine['video'][i][0])}: computed {mv[i]} approved {tv[i]}")
    text = "\n".join(report)
    open(f"{work}/REPORT.txt", "w").write(text + "\n")
    print(text)


# ---- looking ----------------------------------------------------------------------------------------------

def nearest_frame(take, beat):
    j = json.load(open(f"{take}/frames.json"))
    m = j["meta"]
    t = m["epochT0"] + beat * m["P"] / 1000
    f = min(j["frames"], key=lambda fr: abs(fr["t"] - t))
    return f"{take}/{f['file']}"


def sheet(argv):
    from PIL import Image, ImageDraw
    beats = [float(x) for x in flag(argv, "--beats").split(",")]
    a, b, out = os.path.abspath(argv[0]), os.path.abspath(argv[1]), argv[2]
    H = 360
    cells = []
    for beat in beats:
        row = []
        for take in (a, b):
            im = Image.open(nearest_frame(take, beat)).convert("RGB")
            im = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
            ImageDraw.Draw(im).text((6, 4), f"{'A' if take == a else 'B'} beat {beat:g}", fill=(255, 255, 0))
            row.append(im)
        cells.append(row)
    w = max(im.width for r in cells for im in r)
    S = Image.new("RGB", (w * 2, H * len(cells)))
    for y, row in enumerate(cells):
        for x, im in enumerate(row):
            S.paste(im, (x * w, y * H))
    S.save(out)
    print("wrote", out)


def strip(argv):
    from PIL import Image, ImageDraw
    n = int(flag(argv, "--n", "16"))
    video_path, out = argv[0], argv[1]
    _, _, _, dur, _ = probe(video_path)
    cols = 4
    ims = []
    for k in range(n):
        t = (k + 0.5) / n * dur
        tmp = f"{out}.{k}.tmp.png"
        run([ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", video_path, "-frames:v", "1", "-vf", "scale=-2:480", tmp])
        im = Image.open(tmp).convert("RGB")
        os.remove(tmp)
        ImageDraw.Draw(im).text((6, 4), f"{t:.2f}s", fill=(255, 255, 0))
        ims.append(im)
    w, h = ims[0].size
    S = Image.new("RGB", (w * cols, h * math.ceil(n / cols)))
    for k, im in enumerate(ims):
        S.paste(im, ((k % cols) * w, (k // cols) * h))
    S.save(out)
    print("wrote", out)


COMMANDS = {
    "clone": clone, "fix-song": fix_song, "legacy": legacy, "segs-legacy": segs_legacy,
    "legacy-edit-args": legacy_edit_args, "frames": lambda a: compare_dirs(a, "frames"),
    "pngs": lambda a: compare_dirs(a, "pngs"), "video": video, "psnr": psnr, "repeats": repeats,
    "standins": standins, "v10-lists": v10_lists, "sheet": sheet, "strip": strip,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    sys.exit(COMMANDS[sys.argv[1]](sys.argv[2:]) or 0)
