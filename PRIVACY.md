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

**Pairing sends those extracted features, plus a random device id.**
When you pair devices, the laptop that is listening sends the numeric
feature values (never audio) through a relay server to the TV and to a
phone that is controlling it, along with a persistent random id generated
for pairing and stored in your browser's local storage, your role (laptop,
phone or TV), viewport size, clock-sync pings, and scene/palette commands.
The relay lists each laptop's and TV's id, role and scene to the other
devices in the room. The exact wire format is defined in
[`src/net/protocol.ts`](src/net/protocol.ts) — you can read it and confirm
there is no audio in it.

**A phone that controls a room also sends its settings.** The scene and
palette it is showing, and the values of the controls that change how a
scene looks, go through the relay to the TV, and the relay keeps a copy so
a screen that joins or reconnects later gets them. Which controls count is
decided in [`src/net/syncedStores.ts`](src/net/syncedStores.ts) (`isRoomKey`);
your saved Looks, your device id and your saved pairing sessions are never
part of them.

**Pairing uses secret keys.** The laptop makes a room key, which is inside
the QR code it shows, and a host key, which it never puts in the QR code or
shows to another device. Anyone who scans or photographs that QR code can
join the room and change its settings until the room is deleted, so treat it
like a password. The host key is what proves a device is the laptop: only a
device that presents it can claim a room or send audio features. The keys do
reach the relay, though: each device sends the keys it holds in the address of
the connection it opens to the relay, over an encrypted connection, so the
relay can check them (the room key is also in the link the QR code opens). The
relay hashes what it receives and stores only a one-way hash of each key, and
its code does not log them; but because they sit in request addresses,
Cloudflare's own handling of the request can see them (see below). Your
browsers keep their own copies of the keys in local storage so that a reload
rejoins without scanning again, and the phone's page removes the room key from
the address bar once it has saved it. A TV waiting to be paired shows a QR code
with a one-time code and sends that code in its own connect address; when a
phone scans the QR code and adds the TV, the relay passes the room key on to
the TV that holds that code, in a short request it does not store.

**The pairing server keeps what a paired room needs, for a limited time.**
The relay (a Cloudflare Worker, in [`server/`](server/)) holds room state —
who's in the room, which scene is showing — in memory while devices are
connected. A room that a laptop has claimed with keys also keeps, in the
Durable Object's storage, the hashed keys and the room's current settings
(their values as text, plus the scene and palette names), so the next screen
to connect gets them. No audio and no feature values are stored. Once
everyone has left, the room waits a fixed period
(`ROOM_IDLE_TTL_MS` in [`server/roomRules.ts`](server/roomRules.ts)) and then
deletes all of it. The relay also reads your IP address from Cloudflare's
`CF-Connecting-IP` header to rate-limit how often one visitor can create
rooms or ask to pair a screen, keeping only recent timestamps per IP in
memory for that purpose. It keeps no logs of the relayed data, and apart
from a claimed room's settings and key hashes, the only thing it stores at
all is the anonymous usage count described below.

**Cloudflare hosts the site.** Serving and protecting the site and the relay
means Cloudflare itself processes IP addresses and request metadata (including
the web addresses requested, which for pairing contain the keys described
above), under its own privacy policy: https://www.cloudflare.com/privacypolicy/. Your
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
are kept in your own browser's local storage and are not uploaded — except
what pairing needs, all described above: the settings a controlling phone
sends to its room, the keys, and the device id, which exists only so pairing
can recognize your device again.
Cloudflare's own Web Analytics may also count page loads for the site; it is
cookieless and described in Cloudflare's policy linked above.

Because this is open source (AGPL-3.0-or-later), every claim above is
verifiable in the code this page ships from — see the Source link in the app —
except what Cloudflare does as the host, which its own policy covers.

Who runs this: Yaroslav Maksymenko. Questions or concerns — open an issue at
https://github.com/maksymenkoyr/sine-visuals-lab/issues.
