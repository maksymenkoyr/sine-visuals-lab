// Swarm ("Entropic Collapse") -- a few hundred particles, each with a position
// and a phase, drawn as a graph of thin additive lines between near
// neighbours on black. They fall from a scattered net into one body: a dense
// white core of in-sync particles breathing on the beat, inside a thin, fixed
// ring of out-of-sync drifters. Colour follows crowding (collectEdges): the
// packed core is white, the rim rose, its loosest tips orange and lime. The physics is swarmSim.ts (pure, tested in tests/swarmSim.test.ts);
// glsl.ts draws it; this file is the wiring: settings, drives, the fixed-step
// loop, framing, and the two instanced draws. docs/scenes/swarm.md is the
// record (what it was built from, what was tried).
//
// Sync mapping (drives, not fixed couplings -- see drives.ts's header):
// Breath is the core's attraction swinging with the beat wave, once every two
// beats by default (a Scene source: DriveSource.every can't be set from a
// setting's own default, and one swing a beat is too fast for the swarm to
// follow). Scatter knocks a small share of the
// particles out of step on a hit; they fly out to the rim and fall back in as
// they re-sync, which also keeps the core loose enough to breathe (with no
// hits at all it packs tight and still, the reference's settled state). Heat is the phase
// noise, riding the overall level. Re-collapse throws the whole swarm back
// out to the scattered start on a drop and collapses it again; the scene also
// collapses once on start.
//
// Time: the sim runs on a fixed 1/60 step with an accumulator, at most four
// steps a frame (the remainder is dropped on a stall), from this scene's own
// delta of anim.timeSec -- the gallery preview hands render() an un-latched
// anim, so anim.dtSec is not used (same reasoning as coil, slats, powder).
//
// Drawing: no float target exists in this repo, so glsl.ts folds the soft
// tone curve into a screen blend; the quads' edge buffer is refilled from the
// sim every frame (bufferSubData into a buffer sized for the worst case).
import { createProgram, type GLProgram } from "../../gl.ts";
import type { SceneSetting } from "../../sceneSettings.ts";
import { resolveSceneSetting } from "../../autoTune.ts";
import type { Scene, SceneContext } from "../../scene.ts";
import { PASSTHROUGH_DRIVES } from "../../drives.ts";
import type { QualityPreset } from "../../quality.ts";
import { EDGE_VERT, EDGE_FRAG, NODE_VERT, NODE_FRAG } from "./glsl.ts";
import {
  createSwarm,
  stepSwarm,
  scatterPhases,
  rescatter,
  collapseTrap,
  collectEdges,
  createRng,
  DEFAULT_SWARM_PARAMS,
  EDGE_STRIDE,
  WORLD_HALF_HEIGHT,
  type Swarm,
  type SwarmParams,
} from "./swarmSim.ts";

const ID = "swarm";

const STEP_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;
/** Edge-buffer room per particle -- every near pair past this is dropped. */
const EDGES_PER_PARTICLE = 48;
const SEED = 20260903;

/** Particle count by quality preset, used while the Particles setting sits
 *  at its default; moving the slider overrides it. */
const TIER_PARTICLES: Record<QualityPreset, number> = { high: 320, mid: 256, low: 160, floor: 128 };

/** The reference frame's height in world units, the stroke and node sizes'
 *  pixel basis: stroke and node radius are in pixels at this canvas height. */
const REF_PX_HEIGHT = 720;
const STROKE_PX = 1.6;
const NODE_RADIUS_PX = 1.4;
/** Edge brightness at Lines = 1 (the prototype's own value, then tuned). */
const EDGE_ALPHA = 0.22;
const NODE_ALPHA = 0.8;
const EDGE_REACH_WORLD = 90;
/** World-to-screen zoom at Size 1: the sim's rim settles at 0.41
 *  half-heights (measured on our frames, 2026-10-03) and the reference's at
 *  0.46, so Size 1 frames it the same. */
const FRAME_SCALE = 1.12;
const CENTROID_TAU = 0.3;
const COLLAPSE_SECONDS_SLOW = 16;
const COLLAPSE_SECONDS_FAST = 6;

const SETTINGS: SceneSetting[] = [
  // Form
  {
    key: "particles",
    label: "Particles",
    description: "How many particles are in the swarm — right is denser and heavier to draw; untouched, it follows the quality preset",
    group: "Form",
    min: 96,
    max: 480,
    step: 8,
    default: 256,
    masterScale: false,
  },
  {
    key: "sync",
    label: "Sync",
    description: "How strongly neighbours pull each other's phase — right locks more of the swarm into the white core, left leaves more drifters",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "drifters",
    label: "Drifters",
    description: "How different the particles' own rhythms are — right makes a thicker, busier rim of out-of-sync drifters",
    group: "Form",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  // Motion
  {
    key: "breath",
    label: "Breath",
    description: "How far the core swells and contracts — by default once every two beats, with the tempo",
    group: "Motion",
    min: 0,
    max: 1.5,
    step: 0.05,
    default: 1,
    drive: { default: "scene", sceneLabel: "Scene: beat wave, every 2 beats", sceneSources: ["anim.beatWave"] },
  },
  {
    key: "scatter",
    label: "Scatter",
    description: "How many particles a hit knocks out of step — they fly out to the rim, then fall back into the core as they re-sync",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    drive: { default: "feature.onset" },
  },
  {
    key: "heat",
    label: "Heat",
    description: "How much random jitter the phases get — right keeps more of the swarm restless and the core looser",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    drive: { default: "anim.energy" },
  },
  {
    key: "damping",
    label: "Damping",
    description: "How quickly the swarm's motion dies away — right settles the breathing, left lets it ring",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
  },
  {
    key: "collapse",
    label: "Re-collapse",
    description: "How readily a drop throws the swarm back out to a scattered net to collapse again, and how fast it falls in — 0 never re-scatters",
    group: "Motion",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    drive: { default: "anim.dropOnset" },
  },
  // Look
  {
    key: "lines",
    label: "Lines",
    description: "How bright the connecting lines are",
    group: "Look",
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
  },
  {
    key: "reach",
    label: "Reach",
    description: "How far apart two particles can be and still draw a line — right weaves a denser net",
    group: "Look",
    min: 0.5,
    max: 1.5,
    step: 0.05,
    default: 1,
  },
  {
    key: "colours",
    label: "Colours",
    description: "How far the lines take on colour with their phase — 0 is all white, right adds the rose, orange and green of the drifters",
    group: "Look",
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
  },
  // Camera
  {
    key: "size",
    label: "Size",
    description: "How large the swarm is on screen",
    group: "Camera",
    min: 0.5,
    max: 1.6,
    step: 0.05,
    default: 1,
  },
];

function settingFor(key: string): SceneSetting {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) throw new Error(`swarm: unknown setting ${key}`);
  return s;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function createSwarmScene(): Scene {
  let edgeProg: GLProgram | null = null;
  let nodeProg: GLProgram | null = null;
  let edgeVao: WebGLVertexArrayObject | null = null;
  let nodeVao: WebGLVertexArrayObject | null = null;
  let edgeBuf: WebGLBuffer | null = null;
  let nodeBuf: WebGLBuffer | null = null;
  let edgeData = new Float32Array(0);
  let nodeData = new Float32Array(0);
  let offsets = new Float64Array(0);

  let swarm: Swarm | null = null;
  let swarmCount = 0;
  const rng = createRng(SEED ^ 0x9e3779b9);
  const params: SwarmParams = { ...DEFAULT_SWARM_PARAMS };
  let lastTime: number | null = null;
  let accumulator = 0;
  let simTime = 0;
  let collapseStart = 0;
  let collapseSeconds = COLLAPSE_SECONDS_SLOW;
  let centreX = 0;
  let centreY = 0;
  let centreSet = false;
  let lastWave = 0.5;

  function freeBuffers(gl: WebGL2RenderingContext): void {
    if (edgeVao) gl.deleteVertexArray(edgeVao);
    if (nodeVao) gl.deleteVertexArray(nodeVao);
    if (edgeBuf) gl.deleteBuffer(edgeBuf);
    if (nodeBuf) gl.deleteBuffer(nodeBuf);
    edgeVao = nodeVao = null;
    edgeBuf = nodeBuf = null;
  }

  function buildBuffers(gl: WebGL2RenderingContext, count: number): void {
    freeBuffers(gl);
    edgeData = new Float32Array(count * EDGES_PER_PARTICLE * EDGE_STRIDE);
    nodeData = new Float32Array(count * 3);
    offsets = new Float64Array(count);

    edgeVao = gl.createVertexArray();
    edgeBuf = gl.createBuffer();
    if (!edgeVao || !edgeBuf) throw new Error("swarm: edge buffer creation failed");
    gl.bindVertexArray(edgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, edgeData.byteLength, gl.DYNAMIC_DRAW);
    const stride = EDGE_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(1, 1);

    nodeVao = gl.createVertexArray();
    nodeBuf = gl.createBuffer();
    if (!nodeVao || !nodeBuf) throw new Error("swarm: node buffer creation failed");
    gl.bindVertexArray(nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, nodeData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(0, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function startCollapse(collapseAmount: number): void {
    collapseStart = simTime;
    const k = clamp01(Math.max(collapseAmount, 0));
    collapseSeconds = COLLAPSE_SECONDS_SLOW + (COLLAPSE_SECONDS_FAST - COLLAPSE_SECONDS_SLOW) * k;
  }

  return {
    id: ID,
    name: "Entropic Collapse",
    settings: SETTINGS,

    init(ctx: SceneContext) {
      const { gl } = ctx;
      edgeProg = createProgram(gl, EDGE_FRAG, EDGE_VERT);
      nodeProg = createProgram(gl, NODE_FRAG, NODE_VERT);
      freeBuffers(gl);
      swarm = null;
      swarmCount = 0;
      lastTime = null;
      accumulator = 0;
      simTime = 0;
      centreSet = false;
    },

    render(ctx, frame, viewport, _palette, anim, drives = PASSTHROUGH_DRIVES) {
      if (!edgeProg || !nodeProg) return;
      const { gl } = ctx;
      const resW = gl.drawingBufferWidth;
      const resH = gl.drawingBufferHeight;
      // The whole room's pixel size and where this device's slice starts in it.
      const roomW = resW / Math.max(viewport.w, 1e-4);
      const roomH = resH / Math.max(viewport.h, 1e-4);
      const spawnHalfW = Math.max(120, (WORLD_HALF_HEIGHT * (roomW / roomH)) / FRAME_SCALE - 80);

      // Particle count: the setting overrides the quality preset's own count
      // only once it has been moved off its default.
      const particlesSpec = settingFor("particles");
      const particlesValue = Math.round(resolveSceneSetting(ID, particlesSpec));
      const wanted = particlesValue === particlesSpec.default ? TIER_PARTICLES[ctx.quality.preset] : particlesValue;
      if (!swarm || swarmCount !== wanted) {
        swarm = createSwarm(wanted, SEED, spawnHalfW);
        swarmCount = wanted;
        buildBuffers(gl, wanted);
        simTime = 0;
        startCollapse(resolveSceneSetting(ID, settingFor("collapse")));
        centreSet = false;
        accumulator = 0;
      }
      const s = swarm;

      const dt = lastTime === null ? STEP_DT : Math.max(0, Math.min(0.25, anim.timeSec - lastTime));
      lastTime = anim.timeSec;

      const sync = resolveSceneSetting(ID, settingFor("sync"));
      const drifters = resolveSceneSetting(ID, settingFor("drifters"));
      const breath = resolveSceneSetting(ID, settingFor("breath"));
      const scatter = resolveSceneSetting(ID, settingFor("scatter"));
      const heat = resolveSceneSetting(ID, settingFor("heat"));
      const damping = resolveSceneSetting(ID, settingFor("damping"));
      const collapse = resolveSceneSetting(ID, settingFor("collapse"));
      const lines = resolveSceneSetting(ID, settingFor("lines"));
      const reach = resolveSceneSetting(ID, settingFor("reach"));
      const colours = resolveSceneSetting(ID, settingFor("colours"));
      const size = resolveSceneSetting(ID, settingFor("size"));

      // The Scene breath: the Beat wave slowed to one swing every two beats --
      // 1 on every other beat, 0 on the ones between, fading with the
      // metronome. A swing a beat (0.47 s at 128 bpm) is too fast for the
      // swarm's inertia to follow: measured, the core didn't move. The
      // reference breathes every 0.70-1.0 s, about two beats. Unplugged, it
      // rests at 0.5 -- the attraction's own mean -- so the core stops.
      const beats = Math.floor(anim.metronomeBeats) + anim.metronomePhase;
      const halfWave = anim.metronomeLevel * (0.5 + 0.5 * Math.cos(Math.PI * beats));
      lastWave = clamp01(drives.value("breath", halfWave, 0.5));

      // Edges (a hit, a drop) are consumed once a render, not once a step.
      if (scatter > 0.02 && drives.fired("scatter", anim.onset)) {
        scatterPhases(s, Math.min(1, scatter * drives.value("scatter", anim.beatPulse)));
      }
      if (collapse > 0.02 && drives.fired("collapse", anim.dropOnset)) {
        rescatter(s, rng, spawnHalfW);
        startCollapse(collapse);
      }

      const heatLevel = clamp01(drives.value("heat", frame.energy, 0.5));
      params.phaseCoupling = DEFAULT_SWARM_PARAMS.phaseCoupling * sync;
      params.omegaSpread = DEFAULT_SWARM_PARAMS.omegaSpread * drifters;
      params.breath = DEFAULT_SWARM_PARAMS.breath * breath;
      params.noise = (DEFAULT_SWARM_PARAMS.noise * heat * (0.4 + 1.2 * heatLevel)) / 0.5;
      params.drag = damping;

      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
        stepSwarm(s, params, STEP_DT, lastWave, collapseTrap(simTime - collapseStart, collapseSeconds));
        simTime += STEP_DT;
        accumulator -= STEP_DT;
        steps++;
      }
      if (accumulator >= STEP_DT) accumulator = 0; // a stall: drop the remainder

      // Framing: the swarm's centroid (smoothed) at the centre of the room.
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < s.count; i++) {
        cx += s.x[i];
        cy += s.y[i];
      }
      cx /= s.count;
      cy /= s.count;
      if (!centreSet) {
        centreX = cx;
        centreY = cy;
        centreSet = true;
      } else {
        const k = 1 - Math.exp(-dt / CENTROID_TAU);
        centreX += (cx - centreX) * k;
        centreY += (cy - centreY) * k;
      }

      const nEdges = collectEdges(s, EDGE_REACH_WORLD * reach, edgeData, offsets);
      for (let i = 0; i < s.count; i++) {
        nodeData[i * 3] = s.x[i];
        nodeData[i * 3 + 1] = s.y[i];
        nodeData[i * 3 + 2] = offsets[i];
      }

      const pxScale = roomH / REF_PX_HEIGHT;
      const halfW = Math.max(0.5, (STROKE_PX * pxScale) / 2);
      const radius = Math.max(1, NODE_RADIUS_PX * pxScale);
      const worldScale = (FRAME_SCALE * size * roomH * 0.5) / WORLD_HALF_HEIGHT;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, resW, resH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);

      const common = (prog: GLProgram): void => {
        prog.setV2("uRes", resW, resH);
        prog.setV2("uRoomPx", roomW, roomH);
        prog.setV2("uVpOrigin", viewport.x * roomW, viewport.y * roomH);
        prog.setV2("uCentre", centreX, centreY);
        prog.setF("uScale", worldScale);
        prog.setF("uColours", colours);
      };

      if (nEdges > 0 && edgeVao && edgeBuf) {
        edgeProg.use();
        common(edgeProg);
        edgeProg.setF("uHalfW", halfW);
        edgeProg.setF("uGain", EDGE_ALPHA * lines);
        gl.bindVertexArray(edgeVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeData, 0, nEdges * EDGE_STRIDE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nEdges);
      }

      if (nodeVao && nodeBuf) {
        nodeProg.use();
        common(nodeProg);
        nodeProg.setF("uRadius", radius);
        nodeProg.setF("uNodeGain", NODE_ALPHA);
        gl.bindVertexArray(nodeVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodeData, 0, s.count * 3);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.count);
      }

      // The gallery renders every scene into one shared context each tick --
      // must not leak blend state or a bound VAO onto the next tile.
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
    },

    dispose(ctx: SceneContext) {
      const { gl } = ctx;
      freeBuffers(gl);
      edgeProg?.dispose();
      nodeProg?.dispose();
      edgeProg = null;
      nodeProg = null;
      swarm = null;
      swarmCount = 0;
    },
  };
}

export const swarmScene = createSwarmScene();
