import * as THREE from 'three';
import { cloneMaterial } from './assets.js';

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

// The polar bear model is one unit long with its head toward +x, its back up +y and its legs already set in a stride:
// the hind pair hangs from the hips at about x = -0.33 and the front pair from the shoulders at about x = 0.07.
// Each leg swings from its hip a quarter of a walk cycle after the last, left hind, left front, right hind, right
// front, lifting its paw on the way forward; the body rises and falls twice a cycle and the head nods with each step.
const BEAR_UNIFORMS = ['uStep', 'uWalk', 'uHeadYaw', 'uHeadPitch'];
const BEAR_GLSL = /* glsl */ `
  float legW = smoothstep( 0.0, -0.13, transformed.y );
  bool fore = transformed.x > -0.13;
  float rightSide = transformed.z > 0.0 ? 1.0 : 0.0;
  float legPhase = uStep + ( ( fore ? 0.25 : 0.0 ) + rightSide * 0.5 ) * 6.2832;
  vec2 hip = fore ? vec2( 0.07, 0.0 ) : vec2( -0.33, 0.02 );
  transformed.xy = critterTurn( transformed.xy, hip, sin( legPhase ) * 0.42 * uWalk * legW );
  transformed.y += max( 0.0, cos( legPhase ) ) * 0.045 * uWalk * smoothstep( -0.12, -0.24, transformed.y );
  transformed.y += sin( uStep * 2.0 ) * 0.007 * uWalk;
  float headW = smoothstep( 0.14, 0.3, transformed.x );
  float nod = uHeadPitch + sin( uStep * 2.0 + 0.6 ) * 0.06 * uWalk;
  transformed.xy = critterTurn( transformed.xy, vec2( 0.17, 0.14 ), nod * headW );
  transformed.xz = critterTurn( transformed.xz, vec2( 0.17, 0.0 ), -uHeadYaw * headW );
`;

export function rigBear(obj) {
  const controls = uniformSet(BEAR_UNIFORMS);
  pose(obj, controls, 'bear-walk', BEAR_UNIFORMS, BEAR_GLSL);
  return controls;
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
  transformed.xy = critterTurn( transformed.xy, vec2( 0.0, 0.4 ), ( uHeadPitch + uSwim * 1.25 ) * headW );
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
  constructor(p, range) {
    this.p = p;
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
      this.act = 'waddle';
      this.left = 8;
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

// A polar bear's rounds on its patch of ice: it plods from one end to the other, stops to sniff the snow or lift its
// nose to the wind, then turns round and plods back. Drives `b.dx` (within ±range of its start), `b.yaw` and the rig.
export class BearMind {
  constructor(b, range) {
    this.b = b;
    this.home = b.dx;
    this.range = range;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.act = 'walk';
    this.left = rand(3, 8);
    this.step = Math.random() * 6;
    this.walk = 0;
    // Heading stays between π (facing left) and 2π (facing right), so every turn swings round through facing the camera.
    b.yaw = this.dir > 0 ? Math.PI * 2 : Math.PI;
    this.turnTo = b.yaw;
  }

  update(dt, t, rig) {
    const b = this.b;
    this.left -= dt;
    let walk = 0;
    let headYaw = Math.sin(t * 0.4 + this.home) * 0.15;
    let headPitch = -0.05;
    if (this.act === 'walk') {
      walk = 1;
      const pos = b.dx - this.home;
      if (pos * this.dir > this.range || this.left <= 0) {
        this.act = Math.random() < 0.5 ? 'sniff' : 'scent';
        this.left = rand(2, 5);
      }
    } else if (this.act === 'sniff') {
      headPitch = -0.55 + Math.sin(t * 2.3) * 0.08;
      headYaw = Math.sin(t * 0.9) * 0.35;
      if (this.left <= 0) this.turnRound();
    } else if (this.act === 'scent') {
      headPitch = 0.35 + Math.sin(t * 3.1) * 0.05;
      headYaw = Math.sin(t * 0.6) * 0.5;
      if (this.left <= 0) this.turnRound();
    } else if (this.act === 'turn') {
      walk = 0.55;
      b.yaw = approach(b.yaw, this.turnTo, dt, 1.6);
      if (Math.abs(b.yaw - this.turnTo) < 0.05) {
        this.act = 'walk';
        this.left = rand(5, 12);
      }
    }
    this.walk = approach(this.walk, walk, dt, 3);
    const speed = 0.75 * this.walk * (this.act === 'turn' ? 0.25 : 1);
    if (this.act !== 'turn') b.dx += this.dir * speed * dt;
    // About 1.25 units a stride at the size bears stand in the game.
    this.step += dt * (this.act === 'turn' ? 2.6 : (speed / 1.25) * Math.PI * 2);
    rig.uStep.value = this.step;
    rig.uWalk.value = this.walk;
    rig.uHeadYaw.value = approach(rig.uHeadYaw.value, headYaw, dt, 2.5);
    rig.uHeadPitch.value = approach(rig.uHeadPitch.value, headPitch - 0.05 * this.walk, dt, 2.5);
  }

  turnRound() {
    if ((this.b.dx - this.home) * this.dir > 0 || Math.random() < 0.5) this.dir = -this.dir;
    this.act = 'turn';
    this.turnTo = this.dir > 0 ? Math.PI * 2 : Math.PI;
    if (Math.abs(this.turnTo - this.b.yaw) < 0.1) {
      this.act = 'walk';
      this.left = rand(5, 12);
    }
  }
}
