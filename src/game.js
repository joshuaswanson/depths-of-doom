import * as THREE from 'three';
import { cloneMaterial, findNode, ownMaterials, spawn } from './assets.js';
import { makeBeam } from './player.js';
import { WATER, addWaterline } from './surface.js';
import { sfx } from './audio.js';
import { UPGRADES, upgradeCost } from './upgrades.js';
import { CAMERA_Z, SHELF_Y, SURFACE_Y, TAN_HALF_FOV } from './water.js';
import { floorY, murkAt, seabedAt } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);
const WHITE = new THREE.Color(1, 1, 1);
// Enemy models face -X. Like the player, they show full profile while cruising and turn three quarters toward the
// camera when slow; yaw stays within [0, PI] so turns swing the nose past the viewer.
const ENEMY_YAW = {
  left: { swim: 0, idle: 0.75 },
  right: { swim: Math.PI, idle: Math.PI - 0.75 },
};
const SKULL_CHANCE = 1 / 3;
const ENEMY_RELOAD = 0.9;
const DARK_HINT_Y = -40;
const CHAIN_SEGMENT = 1.08;
const CHAIN_SINK = 5;
const CHAIN_DRIFT = 6;
const MAX_BROKEN_CHAINS = 12;
const MAX_WRECKS = 14;
const MAX_COINS = 400;
const FIRST_WAVE_DELAY = 22;
// Co-op: how far a sub may stray from the group's centre, and how long a sunk sub waits to come back.
const LEASH = 12;
const RESPAWN_TIME = 5;
const COMBAT_HOLD = 2;
const DEEP_COMBAT_LEAD = 4;
// Breathing room between waves, long enough for the calm music to come back.
const WAVE_BREAK = 25;
// Where each enemy hull carries its missile drum, in model space (the nose points to -X).
const POD_MOUNT = { scout: { x: -0.45, y: 0.62, scale: 0.8 }, gunner: { x: -0.6, y: 0.83, scale: 0.95 },
  boss: { x: -1.1, y: 1.45, scale: 1.4 } };
const POD_COLORS = { blue: '#2c2e36', blue_dark: '#3a3d47', yellow: '#b8262b', red: '#ff3b30' };
let podTemplate = null;

// A torn mine chain as a rope of nodes pinned at its anchor. The blast flings the upper end aside, then it sinks
// slowly and settles across the seabed.
function brokenChain(anchor, top) {
  const length = Math.hypot(top.x - anchor.x, top.y - anchor.y) - 0.45;
  const count = Math.max(2, Math.ceil(length / CHAIN_SEGMENT));
  const side = Math.random() < 0.5 ? -1 : 1;
  const nodes = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = anchor.x + (top.x - anchor.x) * t;
    const y = anchor.y + (top.y - anchor.y) * t;
    const kick = side * t * rand(0.08, 0.14);
    nodes.push({ x, y, px: x - kick, py: y });
  }
  return { nodes, segment: length / count, z: top.z, side };
}

function sinkChain(c, dt) {
  const damp = Math.exp(-dt * 1.8);
  for (let i = 1; i < c.nodes.length; i++) {
    const n = c.nodes[i];
    const t = i / (c.nodes.length - 1);
    const vx = (n.x - n.px) * damp + c.side * CHAIN_DRIFT * t * dt * dt;
    const vy = (n.y - n.py) * damp - CHAIN_SINK * dt * dt;
    n.px = n.x;
    n.py = n.y;
    n.x += vx;
    n.y += vy;
  }
  for (let k = 0; k < 8; k++) {
    for (let i = 1; i < c.nodes.length; i++) {
      const a = c.nodes[i - 1];
      const b = c.nodes[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d <= c.segment) continue;
      const pull = (d - c.segment) / d;
      if (i === 1) {
        b.x -= dx * pull;
        b.y -= dy * pull;
      } else {
        a.x += dx * pull * 0.5;
        a.y += dy * pull * 0.5;
        b.x -= dx * pull * 0.5;
        b.y -= dy * pull * 0.5;
      }
    }
    for (let i = 1; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      const floor = seabedAt(n.x, c.z) + 0.12;
      if (n.y < floor) {
        n.y = floor;
        n.px = THREE.MathUtils.lerp(n.px, n.x, 0.5);
        n.py = n.y;
      }
    }
  }
}

// Every coin in play is drawn from one instanced mesh per part of the coin model.
function coinInstances() {
  const model = spawn('pickup_coin');
  model.updateMatrixWorld(true);
  const parts = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mesh = new THREE.InstancedMesh(o.geometry, o.material, MAX_COINS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    parts.push({ mesh, local: o.matrixWorld.clone() });
  });
  return parts;
}

// Closest points between two segments, each given as { ax, ay, bx, by }.
function closestOnSegments(s1, s2) {
  const d1x = s1.bx - s1.ax;
  const d1y = s1.by - s1.ay;
  const d2x = s2.bx - s2.ax;
  const d2y = s2.by - s2.ay;
  const rx = s1.ax - s2.ax;
  const ry = s1.ay - s2.ay;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const c = d1x * rx + d1y * ry;
  const b = d1x * d2x + d1y * d2y;
  const denom = a * e - b * b;
  let s = denom > 1e-8 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = THREE.MathUtils.clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
  }
  return [{ x: s1.ax + d1x * s, y: s1.ay + d1y * s }, { x: s2.ax + d2x * t, y: s2.ay + d2y * t }];
}

function onShelf(x) {
  return floorY(x) > SHELF_Y - 3;
}

// Halfway through a turn the drum points at the camera, so missiles wait until it swings round.
function midTurn(e) {
  return Math.abs(Math.cos(e.flip.rotation.y)) < 0.5;
}

// The drum's three red missile tips come merged into one mesh; split them apart so each can slide in on its own when
// its missile is fired.
function splitTips(mesh) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = geo.attributes.position;
  const tris = pos.count / 3;
  const centre = new THREE.Vector2();
  const cents = [];
  for (let t = 0; t < tris; t++) {
    let y = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      y += pos.getY(t * 3 + k) / 3;
      z += pos.getZ(t * 3 + k) / 3;
    }
    cents.push([y, z]);
    centre.x += y / tris;
    centre.y += z / tris;
  }
  const angle = ([y, z]) => Math.atan2(z - centre.y, y - centre.x);
  const a0 = angle(cents[0]);
  const groups = [[], [], []];
  cents.forEach((c, t) => {
    const k = Math.round((((angle(c) - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2 / 3)) % 3;
    groups[k].push(t);
  });
  for (const group of groups) {
    const part = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const out = new Float32Array(group.length * 3 * attr.itemSize);
      group.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
          for (let c = 0; c < attr.itemSize; c++) out[(i * 3 + k) * attr.itemSize + c] = attr.getComponent(t * 3 + k, c);
        }
      });
      part.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    const tip = new THREE.Mesh(part, mesh.material);
    tip.name = mesh.name;
    tip.position.copy(mesh.position);
    tip.quaternion.copy(mesh.quaternion);
    tip.scale.copy(mesh.scale);
    mesh.parent.add(tip);
  }
  mesh.removeFromParent();
}

// The player's missile drum, repainted in enemy colours.
function enemyPod() {
  if (!podTemplate) {
    podTemplate = spawn('part_missile');
    podTemplate.traverse((o) => {
      if (!o.isMesh || !POD_COLORS[o.material.name]) return;
      o.material = cloneMaterial(o.material);
      o.material.color.set(POD_COLORS[o.material.name]);
      if (o.material.name === 'red') o.material.emissive = new THREE.Color('#ff2a1f').multiplyScalar(0.6);
    });
    const tips = [];
    podTemplate.traverse((o) => o.isMesh && o.material.name === 'red' && tips.push(o));
    for (const mesh of tips) splitTips(mesh);
  }
  return podTemplate.clone(true);
}
const HALO_SIZE = { scout: 1.3, gunner: 1.6, boss: 2.6 };
const BAR_WIDTH = { scout: 1.4, gunner: 1.9, boss: 3.4, player: 2.6 };
const BAR_HEIGHT = 0.26;
const BAR_LOW = new THREE.Color('#ff3b30');
const BAR_MID = new THREE.Color('#ffc93a');
const BAR_HIGH = new THREE.Color('#5dff6a');

// A capsule health bar with a dark rim, glossy fill, quarter ticks, and a pale trail showing recent damage.
const barGeometry = new Map();

function healthBar(type) {
  const width = BAR_WIDTH[type];
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    uniforms: {
      uFrac: { value: 1 }, uLag: { value: 1 }, uColor: { value: BAR_HIGH.clone() },
      uSize: { value: new THREE.Vector2(width, BAR_HEIGHT) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform float uFrac, uLag;
      uniform vec3 uColor;
      uniform vec2 uSize;
      varying vec2 vUv;
      float capsule( vec2 p, vec2 extent ) {
        vec2 q = abs( p ) - extent + extent.y;
        return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - extent.y;
      }
      void main() {
        vec2 p = ( vUv - 0.5 ) * uSize;
        float outer = capsule( p, uSize * 0.5 );
        float inner = capsule( p, uSize * 0.5 - 0.045 );
        float aa = fwidth( outer ) * 1.2;
        float alpha = 1.0 - smoothstep( -aa, aa, outer );
        vec3 col = mix( vec3( 0.17, 0.27, 0.4 ), vec3( 0.03, 0.06, 0.1 ), smoothstep( -0.025, -0.01, outer ) );
        float inside = 1.0 - smoothstep( -aa, aa, inner );
        float x = vUv.x;
        vec3 track = vec3( 0.04, 0.07, 0.12 );
        vec3 fill = mix( uColor * 0.7, uColor * 1.15, vUv.y );
        fill += vec3( 0.35 ) * smoothstep( 0.62, 0.8, vUv.y ) * ( 1.0 - smoothstep( 0.8, 0.95, vUv.y ) );
        float tick = step( 0.985, fract( x * 4.0 ) ) * step( x, 0.99 );
        vec3 bar = x < uFrac ? fill * ( 1.0 - tick * 0.35 ) : ( x < uLag ? vec3( 0.95, 0.9, 0.8 ) : track );
        col = mix( col, bar, inside );
        gl_FragColor = vec4( col, alpha * 0.96 );
      }`,
  });
  if (!barGeometry.has(width)) barGeometry.set(width, new THREE.PlaneGeometry(width, BAR_HEIGHT));
  const mesh = new THREE.Mesh(barGeometry.get(width), mat);
  mesh.renderOrder = 20;
  mesh.visible = false;
  return { group: mesh, mat, lag: 1 };
}

const haloTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
})();

// Red light spilling out of an enemy viewport: a soft halo at the window and a faint beam ahead of it.
function viewportGlow(type) {
  const group = new THREE.Group();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture, color: new THREE.Color(2.4, 0.22, 0.12), blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, fog: false,
  }));
  halo.scale.setScalar(HALO_SIZE[type]);
  halo.position.x = 0.15;
  const beam = makeBeam('#ff3a24');
  beam.rotation.y = Math.PI;
  beam.scale.set(0.9, 0.55, 0.55);
  group.add(halo, beam);
  return { group, halo, beam };
}
const DESPAWN_DIST = 60;
const ENEMY_TOP = SURFACE_Y - 1.8;
const enemyFloor = (x) => seabedAt(x) + 1.8;
const DAMAGE = { missile: 12, mine: 22 };
const GRAVITY = 20;
const LOOSE_COIN_MAX = 10;
const ENEMY_MASS = { scout: 0.9, gunner: 1.6, boss: 6 };
// How big each enemy is in hull levels: a ram only dazes subs no bigger than yours.
const ENEMY_SIZE = { scout: 1, gunner: 2, boss: 5 };
const BUMP_BOUNCE = 0.6;
const STUN_TIME = [1.2, 3.0];
// Wrecks settle a little behind the play plane so they rest in view on the seafloor.
const WRECK_Z = -5;
// Half-angle of an enemy viewport's red beam, and how far it reaches.
const BEAM_ANGLE = 0.38;
const BEAM_REACH = 15;

const starTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  g.translate(32, 32);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 11 : 27;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffe14a';
  g.strokeStyle = '#7a4a00';
  g.lineWidth = 4;
  g.fill();
  g.stroke();
  return new THREE.CanvasTexture(canvas);
})();

// A ring of cartoon stars circling over a dazed sub.
function dizzyStars() {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture, depthTest: false, transparent: true,
      fog: false }));
    star.scale.setScalar(0.45);
    star.renderOrder = 21;
    group.add(star);
  }
  group.visible = false;
  return group;
}
const MINE_LANE = 2.6;
const MAX_CHAIN = 70;
// Fraction of the half-screen height taken up by the store panel along the bottom.
const PANEL_SHARE = 0.17;
const LOOSE_COIN_RANGE = 70;

const ENEMY_TYPES = {
  scout: { model: 'enemy_scout', hp: 5, scale: 0.85, rx: 1.25, ry: 0.62, coins: 12, boom: 0.9, speed: 4.2 },
  gunner: { model: 'enemy_gunner', hp: 16, scale: 0.95, rx: 1.75, ry: 0.9, coins: 30, boom: 1.2, speed: 3.2 },
  boss: { model: 'enemy_boss', hp: 170, scale: 0.95, rx: 2.9, ry: 1.45, coins: 220, boom: 2.4, speed: 2.4 },
  mine: { model: 'mine', hp: 3, scale: 1.05, rx: 0.62, ry: 0.62, coins: 3, boom: 1.0, speed: 1.0 },
};

// The angle equal to `target` (mod 2π) that is closest to `from`, so settling never spins the long way round.
function nearestAngle(from, target) {
  return target + Math.round((from - target) / (Math.PI * 2)) * Math.PI * 2;
}

function angleLerp(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

function setBar(bar, frac, dt) {
  bar.lag = Math.max(frac, bar.lag - dt * 0.6);
  const u = bar.mat.uniforms;
  u.uFrac.value = frac;
  u.uLag.value = bar.lag;
  if (frac > 0.5) u.uColor.value.copy(BAR_MID).lerp(BAR_HIGH, (frac - 0.5) * 2);
  else u.uColor.value.copy(BAR_LOW).lerp(BAR_MID, frac * 2);
}

const pipTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(24, 22, 2, 32, 32, 30);
  grad.addColorStop(0, '#f2fdff');
  grad.addColorStop(0.45, '#5fd2ff');
  grad.addColorStop(0.9, '#1c7fc4');
  grad.addColorStop(1, 'rgba(28,127,196,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(canvas);
})();

// The player's health bar rides above the sub, with a bubble pip for each shield charge above it.
function playerStatus(scene) {
  const bar = healthBar('player');
  bar.group.visible = true;
  const pips = Array.from({ length: 5 }, () => {
    const pip = new THREE.Sprite(new THREE.SpriteMaterial({ map: pipTexture, depthTest: false, transparent: true, fog: false }));
    pip.scale.setScalar(0.32);
    pip.renderOrder = 21;
    return pip;
  });
  const group = new THREE.Group();
  group.add(bar.group, ...pips);
  scene.add(group);
  return { group, bar, pips };
}

export class Game {
  constructor({ scene, camera, world, effects, player, hud }) {
    Object.assign(this, { scene, camera, world, effects, player, hud });
    // `player` is this machine's own sub. In co-op, `players` also holds the other subs; `this.player` is briefly
    // pointed at each of them while their weapons fire, and always points back at the local sub afterwards.
    this.localPlayer = player;
    this.players = [player];
    this.role = 'solo';
    this.net = null;
    this.nextId = 1;
    this.enemies = [];
    this.torpedoes = [];
    this.missiles = [];
    this.enemyMissiles = [];
    this.coinsList = [];
    this.bullets = [];
    this.aspect = 1.5;
    this.cam = new THREE.Vector2(0, 0);
    this.makeBulletMesh();
    this.status = playerStatus(this.scene);
    this.makeMineChains();
    this.brokenChains = [];
    this.wrecks = [];
    this.tmp = new THREE.Vector3();
    this.radarSweep = 0;
    this.reset();
  }

  // Underwater rounds: a dark brass slug riding inside a glassy pocket of trapped air, like a supercavitating bullet.
  makeBulletMesh() {
    const slug = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.17), new THREE.Vector2(0.045, -0.16), new THREE.Vector2(0.05, 0.04),
      new THREE.Vector2(0.038, 0.12), new THREE.Vector2(0.012, 0.18), new THREE.Vector2(0, 0.19),
    ], 10);
    slug.rotateZ(-Math.PI / 2);
    const slugMat = new THREE.MeshStandardMaterial({ color: '#b98a3c', metalness: 0.85, roughness: 0.3,
      emissive: '#3a2408', emissiveIntensity: 1 });
    this.bulletMesh = new THREE.InstancedMesh(slug, slugMat, 500);
    this.bulletMesh.frustumCulled = false;
    this.bulletMesh.count = 0;
    this.scene.add(this.bulletMesh);

    const cavity = new THREE.SphereGeometry(1, 16, 10);
    cavity.scale(0.42, 0.085, 0.085);
    cavity.translate(-0.14, 0, 0);
    const cavityMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vAlong;
        void main() {
          vAlong = position.x;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
          vNormal = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
          vView = normalize( -mv.xyz );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vAlong;
        void main() {
          float rim = pow( 1.0 - abs( dot( vNormal, vView ) ), 2.5 );
          float tail = smoothstep( -0.56, -0.1, vAlong );
          gl_FragColor = vec4( vec3( 0.75, 0.95, 1.0 ) * ( rim * 0.55 + 0.05 ) * tail, 1.0 );
        }`,
    });
    this.cavityMesh = new THREE.InstancedMesh(cavity, cavityMat, 500);
    this.cavityMesh.frustumCulled = false;
    this.cavityMesh.count = 0;
    this.cavityMesh.renderOrder = 4;
    this.scene.add(this.cavityMesh);
  }

  // One instanced mesh draws every link of every mine's mooring chain.
  makeMineChains() {
    let rust = null;
    spawn('chain').traverse((o) => {
      if (!rust && o.isMesh) rust = o.material;
    });
    const link = new THREE.TorusGeometry(0.16, 0.055, 6, 14);
    link.scale(1, 1.5, 1);
    this.coinMeshes = coinInstances();
    for (const { mesh } of this.coinMeshes) this.scene.add(mesh);
    this.chainMesh = new THREE.InstancedMesh(link, rust, 6000);
    this.chainMesh.frustumCulled = false;
    this.chainMesh.count = 0;
    this.scene.add(this.chainMesh);
  }

  updateMineChains() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const twist = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const e of this.enemies) {
      if (!e.anchor || e.dead) continue;
      const top = e.obj.position;
      dir.set(top.x - e.anchor.x, top.y - e.anchor.y, 0);
      const len = dir.length() - 0.45;
      dir.normalize();
      q.setFromUnitVectors(up, dir);
      for (let i = 0, links = Math.floor(len / 0.36); i < links && n < 6000; i++) {
        twist.setFromAxisAngle(dir, (i % 2) * Math.PI / 2);
        pos.set(e.anchor.x, e.anchor.y, top.z).addScaledVector(dir, 0.18 + i * 0.36);
        m.compose(pos, twist.clone().multiply(q), one);
        this.chainMesh.setMatrixAt(n++, m);
      }
    }
    // Chains of exploded mines stay anchored and sink in a loose line across the seabed.
    for (const c of this.brokenChains) {
      for (let s = 1; s < c.nodes.length; s++) {
        const a = c.nodes[s - 1];
        const b = c.nodes[s];
        dir.set(b.x - a.x, b.y - a.y, 0);
        const len = dir.length();
        if (len < 0.05) continue;
        dir.normalize();
        q.setFromUnitVectors(up, dir);
        for (let i = 0, links = Math.max(1, Math.round(len / 0.36)); i < links && n < 6000; i++) {
          twist.setFromAxisAngle(dir, ((s * 3 + i) % 2) * Math.PI / 2);
          pos.set(a.x, a.y, c.z).addScaledVector(dir, (i + 0.5) * (len / links));
          m.compose(pos, twist.clone().multiply(q), one);
          this.chainMesh.setMatrixAt(n++, m);
        }
      }
    }
    this.chainMesh.count = n;
    this.chainMesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const list of [this.enemies, this.torpedoes, this.missiles, this.enemyMissiles, this.coinsList]) {
      for (const e of list) this.scene.remove(e.obj);
      list.length = 0;
    }
    this.bullets.length = 0;
    this.brokenChains = [];
    for (const w of this.wrecks ?? []) this.scene.remove(w.e.obj);
    this.wrecks = [];
    this.player.reset();
    this.player.group.position.set(0, 2, 0);
    this.cam.set(0, 2);
    this.coins = 40;
    this.coinsTotal = 0;
    this.kills = 0;
    this.wave = 0;
    this.queue = [];
    this.spawnTimer = 0;
    // A calm stretch before the first wave, so the dive opens with the sunlit music and time to look around.
    this.waveBreak = FIRST_WAVE_DELAY;
    this.combatHold = 0;
    this.combatOn = false;
    this.looseCoinTimer = 1;
    this.boss = null;
    this.over = false;
    this.overTimer = 0;
    this.wasAbove = false;
  }

  get remotePlayers() {
    return this.players.slice(1);
  }

  asPlayer(p, fn) {
    const local = this.player;
    this.player = p;
    try {
      fn();
    } finally {
      this.player = local;
    }
  }

  // The nearest living sub, which an enemy hunts.
  targetFor(e) {
    const p = e.obj.position;
    let best = this.localPlayer;
    let bd = Infinity;
    for (const pl of this.players) {
      if (!pl.alive) continue;
      const c = pl.group.position;
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  get halfH() {
    return CAMERA_Z * TAN_HALF_FOV;
  }

  get halfW() {
    return this.halfH * this.aspect;
  }

  get bounds() {
    const b = { bottom: (x) => seabedAt(x) + 0.7 };
    // In co-op the subs stay within a screen or so of each other, so everyone fights the same waves.
    const alive = this.players.filter((pl) => pl.alive);
    if (alive.length > 1) {
      const cx = alive.reduce((sum, pl) => sum + pl.group.position.x, 0) / alive.length;
      b.left = cx - LEASH;
      b.right = cx + LEASH;
    }
    return b;
  }

  onScreen(x, y, margin = 0) {
    return Math.abs(x - this.cam.x) < this.halfW + margin && Math.abs(y - this.cam.y) < this.halfH + margin;
  }

  buy(id) {
    const def = UPGRADES.find((u) => u.id === id);
    const lvl = this.player.levels[id];
    if (lvl >= def.max || this.over) {
      sfx.denied();
      this.hud.flashSlot(id, false);
      return;
    }
    if (!this.player.hasRoomFor(id)) {
      sfx.denied();
      this.hud.flashSlot(id, false);
      this.hud.showToast('No room on the hull! Upgrade your Hull');
      return;
    }
    const cost = upgradeCost(def, lvl);
    if (this.coins < cost) {
      sfx.denied();
      this.hud.flashSlot(id, false);
      return;
    }
    this.coins -= cost;
    const added = this.player.upgrade(id);
    this.net?.retintLocal();
    sfx.upgrade();
    this.hud.flashSlot(id, true);
    this.hud.showToast(`${def.name} Lv. ${lvl + 1}!`);
    added.forEach((part, i) => {
      setTimeout(() => {
        part.pivot.getWorldPosition(this.tmp);
        this.effects.sparkle(this.tmp, '#fff2a8', 12, 5);
        for (let k = 0; k < 6; k++) this.effects.bubble(this.tmp, { spread: 0.4 });
        sfx.clank();
      }, 120 + i * 90);
    });
  }

  startWave() {
    this.wave++;
    const w = this.wave;
    const q = [];
    const gap = () => rand(0.9, 1.9) * Math.max(0.45, 1 - w * 0.04);
    if (w % 5 === 0) {
      q.push({ type: 'boss', delay: 2.5 });
      for (let i = 0; i < 3 + w / 5; i++) q.push({ type: 'scout', delay: rand(4, 7) });
      this.hud.showBanner(`Wave ${w}`, 'Something big is coming...');
      this.net?.event({ t: 'banner', a: `Wave ${w}`, b: 'Something big is coming...' });
    } else {
      let budget = 4 + w * 2.6;
      while (budget > 0) {
        const r = Math.random();
        const angle = rand(0, Math.PI * 2);
        if (w >= 2 && r < 0.28) {
          q.push({ type: 'gunner', delay: gap() + 0.6, angle });
          budget -= 3;
        } else if (r < 0.48) {
          for (let i = 0; i < 3; i++) q.push({ type: 'mine', delay: i === 0 ? gap() : 0.35, angle: angle + i * 0.12 });
          budget -= 2;
        } else {
          const n = w >= 3 && Math.random() < 0.4 ? 2 : 1;
          for (let i = 0; i < n; i++) q.push({ type: 'scout', delay: i === 0 ? gap() : 0.5, angle: angle + i * 0.1 });
          budget -= n;
        }
      }
      this.hud.showBanner(`Wave ${w}`, w === 1 ? 'Sink those grumpy subs!' : '');
      this.net?.event({ t: 'banner', a: `Wave ${w}`, b: w === 1 ? 'Sink those grumpy subs!' : '' });
    }
    this.queue = q;
    this.spawnTimer = 1.5;
    sfx.wave();
  }

  spawnEnemy(spec) {
    const type = ENEMY_TYPES[spec.type];
    const placed = spec.prewarm || spec.replica;
    const obj = new THREE.Group();
    const flip = new THREE.Group();
    const tilt = new THREE.Group();
    const model = spawn(type.model);
    model.scale.setScalar(type.scale);
    tilt.add(model);
    flip.add(tilt);
    obj.add(flip);
    const skulled = Math.random() < SKULL_CHANCE;
    model.traverse((o) => {
      if (o.name.startsWith('skull_mark_optional')) o.visible = skulled;
      if (o.name.startsWith('side_detail')) o.visible = !skulled;
    });
    const mats = ownMaterials(model).map((m) => {
      addWaterline(m);
      return { m, e: m.emissive.clone(), c: m.color.clone() };
    });
    const hpMult = 1 + 0.17 * (this.wave - 1);
    if (spec.pos) {
      obj.position.set(spec.pos.x, spec.pos.y, 0);
    } else {
      const { x, y } = this.offscreenSpot(spec.angle ?? rand(0, Math.PI * 2), type.rx * type.scale + 2);
      obj.position.set(x, y, 0);
    }
    if (spec.type === 'mine') obj.position.z = rand(-0.5, 0.5);
    let anchor = null;
    if (spec.type === 'mine') {
      // Every mine is moored to the shelf. Wave mines hang just out of view, mostly ahead of the sub; mines the
      // boss drops are chained to the floor beneath them. Past a cliff edge there is nothing to moor to, so none
      // appear.
      const pc = this.player.center;
      let x = spec.pos?.x;
      let y = spec.pos?.y;
      if (!spec.pos) {
        // Mines gather in the murky water toward the cliffs, and only a few drift over the reefs mid-shelf.
        let best = -1;
        for (let i = 0; i < 6; i++) {
          const side = Math.random() < 0.7 ? this.player.facing : -this.player.facing;
          const cx = this.cam.x + side * (this.halfW + rand(3, 14));
          const score = onShelf(cx) ? murkAt(cx) + rand(0, 0.15) : -1;
          if (score > best) {
            best = score;
            x = cx;
          }
        }
        if (!spec.prewarm && (best < 0 || (best < 0.25 && Math.random() < 0.65))) return null;
        y = pc.y + rand(-4, 4);
      }
      if (!placed && !onShelf(x)) return null;
      const floor = seabedAt(x);
      y = THREE.MathUtils.clamp(y, floor + 3, Math.min(ENEMY_TOP, floor + MAX_CHAIN));
      if (!placed && Math.abs(y - (spec.pos?.y ?? pc.y)) > 12) return null;
      anchor = { x, y: floor };
      // Moored mines hang a little behind or in front of the sub's lane so their chains never cut through it.
      obj.position.set(x, y, (Math.random() < 0.7 ? -1 : 1) * MINE_LANE);
    }
    this.scene.add(obj);
    const bossTier = Math.floor(this.wave / 5);
    const toPlayer = new THREE.Vector2().subVectors(this.player.center, obj.position).normalize();
    const e = {
      type: spec.type, def: type, obj, flip, tilt, model, mats, flash: 0, t: rand(0, 5), pitch: 0, anchor, lean: 0,
      hp: type.hp * hpMult * (spec.type === 'boss' ? 0.7 + bossTier * 0.45 : 1),
      fire: rand(1.0, 2.2), attack: 0, steer: 0, orbit: Math.random() < 0.5 ? -1 : 1,
      vel: toPlayer.multiplyScalar(type.speed), facing: 1, propeller: null, spin: rand(-1, 1),
    };
    e.maxHp = e.hp;
    e.facing = e.vel.x >= 0 ? 1 : -1;
    if (spec.type !== 'mine') flip.rotation.y = (e.facing > 0 ? ENEMY_YAW.right : ENEMY_YAW.left).swim;
    model.traverse((o) => {
      if (!e.propeller && o.name.startsWith('propeller')) e.propeller = o;
      if (!e.muzzle && o.name.startsWith('muzzle')) e.muzzle = o;
    });
    if (e.muzzle && spec.type !== 'mine') {
      e.glow = viewportGlow(spec.type);
      e.muzzle.add(e.glow.group);
      const pod = POD_MOUNT[spec.type];
      const launcher = enemyPod();
      launcher.position.set(pod.x, pod.y, 0);
      launcher.rotation.y = Math.PI;
      launcher.scale.setScalar(pod.scale);
      model.add(launcher);
      e.muzzle = findNode(launcher, 'muzzle');
      e.launcher = launcher;
      for (const m of ownMaterials(launcher)) e.mats.push({ m, e: m.emissive.clone(), c: m.color.clone() });
      e.podTips = [];
      launcher.traverse((o) => o.isMesh && o.material.name === 'red' && e.podTips.push(o));
      e.reload = 0;
    }
    if (spec.type !== 'mine') {
      e.stars = dizzyStars();
      e.stars.position.y = type.ry * type.scale * 1.6 + 0.35;
      obj.add(e.stars);
    }
    if (BAR_WIDTH[spec.type]) {
      e.bar = healthBar(spec.type);
      e.bar.group.position.y = type.ry * type.scale * 1.6 + 0.9;
      obj.add(e.bar.group);
    }
    if (spec.type === 'boss') this.boss = e;
    e.id = spec.id ?? this.nextId++;
    this.enemies.push(e);
    return e;
  }

  // A spawn point just outside the visible window in the given direction, kept in the water and never on screen.
  offscreenSpot(angle, margin) {
    const hw = this.halfW + margin;
    const hh = this.halfH + margin;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const t = Math.min(Math.abs(dx) > 1e-3 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-3 ? hh / Math.abs(dy) : Infinity);
    let x = this.cam.x + dx * t;
    let y = THREE.MathUtils.clamp(this.cam.y + dy * t, enemyFloor(x), ENEMY_TOP);
    if (Math.abs(y - this.cam.y) < hh && Math.abs(x - this.cam.x) < hw) {
      x = this.cam.x + (dx >= 0 ? 1 : -1) * hw;
      y = THREE.MathUtils.clamp(y, enemyFloor(x), ENEMY_TOP);
    }
    return { x, y };
  }

  enemyHit(e, x, y, r = 0) {
    const s = e.def;
    const a = -e.pitch * e.facing;
    const dx0 = x - e.obj.position.x;
    const dy0 = y - e.obj.position.y;
    const dx = (dx0 * Math.cos(a) - dy0 * Math.sin(a)) / (s.rx + r);
    const dy = (dx0 * Math.sin(a) + dy0 * Math.cos(a)) / (s.ry + r);
    return dx * dx + dy * dy < 1;
  }

  // Only the sub that fired does damage; its owner's machine is the one that counts the hit. A guest reports its hits
  // to the host, which keeps the enemies' health.
  damageEnemy(e, amount, owner = this.player) {
    if (e.dead) return;
    e.flash = Math.min(1, Math.max(e.flash, 0.35 + amount * 0.08));
    if (owner !== this.localPlayer) return;
    const dealt = amount * owner.damageMult;
    if (this.role === 'guest') {
      this.net.send({ t: 'dmg', id: e.id, a: dealt });
      return;
    }
    e.hp -= dealt;
    if (e.hp <= 0) this.killEnemy(e, owner);
  }

  // Damage a guest reported from its own shots.
  applyRemoteDamage(id, amount, from) {
    const e = this.enemies.find((o) => o.id === id && !o.dead);
    if (!e) return;
    e.hp -= amount;
    e.flash = Math.min(1, Math.max(e.flash, 0.5));
    if (e.hp <= 0) this.killEnemy(e, from);
  }

  killEnemy(e, killer = this.localPlayer) {
    e.dead = true;
    const p = e.obj.position.clone();
    this.effects.explosion(p, e.def.boom);
    sfx.boom(e.type === 'boss' || e.type === 'gunner');
    if (e.type !== 'mine' && killer === this.localPlayer) this.kills++;
    if (this.role === 'host') this.net.event({ t: 'kill', id: e.id, by: killer?.netId });
    if (e.type === 'boss') {
      this.boss = null;
      for (let i = 1; i <= 5; i++) {
        setTimeout(() => {
          this.effects.explosion({ x: p.x + rand(-3, 3), y: p.y + rand(-1.5, 1.5), z: 0.5 }, 1.3);
          sfx.boom(true);
        }, i * 160);
      }
      this.hud.showBanner('Boss sunk!', 'Grab the loot!');
    }
    if (e.type === 'mine' && e.anchor) {
      this.brokenChains.push(brokenChain(e.anchor, p));
      if (this.brokenChains.length > MAX_BROKEN_CHAINS) this.brokenChains.shift();
    }
    if (e.type === 'mine') {
      if (this.role !== 'guest') {
        for (const other of this.enemies) {
          if (other !== e && !other.dead && other.obj.position.distanceTo(p) < 3) this.damageEnemy(other, 12);
        }
      }
      if (this.player.alive && this.player.hitTest(p.x, p.y, 1.4)) this.hurtPlayer(DAMAGE.mine, p);
    }
    if (this.role !== 'guest') this.dropCoins(p, e.def.coins + (e.type === 'boss' ? this.wave * 6 : 0));
    if (e.type === 'mine') this.scene.remove(e.obj);
    else this.sinkWreck(e);
  }

  // A destroyed sub keeps its hull: it goes dark, tumbles to the seabed while leaking bubbles and smoke, loses its
  // colour, and lies there until it drops out of view.
  sinkWreck(e) {
    for (const part of [e.stars, e.bar?.group, e.glow?.group]) if (part) part.visible = false;
    e.obj.traverse((o) => {
      if (o.name.startsWith('muzzle')) o.visible = false;
    });
    const halfLength = e.def.rx * e.def.scale * 1.3;
    const halfWidth = e.def.ry * e.def.scale * 1.2;
    this.wrecks.push({
      e, t: 0, vy: 1.5, vx: e.vel.x * 0.3, settled: false, bounced: false, leak: 0, halfLength, halfWidth,
      targetZ: this.world.clearSpot(e.obj.position.x + e.vel.x * 0.6, halfLength, halfWidth, WRECK_Z,
        this.wrecks.map((o) => ({ x: o.e.obj.position.x, z: o.targetZ, r: o.halfLength }))),
      spinZ: (Math.random() - 0.5) * 1.2, spinX: (Math.random() - 0.5) * 1.6, rv: 0, lv: 0,
    });
  }

  // The plane a hull of this footprint rests on: tilted to the ground's slope and raised until no point of the
  // ground beneath it pokes through, so wrecks sit on top of mounds instead of sinking into them.
  groundUnder(x, z, halfLength, halfWidth) {
    const left = seabedAt(x - halfLength, z);
    const right = seabedAt(x + halfLength, z);
    const slope = Math.atan2(right - left, halfLength * 2);
    const rise = Math.tan(slope);
    let y = -Infinity;
    for (let i = -4; i <= 4; i++) {
      const dx = (i / 4) * halfLength;
      for (const dz of [-halfWidth, 0, halfWidth]) y = Math.max(y, seabedAt(x + dx, z + dz) - rise * dx);
    }
    return { y, slope };
  }

  updateWrecks(dt) {
    const grey = new THREE.Color();
    // A long fight in one spot would pile up hulls without end; past the cap the oldest settle into the sand.
    let excess = this.wrecks.length - MAX_WRECKS;
    for (const w of this.wrecks) {
      if (excess <= 0) break;
      if (!w.settled || w.burying) continue;
      w.burying = 0;
      excess--;
    }
    for (const w of this.wrecks) {
      if (w.burying !== undefined) {
        w.burying += dt;
        w.e.obj.position.y -= dt * 0.5;
        if (w.burying > 2.5 + w.e.def.ry * w.e.def.scale * 2) w.gone = true;
        continue;
      }
      const { e } = w;
      const p = e.obj.position;
      w.t += dt;
      const ground = this.groundUnder(p.x, p.z, w.halfLength, w.halfWidth);
      const rest = ground.y + e.def.ry * e.def.scale * 0.55;
      if (!w.settled) {
        w.vy = Math.max(-3.2, w.vy - dt * 4);
        w.vx *= Math.exp(-dt * 1.2);
        p.x += w.vx * dt;
        p.y += w.vy * dt;
        p.z += (w.targetZ - p.z) * (1 - Math.exp(-dt * 0.8));
        if (p.y <= rest) {
          p.y = rest;
          if (!w.bounced && w.vy < -1.5) {
            w.bounced = true;
            w.vy = -w.vy * 0.25;
            w.spinZ *= 0.4;
            w.spinX *= 0.4;
            this.effects.sandPoof({ x: p.x, y: seabedAt(p.x, p.z) + 0.5, z: p.z + 1 }, 0.6, p.y < -30, e.def.rx);
            continue;
          }
          w.settled = true;
          // Lie with the seabed's slope, rolled onto one side, a little sunk into the sand.
          w.restZ = nearestAngle(e.obj.rotation.z, ground.slope);
          const side = Math.sign(Math.sin(e.tilt.rotation.x)) || (Math.random() < 0.5 ? -1 : 1);
          w.restX = nearestAngle(e.tilt.rotation.x, side * (0.45 + Math.random() * 0.35));
          w.restY = rest - e.def.ry * e.def.scale * 0.2;
          w.rv = w.spinZ * 0.5;
          w.lv = w.spinX * 0.5;
          this.effects.sandPoof({ x: p.x, y: seabedAt(p.x) + 0.5, z: 1.2 }, 0.9, p.y < -30, e.def.rx);
          sfx.thud(0.8);
        }
        w.leak -= dt;
        if (w.leak <= 0) {
          w.leak = 0.06;
          this.effects.bubble({ x: p.x, y: p.y + 0.3, z: p.z }, { spread: e.def.rx * 0.5 });
          if (w.t < 2.5) this.effects.damageSmoke({ x: p.x, y: p.y + 0.2, z: p.z + 0.5 }, 0.9);
        }
      }
      if (!w.settled) {
        e.obj.rotation.z += w.spinZ * dt;
        e.tilt.rotation.x += w.spinX * dt;
      } else {
        // Rock towards the resting pose with a damped spring, so the hull rolls and settles after it lands.
        w.rv += ((w.restZ - e.obj.rotation.z) * 14 - w.rv * 3.2) * dt;
        w.lv += ((w.restX - e.tilt.rotation.x) * 10 - w.lv * 2.6) * dt;
        e.obj.rotation.z += w.rv * dt;
        e.tilt.rotation.x += w.lv * dt;
        p.y += (w.restY - p.y) * (1 - Math.exp(-dt * 1.5));
      }
      if (e.propeller) e.propeller.rotation.x += dt * Math.max(0, 6 - w.t * 3);
      const fade = Math.min(1, w.t / 3);
      for (const { m, c } of e.mats) {
        const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        grey.setRGB(l * 0.55 + 0.04, l * 0.5 + 0.035, l * 0.45 + 0.03);
        m.color.copy(c).lerp(grey, fade);
        m.emissive.setRGB(0, 0, 0);
      }
      const away = Math.abs(p.x - this.cam.x) > this.halfW + e.def.rx * 2 + 2 || Math.abs(p.y - this.cam.y) > this.halfH + 14;
      if (w.settled && away) w.gone = true;
    }
    for (const w of this.wrecks) if (w.gone) this.scene.remove(w.e.obj);
    this.wrecks = this.wrecks.filter((w) => !w.gone);
  }

  // Loose treasure sprinkled through the sea, so there is always a little to spend between and during waves.
  scatterCoins(dt) {
    this.looseCoinTimer -= dt;
    if (this.looseCoinTimer > 0) return;
    this.looseCoinTimer = rand(2.5, 5);
    const pc = this.player.center;
    const nearby = this.coinsList.filter((c) => c.loose).length;
    if (nearby >= LOOSE_COIN_MAX) return;
    const angle = rand(0, Math.PI * 2);
    const dist = Math.hypot(this.halfW, this.halfH) + rand(2, 14);
    const x = pc.x + Math.cos(angle) * dist;
    const y = THREE.MathUtils.clamp(pc.y + Math.sin(angle) * dist * 0.5, seabedAt(x) + 1.5, SURFACE_Y - 1.2);
    const big = Math.random() < 0.15;
    const count = big ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const obj = new THREE.Object3D();
      obj.scale.setScalar(big ? 0.8 : 0.55);
      obj.position.set(x + i * 0.9, y + Math.sin(i * 1.7) * 0.5, 0.3);
      this.addCoin({ obj, value: big ? 5 : 1, vx: 0, vy: 0, t: rand(0, 6), spin: rand(1.5, 2.5), loose: true,
        homeY: obj.position.y });
    }
  }

  dropCoins(pos, value) {
    const n = Math.min(value, 18);
    const base = Math.floor(value / n);
    let extra = value - base * n;
    for (let i = 0; i < n; i++) {
      const obj = new THREE.Object3D();
      const v = base + (extra-- > 0 ? 1 : 0);
      obj.scale.setScalar(v > 3 ? 0.75 : 0.55);
      obj.position.set(pos.x, Math.min(pos.y, SURFACE_Y - 0.5), 0.3);
      const a = rand(0, Math.PI * 2);
      const s = rand(1.5, 4.5);
      this.addCoin({ obj, value: v, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, t: 0, spin: rand(2, 4) });
    }
  }

  addCoin(c) {
    c.id ??= this.nextId++;
    this.coinsList.push(c);
    if (this.role === 'host') {
      const p = c.obj.position;
      this.net.event({ t: 'coin', id: c.id, x: p.x, y: p.y, vx: c.vx, vy: c.vy, v: c.value, loose: !!c.loose, s: c.obj.scale.x,
        t0: c.t });
    }
  }

  // A coin the host dropped, recreated on a guest.
  addRemoteCoin(m) {
    const obj = new THREE.Object3D();
    obj.scale.setScalar(m.s);
    obj.position.set(m.x, m.y, 0.3);
    this.coinsList.push({ id: m.id, obj, value: m.v, vx: m.vx, vy: m.vy, t: m.t0, spin: rand(1.5, 4), loose: m.loose,
      homeY: m.y });
  }

  removeCoin(id) {
    for (const c of this.coinsList) if (c.id === id) c.dead = true;
  }

  hurtPlayer(amount, from) {
    if (this.player.invuln > 0 || !this.player.alive) return;
    const res = this.player.takeHit(amount * (1 + this.wave * 0.04), from);
    this.hud.flashHealth();
    const c = this.player.center;
    if (res === 'shield' || res === 'shield-broken') {
      // Sparks and a flare where the hit lands on the bubble's skin, between the sub and whatever struck it.
      const at = from ?? c;
      const dx = at.x - c.x;
      const dy = at.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(d, Math.max(this.player.extents.hx, this.player.extents.hy) * 1.15);
      const hit = { x: c.x + (dx / d) * reach, y: c.y + (dy / d) * reach, z: 1 };
      this.effects.shieldImpact(hit, { x: dx / d, y: dy / d });
      if (res === 'shield-broken') {
        sfx.shieldBreak();
        this.effects.shieldShatter({ x: c.x, y: c.y, z: 0.8 }, this.player.extents.hx);
      } else {
        sfx.shield();
      }
      return;
    }
    sfx.hurt();
    this.effects.shake = Math.min(1.5, this.effects.shake + 0.8);
    const at = from ?? c;
    this.effects.sparkle({ x: at.x, y: at.y, z: 1 }, '#ffcf7a', 22, 9);
    this.effects.debris({ x: at.x, y: at.y, z: 0.8 });
    if (res === 'dead') {
      this.effects.explosion({ x: c.x, y: c.y, z: 0.5 }, 2.2);
      for (let i = 1; i <= 4; i++) {
        setTimeout(() => this.effects.explosion({ x: c.x + rand(-2, 2), y: c.y + rand(-1, 1), z: 0.5 }, 1.2), i * 180);
      }
      sfx.boom(true);
      if (this.role === 'solo') {
        this.over = true;
        this.overTimer = 2.4;
      } else {
        this.respawnTimer = RESPAWN_TIME;
        this.hud.showToast(`Sunk! Back in ${RESPAWN_TIME} seconds`);
      }
    }
  }

  // Back in the fight next to the others, at full health and briefly untouchable.
  respawn() {
    const pl = this.localPlayer;
    const others = this.remotePlayers.filter((r) => r.alive);
    const x = others.length ? others[0].group.position.x : pl.group.position.x;
    pl.group.position.set(x, Math.max(seabedAt(x) + 4, Math.min(pl.group.position.y + 6, SURFACE_Y - 3)), 0);
    pl.vel.set(0, 0);
    pl.hp = pl.maxHp;
    pl.alive = true;
    pl.invuln = 2.5;
  }

  nearestEnemy(x, y, filter = () => true, maxDist = 26) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead || !filter(e)) continue;
      const d = (e.obj.position.x - x) ** 2 + (e.obj.position.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  enemiesOnScreen() {
    return this.enemies.some((e) => !e.dead && this.onScreen(e.obj.position.x, e.obj.position.y, 1));
  }

  fireWeapons(dt) {
    const pl = this.player;
    if (!pl.alive) return;
    const active = this.enemiesOnScreen() && !pl.turning;
    const fwd = pl.forward;
    const side = new THREE.Vector2(-fwd.y, fwd.x);
    const cannonInterval = 0.15 - 0.009 * pl.levels.cannon;
    for (const part of pl.partsOf('cannon')) {
      // The gatling barrels spin up while there's something to shoot and wind down after.
      part.spin = THREE.MathUtils.lerp(part.spin ?? 0, active ? 28 : 0, 1 - Math.exp(-dt * (active ? 4 : 1.5)));
      if (part.barrels) part.barrels.rotation.x += part.spin * dt;
      part.timer -= dt;
      if (part.timer > 0) continue;
      part.timer += cannonInterval * rand(0.9, 1.1);
      if (!active || part.spin < 14) {
        part.timer = Math.max(part.timer, 0.05);
        continue;
      }
      part.muzzle.getWorldPosition(this.tmp);
      const spread = rand(-0.6, 0.6);
      this.bullets.push({
        x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, life: 1.1, trail: 0, owner: pl,
        vx: fwd.x * 26 + side.x * spread + pl.vel.x * 0.5, vy: fwd.y * 26 + side.y * spread + pl.vel.y * 0.5,
      });
      this.effects.muzzle(this.tmp, fwd);
    }
    for (const part of pl.partsOf('torpedo')) {
      part.timer -= dt;
      if (part.timer > 0 || !active) continue;
      part.timer = 2.3 - 0.12 * pl.levels.torpedo + rand(0, 0.4);
      part.muzzle.getWorldPosition(this.tmp);
      const obj = spawn('proj_torpedo');
      obj.scale.setScalar(0.8);
      obj.position.copy(this.tmp);
      this.scene.add(obj);
      this.torpedoes.push({ obj, vel: fwd.clone().multiplyScalar(3), life: 6, trail: 0, owner: pl });
      sfx.torpedo();
    }
    for (const part of pl.partsOf('missile')) {
      part.timer -= dt;
      if (part.timer > 0 || !active) continue;
      part.timer = 3.0 - 0.18 * pl.levels.missile + rand(0, 0.5);
      part.muzzle.getWorldPosition(this.tmp);
      const obj = spawn('proj_player_missile');
      obj.scale.setScalar(0.85);
      obj.position.copy(this.tmp);
      this.scene.add(obj);
      const up = this.tmp.y > pl.center.y ? 1 : -1;
      this.missiles.push({ obj, vx: fwd.x * 2, vy: 6 * up, life: 5, trail: 0, age: 0, owner: pl });
      this.effects.muzzle(this.tmp);
      sfx.missile();
    }
  }

  updateGrapple(dt) {
    const pl = this.player;
    const part = pl.partsOf('grapple')[0];
    if (!part || !pl.alive) return;
    const g = pl.grapple;
    const reach = 3 + 0.8 * pl.levels.grapple;
    part.pivot.getWorldPosition(this.tmp);
    const bx = this.tmp.x;
    const by = this.tmp.y;
    if (g.state === 'idle') {
      g.cooldown -= dt;
      if (g.cooldown <= 0) {
        const enemy = this.nearestEnemy(bx, by, (e) => e.type !== 'boss', reach + 0.8);
        const coin = this.coinsList.find((c) => Math.hypot(c.obj.position.x - bx, c.obj.position.y - by) < reach);
        const target = enemy ?? coin;
        if (target) {
          g.target = target;
          g.state = 'out';
          g.t = 0;
          sfx.clank();
        }
      }
    }
    let ext = 1;
    let aim = 0;
    if (g.state !== 'idle' && g.target) {
      const tp = g.target.obj.position;
      const local = part.pivot.parent.worldToLocal(tp.clone());
      const dx = local.x - part.pivot.position.x;
      const dy = local.y - part.pivot.position.y;
      aim = Math.atan2(dx, -dy);
      const full = THREE.MathUtils.clamp(Math.hypot(dx, dy) / 0.62, 1, 14);
      g.t += dt;
      if (g.state === 'out') {
        ext = 1 + (full - 1) * Math.min(1, g.t / 0.16);
        if (g.t >= 0.16) {
          g.state = 'hold';
          g.t = 0;
          if (g.target.def && !g.target.dead) {
            this.damageEnemy(g.target, 3 + 2 * pl.levels.grapple);
            this.effects.sparkle({ x: tp.x, y: tp.y, z: 0.6 }, '#ffffff', 10, 5);
          } else if (g.target.value) {
            g.target.grabbed = true;
          }
        }
      } else if (g.state === 'hold') {
        ext = full;
        if (g.t >= 0.12) {
          g.state = 'back';
          g.t = 0;
        }
      } else if (g.state === 'back') {
        ext = 1 + (full - 1) * Math.max(0, 1 - g.t / 0.25);
        if (g.t >= 0.25) {
          g.state = 'idle';
          g.target = null;
          g.cooldown = 1.8 - 0.3 * pl.levels.grapple;
        }
      }
    }
    part.pivot.rotation.z = THREE.MathUtils.lerp(part.pivot.rotation.z, g.state === 'idle' ? 0 : aim, 1 - Math.exp(-dt * 20));
    if (part.arm) part.arm.scale.y = ext;
    if (part.claw) part.claw.scale.y = 1 / ext;
  }

  steerEnemy(e, desired, dt, turn = 2) {
    e.vel.lerp(desired, 1 - Math.exp(-dt * turn));
  }

  // Enemies caught in a searchlight beam are dazzled for a moment.
  dazzleEnemies(dt) {
    const cones = this.player.partsOf('spotlight').map((part) => {
      const origin = part.lens.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(1, 0, 0).transformDirection(part.lens.matrixWorld);
      return { origin, dir: new THREE.Vector2(dir.x, dir.y).normalize() };
    });
    const range = this.player.spotRange;
    for (const e of this.enemies) {
      e.dazzled = Math.max(0, (e.dazzled ?? 0) - dt);
      for (const c of cones) {
        const to = new THREE.Vector2(e.obj.position.x - c.origin.x, e.obj.position.y - c.origin.y);
        const d = to.length();
        if (d < range && to.dot(c.dir) > d * Math.cos(0.45)) e.dazzled = 0.3;
      }
    }
  }

  updateEnemies(dt) {
    const pl = this.player;
    const desired = new THREE.Vector2();
    const guest = this.role === 'guest';
    if (!guest) this.dazzleEnemies(dt);
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      if (e.reload > 0) {
        // The fired missile's tip sinks into the drum, then the next one slides out.
        e.reload = Math.max(0, e.reload - dt / ENEMY_RELOAD);
        e.podTips.forEach((tip, i) => {
          tip.userData.restX ??= tip.position.x;
          const retract = i === e.tipFired ? THREE.MathUtils.smoothstep(e.reload, 0, 0.6) : 0;
          tip.position.x = tip.userData.restX - 0.26 * retract;
        });
      }
      const p = e.obj.position;
      let dist = 0;
      let dazed = (e.stunned ?? 0) > 0;
      if (guest) {
        this.followReplica(e, dt);
      } else {
        ({ dist, dazed } = this.enemyBrain(e, dt, desired));
      }

      if (!guest) {
        p.x += e.vel.x * dt;
        p.y += e.vel.y * dt;
      }
      if (p.y > ENEMY_TOP) {
        p.y = ENEMY_TOP;
        e.vel.y = Math.min(e.vel.y, 0);
      }
      const floor = enemyFloor(p.x);
      if (p.y < floor) {
        p.y = floor;
        e.vel.y = Math.max(e.vel.y, 0);
      }

      if (e.type !== 'mine') {
        if (Math.abs(e.vel.x) > 0.4) e.facing = Math.sign(e.vel.x);
        const speedNow = e.vel.length();
        const pose = e.facing > 0 ? ENEMY_YAW.right : ENEMY_YAW.left;
        const wantYaw = speedNow > 1.4 ? pose.swim : pose.idle;
        const step = (wantYaw - e.flip.rotation.y) * (1 - Math.exp(-dt * 2.2));
        e.flip.rotation.y += THREE.MathUtils.clamp(step, -dt * 2, dt * 2);
        const wantPitch = speedNow > 0.6 ? THREE.MathUtils.clamp(Math.atan2(e.vel.y, Math.abs(e.vel.x) + 0.05), -0.9, 0.9) : 0;
        e.pitch = THREE.MathUtils.lerp(e.pitch, wantPitch, 1 - Math.exp(-dt * 3));
        e.tilt.rotation.z = -e.pitch;
        e.tilt.rotation.x = Math.sin(e.t * 1.6) * 0.04;
      }
      if (e.propeller) e.propeller.rotation.x += dt * (dazed ? 3 : 14);
      e.spinVel = (e.spinVel ?? 0) * Math.exp(-dt * 2.2);
      e.daze = (e.daze ?? 0) + e.spinVel * dt;
      e.daze *= Math.exp(-dt * (dazed ? 0.6 : 3));
      e.flip.rotation.x = e.daze + (dazed ? Math.sin(e.t * 9) * 0.12 : 0);
      if (e.stars) {
        e.stars.visible = dazed;
        if (dazed) {
          e.stars.children.forEach((s, i) => {
            const a = e.t * 5 + (i * Math.PI * 2) / 3;
            s.position.set(Math.cos(a) * 0.55, Math.sin(a * 2) * 0.06, Math.sin(a) * 0.55);
          });
        }
      }
      if (e.bar) {
        const frac = Math.max(0, e.hp / e.maxHp);
        e.bar.group.visible = frac < 0.999;
        setBar(e.bar, frac, dt);
      }
      if (e.glow) {
        const dark = this.world.dark;
        e.glow.halo.material.opacity = 0.45 + 0.25 * dark + Math.sin(e.t * 3) * 0.1;
        e.glow.beam.material.uniforms.uStrength.value = 0.02 + 0.16 * dark;
      }

      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 9);
        for (const { m, e: base } of e.mats) m.emissive.copy(base).lerp(WHITE, e.flash * 0.35);
      }

      e.bumpCooldown = Math.max(0, (e.bumpCooldown ?? 0) - dt);
      if (e.type === 'mine' && !guest) {
        const victim = this.enemies.find((o) => o !== e && !o.dead && o.type !== 'mine' && this.enemyHit(o, p.x, p.y, 0.55));
        if (victim) {
          this.killEnemy(e);
          continue;
        }
      }
      if (pl.alive) {
        if (e.type === 'mine') {
          if (pl.invuln <= 0 && pl.hitTest(p.x, p.y, e.def.ry)) {
            if (guest) this.damageEnemy(e, 999);
            else this.killEnemy(e);
          }
        } else if (this.hullContact(e)) {
          this.bump(e);
        }
      }

      if (guest) continue;
      if (e.type === 'mine' && dist > DESPAWN_DIST) {
        e.dead = true;
        this.scene.remove(e.obj);
      } else if (dist > DESPAWN_DIST) {
        // Subs left far behind come back from just off screen, so a wave only ends when every sub is sunk.
        const spot = this.offscreenSpot(Math.atan2(p.y - this.cam.y, p.x - this.cam.x), e.def.rx * e.def.scale + 2);
        p.x = spot.x;
        p.y = spot.y;
        e.vel.set(0, 0);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    if (!guest) this.separateEnemies(dt);
    for (const c of this.brokenChains) sinkChain(c, dt);
    this.brokenChains = this.brokenChains.filter((c) => Math.abs(c.nodes[0].x - this.cam.x) < 80);
    this.updateMineChains();
  }

  // An enemy's AI on the host (or solo): steer toward its target sub and fire when it has a shot.
  enemyBrain(e, dt, desired) {
    const tgt = this.targetFor(e);
    const pc = tgt.center;
    const p = e.obj.position;
    const dazzle = e.dazzled > 0 ? 0.5 : 1;
    const fireMult = (1 + this.wave * 0.05) * dazzle;
    const toP = new THREE.Vector2(pc.x - p.x, pc.y - p.y);
    const dist = toP.length();
    const dir = toP.clone().divideScalar(dist || 1);
    const tangent = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(e.orbit);
    const speed = (e.def.speed + this.wave * 0.06) * (e.dazzled > 0 ? 0.6 : 1);
    // In co-op an enemy also fires when it is on its target's screen, which may not be the host's.
    const visible = this.onScreen(p.x, p.y, -0.5)
      || (Math.abs(p.x - pc.x) < this.halfW - 0.5 && Math.abs(p.y - pc.y) < this.halfH - 0.5);
    e.stunned = Math.max(0, (e.stunned ?? 0) - dt);
    const dazed = e.stunned > 0;

    if (dazed) {
      e.vel.multiplyScalar(Math.exp(-dt * 1.5));
    } else if (e.type === 'scout') {
      e.steer -= dt;
      if (e.steer <= 0) {
        e.steer = rand(2.2, 3.5);
        e.target = dir.clone().multiplyScalar(speed).add(tangent.clone().multiplyScalar(rand(0.5, 1.8)));
      }
      desired.copy(e.target ?? dir);
      const weave = tangent.clone().multiplyScalar(Math.sin(e.t * 2.2) * 1.4);
      this.steerEnemy(e, desired.add(weave), dt, 1.5);
      e.fire -= dt * fireMult;
      if (e.fire <= 0 && visible && dist < 15 && !midTurn(e)) {
        e.fire = rand(2.0, 3.2);
        this.enemyAimed(e, pc, rand(-0.1, 0.1));
      }
    } else if (e.type === 'gunner') {
      const range = dist - 9;
      desired.copy(dir).multiplyScalar(THREE.MathUtils.clamp(range, -1, 1) * speed).add(tangent.clone().multiplyScalar(speed * 0.5));
      this.steerEnemy(e, desired, dt, 1.2);
      e.fire -= dt * fireMult;
      if (e.fire <= 0 && visible && !midTurn(e)) {
        e.fire = rand(2.8, 3.6);
        const n = 2 + Math.floor(this.wave / 4);
        for (let i = 0; i < n; i++) {
          setTimeout(() => {
            if (!e.dead) this.enemyAimed(e, tgt.center, rand(-0.12, 0.12));
          }, i * 220);
        }
      }
    } else if (e.type === 'boss') {
      const range = dist - 11;
      desired.copy(dir).multiplyScalar(THREE.MathUtils.clamp(range, -1, 1) * speed).add(tangent.clone().multiplyScalar(speed * 0.35));
      this.steerEnemy(e, desired, dt, 0.8);
      e.fire -= dt * (1 + this.wave * 0.02) * dazzle;
      if (e.fire <= 0 && visible && !midTurn(e)) {
        e.attack = (e.attack + 1) % 3;
        const base = Math.atan2(dir.y, dir.x);
        if (e.attack === 0) {
          e.fire = 2.6;
          for (let i = -2; i <= 2; i++) this.enemyAimed(e, null, 0, base + i * 0.22, 7.5);
        } else if (e.attack === 1) {
          e.fire = 3.0;
          for (let i = 0; i < 3; i++) {
            this.spawnEnemy({ type: 'mine', pos: { x: p.x + dir.x * 2.5, y: p.y + (i - 1) * 1.6 } });
          }
        } else {
          e.fire = 3.2;
          for (let i = 0; i < 6; i++) {
            setTimeout(() => {
              if (!e.dead) this.enemyAimed(e, tgt.center, rand(-0.08, 0.08));
            }, i * 150);
          }
        }
      }
    } else if (e.type === 'mine' && e.anchor) {
      const length = e.length ?? (e.length = p.y - e.anchor.y);
      const near = dist < 16 ? THREE.MathUtils.clamp(Math.atan2(pc.x - e.anchor.x, length) * 0.6, -0.4, 0.4) : 0;
      e.lean = THREE.MathUtils.lerp(e.lean, near + Math.sin(e.t * 0.7) * 0.06, 1 - Math.exp(-dt * 0.8));
      p.x = e.anchor.x + Math.sin(e.lean) * length;
      p.y = e.anchor.y + Math.cos(e.lean) * length + Math.sin(e.t * 1.3) * 0.15;
      e.vel.set(0, 0);
      e.model.rotation.z += e.spin * dt * 0.3;
    } else if (e.type === 'mine') {
      desired.copy(dir).multiplyScalar(speed);
      desired.y += Math.sin(e.t * 1.5) * 0.4;
      this.steerEnemy(e, desired, dt, 0.6);
      e.model.rotation.z += e.spin * dt * 0.6;
      e.model.rotation.y += e.spin * dt * 0.3;
    }
    return { dist, dazed };
  }

  // A guest's copy of an enemy eases toward where the host last said it was, carried along by its velocity.
  followReplica(e, dt) {
    const n = e.net;
    if (!n) return;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    const k = 1 - Math.exp(-dt * 10);
    const p = e.obj.position;
    p.x += (n.x - p.x) * k;
    p.y += (n.y - p.y) * k;
    p.z += (n.z - p.z) * k;
    e.vel.set(n.vx, n.vy);
    e.hp = n.hp;
    e.stunned = n.st;
  }

  // The hull as a capsule: a segment along its length, tilted with its pitch, and a radius wide enough to take in
  // the tower.
  hullCapsule(e) {
    const p = e.obj.position;
    const a = e.pitch * e.facing;
    const reach = e.def.rx * 0.75;
    const dx = Math.cos(a) * e.facing * reach;
    const dy = Math.sin(a) * reach;
    return { ax: p.x - dx, ay: p.y - dy, bx: p.x + dx, by: p.y + dy, r: e.def.ry * 1.05 };
  }

  // Enemy subs steer clear of each other when close and are pushed apart if their hulls still overlap.
  separateEnemies(dt) {
    const subs = this.enemies.filter((e) => e.type !== 'mine' && !e.dead);
    for (let i = 0; i < subs.length; i++) {
      for (let j = i + 1; j < subs.length; j++) {
        const a = subs[i];
        const b = subs[j];
        const pa = a.obj.position;
        const pb = b.obj.position;
        const near = a.def.rx + b.def.rx + 1.5;
        if (Math.abs(pa.x - pb.x) > near || Math.abs(pa.y - pb.y) > near) continue;
        const ca = this.hullCapsule(a);
        const cb = this.hullCapsule(b);
        const [qa, qb] = closestOnSegments(ca, cb);
        let nx = qb.x - qa.x;
        let ny = qb.y - qa.y;
        const d = Math.hypot(nx, ny) || 1e-4;
        nx /= d;
        ny /= d;
        const touch = ca.r + cb.r;
        const ma = ENEMY_MASS[a.type];
        const mb = ENEMY_MASS[b.type];
        const wa = mb / (ma + mb);
        const wb = ma / (ma + mb);
        if (d < touch + 1.2) {
          const push = (1 - (d - touch) / 1.2) * 6 * dt;
          a.vel.x -= nx * push * wa;
          a.vel.y -= ny * push * wa;
          b.vel.x += nx * push * wb;
          b.vel.y += ny * push * wb;
        }
        if (d >= touch) continue;
        const overlap = touch - d;
        pa.x -= nx * overlap * wa;
        pa.y -= ny * overlap * wa;
        pb.x += nx * overlap * wb;
        pb.y += ny * overlap * wb;
        const closing = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny;
        if (closing < 0) {
          const j = -1.2 * closing;
          a.vel.x -= nx * j * wa;
          a.vel.y -= ny * j * wa;
          b.vel.x += nx * j * wb;
          b.vel.y += ny * j * wb;
        }
      }
    }
  }

  // Points along an enemy hull's length, so its whole body counts in collisions, not just its middle.
  hullPoints(e) {
    const p = e.obj.position;
    const a = e.pitch * e.facing;
    const reach = e.def.rx * 0.75;
    const dx = Math.cos(a) * e.facing * reach;
    const dy = Math.sin(a) * reach;
    const up = e.def.ry * 1.05;
    const ux = -Math.sin(a) * up;
    const uy = Math.cos(a) * up;
    return [{ x: p.x, y: p.y }, { x: p.x + dx, y: p.y + dy }, { x: p.x - dx, y: p.y - dy },
      { x: p.x + dx * 0.5, y: p.y + dy * 0.5 }, { x: p.x - dx * 0.5, y: p.y - dy * 0.5 }, { x: p.x + ux, y: p.y + uy }];
  }

  hullContact(e) {
    const r = e.def.ry * 0.82;
    return this.hullPoints(e).find((q) => this.player.bodyTest(q.x, q.y, r)) ?? null;
  }

  // Subs that collide bounce apart with no damage: a momentum exchange along the line between them, plus a clank.
  bump(e) {
    const pl = this.player;
    const pc = pl.center;
    const p = e.obj.position;
    const contact = this.hullContact(e) ?? p;
    const n = new THREE.Vector2(pc.x - contact.x, pc.y - contact.y);
    if (n.lengthSq() < 1e-4) n.set(1, 0);
    n.normalize();
    const mPlayer = pl.mass * 1.3;
    const mEnemy = ENEMY_MASS[e.type];
    const approach = new THREE.Vector2().subVectors(pl.vel, e.vel).dot(n);
    const j = Math.max(2.5, -(1 + BUMP_BOUNCE) * Math.min(approach, 0)) / (1 / mPlayer + 1 / mEnemy);
    pl.vel.addScaledVector(n, j / mPlayer);
    e.vel.addScaledVector(n, -j / mEnemy);
    // Push the hulls apart until they no longer overlap, the lighter sub moving further.
    const share = mEnemy / (mPlayer + mEnemy);
    for (let i = 0; i < 60 && this.hullContact(e); i++) {
      pl.group.position.x += n.x * 0.02 * share;
      pl.group.position.y += n.y * 0.02 * share;
      p.x -= n.x * 0.02 * (1 - share);
      p.y -= n.y * 0.02 * (1 - share);
    }
    const hard = Math.min(1, Math.abs(approach) / 8);
    if (ENEMY_SIZE[e.type] <= pl.levels.hull) {
      e.stunned = Math.max(e.stunned ?? 0, STUN_TIME[0] + (STUN_TIME[1] - STUN_TIME[0]) * hard);
      e.spinVel = (e.spinVel ?? 0) + (Math.random() < 0.5 ? -1 : 1) * (3 + 6 * hard);
    }
    if (e.bumpCooldown > 0) return;
    e.bumpCooldown = 0.25;
    const hit = { x: (pc.x + p.x) / 2, y: (pc.y + p.y) / 2, z: 0.8 };
    const strength = Math.min(1, Math.abs(approach) / 8);
    this.effects.sparkle(hit, '#ffe6a0', 6 + Math.round(10 * strength), 3 + 4 * strength);
    this.effects.shake = Math.min(1, this.effects.shake + 0.15 + 0.35 * strength);
    sfx.bump(strength);
  }

  // Points along a sub's hull: nose, tail, the stretch between, and the tower.
  subHullPoints(sub) {
    const c = sub.center;
    const f = sub.forward;
    const ext = sub.extents;
    const along = ext.hx * 0.72;
    return [{ x: c.x, y: c.y }, { x: c.x + f.x * along, y: c.y + f.y * along }, { x: c.x - f.x * along, y: c.y - f.y * along },
      { x: c.x + f.x * along * 0.5, y: c.y + f.y * along * 0.5 }, { x: c.x - f.x * along * 0.5, y: c.y - f.y * along * 0.5 },
      { x: c.x - f.y * ext.hy, y: c.y + f.x * ext.hy }];
  }

  // Friendly subs clank off each other just like they do off enemies, but nobody is ever stunned. Each machine only
  // moves its own sub; the other player's machine bounces theirs.
  bumpFriends() {
    const pl = this.localPlayer;
    if (!pl.alive) return;
    for (const other of this.remotePlayers) {
      if (!other.alive || !other.group.visible) continue;
      other.bumpCooldown = Math.max(0, (other.bumpCooldown ?? 0) - this.lastDt);
      const touching = () => {
        const r = other.extents.hy * 0.8;
        return this.subHullPoints(other).find((q) => pl.bodyTest(q.x, q.y, r)) ?? null;
      };
      const contact = touching();
      if (!contact) continue;
      const pc = pl.center;
      // Push apart along the line between the two subs, favouring sideways so a head-on ram bounces back instead
      // of one sub sliding over the other.
      const oc = other.center;
      const n = new THREE.Vector2(pc.x - oc.x, (pc.y - oc.y) * 0.4);
      if (n.lengthSq() < 1e-4) n.set(pl.facingSign * -1, 0);
      n.normalize();
      const mine = pl.mass * 1.3;
      const theirs = other.mass * 1.3;
      const approach = new THREE.Vector2().subVectors(pl.vel, other.vel).dot(n);
      const j = Math.max(2.5, -(1 + BUMP_BOUNCE) * Math.min(approach, 0)) / (1 / mine + 1 / theirs);
      pl.vel.addScaledVector(n, j / mine);
      for (let i = 0; i < 60 && touching(); i++) {
        pl.group.position.x += n.x * 0.02;
        pl.group.position.y += n.y * 0.02;
      }
      if (other.bumpCooldown > 0) continue;
      other.bumpCooldown = 0.25;
      const strength = Math.min(1, Math.abs(approach) / 8);
      const hit = { x: (pc.x + contact.x) / 2, y: (pc.y + contact.y) / 2, z: 0.8 };
      this.effects.sparkle(hit, '#ffe6a0', 6 + Math.round(10 * strength), 3 + 4 * strength);
      this.effects.shake = Math.min(1, this.effects.shake + 0.15 + 0.35 * strength);
      sfx.bump(strength);
    }
  }

  // Spawn one of everything that brings its own shader (enemies, bars, glows, projectiles) so it all compiles
  // during loading; returns a cleanup that removes them again.
  prewarm() {
    const before = this.enemies.length;
    for (const type of ['scout', 'gunner', 'boss', 'mine']) {
      const e = this.spawnEnemy({ type, pos: { x: 0, y: 0 }, prewarm: true });
      if (e.bar) e.bar.group.visible = true;
      e.model.traverse((o) => {
        if (o.name.startsWith('skull_mark')) o.visible = true;
      });
    }
    this.spawnEnemyMissile({ x: 0, y: 0 }, 1, 0);
    const temp = this.enemies.slice(before);
    return () => {
      for (const e of temp) this.scene.remove(e.obj);
      this.enemies.splice(before);
      for (const m of this.enemyMissiles) this.scene.remove(m.obj);
      this.enemyMissiles.length = 0;
      this.boss = null;
    };
  }

  muzzleOf(e) {
    return e.muzzle ? e.muzzle.getWorldPosition(new THREE.Vector3()) : e.obj.position.clone();
  }

  enemyAimed(e, target, spread, angle = null, speed = 7.2 + this.wave * 0.12) {
    const pos = this.muzzleOf(e);
    const a = (angle ?? Math.atan2(target.y - pos.y, target.x - pos.x)) + spread;
    if (!e.launcher) {
      this.spawnEnemyMissile(pos, Math.cos(a) * speed, Math.sin(a) * speed);
      return;
    }
    // The missile leaves its tube along the drum's facing, then curves onto its aim.
    const forward = new THREE.Vector3(1, 0, 0).transformDirection(e.launcher.matrixWorld);
    const tube = midTurn(e) ? (e.facing > 0 ? 0 : Math.PI) : Math.atan2(forward.y, forward.x);
    e.tipFired = ((e.tipFired ?? -1) + 1) % Math.max(1, e.podTips.length);
    pos.x -= Math.cos(tube) * 0.3;
    pos.y -= Math.sin(tube) * 0.3;
    this.spawnEnemyMissile(pos, Math.cos(tube) * speed * 0.45, Math.sin(tube) * speed * 0.45, { aim: a, speed });
    e.reload = 1;
  }

  spawnEnemyMissile(pos, vx, vy, steer = null) {
    if (this.role === 'host') this.net.event({ t: 'em', x: pos.x, y: pos.y, z: pos.z, vx, vy, steer });
    const obj = spawn('proj_missile');
    obj.scale.setScalar(steer ? 0.45 : 0.9);
    obj.position.set(pos.x, pos.y, steer ? pos.z : 0.2);
    obj.rotation.z = Math.atan2(vy, vx);
    this.scene.add(obj);
    this.enemyMissiles.push({ obj, vx, vy, life: 6, trail: 0, steer, age: 0 });
    this.effects.muzzle(pos);
    sfx.enemyShot();
  }

  // Clears the tube for a moment, then turns toward the aim and speeds up, growing to full size as it goes.
  steerEnemyMissile(em, dt) {
    const { aim, speed } = em.steer;
    em.obj.scale.setScalar(THREE.MathUtils.lerp(0.45, 0.9, Math.min(1, em.age / 0.18)));
    em.obj.position.z = THREE.MathUtils.lerp(em.obj.position.z, 0.2, 1 - Math.exp(-dt * 10));
    let heading = Math.atan2(em.vy, em.vx);
    let v = Math.hypot(em.vx, em.vy);
    if (em.age > 0.12) {
      const turn = Math.atan2(Math.sin(aim - heading), Math.cos(aim - heading));
      heading += THREE.MathUtils.clamp(turn, -9 * dt, 9 * dt);
      v = Math.min(speed, v + speed * 3 * dt);
      if (Math.abs(turn) < 0.01 && v >= speed) em.steer = null;
    } else {
      v += speed * dt;
    }
    em.vx = Math.cos(heading) * v;
    em.vy = Math.sin(heading) * v;
  }

  // Splash and bubbles whenever a projectile crosses the waterline in either direction.
  crossSurface(wasAbove, p, scale = 0.45) {
    if (wasAbove === p.y > SURFACE_Y) return;
    this.effects.splash({ x: p.x, y: SURFACE_Y, z: p.z }, scale);
    sfx.splash();
  }

  updateProjectiles(dt) {
    const pl = this.player;

    let alive = 0;
    let cavities = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const zAxis = new THREE.Vector3(0, 0, 1);
    const v = new THREE.Vector3();
    for (const b of this.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0) continue;
      b.trail -= dt;
      if (b.trail <= 0) {
        b.trail = 0.01;
        const dir = { x: Math.cos(Math.atan2(b.vy, b.vx)), y: Math.sin(Math.atan2(b.vy, b.vx)) };
        this.effects.bubbleStreak({ x: b.x - dir.x * 0.4, y: b.y - dir.y * 0.4, z: b.z }, dir, 0.8);
      }
      let hit = false;
      for (const e of this.enemies) {
        if (!e.dead && this.enemyHit(e, b.x, b.y, 0.1)) {
          this.damageEnemy(e, 1, b.owner);
          this.effects.sparkle({ x: b.x, y: b.y, z: 0.5 }, '#ffe9a0', 3, 3);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const em of this.enemyMissiles) {
          if (!em.dead && Math.hypot(em.obj.position.x - b.x, em.obj.position.y - b.y) < 0.45) {
            em.dead = true;
            this.effects.explosion(em.obj.position, 0.45);
            sfx.pop();
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
      q.setFromAxisAngle(zAxis, Math.atan2(b.vy, b.vx));
      m.compose(v.set(b.x, b.y, b.z), q, one);
      this.bulletMesh.setMatrixAt(alive, m);
      if (b.y < SURFACE_Y) this.cavityMesh.setMatrixAt(cavities++, m);
      this.bullets[alive++] = b;
    }
    this.bullets.length = alive;
    this.bulletMesh.count = alive;
    this.bulletMesh.instanceMatrix.needsUpdate = true;
    this.cavityMesh.count = cavities;
    this.cavityMesh.instanceMatrix.needsUpdate = true;

    for (const t of this.torpedoes) {
      t.life -= dt;
      const p = t.obj.position;
      const airborne = p.y > SURFACE_Y;
      if (airborne) {
        t.vel.y -= GRAVITY * dt;
        if (Math.random() < 0.5) this.effects.smokeTrail(p, 0.5);
      } else {
        // Torpedoes run straight along their launch line, picking up speed; they hit hard but can miss.
        const speed = Math.min(18, t.vel.length() + dt * 16);
        t.vel.setLength(speed);
        t.trail -= dt;
        if (t.trail <= 0) {
          t.trail = 0.025;
          const dir = t.vel.clone().normalize();
          this.effects.bubble({ x: p.x - dir.x * 0.5, y: p.y - dir.y * 0.5, z: p.z },
            { spread: 0.08, size: [0.1, 0.22], life: [0.6, 1.2] });
        }
      }
      p.x += t.vel.x * dt;
      p.y += t.vel.y * dt;
      this.crossSurface(airborne, p, 0.5);
      t.obj.rotation.z = Math.atan2(t.vel.y, t.vel.x);
      const hitE = this.enemies.find((e) => !e.dead && this.enemyHit(e, p.x, p.y, 0.2));
      const floor = seabedAt(p.x);
      if (hitE || t.life <= 0 || p.y < floor) {
        if (hitE) {
          this.damageEnemy(hitE, 7, t.owner);
          for (const e of this.enemies) {
            if (e !== hitE && !e.dead && e.obj.position.distanceTo(p) < 2.4) this.damageEnemy(e, 3, t.owner);
          }
        }
        if (hitE || p.y < floor) {
          this.effects.explosion(p, 0.7);
          sfx.boom();
        }
        t.dead = true;
        this.scene.remove(t.obj);
      }
    }
    this.torpedoes = this.torpedoes.filter((t) => !t.dead);

    for (const mi of this.missiles) {
      mi.life -= dt;
      mi.age += dt;
      const p = mi.obj.position;
      const above = p.y > SURFACE_Y;
      if (above) {
        mi.vy -= GRAVITY * dt;
      } else if (mi.age > 0.3) {
        const target = this.nearestEnemy(p.x, p.y);
        const speed = Math.min(15, Math.hypot(mi.vx, mi.vy) + dt * 16);
        let a = Math.atan2(mi.vy, mi.vx);
        if (target) a = angleLerp(a, Math.atan2(target.obj.position.y - p.y, target.obj.position.x - p.x), dt * 5);
        mi.vx = Math.cos(a) * speed;
        mi.vy = Math.sin(a) * speed;
      } else {
        mi.vy *= Math.exp(-dt * 4);
        mi.vx += dt * 10 * Math.sign(mi.vx || 1);
      }
      p.x += mi.vx * dt;
      p.y += mi.vy * dt;
      this.crossSurface(above, p);
      mi.obj.rotation.z = Math.atan2(mi.vy, mi.vx);
      mi.trail -= dt;
      if (mi.trail <= 0) {
        mi.trail = 0.02;
        const back = { x: p.x - Math.cos(mi.obj.rotation.z) * 0.45, y: p.y - Math.sin(mi.obj.rotation.z) * 0.45, z: p.z };
        if (back.y > SURFACE_Y) this.effects.smokeTrail(back, 0.8);
        else this.effects.bubbleStreak(back, { x: Math.cos(mi.obj.rotation.z), y: Math.sin(mi.obj.rotation.z) }, 1.6);
        this.effects.flame(back, 0.6);
      }
      const hitE = this.enemies.find((e) => !e.dead && this.enemyHit(e, p.x, p.y, 0.15));
      const grounded = p.y < seabedAt(p.x);
      if (hitE || mi.life <= 0 || grounded) {
        if (grounded && !hitE) {
          this.effects.explosion(p, 0.45);
          sfx.boom();
        }
        if (hitE) {
          this.damageEnemy(hitE, 4, mi.owner);
          this.effects.explosion(p, 0.6);
          sfx.boom();
        }
        mi.dead = true;
        this.scene.remove(mi.obj);
      }
    }
    this.missiles = this.missiles.filter((mi) => !mi.dead);

    for (const em of this.enemyMissiles) {
      if (em.dead) {
        this.scene.remove(em.obj);
        continue;
      }
      em.life -= dt;
      em.age += dt;
      const p = em.obj.position;
      const above = p.y > SURFACE_Y;
      if (em.steer && !above) this.steerEnemyMissile(em, dt);
      if (above) em.vy -= GRAVITY * dt;
      p.x += em.vx * dt;
      p.y += em.vy * dt;
      this.crossSurface(above, p);
      em.obj.rotation.z = Math.atan2(em.vy, em.vx);
      em.trail -= dt;
      if (em.trail <= 0) {
        em.trail = 0.025;
        const a = em.obj.rotation.z;
        const back = { x: p.x - Math.cos(a) * 0.45, y: p.y - Math.sin(a) * 0.45, z: p.z };
        if (back.y > SURFACE_Y) this.effects.smokeTrail(back, 0.9);
        else this.effects.bubbleStreak(back, { x: Math.cos(a), y: Math.sin(a) }, 1.7);
        this.effects.flame(back, 0.7);
      }
      if (pl.alive && pl.hitTest(p.x, p.y, 0.12)) {
        em.dead = true;
        this.effects.explosion(p, 0.55);
        sfx.boom();
        this.hurtPlayer(DAMAGE.missile, p);
      }
      const floor = seabedAt(p.x);
      if (em.life <= 0 || p.y < floor) {
        if (!em.dead && p.y < floor) this.effects.explosion(p, 0.45);
        em.dead = true;
      }
      if (em.dead) this.scene.remove(em.obj);
    }
    this.enemyMissiles = this.enemyMissiles.filter((em) => !em.dead);
  }

  updateCoins(dt) {
    const pl = this.player;
    const pc = pl.center;
    const magnet = pl.magnetRadius + pl.radius;
    for (const c of this.coinsList) {
      c.t += dt;
      const p = c.obj.position;
      const dx = pc.x - p.x;
      const dy = pc.y - p.y;
      const d = Math.hypot(dx, dy);
      if (pl.alive && (d < magnet || c.grabbed)) {
        const pull = c.grabbed ? 40 : 22 * (1 - d / magnet) + 6;
        c.vx += (dx / d) * pull * dt;
        c.vy += (dy / d) * pull * dt;
        c.vx *= Math.exp(-dt * 2);
        c.vy *= Math.exp(-dt * 2);
      } else if (c.loose) {
        c.vx *= Math.exp(-dt * 2.5);
        c.vy = (c.homeY + Math.sin(c.t * 1.4) * 0.25 - p.y) * 2;
      } else {
        c.vx *= Math.exp(-dt * 2.5);
        c.vy = c.vy * Math.exp(-dt * 2.5) + Math.sin(c.t * 2) * dt * 0.6;
      }
      p.x += c.vx * dt;
      p.y = THREE.MathUtils.clamp(p.y + c.vy * dt, seabedAt(p.x) + 0.5, SURFACE_Y - 0.4);
      c.obj.rotation.y += c.spin * dt;
      if (!c.loose && c.t > 11) c.obj.visible = Math.floor(c.t * 10) % 2 === 0;
      if (pl.alive && pl.hitTest(p.x, p.y, 0.3)) {
        c.dead = true;
        if (this.net) this.net.taken(c.id);
        this.coins += c.value;
        this.coinsTotal += c.value;
        this.effects.coinBurst(p);
        this.hud.pulseCoins();
        sfx.coin();
      }
      if (c.loose ? d > LOOSE_COIN_RANGE : c.t > 14) c.dead = true;
    }
    this.coinsList = this.coinsList.filter((c) => !c.dead);
    this.drawCoins();
  }

  drawCoins() {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const c of this.coinsList) {
      if (!c.obj.visible || n >= MAX_COINS) continue;
      c.obj.updateMatrix();
      for (const { mesh, local } of this.coinMeshes) mesh.setMatrixAt(n, m.multiplyMatrices(c.obj.matrix, local));
      n++;
    }
    for (const { mesh } of this.coinMeshes) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  updateWaves(dt) {
    if (this.over) return;
    if (this.queue.length) {
      this.spawnTimer -= dt;
      while (this.queue.length && this.spawnTimer <= 0) {
        this.spawnEnemy(this.queue.shift());
        this.spawnTimer += this.queue[0]?.delay ?? 0;
      }
      return;
    }
    if (this.enemies.some((e) => e.type !== 'mine')) return;
    if (this.waveBreak <= 0 && this.wave > 0) {
      this.waveBreak = WAVE_BREAK;
      const bonus = 5 + this.wave * 5;
      this.coins += bonus;
      this.coinsTotal += bonus;
      this.hud.showToast(`Wave ${this.wave} cleared! +${bonus} coins`);
      if (this.role === 'host') this.net.event({ t: 'cleared', wave: this.wave, bonus });
      this.hud.pulseCoins();
      sfx.coin();
      return;
    }
    this.waveBreak -= dt;
    if (this.waveBreak <= 0) {
      this.startWave();
      this.waveBreak = 0;
    }
  }

  updateCamera(dt) {
    const pl = this.player;
    const pc = pl.center;
    const tx = pc.x + Math.cos(pl.yaw) * 2.5 + pl.vel.x * 0.3;
    // The store panel covers the bottom of the screen, so frame the sub in the open water above it.
    const share = this.panelShare ?? PANEL_SHARE;
    const ty = pc.y + pl.vel.y * 0.2 - this.halfH * share;
    this.cam.x = THREE.MathUtils.lerp(this.cam.x, tx, 1 - Math.exp(-dt * 2.2));
    this.cam.y = THREE.MathUtils.lerp(this.cam.y, ty, 1 - Math.exp(-dt * 2.2));
    let lowest = Infinity;
    for (let i = -2; i <= 2; i++) lowest = Math.min(lowest, seabedAt(this.cam.x + (i * this.halfW) / 2));
    this.camFloor = THREE.MathUtils.lerp(this.camFloor ?? lowest, lowest, 1 - Math.exp(-dt * 1.5));
    const floorLimit = Math.min(this.camFloor + this.halfH - 3, pc.y + 1.5 - this.halfH * share);
    this.cam.y = THREE.MathUtils.clamp(this.cam.y, floorLimit, SURFACE_Y + 1);
  }

  // Diving into a dark trench without a lamp suggests buying one, once per descent.
  spotlightHint() {
    const y = this.player.center.y;
    if (y > SHELF_Y) this.hintedDark = false;
    if (this.hintedDark || y > DARK_HINT_Y || !this.player.alive || this.player.levels.spotlight > 0) return;
    this.hintedDark = true;
    this.hud.showToast('Buy a spotlight for better visibility!');
  }

  // Racing along half out of the water throws spray off the hull.
  planeSpray(dt) {
    const pl = this.player;
    if (!pl.alive) return;
    const pc = pl.center;
    const straddle = Math.abs(pc.y - SURFACE_Y) < pl.extents.hy * 0.9;
    const strength = THREE.MathUtils.smoothstep(Math.abs(pl.vel.x), 4, 9);
    if (!straddle || strength <= 0) return;
    const dir = Math.sign(pl.vel.x);
    const hx = pl.extents.hx;
    this.effects.surfaceSpray(pc.x + dir * hx * 0.85, pc.x - dir * hx * 0.9, dir, strength, dt);
  }

  splashCheck() {
    const pc = this.player.center;
    const above = this.player.group.position.y > SURFACE_Y;
    if (above !== this.wasAbove && this.player.alive) {
      const hit = Math.abs(this.player.vel.y);
      if (!above && hit > 4) {
        // Falling back in from a jump: the harder the landing, the bigger the crash of water.
        const scale = THREE.MathUtils.clamp(0.9 + hit / 10, 1.1, 1.9);
        this.effects.bigSplash({ x: pc.x, y: SURFACE_Y, z: 0.5 }, scale, this.player.extents.hx);
        sfx.bigSplash(scale);
      } else {
        this.effects.splash({ x: pc.x, y: SURFACE_Y, z: 0.5 }, 1.2);
        sfx.splash();
      }
    }
    this.wasAbove = above;
  }

  update(dt, input) {
    const pl = this.player;
    pl.update(dt, input, this.bounds);
    for (const r of this.remotePlayers) this.net.updateRemote(r, dt);
    this.lastDt = dt;
    this.bumpFriends();
    for (const sub of this.players) {
      this.asPlayer(sub, () => {
        this.fireWeapons(dt);
        this.updateGrapple(dt);
      });
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    if (this.role !== 'guest') this.scatterCoins(dt);
    this.updateCoins(dt);
    if (this.role !== 'guest') this.updateWaves(dt);
    if (this.respawnTimer > 0 && !pl.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
    }
    this.updateCamera(dt);
    this.splashCheck();
    this.updateCombatHold(dt);
    this.planeSpray(dt);
    this.spotlightHint();

    for (const sub of this.players) {
      if (!sub.alive) continue;
      const prop = sub.propellerWorld(this.tmp);
      const rate = (0.5 + sub.vel.length() * 0.25 + sub.levels.propulsion * 0.15 + sub.cruise * 1.5) * (sub.drive ?? 0);
      const back = sub.forward.multiplyScalar(-2);
      for (let n = rate; n > 0; n--) {
        if (Math.random() < n) this.effects.bubble(prop, { spread: 0.25, vel: { x: back.x, y: back.y } });
      }
      for (const part of sub.partsOf('propulsion')) {
        if (Math.random() < 0.35 * (sub.drive ?? 0) && part.props[0]) {
          part.props[0].getWorldPosition(this.tmp);
          this.effects.bubble(this.tmp, { spread: 0.12, size: [0.08, 0.2], vel: { x: back.x, y: back.y } });
        }
      }
    }

    this.emitDamageSmoke();
    this.updateWrecks(dt);
    this.castEnemyGlow(dt);
    this.updateWetness(dt);
    this.updateStatus(dt);
    this.kickUpSand(dt);
    const sweepFrom = this.radarSweep;
    this.radarSweep = (this.radarSweep + dt * 2.2) % (Math.PI * 2);
    if (this.player.alive) this.sonarSounds(sweepFrom, this.radarSweep);
    if (this.over) this.overTimer -= dt;
  }

  updateStatus(dt) {
    const pl = this.player;
    const { group, bar, pips } = this.status;
    const ext = pl.extents;
    group.position.set(pl.group.position.x, pl.group.position.y + ext.cy + ext.hy + 0.75, 1.5);
    setBar(bar, Math.max(0, pl.hp / pl.maxHp), dt);
    if (pl.shieldCharges > (this.lastShieldCharges ?? 0)) sfx.shieldUp();
    this.lastShieldCharges = pl.shieldCharges;
    const max = pl.shieldMax;
    pips.forEach((pip, i) => {
      pip.visible = i < max;
      pip.position.set((i - (max - 1) / 2) * 0.38, 0.36, 0);
      pip.material.opacity = i < pl.shieldCharges ? 1 : 0.25;
    });
  }

  // In the dark, enemy viewports bathe the sub in red: one light placed on the side of the strongest nearby glow.
  castEnemyGlow(dt) {
    const pl = this.player;
    const pc = pl.center;
    const dark = this.world.dark;
    let best = null;
    let bestW = 0;
    for (const e of this.enemies) {
      if (e.dead || !e.glow) continue;
      const p = e.obj.position;
      const d = Math.hypot(p.x - pc.x, p.y - pc.y);
      if (d > BEAM_REACH) continue;
      const fx = Math.cos(e.pitch) * e.facing;
      const fy = Math.sin(e.pitch);
      const along = ((pc.x - p.x) * fx + (pc.y - p.y) * fy) / Math.max(d, 1e-3);
      const off = Math.acos(THREE.MathUtils.clamp(along, -1, 1));
      const inBeam = 1 - THREE.MathUtils.smoothstep(off, BEAM_ANGLE * 0.6, BEAM_ANGLE * 1.25);
      const w = (1 - d / BEAM_REACH) * inBeam * (e.type === 'boss' ? 1.6 : 1);
      if (w > bestW) {
        bestW = w;
        best = p;
      }
    }
    const light = pl.redGlow;
    const want = best ? bestW * dark * 70 : 0;
    light.intensity = THREE.MathUtils.lerp(light.intensity, want, 1 - Math.exp(-dt * 5));
    if (best) {
      const toward = new THREE.Vector2(best.x - pc.x, best.y - pc.y).normalize();
      light.position.set(pc.x + toward.x * 2.4, pc.y + toward.y * 2.4, 2.2);
    }
  }

  // Surfacing soaks the sub; it drips and slowly dries while it stays above the water.
  updateWetness(dt) {
    const pl = this.player;
    const top = pl.group.position.y + pl.extents.cy + pl.extents.hy;
    const breaching = top > SURFACE_Y;
    const submerged = pl.group.position.y + pl.extents.cy < SURFACE_Y - pl.extents.hy;
    if (submerged || !breaching) WATER.wet.value = 1;
    else WATER.wet.value = Math.max(0.15, WATER.wet.value - dt / 9);
    if (!breaching || !pl.alive) return;
    const drips = WATER.wet.value * 22 * dt;
    for (let i = 0; i < drips || (Math.random() < drips % 1 && i === 0); i++) {
      const x = pl.group.position.x + (Math.random() * 2 - 1) * pl.extents.hx * 0.8;
      const y = Math.max(SURFACE_Y + 0.05, pl.group.position.y + pl.extents.cy + (Math.random() * 2 - 1) * pl.extents.hy * 0.8);
      this.effects.droplet({ x, y, z: 0.9 });
    }
  }

  // Slamming into the seabed throws up a cloud of sand; skimming along it trails dust.
  kickUpSand(dt) {
    const pl = this.player;
    const impact = pl.impact ?? 0;
    pl.impact = 0;
    const pos = pl.group.position;
    const ground = { x: pos.x, y: seabedAt(pos.x) + 0.5, z: 1.2 };
    const silt = ground.y < -30;
    if (impact > 1.5) {
      const strength = THREE.MathUtils.clamp(impact / 8, 0.35, 1.6);
      this.effects.sandPoof(ground, strength, silt, pl.extents.hx);
      this.effects.shake = Math.min(1.2, this.effects.shake + strength * 0.35);
      sfx.thud(strength);
    } else if (pl.onFloor && Math.abs(pl.vel.x) > 2 && Math.random() < dt * 14) {
      this.effects.sandPoof({ x: pos.x - Math.sign(pl.vel.x) * pl.extents.hx * 0.5, y: ground.y, z: 0.4 }, 0.15, silt, 0.5);
    }
  }

  // The worse the hull, the more it smokes, sparks, and leaks.
  emitDamageSmoke() {
    const pl = this.player;
    if (!pl.alive) return;
    const damage = 1 - pl.hp / pl.maxHp;
    if (damage < 0.3) return;
    const spots = pl.damageSpots();
    for (const s of spots) {
      if (Math.random() > damage * 0.55) continue;
      s.getWorldPosition(this.tmp);
      if (s === pl.hull) this.tmp.y += pl.extents.hy * 0.6;
      this.effects.damageSmoke(this.tmp, damage);
    }
  }

  radarCoins() {
    return this.coinsList.filter((c) => c.loose).map((c) => ({ x: c.obj.position.x, y: c.obj.position.y }));
  }

  radarEnemies() {
    return this.enemies.map((e) => ({ x: e.obj.position.x, y: e.obj.position.y, type: e.type }));
  }

  // The scope pings once per sweep and blips as the sweep line crosses each contact in range.
  sonarSounds(from, to) {
    const TAU = Math.PI * 2;
    const span = (to - from + TAU) % TAU;
    if (to < from) sfx.sonar(1 + this.player.levels.sonar * 0.25);
    const pc = this.player.center;
    const range = this.radarRange;
    let big = null;
    for (const e of this.enemies) {
      const dx = e.obj.position.x - pc.x;
      const dy = e.obj.position.y - pc.y;
      if (dx * dx + dy * dy > range * range) continue;
      const bearing = (Math.atan2(-dy, dx) + TAU) % TAU;
      if ((bearing - from + TAU) % TAU >= span) continue;
      big = (big ?? false) || e.type === 'boss';
    }
    if (big !== null) sfx.blip(big);
  }

  // Combat music starts once an enemy sub comes into view, or in the dark of the deep a few seconds before the wave
  // arrives. It carries on until the wave is over and lingers a moment after its last sub is sunk; the break between
  // waves gets the calm track.
  get inCombat() {
    return this.combatHold > 0;
  }

  updateCombatHold(dt) {
    const subs = this.enemies.filter((e) => e.type !== 'mine');
    const between = !this.queue.length && !subs.length;
    if (between) this.combatOn = false;
    const waveSoon = this.waveBreak > 0 && this.waveBreak < DEEP_COMBAT_LEAD;
    if (between && waveSoon && this.world.dark > 0.3) this.combatOn = true;
    if (subs.some((e) => this.onScreen(e.obj.position.x, e.obj.position.y))) this.combatOn = true;
    this.combatHold = this.combatOn ? COMBAT_HOLD : Math.max(0, (this.combatHold ?? 0) - dt);
  }

  get radarRange() {
    return 18 + this.player.levels.sonar * 9;
  }

  get partCount() {
    return this.player.parts.length;
  }
}
