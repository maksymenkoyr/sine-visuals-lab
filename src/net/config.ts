const DEFAULT_LOCAL_WORKER = "https://localhost:8787";

/** Whether a page is on a developer machine (localhost, 127.0.0.1, `.local`):
 *  where the Worker is a separate dev origin and usage counting stays off. */
export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}

/**
 * In prod the Worker (static assets + Durable Object) is expected to be
 * deployed same-origin. In local dev, Vite (5173ish, HTTPS via
 * basic-ssl) and `wrangler dev` (8787, HTTPS via --local-protocol https)
 * run as two separate origins — see `npm run dev:worker`.
 */
export const WORKER_ORIGIN: string =
  import.meta.env.VITE_WORKER_URL ?? (isLocalHost(location.hostname) ? DEFAULT_LOCAL_WORKER : location.origin);
