import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spawn } from './assets.js';
import { SHADER_TIME } from './surface.js';

// Reef life: schools of blue tang circling the coral, clownfish hovering over their anemones,
// pufferfish pottering about, seahorses clinging upright among the corals, starfish on the reef rock, and sheephead
// nosing through the kelp. Each species is one instanced mesh, every fish beating its tail in its own rhythm.
// Every model is one unit long with its head along +x (the seahorse stands about twice as tall as it is long).
const SPECIES = {
  blue_tang: { size: 1.0, count: 48, rate: 11, amount: 0.07 },
  clownfish: { size: 0.65, count: 18, rate: 14, amount: 0.08 },
  pufferfish: { size: 1.0, count: 6, rate: 6, amount: 0.04 },
  seahorse: { size: 0.45, count: 9, rate: 3, amount: 0.02 },
  starfish: { size: 0.75, count: 36, rate: 0, amount: 0 },
  sheephead: { size: 1.6, count: 9, rate: 7, amount: 0.06 },
};
// How far either side of the camera reefs are stocked with fish.
const REACH = 70;
// Fish shy away from the sub when it comes this close.
const SHY = 5;

const hash = (n, k) => {
  const s = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// The tail beats from side to side, growing toward the tail, so the body swims on a travelling wave.
function addSwim(material, rate) {
  const key = material.customProgramCacheKey?.() ?? material.name;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHADER_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aFish;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        float fishBack = smoothstep( 0.2, -0.5, transformed.x );
        transformed.z += sin( uTime * ${rate.toFixed(1)} * ( 0.8 + 0.4 * fract( aFish.x * 0.37 ) ) + aFish.x
          - transformed.x * 6.0 ) * aFish.y * ( 0.25 + fishBack * fishBack );`);
  };
  material.customProgramCacheKey = () => `${key}-reef-swim`;
}

function makeSpecies(name, spec, scene) {
  const model = spawn(name);
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    // Smooth shading over the whole body, keeping its texture seams.
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    const fish = new Float32Array(spec.count * 2);
    geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(fish, 2));
    const material = o.material.clone();
    addSwim(material, spec.rate);
    const mesh = new THREE.InstancedMesh(geo, material, spec.count);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    meshes.push(mesh);
  });
  return { name, spec, meshes, free: Array.from({ length: spec.count }, (_, i) => spec.count - 1 - i) };
}

export class ReefFish {
  // `reefs(x0, x1)` lists the reef and kelp patches in a stretch of the world: { id, x, z, height, kind }.
  // `ground(x, z)` is the height of the seabed.
  constructor(scene, reefs, ground) {
    this.reefs = reefs;
    this.ground = ground;
    this.species = Object.fromEntries(Object.entries(SPECIES).map(([n, s]) => [n, makeSpecies(n, s, scene)]));
    this.stocked = new Map();
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YZX');
    this.scale = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    for (const s of Object.values(this.species)) for (const m of s.meshes) m.count = s.spec.count;
    this.warmers = Object.values(this.species).flatMap((s) => s.meshes);
  }

  // Take a fish of a species from its pool, or null if none is left.
  take(name, extra) {
    const s = this.species[name];
    const slot = s.free.pop();
    if (slot === undefined) return null;
    const phase = Math.random() * 100;
    for (const m of s.meshes) {
      const a = m.geometry.attributes.aFish;
      a.setXY(slot, phase, s.spec.amount);
      a.needsUpdate = true;
    }
    return { species: s, slot, size: s.spec.size * (0.85 + Math.random() * 0.3), yaw: 0, pitch: 0, ...extra };
  }

  // Fill a reef with its share of fish, the same mix every time it comes back into view.
  stock(reef) {
    const groups = [];
    const r = (k) => hash(reef.id, k);
    const add = (group) => {
      group.fish = group.fish.filter(Boolean);
      if (group.fish.length) groups.push(group);
    };
    if (reef.kind === 'kelp') {
      for (let i = 0; i < 1 + Math.floor(r(1) * 2); i++) {
        add({ type: 'wander', fish: [this.take('sheephead')], home: reef, range: 9, speed: 0.9, lift: [1, 5] });
      }
    } else {
      const schools = [['blue_tang', 6 + Math.floor(r(2) * 6)]];
      if (r(6) < 0.7) schools.push(['blue_tang', 4 + Math.floor(r(7) * 4)]);
      schools.forEach(([name, n], k) => {
        add({
          type: 'school', home: reef, phase: r(10 + k) * 6.3, speed: 1.1 + r(20 + k) * 0.6,
          rx: 4 + r(30 + k) * 4, rz: 2.5 + r(40 + k) * 3, lift: 1.2 + r(50 + k) * 2.5,
          dir: r(60 + k) < 0.5 ? -1 : 1, scatter: 0,
          fish: Array.from({ length: n }, () => this.take(name, {
            along: (Math.random() - 0.5) * 5, side: (Math.random() - 0.5) * 3, up: (Math.random() - 0.5) * 2,
            wobble: Math.random() * 6.3,
          })),
        });
      });
      for (let i = 0; i < 2 + Math.floor(r(70) * 3); i++) {
        const a = r(80 + i) * 6.3;
        const d = 1 + r(90 + i) * 2.5;
        const x = reef.x + Math.cos(a) * d;
        const z = reef.z + Math.sin(a) * d * 0.8;
        const spot = new THREE.Vector3(x, this.ground(x, z) + 0.45, z);
        add({ type: 'hover', spot, fish: [this.take('clownfish', { wobble: 0 }), this.take('clownfish', { wobble: 2.5 })] });
      }
      if (r(100) < 0.6) add({ type: 'wander', fish: [this.take('pufferfish')], home: reef, range: 6, speed: 0.45, lift: [1, 3] });
      for (let i = 0; i < (r(110) < 0.5 ? 1 + Math.floor(r(111) * 2) : 0); i++) {
        const x = reef.x + (r(120 + i) - 0.5) * 6;
        const z = reef.z + 2 + r(130 + i) * 3;
        add({ type: 'seahorse', spot: new THREE.Vector3(x, this.ground(x, z) + 0.5, z), fish: [this.take('seahorse')],
          wobble: r(140 + i) * 6.3 });
      }
      const stars = [];
      for (let i = 0; i < 3 + Math.floor(r(150) * 5); i++) {
        const a = r(160 + i) * 6.3;
        const d = 2 + r(170 + i) * 6;
        const x = reef.x + Math.cos(a) * d;
        const z = reef.z + Math.sin(a) * d * 0.9;
        stars.push(this.take('starfish', { x, z, yaw: r(180 + i) * 6.3 }));
      }
      add({ type: 'still', fish: stars });
    }
    for (const g of groups) {
      for (const f of g.fish) {
        f.pos = new THREE.Vector3(reef.x, this.ground(reef.x, reef.z) + 2, reef.z);
        f.vel = new THREE.Vector3();
      }
      if (g.type === 'wander') g.target = null;
    }
    return groups;
  }

  release(groups) {
    for (const g of groups) {
      for (const f of g.fish) {
        f.species.free.push(f.slot);
        for (const m of f.species.meshes) m.setMatrixAt(f.slot, this.hidden ??= new THREE.Matrix4().makeScale(0, 0, 0));
      }
    }
  }

  update(dt, t, cx, sub) {
    const near = new Set();
    for (const reef of this.reefs(cx - REACH, cx + REACH)) {
      near.add(reef.id);
      if (!this.stocked.has(reef.id)) this.stocked.set(reef.id, this.stock(reef));
    }
    for (const [id, groups] of this.stocked) {
      if (near.has(id)) continue;
      this.release(groups);
      this.stocked.delete(id);
    }
    const hidden = this.hidden ??= new THREE.Matrix4().makeScale(0, 0, 0);
    for (const s of Object.values(this.species)) {
      for (const slot of s.free) for (const m of s.meshes) m.setMatrixAt(slot, hidden);
    }
    for (const groups of this.stocked.values()) for (const g of groups) this.move(g, dt, t, sub);
    for (const s of Object.values(this.species)) for (const m of s.meshes) m.instanceMatrix.needsUpdate = true;
  }

  move(g, dt, t, sub) {
    const subNear = (p) => sub && Math.hypot(p.x - sub.x, p.y - sub.y, p.z) < SHY;
    if (g.type === 'school') {
      // The school swims laps of the reef; a sub passing close scatters it, and it closes up again after.
      g.phase += (g.dir * g.speed * (1 + g.scatter) / Math.max(g.rx, g.rz)) * dt;
      if (g.fish.some((f) => subNear(f.pos))) g.scatter = Math.min(1.5, g.scatter + dt * 4);
      g.scatter = Math.max(0, g.scatter - dt * 0.4);
      for (const f of g.fish) {
        const a = g.phase - (f.along / g.rx) * g.dir;
        const tx = -Math.sin(a) * g.rx * g.dir;
        const tz = Math.cos(a) * g.rz * g.dir;
        const len = Math.hypot(tx, tz) || 1;
        const spread = 1 + g.scatter * 2.5;
        // Laps run out in front of the reef, toward the open water the sub swims through.
        const x = g.home.x + Math.cos(a) * g.rx + (tz / len) * f.side * spread + Math.sin(t * 0.7 + f.wobble) * 0.3;
        const z = g.home.z + 4 + Math.sin(a) * g.rz - (tx / len) * f.side * spread + Math.cos(t * 0.6 + f.wobble) * 0.3;
        const y = this.ground(x, z) + g.lift + f.up * spread + Math.sin(t * 0.9 + f.wobble) * 0.25;
        this.steer(f, x, y, z, dt, 4);
      }
    } else if (g.type === 'hover') {
      // A pair of clownfish dance in and out over their anemone.
      for (const f of g.fish) {
        const k = t * 0.8 + f.wobble;
        this.steer(f, g.spot.x + Math.sin(k) * 0.45, g.spot.y + 0.2 + Math.sin(k * 1.7) * 0.15,
          g.spot.z + Math.cos(k * 0.7) * 0.35, dt, 3);
      }
    } else if (g.type === 'wander') {
      for (const f of g.fish) {
        const flee = subNear(f.pos);
        if (!g.target || f.pos.distanceTo(g.target) < 0.8 || flee) {
          const x = g.home.x + (Math.random() - 0.5) * g.range * 2;
          const z = g.home.z + (Math.random() - 0.5) * g.range;
          g.target = new THREE.Vector3(x, this.ground(x, z) + g.lift[0] + Math.random() * (g.lift[1] - g.lift[0]), z);
        }
        const to = g.target.clone().sub(f.pos);
        const speed = g.speed * (flee ? 3 : 1);
        if (to.lengthSq() > 1e-4) to.setLength(speed);
        f.vel.lerp(to, 1 - Math.exp(-dt * 0.8));
        f.pos.addScaledVector(f.vel, dt);
        this.face(f, dt);
        this.place(f);
      }
    } else if (g.type === 'seahorse') {
      // Upright among the corals, it bobs gently and turns its snout this way and that.
      const f = g.fish[0];
      f.pos.set(g.spot.x, g.spot.y + Math.sin(t * 0.6 + g.wobble) * 0.08, g.spot.z);
      f.yaw = Math.sin(t * 0.15 + g.wobble) * 1.2;
      f.pitch = 0;
      this.place(f);
    } else {
      for (const f of g.fish) {
        f.pos.set(f.x, this.ground(f.x, f.z) + 0.03, f.z);
        this.place(f, true);
      }
    }
  }

  // Swim toward a point, the body turning to follow its path.
  steer(f, x, y, z, dt, rate) {
    const before = f.pos.clone();
    f.pos.lerp(this.pos.set(x, y, z), 1 - Math.exp(-dt * rate));
    f.vel.copy(f.pos).sub(before).divideScalar(Math.max(dt, 1e-4));
    this.face(f, dt);
    this.place(f);
  }

  face(f, dt) {
    const v = f.vel;
    const flat = Math.hypot(v.x, v.z);
    if (flat < 0.02) return;
    const want = Math.atan2(-v.z, v.x);
    const d = Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw));
    f.yaw += d * (1 - Math.exp(-dt * 4));
    f.pitch += (THREE.MathUtils.clamp(Math.atan2(v.y, flat), -0.5, 0.5) - f.pitch) * (1 - Math.exp(-dt * 3));
  }

  place(f, flat = false) {
    this.euler.set(0, f.yaw, flat ? 0 : f.pitch);
    this.matrix.compose(f.pos, this.quat.setFromEuler(this.euler), this.scale.setScalar(f.size));
    for (const m of f.species.meshes) m.setMatrixAt(f.slot, this.matrix);
  }
}
