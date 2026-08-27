/** The gallery is the default landing route; a viz route names one registered scene. */
export type Route = { kind: "gallery" } | { kind: "viz"; sceneId: string };

const GALLERY: Route = { kind: "gallery" };
const VIZ_RE = /^#\/v\/([^/]+)\/?$/;

/** Pure hash -> Route. Deliberately does not validate the scene id against
 *  the registry — an unknown id is still a well-formed viz route, and it's
 *  the caller's job to decide what "unknown scene" means (fall back to the
 *  gallery, show a message, etc). */
export function parseRoute(hash: string): Route {
  if (!hash || hash === "#" || hash === "#/") return GALLERY;
  const m = VIZ_RE.exec(hash);
  if (!m || !m[1]) return GALLERY;
  return { kind: "viz", sceneId: decodeURIComponent(m[1]).toLowerCase() };
}

export function routeToHash(route: Route): string {
  return route.kind === "gallery" ? "#/" : `#/v/${encodeURIComponent(route.sceneId)}`;
}

export function currentRoute(): Route {
  return parseRoute(location.hash);
}

/** Every navigation — tile tap, Back/Forward, deep link — flows through the
 *  same `hashchange` listener (see onRouteChange), so there's exactly one
 *  code path that performs the gallery<->viz transition. This just sets the
 *  hash; it does not run the transition itself. */
export function navigate(route: Route, mode: "push" | "replace" = "push"): void {
  const hash = routeToHash(route);
  if (mode === "replace") {
    history.replaceState(null, "", hash);
    // replaceState doesn't fire hashchange — drive listeners manually so
    // "replace" behaves like "push" from the caller's perspective.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = hash;
  }
}

export function onRouteChange(cb: (route: Route) => void): () => void {
  const handler = () => cb(currentRoute());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}

/** Call once at boot, before wiring onRouteChange. If the page was loaded on
 *  a deep-linked viz route, this pushes a gallery entry underneath it so
 *  browser Back lands on the gallery instead of leaving the site entirely. */
export function seedHistory(): void {
  if (currentRoute().kind === "gallery") return;
  const deepLink = location.hash;
  history.replaceState(null, "", routeToHash(GALLERY));
  history.pushState(null, "", deepLink);
}
