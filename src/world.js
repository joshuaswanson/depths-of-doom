import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { findNode, plainMaterials, spawn, tint } from './assets.js';
import { CURRENT_MATERIALS, NOISE_GLSL } from './surface.js';
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
export function floorY(x) {
  const n = 0.5 + 0.5 * (0.6 * Math.sin(x * 0.011 - 1.2) + 0.4 * Math.sin(x * 0.027 + 2.0));
  const deepness = THREE.MathUtils.smoothstep(n, 0.36, 0.68);
  // Step the descent into three cliff-and-ledge tiers.
  const tiers = 3;
  const k = Math.min(Math.floor(deepness * tiers), tiers - 1);
  const stepped = (k + THREE.MathUtils.smoothstep(deepness * tiers - k, 0.3, 0.7)) / tiers;
  const ledges = Math.sin(x * 0.09) * 1.5 * deepness * (1 - deepness) * 4;
  return SHELF_Y + (ABYSS_Y - SHELF_Y) * stepped + ledges;
}

// Reef mounds: one per stretch of shelf, placed and sized by a hash of the stretch so they never move.
const MOUND_CELL = 24;
const MOUND_Z = -10;

function hash(n, k = 0) {
  const s = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function moundOf(cell) {
  return {
    cell,
    x: cell * MOUND_CELL + MOUND_CELL * (0.2 + 0.6 * hash(cell, 1)),
    height: 3.0 + 3.5 * hash(cell, 2),
    width: 4.5 + 3.5 * hash(cell, 3),
    reef: hash(cell, 4) < 0.72,
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

function detailHeight(x, z) {
  const depth = Math.max(0, -z - 4);
  let h = 0.35 * Math.sin(x * 0.157 + z * 0.21) + 0.25 * Math.sin(x * 0.39 - z * 0.37 + 1.3)
    + 0.12 * Math.sin(x * 0.86 + z * 0.9);
  h *= 1 + depth * 0.03;
  if (z > 4) h += (z - 4) * 0.12;
  const shelf = 1 - THREE.MathUtils.smoothstep(SHELF_Y - floorY(x), 2, 10);
  return h + moundHeight(x, z) * shelf;
}

export function seabedAt(x, z = 0) {
  return floorY(x) + detailHeight(x, z);
}

const LAYERS = [
  {
    z: [-100, -70], gap: [12, 24], scale: [2.4, 3.6], plain: true,
    props: ['ruin_tower', 'ruin_pillar_a', 'ruin_arch', 'ruin_tower', 'ruin_pier'],
    deep: ['ruin_tower', 'rock_a', 'ruin_pillar_b'],
  },
  {
    z: [-48, -22], gap: [6, 12], scale: [1.1, 1.7],
    props: ['ruin_pier', 'ruin_arch', 'ruin_pillar_a', 'ruin_pillar_b', 'ruin_wall', 'anchor', 'rock_a', 'ruin_tower'],
    deep: ['rock_a', 'rock_b', 'ruin_pillar_b', 'anchor', 'ruin_wall'],
  },
  {
    z: [-16, -2], gap: [7, 14], scale: [0.85, 1.35],
    props: ['ruin_pillar_b', 'rock_b', 'anchor', 'rock_a', 'ruin_wall'],
    deep: ['rock_a', 'rock_b', 'coral_brain', 'anchor', 'rock_b'],
  },
  {
    z: [9, 13], gap: [5, 10], scale: [1.0, 1.5], tint: ['#0b2a3f', 0.6],
    props: ['kelp_short', 'coral_fan', 'coral_staghorn', 'sponge_cluster', 'kelp_short', 'coral_brain'],
    deep: ['rock_b', 'coral_brain'],
  },
];

const CHAIN_Z = [-70, -26];
const CORALS = ['coral_staghorn', 'coral_fan', 'coral_table', 'sponge_cluster', 'anemone_patch', 'coral_brain'];
// Fixed resting places for sunken enemy subs: one on the sunlit shelf near the start, one on a trench floor.
const WRECKS = [{ x: -48, z: -16, yaw: 0.5, roll: 0.18 }, { x: 236, z: -12, yaw: -0.4, roll: -0.12 }];

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
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSeed, uStrength;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep( 0.0, 0.35, vUv.x ) * smoothstep( 1.0, 0.65, vUv.x );
          float fade = pow( vUv.y, 1.4 );
          float flicker = 0.65 + 0.35 * sin( uTime * 0.7 + uSeed ) * sin( uTime * 0.31 + uSeed * 2.0 );
          gl_FragColor = vec4( vec3( 0.75, 0.95, 1.0 ) * edge * fade * flicker * uStrength, 1.0 );
        }`,
    });
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(rand(2.5, 7), 60), mat);
    ray.userData.strength = mat.uniforms.uStrength.value;
    ray.position.set(rand(-50, 50), SURFACE_Y - 30, rand(-45, -12));
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
        gl_FragColor = vec4( mix( water, vec3( 0.95, 1.0, 1.0 ), foam ), 0.35 + foam * 0.6 );
      }`,
  });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(240, 0.9, 240, 1), mat);
  strip.position.set(0, SURFACE_Y - 0.35, 0.6);
  strip.renderOrder = 8;
  return strip;
}

const SHALLOW_COLORS = ['#1d5a55', '#2c7a60', '#4a9068', '#17474a'].map((c) => new THREE.Color(c));
const RUBBLE = new THREE.Color('#5b6e6a');
const DEEP_COLORS = ['#1a2430', '#252f3d', '#2d3644', '#151b26'].map((c) => new THREE.Color(c));

function makeSeabedTile(material) {
  const geo = new THREE.PlaneGeometry(TILE_W, TILE_D, 80, 90);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, TILE_Z0 - TILE_D / 2);
  geo.userData.baseX = Float32Array.from({ length: geo.attributes.position.count }, (_, i) => geo.attributes.position.getX(i));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const tile = new THREE.Mesh(geo, material);
  tile.frustumCulled = false;
  tile.userData.x0 = null;
  return tile;
}

function shapeTile(tile, x0) {
  if (tile.userData.x0 === x0) return;
  tile.userData.x0 = x0;
  tile.position.x = x0;
  const geo = tile.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const c = new THREE.Color();
  const d = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = geo.userData.baseX[i] + x0;
    const z = pos.getZ(i);
    const y = seabedAt(x, z);
    pos.setY(i, y);
    const n = 0.5 + 0.5 * Math.sin(x * 0.236 + z * 0.13) * Math.cos(x * 0.55 - z * 0.29);
    const m = 0.5 + 0.5 * Math.sin(x * 1.02 + z * 0.71);
    c.copy(SHALLOW_COLORS[0]).lerp(SHALLOW_COLORS[1], n).lerp(SHALLOW_COLORS[2], m * 0.35 * n);
    c.lerp(SHALLOW_COLORS[3], Math.max(0, Math.sin(x * 0.31 - z * 0.5)) * 0.4);
    d.copy(DEEP_COLORS[0]).lerp(DEEP_COLORS[1], n).lerp(DEEP_COLORS[2], m * 0.4);
    c.lerp(d, THREE.MathUtils.smoothstep(-y, 18, 45));
    const raised = moundHeight(x, z) * (1 - THREE.MathUtils.smoothstep(SHELF_Y - floorY(x), 2, 10));
    c.lerp(RUBBLE, THREE.MathUtils.smoothstep(raised, 0.4, 2.0) * 0.6);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  geo.computeVertexNormals();
}

function makeSeabedMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: '#9fb5b4' });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaWorld;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSeaWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSeaWorld;
        uniform float uTime;
        ${NOISE_GLSL}
        float caustic( vec2 p ) {
          vec2 i = p;
          float c = 1.0;
          for ( int n = 0; n < 3; n++ ) {
            float t = uTime * ( 1.0 - ( 3.5 / float( n + 1 ) ) ) * 0.6;
            i = p + vec2( cos( t - i.x ) + sin( t + i.y ), sin( t - i.y ) + cos( t + i.x ) );
            c += 1.0 / length( vec2( p.x / ( sin( i.x + t ) / 0.005 ), p.y / ( cos( i.y + t ) / 0.005 ) ) );
          }
          c /= 3.0;
          c = 1.17 - pow( c, 1.4 );
          return pow( abs( c ), 8.0 );
        }`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 sp = vec3( vSeaWorld.x, vSeaWorld.y * 0.5, vSeaWorld.z );
        float sRipple = 0.5 + 0.5 * sin( sp.x * 2.6 + sp.z * 0.8 + dNoise( sp * 0.6 ) * 4.0 );
        float sPebble = smoothstep( 0.68, 0.74, dNoise( sp * 3.5 ) );
        float sPatch = dNoise( sp * 0.15 );
        float sShallow = smoothstep( -30.0, -12.0, vSeaWorld.y );
        float sGrass = smoothstep( 0.55, 0.78, dNoise( sp * 0.35 + 5.0 ) ) * sShallow;
        float sSteep = 1.0 - smoothstep( 0.55, 0.85, inverseTransformDirection( normalize( vNormal ), viewMatrix ).y );
        diffuseColor.rgb *= 0.85 + sRipple * 0.12 * ( 1.0 - sSteep ) + ( sPatch - 0.5 ) * 0.4;
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.28, 0.11 ), sGrass * 0.5 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.55, sPebble * 0.6 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.22, 0.26 ) * ( 0.7 + sPatch * 0.6 ), sSteep * 0.8 );`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        float sHeight = sRipple * 0.4 * ( 1.0 - sSteep ) + sPebble * 0.8 + dNoise( sp * 7.0 ) * 0.25 + sPatch * sSteep * 1.2;
        normal = dPerturb( - vViewPosition, normal, vec2( dFdx( sHeight ), dFdy( sHeight ) ) * 0.25, faceDirection );`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        float fadeC = smoothstep( -70.0, -5.0, vSeaWorld.z ) * smoothstep( -28.0, -8.0, vSeaWorld.y );
        totalEmissiveRadiance += vec3( 0.3, 0.7, 0.75 ) * clamp( caustic( vSeaWorld.xz * 0.35 ), 0.0, 1.0 ) * 0.22 * fadeC;`);
  };
  return mat;
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

// Jellies gather in one glowing layer in the dark trenches, with a few stragglers drifting deeper.
const JELLY_CEILING = 96;
const JELLY_LAYER = [-122, -100];
const JELLY_DEEP = [-200, -128];
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

  placeProp(prop, x) {
    const { layer } = prop;
    const deep = floorY(x) < SHELF_Y - 14;
    const want = deep ? 'deep' : 'shallow';
    if (prop.kind !== want) {
      if (prop.obj) this.scene.remove(prop.obj);
      const name = pick(deep ? layer.deep : layer.props);
      prop.obj = spawn(name);
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
    prop.obj.rotation.y = rand(-0.5, 0.5);
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
    const place = (name, x, z, scale) => {
      const obj = spawn(name);
      obj.scale.setScalar(scale);
      obj.position.set(x, seabedAt(x, z) - 0.2, z);
      obj.rotation.y = r() * Math.PI * 2;
      pieces.add(obj);
    };
    const deep = floorY(m.x) < SHELF_Y - 6;
    if (deep) {
      for (let i = 0; i < 2; i++) place(r() < 0.5 ? 'rock_a' : 'rock_b', m.x + (r() - 0.5) * 8, -6 - r() * 8, 0.8 + r() * 0.6);
      return [mergeCluster(pieces)];
    }
    if (m.reef) {
      place('reef_large', m.x, MOUND_Z, 1.5 + r() * 0.5);
      for (let i = 0; i < 4; i++) {
        place(r() < 0.5 ? 'reef_small' : 'reef_large', m.x + (r() - 0.5) * m.width * 1.4, MOUND_Z + 1 + (r() - 0.5) * 5,
          1.1 + r() * 0.5);
      }
      const corals = 10 + Math.floor(r() * 6);
      for (let i = 0; i < corals; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * m.width * 0.95;
        place(CORALS[Math.floor(r() * CORALS.length)], m.x + Math.cos(a) * d, MOUND_Z + 1 + Math.sin(a) * d * 0.7,
          1.0 + r() * 0.7);
      }
      for (let i = 0; i < 3; i++) {
        const side = r() < 0.5 ? -1 : 1;
        place(r() < 0.6 ? 'kelp_tall' : 'kelp_short', m.x + side * (m.width + r() * 3), MOUND_Z - 2 - r() * 5,
          0.8 + r() * 0.4);
      }
    } else {
      const stalks = 5 + Math.floor(r() * 4);
      for (let i = 0; i < stalks; i++) {
        place(r() < 0.65 ? 'kelp_tall' : 'kelp_short', m.x + (r() - 0.5) * 7, MOUND_Z + (r() - 0.5) * 8, 0.8 + r() * 0.5);
      }
      place(r() < 0.5 ? 'rock_a' : 'rock_b', m.x + (r() - 0.5) * 6, MOUND_Z, 0.7 + r() * 0.5);
    }
    return [mergeCluster(pieces)];
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

  update(dt, camera, sub = null) {
    this.time += dt;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const t = this.time;
    this.uniforms.uTime.value = t;
    const shift = depthShift(cy);
    this.dark = darkness(cy);
    const bu = this.backdrop.material.uniforms;
    bu.uShift.value = shift;
    bu.uDark.value = this.dark;
    bu.uLine.value = 0.5 + 0.5 * (SURFACE_Y - cy) / (CAMERA_Z * TAN_HALF_FOV);
    this.scene.fog.color.setRGB(shift, this.dark, 0);
    // The play area sits about 20 units from the camera; fog starts behind it so darkness in the depths comes from
    // missing light, and whatever a lamp hits still shows.
    this.scene.fog.near = THREE.MathUtils.lerp(20, 19, this.dark);
    this.scene.fog.far = THREE.MathUtils.lerp(125, 42, this.dark);
    this.surface.material.uniforms.uTime.value = t;
    this.surface.position.x = cx;
    this.waterline.material.uniforms.uTime.value = t;
    this.waterline.position.x = cx;

    const base = Math.floor(cx / TILE_W);
    this.tiles.forEach((tile, i) => shapeTile(tile, (base + i - 2) * TILE_W));

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
