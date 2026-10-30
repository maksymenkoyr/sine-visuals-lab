/**
 * Ember (draft): red fire rising out of black. A row of burners along the
 * bottom pushes red dye up into a full-screen fluid sim (fluidSim.ts, the
 * stable-fluids solver Neon Fluid and Sky share), so the fire rolls over
 * itself, curls and sheds blobs the way a real fluid does; the dye fades as
 * it climbs, which is where the black above comes from. Over a few bars the
 * fire swells up toward the top and sinks back. Kicks surge the burners, the
 * bass heats the glow, louder sections churn the fluid harder.
 *
 * The look was measured from a silent ambient loop (the `/ref` bundle
 * `vg2cB1EeJpo`), itself a fluid simulation; nothing in it syncs to music,
 * so every reaction here is our own design. docs/scenes/ember.md has the
 * record. motion.ts owns the swell, the kick lift and the burners; glsl.ts
 * draws the dye.
 *
 * The display is one hand-rolled pass, not createFullscreenScene, because it
 * samples a texture of the scene's own (Sky does the same, for the same
 * reason).
 */

import { NUM_BANDS } from "../../../audio/types.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import { createFullscreenQuad, createProgram, drawFullscreenQuad, type GLProgram } from "../../gl.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { DRIVE_GLSL, settingUniformName, uploadCommonUniforms } from "../../sceneCommon.ts";
import { createFluidSim, detectSimFormat, MIRROR_OFF, sameSimSize, simResolutionFor, type FluidSim, type Splat } from "../fluidSim.ts";
import { buildDisplayFrag } from "./glsl.ts";
import { advanceLift, BURNERS, burnerAt, createLiftState, STIRRERS, stirrerAt, swellAt, swellRate } from "./motion.ts";
import { card, SETTINGS } from "./card.ts";

const ID = card.id;

/** Upward push of one burner at full flare, in the sim's force units
 *  (texels/s² at FORCE_REF_ROWS rows — fluidSim.ts's header). */
const BURN_FORCE = 140;
/** Sideways push at full sway, as a share of the upward one. */
const BURN_SWAY = 0.2;
/** Dye per second at a burner's centre at full flare. */
const BURN_DYE = 2.2;
/** Burner radius, in screen heights. */
const BURN_SIGMA = 0.065;
/** How much harder the burners push, and how much more dye they lay, at a full kick lift. */
const LIFT_PUSH = 0.8;
const LIFT_DYE = 0.25;
/** How much brighter the glow burns at a full kick lift. */
const LIFT_HEAT = 0.45;
/** Sim seconds per real second at Rise speed 1: the reference's flow is slow. */
const RISE_TIME = 1;
/** The longest sim step; a slow frame is clamped so the solver stays stable. */
const SIM_DT_MAX = 1 / 30;
/** The longest frame step that counts as motion; a stalled tab's gap is clamped to this. */
const MAX_DT_SEC = 0.25;
const SIM_VISCOSITY = 0.1;
/** A fresh mount starts with an empty tank; for this long the sim takes
 *  WARM_STEPS steps a frame, so the fire is up within a couple of seconds
 *  instead of the many it takes at the reference's slow pace. */
const WARM_SEC = 2.5;
const WARM_STEPS = 3;
/** Push of one stirrer, in the same units as BURN_FORCE. */
const STIR_FORCE = 25;
const STIR_SIGMA = 0.08;
/** The bed: wide dye-only splats just below the bottom edge, so the base of
 *  the fire stays one red mass instead of the box's return flow pulling
 *  black down between the plumes. */
const BED_SPLATS = 3;
const BED_SIGMA = 0.2;
const BED_DYE = 1;

const SETTINGS_GLSL = SETTINGS.map((s) => `uniform float ${settingUniformName(s.key)};`).join("\n");
const setting = (key: string): number => {
  const s = SETTINGS.find((x) => x.key === key);
  return s ? resolveSceneSetting(ID, s) : 0;
};

function createEmberScene(): Scene {
  let quadVao: WebGLVertexArrayObject | null = null;
  let sim: FluidSim | null = null;
  let displayProg: GLProgram | null = null;
  let dyeLoc: WebGLUniformLocation | null = null;
  const bandsBuf = new Float32Array(NUM_BANDS);
  const splats: Splat[] = Array.from({ length: BURNERS + STIRRERS + BED_SPLATS }, (_, i) => ({
    x: i < BURNERS + STIRRERS ? 0 : (i - BURNERS - STIRRERS + 0.5) / BED_SPLATS,
    y: i < BURNERS + STIRRERS ? 0 : -0.04,
    sigma: i < BURNERS ? BURN_SIGMA : i < BURNERS + STIRRERS ? STIR_SIGMA : BED_SIGMA,
    fx: 0,
    fy: 0,
    dye: 0,
    tag: 0,
    ring: 0,
  }));
  let lift = createLiftState();
  let swellPhase = 0;
  let burnClock = 0;
  let warmSec = 0;

  const simSize = (ctx: SceneContext) =>
    simResolutionFor(ctx.quality.detail, Math.max(1, ctx.gl.drawingBufferWidth), Math.max(1, ctx.gl.drawingBufferHeight), MIRROR_OFF);

  return {
    ...card,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      quadVao = createFullscreenQuad(gl);
      const format = detectSimFormat(gl);
      sim = createFluidSim(gl, quadVao, simSize(ctx), format, { splatSlots: BURNERS + STIRRERS + BED_SPLATS, edge: false });
      displayProg = createProgram(gl, buildDisplayFrag(format, SETTINGS_GLSL, DRIVE_GLSL(SETTINGS)));
      dyeLoc = gl.getUniformLocation(displayProg.program, "uDye");
      lift = createLiftState();
      swellPhase = 0;
      burnClock = 0;
      warmSec = 0;
    },

    render(ctx, frame, viewport, palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!displayProg || !quadVao || !sim) return;
      const { gl } = ctx;
      const want = simSize(ctx);
      if (!sameSimSize(want, sim.size)) sim.resize(want);

      const dt = Math.min(Math.max(anim.dtSec, 0), MAX_DT_SEC);
      // Called every frame, unconditionally: fired() must see every frame.
      const fired = drives.fired("lift", anim.song.kickOnset);
      const lvl = advanceLift(lift, dt, fired ? drives.hitSize("lift") * setting("lift") : 0);
      swellPhase = (swellPhase + dt * swellRate(setting("swellBars"), anim.tempoBpm, anim.tempoLock)) % 1;
      const swell = swellAt(swellPhase);
      const rise = setting("rise");
      burnClock += dt * rise;

      const push = BURN_FORCE * (0.6 + 0.4 * swell) * (1 + LIFT_PUSH * lvl);
      const dyeRate = BURN_DYE * (0.35 + 0.65 * swell) * (1 + LIFT_DYE * lvl);
      for (let i = 0; i < BURNERS; i++) {
        const b = burnerAt(i, burnClock);
        const s = splats[i];
        s.x = b.x;
        s.y = b.y;
        s.fx = push * BURN_SWAY * b.sway;
        s.fy = push * b.flare;
        s.dye = dyeRate * b.flare;
      }
      for (let i = 0; i < STIRRERS; i++) {
        const st = stirrerAt(i, burnClock);
        const s = splats[BURNERS + i];
        s.x = st.x;
        s.y = st.y;
        s.fx = STIR_FORCE * st.dx;
        s.fy = STIR_FORCE * st.dy;
      }
      for (let i = 0; i < BED_SPLATS; i++) splats[BURNERS + STIRRERS + i].dye = BED_DYE * (0.35 + 0.65 * swell);
      // At rest the fluid churns as much as the silent reference does; louder
      // sections add to it.
      const churn = setting("churn") * (0.9 + 0.5 * drives.value("churn", anim.sectionIntensity));
      const pace = 1 + 0.3 * drives.value("rise", frame.energy);
      const steps = warmSec < WARM_SEC ? WARM_STEPS : 1;
      warmSec += dt;
      for (let n = 0; n < steps; n++) {
        sim.step({
          dt: Math.min(SIM_DT_MAX, dt * rise * RISE_TIME * pace),
          curl: Math.min(1, churn),
          // Fire height is the inverse of how fast the dye fades as it climbs.
          dissipation: Math.min(1, Math.max(0, 1 - setting("level"))) * 0.2,
          energy: 0,
          viscosity: SIM_VISCOSITY,
          splats,
        });
      }

      gl.disable(gl.BLEND);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      displayProg.use();
      uploadCommonUniforms(displayProg, ctx, frame, viewport, palette, anim, ID, SETTINGS, bandsBuf, drives);
      // The fluid answers a push over a beat or so; the glow flaring with the
      // lift is what makes each kick read at once.
      displayProg.setF("uHeatAmt", setting("heat") * (0.85 + 0.6 * drives.value("heat", anim.low)) * (1 + LIFT_HEAT * lvl));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sim.dyeTexture());
      gl.uniform1i(dyeLoc, 0);
      drawFullscreenQuad(gl, quadVao);
      // The gallery renders every scene into one shared context each tick:
      // never leak a bound texture onto the next tile.
      gl.bindTexture(gl.TEXTURE_2D, null);
    },

    dispose(ctx: SceneContext) {
      sim?.dispose();
      displayProg?.dispose();
      if (quadVao) ctx.gl.deleteVertexArray(quadVao);
      sim = null;
      displayProg = null;
      quadVao = null;
      dyeLoc = null;
    },
  };
}

export const emberScene = createEmberScene();
