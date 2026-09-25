import workletUrl from "./tempoWorklet.ts?worker&url";
import type { TempoOnset } from "./tempoAnalyzer.ts";

/**
 * Main-thread handle onto the AudioWorklet-hosted TempoAnalyzer (see
 * tempoWorklet.ts) — createTempoSource() loads the worklet module, wires it
 * into the capture graph, and exposes its latest bpm and drained onsets to
 * app.ts. `?worker&url` (not the plain `?worker` constructor import) is
 * what Vite needs here: AudioWorkletNode is created from a URL
 * (`audioWorklet.addModule(url)`), never a `Worker` instance, and the
 * worklet's own module still gets built as its own asset either way — see
 * vite.config.ts's `target: "es2017"` comment for why the whole build
 * (worklet included) targets one conservative baseline rather than a split
 * pipeline, and `npm run build`'s own output for confirmation the worklet
 * lands as a separate emitted asset.
 *
 * The node is wired sourceNode -> node -> a zero-gain GainNode ->
 * destination, never left unconnected to destination: several browsers
 * throttle or entirely stop an AudioWorkletNode's process() calls once
 * nothing downstream reaches the destination (the same reason a muted
 * <video> can still get frame-skipped in a background tab) — the zero-gain
 * sink keeps it pulled into the graph's live render loop while staying
 * silent by construction (see tempoWorklet.ts's own never-write-`outputs`
 * comment for the other half of that guarantee).
 *
 * Any failure along the way (no `audioWorklet` on this AudioContext,
 * addModule() rejecting, AudioWorkletNode construction throwing) resolves
 * null rather than throwing — app.ts keeps PR 1's render-tick tracker
 * (features.ts) in that case, so an older browser or a locked-down context
 * just doesn't get the fixed-hop path's better timing. Logged once in DEV,
 * never in production (no user-facing console noise for something the app
 * already falls back from cleanly).
 */
export interface TempoSource {
  /** The worklet's latest tempo estimate — read fresh each time, not a
   *  snapshot: mutated as port messages arrive (see the message handler
   *  below), same pattern as beatClock.ts's own live-read fields. */
  readonly bpm: number;
  /** Every onset detected since the last drain, oldest first — `time` is in
   *  this same AudioContext's own clock (`context.currentTime`'s timeline,
   *  the worklet's `currentTime` global), the same clock app.ts's
   *  `capture.context.currentTime` already reads elsewhere, so callers can
   *  compute `agoSec` directly without a cross-clock conversion. */
  drainOnsets(): TempoOnset[];
  /** Tears down the node/sink and stops listening on the port — call
   *  wherever the capture it was built from gets torn down. */
  dispose(): void;
}

export async function createTempoSource(context: AudioContext, sourceNode: AudioNode): Promise<TempoSource | null> {
  if (!context.audioWorklet) return null; // no AudioWorklet support at all

  try {
    await context.audioWorklet.addModule(workletUrl);
  } catch (err) {
    if (import.meta.env.DEV) console.warn("tempoSource: audioWorklet.addModule failed, falling back to the render-tick tracker", err);
    return null;
  }

  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(context, "tempo-analyzer", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (err) {
    if (import.meta.env.DEV) console.warn("tempoSource: AudioWorkletNode construction failed, falling back to the render-tick tracker", err);
    return null;
  }

  // See this file's own header for why a zero-gain sink, not "just don't
  // connect to destination".
  const sink = context.createGain();
  sink.gain.value = 0;
  sourceNode.connect(node);
  node.connect(sink);
  sink.connect(context.destination);

  let bpm = 0;
  let onsets: TempoOnset[] = [];
  node.port.onmessage = (event: MessageEvent<{ bpm: number; onsets: TempoOnset[] }>) => {
    bpm = event.data.bpm;
    if (event.data.onsets.length > 0) onsets.push(...event.data.onsets);
  };

  return {
    get bpm(): number {
      return bpm;
    },
    drainOnsets(): TempoOnset[] {
      const out = onsets;
      onsets = [];
      return out;
    },
    dispose(): void {
      node.port.onmessage = null;
      sourceNode.disconnect(node);
      node.disconnect();
      sink.disconnect();
    },
  };
}
