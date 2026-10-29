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

// The polar bear is rigged, with a walk cycle and two idles baked in Blender (blender/rig_polar_bear.py). It stands
// in one spot, so only the idles play, and its chest, neck and head turn on top of them as it looks about.
export function rigBear(obj) {
  const mixer = new THREE.AnimationMixer(obj);
  const actions = {};
  for (const clip of animationsOf('polar_bear')) {
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(0);
    action.play();
    actions[clip.name] = action;
  }
  const bones = Object.fromEntries(['chest', 'neck', 'head'].map((name) => [name, obj.getObjectByName(name)]));
  return { mixer, actions, bones };
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

// A polar bear standing its ground on the ice: it looks slowly about, now and then straight at the camera, noses
// in the snow, lifts its head into the wind, and shifts its weight, breathing all the while. It never takes a step.
// Drives the blend of the rig's idle animations and the turn of its chest, neck and head.
const BEAR_LOOK = { yaw: 0.9, pitch: 0.3 };
const qTurn = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qBody = new THREE.Quaternion();
const axis = new THREE.Vector3();
const bodyUp = new THREE.Vector3();
const bodySide = new THREE.Vector3();
const bodyForward = new THREE.Vector3();

export class BearMind {
  constructor(b) {
    this.b = b;
    // Side on to the camera, give or take, so its shape reads clearly.
    b.yaw = (Math.random() < 0.5 ? Math.PI : Math.PI * 2) + rand(-0.6, 0.6);
    this.act = 'look';
    this.left = rand(2, 5);
    this.weights = { sniff: 0, scent: 0 };
    this.look = { yaw: 0, pitch: 0, next: 0 };
    this.head = { yaw: 0, pitch: 0 };
    this.lean = 0;
    this.leanTo = 0;
    this.phase = rand(0, 10);
    this.started = false;
  }

  choose() {
    const pick = Math.random();
    this.act = pick < 0.25 ? 'sniff' : pick < 0.45 ? 'scent' : 'look';
    this.left = this.act === 'look' ? rand(4, 9) : rand(3, 6);
    if (Math.random() < 0.4) this.leanTo = rand(-1, 1);
  }

  update(dt, t, rig) {
    if (!this.started) {
      // Each bear starts somewhere different in its cycles.
      for (const action of Object.values(rig.actions)) action.time = Math.random() * action.getClip().duration;
      this.started = true;
    }
    this.left -= dt;
    if (this.left <= 0) this.choose();
    const target = { sniff: this.act === 'sniff' ? 1 : 0, scent: this.act === 'scent' ? 1 : 0 };
    for (const name of Object.keys(this.weights)) {
      this.weights[name] = approach(this.weights[name], target[name], dt, 1.5);
      rig.actions[name].setEffectiveWeight(this.weights[name]);
    }
    // The mixer only writes a bone whose clip pose has changed, so the turns added last frame come off first.
    const { chest, neck, head } = rig.bones;
    for (const bone of [chest, neck, head]) {
      if (bone.userData.clipPose) bone.quaternion.copy(bone.userData.clipPose);
    }
    rig.mixer.update(dt);
    for (const bone of [chest, neck, head]) (bone.userData.clipPose ??= new THREE.Quaternion()).copy(bone.quaternion);

    // Each glance holds a moment before the next; a third of them are toward the camera, which faces the bear
    // from +z.
    this.look.next -= dt;
    if (this.look.next <= 0) {
      this.look.next = rand(1.2, 3.5);
      const atCamera = Math.random() < 0.33;
      const toCamera = Math.atan2(Math.sin(Math.PI * 1.5 - this.b.yaw), Math.cos(Math.PI * 1.5 - this.b.yaw));
      this.look.yaw = atCamera ? THREE.MathUtils.clamp(toCamera, -1, 1) * BEAR_LOOK.yaw : rand(-1, 1) * BEAR_LOOK.yaw;
      this.look.pitch = atCamera ? 0.05 : rand(-0.5, 1) * BEAR_LOOK.pitch;
    }
    // While nosing the snow or the wind the idle clip leads, and the glances shrink.
    const free = 1 - Math.max(this.weights.sniff, this.weights.scent) * 0.7;
    this.head.yaw = approach(this.head.yaw, this.look.yaw * free, dt, 2.2);
    this.head.pitch = approach(this.head.pitch, this.look.pitch * free, dt, 2.2);
    this.lean = approach(this.lean, this.leanTo, dt, 0.6);
    const breath = Math.sin(t * 1.3 + this.phase);

    rig.mixer.getRoot().getWorldQuaternion(qBody);
    bodyUp.set(0, 1, 0).applyQuaternion(qBody);
    bodySide.set(0, 0, 1).applyQuaternion(qBody);
    bodyForward.set(1, 0, 0).applyQuaternion(qBody);
    turnBone(chest, bodyUp, this.head.yaw * 0.2);
    turnBone(chest, bodyForward, this.lean * 0.05);
    turnBone(chest, bodySide, breath * 0.012);
    turnBone(neck, bodyUp, this.head.yaw * 0.45);
    turnBone(neck, bodySide, this.head.pitch * 0.5);
    turnBone(head, bodyUp, this.head.yaw * 0.35);
    turnBone(head, bodySide, this.head.pitch * 0.5 - breath * 0.01);
  }
}

// Turns a bone about an axis given in world space, through its own pivot, on top of whatever pose the clips gave it.
function turnBone(bone, worldAxis, angle) {
  if (!angle) return;
  bone.parent.getWorldQuaternion(qParent);
  qTurn.setFromAxisAngle(axis.copy(worldAxis).applyQuaternion(qParent.invert()), angle);
  bone.quaternion.premultiply(qTurn);
  bone.updateMatrixWorld(true);
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
