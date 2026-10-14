# Vocabulary

The words the controls panel uses for making a scene react to the sound. Every
user-facing string about this — labels, hints, tooltips, aria text, summaries —
uses these words and only these. The code keeps its own older names (the
right-hand column), so this note is the translation table between the two.

The model in one line: **an input node's jack → a wire → an animation node's port.**

The panel reads in three columns: **input nodes** on the left (the meters hold
them), **animation nodes** on the right (a scene's reactive settings), and in
the middle the **sound-transforming nodes** (working name), the stage that
reshapes an input node's value on its way to an animation node.

## Nouns

| Say | Means | Don't say | In code |
|---|---|---|---|
| **input node** | A live value measured from the sound or the tempo tracker: Bass hits, Treble level, Tempo lock, Beat wave. Its panel label comes from `driveSourceLabel` (`src/ui/driveSources.ts`). | signal, meter, source, input | `SignalId`, `DriveSourceChoice` |
| **jack** | The ring on an input node's row, in the meters. An input node goes *out* of its jack. | output, socket | `src/ui/jack.ts` |
| **animation node** | A scene setting that can follow input nodes. Shorten to **setting** once the sentence has said which one. | reactive setting, driver, drive row, patched setting, destination | a `SceneSetting` with a `drive` |
| **port** | The ring at the left of an animation node's row. Wires end here; clicking it pins the setting. | input port, jack | the row's `port` button (`buildDriveRow`) |
| **wire** | One connection from an input node's jack to a setting's port. In the wire panel each wire is one line, named after its input node. | cable, source, patch, link | one `DriveSource` in a `DrivePatch`'s `sources`; drawn by `src/ui/cableLayer.ts` |
| **wire panel** | Opens under a pinned setting. Lists its wires, how they mix, and its graph. Headed **Wires**. | patch panel, Receives | `buildPatchPanel` |
| **sound-transforming node** *(working name)* | The middle stage between an input node and an animation node: what a wire's weight, height, role and the mix do to the value on its way. For now the panel shows it as the wire panel's lines; no string says it yet. | filter, effect, processor | `DriveSource` weight/height/`DriveMix` |
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
| **plug in** / **unplug** | Adding or removing a wire: click an input node's jack, a "+ Add by name" chip, or Unplug. |
| **switch off** / **switch on** | Muting a wire without unplugging it; its weight, height and role are kept. |
| **receive** | What a setting does with its wires: "what this setting receives". |
| **reset to scene default** | Throwing away the wires and going back to the scene's own starting state, built-in or wired. |

## Why these words

- **Nodes, not signals and settings.** The panel is a patch bay: something
  goes in on the left, gets shaped in the middle, and moves a picture on the
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
- **Dynamics card, not Signal card.** With every wireable value an input
  node, a card called Signal read as "the card with the input nodes" — but
  every meter card has them. The card shows level, loudness and the gate,
  which is what dynamics means in audio. Its fold id (`"signal"`) is unchanged
  so a folded card stays folded.

## Writing new copy

- Name the input node by its panel label, the setting by its row label: "Plug
  Bass hits into Beat Expand", "Unplug Bass hits".
- Prefer the concrete noun to the abstract one: "this wire", not "this
  source" or "this input".
- The code names in the right-hand column are not wrong and don't need
  renaming (`SignalId`, `SIGNALS` and the rest keep "signal"); they just never
  reach the screen.
