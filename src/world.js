import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { animationsOf, findNode, plainMaterials, spawn, spawnSkinned, tint } from './assets.js';
import { sfx } from './audio.js';
import { CURRENT_MATERIALS, NOISE_GLSL, SHADER_TIME, WHALE_BEND, addTailBeat, addWaterline } from './surface.js';
import {
  ABYSS_Y, CAMERA_Z, SHELF_Y, SURFACE_Y, TAN_HALF_FOV, WATER_GRADIENT_GLSL, darkness, depthShift,
} from './water.js';

const TILE_W = 80;
const TILE_D = 175;
const TILE_Z0 = 16;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function halfWidthAt(z, aspect) {
  return (CAMERA_Z - z) * TAN_HALF_FOV * aspect;
}

// Seabed depth along the world: sunlit ruin shelves broken up by trenches that fall into the abyss.
const rawDepth = (x) => 0.5 + 0.5 * (0.6 * Math.sin(x * 0.011 - 1.2) + 0.4 * Math.sin(x * 0.027 + 2.0));
const FILL_REACH = 110;
// Below this the raw signal is sunlit shelf, which is never filled.
const SHELF_DEPTH = 0.36;
const FILL_CELL = 2;
const fillCache = new Map();

// The raw depth signal can dip partway back up between two deep stretches, leaving an odd plateau in mid-trench.
// Where there is deep water on both sides of a dip, fill it so the trench runs on unbroken; shelves are untouched
// because a shelf always has shallow water on at least one side.
function filledDepth(cell) {
  let n = fillCache.get(cell);
  if (n !== undefined) return n;
  const x = cell * FILL_CELL;
  let left = 0;
  let right = 0;
  for (let d = 0; d <= FILL_REACH; d += 5) {
    left = Math.max(left, rawDepth(x - d));
    right = Math.max(right, rawDepth(x + d));
  }
  const fill = Math.min(left, right);
  n = rawDepth(x);
  if (n > SHELF_DEPTH && fill > 0.5) n = Math.max(n, fill);
  fillCache.set(cell, n);
  if (fillCache.size > 6000) fillCache.delete(fillCache.keys().next().value);
  return n;
}

function depthAt(x) {
  const c = Math.floor(x / FILL_CELL);
  const t = x / FILL_CELL - c;
  return filledDepth(c) * (1 - t) + filledDepth(c + 1) * t;
}

export function floorY(x) {
  const n = depthAt(x);
  const deepness = THREE.MathUtils.smoothstep(n, SHELF_DEPTH, 0.68);
  // Step the descent into three cliff-and-ledge tiers.
  const tiers = 3;
  const k = Math.min(Math.floor(deepness * tiers), tiers - 1);
  const stepped = (k + THREE.MathUtils.smoothstep(deepness * tiers - k, 0.3, 0.7)) / tiers;
  const ledges = Math.sin(x * 0.09) * 1.5 * deepness * (1 - deepness) * 4;
  return SHELF_Y + (ABYSS_Y - SHELF_Y) * stepped + ledges;
}

// 0 in the open middle of a shelf, rising to 1 near a cliff edge and over the deep floor beyond it.
// Each shelf is laid out in zones by how far it is from its middle: a raised coral reef in the centre, a band of
// clean sand around it, then murky water with kelp forests, anchors and mines out toward the cliffs.
const REEF_ZONE = [0.44, 0.6];
const MURK_ZONE = [0.2, 0.36];
const REEF_RISE = 4.5;

// 0 in the clear middle of a shelf, 1 out in the murk near the cliffs and over the deep floor beyond.
export function murkAt(x) {
  return 1 - THREE.MathUtils.smoothstep(shelfCentre(x), MURK_ZONE[0], MURK_ZONE[1]);
}

// 1 across the reef in the middle of a shelf, 0 outside it.
function reefAt(x) {
  return THREE.MathUtils.smoothstep(shelfCentre(x), REEF_ZONE[0], REEF_ZONE[1]);
}

// The seabed swells up into a broad reef platform across the middle of the shelf.
function reefRise(x, z) {
  const reef = reefAt(x);
  if (reef <= 0) return 0;
  const dz = (z - MOUND_Z) / 26;
  return REEF_RISE * reef * Math.exp(-dz * dz);
}

// Reef mounds: one per stretch of shelf, placed and sized by a hash of the stretch so they never move.
const MOUND_CELL = 24;
const MOUND_Z = -10;
const SHELF_SEARCH = 400;

function hash(n, k = 0) {
  const s = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const moundCache = new Map();

export function moundOf(cell) {
  let m = moundCache.get(cell);
  if (!m) {
    m = makeMound(cell);
    moundCache.set(cell, m);
    if (moundCache.size > 64) moundCache.delete(moundCache.keys().next().value);
  }
  return m;
}

// Kelp and anchors only rest on flat shelf with room to spare, never on a cliff face or hanging over its lip.
const SHELF_ONLY = /^(kelp|anchor)/;
function onFlatShelf(x) {
  return [-3, 0, 3].every((dx) => floorY(x + dx) > SHELF_Y - 0.8);
}

// 1 halfway between a shelf's two cliff edges, falling to 0 at either edge and over the deep floor.
const centreCache = new Map();
function shelfCentre(x) {
  const c = Math.floor(x / 4);
  const t = x / 4 - c;
  return shelfCentreAt(c * 4) * (1 - t) + shelfCentreAt(c * 4 + 4) * t;
}

function shelfCentreAt(x) {
  let v = centreCache.get(x);
  if (v === undefined) {
    v = measureShelfCentre(x);
    centreCache.set(x, v);
    if (centreCache.size > 4000) centreCache.delete(centreCache.keys().next().value);
  }
  return v;
}

function measureShelfCentre(x) {
  const onShelf = (at) => floorY(at) > SHELF_Y - 3;
  if (!onShelf(x)) return 0;
  let left = x;
  let right = x;
  while (onShelf(left - 4) && x - left < SHELF_SEARCH) left -= 4;
  while (onShelf(right + 4) && right - x < SHELF_SEARCH) right += 4;
  const half = (right - left) / 2;
  return half > 0 ? THREE.MathUtils.clamp(1 - Math.abs(x - (left + right) / 2) / half, 0, 1) : 0;
}

// Reefs crowd together into one big reef in the middle of each shelf and thin out toward the cliffs.
function makeMound(cell) {
  const x = cell * MOUND_CELL + MOUND_CELL * (0.2 + 0.6 * hash(cell, 1));
  const centre = shelfCentre(x);
  return {
    cell,
    x,
    centre,
    height: 3.0 + 3.5 * hash(cell, 2),
    width: 4.5 + 3.5 * hash(cell, 3),
    reef: reefAt(x) > 0.3,
    murk: murkAt(x),
  };
}

function moundHeight(x, z) {
  const cell = Math.floor(x / MOUND_CELL);
  let h = 0;
  for (let c = cell - 1; c <= cell + 1; c++) {
    const m = moundOf(c);
    if (!m.reef) continue;
    const dx = (x - m.x) / m.width;
    const dz = (z - MOUND_Z) / 6.5;
    const ridge = 0.25 * Math.sin(x * 1.3 + c) * Math.exp(-dx * dx * 2);
    h += (m.height + ridge) * Math.exp(-dx * dx - dz * dz);
  }
  return h;
}

// How close a point is to a reef: 1 at a reef's heart, fading out across the sand around it.
function reefGlow(x, z) {
  const cell = Math.floor(x / MOUND_CELL);
  let g = 0;
  for (let c = cell - 1; c <= cell + 1; c++) {
    const m = moundOf(c);
    if (!m.reef) continue;
    const dx = (x - m.x) / (m.width * (2.4 + 1.6 * m.centre));
    const dz = (z - MOUND_Z) / 20;
    g = Math.max(g, Math.exp(-dx * dx - dz * dz));
  }
  return g;
}

function detailHeight(x, z) {
  const shelf = 1 - THREE.MathUtils.smoothstep(SHELF_Y - floorY(x), 2, 10);
  return baseDetail(x, z) + (shelf > 0 ? (moundHeight(x, z) + reefRise(x, z)) * shelf : 0);
}

function baseDetail(x, z) {
  const depth = Math.max(0, -z - 4);
  let h = 0.35 * Math.sin(x * 0.157 + z * 0.21) + 0.25 * Math.sin(x * 0.39 - z * 0.37 + 1.3)
    + 0.12 * Math.sin(x * 0.86 + z * 0.9);
  h *= 1 + depth * 0.03;
  if (z > 4) h += (z - 4) * 0.12;
  return h;
}

export function seabedAt(x, z = 0) {
  return floorY(x) + detailHeight(x, z);
}

// Ruins only stand on the sunlit shelves; anything off the shelf, down the cliffs and in the trenches, is bare rock.
const LAYERS = [
  {
    z: [-100, -70], gap: [12, 24], scale: [2.4, 3.6], plain: true,
    props: ['ruin_tower', 'ruin_pillar_a', 'ruin_arch', 'ruin_tower', 'ruin_pier'],
    deep: ['rock_a', 'rock_b'],
  },
  {
    z: [-48, -22], gap: [6, 12], scale: [1.1, 1.7],
    props: ['ruin_pier', 'ruin_arch', 'ruin_pillar_a', 'ruin_pillar_b', 'ruin_wall', 'anchor', 'rock_a', 'ruin_tower'],
    deep: ['rock_a', 'rock_b'],
  },
  {
    z: [-16, -2], gap: [7, 14], scale: [0.85, 1.35],
    props: ['ruin_pillar_b', 'rock_b', 'anchor', 'rock_a', 'ruin_wall'],
    deep: ['rock_a', 'rock_b', 'rock_b'],
  },
  {
    z: [9, 13], gap: [5, 10], scale: [1.0, 1.5], tint: ['#0b2a3f', 0.6],
    props: ['kelp_short', 'coral_fan', 'coral_staghorn', 'sponge_cluster', 'kelp_short', 'coral_brain'],
    deep: ['rock_b', 'rock_a'],
  },
];

const CHAIN_Z = [-70, -26];
// The foam line floats in front of the action; each frame it is placed so it lines up with the true surface behind.
const WATERLINE_Z = 3.5;
// Rough ground radius of each seafloor piece, used to find clear spots for sinking wrecks.
const FOOTPRINT = {
  reef_large: 2.4, reef_small: 1.5, kelp_tall: 0.8, kelp_short: 0.7, coral_staghorn: 0.9, coral_fan: 0.7,
  coral_table: 1.1, sponge_cluster: 0.6, anemone_patch: 0.8, coral_brain: 0.8, rock_a: 1.5, rock_b: 0.9,
  ruin_pillar_a: 1.0, ruin_pillar_b: 1.0, ruin_arch: 2.8, ruin_wall: 2.8, ruin_pier: 7, ruin_tower: 1.6, anchor: 1.0,
};
const CORALS = ['coral_staghorn', 'coral_fan', 'coral_table', 'sponge_cluster', 'anemone_patch', 'coral_brain'];
// Fixed resting places for sunken enemy subs: one in the murk near the western cliff, one on a trench floor.
const WRECKS = [{ x: -150, z: -16, yaw: 0.5, roll: 0.18 }, { x: 236, z: -12, yaw: -0.4, roll: -0.12 }];

function makeBackdrop() {
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uShift: { value: 0 }, uDark: { value: 0 }, uLine: { value: 2 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4( position.xy, 0.9999, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform float uShift, uDark, uLine;
      varying vec2 vUv;
      ${WATER_GRADIENT_GLSL}
      void main() {
        vec3 sea = seaColor( vUv.y, uShift, uDark );
        float h = vUv.y - uLine;
        vec3 sky = mix( vec3( 0.62, 0.86, 0.95 ), vec3( 0.16, 0.48, 0.86 ), smoothstep( 0.0, 0.35, h ) );
        sky += vec3( 1.0, 0.9, 0.7 ) * 0.25 * smoothstep( 0.25, 0.0, length( vec2( ( vUv.x - 0.7 ) * 1.6, h - 0.2 ) ) );
        gl_FragColor = vec4( h > 0.0 ? sky : sea, 1.0 );
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  quad.renderOrder = -10;
  return quad;
}

function makeRays() {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSeed: { value: Math.random() * 100 }, uStrength: { value: rand(0.1, 0.22) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vWorldY;
        void main() {
          vUv = uv;
          vWorldY = ( modelMatrix * vec4( position, 1.0 ) ).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      // The tilted shaft reaches above the water and is cut off level with the surface, brightest just under it.
      fragmentShader: /* glsl */ `
        uniform float uTime, uSeed, uStrength;
        varying vec2 vUv;
        varying float vWorldY;
        void main() {
          float edge = smoothstep( 0.0, 0.35, vUv.x ) * smoothstep( 1.0, 0.65, vUv.x );
          float below = ${SURFACE_Y.toFixed(1)} - vWorldY;
          float fade = pow( clamp( 1.0 - below / 55.0, 0.0, 1.0 ), 1.4 ) * smoothstep( 0.0, 1.2, below );
          float flicker = 0.65 + 0.35 * sin( uTime * 0.7 + uSeed ) * sin( uTime * 0.31 + uSeed * 2.0 );
          gl_FragColor = vec4( vec3( 0.75, 0.95, 1.0 ) * edge * fade * flicker * uStrength, 1.0 );
        }`,
    });
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(rand(2.5, 7), 76), mat);
    ray.userData.strength = mat.uniforms.uStrength.value;
    ray.position.set(rand(-50, 50), SURFACE_Y - 26, rand(-45, -12));
    ray.rotation.z = rand(0.18, 0.38);
    rays.push(ray);
  }
  return rays;
}

function makeSurface() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz * 0.18;
        float w = sin( p.x * 3.0 + uTime ) + sin( p.y * 4.0 - uTime * 0.8 ) + sin( ( p.x + p.y ) * 2.3 + uTime * 1.4 );
        float bright = smoothstep( 1.0, 2.8, w );
        float dist = smoothstep( -120.0, -5.0, vWorld.z );
        gl_FragColor = vec4( vec3( 0.6, 0.92, 1.0 ) * ( 0.18 + bright * 0.55 ) * dist, 1.0 );
      }`,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(500, 145, 1, 1), mat);
  plane.rotation.x = Math.PI / 2;
  plane.position.set(0, SURFACE_Y, -72.5);
  return plane;
}

function makeWaterline() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4( position, 1.0 );
        w.y += ( sin( w.x * 0.6 + uTime * 2.0 ) * 0.14 + sin( w.x * 1.7 - uTime * 3.1 ) * 0.06 ) * uv.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        float foam = smoothstep( 0.55, 0.85, vUv.y ) * smoothstep( 1.0, 0.9, vUv.y );
        vec3 water = vec3( 0.25, 0.75, 0.95 );
        gl_FragColor = vec4( mix( water, vec3( 0.95, 1.0, 1.0 ), foam ), 0.08 + foam * 0.75 );
      }`,
  });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(240, 0.9, 240, 1), mat);
  strip.position.set(0, SURFACE_Y - 0.35, WATERLINE_Z);
  strip.renderOrder = 8;
  return strip;
}

const SHALLOW_COLORS = ['#1d5a55', '#2c7a60', '#4a9068', '#17474a'].map((c) => new THREE.Color(c));
const RUBBLE = new THREE.Color('#5d8a95');
const SHELF_TEAL = new THREE.Color('#2a8f98');
const MURK = new THREE.Color('#353f2c');
const REEF_SAND = new THREE.Color('#2fa9d6');
const REEF_LAGOON = new THREE.Color('#86e6f2');
const DEEP_COLORS = ['#1a2430', '#252f3d', '#2d3644', '#151b26'].map((c) => new THREE.Color(c));

function makeSeabedTile(material) {
  const geo = new THREE.PlaneGeometry(TILE_W, TILE_D, 80, 90);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, TILE_Z0 - TILE_D / 2);
  geo.userData.baseX = Float32Array.from({ length: geo.attributes.position.count }, (_, i) => geo.attributes.position.getX(i));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  geo.setAttribute('aReef', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  const tile = new THREE.Mesh(geo, material);
  tile.frustumCulled = false;
  tile.userData.x0 = null;
  return tile;
}

// Tiles are reshaped as they wrap ahead of the camera. The work is spread over a few frames, since the tile being
// rebuilt is out of view; `budget` caps the vertices done per call.
function shapeTile(tile, target, budget = Infinity) {
  const job = tile.userData;
  if (job.x0 !== target) {
    job.x0 = target;
    job.next = 0;
  }
  if (job.next === null) return;
  const geo = tile.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const c = new THREE.Color();
  const d = new THREE.Color();
  const glowAttr = geo.attributes.aReef.array;
  const end = Math.min(pos.count, job.next + budget);
  const x0 = job.x0;
  const murkOf = new Map();
  for (let i = job.next; i < end; i++) {
    const x = geo.userData.baseX[i] + x0;
    if (!murkOf.has(x)) murkOf.set(x, murkAt(x));
    const murk = murkOf.get(x);
    const z = pos.getZ(i);
    const floor = floorY(x);
    const shelf = 1 - THREE.MathUtils.smoothstep(SHELF_Y - floor, 2, 10);
    const raised = shelf > 0 ? (moundHeight(x, z) + reefRise(x, z)) * shelf : 0;
    const y = floor + baseDetail(x, z) + raised;
    pos.setY(i, y);
    const n = 0.5 + 0.5 * Math.sin(x * 0.236 + z * 0.13) * Math.cos(x * 0.55 - z * 0.29);
    const m = 0.5 + 0.5 * Math.sin(x * 1.02 + z * 0.71);
    c.copy(SHALLOW_COLORS[0]).lerp(SHALLOW_COLORS[1], n).lerp(SHALLOW_COLORS[2], m * 0.35 * n);
    c.lerp(SHALLOW_COLORS[3], Math.max(0, Math.sin(x * 0.31 - z * 0.5)) * 0.4);
    d.copy(DEEP_COLORS[0]).lerp(DEEP_COLORS[1], n).lerp(DEEP_COLORS[2], m * 0.4);
    c.lerp(SHELF_TEAL, (1 - murk) * 0.4);
    c.lerp(MURK, murk * 0.6);
    c.lerp(d, THREE.MathUtils.smoothstep(-y, 18, 45));
    const glow = shelf > 0 ? reefGlow(x, z) * shelf : 0;
    const ripple = 0.5 + 0.5 * Math.sin(x * 0.9 + z * 0.4) * Math.sin(x * 0.37 - z * 1.1);
    c.lerp(RUBBLE, THREE.MathUtils.smoothstep(raised, 0.4, 2.0) * 0.55 * (1 - glow));
    c.lerp(REEF_SAND, THREE.MathUtils.smoothstep(glow, 0, 0.7) * 0.92);
    c.lerp(REEF_LAGOON, glow * ripple * 0.4);
    glowAttr[i] = glow;
    col.setXYZ(i, c.r, c.g, c.b);
  }
  job.next = end;
  if (end < pos.count) return;
  job.next = null;
  tile.position.x = x0;
  pos.needsUpdate = true;
  col.needsUpdate = true;
  geo.attributes.aReef.needsUpdate = true;
  geo.computeVertexNormals();
}

function makeSeabedMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: '#9fb5b4' });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaWorld;\nattribute float aReef;\nvarying float vReef;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSeaWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvReef = aReef;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSeaWorld;
        varying float vReef;
        uniform float uTime;
        ${NOISE_GLSL}
        // Caustic net: bright lines along the borders of slowly wobbling cells, like light focused by surface waves.
        vec2 cHash( vec2 p ) {
          p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
          return fract( sin( p ) * 43758.5453 );
        }
        float caustic( vec2 p, float speed ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          float d1 = 8.0;
          float d2 = 8.0;
          for ( int y = -1; y <= 1; y++ ) {
            for ( int x = -1; x <= 1; x++ ) {
              vec2 g = vec2( float( x ), float( y ) );
              vec2 o = 0.5 + 0.42 * sin( uTime * speed + 6.2831 * cHash( i + g ) );
              float d = length( g + o - f );
              if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
            }
          }
          return 1.0 - smoothstep( 0.0, 0.11, d2 - d1 );
        }`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 sp = vec3( vSeaWorld.x, vSeaWorld.y * 0.5, vSeaWorld.z );
        float sRipple = 0.5 + 0.5 * sin( sp.x * 2.6 + sp.z * 0.8 + dNoise( sp * 0.6 ) * 4.0 );
        float sPebble = smoothstep( 0.68, 0.74, dNoise( sp * 3.5 ) );
        float sPatch = dNoise( sp * 0.15 );
        float sShallow = smoothstep( -30.0, -12.0, vSeaWorld.y );
        float sGrass = smoothstep( 0.55, 0.78, dNoise( sp * 0.35 + 5.0 ) ) * sShallow * ( 1.0 - vReef );
        float sSteep = 1.0 - smoothstep( 0.55, 0.85, inverseTransformDirection( normalize( vNormal ), viewMatrix ).y );
        diffuseColor.rgb *= 0.85 + sRipple * 0.12 * ( 1.0 - sSteep ) + ( sPatch - 0.5 ) * 0.4 * ( 1.0 - 0.6 * vReef );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.28, 0.11 ), sGrass * 0.5 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.55, sPebble * 0.6 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.22, 0.26 ) * ( 0.7 + sPatch * 0.6 ), sSteep * 0.8 );`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        float sHeight = sRipple * 0.4 * ( 1.0 - sSteep ) + sPebble * 0.8 + dNoise( sp * 7.0 ) * 0.25 + sPatch * sSteep * 1.2;
        normal = dPerturb( - vViewPosition, normal, vec2( dFdx( sHeight ), dFdy( sHeight ) ) * 0.25, faceDirection );`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        // Two drifting layers of caustics at different scales, so the sunlit floor ripples with light.
        float fadeC = smoothstep( -90.0, -4.0, vSeaWorld.z ) * smoothstep( -32.0, -6.0, vSeaWorld.y );
        vec2 cA = vSeaWorld.xz * vec2( 0.42, 0.3 ) + vec2( uTime * 0.05, uTime * 0.03 );
        cA += 0.45 * vec2( sin( cA.y * 1.9 + uTime * 0.6 ), cos( cA.x * 1.6 - uTime * 0.5 ) );
        vec2 cB = vSeaWorld.xz * vec2( 0.78, 0.55 ) - vec2( uTime * 0.04, -uTime * 0.06 ) + 7.0;
        cB += 0.4 * vec2( sin( cB.y * 2.3 - uTime * 0.7 ), cos( cB.x * 2.1 + uTime * 0.6 ) );
        float cNet = caustic( cA, 0.7 );
        float cFine = caustic( cB, 1.1 );
        float cLight = cNet * cNet * 0.8 + cNet * cFine * 0.6;
        float cBand = 0.35 + 0.9 * dNoise( vec3( vSeaWorld.xz * 0.18 + uTime * 0.08, uTime * 0.15 ) );
        totalEmissiveRadiance += vec3( 0.5, 0.9, 0.95 ) * cLight * 0.6 * fadeC * cBand * ( 1.0 + vReef * 1.3 );
        totalEmissiveRadiance += vec3( 0.02, 0.12, 0.2 ) * vReef * fadeC;`);
  };
  return mat;
}

// A wide, soft glow that fades out gradually, so the lure lights the water around it in place of a hard ball.
let lureGlowTexture = null;
function lureGlow() {
  if (lureGlowTexture) return lureGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  [[0, 0.9], [0.08, 0.55], [0.2, 0.28], [0.4, 0.1], [0.7, 0.03], [1, 0]].forEach(([stop, alpha]) => {
    grad.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  });
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  lureGlowTexture = new THREE.CanvasTexture(canvas);
  return lureGlowTexture;
}

function softDot() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

function makeDust() {
  const count = 800;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set([rand(-40, 40), rand(-14, 14), rand(-30, 14)], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.12, map: softDot(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: new THREE.Color('#bff4ff'), opacity: 0.55,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function makeFishGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0.5, 0);
  shape.quadraticCurveTo(0.2, 0.22, -0.25, 0.05);
  shape.lineTo(-0.5, 0.2);
  shape.lineTo(-0.42, 0);
  shape.lineTo(-0.5, -0.2);
  shape.lineTo(-0.25, -0.05);
  shape.quadraticCurveTo(0.2, -0.22, 0.5, 0);
  return new THREE.ShapeGeometry(shape);
}

// Anglerfish prowl just above the floor of the deepest trenches.
const ANGLER_FLOOR = -170;
const ANGLER_BAND = [4, 16];
const ANGLER_SPACING = 18;

function makeAngler() {
  const fish = spawn('anglerfish');
  fish.scale.setScalar(rand(1.0, 1.6));
  const esca = findNode(fish, 'Esca');
  esca.material = esca.material.clone();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: lureGlow(), color: new THREE.Color(0.45, 1.25, 1.15), blending: THREE.AdditiveBlending, depthWrite: false,
    transparent: true, fog: false, opacity: 0,
  }));
  halo.scale.setScalar(3.4);
  esca.add(halo);
  fish.userData = {
    halo, esca, escaBase: esca.material.emissiveIntensity, glow: 0, flash: 0, untilFlash: rand(2, 12), phase: rand(0, 6),
    vel: new THREE.Vector2(rand(-0.5, 0.5), 0), target: null, retarget: 0, yaw: 0, facing: 1,
  };
  return fish;
}

// Anglerfish wander between waypoints near the trench floor and light their lure when the sub comes close.
// Each lure flash lasts about two seconds: a quick swell, a hold, and a fade back to darkness.
const FLASH_TIME = 2.2;
const FLASH_GAP = [7, 15];

function flashLevel(f) {
  if (f <= 0 || f >= FLASH_TIME) return 0;
  return Math.min(1, f / 0.35, (FLASH_TIME - f) / 0.6);
}

function updateAngler(a, dt, t, cx, sub, world) {
  const u = a.userData;
  const p = a.position;
  u.retarget -= dt;
  if (!u.target || u.retarget <= 0 || Math.hypot(u.target.x - p.x, u.target.y - p.y) < 1.5) {
    let x = p.x + rand(-14, 14);
    if (floorY(x) > ANGLER_FLOOR) x = p.x - (x - p.x);
    // Anglers are loners: steer the next waypoint away from any neighbour that is too close.
    for (const other of world.anglers) {
      if (other !== a && Math.abs(other.position.x - x) < ANGLER_SPACING) {
        x += Math.sign(x - other.position.x || 1) * ANGLER_SPACING;
      }
    }
    if (floorY(x) > ANGLER_FLOOR) x = p.x;
    u.target = new THREE.Vector2(x, floorY(x) + rand(ANGLER_BAND[0], ANGLER_BAND[1]));
    u.retarget = rand(5, 11);
  }
  const want = new THREE.Vector2(u.target.x - p.x, u.target.y - p.y);
  const speed = 0.9;
  if (want.lengthSq() > 0.01) want.setLength(speed);
  for (const other of world.anglers) {
    if (other === a) continue;
    const dx = p.x - other.position.x;
    const gap = Math.abs(dx);
    if (gap < ANGLER_SPACING) want.x += Math.sign(dx || 1) * (1 - gap / ANGLER_SPACING) * 1.4;
  }
  u.vel.lerp(want, 1 - Math.exp(-dt * 0.5));
  p.x += u.vel.x * dt;
  p.y = Math.max(floorY(p.x) + ANGLER_BAND[0] - 1, p.y + u.vel.y * dt + Math.sin(t * 0.6 + u.phase) * 0.08 * dt);
  if (Math.abs(u.vel.x) > 0.2) u.facing = Math.sign(u.vel.x);
  u.yaw += ((u.facing > 0 ? 0 : -Math.PI) - u.yaw) * (1 - Math.exp(-dt * 0.8));
  // The whole body swings a little in time with the tail wave, so the swimming reads from the side.
  a.rotation.y = u.yaw + Math.sin(t * 3 + u.phase) * 0.14;
  a.rotation.z = THREE.MathUtils.clamp(Math.atan2(u.vel.y, Math.abs(u.vel.x) + 0.3), -0.35, 0.35) * u.facing * 0.8;
  // Mostly dark: now and then the lure flares for a couple of seconds, lighting the fish up before it vanishes again.
  const near = sub && a.position.distanceTo(sub) < 12 * a.scale.x;
  // A sub swimming up sets the lure off straight away; otherwise it flares now and then on its own.
  if (near && !u.wasNear && u.flash <= 0) u.untilFlash = 0;
  u.wasNear = near;
  u.untilFlash -= dt;
  if (u.flash > 0) u.flash += dt;
  else if (u.untilFlash <= 0) {
    const owner = world.anglerLight.userData.owner;
    if (!owner || near) {
      if (owner && owner !== a) owner.userData.flash = 0;
      u.flash = 0.001;
      world.anglerLight.userData.owner = a;
    }
  }
  if (u.flash >= FLASH_TIME) {
    u.flash = 0;
    u.untilFlash = rand(FLASH_GAP[0], FLASH_GAP[1]);
    if (world.anglerLight.userData.owner === a) world.anglerLight.userData.owner = null;
  }
  u.glow = flashLevel(u.flash);
  const flicker = 0.9 + 0.1 * Math.sin(t * 9 + u.phase);
  u.esca.material.emissiveIntensity = u.escaBase * 0.45 * (0.03 + 0.97 * u.glow) * flicker;
  u.halo.material.opacity = 0.75 * u.glow * flicker;
  if (world.anglerLight.userData.owner === a) {
    u.esca.getWorldPosition(world.anglerLight.position);
    world.anglerLight.position.z += 1.2;
    world.anglerLight.intensity = 55 * u.glow * flicker * a.scale.x;
  }
}

// Seagulls bob on the swell and take flight when a surfacing sub comes too close. The source animation runs at
// 24 fps: floating and preening, then a takeoff, then steady flapping.
const GULL_COUNT = 6;
const GULL_SCALE = 1.3;
const GULL_SCARE = 12;
const GULL_WARY = 26;
const GULL_CLEARANCE = 0.9;
// How long a gull needs from the first flap to being clear of the water.
const GULL_TAKEOFF_TIME = 1.6;
const GULL_FPS = 24;
let gullClips = null;

function gullAnimations() {
  if (gullClips) return gullClips;
  const [source] = animationsOf('seagull');
  // The rig's own travel is dropped; the game moves the gull itself.
  const clip = source.clone();
  clip.tracks = clip.tracks.filter((track) => !track.name.startsWith('GullRig.'));
  gullClips = {
    idle: THREE.AnimationUtils.subclip(clip, 'idle', 1, 115, GULL_FPS),
    takeoff: THREE.AnimationUtils.subclip(clip, 'takeoff', 126, 214, GULL_FPS),
    fly: THREE.AnimationUtils.subclip(clip, 'fly', 216, 237, GULL_FPS),
  };
  return gullClips;
}

function makeGull() {
  const holder = new THREE.Group();
  const body = spawnSkinned('seagull');
  body.rotation.y = -Math.PI / 2;
  body.scale.setScalar(GULL_SCALE);
  holder.add(body);
  body.traverse((o) => {
    if (o.isMesh) {
      o.material.color.setScalar(0.62);
      o.material.envMapIntensity = 0.25;
    }
  });
  const legs = ['L', 'R'].map((side) => ['thigh', 'shin', 'foot'].map((bone) => body.getObjectByName(bone + side)));
  const mixer = new THREE.AnimationMixer(body);
  const clipsFor = gullAnimations();
  const actions = {
    idle: mixer.clipAction(clipsFor.idle).setLoop(THREE.LoopPingPong),
    takeoff: mixer.clipAction(clipsFor.takeoff).setLoop(THREE.LoopOnce),
    fly: mixer.clipAction(clipsFor.fly).setLoop(THREE.LoopRepeat),
  };
  actions.takeoff.clampWhenFinished = true;
  holder.userData = {
    mixer, actions, legs, state: 'float', t: 0, phase: rand(0, 6), nerve: rand(0.7, 1.15), panic: 1,
    vel: new THREE.Vector2(), dir: 1,
  };
  return holder;
}

// Seconds until the sub reaches a floating gull at its current velocity, along the surface or rising up from below.
function arrivalTime(gull, sub, vel) {
  const dx = gull.position.x - sub.x;
  let eta = Infinity;
  const closing = Math.sign(dx) * vel.x;
  if (closing > 0.5 && sub.y > SURFACE_Y - 7) eta = Math.max(0, Math.abs(dx) - 2) / closing;
  if (vel.y > 0.5 && Math.abs(dx) < GULL_SCARE && sub.y < SURFACE_Y) eta = Math.min(eta, (SURFACE_Y - sub.y) / vel.y);
  return eta;
}

// Pushes a gull out of an ellipse around the hull so it never passes through the sub. Floating gulls only slide
// along the surface.
function keepClear(gull, sub, extents, floating) {
  const rx = extents.hx + GULL_CLEARANCE;
  const ry = extents.hy + GULL_CLEARANCE;
  if (floating && Math.abs(gull.position.y - sub.y) > ry) return;
  const dx = (gull.position.x - sub.x) / rx;
  const dy = floating ? 0 : (gull.position.y - sub.y) / ry;
  const d = Math.hypot(dx, dy);
  if (d >= 1) return;
  if (d < 1e-4) {
    gull.position.x = sub.x + rx * (gull.userData.dir || 1);
    return;
  }
  gull.position.x = sub.x + (dx / d) * rx;
  if (!floating) gull.position.y = Math.max(SURFACE_Y - 0.02, sub.y + (dy / d) * ry);
}

// Alternating strokes on top of the clip, so a floating gull's feet keep paddling under the surface.
function treadWater(u, time) {
  u.legs.forEach(([thigh, shin, foot], i) => {
    const stroke = time * 5.5 + u.phase + i * Math.PI;
    thigh.rotateX(0.45 * Math.sin(stroke));
    shin.rotateX(0.55 * Math.sin(stroke - 0.8));
    foot.rotateX(-0.7 * Math.sin(stroke - 1.4));
  });
}

function playGull(gull, name, fade = 0.25) {
  const { actions, current } = gull.userData;
  const next = actions[name];
  next.reset().play();
  if (current && current !== next) current.crossFadeTo(next, fade, false);
  gull.userData.current = next;
}

// Anchors and kelp crowd the murky sand toward the cliffs; the clear middle of a shelf keeps its corals and ruins.
function chooseProp(layer, mood, murk) {
  if (mood === 'deep') return pick(layer.deep);
  const others = layer.props.filter((n) => n !== 'anchor');
  if (mood === 'murk') {
    if (layer.props.includes('anchor') && Math.random() < 0.55 * murk) return 'anchor';
    if (layer.props.includes('kelp_short')) return Math.random() < 0.75 ? 'kelp_short' : pick(layer.deep);
  }
  // Clear water keeps its corals and ruins; kelp only grows out in the murk.
  const clear = others.filter((n) => !n.startsWith('kelp'));
  return pick(clear.length ? clear : others);
}

// Sunken anchors lie where they fell: leaning with the crown dug in, toppled onto their back, or half buried.
function settleAnchor(obj) {
  const size = obj.scale.x;
  obj.rotation.order = 'YXZ';
  obj.rotation.y = rand(-Math.PI, Math.PI);
  const pose = Math.random();
  if (pose < 0.4) {
    obj.rotation.z = (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.75);
    obj.position.y -= 0.35 * size;
  } else if (pose < 0.75) {
    obj.rotation.x = (Math.random() < 0.5 ? -1 : 1) * rand(1.2, 1.4);
    obj.rotation.z = rand(-0.3, 0.3);
    obj.position.y += 0.05 * size;
  } else {
    obj.rotation.z = rand(-0.25, 0.25);
    obj.rotation.x = rand(-0.3, 0.3);
    obj.position.y -= rand(0.9, 1.4) * size;
  }
}

// A humpback roams the open water above the trenches, a huge hazy shape behind the action. Over a trench the buoy
// chains are gone and the scenery sits far down on the floor, so it can swim close enough for its parallax to read
// right; it stays behind the sunbeams (which end 45 units back, and its flippers reach a quarter of its length to
// either side). When the floor ahead starts rising toward a shelf it swings round in a wide, banking half-circle, and
// if it drifts near the shallows it fades away into the water.
const WHALE_LENGTH = 46;
const WHALE_Z = { near: -58, centre: -90 };
const WHALE_SPEED = 2.6;
const WHALE_TURN_RADIUS = 32;
const WHALE_GAP = [25, 45];
// How far back it starts to fade on its way out, and where it has vanished.
const WHALE_FADE = [85, 150];
const WHALE_ROAM = 60;
// How much of the water's haze it takes on: a soft veil in open water, all of it near the shallows.
const WHALE_HAZE = 0.68;
const deepBelow = (x) => SHELF_Y - floorY(x);

function makeWhale() {
  const whale = spawn('humpback');
  whale.scale.setScalar(WHALE_LENGTH);
  whale.rotation.order = 'YXZ';
  // So far back the water fog would swallow it, so it gets its own cap on the haze, raised to fade it out.
  const haze = { value: 1 };
  whale.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const previous = m.onBeforeCompile;
    const key = m.customProgramCacheKey?.() ?? m.name;
    m.defines = { ...m.defines, FOG_CAP: 'uWhaleHaze' };
    m.onBeforeCompile = (shader, renderer) => {
      previous?.call(m, shader, renderer);
      shader.uniforms.uWhaleHaze = haze;
      shader.fragmentShader = `uniform float uWhaleHaze;\n${shader.fragmentShader}`;
    };
    m.customProgramCacheKey = () => `${key}-whalehaze`;
    m.needsUpdate = true;
  });
  whale.visible = false;
  whale.userData = { active: false, wait: 15, heading: 0, turn: 0, haze, fade: 0, phase: rand(0, 6) };
  return whale;
}

// The whale keeps to its own patch of open water over the middle of the trench near the camera, whatever the
// player does: the trench is found by walking out from the camera until the floor rises.
function whaleHome(cx) {
  if (deepBelow(cx) < 45) return null;
  let lo = cx;
  let hi = cx;
  while (deepBelow(lo - 5) > 45 && cx - lo < 400) lo -= 5;
  while (deepBelow(hi + 5) > 45 && hi - cx < 400) hi += 5;
  const roam = Math.min(WHALE_ROAM, (hi - lo) / 2 - 30 - WHALE_TURN_RADIUS);
  return roam > 15 ? { x: (lo + hi) / 2, roam } : null;
}

function updateWhale(whale, dt, t, cx, cy, aspect, calm) {
  const u = whale.userData;
  if (!u.active) {
    u.wait -= dt;
    whale.visible = false;
    if (u.wait > 0) return;
    const home = whaleHome(cx);
    if (!home) {
      u.wait = 2;
      return;
    }
    // Arrive from beyond the edge of the screen, over deep water, swimming in toward its patch.
    const offscreen = halfWidthAt(WHALE_Z.near, aspect) + WHALE_LENGTH * 0.6;
    const sides = (Math.random() < 0.5 ? [-1, 1] : [1, -1]).filter((side) => deepBelow(cx + side * offscreen) > 45);
    if (!sides.length) {
      u.wait = 2;
      return;
    }
    const dir = -sides[0];
    u.active = true;
    u.home = home;
    u.fade = 0;
    u.heading = dir > 0 ? 0 : Math.PI;
    u.turn = 0;
    u.departing = false;
    u.song = rand(2, 5);
    // It stands about 12 units tall: keep it below the surface and well above anything on the trench floor.
    u.baseY = rand(-14, 6);
    whale.position.set(cx - dir * offscreen, u.baseY, WHALE_Z.near - 3);
  }
  const p = whale.position;
  const ahead = p.x + Math.cos(u.heading) * (45 + WHALE_TURN_RADIUS);
  // At the end of its patch, or before the floor rises toward a shelf, it turns away from the camera and swims off
  // into the distance until the haze swallows it.
  const leaving = (p.x - u.home.x) * Math.cos(u.heading) > 0 && Math.abs(p.x - u.home.x) > u.home.roam;
  if (!u.departing && (deepBelow(ahead) < 45 || leaving)) {
    u.departing = true;
    u.turn = Math.cos(u.heading) > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  if (u.turn !== 0) {
    // Ease into and out of the turn: slowest at the start and end, widest sweep in the middle.
    const progress = 1 - Math.abs(u.turn) / (Math.PI / 2);
    const ease = 0.35 + 0.65 * Math.sin(Math.PI * progress);
    const rate = (WHALE_SPEED / WHALE_TURN_RADIUS) * ease * 1.25 * dt * Math.sign(u.turn);
    const step = Math.abs(rate) > Math.abs(u.turn) ? u.turn : rate;
    u.heading += step;
    u.turn -= step;
    if (Math.abs(u.turn) < 1e-4) u.turn = 0;
    u.bendTarget = Math.sign(step) * 0.06 * ease;
  } else {
    u.bendTarget = 0;
  }
  // Curve the body into the turn (positive bends toward the whale's right), easing in and out, over a slow sway.
  u.bend = THREE.MathUtils.lerp(u.bend ?? 0, u.bendTarget, 1 - Math.exp(-dt * 0.6));
  WHALE_BEND.value = u.bend + Math.sin(t * 0.45 + u.phase) * 0.012;
  p.x += Math.cos(u.heading) * WHALE_SPEED * dt;
  p.z = Math.min(WHALE_Z.near, p.z + Math.sin(u.heading) * WHALE_SPEED * dt);
  const distant = THREE.MathUtils.smoothstep(-p.z, WHALE_FADE[0], WHALE_FADE[1]);
  p.y = u.baseY + Math.sin(t * 0.25 + u.phase) * 1.2;
  const bank = u.turn === 0 ? 0 : -Math.sign(u.turn) * 0.1;
  whale.rotation.set(THREE.MathUtils.lerp(whale.rotation.x, bank, 1 - Math.exp(-dt * 0.5)), -u.heading,
    Math.cos(t * 0.25 + u.phase) * 0.05);
  // Fade in on arrival, and out into the haze as the floor below rises toward the shallows.
  u.fade = Math.min(1, u.fade + dt / 4);
  const shallow = 1 - THREE.MathUtils.smoothstep(deepBelow(p.x), 25, 60);
  u.haze.value = THREE.MathUtils.lerp(1, WHALE_HAZE, u.fade * (1 - Math.max(shallow, distant)));
  whale.visible = u.haze.value < 0.995;
  // While it's clearly in view it sings now and then, softer the hazier it is, from its side of the screen.
  const seen = 1 - (u.haze.value - WHALE_HAZE) / (1 - WHALE_HAZE);
  u.song -= dt;
  // Only in the quiet between waves, never over a fight.
  if (u.song <= 0 && calm && seen > 0.25 && Math.abs(p.x - cx) < halfWidthAt(p.z, aspect)) {
    u.song = rand(7, 14);
    sfx.whaleCall(THREE.MathUtils.clamp((p.x - cx) / halfWidthAt(p.z, aspect), -1, 1), seen);
  }
  if (Math.abs(p.x - cx) > 320 || shallow > 0.98 || distant > 0.99) {
    u.active = false;
    u.departing = false;
    u.wait = rand(WHALE_GAP[0], WHALE_GAP[1]);
  }
}

// Gives a far-off creature its own cap on the water haze, so it can sit softly in the blue and fade right out.
function hazeCap(root) {
  const haze = { value: 1 };
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const previous = m.onBeforeCompile;
    const key = m.customProgramCacheKey?.() ?? m.name;
    m.defines = { ...m.defines, FOG_CAP: 'uHazeCap' };
    m.onBeforeCompile = (shader, renderer) => {
      previous?.call(m, shader, renderer);
      shader.uniforms.uHazeCap = haze;
      shader.fragmentShader = `uniform float uHazeCap;\n${shader.fragmentShader}`;
    };
    m.customProgramCacheKey = () => `${key}-hazecap`;
    m.needsUpdate = true;
  });
  return haze;
}

// Down in the darker water of a trench a sperm whale sometimes passes by. Either it rises up out of the darkness
// below the sub, levels off and dives back down, or it glides in at the sub's depth and dives past into the dark.
// It always swims in toward the middle of the trench, and fades away as it dives or nears the walls and floor.
const SPERM_LENGTH = 24;
const SPERM_Z = [-38, -32];
const SPERM_GAP = [45, 75];
// The spine from the chest back to the flukes, and how far each joint bends in a stroke (radians).
const SPERM_TAIL = ['Bone03_03', 'Bone04_04', 'Bone05_05', 'Bone06_06', 'Bone07_07', 'Bone08_08', 'Bone09_09'];
const SPERM_BEND = [0.05, 0.08, 0.11, 0.15, 0.2, 0.26, 0.32];
const SPERM_STROKE = 2.3;
// The model rests with its tail drooping; this lifts each joint so the stroke centres on a straight body.
const SPERM_LIFT = -0.045;

function makeSpermWhale() {
  const holder = new THREE.Group();
  const body = spawnSkinned('sperm_whale');
  body.scale.setScalar(SPERM_LENGTH);
  holder.add(body);
  holder.updateMatrixWorld(true);
  // Each spine joint swings about the whale's side-to-side axis, worked out in its parent's frame at rest.
  const lateral = new THREE.Vector3(0, 0, 1);
  const spine = SPERM_TAIL.map((name, i) => {
    const bone = body.getObjectByName(name);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    return { bone, rest: bone.quaternion.clone(), axis: lateral.clone().applyQuaternion(parentQ).normalize(), bend: SPERM_BEND[i] };
  });
  holder.visible = false;
  holder.userData = { spine, haze: hazeCap(body), active: false, wait: 20, t: 0, swing: new THREE.Quaternion() };
  return holder;
}

function strokeSpermWhale(u, time) {
  u.spine.forEach((j, i) => {
    // A wave travelling from the chest to the flukes, the joints toward the tail bending the most.
    const angle = Math.sin(time * SPERM_STROKE - i * 0.55) * j.bend + SPERM_LIFT;
    j.bone.quaternion.copy(u.swing.setFromAxisAngle(j.axis, angle)).multiply(j.rest);
  });
}

function updateSpermWhale(whale, dt, cx, cy, humpback, aspect) {
  const u = whale.userData;
  if (!u.active) {
    whale.visible = false;
    u.wait -= dt;
    if (u.wait > 0 || cy > -40 || cy < -175) return;
    const home = whaleHome(cx);
    if (!home) {
      u.wait = 3;
      return;
    }
    // Swim in from off screen toward the middle of the trench, on the side away from the humpback if it's about.
    let away = Math.sign(cx - home.x) || 1;
    if (humpback.userData.active && Math.abs(humpback.position.x - cx) < 80) away = Math.sign(cx - humpback.position.x) || away;
    const z = rand(SPERM_Z[0], SPERM_Z[1]);
    const x = cx + away * (halfWidthAt(z, aspect) + SPERM_LENGTH * 0.6);
    if (deepBelow(x) < 60) {
      u.wait = 3;
      return;
    }
    u.active = true;
    u.t = 0;
    u.dir = -away;
    u.rising = Math.random() < 0.5;
    u.pitch = u.rising ? 0.5 : 0;
    u.levelAt = 0;
    u.diveFrom = null;
    const lowest = floorY(x) + 16;
    whale.position.set(x, Math.max(lowest, u.rising ? cy - rand(26, 32) : cy + rand(-2, 4)), z);
  }
  u.t += dt;
  strokeSpermWhale(u, u.t);
  const p = whale.position;
  const ahead = floorY(p.x + u.dir * SPERM_LENGTH * 0.8);
  const wallAhead = ahead > p.y - 10;
  if (u.rising && !u.levelAt && (p.y > cy - 3 || u.t > 12 || wallAhead)) u.levelAt = u.t;
  let want;
  if (u.rising) want = !u.levelAt ? 0.5 : (u.t - u.levelAt < 3.5 ? 0 : -0.9);
  else want = u.t < 6 ? 0 : -0.9;
  u.pitch += (want - u.pitch) * (1 - Math.exp(-dt * 0.5));
  const diving = u.pitch < -0.2;
  if (diving && u.diveFrom === null) u.diveFrom = p.y;
  const speed = 4 + (diving ? Math.min(2.5, (-u.pitch - 0.2) * 3) : 0);
  p.x += Math.cos(u.pitch) * u.dir * speed * dt;
  p.y += Math.sin(u.pitch) * speed * dt;
  whale.rotation.set(0, u.dir > 0 ? 0 : Math.PI, u.pitch);
  // Faint when it first comes up out of the dark, and gone again as it dives, nears a wall or nears the floor.
  const arrive = THREE.MathUtils.smoothstep(u.t, 0, 4);
  const sunk = u.diveFrom === null ? 0 : THREE.MathUtils.smoothstep(u.diveFrom - p.y, 4, 22);
  const nearFloor = 1 - THREE.MathUtils.smoothstep(p.y - Math.max(ahead, floorY(p.x)), 5, 14);
  u.wall = Math.max(u.wall ?? 0, wallAhead ? 1 : 0) * (wallAhead ? 1 : 0.99);
  const hide = Math.max(sunk, nearFloor, u.wall);
  u.haze.value = THREE.MathUtils.lerp(1, 0.5, arrive * (1 - hide));
  whale.visible = u.haze.value < 0.995;
  if ((u.t > 2 && hide > 0.99) || Math.abs(p.x - cx) > 130 || u.t > 40) {
    u.active = false;
    u.wall = 0;
    u.wait = rand(SPERM_GAP[0], SPERM_GAP[1]);
  }
}

// A pod of dolphins sometimes races past just under the surface while the sub is up there, gone once off screen.
// They porpoise in long arcs with their noses following the curve, and now and then one leaps clear of the water.
const POD_SIZE = 5;
const DOLPHIN_LENGTH = 5.2;
const POD_GAP = [25, 45];
const DOLPHIN_SPEED = 7.2;
// The same pull the sub feels when it breaches; water slows a dolphin quickly once it is back in.
const LEAP_GRAVITY = 18;
const WATER_DRAG = 3.5;
const LEAP_SPACING = 0.9;
const DOLPHIN_BEAT_RATE = 9;
const DOLPHIN_LANES = [-10, -12.1, -14.2, -16.3, -18.4];

function makeDolphins(scene) {
  const pod = Array.from({ length: POD_SIZE }, () => {
    const d = spawn('dolphin');
    d.scale.setScalar(DOLPHIN_LENGTH);
    d.visible = false;
    // Each dolphin gets its own materials so its tail can rest while it is airborne and keep its own timing.
    // Each beats at its own slightly different pace, so the pod never strokes in step.
    const controls = { beat: { value: 1 }, phase: { value: rand(0, Math.PI * 2) }, arch: { value: 0 },
      rate: { value: DOLPHIN_BEAT_RATE * rand(0.86, 1.14) } };
    d.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      addTailBeat(o.material, { rate: DOLPHIN_BEAT_RATE, amount: 0.2, front: 0.32, controls });
      addWaterline(o.material, { ripple: 0.85, topOnly: true });
      // A little extra water haze, so the pod sits back in the blue.
      o.material.defines = { ...o.material.defines, FOG_MIN: '0.2' };
    });
    d.userData.controls = controls;
    scene.add(d);
    return d;
  });
  return { pod, active: false, wait: 20, dir: 1, members: [] };
}

function updateDolphins(world, dt, t, cx, cy, halfW, sub) {
  const dolphins = world.dolphins;
  const near = sub && sub.y > SURFACE_Y - 12 && cy > SURFACE_Y - 22;
  if (!dolphins.active) {
    for (const d of dolphins.pod) d.visible = false;
    dolphins.wait -= dt;
    if (dolphins.wait > 0 || !near) return;
    dolphins.active = true;
    dolphins.dir = Math.random() < 0.5 ? -1 : 1;
    // Each swims in its own depth lane, far enough apart that they never pass through each other.
    const lanes = DOLPHIN_LANES.slice().sort(() => Math.random() - 0.5);
    dolphins.members = dolphins.pod.map((d, i) => ({
      d, x: cx - dolphins.dir * (halfW + 8 + i * 3.6 + rand(0, 2)), base: SURFACE_Y - rand(3, 4.2), z: lanes[i],
      phase: rand(0, Math.PI * 2), wobble: rand(0, 6.3), rate: rand(1.5, 1.9), amp: rand(0.07, 0.11), leap: null, nextLeap: rand(1, 6),
    }));
  }
  let anyInView = false;
  for (const m of dolphins.members) {
    m.x += dolphins.dir * DOLPHIN_SPEED * dt;
    let y;
    let vy;
    if (m.leap) {
      // Surge up through the water to launch speed, then fly ballistically out and back in, nose following the arc.
      const inAir = m.leap.y > SURFACE_Y;
      if (m.leap.launch && !inAir) {
        m.leap.vy += (m.leap.target - m.leap.vy) * (1 - Math.exp(-dt * 7));
      } else if (inAir) {
        m.leap.launch = false;
        m.leap.vy -= LEAP_GRAVITY * dt;
      } else {
        // Back in the water: drag soaks up the dive and buoyancy roughly cancels gravity.
        m.leap.vy *= Math.exp(-dt * WATER_DRAG);
      }
      const wasAbove = m.leap.y > SURFACE_Y;
      m.leap.y += m.leap.vy * dt;
      y = m.leap.y;
      vy = m.leap.vy;
      if (wasAbove && y <= SURFACE_Y) world.effects?.bigSplash({ x: m.x, y: SURFACE_Y, z: m.z }, 1.25, 1.4);
      else if (!wasAbove && y > SURFACE_Y) world.effects?.splash({ x: m.x, y: SURFACE_Y, z: m.z }, 0.8);
      if (!m.leap.launch && y <= SURFACE_Y && (y < m.base || vy > -1.2)) {
        // Hand back to swimming without a jump: whatever gap is left between here and the swim arc becomes an
        // offset that eases away, carrying the dive's downward speed with it.
        m.leap = null;
        m.phase = Math.PI - t * m.rate;
        const a = t * m.rate + m.phase;
        m.offset = y - (m.base + Math.sin(a) * m.amp);
        m.offsetVel = vy - Math.cos(a) * m.amp * m.rate;
        m.nextLeap = rand(3.5, 8);
      }
    } else {
      const a = t * m.rate + m.phase;
      // The landing offset settles like a damped spring, so position and speed both flow on smoothly.
      if (m.offset) {
        m.offsetVel += (-m.offset * 6 - m.offsetVel * 4.5) * dt;
        m.offset += m.offsetVel * dt;
        if (Math.abs(m.offset) < 0.002 && Math.abs(m.offsetVel) < 0.01) m.offset = 0;
      }
      y = m.base + Math.sin(a) * m.amp + (m.offset || 0);
      vy = Math.cos(a) * m.amp * m.rate + (m.offset ? m.offsetVel : 0);
      m.nextLeap -= dt;
      // Leap from the top of a rising arc.
      // Launch hard enough to clear the surface by a few metres (rise = vy² / 2g), never two at once.
      const clear = t - (dolphins.lastLeap ?? -10) > LEAP_SPACING;
      if (m.nextLeap <= 0 && clear && vy > 0.05 && Math.sin(a) > 0.2) {
        // Clears the surface by rise = vy² / 2g, roughly 3 to 5 units.
        m.leap = { y, vy, target: rand(12.5, 14.5), launch: true };
        dolphins.lastLeap = t;
      }
    }
    m.d.position.set(m.x, y, m.z);
    // In the air the tail rests and the body bows into an arch. Back under the surface it straightens and starts
    // stroking again straight away, the first stroke swinging the tail up against the dive's curve.
    const ctl = m.d.userData.controls;
    const flying = m.leap && y > SURFACE_Y - 0.3 ? 1 : 0;
    if (m.flying && !flying) {
      const tailUp = Math.PI / 2 + 1.2 + rand(-0.5, 0.5) - SHADER_TIME.value * ctl.rate.value;
      ctl.phase.value = ((tailUp % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    }
    // A slow wander in each one's rhythm keeps the strokes from ever lining up.
    ctl.phase.value += Math.sin(t * 0.37 + m.wobble) * 0.35 * dt;
    m.flying = flying;
    ctl.beat.value += (1 - flying - ctl.beat.value) * (1 - Math.exp(-dt * (flying ? 8 : 12)));
    ctl.arch.value += (flying - ctl.arch.value) * (1 - Math.exp(-dt * (flying ? 4 : 9)));
    // Ease the nose toward the direction of travel, so launching into or landing from a leap doesn't jerk it.
    const pitch = Math.atan2(vy, DOLPHIN_SPEED);
    const follow = m.leap && y > SURFACE_Y - 1 ? 14 : 5;
    m.pitch = m.pitch === undefined ? pitch : m.pitch + (pitch - m.pitch) * (1 - Math.exp(-dt * follow));
    m.d.rotation.set(0, dolphins.dir > 0 ? 0 : Math.PI, m.pitch);
    m.d.visible = true;
    if (dolphins.dir * (m.x - cx) < halfW + 12) anyInView = true;
  }
  if (!anyInView) {
    dolphins.active = false;
    dolphins.wait = rand(POD_GAP[0], POD_GAP[1]);
    for (const d of dolphins.pod) d.visible = false;
  }
}

// Now and then a marlin cruises across the open blue above a trench, near the surface: in from one side of the
// screen, out the other, then gone. Its depth and pace drift gently so it never moves in a straight mechanical line.
const MARLIN_LENGTH = 6.5;
const MARLIN_BAND = [SURFACE_Y - 16, SURFACE_Y - 5];
const MARLIN_SPEED = 5.5;
const MARLIN_GAP = [12, 25];

function makeMarlin(scene) {
  const fish = spawn('marlin');
  fish.scale.setScalar(MARLIN_LENGTH);
  fish.rotation.order = 'YXZ';
  // The stroke is driven from here: rate stays 0 in the shader and the phase advances with the fish's speed, so a
  // change of pace never makes the tail jump.
  const controls = { beat: { value: 1 }, phase: { value: 0 }, arch: { value: 0 }, rate: { value: 0 } };
  fish.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    addTailBeat(o.material, { amount: 0.07, front: 0.15, sideways: true, controls });
    addWaterline(o.material, { ripple: 0.85, topOnly: true });
  });
  fish.visible = false;
  fish.userData = { controls, active: false, wait: rand(6, 14) };
  scene.add(fish);
  return fish;
}

function updateMarlin(fish, dt, t, cx, cy, halfW) {
  const u = fish.userData;
  const open = cy > SURFACE_Y - 40;
  if (!u.active) {
    fish.visible = false;
    u.wait -= dt;
    if (u.wait > 0 || !open || deepBelow(cx) < 60) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = cx + side * (halfW + MARLIN_LENGTH);
    if (deepBelow(x) < 50) {
      u.wait = 2;
      return;
    }
    u.active = true;
    u.dir = -side;
    u.base = rand(MARLIN_BAND[0], MARLIN_BAND[1]);
    u.seed = rand(0, 100);
    u.pitch = 0;
    fish.position.set(x, u.base, rand(-24, -10));
  }
  const p = fish.position;
  // Smooth wandering: depth and pace follow slow overlapping waves.
  const speed = MARLIN_SPEED * (1 + 0.18 * Math.sin(t * 0.5 + u.seed) + 0.08 * Math.sin(t * 1.3 + u.seed * 2));
  const y = u.base + 2.2 * Math.sin(t * 0.33 + u.seed) + 0.8 * Math.sin(t * 0.81 + u.seed * 3);
  const vy = (y - p.y) / Math.max(dt, 1e-3);
  p.x += u.dir * speed * dt;
  p.y = y;
  p.z += Math.sin(t * 0.4 + u.seed) * 0.6 * dt;
  u.pitch += (Math.atan2(vy, speed) - u.pitch) * (1 - Math.exp(-dt * 3));
  const yaw = (u.dir > 0 ? 0 : Math.PI) + Math.sin(t * 0.4 + u.seed) * 0.08;
  fish.rotation.set(Math.sin(t * 0.7 + u.seed) * 0.05, yaw, u.pitch);
  u.controls.phase.value += (6 + speed * 0.35) * dt;
  fish.visible = true;
  if ((p.x - cx) * u.dir > halfW + MARLIN_LENGTH * 1.2 || !open) {
    u.active = false;
    u.wait = rand(MARLIN_GAP[0], MARLIN_GAP[1]);
  }
}

// Jellies gather in one glowing layer in the dark trenches, with a few stragglers drifting deeper.
const JELLY_CEILING = 96;
const JELLY_LAYER = [-122, -100];
// Stragglers stay well above the anglerfish prowling just over the deepest trench floor.
const JELLY_DEEP = [-150, -128];
const JELLY_STRAGGLERS = 3;
const JELLY_COLORS = ['#ff5fd2', '#5fe8ff', '#b47bff', '#7dffb4', '#ffb35f'];

// Jelly flesh: see-through in the middle, glowing at the silhouette, with tentacles rippling down their length.
function jellyMaterial(base, color, uniforms, wave, ribbon = false) {
  const m = base.clone();
  m.color = color.clone();
  m.emissive = color.clone();
  m.emissiveIntensity = base.emissiveIntensity;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vJellyPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvJellyPos = position;');
    if (wave) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
          float hang = max( 0.0, - transformed.y );
          float seed = modelMatrix[ 3 ].x * 0.7 + modelMatrix[ 3 ].y * 0.3;
          transformed.x += sin( uTime * 1.7 + hang * 1.9 + seed ) * 0.07 * hang;
          transformed.z += cos( uTime * 1.3 + hang * 1.6 + seed ) * 0.05 * hang;`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vJellyPos;\n${NOISE_GLSL}`)
      .replace('#include <opaque_fragment>', /* glsl */ `
      float jellyRim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 2.0 );
      diffuseColor.a = clamp( diffuseColor.a * 0.6 + jellyRim * 0.7, 0.0, 1.0 );
      outgoingLight += emissive * jellyRim * 1.5;
      ${ribbon ? `
      float frill = dNoise( vJellyPos * vec3( 16.0, 4.0, 16.0 ) ) * 0.6 + dNoise( vJellyPos * 40.0 ) * 0.4;
      float veins = smoothstep( 0.42, 0.5, abs( fract( vJellyPos.y * 7.0 + frill * 1.5 ) - 0.5 ) );
      diffuseColor.a *= 0.45 + 0.65 * frill;
      outgoingLight *= 0.65 + 0.7 * frill + veins * 0.5;` : ''}
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `jelly-${wave}-${ribbon}`;
  return m;
}

function makeJelly(uniforms) {
  const jelly = spawn('deep_jelly');
  const color = new THREE.Color(pick(JELLY_COLORS));
  const glows = [];
  jelly.traverse((o) => {
    if (!o.isMesh) return;
    const ribbon = o.name.startsWith('jelly_arms');
    const wave = ribbon || o.name.startsWith('jelly_tentacles');
    o.material = jellyMaterial(o.material, color, uniforms, wave, ribbon);
    glows.push({ m: o.material, base: o.material.emissiveIntensity, color: o.material.color.clone() });
  });
  jelly.scale.setScalar(rand(1.0, 2.0));
  jelly.userData = {
    bell: findNode(jelly, 'jelly_bell'), phase: rand(0, 6), drift: rand(0.2, 0.5), glows, glow: 0,
    state: 'dormant', timer: 0, lit: false, awake: 0,
  };
  setJellyGlow(jelly, 0);
  return jelly;
}

const JELLY_DIM = 0.03;
const JELLY_WAKE_RADIUS = 9;

function setJellyGlow(jelly, g) {
  for (const { m, base, color } of jelly.userData.glows) {
    m.emissiveIntensity = base * (JELLY_DIM + g * (1 - JELLY_DIM));
    m.color.copy(color).multiplyScalar(0.25 + 0.75 * g);
  }
}

// Jellies sit dark until the sub swims by, then glow in slow, steady on-off spells on their own timing.
function updateJellyGlow(jelly, dt, sub) {
  const u = jelly.userData;
  const near = sub && jelly.position.distanceTo(sub) < JELLY_WAKE_RADIUS * jelly.scale.x * 0.7 + 4;
  if (u.state === 'dormant') {
    if (near) {
      u.state = 'waking';
      u.timer = rand(0.2, 1.4);
    }
  } else {
    u.timer -= dt;
    if (u.state === 'awake') u.awake -= dt;
    if (u.timer <= 0) {
      if (u.state === 'waking') {
        u.state = 'awake';
        u.awake = rand(9, 16);
        u.lit = true;
        u.timer = rand(1.8, 3.2);
      } else if (u.awake <= 0 && !u.lit) {
        u.state = near ? 'waking' : 'dormant';
        u.timer = rand(1.5, 3);
      } else {
        u.lit = !u.lit;
        u.timer = u.lit ? rand(1.8, 3.2) : rand(1.2, 2.6);
      }
    }
  }
  const target = u.state === 'awake' && u.lit ? 1 : 0;
  u.glow += THREE.MathUtils.clamp(target - u.glow, -dt * 1.4, dt * 1.4);
  setJellyGlow(jelly, u.glow * u.glow * (3 - 2 * u.glow));
}


// Bake a cluster of placed models into one mesh per material, anchored at the cluster's lowest point.
function mergeCluster(pieces) {
  pieces.updateMatrixWorld(true);
  let base = Infinity;
  for (const p of pieces.children) base = Math.min(base, p.position.y);
  const toLocal = new THREE.Matrix4().makeTranslation(0, -base, 0);
  const buckets = new Map();
  for (const piece of pieces.children) {
    piece.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(toLocal.clone().multiply(o.matrixWorld));
      // Swaying plants bend from their own root, so each remembers where its base sits within the cluster.
      if (CURRENT_MATERIALS.has(o.material.name)) {
        const count = geo.attributes.position.count;
        geo.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(count).fill(piece.position.y - base), 1));
      }
      const key = `${o.material.uuid}|${Object.keys(geo.attributes).sort().join(',')}`;
      if (!buckets.has(key)) buckets.set(key, { material: o.material, order: o.renderOrder, geos: [] });
      buckets.get(key).geos.push(geo);
    });
  }
  const cluster = new THREE.Group();
  cluster.position.y = base;
  for (const { material, order, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = order;
    cluster.add(mesh);
  }
  return cluster;
}

function wrap(value, center, half) {
  const span = half * 2;
  return center + ((((value - center + half) % span) + span) % span) - half;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.aspect = 1.5;
    this.time = 0;
    this.uniforms = { uTime: { value: 0 } };
    this.dark = 0;

    this.backdrop = makeBackdrop();
    scene.add(this.backdrop);
    this.rays = makeRays();
    for (const ray of this.rays) scene.add(ray);
    this.surface = makeSurface();
    scene.add(this.surface);
    this.waterline = makeWaterline();
    scene.add(this.waterline);

    const seabedMat = makeSeabedMaterial(this.uniforms);
    this.tiles = [0, 1, 2, 3, 4].map(() => {
      const tile = makeSeabedTile(seabedMat);
      scene.add(tile);
      return tile;
    });

    this.dust = makeDust();
    scene.add(this.dust);

    this.props = [];
    for (const layer of LAYERS) this.populate(layer);
    this.clusters = new Map();
    this.chains = [];
    for (let x = -70; x < 70; x += rand(10, 22)) this.spawnChain(x);
    this.makeFish();

    // One shared light for whichever anglerfish is flashing, so lures can reveal their owner without adding a light per fish.
    this.anglerLight = new THREE.PointLight('#9ff8ea', 0, 9, 1.6);
    this.anglerLight.userData.owner = null;
    scene.add(this.anglerLight);
    this.gulls = Array.from({ length: GULL_COUNT }, () => {
      const gull = makeGull();
      this.landGull(gull, rand(-40, 40));
      scene.add(gull);
      return gull;
    });
    this.whale = makeWhale();
    scene.add(this.whale);
    this.spermWhale = makeSpermWhale();
    scene.add(this.spermWhale);
    this.dolphins = makeDolphins(scene);
    this.marlin = makeMarlin(scene);
    this.anglers = Array.from({ length: 3 }, (_, i) => {
      const a = makeAngler();
      a.position.set(-36 + i * 36 + rand(-5, 5), -200, rand(-20, -4));
      a.position.y = floorY(a.position.x) + rand(ANGLER_BAND[0], ANGLER_BAND[1]);
      scene.add(a);
      return a;
    });
    this.jellies = Array.from({ length: 18 }, (_, i) => {
      const j = makeJelly(this.uniforms);
      j.userData.band = i < JELLY_STRAGGLERS ? JELLY_DEEP : JELLY_LAYER;
      j.position.set(rand(-40, 40), rand(...j.userData.band), rand(-25, -2));
      scene.add(j);
      return j;
    });
    this.wrecks = WRECKS.map((w) => {
      const wreck = spawn('wreck_sub');
      wreck.position.set(w.x, seabedAt(w.x, w.z) + 1.0, w.z);
      wreck.rotation.set(0, w.yaw, w.roll);
      scene.add(wreck);
      return wreck;
    });
  }

  setAspect(aspect) {
    this.aspect = aspect;
  }

  landGull(gull, x) {
    const u = gull.userData;
    u.state = 'float';
    u.dir = Math.random() < 0.5 ? -1 : 1;
    u.t = 0;
    gull.position.set(x, SURFACE_Y, rand(-0.5, 0.5));
    gull.rotation.set(0, u.dir > 0 ? 0 : Math.PI, 0);
    playGull(gull, 'idle', 0);
    u.current.time = rand(0, u.current.getClip().duration);
  }

  // Returns how many gulls just took off, so the game can play one cry for the flock.
  updateGulls(dt, cx, cy, hull) {
    let scared = 0;
    const sub = hull?.center;
    const visible = Math.abs(cy - SURFACE_Y) < 30;
    for (const gull of this.gulls) {
      const u = gull.userData;
      gull.visible = visible;
      u.t += dt;
      if (visible) u.mixer.update(dt);
      if (u.state === 'float') {
        if (visible) treadWater(u, this.time);
        gull.position.y = SURFACE_Y - 0.02 + Math.sin(this.time * 1.4 + gull.position.x * 0.5) * 0.09;
        const gap = sub && sub.y > SURFACE_Y - 7 ? Math.abs(sub.x - gull.position.x) : Infinity;
        const eta = sub ? arrivalTime(gull, sub, hull.vel) : Infinity;
        // A gull grows uneasy as the sub nears and paddles away faster; the closer the sub gets before it bolts,
        // the more frantic the escape. A sub racing in sets it off early enough to be airborne before it arrives.
        const alarm = Math.max(1 - THREE.MathUtils.smoothstep(gap, GULL_SCARE * u.nerve, GULL_WARY),
          1 - THREE.MathUtils.smoothstep(eta, GULL_TAKEOFF_TIME, GULL_TAKEOFF_TIME * 2.5));
        if (alarm > 0) {
          u.dir = Math.sign(gull.position.x - sub.x) || 1;
          gull.rotation.y = u.dir > 0 ? 0 : Math.PI;
        }
        gull.rotation.z = Math.sin(this.time * (1.1 + 9 * alarm) + u.phase) * (0.06 + 0.1 * alarm);
        gull.position.x += u.dir * (0.08 + 1.6 * alarm) * dt;
        if (gap < GULL_SCARE * u.nerve || eta < GULL_TAKEOFF_TIME) {
          u.state = 'takeoff';
          u.t = 0;
          const urgency = Math.max(1 - gap / GULL_SCARE, 1 - eta / GULL_TAKEOFF_TIME);
          u.panic = 1.5 + 1.3 * THREE.MathUtils.clamp(urgency, 0, 1);
          u.actions.takeoff.timeScale = u.panic;
          u.actions.fly.timeScale = 1 + 0.45 * u.panic;
          playGull(gull, 'takeoff', 0.1);
          scared++;
        }
        const wrapped = wrap(gull.position.x, cx, 45);
        if (Math.abs(wrapped - gull.position.x) > 1) this.landGull(gull, wrapped);
      } else {
        // Matches the takeoff in the animation: a short run along the water, then a climb into steady flight.
        const tt = u.t * u.panic;
        const run = THREE.MathUtils.smoothstep(tt, 0.9, 2.2);
        const climb = THREE.MathUtils.smoothstep(tt, 1.3, 2.4);
        const flutter = Math.sin(u.t * 11 + u.phase);
        u.vel.set(u.dir * (0.6 + 4.6 * run) * u.panic, (3.4 * climb + 1.4 * flutter * climb) * u.panic);
        gull.position.x += u.vel.x * dt;
        gull.position.y = Math.max(SURFACE_Y - 0.02, gull.position.y + u.vel.y * dt);
        gull.rotation.z = u.dir * THREE.MathUtils.lerp(0, 0.3, climb) + 0.16 * flutter * (1 - 0.5 * climb);
        if (u.state === 'takeoff' && tt > 3.6) {
          u.state = 'fly';
          playGull(gull, 'fly', 0.4);
        }
        if (gull.position.y > SURFACE_Y + 24 || Math.abs(gull.position.x - cx) > 60) {
          this.landGull(gull, cx + (Math.random() < 0.5 ? -1 : 1) * rand(32, 44));
        }
      }
      if (sub) keepClear(gull, sub, hull.extents, u.state === 'float');
    }
    return scared;
  }

  placeProp(prop, x) {
    const { layer } = prop;
    const deep = floorY(x) < SHELF_Y - 4;
    const murk = deep ? 0 : murkAt(x);
    const want = deep ? 'deep' : murk > 0.35 ? 'murk' : 'clear';
    if (prop.kind !== want) {
      if (prop.obj) this.scene.remove(prop.obj);
      const name = chooseProp(layer, want, murk);
      prop.obj = spawn(name);
      prop.obj.userData.model = name;
      if (layer.plain) plainMaterials(prop.obj);
      if (layer.tint) tint(prop.obj, layer.tint[0], layer.tint[1]);
      else if (deep) tint(prop.obj, '#1c2233', 0.45);
      prop.obj.scale.setScalar(rand(layer.scale[0], layer.scale[1]));
      prop.kind = want;
      this.scene.add(prop.obj);
    }
    const z = rand(layer.z[0], layer.z[1]);
    // Seat the prop at the lowest ground under its footprint so slopes never leave it hanging.
    const half = 1.2 * prop.obj.scale.x;
    let ground = Infinity;
    for (let i = -2; i <= 2; i++) {
      for (const dz of [-half, 0, half]) ground = Math.min(ground, seabedAt(x + (i * half) / 2, z + dz));
    }
    prop.obj.position.set(x, ground - 0.25, z);
    prop.obj.visible = !SHELF_ONLY.test(prop.obj.userData.model) || onFlatShelf(x);
    prop.obj.rotation.set(0, rand(-0.5, 0.5), 0);
    if (prop.obj.userData.model === 'anchor') settleAnchor(prop.obj);
  }

  populate(layer) {
    layer.half = halfWidthAt(layer.z[0], 2.4) + 10;
    for (let x = -layer.half; x < layer.half; x += rand(layer.gap[0], layer.gap[1])) {
      const prop = { layer, obj: null, kind: null };
      this.placeProp(prop, x);
      this.props.push(prop);
    }
  }

  // Chains hang from mooring buoys bobbing at the waterline.
  // The depth behind the play plane where a wreck of this size can rest at x without overlapping anything.
  clearSpot(x, halfLength, halfWidth, preferred, extra = []) {
    const blockers = [...extra];
    for (const prop of this.props) {
      const name = prop.obj.userData.model;
      blockers.push({ x: prop.obj.position.x, z: prop.obj.position.z, r: (FOOTPRINT[name] ?? 1.2) * prop.obj.scale.x });
    }
    for (const objs of this.clusters.values()) blockers.push(...(objs.footprints ?? []));
    const clear = (z) => blockers.every((b) => {
      const dx = Math.max(0, Math.abs(b.x - x) - halfLength);
      const dz = Math.max(0, Math.abs(b.z - z) - halfWidth);
      return dx * dx + dz * dz > b.r * b.r;
    });
    for (let step = 0; step <= 40; step++) {
      for (const dir of step ? [1, -1] : [0]) {
        const z = preferred + dir * step * 0.4;
        if (z <= 3 && z >= -15 && clear(z)) return z;
      }
    }
    return Math.min(3, preferred + 6);
  }

  // Reefs and kelp forests come in fixed clusters per stretch of seafloor, spawned as the stretch scrolls into view.
  updateClusters(cx) {
    const span = halfWidthAt(-16, this.aspect) + MOUND_CELL;
    const lo = Math.floor((cx - span) / MOUND_CELL);
    const hi = Math.floor((cx + span) / MOUND_CELL);
    for (const [cell, objs] of this.clusters) {
      if (cell >= lo && cell <= hi) continue;
      for (const o of objs) {
        this.scene.remove(o);
        o.traverse((m) => m.isMesh && m.geometry.dispose());
      }
      this.clusters.delete(cell);
    }
    for (let cell = lo; cell <= hi; cell++) {
      if (!this.clusters.has(cell)) {
        const objs = this.buildCluster(moundOf(cell));
        for (const o of objs) this.scene.add(o);
        this.clusters.set(cell, objs);
      }
    }
  }

  buildCluster(m) {
    let seed = m.cell * 9.13 + 1;
    const r = () => {
      seed += 1;
      return hash(seed, 7);
    };
    const pieces = new THREE.Group();
    const footprints = [];
    const place = (name, x, z, scale) => {
      if (SHELF_ONLY.test(name) && !onFlatShelf(x)) return;
      footprints.push({ x, z, r: (FOOTPRINT[name] ?? 1) * scale });
      const obj = spawn(name);
      obj.scale.setScalar(scale);
      obj.position.set(x, seabedAt(x, z) - 0.2, z);
      obj.rotation.y = r() * Math.PI * 2;
      pieces.add(obj);
    };
    const deep = floorY(m.x) < SHELF_Y - 6;
    if (deep) {
      for (let i = 0; i < 2; i++) place(r() < 0.5 ? 'rock_a' : 'rock_b', m.x + (r() - 0.5) * 8, -6 - r() * 8, 0.8 + r() * 0.6);
      return Object.assign([mergeCluster(pieces)], { footprints });
    }
    if (m.reef) {
      // Reefs near the middle of the shelf are bigger, denser and spread wide enough to run into their neighbours.
      const spread = 1 + 1.3 * m.centre;
      place('reef_large', m.x, MOUND_Z, 1.5 + r() * 0.5);
      for (let i = 0, rocks = 2 + Math.round(4 * m.centre); i < rocks; i++) {
        place(r() < 0.5 ? 'reef_small' : 'reef_large', m.x + (r() - 0.5) * m.width * 1.4 * spread,
          MOUND_Z + 1 + (r() - 0.5) * 5 * Math.sqrt(spread), 1.1 + r() * 0.5);
      }
      const corals = Math.round(14 + 12 * reefAt(m.x) + r() * 5);
      for (let i = 0; i < corals; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * m.width * 0.95 * spread;
        place(CORALS[Math.floor(r() * CORALS.length)], m.x + Math.cos(a) * d, MOUND_Z + 1 + Math.sin(a) * d * 0.7,
          1.0 + r() * 0.7);
      }
    } else if (m.murk > 0.5) {
      // Out in the murk: dense kelp forests, thickest nearest the cliffs.
      const stalks = 14 + Math.floor(r() * 6 + m.murk * 10);
      for (let i = 0; i < stalks; i++) {
        place(r() < 0.7 ? 'kelp_tall' : 'kelp_short', m.x + (r() - 0.5) * 20, MOUND_Z + (r() - 0.5) * 16,
          0.85 + r() * 0.5);
      }
      place(r() < 0.5 ? 'rock_a' : 'rock_b', m.x + (r() - 0.5) * 6, MOUND_Z, 0.7 + r() * 0.5);
    } else {
      // The band of clean sand between the reef and the murk: just the odd rock.
      if (r() < 0.6) place(r() < 0.5 ? 'rock_a' : 'rock_b', m.x + (r() - 0.5) * 6, MOUND_Z, 0.6 + r() * 0.5);
    }
    return Object.assign([mergeCluster(pieces)], { footprints });
  }

  spawnChain(x) {
    const group = new THREE.Group();
    const links = 7;
    for (let i = 1; i <= links; i++) {
      const link = spawn('chain');
      link.position.y = -i * 5.04;
      group.add(link);
    }
    const buoy = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#c8352b', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.6 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), red);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.93, 0.4, 20), white);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16), red);
    ring.position.y = -0.95;
    buoy.add(ball, band, ring);
    group.add(buoy);
    group.position.set(x, SURFACE_Y - 0.4, rand(CHAIN_Z[0], CHAIN_Z[1]));
    group.rotation.z = rand(-0.08, 0.08);
    group.userData.swing = rand(0, 6);
    this.scene.add(group);
    this.chains.push(group);
  }

  makeFish() {
    const geo = makeFishGeometry();
    const mat = new THREE.MeshBasicMaterial({ color: '#0d3d5e', side: THREE.DoubleSide });
    this.schools = [];
    for (let s = 0; s < 6; s++) {
      const count = 14;
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.frustumCulled = false;
      const school = { mesh, offsets: [], dir: Math.random() < 0.5 ? -1 : 1 };
      for (let i = 0; i < count; i++) school.offsets.push(new THREE.Vector3(rand(-3, 3), rand(-1.2, 1.2), rand(-2, 2)));
      school.z = rand(-55, -25);
      school.x = rand(-40, 40);
      school.y = rand(SHELF_Y + 4, SURFACE_Y - 3);
      school.speed = rand(1.5, 3);
      this.scene.add(mesh);
      this.schools.push(school);
    }
  }

  update(dt, camera, sub = null, hull = null) {
    this.time += dt;
    const cx = camera.position.x;
    const cy = camera.position.y;
    if (this.updateGulls(dt, cx, cy, hull) > 0) sfx.gull();
    updateWhale(this.whale, dt, this.time, cx, cy, this.aspect, this.calm ?? true);
    updateSpermWhale(this.spermWhale, dt, cx, cy, this.whale, this.aspect);
    updateDolphins(this, dt, this.time, cx, cy, halfWidthAt(-10, this.aspect), sub);
    updateMarlin(this.marlin, dt, this.time, cx, cy, halfWidthAt(-18, this.aspect));
    const t = this.time;
    this.uniforms.uTime.value = t;
    const shift = depthShift(cy);
    this.dark = darkness(cy);
    const bu = this.backdrop.material.uniforms;
    bu.uShift.value = shift;
    bu.uDark.value = this.dark;
    // A free camera can swing behind the play plane; the horizon maths needs a positive distance.
    bu.uLine.value = 0.5 + 0.5 * (SURFACE_Y - cy) / (Math.max(camera.position.z, 2) * TAN_HALF_FOV);
    this.scene.fog.color.setRGB(shift, this.dark, 0);
    // The play area sits about 20 units from the camera; fog starts behind it so darkness in the depths comes from
    // missing light, and whatever a lamp hits still shows.
    this.scene.fog.near = THREE.MathUtils.lerp(20, 19, this.dark);
    this.scene.fog.far = THREE.MathUtils.lerp(125, 42, this.dark);
    this.surface.material.uniforms.uTime.value = t;
    this.surface.position.x = cx;
    this.waterline.material.uniforms.uTime.value = t;
    this.waterline.position.x = cx;
    const parallax = (camera.position.z - WATERLINE_Z) / camera.position.z;
    this.waterline.scale.setScalar(parallax);
    this.waterline.position.y = cy + (SURFACE_Y - cy) * parallax - 0.2 * parallax;

    const base = Math.floor(cx / TILE_W);
    // Keep tiles already sitting at a needed spot; only the tile that falls off one end moves to the other.
    const wanted = [-2, -1, 0, 1, 2].map((i) => (base + i) * TILE_W);
    const free = this.tiles.filter((tile) => !wanted.includes(tile.userData.x0));
    for (const x of wanted) {
      if (!this.tiles.some((tile) => tile.userData.x0 === x)) free.shift().userData.pending = x;
    }
    for (const tile of this.tiles) {
      const target = tile.userData.pending ?? tile.userData.x0;
      const near = Math.abs(target - base * TILE_W) <= TILE_W || tile.userData.x0 === undefined;
      shapeTile(tile, target, near ? Infinity : 2500);
      if (tile.userData.next === null) tile.userData.pending = undefined;
    }

    for (const ray of this.rays) {
      ray.material.uniforms.uTime.value = t;
      ray.material.uniforms.uStrength.value = ray.userData.strength * (1 - this.dark);
      ray.position.x = wrap(ray.position.x, cx, halfWidthAt(ray.position.z, this.aspect) + 10);
    }

    for (const prop of this.props) {
      const half = prop.layer.half;
      const x = prop.obj.position.x;
      if (x < cx - half || x > cx + half) this.placeProp(prop, wrap(x, cx, half));
    }
    this.updateClusters(cx);

    for (const chain of this.chains) {
      chain.rotation.z = Math.sin(t * 0.4 + chain.userData.swing) * 0.03;
      chain.position.y = SURFACE_Y - 0.4 + Math.sin(t * 1.3 + chain.userData.swing) * 0.12;
      chain.position.x = wrap(chain.position.x, cx, 70);
      // Moorings only reach the shelf floor, so there are none over the trenches.
      chain.visible = floorY(chain.position.x) > SHELF_Y - 3;
    }

    const dpos = this.dust.geometry.attributes.position;
    for (let i = 0; i < dpos.count; i++) {
      const x = wrap(dpos.getX(i) - dt * 0.2, cx, 40);
      const y = wrap(dpos.getY(i) + Math.sin(t * 0.5 + i) * dt * 0.15, cy, 14);
      dpos.setXY(i, x, y);
    }
    dpos.needsUpdate = true;
    this.dust.material.color.set('#bff4ff').lerp(new THREE.Color('#5dffd8'), this.dark).multiplyScalar(1 + this.dark * 0.6);
    this.dust.material.size = 0.12 + this.dark * 0.1;

    for (const j of this.jellies) {
      const u = j.userData;
      const pulse = Math.sin(t * 1.8 + u.phase);
      u.bell.scale.set(1 + pulse * 0.1, 1 - pulse * 0.12, 1 + pulse * 0.1);
      j.position.y += (u.drift + Math.max(0, pulse) * 0.6) * dt;
      const floor = floorY(j.position.x) + 3;
      if (j.position.y > u.band[1] + 2 || j.position.y < Math.max(floor, u.band[0] - 2)) {
        j.position.y = Math.max(floor + 2, rand(u.band[0], u.band[1] - 4));
      }
      const wrapped = wrap(j.position.x, cx, 40);
      if (Math.abs(wrapped - j.position.x) > 1) {
        u.state = 'dormant';
        u.glow = 0;
      }
      j.position.x = wrapped;
      j.visible = floorY(j.position.x) < -JELLY_CEILING - 10 && this.dark > 0.45;
      if (j.visible) updateJellyGlow(j, dt, sub);
    }
    if (!this.anglerLight.userData.owner) this.anglerLight.intensity = 0;
    for (const a of this.anglers) {
      const wrapped = wrap(a.position.x, cx, 50);
      if (Math.abs(wrapped - a.position.x) > 1) {
        a.position.x = wrapped;
        a.position.y = floorY(wrapped) + ANGLER_BAND[1] - 2;
        a.userData.target = null;
      }
      const floor = floorY(a.position.x);
      a.visible = floor < ANGLER_FLOOR && this.dark > 0.5;
      if (a.visible) updateAngler(a, dt, t, cx, sub, this);
      else if (this.anglerLight.userData.owner === a) {
        this.anglerLight.userData.owner = null;
        a.userData.flash = 0;
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3(0.7, 0.7, 0.7);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const school of this.schools) {
      school.x += school.dir * school.speed * dt;
      const half = halfWidthAt(school.z, this.aspect) + 10;
      const wrapped = wrap(school.x, cx, half);
      if (Math.abs(wrapped - school.x) > 1) {
        school.x = wrapped;
        school.y = rand(SHELF_Y + 4, SURFACE_Y - 3);
      }
      q.setFromAxisAngle(up, school.dir > 0 ? 0 : Math.PI);
      school.offsets.forEach((o, i) => {
        p.set(school.x + o.x, school.y + o.y + Math.sin(t * 2 + i) * 0.15, school.z + o.z);
        m.compose(p, q, sc);
        school.mesh.setMatrixAt(i, m);
      });
      school.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
