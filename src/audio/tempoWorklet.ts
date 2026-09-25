import { TempoAnalyzer } from "./tempoAnalyzer.ts";

/**
 * The AudioWorkletProcessor that runs TempoAnalyzer on the audio render
 * thread, off the main/UI thread entirely — see tempoAnalyzer.ts's own
 * header for why that matters (a render-tick tracker degrades with the
 * frame rate; this doesn't, since it never sees a frame). Loaded via
 * tempoSource.ts's createTempoSource(), which is the only thing that ever
 * imports this file — the worklet's own global scope can't import anything
 * that isn't DOM-free (see tempoAnalyzer.ts's own dependency note).
 *
 * lib.dom.d.ts doesn't declare AudioWorkletGlobalScope's own globals
 * (`sampleRate`, `currentTime`, `registerProcessor`, `AudioWorkletProcessor`
 * itself) — they only exist inside a worklet's own global scope, not the
 * window, and pulling in a whole @types/audioworklet package for three
 * declarations isn't worth a new dependency (see CLAUDE.md's dependency
 * policy). Declared minimally below instead; `AudioWorkletNodeOptions` and
 * `MessagePort` are both already in lib.dom, so those are reused as-is.
 */
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

// Onsets are posted the moment they're detected, never delayed by the
// throttle below — they're already rare (features.ts's own refractory-style
// spacing means they're at least a few hops apart) and downstream consumers
// (the beat clock's phase comb, see tempoSource.ts's own header) want their
// exact time promptly. The throttle only limits how often a bpm-only update
// (no onset this block) gets posted, so a continuously drifting estimate
// doesn't message the main thread on every ~2.7ms render quantum.
const POST_MIN_INTERVAL_SEC = 0.02;
const BPM_CHANGE_EPS = 0.01;

class TempoWorkletProcessor extends AudioWorkletProcessor {
  private analyzer: TempoAnalyzer | null = null;
  private lastPostTime = -Infinity;
  private lastPostedBpm = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      if (!this.analyzer) this.analyzer = new TempoAnalyzer(sampleRate);

      const block = input[0].length;
      let mono: Float32Array;
      if (input.length === 1) {
        mono = input[0];
      } else {
        mono = new Float32Array(block);
        for (const ch of input) {
          for (let i = 0; i < block; i++) mono[i] += ch[i]! / input.length;
        }
      }

      this.analyzer.push(mono, currentTime);

      const onsets = this.analyzer.drainOnsets();
      const bpm = this.analyzer.bpm;
      const bpmChanged = Math.abs(bpm - this.lastPostedBpm) > BPM_CHANGE_EPS;
      if (onsets.length > 0 || (bpmChanged && currentTime - this.lastPostTime >= POST_MIN_INTERVAL_SEC)) {
        this.port.postMessage({ bpm, onsets });
        this.lastPostTime = currentTime;
        this.lastPostedBpm = bpm;
      }
    }

    // One silent output channel — never write into `outputs` (left at its
    // default all-zero content) so this node can sit in the graph without
    // ever being audible; see tempoSource.ts's own doc on why it's connected
    // to a zero-gain sink rather than left disconnected. Returning true
    // keeps the processor alive for the life of the node.
    return true;
  }
}

registerProcessor("tempo-analyzer", TempoWorkletProcessor);
