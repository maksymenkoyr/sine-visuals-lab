# python3 mkwav.py <src.wav> <out.wav>
# 25 s of music from 20 s, 12 s of white hiss at about -61 dBFS, 15 s of music from 60 s.
# Reads/writes 48 kHz mono s16 (the /ref bundle's audio.wav format).
import random
import struct
import sys
import wave

src, out = sys.argv[1], sys.argv[2]
with wave.open(src, "rb") as w:
    assert w.getframerate() == 48000 and w.getnchannels() == 1 and w.getsampwidth() == 2, w.getparams()
    rate = w.getframerate()
    w.setpos(20 * rate)
    a = w.readframes(25 * rate)
    w.setpos(60 * rate)
    b = w.readframes(15 * rate)
amp = 32767 * 10 ** (-61 / 20) * 1.7  # uniform noise: rms = amp / sqrt(3)
rng = random.Random(1)
hiss = b"".join(struct.pack("<h", int(rng.uniform(-amp, amp))) for _ in range(12 * rate))
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(a + hiss + b)
print(out, (len(a) + len(hiss) + len(b)) / 2 / rate, "s")
