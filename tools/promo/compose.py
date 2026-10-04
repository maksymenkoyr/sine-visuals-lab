# Lays the cards over the recorded takes and writes the video's frames, every cut on a beat of the song.
#
#   uv run -q --with pillow python tools/promo/compose.py          (promo.mjs runs this)
#
# Reads <work>: song.json (tempo), lines.json, cards/ (cards.mjs), takes/ (record.mjs), plan.json (optional).
# Writes <work>/frames/00000.jpg … + frames/meta.json {total, frames, fps, dropBeat}: 1080x1920, constant
# 30 fps, each frame taken from the NEAREST source frame (a repeated or late frame reads as lag).
#
# Shape of the video (the user's calls, 2026-10):
#   1. the opening look, then the release card ("0.2.0 - beta") held for a couple of seconds;
#   2. the demos from lines.json — clips that show a change happening, one caption at a time along the
#      bottom: the next caption slides in and pushes the old one out. The interface camera leans toward
#      the tracked part that changes; scene footage keeps a steady camera;
#   3. every group of lines.json over steady scene footage, its rows spinning through a wheel held low
#      in the frame (a picker: the row in the band is full size, the ones above and below shrink and fade);
#   then a two-beat fade. The song's drop goes on the first demo (meta.dropBeat, which promo.mjs uses) —
#   make that demo a Physarum 2 take from a beat where it re-rolls.
# plan.json can override the timing, in beats:
#
#   { "intro": {"take": "intro", "t0": 0}, "look": 3, "version": 6, "row": 0.5, "hold": 2,
#     "scenes": ["intro", "song_cau", "song_chl", "song_p2r"] }
#
# row = beats per wheel step, hold = beats the wheel rests on a group's last row, scenes = the takes
# behind the groups, in turn. Scene takes heard the song (record.mjs), so each is cut at the song time
# the video plays at that moment, and its picture moves with the music you hear; panel takes are cut by
# their own beats.
import bisect, json, math, os, shutil
from PIL import Image, ImageDraw, ImageFilter

WORK = os.environ.get("PROMO_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "promo")
song = json.load(open(f"{WORK}/song.json"))
P = 60.0 / song["bpm"]
FPS, TAIL, FADE_BEATS = 30, 0.9, 2
W, H = 1080, 1920
plan = json.load(open(f"{WORK}/plan.json")) if os.path.exists(f"{WORK}/plan.json") else {}
LOOK, VERSION, ROW, HOLD = plan.get("look", 3), plan.get("version", 6), plan.get("row", 0.5), plan.get("hold", 2)
META = json.load(open(f"{WORK}/cards/meta.json"))
LINES = json.load(open(f"{WORK}/lines.json"))
DROP_BEAT = int(os.environ.get("DROP_BEAT") or LOOK + VERSION)
SS = song["dropTime"] - DROP_BEAT * P    # song time at video beat 0 (promo.mjs encode starts the song there)

REAL = {"cuep": "cuep_main", "room": "room_main"}           # composited takes: the controller's own take

def load_take(name):
    real = REAL.get(name, name)
    d = f"{WORK}/takes/{real}"
    j = json.load(open(f"{d}/frames.json"))
    tk = dict(dir=d, t0=j["meta"]["epochT0"], ts=[f["t"] for f in j["frames"]], files=[f["file"] for f in j["frames"]],
              vw=(j["meta"].get("view") or {}).get("width", 576), songT0=j["meta"].get("songT0"))
    tf = f"{d}/track.json"
    tk["track"] = json.load(open(tf)) if os.path.exists(tf) else []
    tk["track_ts"] = [r[0] for r in tk["track"]]
    return tk
takes = {}
def get(name):
    if name not in takes: takes[name] = load_take(name)
    return takes[name]

def frame_at(name, beat, video_beat=None):
    tk = get(name)
    # a take that heard the song is cut at the song time the video plays here; others by their own beat
    src_t = tk["t0"] + (SS + video_beat * P - tk["songT0"] if tk["songT0"] is not None and video_beat is not None else beat * P)
    k = bisect.bisect_left(tk["ts"], src_t)
    if k >= len(tk["ts"]) or (k > 0 and abs(tk["ts"][k - 1] - src_t) <= abs(tk["ts"][k] - src_t)): k = max(0, k - 1)
    return Image.open(f"{tk['dir']}/{tk['files'][k]}").convert("RGB")

def fit(im): return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)

def inset(base, im, size, pos, pad=3):
    x, y = pos; w, h = size
    sh = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 30, 30 + w, 30 + h), fill=(0, 0, 0, 190))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    base.paste(sh, (x - 30, y - 24), sh)
    ImageDraw.Draw(base).rectangle((x - pad, y - pad, x + w + pad - 1, y + h + pad - 1), outline=(235, 240, 255), width=3)
    base.paste(im.resize(size, Image.LANCZOS), pos)
    return base
# the inset sits above the caption band (the caption covers y 1340..1530)
def cuep_frame(b): return inset(fit(frame_at("cuep", b)).copy(), frame_at("cuep_out", b), (700, 394), (190, 900))
def room_frame(b): return inset(fit(frame_at("room", b)).copy(), frame_at("room_tv", b), (440, 248), (590, 1050))
def backdrop(name, b, video_beat):
    if name == "cuep": return cuep_frame(b)
    if name == "room": return room_frame(b)
    return fit(frame_at(name, b, video_beat))

# ---- segments ---------------------------------------------------------------------------------------
# Song takes (record.mjs) cover the whole video, so a segment needs only the take's name.
INTRO = plan.get("intro") or {"take": "intro", "t0": 0}
SCENE_POOL = plan.get("scenes") or ["intro", "song_cau", "song_chl", "song_p2r"]   # behind the groups, in turn

SEGS = [("look", (INTRO["take"], INTRO["t0"]), None, LOOK), ("version", (INTRO["take"], INTRO["t0"] + LOOK), None, VERSION)]
for i, d in enumerate(LINES.get("demos", [])):
    SEGS.append(("demo", (d["take"], d.get("from", 0)), i, d["beats"]))
for k, g in enumerate(META["groups"]):
    SEGS.append(("wheel", (SCENE_POOL[k % len(SCENE_POOL)], 0), g, math.ceil(g["n"] * ROW) + HOLD))
TOTAL_BEATS = sum(sg[3] for sg in SEGS)

# ---- camera -----------------------------------------------------------------------------------------
def ease(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def zoom(im, z, cx, cy):
    cw, ch = W / z, H / z
    x0 = min(max(cx - cw / 2, 0), W - cw); y0 = min(max(cy - ch / 2, 0), H - ch)
    return im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))
def track_box(tk, src_t, scale):
    k = bisect.bisect_right(tk["track_ts"], src_t) - 1
    if k < 0 or len(tk["track"][k]) != 5 or src_t - tk["track"][k][0] > 0.3: return None
    recent = [r for r in tk["track"][max(0, k - 2):k + 1] if len(r) == 5]
    r = [sum(x[i] for x in recent) / len(recent) for i in range(1, 5)]
    return [v * scale for v in r]
def camera(im, name, local, plen, take_beat):
    if name in ("cuep", "room"):
        return zoom(im, 1.0 + 0.10 * ease(local / max(plen, 1)), W * 0.5, H * 0.42)
    if name.startswith("ui_"):
        tk = get(name)
        bx = track_box(tk, tk["t0"] + take_beat * P, W / tk["vw"])
        cx, cy = (bx[0] + bx[2] / 2, bx[1] + bx[3] / 2) if bx else (W * 0.62, H * 0.5)
        cx = W * 0.5 + (cx - W * 0.5) * 0.8; cy = H * 0.5 + (cy - H * 0.5) * 0.8
        return zoom(im, 1.0 + 0.40 * ease(local / 3), cx, cy)
    return im   # scene footage: a steady camera

# ---- text layers ------------------------------------------------------------------------------------
_png = {}
def png(path):
    if path not in _png: _png[path] = Image.open(f"{WORK}/cards/{path}").convert("RGBA")
    return _png[path]
def with_alpha(lay, a):
    lay = lay.copy(); lay.putalpha(lay.getchannel("A").point(lambda v: int(v * a))); return lay

_scrims = {}
def scrim(top, strength):   # darkens the bottom of the frame from `top` down, so the text reads
    if (top, strength) not in _scrims:
        a = Image.new("L", (W, H), 0); d = ImageDraw.Draw(a)
        for y in range(top, H): d.line((0, y, W, y), fill=int(strength * min(1, (y - top) / 300)))
        _scrims[(top, strength)] = a
    return _scrims[(top, strength)]
def darken(im, top, strength): return Image.composite(Image.new("RGB", im.size, (3, 5, 10)), im, scrim(top, strength))

WHEEL_CY, WHEEL_PITCH, WHEEL_TH, WHEEL_HEAD_Y = 1310, 88, 0.36, 975   # band centre, row pitch, radians per row
def wheel(im, g, local):
    key, n = g["key"], g["n"]
    im = darken(im, 900, 200)
    o = im.convert("RGBA")
    fade = min(1.0, local * P / 0.2)
    step = local / ROW
    s = min(n - 1.0, math.floor(step) + ease((step % 1) / 0.6))    # the wheel ticks on each step, then rests
    head = png(f"head_{key}.png")
    o.alpha_composite(with_alpha(head, fade), ((W - head.width) // 2, WHEEL_HEAD_Y))
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(band)
    for y in (WHEEL_CY - WHEEL_PITCH // 2 - 2, WHEEL_CY + WHEEL_PITCH // 2 + 2):
        d.line((90, y, W - 90, y), fill=(255, 255, 255, int(80 * fade)), width=2)
    o.alpha_composite(band)
    R = WHEEL_PITCH / WHEEL_TH
    for j in range(max(0, int(s) - 4), min(n, int(s) + 5)):
        a = (j - s) * WHEEL_TH
        if abs(a) >= 1.3: continue
        c = math.cos(a)
        r = png(f"row_{key}_{j}.png")
        rw, rh = int(r.width * (0.78 + 0.22 * c)), max(1, int(r.height * c))
        rr = with_alpha(r.resize((rw, rh), Image.LANCZOS), fade * c ** 3)
        o.alpha_composite(rr, ((W - rw) // 2, int(WHEEL_CY + R * math.sin(a) - rh / 2)))
    return o.convert("RGB")
CAP_X, CAP_Y, CAP_SLIDE, CAP_T = 70, 1340, 300, 0.4   # caption position; slide distance (px) and time (s)
def caption(im, i, local):
    im = darken(im, 1180, 150)
    a = ease(local * P / CAP_T)
    if i > 0 and a < 1:
        c = png(f"demo_{i - 1}.png")
        im.paste(c.convert("RGB"), (int(CAP_X - a * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * (1 - a))))
    c = png(f"demo_{i}.png")
    im.paste(c.convert("RGB"), (int(CAP_X + (1 - a) * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * a)))
    return im
def dim(im, amount, t_in): return Image.blend(im, Image.new("RGB", im.size, (4, 6, 12)), amount * min(1.0, t_in / 0.3))

# ---- frames -----------------------------------------------------------------------------------------
n_frames = int((TOTAL_BEATS * P + TAIL) * FPS)
print(f"{TOTAL_BEATS} beats, {TOTAL_BEATS * P:.3f}s + {TAIL}s tail = {n_frames} frames @ {FPS}; drop on beat {DROP_BEAT}")
bounds, b0 = [], 0
for sg in SEGS: bounds.append(b0); b0 += sg[3]
FRAMES = f"{WORK}/frames"
shutil.rmtree(FRAMES, ignore_errors=True); os.makedirs(FRAMES)
si = 0
for i in range(n_frames):
    bp = (i / FPS) / P
    if bp >= TOTAL_BEATS:
        im = Image.new("RGB", (W, H), (0, 0, 0))
    else:
        while si + 1 < len(SEGS) and bp >= bounds[si + 1] - 1e-9: si += 1
        kind, (tk, tb), arg, dur = SEGS[si]
        local = bp - bounds[si]; t_in = local * P
        im = camera(backdrop(tk, tb + local, bp), tk, local, dur, tb + local)
        if kind == "version":
            im = dim(im, 0.30, t_in)
            o = im.convert("RGBA"); o.alpha_composite(with_alpha(png("intro.png"), min(1.0, t_in / 0.18))); im = o.convert("RGB")
        elif kind == "demo":
            im = caption(im, arg, local)
        elif kind == "wheel":
            im = wheel(im, arg, local)
        if bp > TOTAL_BEATS - FADE_BEATS:
            f = max(0.0, 1 - (bp - (TOTAL_BEATS - FADE_BEATS)) / FADE_BEATS)
            im = Image.eval(im, lambda v: int(v * f))
    im.save(f"{FRAMES}/{i:05d}.jpg", quality=94, subsampling=0)
    if i % 150 == 0: print(i, f"beat {bp:.1f}", SEGS[si][0] if bp < TOTAL_BEATS else "tail", flush=True)
json.dump(dict(total=TOTAL_BEATS * P + TAIL, frames=n_frames, fps=FPS, dropBeat=DROP_BEAT), open(f"{FRAMES}/meta.json", "w"))
