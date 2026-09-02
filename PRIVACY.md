# Privacy

This is a plain-language statement of what Sine Visuals Lab does with data
during the beta. It is deliberately short because the honest answer is:
almost nothing.

**Your microphone audio never leaves your device.** All audio capture and
analysis happens locally in your browser. The app extracts a small set of
numeric features from the audio (frequency-band levels, energy, beat/onset
markers, an estimated BPM) to drive the visuals — the raw audio is never
recorded, stored, or transmitted anywhere.

**Phone→TV pairing relays only those extracted features.** When you pair a
phone with a TV, the phone sends the numeric feature values (not audio)
through a relay server to the TV, along with the room code and basic display
state (which scene and palette are active). The exact byte-level format is
defined in [`src/net/protocol.ts`](src/net/protocol.ts) — you can read it and
confirm there is no audio in it.

**The pairing server stores nothing.** The relay (a Cloudflare Worker with
Durable Objects, in [`server/`](server/)) holds room state only in memory
while devices are connected — who's in the room, which scene is showing. It
writes nothing to storage and keeps no logs of the relayed data. When the
room empties, the state is gone.

**No accounts, no analytics, no cookies.** The app has no sign-up, no
tracking or analytics code, and sets no cookies. Settings you change are kept
in your own browser's local storage and never uploaded.

Because this is open source (AGPL-3.0-or-later), every claim above is
verifiable in the code this page ships from — see the Source link in the app.

If any of this changes — for example, if paid accounts are introduced — this
document will be replaced by a full privacy policy before that ships.
