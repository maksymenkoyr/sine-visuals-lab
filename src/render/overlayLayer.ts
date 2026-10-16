// The panel's label font, bundled by Vite like every other face here. The TV
// and the output window have no panel, so this import is what makes the face
// exist there; it is the same file controlsTheme.ts imports, so no second copy
// ships. (pinnedAssets.ts sweeps every registered face, so nothing to add.)
import "@fontsource/chakra-petch/latin-500.css";
import { createProgram, type GLProgram } from "./gl.ts";
import { layoutOverlay, overlayVisible, type OverlaySettings } from "./overlayLayout.ts";
import { getOverlay } from "./overlayStore.ts";

/**
 * Draws the Overlay (text and a logo, render/overlayLayout.ts) over the
 * finished scene: `createOverlayLayer(gl).draw()` once per frame, right after
 * the scene's own draw, on the main canvas, the output window's and a TV's —
 * so it is in anything that records the canvas, and it never touches a scene.
 *
 * The text and the logo are painted into a small 2D canvas (just the block's
 * pixels, shadow included) and uploaded as a texture only when the settings,
 * the canvas size, the logo's decode or the font's arrival change; every other
 * frame is one alpha-blended quad (the texture is straight alpha, the shader
 * premultiplies, the blend is ONE / ONE_MINUS_SRC_ALPHA). Nothing set means
 * draw() returns before touching GL, and no GL object is made until the first
 * thing to show.
 *
 * Scenes assume default GL state, so draw() leaves the state a scene expects:
 * blending off with the default function, the default framebuffer, texture
 * unit 0 with nothing bound, no program or vertex array, depth/cull/scissor
 * off and the viewport the full canvas. A lost context needs nothing here:
 * the three pages reload on restore (gl.ts's watchContextLoss), and their
 * loops do not call draw() while it is down.
 */

const FONT_FAMILY = "'Chakra Petch', system-ui, sans-serif";
const FONT_WEIGHT = 500;
/** The size the text is measured at; its width scales linearly with the font size. */
const MEASURE_PX = 100;
const SHADOW_COLOR = "rgba(0, 0, 0, 0.75)";

const VERT = `#version 300 es
uniform vec4 uRect; // clip-space x0, y0 (bottom), x1, y1 (top)
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(mix(uRect.xy, uRect.zw, c), 0.0, 1.0);
  vUv = vec2(c.x, 1.0 - c.y); // the canvas's first row is its top
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec4 t = texture(uTex, vUv);
  fragColor = vec4(t.rgb * t.a, t.a) * uOpacity;
}`;

function fontSpec(px: number): string {
  return `${FONT_WEIGHT} ${px}px ${FONT_FAMILY}`;
}

export interface OverlayLayer {
  /** Draws the overlay, or returns at once when there is nothing to show. */
  draw(): void;
  /** Frees the program and texture. */
  dispose(): void;
}

export function createOverlayLayer(gl: WebGL2RenderingContext): OverlayLayer {
  let program: GLProgram | null = null;
  let texture: WebGLTexture | null = null;
  let raster: HTMLCanvasElement | null = null;

  // What the texture was last built from.
  let builtFor: OverlaySettings | null = null;
  let builtW = 0;
  let builtH = 0;
  let builtEpoch = -1;
  /** Clip-space rect of the uploaded block; null = nothing to draw. */
  let rect: [number, number, number, number] | null = null;

  // Anything that can finish after the first frame bumps `epoch`, which
  // makes the next draw() rebuild.
  let epoch = 0;
  let fontRequested = false;
  let logoSrc = "";
  let logoImg: HTMLImageElement | null = null;
  /** True while a logo is set but not yet decoded (or failed to decode). */
  let logoPending = false;

  function requestFont(text: string): void {
    if (fontRequested || typeof document === "undefined" || !document.fonts) return;
    fontRequested = true;
    document.fonts
      .load(fontSpec(MEASURE_PX), text)
      .then(() => {
        epoch++;
      })
      .catch(() => {
        // A face that will not load stays on the system fallback.
      });
  }

  function syncLogo(src: string): void {
    if (src === logoSrc) return;
    logoSrc = src;
    logoImg = null;
    logoPending = src !== "";
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (logoSrc !== src) return;
      logoImg = img;
      logoPending = false;
      epoch++;
    };
    // A logo that will not decode is dropped: the text alone still shows.
    img.onerror = () => {
      if (logoSrc !== src) return;
      logoPending = false;
      epoch++;
    };
    img.src = src;
  }

  function ensureGl(): boolean {
    if (program && texture) return true;
    try {
      program = createProgram(gl, FRAG, VERT);
    } catch {
      return false;
    }
    texture = gl.createTexture();
    if (!texture) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return true;
  }

  /** Paints the block into the 2D canvas and uploads it. */
  function rebuild(s: OverlaySettings, w: number, h: number): void {
    builtFor = s;
    builtW = w;
    builtH = h;
    builtEpoch = epoch;
    rect = null;

    if (!raster) raster = document.createElement("canvas");
    const ctx = raster.getContext("2d");
    if (!ctx) return;

    let advance = 0;
    if (s.text) {
      requestFont(s.text);
      ctx.font = fontSpec(MEASURE_PX);
      advance = ctx.measureText(s.text).width / MEASURE_PX;
    }
    const img = logoImg;
    const layout = layoutOverlay({
      canvasW: w,
      canvasH: h,
      position: s.position,
      size: s.size,
      textAdvance: advance,
      logoAspect: img && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0,
    });
    if (!layout || !ensureGl()) return;

    const { box } = layout;
    raster.width = box.w; // resizing also clears
    raster.height = box.h;
    ctx.shadowColor = SHADOW_COLOR;
    ctx.shadowBlur = layout.shadowBlurPx;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = layout.shadowDyPx;
    if (img && layout.logo) ctx.drawImage(img, layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h);
    if (advance > 0) {
      ctx.font = fontSpec(layout.fontPx);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      // Twice, so the soft shadow is dark enough to read on a bright picture.
      ctx.fillText(s.text, layout.textX, layout.textMidY);
      ctx.fillText(s.text, layout.textX, layout.textMidY);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Unpack state is shared with whatever scene drew this frame, so the
    // upload names the flip and alpha handling it needs (the vertex shader
    // flips; FRAG premultiplies) rather than trusting a scene left defaults.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster);
    gl.bindTexture(gl.TEXTURE_2D, null);

    rect = [
      (box.x / w) * 2 - 1,
      1 - ((box.y + box.h) / h) * 2,
      ((box.x + box.w) / w) * 2 - 1,
      1 - (box.y / h) * 2,
    ];
  }

  return {
    draw(): void {
      const s = getOverlay();
      if (!overlayVisible(s)) return;
      syncLogo(s.logo);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      if (logoPending) return;
      if (s !== builtFor || w !== builtW || h !== builtH || epoch !== builtEpoch) rebuild(s, w, h);
      if (!rect || !program || !texture) return;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      program.use();
      program.setV4("uRect", rect[0], rect[1], rect[2], rect[3]);
      program.setF("uOpacity", s.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.disable(gl.BLEND);
      gl.useProgram(null);
    },
    dispose(): void {
      program?.dispose();
      program = null;
      if (texture) gl.deleteTexture(texture);
      texture = null;
      raster = null;
      builtFor = null;
      rect = null;
      logoSrc = "";
      logoImg = null;
      logoPending = false;
    },
  };
}
