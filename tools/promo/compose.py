# Lays the cards over the recorded takes and writes the video's frames, every cut on a beat of the song.
#
#   uv run -q --with pillow python tools/promo/compose.py          (promo.mjs runs this)
#
# Reads <work>: song.json (tempo), lines.json, cards/ (cards.mjs), takes/ (record.mjs), plan.json (optional).
# Writes <work>/frames/00000.jpg … + frames/meta.json {total, frames, fps, dropBeat}: 1080x1920, constant
# 30 fps, each frame taken from the NEAREST source frame (a repeated or late frame reads as lag).
#
# Shape of the video (.claude/commands/video-hook-stable.md says why):
#   1. the opening: the user's look with the hook's line over it, until the song's drop;
#   2. the proofs from lines.json, back to back from the drop — clips that prove the hook, where
#      something visibly changes on the beat, each with one caption along the bottom that slides in as the last one leaves. The
#      interface camera leans toward the tracked part that changes; scene footage keeps a steady camera.
#      The two-screen proofs (Cue/Play with the pop-out, the room with a TV) are drawn as devices: a
#      laptop with its Cue/Play keys over the second screen;
#   3. the end: the version card over the opening's scene, held to a bar line counted from the drop.
#      Nothing fades out (the user's call).
# The song's drop goes on the first proof (meta.dropBeat, which promo.mjs uses) — make that proof a
# Physarum 2 take from a beat where it re-rolls.
# plan.json can override the timing, in beats:
#
#   { "opening": {"take": "intro", "t0": 0}, "look": 4, "end": 8 }
#
# look = beats of the opening before the drop, end = the least beats the version card holds. Scene takes
# heard the song (record.mjs), so each is cut at the song time the video plays at that moment, and its
# picture moves with the music you hear; panel takes are cut by their own beats.
import bisect, json, os, shutil
from PIL import Image, ImageDraw, ImageFilter

WORK = os.environ.get("PROMO_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "promo")
song = json.load(open(f"{WORK}/song.json"))
P = 60.0 / song["bpm"]
FPS = 30
W, H = 1080, 1920
plan = json.load(open(f"{WORK}/plan.json")) if os.path.exists(f"{WORK}/plan.json") else {}
LOOK, END = plan.get("look", 4), plan.get("end", 8)
META = json.load(open(f"{WORK}/cards/meta.json"))
LINES = json.load(open(f"{WORK}/lines.json"))
DROP_BEAT = int(os.environ.get("DROP_BEAT") or LOOK)
SS = song["dropTime"] - DROP_BEAT * P    # song time at video beat 0 (promo.mjs encode starts the song there)

REAL = {"cuep": "cuep_main", "room": "room_main"}           # composited takes: the controller's own take

def load_take(name):
    real = REAL.get(name, name)
    d = f"{WORK}/takes/{real}"
    j = json.load(open(f"{d}/frames.json"))
    tk = dict(dir=d, t0=j["meta"]["epochT0"], ts=[f["t"] for f in j["frames"]], files=[f["file"] for f in j["frames"]],
              vw=(j["meta"].get("view") or {}).get("width", 576), songT0=j["meta"].get("songT0"), keys=j["meta"].get("keys", []))
    tf = f"{d}/track.json"
    tk["track"] = json.load(open(tf)) if os.path.exists(tf) else []
    tk["track_ts"] = [r[0] for r in tk["track"]]
    return tk
takes = {}
def get(name):
    if name not in takes: takes[name] = load_take(name)
    return takes[name]

def src_time(tk, beat, video_beat=None):
    # a take that heard the song is cut at the song time the video plays here; others by their own beat
    return tk["t0"] + (SS + video_beat * P - tk["songT0"] if tk["songT0"] is not None and video_beat is not None else beat * P)
def frame_at(name, beat, video_beat=None):
    tk = get(name)
    src_t = src_time(tk, beat, video_beat)
    k = bisect.bisect_left(tk["ts"], src_t)
    if k >= len(tk["ts"]) or (k > 0 and abs(tk["ts"][k - 1] - src_t) <= abs(tk["ts"][k] - src_t)): k = max(0, k - 1)
    return Image.open(f"{tk['dir']}/{tk['files'][k]}").convert("RGB")

def fit(im): return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)

def tag_at(base, key, pos):
    t = png(f"label_{key}.png"); base.paste(t.convert("RGB"), pos, t.getchannel("A")); return base

# The two-screen proofs (record.mjs twoScreens): drawn as devices — a laptop with its Cue (Space) and
# Play (Option) keys on the deck, lit while held, over the second screen it plays to, whose frame glows
# orange while Cue shows the laptop's look there and flashes green when Play sends it. Everything stays
# above the caption.
TWO = {"cuep": "popout", "room": "tv"}                       # take → the second screen's label
DEV_X, DEV_W, DEV_H, BEZEL, LAP_Y, OUT_Y = 120, 840, 473, 14, 262, 850
CUE_RGB, PLAY_RGB = (245, 165, 36), (63, 185, 80)              # the app's CUE and PLAY bar colours
def device(base, im, y, glow=0.0, rgb=PLAY_RGB):
    if glow > 0:
        g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle((DEV_X - BEZEL - 8, y - BEZEL - 8, DEV_X + DEV_W + BEZEL + 8, y + DEV_H + BEZEL + 8),
                                            radius=26, outline=(*rgb, int(255 * glow)), width=12)
        g = g.filter(ImageFilter.GaussianBlur(9)); base.paste(g, (0, 0), g)
    ImageDraw.Draw(base).rounded_rectangle((DEV_X - BEZEL, y - BEZEL, DEV_X + DEV_W + BEZEL, y + DEV_H + BEZEL),
                                           radius=20, fill=(22, 25, 31), outline=(78, 84, 96), width=2)
    base.paste(im.resize((DEV_W, DEV_H), Image.LANCZOS), (DEV_X, y))
def keys_at(name, vb):
    tk = get(name); t = src_time(tk, 0, vb)
    down, play_up = {}, None
    for et, k, d in tk["keys"]:
        if et > t: break
        down[k] = d
        if k == "Alt" and not d: play_up = et
    # Cue (Space held) puts the laptop's look on the second screen while held: orange; Play: a green flash
    if down.get("Space"): return down, 1.0, CUE_RGB
    glow = 1.0 if down.get("Alt") else max(0.0, 1 - (t - play_up) / 0.6) if play_up else 0.0
    return down, glow, PLAY_RGB
def two_screens(name, b, vb):
    base = Image.new("RGB", (W, H), (6, 8, 13))
    down, glow, rgb = keys_at(name, vb)
    device(base, frame_at(name, b, vb), LAP_Y)
    y0 = LAP_Y + DEV_H + BEZEL                                 # the laptop's deck, with its two output keys
    ImageDraw.Draw(base).polygon([(DEV_X - BEZEL, y0), (DEV_X + DEV_W + BEZEL, y0), (DEV_X + DEV_W + 70, y0 + 66), (DEV_X - 70, y0 + 66)],
                                 fill=(34, 38, 46), outline=(80, 86, 98))
    ks, ko = png(f"key_space_{'on' if down.get('Space') else 'off'}.png"), png(f"key_option_{'on' if down.get('Alt') else 'off'}.png")
    x = (W - ks.width - 24 - ko.width) // 2
    base.paste(ks.convert("RGB"), (x, y0 + 4), ks.getchannel("A")); base.paste(ko.convert("RGB"), (x + ks.width + 24, y0 + 4), ko.getchannel("A"))
    device(base, frame_at(f"{name}_out", b, vb), OUT_Y, glow, rgb)
    tag_at(base, "laptop", (DEV_X + 10, LAP_Y + 10)); tag_at(base, TWO[name], (DEV_X + 10, OUT_Y + 10))
    return base
def backdrop(name, b, video_beat):
    if name in TWO: return two_screens(name, b, video_beat)
    return fit(frame_at(name, b, video_beat))

# ---- segments ---------------------------------------------------------------------------------------
# Song takes (record.mjs) cover the whole video, so a segment needs only the take's name.
OPENING = plan.get("opening") or {"take": "intro", "t0": 0}
SEGS = [("opening", (OPENING["take"], OPENING["t0"]), None, LOOK)]
for i, h in enumerate(LINES.get("proofs", [])):
    SEGS.append(("proof", (h["take"], h.get("from", 0)), i, h["beats"]))
# The end: the version card over the opening's scene, stretched to a bar line counted from the drop, so
# the song stops on a beat.
end = END
while (sum(sg[3] for sg in SEGS) + end - DROP_BEAT) % 4: end += 1
SEGS.append(("end", (OPENING["take"], OPENING["t0"]), None, end))
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
def camera(im, name, local, take_beat):
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
def over(im, lay):
    o = im.convert("RGBA"); o.alpha_composite(lay); return o.convert("RGB")

_scrims = {}
def scrim(top, strength):   # darkens the bottom of the frame from `top` down, so the text reads
    if (top, strength) not in _scrims:
        a = Image.new("L", (W, H), 0); d = ImageDraw.Draw(a)
        for y in range(top, H): d.line((0, y, W, y), fill=int(strength * min(1, (y - top) / 300)))
        _scrims[(top, strength)] = a
    return _scrims[(top, strength)]
def darken(im, top, strength): return Image.composite(Image.new("RGB", im.size, (3, 5, 10)), im, scrim(top, strength))

# a caption's bottom sits where Stories' own UI starts (the bottom ~19 %); slide distance (px) and time (s)
CAP_X, CAP_Y, CAP_SLIDE, CAP_T = 70, 1530 - META["cap"]["h"], 300, 0.4
def caption(im, i, local):
    im = darken(im, CAP_Y - 160, 150)
    a = ease(local * P / CAP_T)
    if i > 0 and a < 1:
        c = png(f"proof_{i - 1}.png")
        im.paste(c.convert("RGB"), (int(CAP_X - a * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * (1 - a))))
    c = png(f"proof_{i}.png")
    im.paste(c.convert("RGB"), (int(CAP_X + (1 - a) * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * a)))
    return im
def dim(im, amount, t_in): return Image.blend(im, Image.new("RGB", im.size, (4, 6, 12)), amount * min(1.0, t_in / 0.3))
HAS_OPENING = os.path.exists(f"{WORK}/cards/opening.png")

# ---- frames -----------------------------------------------------------------------------------------
n_frames = round(TOTAL_BEATS * P * FPS)
print(f"{TOTAL_BEATS} beats ({end} held at the end) = {TOTAL_BEATS * P:.3f}s = {n_frames} frames @ {FPS}; drop on beat {DROP_BEAT}")
bounds, b0 = [], 0
for sg in SEGS: bounds.append(b0); b0 += sg[3]
FRAMES = f"{WORK}/frames"
shutil.rmtree(FRAMES, ignore_errors=True); os.makedirs(FRAMES)
si = 0
for i in range(n_frames):
    bp = (i / FPS) / P
    while si + 1 < len(SEGS) and bp >= bounds[si + 1] - 1e-9: si += 1
    kind, (tk, tb), arg, dur = SEGS[si]
    local = bp - bounds[si]; t_in = local * P
    im = backdrop(tk, tb + local, bp)
    if tk not in TWO: im = camera(im, tk, local, tb + local)   # the two-screen layout stays put
    if kind == "opening" and HAS_OPENING:
        im = over(im, png("opening.png"))
    elif kind == "proof":
        im = caption(im, arg, local)
    elif kind == "end":
        im = over(dim(im, 0.30, t_in), with_alpha(png("version.png"), min(1.0, t_in / 0.18)))
    im.save(f"{FRAMES}/{i:05d}.jpg", quality=94, subsampling=0)
    if i % 150 == 0: print(i, f"beat {bp:.1f}", kind, flush=True)
json.dump(dict(total=n_frames / FPS, frames=n_frames, fps=FPS, dropBeat=DROP_BEAT), open(f"{FRAMES}/meta.json", "w"))
