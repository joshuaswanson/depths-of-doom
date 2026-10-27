import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { unlock } from './achievements.js';
import { sfx } from './audio.js';
import { spawn } from './assets.js';
import { SHELF_Y, SURFACE_Y, darkness } from './water.js';
import { floorY } from './world.js';
import { BearMind, PenguinMind, rigBear, rigPenguin, swimStroke } from './critters.js';
import { fbm, iceBlock, iceMaterial, jaggedOutline, polygonReach, undersideAlong } from './ice.js';

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

// An iceberg: either tabular, a slab with sheer cliffs and a nearly flat snowy top, or weathered into a dome. Most
// of its bulk hides under the water in a broad, rounded keel.
function iceberg(r, width, depth, top, draft, segments) {
  const tabular = r() < 0.55;
  const dome = tabular ? 0.06 + r() * 0.08 : 0.45 + r() * 0.6;
  return iceBlock(r, {
    reach: jaggedOutline(r, 5 + Math.floor(r() * 4), tabular ? 0.22 : 0.32),
    width, depth, top: top / (1 + dome), draft, dome, bulge: 0.08 + r() * 0.22, blunt: 2.2 + r() * 1.6,
    lean: (r() - 0.5) * 0.5, rough: 0.9 + r() * 0.5, segments,
  });
}

let iceMaterialShared = null;
function iceMat() {
  iceMaterialShared ??= iceMaterial();
  return iceMaterialShared;
}

// Bergs in the sub's lane and ones far behind it.
const LANE_Z = 0;
const BACK_Z = [-70, -24];

// The ice over one polar shelf: where every berg floats and how big it is, the animals on top, and, for bergs in
// the sub's lane, the height of the ice's underside along the lane.
// Laid out a little at a time: the generator yields after each costly step.
function* layoutIce(s, ice) {
  const r = seeded(s.index * 7919 + 17);
  const kind = biomeOf(s.index);
  const from = s.start + ICE_INSET;
  const to = s.end - ICE_INSET;
  const middle = (s.start + s.end) / 2;
  const span = to - from;
  // Stretches of the lane kept clear of bergs: a field of thin pack ice to smash through in the north, and flat floes
  // crowded with penguins in the south.
  const field = kind === 'north' ? { start: middle - Math.min(22, span * 0.19), end: middle + Math.min(22, span * 0.19) } : null;
  const floes = kind === 'south'
    ? [0.28, 0.72].map((f) => ({ x: from + span * f, width: 8 + r() * 3, depth: 5 + r() * 2, seed: Math.floor(r() * 1e9) }))
    : [];
  const reserved = [...(field ? [[field.start - 2, field.end + 2]] : []),
    ...floes.map((f) => [f.x - f.width / 2 - 5, f.x + f.width / 2 + 5])];
  const bergs = [];
  const place = (b, x) => {
    Object.assign(b, iceberg(seeded(b.seed), b.width, b.depth, b.top, b.draft, b.lane ? 96 : 112));
    const box = b.geometry.boundingBox;
    b.x = x - box.min.x;
    b.left = b.x + box.min.x;
    b.right = b.x + box.max.x;
    bergs.push(b);
    return b.right;
  };
  for (let x = from; x < to;) {
    const clash = reserved.find(([a, b]) => x + 4 > a && x < b);
    if (clash) {
      x = clash[1];
      continue;
    }
    const room = (reserved.find(([a]) => a > x)?.[0] ?? to) - x;
    // The keel spreads out wider than the berg's top, so the top is sized to leave the whole berg room to fit.
    const width = Math.min(9 + r() * 20, Math.max(3, room / 1.45));
    const right = place({ z: LANE_Z + (r() - 0.5) * 2, width, depth: 6 + r() * 6, top: 1.6 + r() * 3,
      draft: Math.min(5 + r() * 8, width * 0.9), seed: Math.floor(r() * 1e9), lane: true }, x);
    yield;
    // Leads of open water between the bergs, where the sub can come up for air.
    x = right + (r() < 0.35 ? 8 + r() * 10 : 1.5 + r() * 3);
  }
  for (let x = from - 6; x < to - 10;) {
    const width = Math.min(18 + r() * 34, to + 6 - x);
    const right = place({ z: BACK_Z[0] + r() * (BACK_Z[1] - BACK_Z[0]), width, depth: 10 + r() * 16,
      top: 3 + r() * 9, draft: 6 + r() * 9, seed: Math.floor(r() * 1e9), lane: false }, x);
    yield;
    x = right - width * (0.2 + r() * 0.5);
  }
  for (const b of bergs) {
    if (!b.lane) continue;
    b.underside = measureUnderside(b);
    yield;
  }
  // Polar bears roam the bigger northern bergs, and one prowls the big floe in the pack ice where the igloo stands;
  // penguins crowd the southern bergs in groups.
  const animals = [];
  const roomy = bergs.filter((b) => b.width > 10 && b.z > BACK_Z[0] + 10);
  if (kind === 'north') {
    // The igloo's floe sits just behind the lane, where a sub breaking through comes up beside it.
    field.home = { x: (field.start + field.end) / 2 + (r() - 0.5) * 6, z: -11, topAt: () => PACK_TOP };
    animals.push({ type: 'igloo', berg: field.home, dx: -2.2, dz: -0.5 });
    animals.push({ type: 'bear', berg: field.home, dx: 1.5, dz: 2.2, range: 2.2 });
    for (const b of roomy) {
      if (r() > 0.5) continue;
      animals.push({ type: 'bear', berg: b, dx: (r() - 0.5) * b.width * 0.2, dz: (r() - 0.5) * b.depth * 0.12,
        range: b.width * 0.22 });
    }
  } else {
    for (const b of roomy) {
      if (r() > 0.6) continue;
      const count = 3 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        animals.push({ type: 'penguin', berg: b, dx: (r() - 0.5) * b.width * 0.35, dz: (r() - 0.5) * b.depth * 0.25,
          yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3, range: Math.min(2.5, b.width * 0.12) });
      }
    }
  }
  for (const f of floes) {
    const fr = seeded(f.seed);
    Object.assign(f, iceBlock(fr, {
      reach: jaggedOutline(fr, 6 + Math.floor(fr() * 4), 0.38), width: f.width, depth: f.depth, top: FLOE_TOP,
      draft: FLOE_DRAFT, dome: 0.25, bulge: 0, blunt: 4, rough: 0.4, segments: 72, capRows: 6, cliffRows: 2, keelRows: 5,
    }));
    const box = f.geometry.boundingBox;
    f.half = Math.max(-box.min.x, box.max.x);
    // The floe drifts when rammed, but only as far as the bergs either side of it.
    const lane = bergs.filter((b) => b.lane);
    f.room = [Math.max(-Infinity, ...lane.filter((b) => b.right <= f.x).map((b) => b.right)) + 0.4,
      Math.min(Infinity, ...lane.filter((b) => b.left >= f.x).map((b) => b.left)) - 0.4];
    const count = 5 + Math.floor(r() * 4);
    f.penguins = Array.from({ length: count }, () => ({ dx: (r() - 0.5) * f.width * 0.5, dz: (r() - 0.5) * f.depth * 0.35,
      yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3 }));
    yield;
  }
  Object.assign(ice, { kind, bergs, animals, field, floes, ready: true });
}

// Run a generator's steps until it finishes or the time runs out; true once it has finished.
function runUntil(steps, deadline) {
  while (performance.now() < deadline) if (steps.next().done) return true;
  return false;
}

function drain(steps) {
  while (!steps.next().done);
}

// The height of a lane berg's underside at each step across the lane.
const UNDERSIDE_STEP = 0.5;
function measureUnderside(b) {
  const x0 = b.left - 1;
  const count = Math.ceil((b.right - b.left + 2) / UNDERSIDE_STEP) + 1;
  const samples = undersideAlong(b.geometry, LANE_Z - b.z, x0 - b.x, UNDERSIDE_STEP, count).map((y) => y + SURFACE_Y);
  return { x0, samples };
}

const layouts = new Map();

// The ice laid out so far, by shelf index.
export function iceLayouts() {
  return layouts;
}

// The ice over a shelf. Asked for `now`, it is finished on the spot; otherwise it may still be being laid out.
function iceFor(s, now = true) {
  let ice = layouts.get(s.index);
  if (!ice) {
    ice = { shelf: s, ready: false, built: null, building: null };
    ice.steps = layoutIce(s, ice);
    layouts.set(s.index, ice);
  }
  if (now && !ice.ready) drain(ice.steps);
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

// One snow block: a patch of a curved surface, `point(u, v, inset)`, its edges rounded off so the joints between
// neighbouring blocks show as grooves. `out` is the way the surface faces at a point.
function snowBlock(point, out, u0, u1, v0, v1, nu, nv, bevel) {
  const positions = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const fu = i / nu;
      const fv = j / nv;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const p = point(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv, bevel * (1 - Math.min(1, edge * 4)) ** 2);
      positions.push(p.x, p.y, p.z);
    }
  }
  const index = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      index.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  const p = (k) => new THREE.Vector3().fromArray(positions, index[k] * 3);
  const n = new THREE.Vector3().crossVectors(p(1).sub(p(0)), p(2).sub(p(0)));
  if (n.dot(out(p(0))) < 0) {
    for (let k = 0; k < index.length; k += 3) [index[k + 1], index[k + 2]] = [index[k + 2], index[k + 1]];
    geo.setIndex(index);
  }
  geo.computeVertexNormals();
  return geo;
}

// The igloo: a dome of snow blocks laid in a rising spiral, with a tunnel of blocks for an entrance. Packed snow shows
// in the joints between them.
const IGLOO_RADIUS = 2.2;
const TUNNEL = { radius: 0.9, from: 1.75, to: 3.35 };
function iglooBlocks() {
  const r = seeded(99);
  const R = IGLOO_RADIUS;
  const dome = (u, v, inset) => new THREE.Vector3(Math.cos(v) * Math.cos(u), Math.sin(v) * 0.94, Math.cos(v) * Math.sin(u))
    .multiplyScalar(R - inset);
  const tunnel = (u, v, inset) => new THREE.Vector3(Math.cos(u) * (TUNNEL.radius - inset),
    Math.sin(u) * (TUNNEL.radius - inset) * 1.05, v);
  const blocks = [];
  const rings = 6;
  const gap = 0.025;
  for (let k = 0; k < rings; k++) {
    const v0 = (k / rings) * (Math.PI / 2) * 0.9;
    const v1 = ((k + 1) / rings) * (Math.PI / 2) * 0.9;
    const count = Math.max(4, Math.round(17 * Math.cos((v0 + v1) / 2)));
    const twist = k * 0.41 + r() * 0.2;
    for (let i = 0; i < count; i++) {
      const u0 = twist + (i / count) * Math.PI * 2;
      const u1 = twist + ((i + 1) / count) * Math.PI * 2;
      // Leave the doorway open where the tunnel meets the dome.
      const mid = ((((u0 + u1) / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (k < 2 && Math.abs(mid - Math.PI / 2) < 0.32) continue;
      blocks.push(snowBlock(dome, (p) => p, u0 + gap / Math.cos(v0), u1 - gap / Math.cos(v0), v0 + gap, v1 - gap,
        6, 4, 0.07));
    }
  }
  blocks.push(snowBlock(dome, (p) => p, 0, Math.PI * 2, Math.PI / 2 * 0.9 + gap, Math.PI / 2, 24, 3, 0));
  for (let k = 0; k < 2; k++) {
    const v0 = TUNNEL.from + ((TUNNEL.to - TUNNEL.from) * k) / 2;
    const v1 = TUNNEL.from + ((TUNNEL.to - TUNNEL.from) * (k + 1)) / 2;
    for (let i = 0; i < 5; i++) {
      const shift = k % 2 ? 0.5 : 0;
      const u0 = Math.max(0, ((i - shift) / 5) * Math.PI);
      const u1 = Math.min(Math.PI, ((i + 1 - shift) / 5) * Math.PI);
      blocks.push(snowBlock(tunnel, (p) => new THREE.Vector3(p.x, p.y, 0), u0 + gap, u1 - gap, v0 + gap, v1 - gap,
        5, 4, 0.06));
    }
  }
  return mergeGeometries(blocks);
}

let iglooShell = null;
let iglooSnow = null;
function makeIgloo() {
  iglooSnow ??= iceMaterial({ name: 'igloo_snow', snow: true });
  iglooShell ??= iglooBlocks();
  const R = IGLOO_RADIUS;
  const group = new THREE.Group();
  const shell = new THREE.Mesh(iglooShell, iglooSnow);
  const joints = new THREE.MeshStandardMaterial({ color: '#a9bfcf', roughness: 1 });
  const inner = new THREE.Mesh(new THREE.SphereGeometry(R - 0.06, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), joints);
  inner.scale.y = 0.94;
  const tunnelGeo = new THREE.CylinderGeometry(TUNNEL.radius - 0.05, TUNNEL.radius - 0.05, TUNNEL.to - TUNNEL.from + 0.6,
    32, 1, true, -Math.PI / 2, Math.PI);
  tunnelGeo.rotateX(Math.PI / 2);
  const tunnelInner = new THREE.Mesh(tunnelGeo, joints);
  tunnelInner.position.z = (TUNNEL.from + TUNNEL.to) / 2 - 0.3;
  tunnelInner.scale.y = 1.05;
  const door = new THREE.Mesh(new THREE.CircleGeometry(TUNNEL.radius - 0.08, 32, 0, Math.PI),
    new THREE.MeshBasicMaterial({ color: '#0c151d' }));
  door.position.z = TUNNEL.from + 0.2;
  door.scale.y = 1.05;
  group.add(shell, inner, tunnelInner, door);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = o !== door;
  });
  return group;
}

const ANIMAL_SIZE = { bear: 3.2, penguin: 0.85 };

// How far below an animal's origin its feet are, at the size it stands in the game.
const footCache = {};
function footOf(type, obj) {
  if (footCache[type] === undefined) {
    obj.updateMatrixWorld(true);
    footCache[type] = obj.position.y - new THREE.Box3().setFromObject(obj).min.y;
  }
  return footCache[type];
}

function makeAnimal(a) {
  if (a.type === 'igloo') return makeIgloo();
  const obj = spawn(a.type === 'bear' ? 'polar_bear' : 'penguin');
  obj.scale.setScalar(ANIMAL_SIZE[a.type]);
  obj.userData.rig = a.type === 'bear' ? rigBear(obj) : rigPenguin(obj);
  obj.userData.foot = footOf(a.type, obj);
  return obj;
}

// Built a little at a time, like the layout.
function* buildIce(ice, scene) {
  const group = new THREE.Group();
  for (const b of ice.bergs) {
    const mesh = new THREE.Mesh(b.geometry, iceMat());
    mesh.position.set(b.x, SURFACE_Y, b.z);
    mesh.castShadow = b.draft > 2;
    group.add(mesh);
  }
  yield;
  let field = null;
  if (ice.field) {
    field = new PackIce(ice.field, group);
    yield* field.build();
  }
  const animals = ice.animals.map((a) => {
    const obj = makeAnimal(a);
    const u = { ...a, rig: obj.userData.rig, foot: obj.userData.foot ?? 0 };
    obj.userData = u;
    if (a.type === 'bear') {
      obj.rotation.order = 'YZX';
      u.mind = new BearMind(u, a.range);
    } else if (a.type === 'penguin') {
      obj.rotation.order = 'YXZ';
      u.mind = new PenguinMind(u, a.range);
    }
    group.add(obj);
    placeAnimal(obj);
    return obj;
  });
  yield;
  const floes = [];
  for (const f of ice.floes) {
    floes.push(new Floe(f, group));
    yield;
  }
  scene.add(group);
  ice.built = { group, animals, field, floes };
}

// Feet on the snow, following its rise and fall; a bear tips its body to the slope under it.
function placeAnimal(obj) {
  const u = obj.userData;
  const b = u.berg;
  const ground = b.topAt(u.dx, u.dz);
  obj.position.set(b.x + u.dx, SURFACE_Y + ground + u.foot + (u.bob ?? 0), b.z + u.dz);
  if (u.type === 'bear') {
    const fx = Math.cos(u.yaw) * 1.2;
    const fz = -Math.sin(u.yaw) * 1.2;
    const rise = b.topAt(u.dx + fx, u.dz + fz) - b.topAt(u.dx - fx, u.dz - fz);
    obj.rotation.set(0, u.yaw, THREE.MathUtils.clamp(Math.atan2(rise, 2.4), -0.25, 0.25));
  } else if (u.type === 'penguin') {
    obj.rotation.set(u.roll ?? 0, u.yaw, 0);
  }
}

// A field of pack ice: loose floes of every size jostling at the surface, packed tight in the middle and breaking up
// into stragglers toward its ragged edges, with leads of dark water between them. Floes in the sub's lane shatter
// into chunks when the hull drives into them, opening a channel like an icebreaker's.
const PACK_TOP = 0.16;
const PACK_DRAFT = 0.42;
const PACK_DEPTH = [-24, 3.4];
const LANE_HALF = 2.7;
const CHUNKS = 260;
const HOME_RADIUS = 6.2;
let shardGeometry = null;
let packMaterial = null;

// Keep the part of a polygon where n·p <= c.
function clipPolygon(poly, nx, nz, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * nz - c;
    const db = b[0] * nx + b[1] * nz - c;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Where each floe of a field lies: its middle, rough size and outline.
function* packLayout(field, depth, out) {
  const r = seeded(Math.floor(field.start * 13) + 5);
  const seeds = field.home ? [{ x: field.home.x, z: field.home.z, rad: HOME_RADIUS, home: true }] : [];
  const width = field.end - field.start;
  const tries = Math.round(width * (depth[1] - depth[0]) * 3);
  for (let k = 0; k < tries; k++) {
    const x = field.start - 8 + r() * (width + 16);
    const z = depth[0] + r() * (depth[1] - depth[0]);
    // The field's ragged sides, beyond which only a few stragglers drift.
    const inside = Math.min(x - field.start - fbm(z * 0.07, 1.3, 0.5) * 12, field.end + fbm(z * 0.07, 7.1, 2.5) * 12 - x);
    if (inside < 0 && r() > 0.15 * Math.exp(inside / 3)) continue;
    if (z > depth[1] - 1.8 + fbm(x * 0.09, 3.3, 8.1) * 4) continue;
    const lane = Math.abs(z) < LANE_HALF + 1;
    const big = 0.5 + fbm(x * 0.06, z * 0.06, 4.4);
    const rad = lane ? 0.6 + r() * 0.75 : 0.6 + r() * r() * 1.4 + big * 1.4;
    if (k % 400 === 0) yield;
    if (seeds.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < ((s.rad + rad) * 0.8) ** 2)) continue;
    seeds.push({ x, z, rad });
  }
  // Each floe takes the patch of sea nearer its middle than any other's, weighted by size so the big ones hold more,
  // less a narrow lead of open water all round.
  for (const [n, s] of seeds.entries()) {
    if (n % 40 === 0) yield;
    let poly = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const k = s.rad * (s.home ? 1.02 : 1.05 + r() * 0.3);
      return [s.x + Math.cos(a) * k, s.z + Math.sin(a) * k];
    });
    const gap = 0.05 + r() * 0.14;
    for (const o of seeds) {
      if (o === s) continue;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > ((s.rad + o.rad) * 1.7) ** 2) continue;
      const d = Math.sqrt(d2);
      const t = (d2 + s.rad * s.rad - o.rad * o.rad) / (2 * d) - gap / 2;
      poly = clipPolygon(poly, dx / d, dz / d, (s.x * dx + s.z * dz) / d + t);
    }
    s.poly = poly;
  }
  out.push(...seeds.filter((s) => s.poly.length >= 3));
}

class PackIce {
  constructor(field, group, depth = PACK_DEPTH) {
    this.field = field;
    this.group = group;
    this.depth = depth;
  }

  // Lays out and builds the floes a few at a time, yielding between batches.
  *build() {
    const { field, group, depth } = this;
    shardGeometry ??= iceBlock(seeded(3), {
      reach: jaggedOutline(seeded(4), 5, 0.5), width: 1, depth: 0.8, top: 0.22, draft: 0.4, dome: 0.2, bulge: 0,
      blunt: 3, rough: 0.6, topRough: 0.4, segments: 16, capRows: 2, cliffRows: 1, keelRows: 3,
    }).geometry;
    packMaterial ??= iceMaterial({ name: 'pack_ice', bob: true });
    const r = seeded(Math.floor(field.start * 7) + 3);
    this.plates = [];
    const parts = [];
    let start = 0;
    const seeds = [];
    yield* packLayout(field, depth, seeds);
    for (const [n, s] of seeds.entries()) {
      if (n % 24 === 0) yield;
      const cx = s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length;
      const cz = s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
      const corners = s.poly.map(([x, z]) => [((Math.atan2(z - cz, x - cx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
        Math.hypot(x - cx, z - cz)]).sort((a, b) => a[0] - b[0]);
      const reach = Math.max(...corners.map((c) => c[1]));
      const block = iceBlock(r, {
        reach: polygonReach(corners), width: 2, depth: 2, top: PACK_TOP * (0.8 + r() * 0.5),
        draft: PACK_DRAFT * (0.8 + r() * 0.5), dome: 0.3, bulge: 0, blunt: 4, rough: 0.3, topRough: 0.45,
        segments: Math.min(56, Math.round(14 + reach * 7)), capRows: s.home ? 6 : 2, cliffRows: 1, keelRows: 2,
      });
      const geo = block.geometry;
      geo.translate(cx, 0, cz);
      const count = geo.attributes.position.count;
      const plate = new Float32Array(count * 4);
      const phase = r() * 6.3;
      for (let i = 0; i < count; i++) plate.set([cx, cz, s.home ? 0 : 1, phase], i * 4);
      geo.setAttribute('aPlate', new THREE.BufferAttribute(plate, 4));
      parts.push(geo);
      const indices = geo.index.count;
      this.plates.push({ x: cx, z: cz, rad: reach, start, count: indices, broken: false,
        breakable: !s.home && Math.abs(cz) < reach + 1.1 });
      start += indices;
      if (s.home && field.home) field.home.topAt = (dx, dz) => block.topAt(field.home.x + dx - cx, field.home.z + dz - cz);
    }
    const merged = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    this.mesh = new THREE.Mesh(merged, packMaterial);
    this.mesh.position.y = SURFACE_Y;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.chunks = Array.from({ length: CHUNKS }, () => ({ active: false }));
    this.chunkMesh = new THREE.InstancedMesh(shardGeometry, iceMat(), CHUNKS);
    this.chunkMesh.frustumCulled = false;
    this.nextChunk = 0;
    this.broken = 0;
    this.lastCrack = 0;
    group.add(this.mesh, this.chunkMesh);
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.euler = new THREE.Euler();
    this.scaleV = new THREE.Vector3();
    this.posV = new THREE.Vector3();
    this.idle = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < CHUNKS; i++) this.chunkMesh.setMatrixAt(i, this.idle);
  }

  update(dt, t, hull, effects) {
    packMaterial.userData.time.value = t;
    let crushing = false;
    if (hull) {
      const c = hull.center;
      const e = hull.extents;
      const top = hull.top;
      if (c.x > this.field.start - 20 && c.x < this.field.end + 20 && top > SURFACE_Y - PACK_DRAFT - 0.2) {
        for (const p of this.plates) {
          if (!p.breakable || p.broken || Math.abs(p.x - c.x) > e.hx + p.rad * 0.7) continue;
          // Only floes the hull actually reaches: the rounded top rises highest amidships.
          const along = THREE.MathUtils.clamp((p.x - c.x) / e.hx, -1, 1);
          if (c.y + e.hy * Math.sqrt(1 - along * along) < SURFACE_Y - PACK_DRAFT) continue;
          this.shatter(p, hull, effects);
          crushing = true;
        }
        // Grinding through the ice drags on the sub, a little.
        if (crushing) hull.vel.multiplyScalar(Math.exp(-dt * 2.2));
      }
    }
    let any = false;
    const m = this.matrix;
    this.chunks.forEach((k, i) => {
      if (!k.active) return;
      any = true;
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
      if (k.life > 22) {
        k.active = false;
        this.chunkMesh.setMatrixAt(i, this.idle);
        return;
      }
      this.euler.set(k.rx, k.yaw, k.rz);
      m.compose(this.posV.set(k.x, k.y, k.z), this.quat.setFromEuler(this.euler),
        this.scaleV.set(k.size * k.sx0, k.size, k.size * k.sz0));
      this.chunkMesh.setMatrixAt(i, m);
    });
    if (any || this.dirty) this.chunkMesh.instanceMatrix.needsUpdate = true;
    this.dirty = any;
  }

  shatter(p, hull, effects) {
    p.broken = true;
    const index = this.mesh.geometry.index;
    index.array.fill(0, p.start, p.start + p.count);
    index.addUpdateRange(p.start, p.count);
    index.needsUpdate = true;
    this.broken++;
    if (this.broken >= 40) unlock('icebreaker');
    const v = hull.vel;
    const pieces = Math.min(7, 2 + Math.round(p.rad * 2.5));
    for (let k = 0; k < pieces; k++) {
      const chunk = this.chunks[this.nextChunk];
      this.nextChunk = (this.nextChunk + 1) % CHUNKS;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * p.rad * 0.7;
      Object.assign(chunk, {
        active: true, life: 0, x: p.x + Math.cos(a) * d, y: SURFACE_Y, z: p.z + Math.sin(a) * d,
        vx: v.x * 0.5 + (Math.random() - 0.5) * 2.5, vy: 1.2 + Math.random() * 2.2 + Math.max(0, v.y) * 0.4,
        vz: Math.sign(p.z || Math.random() - 0.5) * (0.8 + Math.random() * 2.2), yaw: Math.random() * 6.3,
        rx: 0, rz: 0, sx: (Math.random() - 0.5) * 8, sz: (Math.random() - 0.5) * 8,
        size: (0.45 + Math.random() * 0.5) * Math.min(1.2, p.rad * 0.8), sx0: 0.7 + Math.random() * 0.6,
        sz0: 0.7 + Math.random() * 0.6,
      });
    }
    effects?.splash({ x: p.x, y: SURFACE_Y, z: p.z }, 0.6 + p.rad * 0.3);
    const now = performance.now();
    if (now - this.lastCrack > 90) {
      this.lastCrack = now;
      sfx.iceCrack();
    }
  }
}

// A flat floe crowded with penguins. Ram it and it bucks and tips, and the penguins go flying or slide off into the
// sea, then swim away.
const FLOE_TOP = 0.45;
const FLOE_TIP = 0.38;
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
    this.penguins = spec.penguins.map((spot) => {
      const obj = makeAnimal({ type: 'penguin' });
      obj.rotation.order = 'YXZ';
      group.add(obj);
      const p = { ...spot, obj, rig: obj.userData.rig, foot: obj.userData.foot, state: 'stand', vel: new THREE.Vector3(),
        spinVel: new THREE.Vector3() };
      p.mind = new PenguinMind(p, Math.min(1.2, spec.width * 0.12));
      return p;
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
      const half = this.spec.half;
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
    // The floe rights itself and settles back on the water like a cork. It never tips far: its edge digs into the
    // water and stops it.
    this.spin += (-this.tilt * 9 - this.spin * 2.2) * dt;
    this.tilt += this.spin * dt;
    if (Math.abs(this.tilt) > FLOE_TIP) {
      this.tilt = Math.sign(this.tilt) * FLOE_TIP;
      this.spin *= -0.3;
    }
    this.vy += (-this.lift * 14 - this.vy * 3) * dt;
    this.lift += this.vy * dt;
    this.vx += ((this.home - this.x) * 0.15 - this.vx * 0.8) * dt;
    this.x += this.vx * dt;
    // Bumping a berg stops it.
    const [left, right] = this.spec.room;
    if (this.x - this.spec.half < left) {
      this.x = left + this.spec.half;
      this.vx = Math.abs(this.vx) * 0.25;
    } else if (this.x + this.spec.half > right) {
      this.x = right - this.spec.half;
      this.vx = -Math.abs(this.vx) * 0.25;
    }
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
      p.mind.update(dt, t, p.rig);
      // A steep tilt sends them sliding down toward the low edge and over it.
      p.dx += -Math.sin(this.tilt) * Math.max(0, Math.abs(this.tilt) - 0.18) * 14 * dt;
      this.local.set(p.dx, this.spec.topAt(p.dx, p.dz) + p.foot + p.bob, p.dz);
      this.mesh.localToWorld(obj.position.copy(this.local));
      obj.rotation.set(p.roll, p.yaw, this.tilt);
      if (Math.abs(p.dx) > this.spec.half * 0.85) {
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
      // Flippers flung out and flailing.
      p.rig.uDrop.value = -0.2 + Math.sin(t * 22) * 0.3;
      if (obj.position.y < SURFACE_Y - 0.3) {
        p.state = 'swim';
        p.swimTime = 0;
        p.dir = Math.sign(p.vel.x || 1);
        p.depth = SURFACE_Y - 1.6 - Math.random() * 1.6;
        effects?.splash({ x: obj.position.x, y: SURFACE_Y, z: obj.position.z }, 0.7);
        sfx.splash();
        this.knocked = (this.knocked ?? 0) + 1;
        if (this.knocked >= 3) unlock('penguin_bowl');
      }
      return;
    }
    if (p.state === 'swim') {
      // Bobbing back up from the plunge, then off and away, belly down, beating hard.
      p.swimTime += dt;
      const speed = Math.min(6, p.swimTime * 4);
      obj.position.x += p.dir * speed * dt;
      const climb = (p.depth - obj.position.y) * (1 - Math.exp(-dt * 2));
      obj.position.y += climb;
      const pitch = Math.atan2(climb / Math.max(dt, 1e-3), Math.max(speed, 0.5)) * 0.6;
      obj.rotation.set(0, p.dir > 0 ? 0 : Math.PI, 0);
      obj.rotateZ(-Math.PI / 2 + pitch);
      if (swimStroke(p.rig, p, dt, speed / 6)) jet(effects, obj.position, p.dir, pitch);
      if (p.swimTime > 6) {
        p.state = 'gone';
        obj.visible = false;
      }
    }
  }
}

// A little jet of bubbles thrown back off a swimming penguin's tail as its flippers sweep down.
function jet(effects, pos, dir, pitch) {
  if (!effects) return;
  const back = { x: -dir * Math.cos(pitch), y: -Math.sin(pitch) };
  const tail = { x: pos.x + back.x * 0.65, y: pos.y + back.y * 0.65, z: pos.z };
  effects.bubbleStreak(tail, { x: -back.x, y: -back.y }, 1.1);
  for (let i = 0; i < 3; i++) {
    effects.bubble(tail, { spread: 0.08, size: [0.05, 0.12], vel: { x: back.x * 2.5, y: back.y * 2.5 }, life: [0.5, 1] });
  }
}

function dropIce(ice, scene) {
  ice.building = null;
  if (!ice.built) return;
  scene.remove(ice.built.group);
  ice.built = null;
}

// Penguins diving and darting through the water under the southern ice.
const SWIMMERS = 5;

function makeSwimmers(scene) {
  return Array.from({ length: SWIMMERS }, () => {
    const holder = new THREE.Group();
    const body = makeAnimal({ type: 'penguin' });
    // Lying along its line of travel: head forward, belly down.
    body.rotation.z = -Math.PI / 2;
    holder.add(body);
    holder.visible = false;
    // Roll about its own length first, then pitch, then face left or right.
    holder.rotation.order = 'YZX';
    holder.userData = { body, rig: body.userData.rig, vel: new THREE.Vector2(), target: null, phase: Math.random() * 6,
      retarget: 0 };
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

// Tiny ice crystals hanging in the cold water, catching the light as they drift.
const CRYSTAL_COUNT = 900;
const CRYSTAL_BOX = { x: 44, y: 34, z: 40 };

function makeCrystals(scene) {
  const positions = new Float32Array(CRYSTAL_COUNT * 3);
  for (let i = 0; i < CRYSTAL_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * CRYSTAL_BOX.x * 2;
    positions[i * 3 + 1] = SURFACE_Y - Math.random() * CRYSTAL_BOX.y;
    positions[i * 3 + 2] = 8 - Math.random() * CRYSTAL_BOX.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(200,235,255,0.7)');
  grad.addColorStop(1, 'rgba(160,210,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(canvas), transparent: true,
    depthWrite: false, opacity: 0, color: '#bfe6ff', blending: THREE.AdditiveBlending });
  const crystals = new THREE.Points(geo, mat);
  crystals.frustumCulled = false;
  crystals.renderOrder = 3;
  scene.add(crystals);
  return crystals;
}

// Milliseconds a frame may spend laying out and building the ice of a pole that is coming up.
const BUILD_BUDGET = 3;

export class Polar {
  constructor(scene) {
    this.scene = scene;
    this.swimmers = makeSwimmers(scene);
    this.snow = makeSnow(scene);
    this.crystals = makeCrystals(scene);
    // One of each kind of polar object, hidden: the loading screen's warm-up draws them so their shaders are ready
    // before the first pole scrolls into view.
    const sample = new THREE.Group();
    sample.add(new THREE.Mesh(iceberg(seeded(1), 4, 3, 1, 2, 16).geometry, iceMat()));
    drain(new PackIce({ start: 0, end: 8 }, sample, [-2, 2]).build());
    sample.add(makeIgloo(), makeAnimal({ type: 'bear' }), makeAnimal({ type: 'penguin' }));
    sample.visible = false;
    scene.add(sample);
    this.warmers = [sample, this.snow, this.crystals];
    this.cold = 0;
    this.kind = null;
  }

  update(dt, t, cx, cy, sub, camera, hull, effects) {
    const p = polarAt(cx);
    this.cold = p.amount;
    this.kind = p.kind;
    // Build the ice of any polar shelf near the view, and let go of any that has scrolled well away.
    // The work is spread over frames, a few milliseconds at a time, while the sub crosses the trench toward it.
    const near = shelfNear(cx);
    const wanted = new Set();
    const deadline = performance.now() + BUILD_BUDGET;
    for (const s of [shelf(near.index - 1), near, shelf(near.index + 1)]) {
      if (biomeOf(s.index) === 'reef') continue;
      if (cx < s.start - 140 || cx > s.end + 140) continue;
      wanted.add(s.index);
      const ice = iceFor(s, false);
      if (!ice.ready && !runUntil(ice.steps, deadline)) continue;
      if (!ice.built) {
        ice.building ??= buildIce(ice, this.scene);
        runUntil(ice.building, deadline);
      }
    }
    for (const [index, ice] of layouts) {
      if (!wanted.has(index)) dropIce(ice, this.scene);
      if (!wanted.has(index) && Math.abs(index - near.index) > 3) layouts.delete(index);
    }
    for (const index of wanted) {
      const ice = layouts.get(index);
      if (!ice.built) continue;
      this.animate(ice, dt, t, cx, camera);
      ice.built.field?.update(dt, t, hull, effects);
      for (const floe of ice.built.floes) floe.update(dt, t, hull, effects);
    }
    this.updateSwimmers(dt, t, cx, cy, sub, effects);
    this.updateSnow(dt, cx, cy);
    this.updateCrystals(dt, t, cx, cy);
    if (sub && p.amount > 0.9) {
      unlock(p.kind === 'north' ? 'north_pole' : 'south_pole');
    }
  }

  // Bears plod about their bergs and penguins go about their business, while near enough to be seen.
  animate(ice, dt, t, cx, camera) {
    if (!ice?.built) return;
    for (const obj of ice.built.animals) {
      const u = obj.userData;
      if (!u.mind || Math.abs(obj.position.x - cx) > 70) continue;
      u.mind.update(dt, t, u.rig);
      placeAnimal(obj);
      if (u.type === 'bear' && onScreen(obj.position, camera)) unlock('polar_bear');
    }
  }

  updateSwimmers(dt, t, cx, cy, sub, effects) {
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
      const effort = THREE.MathUtils.clamp(u.vel.length() / 6.5, 0, 1);
      const beat = swimStroke(u.rig, u, dt, effort);
      s.rotation.set(Math.sin(u.stroke) * 0.12, u.vel.x >= 0 ? 0 : Math.PI, heading);
      if (beat && effort > 0.3) jet(effects, s.position, Math.sign(u.vel.x) || 1, heading);
      if (sub && s.position.distanceTo(new THREE.Vector3(sub.x, sub.y, s.position.z)) < 5) unlock('penguin_swim');
    }
  }

  updateCrystals(dt, t, cx, cy) {
    const mat = this.crystals.material;
    mat.opacity = 0.75 * THREE.MathUtils.smoothstep(this.cold, 0.2, 0.8) * (1 - darkness(cy));
    this.crystals.visible = mat.opacity > 0.01 && cy < SURFACE_Y + 6;
    if (!this.crystals.visible) return;
    const pos = this.crystals.geometry.attributes.position;
    const top = SURFACE_Y - 0.3;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + Math.sin(t * 0.3 + i) * 0.15 * dt - 0.25 * dt;
      let y = pos.getY(i) + (0.05 + (i % 5) * 0.03) * dt;
      if (y > top) y -= CRYSTAL_BOX.y;
      if (y < cy - CRYSTAL_BOX.y * 0.6) y += CRYSTAL_BOX.y;
      else if (y > cy + CRYSTAL_BOX.y * 0.6) y -= CRYSTAL_BOX.y;
      const rel = x - cx;
      if (rel < -CRYSTAL_BOX.x) x += CRYSTAL_BOX.x * 2;
      else if (rel > CRYSTAL_BOX.x) x -= CRYSTAL_BOX.x * 2;
      pos.setXY(i, x, Math.min(y, top));
    }
    pos.needsUpdate = true;
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
