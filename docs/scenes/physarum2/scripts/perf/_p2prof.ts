// TEMPORARY profiling hook — never commit. Times GL passes with
// EXT_disjoint_timer_query_webgl2 when globalThis.__p2prof is truthy.
type Rec = { sum: number; n: number };
const g = globalThis as unknown as {
  __p2prof?: boolean;
  __p2stats?: Record<string, Rec>;
  __p2flags?: Record<string, unknown>;
};
const pending: { q: WebGLQuery; name: string }[] = [];
let ext: unknown = undefined;

export function p2flag(name: string): unknown {
  return g.__p2flags?.[name];
}

export function prof(gl: WebGL2RenderingContext, name: string, fn: () => void): void {
  if (!g.__p2prof) {
    fn();
    return;
  }
  if (ext === undefined) ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) {
    fn();
    return;
  }
  const TIME_ELAPSED = (ext as { TIME_ELAPSED_EXT: number }).TIME_ELAPSED_EXT;
  const q = gl.createQuery()!;
  gl.beginQuery(TIME_ELAPSED, q);
  fn();
  gl.endQuery(TIME_ELAPSED);
  pending.push({ q, name });
}

export function profPoll(gl: WebGL2RenderingContext): void {
  if (!g.__p2prof) return;
  g.__p2stats ??= {};
  while (pending.length) {
    const { q, name } = pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
    gl.deleteQuery(q);
    pending.shift();
    const r = (g.__p2stats[name] ??= { sum: 0, n: 0 });
    r.sum += ns / 1e6;
    r.n++;
  }
}
