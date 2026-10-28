import * as THREE from 'three';
import { animationsOf, cloneMaterial } from './assets.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Give each mesh in a model its own copy of its material with a pose driven by `controls`, a map of uniform values.
// Every copy shares one shader program.
function pose(obj, controls, key, uniforms, glsl) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const mat = cloneMaterial(o.material);
    const previous = mat.onBeforeCompile;
    const previousKey = mat.customProgramCacheKey?.() ?? mat.name;
    mat.onBeforeCompile = function (shader, renderer) {
      previous?.call(this, shader, renderer);
      for (const name of uniforms) shader.uniforms[name] = controls[name];
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${uniforms.map((u) => `uniform float ${u};`).join('\n')}
          vec2 critterTurn( vec2 p, vec2 pivot, float a ) {
            vec2 d = p - pivot;
            return pivot + vec2( d.x * cos( a ) - d.y * sin( a ), d.x * sin( a ) + d.y * cos( a ) );
          }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${glsl}`);
    };
    mat.customProgramCacheKey = () => `${previousKey}-${key}`;
    o.material = mat;
  });
}

const uniformSet = (names) => Object.fromEntries(names.map((n) => [n, { value: 0 }]));

// The polar bear is rigged, with a walk cycle and two idles baked in Blender (blender/rig_polar_bear.py). One walk
// cycle carries it this far, in model units.
const BEAR_STRIDE = 0.22;
// Walking speed and the radius it turns round in, in world units. Easing into and out of the turn carries it this
// much further on than the radius.
const BEAR_PACE = 0.45;
const BEAR_TURN = 1;
const BEAR_REACH = BEAR_TURN * 1.25;

export function rigBear(obj) {
  const mixer = new THREE.AnimationMixer(obj);
  const actions = {};
  for (const clip of animationsOf('polar_bear')) {
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(0);
    action.play();
    actions[clip.name] = action;
  }
  actions.walk.setEffectiveWeight(1);
  return { mixer, actions };
}

// The penguin model stands 1.5 units tall facing +x, beak forward, flippers spread out and down along ±z from
// shoulders at about (0.05, 0.33, ±0.27), feet flat at the bottom pointing forward.
// uDrop folds the flippers down against the body (and raises them when negative); uFlap swings them forward and back
// about the body's long axis, the stroke that drives it through the water. uSwim sets the swimming pose for a body
// laid flat along its travel: head stretched forward along the body, feet trailing straight back. uBend sends a
// ripple along the body with each stroke; uWaddle lifts each foot in turn as it walks.
const PENGUIN_UNIFORMS = ['uDrop', 'uFlap', 'uSwim', 'uHeadYaw', 'uHeadPitch', 'uBend', 'uBendAmp', 'uWaddle'];
const PENGUIN_GLSL = /* glsl */ `
  float side = transformed.z >= 0.0 ? 1.0 : -1.0;
  vec2 wing = vec2( abs( transformed.z ) - 0.27, transformed.y - 0.33 );
  float along = dot( wing, vec2( 0.79, -0.61 ) );
  float across = abs( dot( wing, vec2( 0.61, 0.79 ) ) );
  float wingW = smoothstep( 0.0, 0.14, along ) * ( 1.0 - smoothstep( 0.1, 0.2, across ) )
    * smoothstep( 0.2, 0.26, abs( transformed.z ) );
  vec2 zy = critterTurn( vec2( abs( transformed.z ), transformed.y ), vec2( 0.27, 0.33 ), -uDrop * wingW );
  vec2 xz = critterTurn( vec2( transformed.x, zy.x ), vec2( 0.05, 0.27 ), uFlap * wingW );
  transformed = vec3( xz.x, zy.y, xz.y * side );

  float headW = smoothstep( 0.3, 0.48, transformed.y );
  transformed.xy = critterTurn( transformed.xy, vec2( 0.0, 0.4 ), uHeadPitch * headW );
  // Swimming, the head turns about its own middle so the beak points straight on along the body.
  transformed.xy = critterTurn( transformed.xy, vec2( 0.03, 0.58 ), uSwim * 1.5 * smoothstep( 0.42, 0.56, transformed.y ) );
  transformed.xz = critterTurn( transformed.xz, vec2( 0.0, 0.0 ), -uHeadYaw * headW );

  float footW = smoothstep( -0.56, -0.66, transformed.y );
  transformed.xy = critterTurn( transformed.xy, vec2( 0.02, -0.62 ), -1.45 * uSwim * footW );
  transformed.y += max( 0.0, sin( uWaddle + side * 1.5708 ) ) * 0.07 * footW * ( 1.0 - uSwim );

  transformed.x += sin( uBend + transformed.y * 3.5 ) * 0.04 * uBendAmp * ( 0.3 + abs( transformed.y ) );
`;

export function rigPenguin(obj) {
  const controls = uniformSet(PENGUIN_UNIFORMS);
  controls.uDrop.value = 0.75;
  pose(obj, controls, 'penguin-pose', PENGUIN_UNIFORMS, PENGUIN_GLSL);
  return controls;
}

const approach = (from, to, dt, rate) => from + (to - from) * (1 - Math.exp(-dt * rate));

// A standing penguin's day: it stands about looking around, waddles off a few steps and back, flaps its flippers,
// preens, throws its head back to call, and turns to face somewhere new. It keeps within `range` of where it started.
// Drives `p.dx`, `p.dz`, `p.yaw`, the body's sway `p.roll` and lift `p.bob`, and the rig's controls.
export class PenguinMind {
  // `canStand(dx, dz)` says whether a spot on its ice has room for it.
  constructor(p, range, canStand = () => true) {
    this.p = p;
    this.canStand = canStand;
    this.home = { x: p.dx, z: p.dz };
    this.range = range;
    this.act = 'idle';
    this.left = rand(0.5, 4);
    this.look = { yaw: 0, pitch: 0, next: 0 };
    this.step = Math.random() * 6;
    this.flapT = 0;
    p.roll = 0;
    p.bob = 0;
  }

  choose() {
    const pick = Math.random();
    const p = this.p;
    if (pick < 0.32) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * this.range;
      this.target = { x: this.home.x + Math.cos(a) * d, z: this.home.z + Math.sin(a) * d * 0.4 };
      this.act = this.canStand(this.target.x, this.target.z) ? 'waddle' : 'idle';
      this.left = this.act === 'waddle' ? 8 : rand(1, 3);
    } else if (pick < 0.44) {
      this.act = 'flap';
      this.left = rand(0.8, 1.6);
    } else if (pick < 0.56) {
      this.act = 'preen';
      this.left = rand(1.5, 3);
      this.preenSide = Math.random() < 0.5 ? -1 : 1;
    } else if (pick < 0.64) {
      this.act = 'call';
      this.left = rand(1.2, 2);
    } else if (pick < 0.76) {
      this.act = 'turn';
      this.turnTo = p.yaw + rand(-1.6, 1.6);
      this.left = 1.2;
    } else {
      this.act = 'idle';
      this.left = rand(1.5, 5);
    }
  }

  update(dt, t, rig) {
    const p = this.p;
    this.left -= dt;
    if (this.left <= 0) this.choose();
    let drop = 0.75 + Math.sin(t * 0.7 + p.phase) * 0.04;
    let headYaw = 0;
    let headPitch = 0;
    let waddle = 0;
    let roll = Math.sin(t * 1.1 + p.phase) * 0.03;
    this.look.next -= dt;
    if (this.look.next <= 0) {
      this.look.next = rand(0.6, 2.2);
      this.look.yaw = rand(-0.9, 0.9);
      this.look.pitch = rand(-0.15, 0.25);
    }
    if (this.act === 'waddle') {
      const dx = this.target.x - p.dx;
      const dz = this.target.z - p.dz;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.08) {
        this.act = 'idle';
        this.left = rand(1, 3);
      } else {
        const want = Math.atan2(-dz, dx);
        let turn = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
        p.yaw += turn * (1 - Math.exp(-dt * 5));
        turn = Math.abs(turn);
        const speed = 0.38 * Math.max(0, 1 - turn);
        p.dx += (dx / dist) * speed * dt;
        p.dz += (dz / dist) * speed * dt;
        this.step += dt * 9;
        waddle = 1;
        roll = Math.sin(this.step) * 0.17;
        drop = 0.55;
      }
      headYaw = 0;
    } else if (this.act === 'flap') {
      drop = 0.15 + Math.sin(t * 15) * 0.35;
      headPitch = 0.2;
    } else if (this.act === 'preen') {
      headYaw = this.preenSide * 1.0;
      headPitch = -0.4 + Math.sin(t * 7) * 0.1;
    } else if (this.act === 'call') {
      headPitch = 1.15;
      drop = 0.35 + Math.sin(t * 5) * 0.06;
    } else if (this.act === 'turn') {
      p.yaw = approach(p.yaw, this.turnTo, dt, 3);
      this.step += dt * 7;
      waddle = 0.6;
      roll = Math.sin(this.step) * 0.08;
    } else {
      headYaw = this.look.yaw;
      headPitch = this.look.pitch;
    }
    p.roll = approach(p.roll, roll, dt, 10);
    p.bob = waddle ? Math.abs(Math.sin(this.step)) * 0.035 : 0;
    rig.uDrop.value = approach(rig.uDrop.value, drop, dt, this.act === 'flap' ? 30 : 6);
    rig.uHeadYaw.value = approach(rig.uHeadYaw.value, headYaw, dt, 5);
    rig.uHeadPitch.value = approach(rig.uHeadPitch.value, headPitch, dt, 5);
    rig.uWaddle.value = this.step;
    rig.uSwim.value = 0;
    rig.uFlap.value = 0;
    rig.uBendAmp.value = 0;
  }
}

// Swimming: the flippers beat forward and back, faster the harder it swims, the body ripples with each beat, and
// each downstroke throws a little jet of bubbles off the tail. Returns true on the beat's downstroke.
export function swimStroke(rig, state, dt, effort) {
  const before = state.stroke ?? 0;
  state.stroke = before + dt * (5 + effort * 9);
  rig.uSwim.value = 1;
  rig.uDrop.value = -0.15 + Math.sin(state.stroke + 1.2) * 0.12;
  rig.uFlap.value = Math.sin(state.stroke) * (0.45 + effort * 0.4);
  rig.uBend.value = state.stroke - 1.0;
  rig.uBendAmp.value = 0.5 + effort * 0.6;
  rig.uHeadPitch.value = 0;
  rig.uHeadYaw.value = 0;
  rig.uWaddle.value = 0;
  return Math.floor(before / Math.PI) !== Math.floor(state.stroke / Math.PI);
}

// A polar bear's rounds on its patch of ice: it plods from one end to the other, stops to nose about in the snow or
// lift its head into the wind, then turns round and plods back. It keeps to the stretch of its ice where it has room
// to stand. Drives `b.dx`, `b.yaw` and the blend of the rig's walk and idle animations.
export class BearMind {
  constructor(b, size) {
    this.b = b;
    this.size = size;
    this.homeZ = b.dz;
    // Half the bear's length, and a little more, from its middle to any edge.
    this.margin = size * 0.55;
    this.measure();
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.act = 'walk';
    this.left = rand(3, 8);
    this.weights = { walk: 1, sniff: 0, scent: 0 };
    this.speed = 0;
    b.yaw = this.dir > 0 ? Math.PI * 2 : Math.PI;
    this.started = false;
  }

  // How far it can walk along its current line before it must turn back.
  measure() {
    const b = this.b;
    const can = (dx) => b.berg.walkable(dx, b.dz, this.margin);
    let lo = b.dx;
    let hi = b.dx;
    while (can(lo - 0.25) && lo > b.dx - 30) lo -= 0.25;
    while (can(hi + 0.25) && hi < b.dx + 30) hi += 0.25;
    this.bounds = [lo + BEAR_REACH, hi - BEAR_REACH];
    this.roomy = this.bounds[1] - this.bounds[0] > 1;
  }

  update(dt, t, rig) {
    const b = this.b;
    if (!this.started) {
      // Each bear starts somewhere different in its cycles.
      for (const action of Object.values(rig.actions)) action.time = Math.random() * action.getClip().duration;
      this.started = true;
    }
    this.left -= dt;
    let pace = 0;
    if (this.act === 'walk') {
      pace = BEAR_PACE;
      const end = this.dir > 0 ? b.dx >= this.bounds[1] : b.dx <= this.bounds[0];
      if (end || !this.roomy || this.left <= 0) {
        this.act = Math.random() < 0.5 ? 'sniff' : 'scent';
        this.left = rand(3, 6);
      }
    } else if (this.act === 'sniff' || this.act === 'scent') {
      if (this.left <= 0) this.turnRound();
    } else if (this.act === 'turn') {
      // It walks round in an arc, slowing into the turn and swinging round gradually, so its paws keep pace with
      // the ground.
      pace = this.shuffle ? 0.15 : BEAR_PACE * 0.75;
      const left = this.turnTo - b.yaw;
      const full = this.shuffle ? 0.35 : this.speed / BEAR_TURN;
      this.turnRate = approach(this.turnRate, Math.min(full, Math.abs(left) * 1.4 + 0.03), dt, 1.5);
      b.yaw += Math.sign(left) * Math.min(Math.abs(left), this.turnRate * dt);
      if (Math.abs(this.turnTo - b.yaw) < 1e-3) {
        b.yaw = Math.PI + THREE.MathUtils.euclideanModulo(this.turnTo - Math.PI, Math.PI * 2);
        this.act = 'walk';
        this.left = rand(5, 12);
        this.measure();
      }
    }
    const target = { walk: pace > 0 ? 1 : 0, sniff: this.act === 'sniff' ? 1 : 0, scent: this.act === 'scent' ? 1 : 0 };
    for (const name of Object.keys(this.weights)) {
      this.weights[name] = approach(this.weights[name], target[name], dt, 2);
      rig.actions[name].setEffectiveWeight(this.weights[name]);
    }
    this.speed = approach(this.speed, pace, dt, 1);
    // Walking pace matches the stride, so the paws stay planted as the body passes over them.
    const clip = rig.actions.walk.getClip().duration;
    rig.actions.walk.timeScale = Math.max(0.15, this.speed / (BEAR_STRIDE * this.size)) * clip;
    const travel = this.act === 'turn' && this.shuffle ? 0 : this.speed;
    b.dx += Math.cos(b.yaw) * travel * dt;
    b.dz -= Math.sin(b.yaw) * travel * dt;
    rig.mixer.update(dt);
  }

  turnRound() {
    const b = this.b;
    // Round toward the camera or away from it, whichever keeps it on its line and has room for the arc; with room
    // for neither it shuffles round on the spot.
    const fits = (side) => b.berg.walkable(b.dx + Math.cos(b.yaw) * BEAR_REACH, b.dz + side * BEAR_TURN, this.margin * 0.8)
      && b.berg.walkable(b.dx, b.dz + side * BEAR_TURN * 2, this.margin);
    const prefer = b.dz <= this.homeZ ? 1 : -1;
    const side = fits(prefer) ? prefer : fits(-prefer) ? -prefer : 0;
    this.shuffle = side === 0;
    const towardCamera = side >= 0;
    const facingRight = Math.cos(b.yaw) > 0;
    // Yaw π faces left, 2π right; 3π/2 faces the camera.
    this.turnTo = b.yaw + (facingRight === towardCamera ? -Math.PI : Math.PI);
    this.dir = -this.dir;
    this.turnRate = 0;
    this.act = 'turn';
  }
}

const turnToward = (from, to, step) => {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + THREE.MathUtils.clamp(d, -step, step);
};

// Steer a swimming penguin toward a point the way a penguin swims: it banks round in smooth arcs and climbs or dives
// gently, never snapping to a new heading. `s` holds its heading (`yaw`, about the vertical), `pitch`, `roll` and
// speed. `lay` turns the model from standing to lying along +x, belly down. Returns the distance left to go.
const qYaw = new THREE.Quaternion();
const qPitch = new THREE.Quaternion();
const qRoll = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
export const LAY_FLAT = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -Math.PI / 2);
export function steerSwimmer(holder, s, target, dt, cruise, lay = LAY_FLAT) {
  const p = holder.position;
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const flat = Math.hypot(dx, dz);
  const before = s.yaw;
  s.yaw = turnToward(s.yaw, Math.atan2(-dz, dx), dt * 1.5);
  const turning = (s.yaw - before) / Math.max(dt, 1e-4);
  const wantPitch = THREE.MathUtils.clamp(Math.atan2(target.y - p.y, Math.max(flat, 1)), -0.7, 0.7);
  s.pitch = approach(s.pitch, wantPitch, dt, 1.5);
  s.speed = approach(s.speed, cruise, dt, 1.2);
  const across = Math.cos(s.pitch) * s.speed * dt;
  p.x += Math.cos(s.yaw) * across;
  p.z -= Math.sin(s.yaw) * across;
  p.y += Math.sin(s.pitch) * s.speed * dt;
  s.roll = approach(s.roll, THREE.MathUtils.clamp(-turning * 0.5, -0.8, 0.8), dt, 3);
  qYaw.setFromAxisAngle(AXIS_Y, s.yaw);
  qPitch.setFromAxisAngle(AXIS_Z, s.pitch);
  qRoll.setFromAxisAngle(AXIS_X, s.roll + Math.sin(s.stroke ?? 0) * 0.08);
  holder.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll).multiply(lay);
  return Math.hypot(flat, target.y - p.y);
}

// The way back along a swimmer's body, from its heading.
export function swimmerBack(s) {
  return new THREE.Vector3(-Math.cos(s.pitch) * Math.cos(s.yaw), -Math.sin(s.pitch), Math.cos(s.pitch) * Math.sin(s.yaw));
}
