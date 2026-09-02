/**
 * The product's public identity — the single home for the name and the
 * source-repository URL. Everything user-facing that states either one
 * (gallery header, TV corner link, HTML <title>s) must trace back here.
 *
 * SOURCE_URL is not cosmetic: AGPL-3.0 §13 requires every page served to
 * network users to prominently offer the Corresponding Source. The gallery
 * header (src/ui/gallery.ts) and the TV entry (src/tv.ts) each render a link
 * to this URL to satisfy that. If the repository moves, update it here and
 * both surfaces follow.
 *
 * The name and logo are trademarks, not covered by the AGPL license — see
 * the License section of README.md. Forks must ship under their own name,
 * which is exactly why the name is centralized: it's the one string a fork
 * is expected to change.
 */
export const PRODUCT_NAME = "Sine Visuals Lab";
export const SOURCE_URL = "https://github.com/maksymenkoyr/sine-visuals-lab";
