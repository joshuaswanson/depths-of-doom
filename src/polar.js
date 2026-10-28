import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { unlock } from './achievements.js';
import { sfx } from './audio.js';
import { spawn, spawnSkinned } from './assets.js';
import { SHELF_Y, SURFACE_Y, darkness } from './water.js';
import { floorY } from './world.js';
import { BearMind, LAY_FLAT, PenguinMind, rigBear, rigPenguin, steerSwimmer, swimStroke, swimmerBack } from './critters.js';
import { fbm, iceBlock, iceMaterial, jaggedOutline, polygonReach, sliceAlong } from './ice.js';

// Shelves are numbered outward from the one the dive starts on. Going right from the start, the first wide shelf
// is the North Pole, the next wide one after a reef the South Pole, and so on round again; going left the South Pole
// comes first.
const SCAN_STEP = 4;
const POLE_MIN_WIDTH = 140;
// The cold creeps in gradually: it starts far out over the trench before a polar shelf and has set in fully some way
// onto the shelf, measured from the shelf's edge. The shelf's first stretch is open water, and the ice starts after.
const POLAR_EDGE = [-90, 50];
const ICE_INSET = 44;

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

// How cold the water is at x, from 0 in the open sea to 1 over the middle of a polar shelf, and which pole's cold it
// is; `shelf` is the polar shelf when that is the nearest shelf to x.
const polarCache = new Map();
export function polarAt(x) {
  const key = Math.round(x);
  let p = polarCache.get(key);
  if (p) return p;
  const s = shelfNear(x);
  let into = -Infinity;
  let pole = null;
  for (const c of [shelf(s.index - 1), s, shelf(s.index + 1)]) {
    const d = Math.min(x - c.start, c.end - x);
    if (biomeOf(c.index) !== 'reef' && d > into) {
      into = d;
      pole = c;
    }
  }
  const amount = pole ? THREE.MathUtils.smoothstep(into, POLAR_EDGE[0], POLAR_EDGE[1]) : 0;
  p = { amount, kind: amount > 0 ? biomeOf(pole.index) : null, shelf: pole === s ? s : null };
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

// An iceberg, in one of the shapes calving leaves them: a tabular slab with sheer walls and a flat top, a blocky berg
// broken off along a few fracture faces, or a wedge whose top slopes up to a sharp ridge or peak. Under the water each
// has a broad keel, itself sheared into flat faces in places. Most of its bulk hides below.
function iceberg(r, width, depth, top, draft, segments) {
  const kind = r();
  const tabular = kind < 0.45;
  const wedge = kind > 0.75;
  const dome = tabular ? 0.04 + r() * 0.06 : wedge ? 0.5 + r() * 0.5 : 0.15 + r() * 0.25;
  const cuts = [];
  const walls = tabular ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 3);
  for (let i = 0; i < walls; i++) {
    const a = r() * Math.PI * 2;
    cuts.push({ dir: [Math.cos(a), (r() - 0.5) * 0.25, Math.sin(a)], keep: 0.72 + r() * 0.2 });
  }
  for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    const a = r() * Math.PI * 2;
    cuts.push({ dir: [Math.cos(a), -0.35 - r() * 0.5, Math.sin(a)], keep: 0.7 + r() * 0.2 });
  }
  if (wedge) {
    const a = r() < 0.5 ? 0 : Math.PI;
    cuts.push({ dir: [Math.cos(a) * 0.7, 1, (r() - 0.5) * 0.6], keep: 0.55 + r() * 0.2 });
  } else if (!tabular && r() < 0.6) {
    const a = r() * Math.PI * 2;
    cuts.push({ dir: [Math.cos(a), 0.6 + r() * 0.6, Math.sin(a)], keep: 0.7 + r() * 0.15 });
  }
  return iceBlock(r, {
    reach: jaggedOutline(r, 5 + Math.floor(r() * 4), tabular ? 0.2 : 0.3),
    width, depth, top: top / (1 + dome), draft, dome, bulge: 0.05 + r() * 0.15, blunt: 2.4 + r() * 2,
    lean: (r() - 0.5) * 0.5, rough: 0.7 + r() * 0.5, cuts, segments, lobes: 0.2 + r() * 0.35,
    rams: Array.from({ length: Math.floor(r() * 3) }, () => ({
      angle: r() * Math.PI * 2, spread: 0.35 + r() * 0.5, size: 0.25 + r() * 0.45, depth: 0.08 + r() * 0.25,
    })),
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
  // Stretches of the lane kept clear of bergs: open runs of pack ice to smash through at both edges of each pole, and
  // in the south flat floes crowded with penguins in the middle.
  const runWidth = Math.min(18, span * 0.18);
  const runs = [[from, from + runWidth], [to - runWidth, to]];
  const floes = kind === 'south'
    ? [0.38, 0.62].map((f) => ({ x: from + span * f, width: 8 + r() * 3, depth: 5 + r() * 2, seed: Math.floor(r() * 1e9) }))
    : [];
  const reserved = [...runs.map(([a, b]) => [a - 2, b + 2]),
    ...floes.map((f) => [f.x - f.width / 2 - 5, f.x + f.width / 2 + 5])];
  // The igloo's floe sits in the pack just behind the lane, where a sub breaking through comes up beside it.
  const home = kind === 'north'
    ? { x: from + runWidth / 2 + (r() - 0.5) * 4, z: -11, topAt: () => PACK_TOP }
    : null;
  const bergs = [];
  // A berg whose keel or rams would reach past `limit` is made again smaller until it fits.
  const place = (b, x, limit = Infinity) => {
    for (let tries = 0; ; tries++) {
      Object.assign(b, iceberg(seeded(b.seed + tries), b.width, b.depth, b.top, b.draft, b.lane ? 96 : 112));
      const box = b.geometry.boundingBox;
      if (x + box.max.x - box.min.x <= limit || tries > 6) {
        b.x = x - box.min.x;
        b.left = b.x + box.min.x;
        b.right = b.x + box.max.x;
        break;
      }
      b.geometry.dispose();
      b.width *= 0.8;
      b.draft = Math.min(b.draft, b.width * 0.9);
    }
    if (b.right > limit) return null;
    bergs.push(b);
    return b.right;
  };
  for (let x = from; x < to;) {
    const clash = reserved.find(([a, b]) => x + 4 > a && x < b);
    if (clash) {
      x = clash[1];
      continue;
    }
    const room = Math.min(to, ...reserved.filter(([a]) => a > x).map(([a]) => a)) - x;
    // The keel spreads out wider than the berg's top, so the top is sized to leave the whole berg room to fit.
    const width = Math.min(9 + r() * 20, Math.max(3, room / 1.45));
    const right = place({ z: LANE_Z + (r() - 0.5) * 2, width, depth: 6 + r() * 6, top: 1.6 + r() * 3,
      draft: Math.min(5 + r() * 8, width * 0.9), seed: Math.floor(r() * 1e9), lane: true }, x, x + room - 0.5);
    yield;
    if (right === null) {
      x += room;
      continue;
    }
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
    b.slice = measureSlice(b);
    b.offset = 0;
    b.drift = 0;
    b.rock = 0;
    b.rockSpeed = 0;
    yield;
  }
  // Polar bears roam the bigger northern bergs, and one prowls the big floe in the pack ice where the igloo stands;
  // penguins crowd the southern bergs in groups.
  const animals = [];
  const roomy = bergs.filter((b) => b.width > 10 && b.z > BACK_Z[0] + 10);
  if (kind === 'north') {
    animals.push({ type: 'igloo', berg: home, dx: IGLOO_SPOT.dx, dz: IGLOO_SPOT.dz });
    // The bear paces along the front of the floe, clear of the igloo's tunnel.
    animals.push({ type: 'bear', berg: home, dx: 1.5, dz: 3.7 });
    for (const b of roomy) {
      if (r() > 0.5) continue;
      const dx = (r() - 0.5) * b.width * 0.2;
      const dz = (r() - 0.5) * b.depth * 0.12;
      if (b.walkable(dx, dz, ANIMAL_SIZE.bear * 0.6)) animals.push({ type: 'bear', berg: b, dx, dz });
    }
  } else {
    for (const b of roomy) {
      if (r() > 0.6) continue;
      const count = 3 + Math.floor(r() * 5);
      for (let i = 0; i < count; i++) {
        const spot = { type: 'penguin', berg: b, dx: (r() - 0.5) * b.width * 0.35, dz: (r() - 0.5) * b.depth * 0.25,
          yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3, range: Math.min(2.5, b.width * 0.12) };
        if (b.walkable(spot.dx, spot.dz, 0.4)) animals.push(spot);
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
    const x0 = -f.half - 1;
    f.slice = { x0, ...sliceAlong(f.geometry, 0, x0, SLICE_STEP, Math.ceil((f.half * 2 + 2) / SLICE_STEP) + 1) };
    // The floe drifts when rammed, but only as far as the bergs either side of it.
    const lane = bergs.filter((b) => b.lane);
    // Bergs drift a little when bumped, so it keeps a stride clear of them.
    f.room = [Math.max(-Infinity, ...lane.filter((b) => b.right <= f.x).map((b) => b.right)) + 1.2,
      Math.min(Infinity, ...lane.filter((b) => b.left >= f.x).map((b) => b.left)) - 1.2];
    const count = 5 + Math.floor(r() * 4);
    f.penguins = Array.from({ length: count }, () => ({ dx: (r() - 0.5) * f.width * 0.5, dz: (r() - 0.5) * f.depth * 0.35,
      yaw: (r() - 0.5) * 1.6 + (r() < 0.5 ? 0 : Math.PI), phase: r() * 6.3 }));
    yield;
  }
  // Pack ice covers all the open sea between the bergs and floes, ragged at the pole's two ends.
  const blocked = (x, z, margin) => bergs.some((b) => x > b.left - margin - 1 && x < b.right + margin + 1
    && b.covers(x - b.x, z - b.z, margin + 1))
    || floes.some((f) => x > f.room[0] - f.half - margin && x < f.room[1] + f.half + margin
      && Math.abs(z) < f.depth / 2 + 1 + margin);
  const run = { start: from - 6, end: to + 6, home };
  const plates = [];
  yield* packLayout(run, PACK_DEPTH, blocked, plates);
  const pieces = Math.ceil((run.end - run.start) / PACK_PIECE);
  const fields = Array.from({ length: pieces }, (_, i) => {
    const start = run.start + ((run.end - run.start) * i) / pieces;
    const end = run.start + ((run.end - run.start) * (i + 1)) / pieces;
    const mine = (x) => (i === 0 || x >= start) && (i === pieces - 1 || x < end);
    const seeds = plates.filter((p) => mine(p.x));
    return { start, end, seeds, brash: plates.brash.filter((b) => mine(b.x)), home: seeds.some((p) => p.home) ? home : null };
  });
  Object.assign(ice, { kind, bergs, animals, fields, floes, ready: true });
}

// Run a generator's steps until it finishes or the time runs out; true once it has finished.
function runUntil(steps, deadline) {
  while (performance.now() < deadline) if (steps.next().done) return true;
  return false;
}

function drain(steps) {
  while (!steps.next().done);
}

// A lane berg's cross-section along the lane: its underside and top at each step, measured from its own middle.
const SLICE_STEP = 0.5;
function measureSlice(b) {
  const x0 = b.left - 1 - b.x;
  const count = Math.ceil((b.right - b.left + 2) / SLICE_STEP) + 1;
  return { x0, ...sliceAlong(b.geometry, LANE_Z - b.z, x0, SLICE_STEP, count) };
}

// Bottom and top of a measured cross-section at a point along it, or null where there is no ice.
function sliceAt(slice, lx) {
  const i = (lx - slice.x0) / SLICE_STEP;
  const k = Math.floor(i);
  if (k < 0 || k + 1 >= slice.bottom.length) return null;
  const f = i - k;
  const b0 = slice.bottom[k];
  const b1 = slice.bottom[k + 1];
  if (b0 === Infinity && b1 === Infinity) return null;
  const bottom = b0 === Infinity ? b1 : b1 === Infinity ? b0 : b0 + (b1 - b0) * f;
  const t0 = slice.top[k];
  const t1 = slice.top[k + 1];
  const top = t0 === -Infinity ? t1 : t1 === -Infinity ? t0 : t0 + (t1 - t0) * f;
  return { bottom, top };
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

// The ice in the sub's lane at x, as the span from its underside to its top; null in open water.
export function iceSpan(x) {
  const p = polarAt(x);
  if (!p.shelf || x < p.shelf.start + ICE_INSET - 30 || x > p.shelf.end - ICE_INSET + 30) return null;
  const ice = iceFor(p.shelf);
  let span = null;
  const join = (s) => {
    if (!s) return;
    span = span ? { bottom: Math.min(span.bottom, s.bottom), top: Math.max(span.top, s.top) } : s;
  };
  for (const b of ice.bergs) {
    if (!b.lane || x < b.left + b.offset - 1 || x > b.right + b.offset + 1) continue;
    const s = sliceAt(b.slice, x - b.x - b.offset);
    if (s) join({ bottom: s.bottom + SURFACE_Y, top: s.top + SURFACE_Y });
  }
  for (const floe of ice.built?.floes ?? []) join(floe.span(x));
  return span;
}

// The underside of the ice over the sub's lane at x: the highest the top of anything there can reach. Open water
// gives the sky.
export function iceCeiling(x) {
  return iceSpan(x)?.bottom ?? Infinity;
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
// Where the igloo stands on its floe.
const IGLOO_SPOT = { dx: -2.2, dz: -0.5 };
// The entrance tunnel: an arch of blocks, taller than it is wide, with walls a block thick.
// The dark doorway at its back sits just outside the dome's inner wall.
const TUNNEL = { width: 0.9, height: 1.2, wall: 0.28, from: 1.5, to: 3.3, back: 2.16 };
const archPoint = (u, inset, z) => new THREE.Vector3(Math.cos(u) * (TUNNEL.width - inset),
  Math.pow(Math.sin(u), 0.7) * (TUNNEL.height - inset), z);
function iglooBlocks() {
  const r = seeded(99);
  const R = IGLOO_RADIUS;
  const dome = (u, v, inset) => new THREE.Vector3(Math.cos(v) * Math.cos(u), Math.sin(v) * 0.94, Math.cos(v) * Math.sin(u))
    .multiplyScalar(R - inset);
  const tunnel = (u, v, inset) => archPoint(u, inset, v);
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
  for (let k = 0; k < 3; k++) {
    const v0 = TUNNEL.from + ((TUNNEL.to - TUNNEL.from) * k) / 3;
    const v1 = TUNNEL.from + ((TUNNEL.to - TUNNEL.from) * (k + 1)) / 3;
    for (let i = 0; i < 5; i++) {
      const shift = k % 2 ? 0.5 : 0;
      const u0 = Math.max(0, ((i - shift) / 5) * Math.PI);
      const u1 = Math.min(Math.PI, ((i + 1 - shift) / 5) * Math.PI);
      blocks.push(snowBlock(tunnel, (p) => new THREE.Vector3(p.x, p.y, 0), u0 + gap, u1 - gap, v0 + gap, v1 - gap,
        5, 4, 0.06));
    }
  }
  // The blocks' cut ends round the mouth, a wall's thickness deep.
  const rim = (u, v) => archPoint(u, 0, TUNNEL.to).lerp(archPoint(u, TUNNEL.wall, TUNNEL.to), v);
  for (let i = 0; i < 5; i++) {
    const u0 = (i / 5) * Math.PI;
    const u1 = ((i + 1) / 5) * Math.PI;
    blocks.push(snowBlock((u, v, inset) => rim(u, v).setZ(TUNNEL.to - inset), () => new THREE.Vector3(0, 0, 1),
      u0 + gap, u1 - gap, 0.04, 0.96, 4, 2, 0.04));
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
  // Inside, the tunnel's walls fade from the dim light at the mouth to darkness.
  const dark = new THREE.MeshBasicMaterial({ color: '#a8bcc8', vertexColors: true, side: THREE.DoubleSide });
  const lining = snowBlock((u, v) => archPoint(u, TUNNEL.wall, v), (p) => new THREE.Vector3(-p.x, -p.y, 0),
    0, Math.PI, TUNNEL.back, TUNNEL.to, 24, 10, 0);
  const floor = snowBlock((u, v) => new THREE.Vector3(u, 0.02, v), () => new THREE.Vector3(0, 1, 0),
    -(TUNNEL.width - TUNNEL.wall), TUNNEL.width - TUNNEL.wall, TUNNEL.back, TUNNEL.to, 4, 10, 0);
  const tunnelInner = new THREE.Mesh(mergeGeometries([lining, floor]), dark);
  const pos = tunnelInner.geometry.attributes.position;
  const shade = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const light = 0.02 + 0.3 * THREE.MathUtils.smoothstep(pos.getZ(i), TUNNEL.back, TUNNEL.to) ** 2;
    shade.set([light, light, light], i * 3);
  }
  tunnelInner.geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  const doorShape = new THREE.Shape();
  for (let i = 0; i <= 24; i++) {
    const p = archPoint((i / 24) * Math.PI, TUNNEL.wall, 0);
    if (i === 0) doorShape.moveTo(p.x, p.y);
    else doorShape.lineTo(p.x, p.y);
  }
  const door = new THREE.Mesh(new THREE.ShapeGeometry(doorShape), new THREE.MeshBasicMaterial({ color: '#05090c' }));
  door.position.z = TUNNEL.back;
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
  const obj = a.type === 'bear' ? spawnSkinned('polar_bear') : spawn('penguin');
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
    mesh.position.set(b.x + (b.offset ?? 0), SURFACE_Y, b.z);
    mesh.castShadow = b.draft > 2;
    b.mesh = mesh;
    group.add(mesh);
  }
  yield;
  const fields = [];
  for (const spec of ice.fields) {
    const pack = new PackIce(spec, group);
    yield* pack.build();
    fields.push(pack);
  }
  const animals = ice.animals.map((a) => {
    const obj = makeAnimal(a);
    const u = { ...a, rig: obj.userData.rig, foot: obj.userData.foot ?? 0 };
    obj.userData = u;
    if (a.type === 'bear') {
      obj.rotation.order = 'YZX';
      u.mind = new BearMind(u, ANIMAL_SIZE.bear);
    } else if (a.type === 'penguin') {
      obj.rotation.order = 'YXZ';
      u.mind = new PenguinMind(u, a.range, (dx, dz) => a.berg.walkable(dx, dz, 0.35));
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
  ice.built = { group, animals, fields, floes };
}

// Feet on the snow, following its rise and fall; a bear tips its body to the slope under it.
function placeAnimal(obj) {
  const u = obj.userData;
  const b = u.berg;
  const ground = b.topAt(u.dx, u.dz);
  obj.position.set(b.x + (b.offset ?? 0) + u.dx, SURFACE_Y + ground + u.foot + (u.bob ?? 0), b.z + u.dz);
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
const CHUNKS = 700;
// The pack over a pole is built and drawn in pieces this wide, so pieces out of view are skipped.
const PACK_PIECE = 24;
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

// Seeds bucketed on a grid over the sea, for finding the ones near a point.
class SeedGrid {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
  }

  add(s) {
    const key = `${Math.floor(s.x / this.cell)},${Math.floor(s.z / this.cell)}`;
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(s);
  }

  *near(x, z, reach) {
    const n = Math.ceil(reach / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = cx - n; i <= cx + n; i++) {
      for (let j = cz - n; j <= cz + n; j++) yield* this.cells.get(`${i},${j}`) ?? [];
    }
  }
}

// Where each floe of a stretch of pack lies: its middle, rough size and outline, packed in around anything `blocked`.
function* packLayout(field, depth, blocked, out) {
  const r = seeded(Math.floor(field.start * 13) + 5);
  const grid = new SeedGrid(4);
  const seeds = [];
  const keep = (s) => {
    seeds.push(s);
    grid.add(s);
  };
  if (field.home) keep({ x: field.home.x, z: field.home.z, rad: HOME_RADIUS, home: true });
  const biggest = HOME_RADIUS;
  const width = field.end - field.start;
  // Leads: cracks of open water running across the field at odd angles.
  const leads = Array.from({ length: 1 + Math.floor(width / 40 + r() * 2) }, () => ({
    x: field.start + r() * width, a: (r() - 0.5) * 1.4, w: 0.4 + r() * 1.1,
  }));
  const inLead = (x, z) => leads.some((l) => Math.abs((x - l.x) * Math.cos(l.a) - z * Math.sin(l.a)) < l.w / 2);
  const tries = Math.round(width * (depth[1] - depth[0]) * 8);
  for (let k = 0; k < tries; k++) {
    const x = field.start - 8 + r() * (width + 16);
    const z = depth[0] + r() * (depth[1] - depth[0]);
    // The field's ragged ends, beyond which only a few stragglers drift.
    const inside = Math.min(x - field.start - fbm(z * 0.07, 1.3, 0.5) * 12, field.end + fbm(z * 0.07, 7.1, 2.5) * 12 - x);
    if (inside < 0 && r() > 0.15 * Math.exp(inside / 3)) continue;
    if (z > depth[1] - 1.8 + fbm(x * 0.09, 3.3, 8.1) * 4) continue;
    if (inLead(x, z)) continue;
    // Mostly small pieces with the odd big floe among them, the big ones bunched where the field is thickest.
    const lane = Math.abs(z) < LANE_HALF + 1;
    const big = 0.5 + fbm(x * 0.06, z * 0.06, 4.4);
    const rad = lane ? 0.3 + 1.3 * r() ** 2 : 0.3 + 3.4 * r() ** 3 * (0.4 + big);
    if (k % 100 === 0) yield;
    const room = (0.6 + r() * 0.25);
    let clash = false;
    for (const s of grid.near(x, z, rad + biggest)) {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 < ((s.rad + rad) * room) ** 2) {
        clash = true;
        break;
      }
    }
    if (clash || blocked(x, z, rad * 0.9)) continue;
    keep({ x, z, rad });
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
    const gap = 0.03 + r() * r() * 0.25;
    for (const o of grid.near(s.x, s.z, (s.rad + biggest) * 1.7)) {
      if (o === s) continue;
      const dx = o.x - s.x;
      const dz = o.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > ((s.rad + o.rad) * 1.7) ** 2) continue;
      const d = Math.sqrt(d2);
      const t = (d2 + s.rad * s.rad - o.rad * o.rad) / (2 * d) - gap / 2;
      poly = clipPolygon(poly, dx / d, dz / d, (s.x * dx + s.z * dz) / d + t);
    }
    s.poly = s.home ? poly : brokenEdge(poly, r);
  }
  out.push(...seeds.filter((s) => s.poly.length >= 3));
  // Loose brash ice: fragments drifting in the leads and gaps, for the sub to shoulder aside.
  const brash = [];
  for (let k = 0; k < width * 14; k++) {
    if (k % 300 === 0) yield;
    const x = field.start - 4 + r() * (width + 8);
    const z = depth[0] + r() * (depth[1] - depth[0] - 1);
    let covered = false;
    for (const s of grid.near(x, z, biggest)) {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.rad * 0.95) ** 2) {
        covered = true;
        break;
      }
    }
    if (covered || blocked(x, z, 0.3)) continue;
    brash.push({ x, z, size: 0.15 + r() * r() * 0.5 });
  }
  out.brash = brash;
}

// Ice breaks along ragged lines: each straight edge becomes a wandering one, bitten into here and there.
function brokenEdge(poly, r) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 0.22));
    const notch = r() < 0.25 ? 0.25 + r() * 0.5 : -1;
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      let x = ax + (bx - ax) * t;
      let z = az + (bz - az) * t;
      if (j > 0) {
        const toward = Math.hypot(cx - x, cz - z);
        let bite = (0.5 + 0.5 * fbm(x * 1.7, z * 1.7, 5.5)) * Math.min(0.18, len * 0.1);
        if (notch > 0 && Math.abs(t - notch) < 0.12) bite += Math.min(0.35, len * 0.2) * (1 - Math.abs(t - notch) / 0.12);
        bite = Math.min(bite, toward * 0.45);
        x += ((cx - x) / toward) * bite;
        z += ((cz - z) / toward) * bite;
      }
      out.push([x, z]);
    }
  }
  return out;
}

class PackIce {
  constructor(field, group, depth = PACK_DEPTH) {
    this.field = field;
    this.group = group;
    this.depth = depth;
  }

  // Lays out and builds the floes a few at a time, yielding between batches.
  *build() {
    const { field, group } = this;
    shardGeometry ??= iceBlock(seeded(3), {
      reach: jaggedOutline(seeded(4), 5, 0.5), width: 1, depth: 0.8, top: 0.22, draft: 0.4, dome: 0.2, bulge: 0,
      blunt: 3, rough: 0.6, topRough: 0.4, segments: 16, capRows: 2, cliffRows: 1, keelRows: 3,
    }).geometry;
    packMaterial ??= iceMaterial({ name: 'pack_ice', bob: true });
    const r = seeded(Math.floor(field.start * 7) + 3);
    this.plates = [];
    const parts = [];
    let start = 0;
    for (const [n, s] of field.seeds.entries()) {
      if (n % 8 === 0) yield;
      const cx = s.poly.reduce((a, p) => a + p[0], 0) / s.poly.length;
      const cz = s.poly.reduce((a, p) => a + p[1], 0) / s.poly.length;
      const corners = s.poly.map(([x, z]) => [((Math.atan2(z - cz, x - cx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
        Math.hypot(x - cx, z - cz)]).sort((a, b) => a[0] - b[0]);
      const reach = Math.max(...corners.map((c) => c[1]));
      const thick = 0.6 + r() * 0.7;
      const block = iceBlock(r, {
        reach: polygonReach(corners), width: 2, depth: 2, top: PACK_TOP * thick, draft: PACK_DRAFT * thick, dome: 0.12,
        bulge: 0, blunt: 9, rough: 0.3, topRough: 0.45, segments: Math.min(84, Math.round(16 + reach * 18)),
        capRows: s.home ? 6 : reach > 1 ? 2 : 1, cliffRows: 1, keelRows: 2,
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
      if (s.home && field.home) {
        field.home.topAt = (dx, dz) => block.topAt(field.home.x + dx - cx, field.home.z + dz - cz);
        // The igloo and its tunnel stand on this floe too, and nothing walks through them.
        const clear = (dx, dz, margin) => Math.hypot(dx - IGLOO_SPOT.dx, dz - IGLOO_SPOT.dz) > IGLOO_RADIUS + margin
          && !(Math.abs(dx - IGLOO_SPOT.dx) < TUNNEL.width + margin && dz > IGLOO_SPOT.dz
            && dz < IGLOO_SPOT.dz + TUNNEL.to + margin);
        field.home.walkable = (dx, dz, margin) => clear(dx, dz, margin)
          && block.walkable(field.home.x + dx - cx, field.home.z + dz - cz, margin);
      }
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
    this.chunkMesh.castShadow = true;
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
    for (const b of field.brash) {
      this.addChunk({ x: b.x, y: SURFACE_Y, z: b.z, vx: 0, vy: 0, vz: 0, sx: 0, sz: 0, size: b.size });
    }
  }

  // A free piece of ice. When every slot is taken, the piece farthest from the sub makes way.
  addChunk(props) {
    let chunk = this.chunks.find((k) => !k.active);
    if (!chunk) {
      const from = this.lastHullX ?? props.x;
      chunk = this.chunks.reduce((far, k) => (Math.abs(k.x - from) > Math.abs(far.x - from) ? k : far));
    }
    Object.assign(chunk, {
      active: true, yaw: Math.random() * 6.3, rx: (Math.random() - 0.5) * 0.3, rz: (Math.random() - 0.5) * 0.3,
      sx0: 0.7 + Math.random() * 0.6, sz0: 0.7 + Math.random() * 0.6, spinY: 0, phase: Math.random() * 6.3,
    }, props);
  }

  update(dt, t, hull, effects) {
    packMaterial.userData.time.value = t;
    if (hull && Math.abs(hull.center.x - (this.field.start + this.field.end) / 2) > PACK_PIECE / 2 + 60) return;
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
    if (hull) this.lastHullX = hull.center.x;
    const m = this.matrix;
    const c = hull?.center;
    const e = hull?.extents;
    this.chunks.forEach((k, i) => {
      if (!k.active) return;
      // The hull shoulders aside any piece it runs into, setting it spinning.
      if (hull && Math.abs(k.z) < 1.6 + k.size) {
        const dx = k.x - c.x;
        const dy = k.y - c.y;
        const reach = e.hx + k.size * 0.6;
        const along = Math.abs(dx) / reach;
        if (along < 1 && Math.abs(dy) < e.hy * Math.sqrt(1 - along * along) + k.size * 0.5) {
          const v = hull.vel;
          k.vx += (v.x * 0.9 - k.vx) * 0.5 + Math.sign(dx || 1) * 1.2 * dt * 30;
          k.vz += (Math.sign(k.z || Math.random() - 0.5) * (1 + Math.abs(v.x) * 0.25) - k.vz) * 0.4;
          k.vy = Math.max(k.vy, Math.max(0, v.y) * 0.6 + (k.y >= SURFACE_Y - 0.1 ? 0.6 : 0));
          k.sx += (Math.random() - 0.5) * 4;
          k.sz += (Math.random() - 0.5) * 4;
          k.spinY += (Math.random() - 0.5) * 3;
        }
      }
      // Thrown clear of the water it falls back; afloat it bobs at the surface and drifts to a stop.
      const afloat = k.y <= SURFACE_Y + 0.02;
      k.vy += (afloat ? (SURFACE_Y - k.y) * 18 - k.vy * 4 : -14) * dt;
      const drag = Math.exp(-dt * (afloat ? 0.9 : 0.15));
      k.vx *= drag;
      k.vz *= drag;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.z = THREE.MathUtils.clamp(k.z + k.vz * dt, this.depth[0] - 2, this.depth[1] + 3);
      // Afloat, a tipped piece rocks back flat.
      if (afloat) {
        k.sx += (-k.rx * 12 - k.sx * 3) * dt;
        k.sz += (-k.rz * 12 - k.sz * 3) * dt;
        k.spinY *= Math.exp(-dt * 1.5);
      }
      k.rx += k.sx * dt;
      k.rz += k.sz * dt;
      k.yaw += k.spinY * dt;
      const bob = afloat ? Math.sin(t * 1.3 + k.phase) * 0.03 : 0;
      this.euler.set(k.rx, k.yaw, k.rz);
      m.compose(this.posV.set(k.x, k.y + bob, k.z), this.quat.setFromEuler(this.euler),
        this.scaleV.set(k.size * k.sx0, k.size, k.size * k.sz0));
      this.chunkMesh.setMatrixAt(i, m);
    });
    this.chunkMesh.instanceMatrix.needsUpdate = true;
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
    const pieces = Math.min(9, 2 + Math.round(p.rad * 3));
    for (let k = 0; k < pieces; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * p.rad * 0.7;
      this.addChunk({
        x: p.x + Math.cos(a) * d, y: SURFACE_Y, z: p.z + Math.sin(a) * d,
        vx: v.x * 0.5 + (Math.random() - 0.5) * 2.5, vy: 1.2 + Math.random() * 2.2 + Math.max(0, v.y) * 0.4,
        vz: Math.sign(p.z || Math.random() - 0.5) * (0.8 + Math.random() * 2.2),
        sx: (Math.random() - 0.5) * 8, sz: (Math.random() - 0.5) * 8,
        size: (0.4 + Math.random() * 0.5) * Math.min(1.3, p.rad * 0.85),
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
      p.mind = new PenguinMind(p, Math.min(1.2, spec.width * 0.12), (dx, dz) => spec.walkable(dx, dz, 0.4));
      return p;
    });
    this.local = new THREE.Vector3();
    this.pose = new THREE.Quaternion();
    this.qErr = new THREE.Quaternion();
    this.qInv = new THREE.Quaternion();
    this.qTurn = new THREE.Quaternion();
    this.turnAxis = new THREE.Vector3();
    this.place();
  }

  // The floe's bottom and top over x, tipped and lifted with it.
  span(x) {
    const cos = Math.cos(this.tilt);
    const lx = (x - this.x) / cos;
    const s = sliceAt(this.spec.slice, lx);
    if (!s) return null;
    const base = SURFACE_Y + this.lift + lx * Math.sin(this.tilt);
    return { bottom: base + s.bottom * cos, top: base + s.top * cos };
  }

  underside(x) {
    return this.span(x)?.bottom ?? Infinity;
  }

  place() {
    this.mesh.position.set(this.x, SURFACE_Y + this.lift, this.spec.z ?? 0);
    this.mesh.rotation.set(0, 0, this.tilt);
    this.mesh.updateMatrixWorld(true);
  }

  update(dt, t, hull, effects, camera) {
    this.cooldown -= dt;
    const before = this.approach;
    this.approach = hull ? hull.vel.length() : 0;
    if (hull && this.cooldown <= 0) {
      const c = hull.center;
      const e = hull.extents;
      const half = this.spec.half;
      const offset = c.x - this.x;
      // The floe stops the sub just short of it when driven into from the side, so look a little either way too.
      const pos = hull.group.position;
      const span = (x) => this.span(x);
      const touching = [-0.35, 0, 0.35].some((d) => hull.iceOverlap(pos.x + d, pos.y + 0.1, span)
        || hull.iceOverlap(pos.x + d, pos.y - 0.1, span));
      if (touching && Math.abs(offset) < half + e.hx) {
        // Struck from below the floe bucks up; struck near an end it tips; driven into from the side it is shoved.
        // The floe stops the sub dead, so the blow is as hard as the sub was going the frame before.
        const speed = Math.max(hull.vel.length(), before ?? 0);
        const hit = 1.2 + speed * 0.35;
        this.vy += hit * 0.9;
        this.spin += -Math.sign(offset || 1) * hit * 0.5 * Math.min(1, Math.abs(offset) / half + 0.3);
        this.vx += hull.vel.x * 0.4;
        hull.vel.y = Math.min(hull.vel.y, 0);
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
    for (const p of this.penguins) this.penguin(p, dt, t, effects, camera);
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

  penguin(p, dt, t, effects, camera) {
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
        p.state = 'plunge';
        p.swimTime = 0;
        const dir = Math.sign(p.vel.x || 1);
        // Each comes to its senses after its own moment, then rights itself and goes its own way at its own pace,
        // flippers out of step with the rest.
        Object.assign(p, { yaw: dir > 0 ? 0 : Math.PI, pitch: -0.2 - Math.random() * 0.4, roll: 0, speed: 0,
          stroke: Math.random() * 6.3, cruise: 4 + Math.random() * 3, retarget: 0,
          dazed: 0.3 + Math.random() * 1.1, calm: 2.5 + Math.random() * 2.5,
          turn: new THREE.Vector3(p.spinVel.x, p.spinVel.y, p.spinVel.z) });
        const at = { x: obj.position.x, y: SURFACE_Y, z: obj.position.z };
        effects?.splash(at, 0.9 + Math.min(1, -p.vel.y * 0.08));
        for (let i = 0; i < 10; i++) {
          effects?.bubble({ x: at.x, y: at.y - 0.4, z: at.z }, { spread: 0.35, size: [0.05, 0.16],
            vel: { x: p.vel.x * 0.2, y: -1.5 - Math.random() }, life: [0.6, 1.4] });
        }
        sfx.splash();
        this.knocked = (this.knocked ?? 0) + 1;
        if (this.knocked >= 3) unlock('penguin_bowl');
      }
      return;
    }
    if (p.state === 'plunge') {
      // Carried down by the plunge, still tumbling, until the water slows it and it gathers itself.
      p.swimTime += dt;
      p.vel.multiplyScalar(Math.exp(-dt * 2.8));
      p.vel.y += 1.2 * dt;
      obj.position.addScaledVector(p.vel, dt);
      if (Math.random() < dt * 6) {
        effects?.bubble(obj.position, { spread: 0.15, size: [0.04, 0.1], vel: { x: 0, y: 0.6 }, life: [0.5, 1.1] });
      }
      // The tumble carries on, slowed by the water, while a pull toward swimming belly down grows from nothing as it
      // gathers its wits, so it rolls round in one smooth motion over a couple of seconds.
      const wits = THREE.MathUtils.smoothstep(p.swimTime, p.dazed * 0.4, p.dazed + 1.4);
      const pull = p.calm * wits;
      swimPose(p, this.pose);
      const err = this.qErr.copy(this.pose).multiply(this.qInv.copy(obj.quaternion).invert());
      if (err.w < 0) err.set(-err.x, -err.y, -err.z, -err.w);
      const angle = 2 * Math.acos(Math.min(1, err.w));
      const sin = Math.sqrt(Math.max(1e-8, 1 - err.w * err.w));
      this.turnAxis.set(err.x / sin, err.y / sin, err.z / sin);
      p.turn.addScaledVector(this.turnAxis, angle * pull * dt);
      p.turn.multiplyScalar(Math.exp(-dt * (0.9 + 2 * Math.sqrt(pull))));
      const step = p.turn.length() * dt;
      if (step > 1e-6) obj.quaternion.premultiply(this.qTurn.setFromAxisAngle(this.turnAxis.copy(p.turn).normalize(), step));
      obj.quaternion.normalize();
      // Flippers flail at first, then settle into slow strokes, and it starts to make way.
      const effort = THREE.MathUtils.smoothstep(p.swimTime, p.dazed, p.dazed + 2);
      swimStroke(p.rig, p, dt, effort * 0.35);
      p.rig.uDrop.value += (1 - effort) * Math.sin(t * 9 + p.stroke) * 0.25;
      p.rig.uFlap.value *= 0.3 + 0.7 * effort;
      p.speed = effort * 1.2;
      obj.position.addScaledVector(swimmerBack(p), -p.speed * dt);
      if (wits >= 1 && angle < 0.2 && p.turn.length() < 0.4) {
        p.state = 'swim';
        p.settle = 1;
      }
      return;
    }
    if (p.state === 'swim') {
      // Off and away from the plunge, curving back out of the sub's lane into the water behind it.
      p.swimTime += dt;
      p.retarget -= dt;
      if (p.retarget <= 0) {
        const ahead = Math.cos(p.yaw) >= 0 ? 1 : -1;
        p.target = new THREE.Vector3(obj.position.x + ahead * (15 + Math.random() * 30),
          SURFACE_Y - 2.5 - Math.random() * 8, SWIM_Z[0] + Math.random() * (SWIM_Z[1] - SWIM_Z[0]));
        p.retarget = 1.5 + Math.random() * 2.5;
      }
      // What is left of the plunge's drift dies away as it swims.
      p.vel.multiplyScalar(Math.exp(-dt * 2.8));
      obj.position.addScaledVector(p.vel, dt);
      const was = p.settle > 0 ? this.qInv.copy(obj.quaternion) : null;
      steerSwimmer(obj, p, p.target, dt, p.cruise);
      // Fresh from righting itself, it eases the last of the way into its swimming pose.
      if (was) {
        p.settle = Math.max(0, p.settle - dt);
        obj.quaternion.slerpQuaternions(was, obj.quaternion, 1 - Math.exp(-dt * 3 / Math.max(0.15, p.settle)));
      }
      if (swimStroke(p.rig, p, dt, p.speed / 7)) jet(effects, obj.position, swimmerBack(p));
      // Gone for good once it has swum out of sight.
      if (p.swimTime > 9 + p.phase && camera && outOfView(obj.position, camera)) {
        p.state = 'gone';
        obj.visible = false;
      }
    }
  }
}

// A swimmer's pose for its heading and pitch, belly down, rocking slightly with its strokes as `steerSwimmer` does.
const qPose = new THREE.Quaternion();
function swimPose(s, out) {
  out.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
  out.multiply(qPose.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.pitch));
  out.multiply(qPose.setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.roll + Math.sin(s.stroke ?? 0) * 0.08));
  return out.multiply(LAY_FLAT);
}

// A little jet of bubbles thrown back off a swimming penguin's tail as its flippers sweep down.
function jet(effects, pos, back) {
  if (!effects) return;
  const tail = { x: pos.x + back.x * 0.65, y: pos.y + back.y * 0.65, z: pos.z };
  effects.bubbleStreak(tail, { x: -back.x, y: -back.y }, 1.3);
  for (let i = 0; i < 5; i++) {
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
// They keep to the water behind the sub's lane.
const SWIM_Z = [-22, -9];

function makeSwimmers(scene) {
  return Array.from({ length: SWIMMERS }, () => {
    const holder = new THREE.Group();
    const body = makeAnimal({ type: 'penguin' });
    holder.add(body);
    holder.visible = false;
    holder.userData = { body, rig: body.userData.rig, target: null, retarget: 0, yaw: 0, pitch: 0, roll: 0, speed: 0 };
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

// How readily a berg gives to a bump from the sub: divided by the berg's bulk.
const BERG_HEFT = 18;

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
    const field = { start: 0, end: 8 };
    const seeds = [];
    drain(packLayout(field, [-2, 2], () => false, seeds));
    drain(new PackIce({ ...field, seeds, brash: seeds.brash }, sample, [-2, 2]).build());
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
      this.drift(ice, dt, hull);
      this.animate(ice, dt, t, cx, camera);
      for (const pack of ice.built.fields) pack.update(dt, t, hull, effects);
      for (const floe of ice.built.floes) floe.update(dt, t, hull, effects, camera);
    }
    this.updateSwimmers(dt, t, cx, cy, sub, effects, camera);
    this.updateSnow(dt, cx, cy);
    this.updateCrystals(dt, t, cx, cy);
    if (sub && p.amount > 0.9) {
      unlock(p.kind === 'north' ? 'north_pole' : 'south_pole');
    }
  }

  // Bergs are enormously heavy but they do float: a bump from the sub nudges one along a little and sets it rocking,
  // and the water slowly brings it back to rest where it was.
  drift(ice, dt, hull) {
    const bump = hull?.iceBump;
    for (const b of ice.bergs) {
      if (!b.lane) continue;
      if (bump && bump.x > b.left + b.offset - 1.5 && bump.x < b.right + b.offset + 1.5) {
        const heft = BERG_HEFT / (b.width * b.depth * (b.top + b.draft));
        b.drift += bump.vx * heft;
        b.rockSpeed += (bump.vy * 0.6 - bump.vx * 0.3 * Math.sign(bump.x - b.x - b.offset)) * heft * 0.05;
      }
      b.drift += (-b.offset * 0.06 - b.drift * 0.6) * dt;
      b.offset = THREE.MathUtils.clamp(b.offset + b.drift * dt, -0.8, 0.8);
      b.rockSpeed += (-b.rock * 0.8 - b.rockSpeed * 0.7) * dt;
      b.rock += b.rockSpeed * dt;
      if (b.mesh) {
        b.mesh.position.x = b.x + b.offset;
        b.mesh.rotation.z = b.rock;
      }
    }
    if (hull) hull.iceBump = null;
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

  updateSwimmers(dt, t, cx, cy, sub, effects, camera) {
    const p = polarAt(cx);
    const active = p.kind === 'south' && p.amount > 0.5;
    for (const s of this.swimmers) {
      const u = s.userData;
      if (!active) {
        // Out of penguin waters, any still in sight swim off out of view before they go.
        if (!s.visible) continue;
        if (outOfView(s.position, camera)) {
          s.visible = false;
          u.target = null;
          u.leaving = false;
          continue;
        }
        if (!u.leaving) {
          u.leaving = true;
          const away = Math.sign(s.position.x - cx) || 1;
          u.target = new THREE.Vector3(s.position.x + away * 80, s.position.y, s.position.z);
        }
      } else if (!s.visible) {
        // Each arrives from beyond the edge of the view.
        const side = Math.random() < 0.5 ? -1 : 1;
        s.visible = true;
        u.leaving = false;
        s.position.set(cx + side * (50 + Math.random() * 8), SURFACE_Y - 4 - Math.random() * 10,
          SWIM_Z[0] + Math.random() * (SWIM_Z[1] - SWIM_Z[0]));
        u.yaw = side > 0 ? Math.PI : 0;
        u.target = null;
      }
      u.retarget -= dt;
      // Off to a new spot in the water behind the lane every few seconds, or sooner once it gets there.
      if (!u.leaving && (!u.target || u.retarget <= 0)) {
        u.target = new THREE.Vector3(cx + (Math.random() - 0.5) * 60, SURFACE_Y - 3 - Math.random() * 16,
          SWIM_Z[0] + Math.random() * (SWIM_Z[1] - SWIM_Z[0]));
        u.retarget = 4 + Math.random() * 4;
      }
      const effort = THREE.MathUtils.clamp(u.speed / 6.5, 0, 1);
      if (steerSwimmer(s, u, u.target, dt, 6.5) < 3 && !u.leaving) u.retarget = 0;
      s.position.y = THREE.MathUtils.clamp(s.position.y, floorY(s.position.x) + 2,
        Math.min(SURFACE_Y - 1, iceCeiling(s.position.x) - 1));
      if (!u.leaving && Math.abs(s.position.x - cx) > 60) s.position.x = cx - Math.sign(s.position.x - cx) * 55;
      if (swimStroke(u.rig, u, dt, effort) && effort > 0.3) jet(effects, s.position, swimmerBack(u));
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

// Clear of the view by a margin, so nothing of an animal there can be seen when it is taken away.
function outOfView(pos, camera) {
  const v = pos.clone().project(camera);
  return Math.abs(v.x) > 1.25 || Math.abs(v.y) > 1.25 || v.z > 1;
}
