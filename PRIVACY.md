# Privacy

This is a plain-language statement of what Sine Visuals Lab does with data
during the beta. It is deliberately short because the honest answer is:
almost nothing. If any of this changes — for example, if accounts or
payments are introduced — this document will be replaced by a full privacy
policy before that ships.

**Your audio never leaves your device.** Whichever source you pick —
microphone, or a shared browser tab/system audio — capture and analysis
happen entirely locally. The app extracts a small set of numeric features
from the audio (frequency-band levels, energy, beat/onset markers, an
estimated BPM) to drive the visuals. The raw audio itself is never recorded,
stored, or transmitted anywhere.

**Phone→TV pairing sends those extracted features, plus a random device id.**
When you pair devices, the phone sends the numeric feature values (never
audio) through a relay server to the TV, along with a persistent random id
generated for pairing and stored in your browser's local storage, your role
(phone or TV), viewport size, clock-sync pings, and scene/palette commands.
The exact wire format is defined in
[`src/net/protocol.ts`](src/net/protocol.ts) — you can read it and confirm
there is no audio in it.

**The pairing server keeps only what it needs while you're connected.** The
relay (a Cloudflare Worker, in [`server/`](server/)) holds room state — who's
in the room, which scene is showing — only in memory while devices are
connected; when the room empties, the state is gone. It also reads your IP
address from Cloudflare's `CF-Connecting-IP` header to rate-limit how often
one visitor can create rooms, keeping only recent timestamps per IP in
memory for that purpose. It keeps no logs of the relayed data, and the only
thing it stores at all is the anonymous usage count described below.

**Cloudflare hosts the site.** Serving and protecting the site and the relay
means Cloudflare itself processes IP addresses and request metadata, under
its own privacy policy: https://www.cloudflare.com/privacypolicy/. Your
browser may also send Cloudflare automatic network-error reports (NEL) if a
request fails — that reporting is part of how Cloudflare operates the edge,
not something this app adds.

**One anonymous usage count.** When a scene starts running on live audio,
the app sends a single message saying so: which scene, whether the audio is
the microphone, a shared tab or a paired phone, and nothing else. The server
adds your country and whether you're on a phone or a computer, both taken
from the request, and records that as a count in Cloudflare's analytics
store. It records no IP address, device id or browser details, and nothing
that links one count to another or to you. Just opening the page or browsing
the gallery sends nothing. The code is in [`src/net/usage.ts`](src/net/usage.ts)
and [`server/usage.ts`](server/usage.ts).

**No accounts, no cookies, no tracking.** The app has no sign-up, sets no
cookies, and does not follow you across visits or sites. Settings you change
are kept in your own browser's local storage and never uploaded — except the
device id described above, which exists only so pairing can recognize your
device again. Cloudflare's own Web Analytics may also count page loads for
the site; it is cookieless and described in Cloudflare's policy linked
above.

Because this is open source (AGPL-3.0-or-later), every claim above is
verifiable in the code this page ships from — see the Source link in the app —
except what Cloudflare does as the host, which its own policy covers.

Who runs this: Yaroslav Maksymenko. Questions or concerns — open an issue at
https://github.com/maksymenkoyr/sine-visuals-lab/issues.
