/**
 * The AudioWorkletProcessor behind src/audio/engineSource.ts: hands every
 * render quantum of the capture to the main thread, downmixed to mono and
 * stamped with the audio-clock time of its first sample. Loaded only through
 * engineSource.ts's addModule(), and imports nothing: a worklet's global
 * scope has no DOM and no app modules.
 *
 * lib.dom.d.ts doesn't declare AudioWorkletGlobalScope's own globals, and a
 * whole @types package for three declarations isn't worth a dependency, so
 * they're declared minimally below.
 */
declare const currentTime: number;
declare function registerProcessor(name: string, processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

class EngineTapProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      const n = input[0].length;
      // A new buffer each quantum: it is transferred, not copied.
      const mono = new Float32Array(n);
      for (const ch of input) for (let i = 0; i < n; i++) mono[i] += ch[i] / input.length;
      this.port.postMessage({ samples: mono, time: currentTime }, [mono.buffer]);
    }
    // `outputs` is never written: the node sits in the graph silent (see engineSource.ts).
    return true;
  }
}

registerProcessor("engine-tap", EngineTapProcessor);
