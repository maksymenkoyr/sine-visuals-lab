import workletUrl from "./engineWorklet.ts?worker&url";
import { pinAsset } from "../pinnedAssets.ts";
import { AudioEngine } from "./engine/engine.ts";
import type { EngineReading } from "./types.ts";

/**
 * Feeds the audio engine (src/audio/engine/engine.ts) from a capture.
 * engineWorklet.ts posts every render quantum with its audio-clock time, and
 * the engine analyses it here on the main thread, the way it was measured: a
 * frame's band levels are the RMS over exactly the audio since the frame
 * before, and only the frame knows when that is. A stalled main thread delays
 * nothing but the reading itself; the queued quanta keep their own times.
 *
 * The node is wired source -> node -> a zero-gain sink -> destination: some
 * browsers throttle or stop a node whose output reaches no destination, and
 * the worklet never writes its output, so the sink stays silent.
 *
 * Where the context has no audioWorklet, or addModule() fails (an older
 * Safari), a ScriptProcessorNode taps the same audio in SCRIPT_BLOCK blocks:
 * deprecated, but everywhere, and gapless, which a per-frame read of an
 * AnalyserNode is not. Its blocks arrive later than quanta do and are stamped
 * from the context clock at arrival, so beats sit a little late there.
 */
export interface EngineSource {
  /** The reading for the frame at `now` (the capture's AudioContext clock). The object is reused. */
  read(now: number): EngineReading;
  /** The engine's tempo, 0 while it hears no steady pulse. */
  readonly bpm: number;
  dispose(): void;
}

const SCRIPT_BLOCK = 1024;

// Pinned (src/pinnedAssets.ts): addModule() runs when the mic first starts,
// which can be long after load and after a deploy has replaced dist/.
const engineWorklet = pinAsset(workletUrl);

/** Connects `node` into the graph through a silent sink; returns the teardown. */
function attach(context: AudioContext, sourceNode: AudioNode, node: AudioNode): () => void {
  const sink = context.createGain();
  sink.gain.value = 0;
  sourceNode.connect(node);
  node.connect(sink);
  sink.connect(context.destination);
  return () => {
    sourceNode.disconnect(node);
    node.disconnect();
    sink.disconnect();
  };
}

async function workletTap(context: AudioContext, sourceNode: AudioNode, engine: AudioEngine): Promise<(() => void) | null> {
  if (!context.audioWorklet) return null;
  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(await engineWorklet.url("text/javascript"));
    node = new AudioWorkletNode(context, "engine-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (err) {
    if (import.meta.env.DEV) console.warn("engineSource: no AudioWorklet, tapping with a ScriptProcessorNode", err);
    return null;
  }
  node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; time: number }>) => engine.push(e.data.samples, e.data.time);
  const detach = attach(context, sourceNode, node);
  return () => {
    node.port.onmessage = null;
    detach();
  };
}

function scriptTap(context: AudioContext, sourceNode: AudioNode, engine: AudioEngine): (() => void) | null {
  if (typeof context.createScriptProcessor !== "function") return null;
  const node = context.createScriptProcessor(SCRIPT_BLOCK, 2, 1);
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer;
    const n = input.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < input.numberOfChannels; c++) {
      const ch = input.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / input.numberOfChannels;
    }
    engine.push(mono, context.currentTime - n / context.sampleRate);
  };
  const detach = attach(context, sourceNode, node);
  return () => {
    node.onaudioprocess = null;
    detach();
  };
}

/** Starts feeding a fresh engine from `sourceNode`; null where neither tap can be built. */
export async function createEngineSource(context: AudioContext, sourceNode: AudioNode): Promise<EngineSource | null> {
  const engine = new AudioEngine(context.sampleRate);
  const detach = (await workletTap(context, sourceNode, engine)) ?? scriptTap(context, sourceNode, engine);
  if (!detach) return null;
  let last = context.currentTime;
  return {
    read(now: number): EngineReading {
      const dt = Math.max(1e-3, now - last);
      last = now;
      return engine.read(dt);
    },
    get bpm(): number {
      return engine.bpm;
    },
    dispose: detach,
  };
}
