# Vocabulary

The words the controls panel uses for making a scene react to the sound. Every
user-facing string about this — labels, hints, tooltips, aria text, summaries —
uses these words and only these. The code keeps its own older names (the
right-hand column), so this note is the translation table between the two.

The model in one line: **an input node's jack → a wire (with its modifier) → an animation node's port.**

The panel reads in two columns: **input nodes** on the left (the meters hold
them) and **animation nodes** on the right (a scene's reactive settings). The
wires run between them, and each wire carries its own **modifier**, the stage
that reshapes an input node's value on its way to that one setting.

## Nouns

| Say | Means | Don't say | In code |
|---|---|---|---|
| **input node** | A live value measured from the sound or the tempo tracker: Bass hit, Treble level, Tempo lock, Beat wave. Its panel label comes from `driveSourceLabel` (`src/ui/driveSources.ts`); one input, one name, the same on its row, its wire and its pill. | signal, meter, source, input | `SignalId`, `DriveSourceChoice` |
| **jack** | The ring on an input node's row, in the meters. An input node goes *out* of its jack. | output, socket | `src/ui/jack.ts` |
| **animation node** | A scene setting that can follow input nodes. Shorten to **setting** once the sentence has said which one. | reactive setting, driver, drive row, patched setting, destination | a `SceneSetting` with a `drive` |
| **port** | The ring at the left of an animation node's row. Wires end here; clicking it pins the setting. | input port, jack | the row's `port` button (`buildDriveRow`) |
| **wire** | One connection from an input node's jack to a setting's port. In the wire panel each wire is one line, named after its input node. | cable, source, patch, link | one `DriveSource` in a `DrivePatch`'s `sources`; drawn by `src/ui/cableLayer.ts` |
| **wire panel** | Opens under a pinned setting. Lists its wires, how they mix, and its graph. Headed **Wires**. | patch panel, Receives | `buildPatchPanel` |
| **modifier** | A wire's own Window, Smoothness and Length. In the wide layout they open, with the wire's Height and weight, from the wire's knot on its cable (a click on the knot or the cable, `src/ui/cableKnots.ts`; also from the summary chip on the wire's line); in the stacked layout and Solo they show under the wire's line in the wire panel, after its Height. It belongs to that one wire: two settings on the same input node each have their own, and unplugging the wire drops it. A wire's modifier starts off and reads exactly what the plain wire reads. Named after the word other tools use (Notch's modifiers, Bitwig's modulators). | shaping node, filter, effect, processor, sound-transforming node | `DriveSource.mod`, `WireMod` (`src/render/wireMod.ts`), `src/ui/wireModControls.ts`, `src/ui/cableKnots.ts` |
| **heat** | How hot an animation node, a wire or an input node runs: how much of its range it swung over the meter span, hotter on loud music and colder on quiet music. Shown as a thin strip under a setting's graph and under an input node's monitor, in the Heat history card, as a dot after a wire's name, and as a glow under the **heat lens** (L, or the HEAT chip); colder = barely moves, hotter = big moves on loud music. | activity, temperature | `src/ui/heat.ts` |
| **built-in** | What a scene does with a setting before anything is wired: its own reaction, written by the scene. Summaries read "Built-in: …". | scene mix, scene default (for the reaction itself) | the `"scene"` `DriveSetting`; text from `drive.sceneLabel` |
| **mix** | How a setting's wires combine — one of `MIX_OPTIONS` (`src/ui/deviceMenu.ts`). Reserved for this; never reuse it for the built-in reaction. | combine, blend mode | `DriveMix` |
| **reaction** | What a setting that acts once per hit does on each hit: a burst, a jump, a cut. Its graph draws a dot per reaction. The **Reaction** row under the graph picks **Flat** (every reaction full size) or **Sized** (as big as its hit stood out); a setting whose reaction has no size shows Sized greyed out. | trigger, event, fire | `SceneSetting.drive.hit`, `HitReadout` (`src/render/standout.ts`) |
| **condition** | Under the gate mix ("Only when"), a wire whose input node opens the gate rather than moving the setting. The others **play**. | gate source, trigger | `DriveSource.when` |
| **meters** | The left column of cards that *show* the sound. A meter is a display; the input nodes in it are what you wire. | — | `METERS_COLUMN`, `src/ui/audioMeters.ts` |
| **sound source** | The microphone, line input or shared tab the sound comes from. The only thing in the panel called a source. | — | `AudioSource` |

## Verbs

| Say | For |
|---|---|
| **pin** / **unpin** | Opening and closing a setting's wire panel (click its label or port; Esc unpins). |
| **lock** / **let go** | Chladni's Mode ladder: holding the plate on one figure whatever the music does. Not **pin**, which opens a wire panel. |
| **plug in** / **unplug** | Adding or removing a wire: click an input node's jack, or drag it onto a setting's row, a "+ Add by name" chip, or Unplug. To unplug, also click or pull either end of the wire's cable. |
| **switch off** / **switch on** | Muting a wire without unplugging it, with the switch on its line or at the top of its knot; its weight, height and role are kept. |
| **only this** / **all back** | The **O** chip on a reactive setting's row (beside A and T), and a button in its wire panel, that switch off every other setting's reaction so only this one moves, then bring them back; a preview on this screen, the wires are kept. |
| **receive** | What a setting does with its wires: "what this setting receives". |
| **reset to scene default** | Throwing away the wires and going back to the scene's own starting state, built-in or wired. |

## Why these words

- **Nodes, not signals and settings.** The panel is a patch bay: something
  goes in on the left, gets shaped on its wire, and moves a picture on the
  right. Calling the two ends by the same kind of word (input node, animation
  node) makes that read at a glance. "Signal" is still the right word for the
  audio itself (a "cleaner signal" from a line input), so it stays out of the
  node vocabulary.
- **Input node, not meter.** A meter is the card that draws the sound; the
  thing with a jack is a value inside it. Calling both "meter" made "plug in
  a meter" sound like dragging a whole card.
- **Animation node, not driver.** The input node is what drives; the setting
  is what gets driven. "Driver" points the arrow backwards, and the code
  already uses `drive` for what comes *into* a setting.
- **Wire, not cable or source.** The panel already says "cable" for a real
  audio cable (the line-input and USB hints), and "source" for the sound
  source. A wire is the one thing drawn between a jack and a port.
- **Built-in, not scene mix.** "Mix" is the control right next to it; two different things can't share the word.
- **Sound card.** The first meter: what you hear before any beat logic. A thin
  live spectrum over Level, Bass, Mid and Treble, then **Bands**: rows for
  single bands, each named by its Hz, starting with the Kick band. Click a bar
  on the spectrum to give that band its own row and click it again to drop
  it; a band wired to a setting always shows its row. Its fold id (`"sound"`) is new, so the old Dynamics fold doesn't carry
  over.
- **Stems card.** Right after Sound: Lead and Hats, the held and the drum part
  of the sound, each its own row with its own colour and jack. Measured only
  on the device with the mic.

## Writing new copy

- Name the input node by its panel label, the setting by its row label: "Plug
  Bass hit into Beat Expand", "Unplug Bass hit".
- Prefer the concrete noun to the abstract one: "this wire", not "this
  source" or "this input".
- The code names in the right-hand column are not wrong and don't need
  renaming (`SignalId`, `SIGNALS` and the rest keep "signal"); they just never
  reach the screen.
