/**
 * The product's public identity — the single home for the name, the
 * source-repository URL and the social profile. Everything user-facing that states either one
 * (gallery masthead and footer, TV corner link, HTML <title>s) must trace back here.
 *
 * SOURCE_URL is not cosmetic: AGPL-3.0 §13 requires every page served to
 * network users to prominently offer the Corresponding Source. The gallery
 * footer (src/ui/gallery.ts) and the TV entry (src/tv.ts) each render a link
 * to this URL to satisfy that. If the repository moves, update it here and
 * both surfaces follow.
 *
 * The AGPL license grants no trademark rights: the name and logo are
 * trademarks, reserved regardless of what the code license permits — see
 * the License section of README.md. Forks must ship under their own name,
 * which is exactly why the name is centralized: it's the one string a fork
 * is expected to change.
 */
export const PRODUCT_NAME = "Sine Visuals Lab";
export const SOURCE_URL = "https://github.com/maksymenkoyr/sine-visuals-lab";
/** The project's Instagram — linked from the gallery footer and listed in
 *  index.html's Organization `sameAs` (keep the two in step). */
export const INSTAGRAM_URL = "https://www.instagram.com/sinevisualslab/";
