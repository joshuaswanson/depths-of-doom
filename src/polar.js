import * as THREE from 'three';
import { unlock } from './achievements.js';
import { sfx } from './audio.js';
import { spawn } from './assets.js';
import { SHELF_Y, SURFACE_Y } from './water.js';
import { floorY } from './world.js';

// Shelves are numbered outward from the one the dive starts on. Going right from the start, the first wide shelf
// is the North Pole, the next wide one after a reef the South Pole, and so on round again; going left the South Pole
// comes first.
const SCAN_STEP = 4;
const POLE_MIN_WIDTH = 140;
// A polar shelf starts out as ordinary sea at its cliffs. The cold sets in over the first stretch of shelf, and the
// ice starts once it has.
const POLAR_EDGE = [4, 30];
const ICE_INSET = 26;

const onShelf = (x) => floorY(x) > SHELF_Y - 3;

// Shelf spans found so far: index 0 is the starting shelf, positive to the right, negative to the left.
const shelves = new Map();

function startShelf() {
  if (shelves.has(0)) return shelves.get(0);
  let x = 0;
  while (!onShelf(x)) x += SCAN_STEP;
  let start = x;
  while (onShelf(start - SCAN_STEP)) start -= SCAN_STEP;
  let end = x;
  while (onShelf(end + SCAN_STEP)) end += SCAN_STEP;
  const s = { index: 0, start, end };
  shelves.set(0, s);
  return s;
}

function shelf(index) {
  if (shelves.has(index)) return shelves.get(index);
  if (index === 0) return startShelf();
  const dir = Math.sign(index);
  const prev = shelf(index - dir);
  let x = dir > 0 ? prev.end + SCAN_STEP : prev.start - SCAN_STEP;
  while (!onShelf(x)) x += dir * SCAN_STEP;
  let near = x;
  let far = x;
  while (onShelf(far + dir * SCAN_STEP)) far += dir * SCAN_STEP;
  const s = dir > 0 ? { index, start: near, end: far } : { index, start: far, end: near };
  shelves.set(index, s);
  return s;
}

const biomes = new Map([[0, 'reef']]);
export function biomeOf(index) {
  let biome = biomes.get(index);
  if (biome) return biome;
  const dir = Math.sign(index);
  const s = shelf(index);
  biome = 'reef';
  if (biomeOf(index - dir) === 'reef' && s.end - s.start >= POLE_MIN_WIDTH) {
    let last = null;
    for (let i = index - dir; i !== 0 && !last; i -= dir) if (biomeOf(i) !== 'reef') last = biomeOf(i);
    biome = last ? (last === 'north' ? 'south' : 'north') : dir > 0 ? 'north' : 'south';
  }
  biomes.set(index, biome);
  return biome;
}

// The shelf at or nearest to x, and whether x lies on it.
function shelfNear(x) {
  let s = startShelf();
  while (x > s.end) {
    const next = shelf(s.index + 1);
    if (x < next.start) return x - s.end < next.start - x ? s : next;
    s = next;
  }
  while (x < s.start) {
    const prev = shelf(s.index - 1);
    if (x > prev.end) return s.start - x < x - prev.end ? s : prev;
    s = prev;
  }
  return s;
}

// The polar shelf nearest x, if the nearest shelf is polar, and how cold the water is there: 0 over the trench and
// along the shelf's edges, 1 under the ice.
const polarCache = new Map();
export function polarAt(x) {
  const key = Math.round(x);
  let p = polarCache.get(key);
  if (p) return p;
  const s = shelfNear(x);
  const kind = biomeOf(s.index);
  p = kind === 'reef'
    ? { amount: 0, kind: null, shelf: null }
    : { amount: THREE.MathUtils.smoothstep(Math.min(x - s.start, s.end - x), POLAR_EDGE[0], POLAR_EDGE[1]), kind, shelf: s };
  polarCache.set(key, p);
  if (polarCache.size > 8000) polarCache.delete(polarCache.keys().next().value);
  return p;
}

// Whether polar ice lies within reach of x, so open-sea creatures can keep well away from it.
export function nearIce(x, reach) {
  const s = shelfNear(x);
  return [shelf(s.index - 1), s, shelf(s.index + 1)].some((c) => biomeOf(c.index) !== 'reef'
    && x > c.start + ICE_INSET - reach && x < c.end - ICE_INSET + reach);
}

// Seeded random numbers, so a shelf's ice is the same every time it scrolls into view.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// An iceberg: a jagged, flat-topped slab with most of its bulk hidden under the water in a tapering keel.
// Built in its own frame with the waterline at y = 0.
function icebergGeometry(r, width, depth, top, draft) {
  const n = 9 + Math.floor(r() * 5);
  const outline = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.4;
    const k = 0.78 + r() * 0.3;
    return [Math.cos(a) * width * 0.5 * k, Math.sin(a) * depth * 0.5 * k];
  });
  // Rings from the top down: height, how far out the ring reaches, and how much each corner wanders.
  const rings = [
    [top, 0.8, 0.06], [top * 0.55, 0.97, 0.08], [0, 1, 0.04], [-draft * 0.22, 0.96, 0.08],
    [-draft * 0.55, 0.78, 0.12], [-draft * 0.85, 0.48, 0.14], [-draft, 0.22, 0.1],
  ].map(([y, scale, wander]) => outline.map(([x, z]) => {
    const k = scale * (1 - wander + r() * wander * 2);
    return new THREE.Vector3(x * k, y + (y === 0 ? 0 : (r() - 0.5) * Math.max(top, draft) * 0.06), z * k);
  }));
  const positions = [];
  const tri = (a, b, c) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(rings[k][i], rings[k + 1][i], rings[k + 1][j]);
      tri(rings[k][i], rings[k + 1][j], rings[k][j]);
    }
  }
  const capTop = new THREE.Vector3(0, top * (1.02 + r() * 0.05), 0);
  const capBottom = new THREE.Vector3((r() - 0.5) * width * 0.1, -draft * 1.04, (r() - 0.5) * depth * 0.1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(capTop, rings[0][i], rings[0][j]);
    tri(capBottom, rings[rings.length - 1][j], rings[rings.length - 1][i]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Snow on top, pale ice on the sides above water, and glacial blue darkening down the keel.
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < positions.length; i += 9) {
    const y = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
    if (y > top * 0.75) c.set('#f4fbff');
    else if (y > 0) c.set('#d6eef7').lerp(new THREE.Color('#f4fbff'), y / top);
    else c.set('#8fdcf0').lerp(new THREE.Color('#2b7fa8'), THREE.MathUtils.clamp(-y / draft, 0, 1));
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

let iceMaterial = null;
function iceMat() {
  iceMaterial ??= new THREE.MeshStandardMaterial({
    name: 'ice', vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0, envMapIntensity: 1.3,
    emissive: new THREE.Color('#1d5f7a'), emissiveIntensity: 0.25,
  });
  return iceMaterial;
}

// Bergs in the sub's lane and ones far behind it.
const LANE_Z = 0;
const BACK_Z = [-70, -24];

// The ice over one polar shelf: where every berg floats and how big it is, the animals on top, and, for bergs in
// the sub's lane, the height of the ice's underside along the lane.
function layoutIce(s) {
  const r = seeded(s.index * 7919 + 17);
  const kind = biomeOf(s.index);
  const from = s.start + ICE_INSET;
  const to = s.end - ICE_INSET;
  const middle = (s.start + s.end) / 2;
  const span = to - from;
  // Stretches of the lane kept clear of bergs: a field of thin pack ice to smash through in the north, and flat floes
  // crowded with penguins in the south.
  const field = kind === 'north' ? { start: middle - Math.min(26, span * 0.25), end: middle + Math.min(26, span * 0.25) } : null;
  const floes = kind === 'south'
    ? [0.28, 0.72].map((f) => ({ x: from + span * f, width: 8 + r() * 3, depth: 5 + r() * 2, seed: Math.floor(r() * 1e9) }))
    : [];
  const reserved = [...(field ? [[field.start - 2, field.end + 2]] : []),
    ...floes.map((f) => [f.x - f.width / 2 - 5, f.x + f.width / 2 + 5])];
  const bergs = [];
  for (let x = from; x < to;) {
    const clash = reserved.find(([a, b]) => x + 4 > a && x < b);
    if (clash) {
      x = clash[1];
      continue;
    }
    const width = Math.min(9 + r() * 20, Math.max(4, (reserved.find(([a]) => a > x)?.[0] ?? to) - x - 1));
    bergs.push({ x: x + width / 2, z: LANE_Z + (r() - 0.5) * 2, width, depth: 6 + r() * 6, top: 1.6 + r() * 3,
      draft: 5 + r() * 8, seed: Math.floor(r() * 1e9), lane: true });
    // Leads of open water between the bergs, where the sub can come up for air.
    x += width + (r() < 0.35 ? 8 + r() * 10 : 1 + r() * 3);
  }
  for (let x = from - 6; x < to - 10;) {
    const width = Math.min(18 + r() * 34, to + 6 - x);
    bergs.push({ x: x + width / 2, z: BACK_Z[0] + r() * (BACK_Z[1] - BACK_Z[0]), width, depth: 10 + r() * 16,
      top: 3 + r() * 9, draft: 6 + r() * 9, seed: Math.floor(r() * 1e9), lane: false });
    x += width * (0.6 + r() * 0.6);
  }
  for (const b of bergs) {
    b.geometry = icebergGeometry(seeded(b.seed), b.width, b.depth, b.top, b.draft);
    if (b.lane) b.underside = measureUnderside(b);
  }
  // Polar bears roam the northern ice with an igloo in the middle; penguins crowd the southern floes in groups.
  const animals = [];
  const tops = bergs.filter((b) => b.top > 1.4 && b.z > BACK_Z[0] + 10);
  if (kind === 'north') {
    // The igloo stands out on the pack ice just behind the lane, where a sub breaking through comes up beside it,
    // with a bear prowling close by.
    const pack = { x: (field.start + field.end) / 2, z: -11, top: 0.16, width: field.end - field.start, depth: 10 };
    animals.push({ type: 'igloo', berg: pack, dx: (r() - 0.5) * 8, dz: 0 });
    animals.push({ type: 'bear', berg: pack, dx: 9 + r() * 6, dz: 4, yaw: Math.PI });
    for (const b of tops) {
      if (r() > 0.4) continue;
      animals.push({ type: 'bear', berg: b, dx: (r() - 0.5) * b.width * 0.4, dz: (r() - 0.5) * b.depth * 0.2,
        yaw: r() < 0.5 ? 0 : Math.PI });
    }
  } else {
    for (const b of tops) {
      if (r() > 0.55) continue;
      const count = 3 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        animals.push({ type: 'penguin', berg: b, dx: (r() - 0.5) * b.width * 0.45, dz: (r() - 0.5) * b.depth * 0.3,
          yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3 });
      }
    }
  }
  for (const f of floes) {
    f.geometry = icebergGeometry(seeded(f.seed), f.width, f.depth, 0.45, 0.75);
    const count = 5 + Math.floor(r() * 4);
    f.penguins = Array.from({ length: count }, () => ({ dx: (r() - 0.5) * f.width * 0.55, dz: (r() - 0.5) * f.depth * 0.4,
      yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3 }));
  }
  return { shelf: s, kind, bergs, animals, field, floes, built: null };
}

// The height of a lane berg's underside at each step across the lane, found by casting rays up into it.
const UNDERSIDE_STEP = 0.5;
const ray = new THREE.Raycaster();
const rayMesh = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
function measureUnderside(b) {
  rayMesh.geometry = b.geometry;
  rayMesh.position.set(b.x, SURFACE_Y, b.z);
  rayMesh.updateMatrixWorld(true);
  const x0 = b.x - b.width * 0.7;
  const samples = [];
  for (let x = x0; x <= b.x + b.width * 0.7; x += UNDERSIDE_STEP) {
    ray.set(new THREE.Vector3(x, SURFACE_Y - b.draft * 2 - 5, 0), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObject(rayMesh, false)[0];
    samples.push(hit ? hit.point.y : Infinity);
  }
  return { x0, samples };
}

const layouts = new Map();

// The ice laid out so far, by shelf index.
export function iceLayouts() {
  return layouts;
}

function iceFor(s) {
  let ice = layouts.get(s.index);
  if (!ice) {
    ice = layoutIce(s);
    layouts.set(s.index, ice);
  }
  return ice;
}

// The underside of the ice over the sub's lane at x: the highest the top of anything there can reach. Open water
// gives the sky.
export function iceCeiling(x) {
  const p = polarAt(x);
  if (!p.shelf || x < p.shelf.start + ICE_INSET - 30 || x > p.shelf.end - ICE_INSET + 30) return Infinity;
  let ceiling = Infinity;
  for (const b of iceFor(p.shelf).bergs) {
    if (!b.lane) continue;
    const u = b.underside;
    const i = (x - u.x0) / UNDERSIDE_STEP;
    const k = Math.floor(i);
    if (k < 0 || k + 1 >= u.samples.length) continue;
    const a = u.samples[k];
    const c = u.samples[k + 1];
    if (a === Infinity || c === Infinity) {
      ceiling = Math.min(ceiling, a, c);
      continue;
    }
    ceiling = Math.min(ceiling, a + (c - a) * (i - k));
  }
  return ceiling;
}

// The igloo: a dome of snow blocks with a tunnel entrance.
function makeIgloo() {
  const group = new THREE.Group();
  const snow = new THREE.MeshStandardMaterial({ color: '#f2f8fc', roughness: 0.9, flatShading: true });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), snow);
  // A half pipe lying along z, its open arch facing the camera.
  const tunnelGeo = new THREE.CylinderGeometry(0.85, 0.85, 1.8, 10, 1, false, -Math.PI / 2, Math.PI);
  tunnelGeo.rotateX(-Math.PI / 2);
  const tunnel = new THREE.Mesh(tunnelGeo, snow);
  tunnel.position.set(0, 0, 2.4);
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: '#16232e' }));
  door.position.set(0, 0.02, 3.31);
  group.add(dome, tunnel, door);
  // Grooves between the blocks: rings around the dome and staggered joints between them.
  const groove = new THREE.MeshBasicMaterial({ color: '#b9cfdc' });
  for (let k = 1; k < 5; k++) {
    const a = (k / 5) * Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.205 * Math.cos(a), 0.025, 4, 32), groove);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.2 * Math.sin(a);
    group.add(ring);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

const ANIMAL_SIZE = { bear: 3.2, penguin: 0.85 };

function buildIce(ice, scene) {
  const group = new THREE.Group();
  for (const b of ice.bergs) {
    const mesh = new THREE.Mesh(b.geometry, iceMat());
    mesh.position.set(b.x, SURFACE_Y, b.z);
    mesh.castShadow = b.draft > 2;
    group.add(mesh);
  }
  const animals = ice.animals.map((a) => {
    const obj = a.type === 'igloo' ? makeIgloo() : spawn(a.type === 'bear' ? 'polar_bear' : 'penguin');
    if (a.type !== 'igloo') {
      obj.scale.setScalar(ANIMAL_SIZE[a.type]);
      // Penguins stand up straight: the model is one unit from beak to tail feathers, standing on its feet.
      obj.rotation.y = a.yaw;
    }
    const base = SURFACE_Y + a.berg.top * 0.97;
    obj.position.set(a.berg.x + a.dx, base, a.berg.z + a.dz);
    obj.userData = { ...a, base };
    group.add(obj);
    return obj;
  });
  group.updateMatrixWorld(true);
  for (const o of animals) placeOnBerg(o);
  const field = ice.field ? new PackIce(ice.field, group) : null;
  const floes = ice.floes.map((f) => new Floe(f, group));
  scene.add(group);
  ice.built = { group, animals, field, floes };
}

// A field of thin pack ice: loose plates jostling at the surface. Plates in the sub's lane shatter into chunks when
// the hull drives into them, opening a channel like an icebreaker's.
const PLATE_RADIUS = 1;
const PLATE_THICK = 0.5;
const LANE_HALF = 2.7;
const CHUNKS = 260;
let plateGeometry = null;
let plateMaterial = null;

class PackIce {
  constructor(field, group) {
    plateGeometry ??= new THREE.CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS * 0.94, PLATE_THICK, 6);
    plateMaterial ??= new THREE.MeshStandardMaterial({ name: 'pack_ice', color: '#eaf7fc', flatShading: true,
      roughness: 0.35, emissive: new THREE.Color('#2a7896'), emissiveIntensity: 0.18 });
    this.plates = [];
    const r = seeded(Math.floor(field.start * 13) + 5);
    for (let z = -24, row = 0; z <= LANE_HALF; z += 1.5, row++) {
      for (let x = field.start + (row % 2) * 0.85; x <= field.end; x += 1.7) {
        this.plates.push({ x: x + (r() - 0.5) * 0.3, z: z + (r() - 0.5) * 0.3, yaw: r() * Math.PI, scale: 0.82 + r() * 0.2,
          tilt: (r() - 0.5) * 0.06, breakable: Math.abs(z) < LANE_HALF, broken: false, phase: r() * 6.3 });
      }
    }
    this.mesh = new THREE.InstancedMesh(plateGeometry, plateMaterial, this.plates.length);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    this.plates.forEach((p, i) => this.mesh.setColorAt(i, c.setHSL(0.54, 0.25 + r() * 0.2, 0.86 + r() * 0.1)));
    this.chunks = Array.from({ length: CHUNKS }, () => ({ active: false }));
    this.chunkMesh = new THREE.InstancedMesh(plateGeometry, plateMaterial, CHUNKS);
    this.chunkMesh.frustumCulled = false;
    this.nextChunk = 0;
    this.field = field;
    this.broken = 0;
    this.lastCrack = 0;
    group.add(this.mesh, this.chunkMesh);
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.scaleV = new THREE.Vector3();
    this.posV = new THREE.Vector3();
  }

  update(dt, t, hull, effects) {
    let crushing = false;
    if (hull) {
      const c = hull.center;
      const e = hull.extents;
      const top = hull.top;
      if (c.x > this.field.start - e.hx - 1 && c.x < this.field.end + e.hx + 1 && top > SURFACE_Y - PLATE_THICK - 0.2) {
        for (const p of this.plates) {
          if (!p.breakable || p.broken || Math.abs(p.x - c.x) > e.hx + PLATE_RADIUS * 0.6) continue;
          // Only plates the hull actually reaches: the rounded top rises highest amidships.
          const along = THREE.MathUtils.clamp((p.x - c.x) / e.hx, -1, 1);
          if (c.y + e.hy * Math.sqrt(1 - along * along) < SURFACE_Y - PLATE_THICK) continue;
          this.shatter(p, hull, effects);
          crushing = true;
        }
        // Grinding through the ice drags on the sub, a little.
        if (crushing || top > SURFACE_Y - 0.1) hull.vel.multiplyScalar(Math.exp(-dt * 2.2));
      }
    }
    const m = this.matrix;
    this.plates.forEach((p, i) => {
      if (p.broken) {
        m.makeScale(0, 0, 0);
      } else {
        const bob = Math.sin(t * 1.1 + p.phase) * 0.04;
        this.euler.set(p.tilt + Math.sin(t * 0.9 + p.phase) * 0.02, p.yaw, Math.cos(t * 0.8 + p.phase) * 0.02);
        m.compose(this.posV.set(p.x, SURFACE_Y - 0.1 + bob, p.z), this.quat.setFromEuler(this.euler),
          this.scaleV.set(p.scale, 1, p.scale));
      }
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.chunks.forEach((k, i) => {
      if (!k.active) {
        m.makeScale(0, 0, 0);
      } else {
        k.life += dt;
        // Thrown up and aside, the chunks splash back, rock on the swell and drift apart, then sink away.
        k.vy -= (k.y > SURFACE_Y ? 14 : -10 * (SURFACE_Y - 0.08 - k.y)) * dt;
        const drag = Math.exp(-dt * (k.y > SURFACE_Y ? 0.2 : 2.2));
        k.vx *= drag;
        k.vz *= drag;
        k.vy *= k.y > SURFACE_Y ? 1 : Math.exp(-dt * 3);
        k.x += k.vx * dt;
        k.y += k.vy * dt - (k.life > 18 ? (k.life - 18) * 0.6 * dt : 0);
        k.z += k.vz * dt;
        k.rx += k.sx * dt * (k.y > SURFACE_Y ? 1 : 0.15);
        k.rz += k.sz * dt * (k.y > SURFACE_Y ? 1 : 0.15);
        if (k.life > 22) k.active = false;
        this.euler.set(k.rx, k.yaw, k.rz);
        m.compose(this.posV.set(k.x, k.y, k.z), this.quat.setFromEuler(this.euler), this.scaleV.set(k.size, 0.8, k.size));
      }
      this.chunkMesh.setMatrixAt(i, m);
    });
    this.chunkMesh.instanceMatrix.needsUpdate = true;
  }

  shatter(p, hull, effects) {
    p.broken = true;
    this.broken++;
    if (this.broken >= 40) unlock('icebreaker');
    const v = hull.vel;
    for (let k = 0; k < 3; k++) {
      const chunk = this.chunks[this.nextChunk];
      this.nextChunk = (this.nextChunk + 1) % CHUNKS;
      Object.assign(chunk, {
        active: true, life: 0, x: p.x + (Math.random() - 0.5) * 1.2, y: SURFACE_Y, z: p.z + (Math.random() - 0.5) * 1.2,
        vx: v.x * 0.5 + (Math.random() - 0.5) * 2.5, vy: 1.5 + Math.random() * 2.5 + Math.max(0, v.y) * 0.4,
        vz: Math.sign(p.z || Math.random() - 0.5) * (1 + Math.random() * 2.5), yaw: Math.random() * 6.3,
        rx: 0, rz: 0, sx: (Math.random() - 0.5) * 8, sz: (Math.random() - 0.5) * 8, size: 0.32 + Math.random() * 0.22,
      });
    }
    effects?.splash({ x: p.x, y: SURFACE_Y, z: p.z }, 0.8);
    const now = performance.now();
    if (now - this.lastCrack > 90) {
      this.lastCrack = now;
      sfx.iceCrack();
    }
  }
}

// A flat floe crowded with penguins. Ram it and it bucks and tips, and the penguins go flying or slide off into the
// sea, then swim away.
const FLOE_DRAFT = 0.75;

class Floe {
  constructor(spec, group) {
    this.spec = spec;
    this.mesh = new THREE.Mesh(spec.geometry, iceMat());
    this.mesh.castShadow = true;
    this.home = spec.x;
    this.x = spec.x;
    this.vx = 0;
    this.lift = 0;
    this.vy = 0;
    this.tilt = 0;
    this.spin = 0;
    this.cooldown = 0;
    group.add(this.mesh);
    this.penguins = spec.penguins.map((p) => {
      const obj = spawn('penguin');
      obj.scale.setScalar(ANIMAL_SIZE.penguin);
      group.add(obj);
      obj.updateMatrixWorld(true);
      const foot = new THREE.Box3().setFromObject(obj).min.y - obj.position.y;
      return { ...p, obj, foot, state: 'stand', vel: new THREE.Vector3(), spinVel: new THREE.Vector3() };
    });
    this.local = new THREE.Vector3();
    this.place();
  }

  place() {
    this.mesh.position.set(this.x, SURFACE_Y + this.lift, this.spec.z ?? 0);
    this.mesh.rotation.set(0, 0, this.tilt);
    this.mesh.updateMatrixWorld(true);
  }

  update(dt, t, hull, effects) {
    this.cooldown -= dt;
    if (hull && this.cooldown <= 0) {
      const c = hull.center;
      const e = hull.extents;
      const half = this.spec.width / 2;
      const offset = c.x - this.x;
      if (Math.abs(offset) < half + e.hx * 0.8 && hull.top > SURFACE_Y - FLOE_DRAFT - 0.1 && c.y < SURFACE_Y + 1) {
        // Struck from below the floe bucks up; struck near an end it tips; driven into from the side it is shoved.
        const speed = hull.vel.length();
        const hit = 1.2 + speed * 0.35;
        this.vy += hit * 0.9;
        this.spin += -Math.sign(offset || 1) * hit * 0.5 * Math.min(1, Math.abs(offset) / half + 0.3);
        this.vx += hull.vel.x * 0.4;
        hull.vel.y = Math.min(hull.vel.y, -1.5);
        hull.vel.x *= 0.6;
        this.cooldown = 0.45;
        effects?.splash({ x: this.x + Math.sign(offset) * half * 0.8, y: SURFACE_Y, z: 0.5 }, 1.2);
        sfx.thud(Math.min(1, hit / 4));
        if (hit > 2.2) this.launch(hit, offset);
      }
    }
    // The floe rights itself and settles back on the water like a cork.
    this.spin += (-this.tilt * 9 - this.spin * 2.2) * dt;
    this.tilt += this.spin * dt;
    this.vy += (-this.lift * 14 - this.vy * 3) * dt;
    this.lift += this.vy * dt;
    this.vx += ((this.home - this.x) * 0.15 - this.vx * 0.8) * dt;
    this.x += this.vx * dt;
    this.place();
    for (const p of this.penguins) this.penguin(p, dt, t, effects);
  }

  // A big knock throws them all off at once.
  launch(hit, offset) {
    for (const p of this.penguins) {
      if (p.state !== 'stand') continue;
      p.state = 'fly';
      const away = Math.sign(p.dx - offset * 0.3 || Math.random() - 0.5);
      p.vel.set(away * (1.5 + Math.random() * hit * 0.8) + this.vx, 3 + Math.random() * hit, (Math.random() - 0.5) * 3);
      p.spinVel.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, -away * (4 + Math.random() * 6));
    }
  }

  penguin(p, dt, t, effects) {
    const obj = p.obj;
    if (p.state === 'stand') {
      // A steep tilt sends them sliding down toward the low edge and over it.
      p.dx += -Math.sin(this.tilt) * Math.max(0, Math.abs(this.tilt) - 0.18) * 14 * dt;
      this.local.set(p.dx, 0.45 * 0.97 - p.foot, p.dz);
      this.mesh.localToWorld(obj.position.copy(this.local));
      obj.rotation.set(0, p.yaw + Math.sin(t * 0.4 + p.phase) * 0.25, this.tilt + Math.sin(t * 3.2 + p.phase) * 0.12);
      if (Math.abs(p.dx) > this.spec.width * 0.48) {
        p.state = 'fly';
        p.vel.set(Math.sign(p.dx) * 2 + this.vx, 1.5, 0);
        p.spinVel.set(0, 0, -Math.sign(p.dx) * 5);
      }
      return;
    }
    if (p.state === 'fly') {
      p.vel.y -= 14 * dt;
      obj.position.addScaledVector(p.vel, dt);
      obj.rotation.x += p.spinVel.x * dt;
      obj.rotation.y += p.spinVel.y * dt;
      obj.rotation.z += p.spinVel.z * dt;
      if (obj.position.y < SURFACE_Y - 0.3) {
        p.state = 'swim';
        p.swimTime = 0;
        p.dir = Math.sign(p.vel.x || 1);
        effects?.splash({ x: obj.position.x, y: SURFACE_Y, z: obj.position.z }, 0.7);
        sfx.splash();
        this.knocked = (this.knocked ?? 0) + 1;
        if (this.knocked >= 3) unlock('penguin_bowl');
      }
      return;
    }
    if (p.state === 'swim') {
      // Bobbing back up from the plunge, then off and away, belly down.
      p.swimTime += dt;
      obj.position.x += p.dir * Math.min(6, p.swimTime * 4) * dt;
      obj.position.y += (SURFACE_Y - 2.2 - obj.position.y) * (1 - Math.exp(-dt * 2));
      obj.rotation.set(0, p.dir > 0 ? 0 : Math.PI, 0);
      obj.rotateZ(-Math.PI / 2);
      if (p.swimTime > 6) {
        p.state = 'gone';
        obj.visible = false;
      }
    }
  }
}

// Feet on the berg's top, which is a little higher toward the middle.
function placeOnBerg(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y += obj.userData.base - box.min.y;
  obj.userData.base = obj.position.y;
}

function dropIce(ice, scene) {
  if (!ice.built) return;
  scene.remove(ice.built.group);
  ice.built = null;
}

// Penguins diving and darting through the water under the southern ice.
const SWIMMERS = 5;

function makeSwimmers(scene) {
  return Array.from({ length: SWIMMERS }, () => {
    const holder = new THREE.Group();
    const body = spawn('penguin');
    body.scale.setScalar(ANIMAL_SIZE.penguin);
    // Lying along its line of travel: head forward, belly down.
    body.rotation.z = -Math.PI / 2;
    holder.add(body);
    holder.visible = false;
    // Roll about its own length first, then pitch, then face left or right.
    holder.rotation.order = 'YZX';
    holder.userData = { body, vel: new THREE.Vector2(), target: null, phase: Math.random() * 6, retarget: 0 };
    scene.add(holder);
    return holder;
  });
}

// Wind-driven snow blowing across the view above the water.
const SNOW_COUNT = 1400;
const SNOW_BOX = { x: 48, y: 26, z: 54 };

function makeSnow(scene) {
  const positions = new Float32Array(SNOW_COUNT * 3);
  for (let i = 0; i < SNOW_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SNOW_BOX.x * 2;
    positions[i * 3 + 1] = SURFACE_Y + Math.random() * SNOW_BOX.y;
    positions[i * 3 + 2] = -SNOW_BOX.z + Math.random() * (SNOW_BOX.z + 16);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({ size: 0.5, map: new THREE.CanvasTexture(canvas), transparent: true,
    depthWrite: false, opacity: 0, color: '#ffffff', fog: false });
  const snow = new THREE.Points(geo, mat);
  snow.frustumCulled = false;
  snow.renderOrder = 3;
  scene.add(snow);
  return snow;
}

export class Polar {
  constructor(scene) {
    this.scene = scene;
    this.swimmers = makeSwimmers(scene);
    this.snow = makeSnow(scene);
    // One of each kind of polar object, hidden: the loading screen's warm-up draws them so their shaders are ready
    // before the first pole scrolls into view.
    const sample = new THREE.Group();
    sample.add(new THREE.Mesh(icebergGeometry(seeded(1), 4, 3, 1, 2), iceMat()));
    new PackIce({ start: 0, end: 2 }, sample);
    sample.add(makeIgloo());
    sample.visible = false;
    scene.add(sample);
    this.warmers = [sample, this.snow];
    this.cold = 0;
    this.kind = null;
  }

  update(dt, t, cx, cy, sub, camera, hull, effects) {
    const p = polarAt(cx);
    this.cold = p.amount;
    this.kind = p.kind;
    // Build the ice of any polar shelf near the view, and let go of any that has scrolled well away.
    const near = shelfNear(cx);
    const wanted = new Set();
    for (const s of [shelf(near.index - 1), near, shelf(near.index + 1)]) {
      if (biomeOf(s.index) === 'reef') continue;
      if (cx < s.start - 140 || cx > s.end + 140) continue;
      wanted.add(s.index);
      const ice = iceFor(s);
      if (!ice.built) buildIce(ice, this.scene);
    }
    for (const [index, ice] of layouts) {
      if (!wanted.has(index)) dropIce(ice, this.scene);
      if (!wanted.has(index) && Math.abs(index - near.index) > 3) layouts.delete(index);
    }
    for (const index of wanted) {
      const ice = layouts.get(index);
      this.animate(ice, t, cx, camera);
      ice.built.field?.update(dt, t, hull, effects);
      for (const floe of ice.built.floes) floe.update(dt, t, hull, effects);
    }
    this.updateSwimmers(dt, t, cx, cy, sub);
    this.updateSnow(dt, cx, cy);
    if (sub && p.amount > 0.9) {
      unlock(p.kind === 'north' ? 'north_pole' : 'south_pole');
    }
  }

  // Bears breathe and slowly turn their heads; penguins rock from foot to foot.
  animate(ice, t, cx, camera) {
    if (!ice?.built) return;
    for (const obj of ice.built.animals) {
      const u = obj.userData;
      if (u.type === 'bear') {
        obj.rotation.y = u.yaw + Math.sin(t * 0.3 + u.berg.x) * 0.35;
        obj.scale.set(ANIMAL_SIZE.bear, ANIMAL_SIZE.bear * (1 + Math.sin(t * 1.4 + u.berg.x) * 0.012), ANIMAL_SIZE.bear);
        if (onScreen(obj.position, camera)) unlock('polar_bear');
      } else if (u.type === 'penguin') {
        obj.rotation.z = Math.sin(t * 3.2 + u.phase) * 0.12;
        obj.rotation.y = u.yaw + Math.sin(t * 0.4 + u.phase) * 0.25;
      }
    }
  }

  updateSwimmers(dt, t, cx, cy, sub) {
    const p = polarAt(cx);
    const active = p.kind === 'south' && p.amount > 0.5;
    for (const s of this.swimmers) {
      const u = s.userData;
      if (!active) {
        s.visible = false;
        u.target = null;
        continue;
      }
      const ceiling = Math.min(SURFACE_Y - 1, iceCeiling(s.position.x) - 1);
      if (!s.visible) {
        s.visible = true;
        s.position.set(cx + (Math.random() - 0.5) * 50, SURFACE_Y - 4 - Math.random() * 10, -3 - Math.random() * 10);
      }
      u.retarget -= dt;
      if (!u.target || u.retarget <= 0) {
        // Dart off to a new spot, often swooping close past the sub.
        const near = sub && Math.random() < 0.4;
        u.target = new THREE.Vector2(near ? sub.x + (Math.random() - 0.5) * 8 : cx + (Math.random() - 0.5) * 50,
          (near ? sub.y : SURFACE_Y - 3 - Math.random() * 16) + (Math.random() - 0.5) * 4);
        u.retarget = 1.5 + Math.random() * 2.5;
      }
      const want = new THREE.Vector2(u.target.x - s.position.x, u.target.y - s.position.y);
      if (want.lengthSq() > 0.01) want.setLength(6.5);
      u.vel.lerp(want, 1 - Math.exp(-dt * 2.2));
      s.position.x += u.vel.x * dt;
      s.position.y = THREE.MathUtils.clamp(s.position.y + u.vel.y * dt, floorY(s.position.x) + 2, ceiling);
      if (Math.abs(s.position.x - cx) > 60) s.position.x = cx - Math.sign(s.position.x - cx) * 55;
      // Nose along its path, flippers beating so the body rolls a little with each stroke.
      const heading = Math.atan2(u.vel.y, Math.abs(u.vel.x));
      s.rotation.set(Math.sin(t * 9 + u.phase) * 0.3, u.vel.x >= 0 ? 0 : Math.PI, heading);
      if (sub && s.position.distanceTo(new THREE.Vector3(sub.x, sub.y, s.position.z)) < 5) unlock('penguin_swim');
    }
  }

  updateSnow(dt, cx, cy) {
    const mat = this.snow.material;
    mat.opacity = 0.85 * THREE.MathUtils.smoothstep(this.cold, 0.3, 0.9);
    this.snow.visible = mat.opacity > 0.01 && cy > SURFACE_Y - 30;
    if (!this.snow.visible) return;
    const pos = this.snow.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) - dt * (9 + (i % 7));
      let y = pos.getY(i) - dt * (2.5 + (i % 5) * 0.6);
      const wobble = Math.sin(i * 1.7 + y * 0.6) * dt * 1.5;
      if (y < SURFACE_Y) y += SNOW_BOX.y;
      const rel = x - cx;
      if (rel < -SNOW_BOX.x) x += SNOW_BOX.x * 2;
      else if (rel > SNOW_BOX.x) x -= SNOW_BOX.x * 2;
      pos.setXYZ(i, x, y, pos.getZ(i) + wobble);
    }
    pos.needsUpdate = true;
  }
}

function onScreen(pos, camera) {
  const v = pos.clone().project(camera);
  return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1;
}
