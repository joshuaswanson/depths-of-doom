import * as THREE from 'three';
import { findNode, findNodes, ownMaterials, spawn } from './assets.js';
import { addWaterline } from './surface.js';
import { HULL_CAPACITY, JUNK_PER_HULL, PART_MODEL, SOCKETS, UPGRADES, needsMount, partCount, partModel } from './upgrades.js';
import { SURFACE_Y } from './water.js';

// The sub rests in full profile, facing left or right: yaw at an even or odd multiple of PI.
const DRAG = 1.9;
const MAX_SPOTLIGHTS = 4;
const GRAVITY = 18;
const AIR_DRAG = 0.15;
const TURN_SPEED = Math.PI / 0.7;
const TURN_ACCEL = 14;
const TURN_DRAG = 3.5;
const PITCH_SPEED = 2.6;
const PITCH_ACCEL = 9;
const MAX_PITCH = 1.52;
const CRUISE_BUILD = 0.32;
const CRUISE_BOOST = 0.9;
const MAX_CLIMB = 0.9;
// Points along the hull, from tail to nose as fractions of its half-length, where it is checked against the rock. The
// ends reach a little past the hull so its tips stop just short of a cliff face.
const HULL_SAMPLES = [-1.12, -0.75, -0.45, -0.15, 0.15, 0.45, 0.75, 1.12];
const OUTLINE_SLICES = 18;
export const RIG_SCALE = 0.82;
const WALL_BOUNCE_SPEED = 3;
// Ice above the water is slick, and the sub lands on it with barely a bounce.
const ICE_FRICTION = 0.06;
const ICE_BOUNCE = 0.15;
// A berg dips under the sub's weight on whichever side it sits, so even a flat top sheds it toward the nearer edge.
const ICE_TIP = 1.6;
const REGEN_DELAY = 5;
// From this hull level the sub gets the long "car" hull with a flat front deck and a deck-mounted gun.
const BIG_HULL_LEVEL = 4;
const DECK = { start: 0.72, end: 0.97, height: 0.56 };
const DECK_SOCKET = [1.2, 90];

function deckCap(x) {
  return THREE.MathUtils.lerp(10, DECK.height, THREE.MathUtils.smoothstep(x, DECK.start, DECK.end));
}
// Portholes that bolted-on parts must not sit on, as [x, angle around the hull, radius], plus how far toward the
// nose viewport a part may sit. Only a part's mounting base counts: barrels and other overhangs may hang over a
// window as long as the base stays off it.
const KEEP_CLEAR = [[0.35, 4, 0.22], [-0.3, 4, 0.19], [0.35, 176, 0.22], [-0.3, 176, 0.19]];
const NOSE_LIMIT = 1.35;
// Rough space each part takes on the hull: how far it reaches back and forward along the hull from its mount, and
// how wide it is around the hull. Used to keep parts from bolting into each other.
const ENVELOPE = {
  cannon: [-0.45, 1.45, 0.42], torpedo: [-0.6, 0.75, 0.4], missile: [-0.45, 0.6, 0.36], shield: [-0.3, 0.3, 0.3],
  grapple: [-0.15, 0.15, 0.15], sonar: [-0.35, 0.35, 0.3], propulsion: [-0.75, 0.5, 0.3], spotlight: [-0.35, 0.4, 0.25],
  junk: [-0.3, 0.3, 0.3],
};
const BASE_RADIUS = {
  cannon: 0.24, torpedo: 0.45, missile: 0.25, shield: 0.26, grapple: 0.15, sonar: 0.14, propulsion: 0.15,
  spotlight: 0.18, junk: 0.25,
};
const REGEN_RATE = 3;

// The shortest way out of the ice for a point inside it, as a direction and a distance; null when the point is clear.
function iceExit(span, x, y) {
  const s = span(x);
  if (!s || y >= s.top || y <= s.bottom) return null;
  const up = s.top - y;
  const down = y - s.bottom;
  const outside = (d) => {
    const t = span(x + d);
    return !t || y >= t.top || y <= t.bottom;
  };
  const reach = Math.min(up, down, 0.8);
  for (let d = 0.05; d < reach; d += 0.05) {
    if (outside(d)) return { nx: 1, ny: 0, depth: d };
    if (outside(-d)) return { nx: -1, ny: 0, depth: d };
  }
  if (down < up) return { nx: 0, ny: -1, depth: down };
  const slope = ((span(x + 0.25)?.top ?? s.top) - (span(x - 0.25)?.top ?? s.top)) / 0.5;
  const n = Math.hypot(slope, 1);
  return { nx: -slope / n, ny: 1 / n, depth: up / n };
}

// How far from x along the ice the nearer of its two ends lies, signed toward it.
function nearerEnd(span, x) {
  for (let d = 0.5; d < 60; d += 0.5) {
    if (!span(x + d)) return 1;
    if (!span(x - d)) return -1;
  }
  return 0;
}

function hullRadius(x) {
  const t = x / 2;
  if (Math.abs(t) >= 1) return 0;
  const p = t > 0 ? 2.6 : 2.3;
  return (1 - Math.abs(t) ** p) ** (1 / p);
}

function elasticOut(t) {
  if (t >= 1) return 1;
  return 1 + 2 ** (-10 * t) * Math.sin((t - 0.1) * 5 * Math.PI);
}

const HOT = new THREE.Color(1.0, 0.32, 0.08);
const MAX_SCORCHES = 12;

const sootTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 30;
    const r = 14 + Math.random() * 26;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(14,10,9,0.85)');
    grad.addColorStop(1, 'rgba(18,14,12,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  g.strokeStyle = 'rgba(5,4,4,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    let x = 64;
    let y = 64;
    g.beginPath();
    g.moveTo(x, y);
    const a = Math.random() * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      x += Math.cos(a + (Math.random() - 0.5)) * 9;
      y += Math.sin(a + (Math.random() - 0.5)) * 9;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Energy bubble over the hull: a faint hex lattice with a bright rim. A blocked hit flares where it lands and sends a
// ripple across the surface; a recharge sweeps a band of light up the bubble; losing the last charge makes the
// cells flicker out.
function makeShieldBubble() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uFlash: { value: 0 }, uStrength: { value: 0 }, uHitDir: { value: new THREE.Vector3(1, 0, 0) },
      uHitAge: { value: 10 }, uCharge: { value: -1 }, uBreak: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vNormal = normalize( normalMatrix * normal );
        vView = normalize( -mv.xyz );
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFlash, uStrength, uHitAge, uCharge, uBreak;
      uniform vec3 uHitDir;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      vec4 hexCell( vec2 p ) {
        vec2 r = vec2( 1.0, 1.7320508 );
        vec2 h = r * 0.5;
        vec2 a = mod( p, r ) - h;
        vec2 b = mod( p - h, r ) - h;
        vec2 g = dot( a, a ) < dot( b, b ) ? a : b;
        return vec4( g, p - g );
      }
      void main() {
        vec3 n = normalize( vPos );
        float rim = pow( 1.0 - abs( dot( vNormal, vView ) ), 2.2 );
        // The atan seam sits on the far side of the bubble, away from the camera.
        vec2 sp = vec2( atan( n.x, n.z ) * 3.2, n.y * 5.0 );
        vec4 cell = hexCell( sp );
        vec2 g = abs( cell.xy );
        float edge = smoothstep( 0.42, 0.49, max( dot( g, vec2( 0.5, 0.8660254 ) ), g.x ) );
        float cellRand = fract( sin( dot( cell.zw, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        float shimmer = 0.5 + 0.5 * sin( uTime * 2.2 + cellRand * 6.2831 + n.y * 3.0 );

        float d = acos( clamp( dot( n, uHitDir ), -1.0, 1.0 ) );
        float ring = exp( -pow( ( d - uHitAge * 5.0 ) * 5.0, 2.0 ) ) * exp( -uHitAge * 2.2 );
        float spot = exp( -d * d * 6.0 ) * exp( -uHitAge * 6.0 );
        float level = mix( -1.15, 1.15, uCharge );
        float sweep = uCharge >= 0.0 ? exp( -pow( ( n.y - level ) * 7.0, 2.0 ) ) : 0.0;

        float idle = rim * 0.36 + edge * ( 0.03 + 0.05 * shimmer ) * ( 0.4 + rim ) + 0.006;
        float a = idle * uStrength;
        a += ( ring * ( 0.35 + edge * 1.2 ) + spot * ( 0.9 + edge ) ) * max( uStrength, 0.6 );
        a += sweep * ( 0.18 + edge * 0.7 );
        a += uFlash * ( 0.12 + rim * 0.5 + edge * 0.3 );
        float alive = uBreak > 0.0 ? step( cellRand, uBreak ) * step( 0.35, fract( uTime * 13.0 + cellRand * 7.0 ) ) : 1.0;
        a += uBreak * edge * alive * 0.9;
        vec3 col = mix( vec3( 0.25, 0.75, 1.0 ), vec3( 0.85, 0.98, 1.0 ), clamp( rim + spot + ring * 0.6, 0.0, 1.0 ) );
        gl_FragColor = vec4( col * a, 1.0 );
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
}

const beamGeometry = (() => {
  const geo = new THREE.ConeGeometry(3.2, 13, 32, 1, true);
  geo.translate(0, -6.5, 0);
  geo.rotateZ(Math.PI / 2);
  return geo;
})();

export function makeBeam(color = '#fff0b8') {
  const geo = beamGeometry;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vAlong = position.x / 13.0;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vNormal = normalize( normalMatrix * normal );
        vView = normalize( -mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform vec3 uColor;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs( dot( vNormal, vView ) );
        float a = ( 1.0 - vAlong ) * ( 1.0 - vAlong ) * facing * uStrength;
        gl_FragColor = vec4( uColor * a, 1.0 );
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    // Yaw turns the sub around; pitch tips its nose within its own frame, so nose-up stays nose-up mid-turn.
    this.yawPivot = new THREE.Group();
    this.pitchPivot = new THREE.Group();
    this.group.add(this.yawPivot);
    this.yawPivot.add(this.pitchPivot);
    this.rig = new THREE.Group();
    this.rig.scale.setScalar(RIG_SCALE);
    this.pitchPivot.add(this.rig);
    this.hullPivot = new THREE.Group();
    this.rig.add(this.hullPivot);
    this.duck = spawn('junk_duck');
    this.duck.position.set(-0.05, 1.58, 0.05);
    this.duck.scale.setScalar(1.3);
    this.duck.visible = false;
    this.mats = [];
    this.setHullModel('player_hull');
    this.scorches = [];
    this.shield = makeShieldBubble();
    this.pitchPivot.add(this.shield);

    this.lamp = new THREE.Group();
    this.rig.add(this.lamp);
    // One light stands in for the headlight and every bolted-on searchlight, so each lit surface only evaluates a
    // single spotlight no matter how many lamps the sub carries.
    this.headlight = new THREE.SpotLight('#fff1c9', 0, 34, 0.42, 0.6, 1.1);
    this.headlight.target.position.set(10, -1.0, 0);
    this.lamp.add(this.headlight, this.headlight.target);
    this.beam = makeBeam();
    this.beam.rotation.z = -0.12;
    this.lamp.add(this.beam);
    this.spots = Array.from({ length: MAX_SPOTLIGHTS }, () => {
      const beam = makeBeam();
      beam.scale.set(1.7, 1.55, 1.55);
      beam.userData.light = true;
      const holder = new THREE.Group();
      holder.add(beam);
      holder.visible = false;
      this.rig.add(holder);
      return { holder, beam };
    });
    this.glow = new THREE.PointLight('#9fdfff', 0, 12, 1.4);
    this.glow.position.set(0, 1.5, 3);
    this.rig.add(this.glow);
    // Red light cast on the sub by the nearest enemy viewport; lives in the scene so it can sit on the enemy's side.
    this.redGlow = new THREE.PointLight('#ff2a14', 0, 16, 1.3);
    scene.add(this.redGlow);
    scene.add(this.group);

    this.parts = [];
    this.fat = { x: 1, yz: 1 };
    this.fatTarget = { x: 1, yz: 1 };
    this.squash = 0;
    this.vel = new THREE.Vector2();
    this.extents = { hx: 2, hy: 1, cx: 0, cy: 0 };
    this.outline = [{ x: 0, y: 1, low: -1 }];
    this.time = 0;
    this.reset();
  }

  reset() {
    this.levels = Object.fromEntries(UPGRADES.map((u) => [u.id, u.start]));
    for (const part of this.parts) part.pivot.removeFromParent();
    for (const spot of this.spots ?? []) spot.holder.visible = false;
    for (const s of this.scorches ?? []) s.removeFromParent();
    this.scorches = [];
    this.mats = (this.mats ?? []).filter((x) => x.hull);
    for (const x of this.mats) x.m.emissive.copy(x.e);
    this.hurtFlash = 0;
    this.parts = [];
    this.group.position.set(0, 0, 0);
    this.vel.set(0, 0);
    this.cruise = 0;
    this.heading = new THREE.Vector2(1, 0);
    this.facing = 1;
    this.yaw = 0;
    this.yawVel = 0;
    this.restYaw = 0;
    this.prevRestYaw = 0;
    this.pitchVel = 0;
    this.pitch = 0;
    this.airborne = false;
    this.tumbling = false;
    this.spin = 0;
    this.invuln = 0;
    this.sinceHit = 99;
    this.shieldCharges = 0;
    this.shieldTimer = 0;
    this.shieldFlash = 0;
    this.shieldHitAge = 10;
    this.shieldCharge = -1;
    this.shieldBreak = 0;
    this.grapple = { state: 'idle', t: 0, cooldown: 0, target: null };
    this.alive = true;
    this.group.visible = true;
    this.syncParts(false);
    this.hp = this.maxHp;
  }

  get maxHp() {
    return 100 + 35 * (this.levels.hull - 1);
  }

  get speed() {
    const weight = this.parts.length * 0.11 + (this.levels.hull - 1) * 0.35;
    return Math.max(5, 9 + (this.levels.propulsion - 1) * 1.6 - weight);
  }

  get mountsUsed() {
    return this.parts.filter((p) => p.cat !== 'junk').length;
  }

  get mountCapacity() {
    return HULL_CAPACITY[this.levels.hull];
  }

  hasRoomFor(id) {
    return !needsMount(id, this.levels[id]) || this.mountsUsed < this.mountCapacity;
  }

  get damageMult() {
    return 1 + 0.15 * this.levels.sonar;
  }

  get shieldMax() {
    return this.levels.shield;
  }

  get magnetRadius() {
    return 2.4 + this.levels.grapple * 1.8;
  }

  upgrade(id) {
    this.levels[id]++;
    if (id === 'hull') this.hp = this.maxHp;
    if (id === 'shield') this.shieldCharges = this.shieldMax;
    this.squash = 1;
    return this.syncParts(true);
  }

  // Swap the hull mesh, carrying the rubber duck and keeping the hit-flash material list in step.
  setHullModel(name) {
    if (this.hullModel === name) return;
    if (this.hull) this.hull.removeFromParent();
    this.mats = this.mats.filter((x) => !x.hull);
    this.hull = spawn(name);
    this.hullModel = name;
    this.hullPivot.add(this.hull);
    for (const m of ownMaterials(this.hull)) {
      addWaterline(m, { topOnly: true });
      this.mats.push({ m, e: m.emissive.clone(), hull: true });
    }
    this.propeller = findNode(this.hull, 'propeller');
    this.hull.add(this.duck);
  }

  get bigHull() {
    return this.levels.hull >= BIG_HULL_LEVEL;
  }

  socketTransform(x, angleDeg) {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const r = hullRadius(x);
    const up = this.bigHull ? Math.min(r * Math.sin(a), deckCap(x)) : r * Math.sin(a);
    return {
      pos: new THREE.Vector3(x * this.fatTarget.x, up * this.fatTarget.yz, r * Math.cos(a) * this.fatTarget.yz),
      rotX: Math.PI / 2 - a,
    };
  }

  socketsFor(cat) {
    return this.bigHull && cat === 'cannon' ? [DECK_SOCKET, ...SOCKETS.cannon] : SOCKETS[cat];
  }

  // Slide a mount around the hull until its base sits clear of every porthole and its body clear of other parts.
  clearSocket(cat, x, angle) {
    const r = BASE_RADIUS[cat] ?? 0.25;
    const [back, front, width] = ENVELOPE[cat] ?? ENVELOPE.junk;
    const sx = Math.min(x, NOSE_LIMIT);
    const fx = this.fatTarget.x;
    const around = hullRadius(sx) * this.fatTarget.yz;
    const gap = (a, b) => Math.abs(THREE.MathUtils.degToRad(((a - b + 540) % 360) - 180));
    const onWindow = (a) => KEEP_CLEAR.some(([kx, ka, kr]) => (sx - kx) ** 2 + (gap(a, ka) * hullRadius(sx)) ** 2
      < (r + kr) ** 2);
    const bumps = (a) => this.parts.some((p) => {
      const e = p.envelope;
      const overlapAlong = sx * fx + back < e.x1 && sx * fx + front > e.x0;
      return overlapAlong && gap(a, e.angle) * Math.min(around, e.around) < width + e.width;
    });
    for (let step = 0; step <= 20; step++) {
      for (const dir of [1, -1]) {
        const a = angle + dir * step * 6;
        if (!onWindow(a) && !bumps(a)) return [sx, a];
      }
    }
    for (let step = 0; step <= 15; step++) {
      for (const dir of [1, -1]) {
        if (!onWindow(angle + dir * step * 6)) return [sx, angle + dir * step * 6];
      }
    }
    return [sx, angle];
  }

  addPart(cat, model, x, angle, animate) {
    [x, angle] = this.clearSocket(cat, x, angle);
    const [back, front, width] = ENVELOPE[cat] ?? ENVELOPE.junk;
    const envelope = {
      x0: x * this.fatTarget.x + back, x1: x * this.fatTarget.x + front, angle, width,
      around: hullRadius(Math.min(x, NOSE_LIMIT)) * this.fatTarget.yz,
    };
    const pivot = new THREE.Group();
    const obj = spawn(model);
    pivot.add(obj);
    for (const m of ownMaterials(obj)) {
      addWaterline(m, { topOnly: true });
      this.mats.push({ m, e: m.emissive.clone() });
    }
    const { rotX } = this.socketTransform(0, angle);
    if (cat === 'grapple') obj.rotation.x = rotX;
    else pivot.rotation.x = rotX;
    if (animate) pivot.scale.setScalar(0.01);
    this.rig.add(pivot);
    const part = {
      cat, model, obj, pivot, socket: [x, angle], envelope, pop: animate ? 0 : 1, muzzle: findNode(obj, 'muzzle'),
      props: findNodes(obj, 'thruster_prop'), dish: findNode(obj, 'sonar_dish'),
      arm: findNode(obj, 'grapple_arm'), claw: findNode(obj, 'grapple_claw'), timer: Math.random(),
      barrels: findNode(obj, 'cannon_barrels'),
    };
    if (cat === 'spotlight') {
      const lens = findNode(obj, 'lens');
      part.spot = this.spots[this.parts.filter((q) => q.cat === 'spotlight').length];
      part.spot.holder.visible = true;
      lens.add(part.spot.holder);
      part.lens = lens;
    }
    this.parts.push(part);
    return part;
  }

  syncParts(animate) {
    const L = this.levels.hull;
    this.fatTarget = { x: 1 + 0.14 * (L - 1), yz: 1 + 0.16 * (L - 1) };
    if (!animate) this.fat = { ...this.fatTarget };
    this.duck.visible = L >= 2;
    const added = [];
    const hullName = this.bigHull ? 'player_hull_big' : 'player_hull';
    // Growing into the big hull re-bolts everything so the new front-deck mount gets the first cannon.
    const rebuild = hullName !== this.hullModel;
    this.setHullModel(hullName);
    for (const part of this.parts.filter((q) => q.cat !== 'junk' && (rebuild || q.model !== partModel(q.cat, this.levels[q.cat])))) {
      part.pivot.removeFromParent();
      this.parts.splice(this.parts.indexOf(part), 1);
    }
    for (const cat of Object.keys(PART_MODEL)) {
      const sockets = this.socketsFor(cat);
      const have = this.parts.filter((p) => p.cat === cat).length;
      const want = Math.min(partCount(cat, this.levels[cat]), sockets.length);
      for (let i = have; i < want; i++) {
        const [x, angle] = sockets[i];
        added.push(this.addPart(cat, partModel(cat, this.levels[cat]), x, angle, animate));
      }
    }
    const junkHave = this.parts.filter((p) => p.cat === 'junk').length;
    for (let i = junkHave; i < JUNK_PER_HULL[L]; i++) {
      const [model, x, angle] = SOCKETS.junk[i];
      added.push(this.addPart('junk', model, x, angle, animate));
    }
    for (const part of this.parts) {
      part.target = this.socketTransform(...part.socket).pos;
      if (!animate) part.pivot.position.copy(part.target);
    }
    this.measure();
    return added;
  }

  measure() {
    const scale = this.rig.scale.clone();
    const hullScale = this.hullPivot.scale.clone();
    this.rig.scale.setScalar(RIG_SCALE);
    this.hullPivot.scale.set(this.fatTarget.x, this.fatTarget.yz, this.fatTarget.yz);
    const saved = this.parts.map((p) => [p.pivot.position.clone(), p.pivot.scale.clone()]);
    for (const part of this.parts) {
      part.pivot.position.copy(part.target);
      part.pivot.scale.setScalar(1);
    }
    this.group.updateMatrixWorld(true);
    const toLocal = this.pitchPivot.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const parts = [this.hullPivot, ...this.parts.map((p) => p.pivot)];
    for (const root of parts) {
      root.traverse((o) => {
        if (!o.isMesh || o.userData.light) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(toLocal.clone().multiply(o.matrixWorld)));
      });
    }
    this.measureOutline(parts, toLocal, box);
    this.parts.forEach((p, i) => {
      p.pivot.position.copy(saved[i][0]);
      p.pivot.scale.copy(saved[i][1]);
    });
    this.rig.scale.copy(scale);
    this.hullPivot.scale.copy(hullScale);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    this.box = { cx: c.x, cy: c.y, hx: s.x / 2, hy: s.y / 2, hz: s.z / 2 };
    this.updateExtents();
    this.shield.position.set(c.x, c.y, 0);
    // Always a round bubble. Length and depth count alike, so measuring mid-turn, with the hull swung toward the
    // camera, gives the same size.
    this.shield.scale.setScalar(Math.max(s.x * 0.62, s.z * 0.62, s.y * 0.68));
  }

  // The highest and lowest points of the sub's side view in each of a row of slices along its length, so ice can come
  // right up against the hull and the parts on it.
  measureOutline(parts, toLocal, box) {
    const top = new Array(OUTLINE_SLICES).fill(-Infinity);
    const bottom = new Array(OUTLINE_SLICES).fill(Infinity);
    const width = box.max.x - box.min.x;
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const root of parts) {
      root.traverse((o) => {
        if (!o.isMesh || o.userData.light) return;
        m.multiplyMatrices(toLocal, o.matrixWorld);
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const k = Math.min(OUTLINE_SLICES - 1, Math.floor(((v.x - box.min.x) / width) * OUTLINE_SLICES));
          top[k] = Math.max(top[k], v.y);
          bottom[k] = Math.min(bottom[k], v.y);
        }
      });
    }
    this.outline = top.map((y, k) => ({ x: box.min.x + ((k + 0.5) / OUTLINE_SLICES) * width, y, low: bottom[k] }))
      .filter((p) => p.y > -Infinity);
  }

  // Silhouette as seen by the camera for the current yaw; cx is signed, so it flips with the heading.
  updateExtents() {
    const b = this.box;
    const c = Math.cos(this.yaw);
    const s = Math.abs(Math.sin(this.yaw));
    this.extents = { hx: Math.max(b.hx * Math.abs(c), b.hz * s, b.hy * 0.8), hy: b.hy, cx: b.cx * c, cy: b.cy };
  }

  get mass() {
    return 1 + this.parts.length * 0.045 + (this.levels.hull - 1) * 0.12;
  }

  get facingSign() {
    return Math.cos(this.yaw) >= 0 ? 1 : -1;
  }

  // Angle of the sub's silhouette on screen.
  get screenTilt() {
    return this.pitch * this.facingSign;
  }

  // Point in the sub's own frame: x along its nose, y up through its tower.
  toLocal(x, y) {
    const a = -this.screenTilt;
    const dx = x - this.group.position.x;
    const dy = y - this.group.position.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: lx, y: ly };
  }

  // Half-length and half-height of the hull's ellipse as seen from the camera, turning included. Sub-to-sub contact
  // uses the hull alone; bolted-on parts may overlap a little.
  get bodyHalf() {
    const turn = Math.abs(Math.cos(this.yaw));
    const hy = 1.0 * this.fat.yz * RIG_SCALE;
    return { hx: Math.max(2.15 * this.fat.x * RIG_SCALE * turn, hy), hy };
  }

  // Points around the hull's outline in world space, for testing it against another hull.
  bodyOutline(count = 12) {
    const { hx, hy } = this.bodyHalf;
    const c = this.group.position;
    const a = this.screenTilt;
    const pts = [];
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2;
      const x = Math.cos(t) * hx;
      const y = Math.sin(t) * hy;
      pts.push({ x: c.x + x * Math.cos(a) - y * Math.sin(a), y: c.y + x * Math.sin(a) + y * Math.cos(a) });
    }
    return pts;
  }

  bodyTest(x, y, r = 0) {
    const p = this.toLocal(x, y);
    const { hx, hy } = this.bodyHalf;
    const dx = p.x / (hx + r);
    const dy = p.y / (hy + r);
    return dx * dx + dy * dy < 1;
  }

  hitTest(x, y, r = 0) {
    const e = this.extents;
    const p = this.toLocal(x, y);
    const dx = (p.x - e.cx) / (e.hx * 0.82 + r);
    const dy = (p.y - e.cy) / (e.hy * 0.78 + r);
    return dx * dx + dy * dy < 1;
  }

  // How far the rock reaches into the hull's rounded underside with the sub at (x, y), checked along its whole
  // length; positive means it pokes in by that much.
  rockDepth(x, y, bottom) {
    const e = this.extents;
    let depth = -Infinity;
    for (const t of HULL_SAMPLES) {
      depth = Math.max(depth, bottom(x + t * e.hx) + e.hy * Math.sqrt(Math.max(0, 1 - t * t)) - y);
    }
    return depth;
  }

  // How far the top of the hull reaches up into the ice above it with the sub at (x, y), checked along its whole
  // length; positive means it pokes in by that much.
  iceDepth(x, y, ceiling) {
    const facing = Math.cos(this.yaw);
    const cos = Math.cos(this.screenTilt);
    const sin = Math.sin(this.screenTilt);
    let depth = -Infinity;
    for (const p of this.outline) {
      const px = p.x * facing;
      depth = Math.max(depth, y + px * sin + p.y * cos - ceiling(x + px * cos - p.y * sin));
    }
    return depth;
  }

  // How far the hull overlaps solid floating ice with the sub at (x, y): how far it would have to drop to clear it
  // below, and how far rise to clear it above. Null when it is clear.
  iceOverlap(x, y, span) {
    const facing = Math.cos(this.yaw);
    const cos = Math.cos(this.screenTilt);
    const sin = Math.sin(this.screenTilt);
    let down = 0;
    let up = 0;
    let hit = false;
    for (const p of this.outline) {
      const px = p.x * facing;
      const s = span(x + px * cos - ((p.y + p.low) / 2) * sin);
      if (!s) continue;
      const top = y + px * sin + p.y * cos;
      const low = y + px * sin + p.low * cos;
      if (top <= s.bottom || low >= s.top) continue;
      hit = true;
      down = Math.max(down, top - s.bottom);
      up = Math.max(up, s.top - low);
    }
    return hit ? { down, up } : null;
  }

  // Landed on ice above the water, the sub is a loose body. It falls, slides and tips over its own outline, so it
  // settles on whichever of its hull, periscope or parts meets the ice, until it slips back into the sea.
  tumble(dt, span) {
    const p = this.group.position;
    const f = Math.cos(this.yaw);
    const ox = this.box.cx * f;
    const oy = this.box.cy;
    const hx = this.extents.hx;
    const hy = this.box.hy;
    const inertia = (hx * hx + hy * hy) / 4;
    let a = this.screenTilt;
    let cx = p.x + ox * Math.cos(a) - oy * Math.sin(a);
    let cy = p.y + ox * Math.sin(a) + oy * Math.cos(a);
    const tip = nearerEnd(span, cx);
    const steps = 4;
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      this.vel.y -= GRAVITY * h;
      this.spin *= Math.exp(-h * 0.6);
      cx += this.vel.x * h;
      cy += this.vel.y * h;
      a += this.spin * h;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      let deepest = null;
      for (const q of this.outline) {
        for (const qy of [q.y, q.low]) {
          const lx = q.x * f - ox;
          const ly = qy - oy;
          const rx = lx * cos - ly * sin;
          const ry = lx * sin + ly * cos;
          const out = iceExit(span, cx + rx, cy + ry);
          if (!out) continue;
          if (!deepest || out.depth > deepest.depth) deepest = out;
          const vx = this.vel.x - this.spin * ry;
          const vy = this.vel.y + this.spin * rx;
          const vn = vx * out.nx + vy * out.ny;
          if (vn >= 0) continue;
          if (vn < -1) this.iceBump = { x: cx + rx, vx: this.vel.x, vy: this.vel.y };
          const rn = rx * out.ny - ry * out.nx;
          const jn = (-(1 + (vn < -1 ? ICE_BOUNCE : 0)) * vn) / (1 + (rn * rn) / inertia);
          const tx = out.ny;
          const ty = -out.nx;
          const rt = rx * ty - ry * tx;
          const vt = vx * tx + vy * ty;
          const jt = THREE.MathUtils.clamp(-vt / (1 + (rt * rt) / inertia), -ICE_FRICTION * jn, ICE_FRICTION * jn);
          this.vel.x += jn * out.nx + jt * tx;
          this.vel.y += jn * out.ny + jt * ty;
          this.spin += (jn * rn + jt * rt) / inertia;
        }
      }
      if (deepest) {
        cx += deepest.nx * deepest.depth;
        cy += deepest.ny * deepest.depth;
        if (deepest.ny > 0.5) {
          this.vel.x += tip * ICE_TIP * deepest.ny * h;
          this.vel.y += tip * ICE_TIP * -deepest.nx * h;
        }
      }
    }
    p.x = cx - (ox * Math.cos(a) - oy * Math.sin(a));
    p.y = cy - (ox * Math.sin(a) + oy * Math.cos(a));
    this.pitch = a * this.facingSign;
    this.pitchVel = this.spin * this.facingSign;
  }

  get center() {
    const e = this.extents;
    const a = this.screenTilt;
    return new THREE.Vector2(
      this.group.position.x + e.cx * Math.cos(a) - e.cy * Math.sin(a),
      this.group.position.y + e.cx * Math.sin(a) + e.cy * Math.cos(a),
    );
  }

  get forward() {
    return new THREE.Vector2(this.facingSign * Math.cos(this.pitch), Math.sin(this.pitch));
  }

  // True while the nose is swinging past the camera, when guns would fire sideways.
  get turning() {
    return Math.abs(Math.cos(this.yaw)) < 0.45;
  }

  get radius() {
    return Math.max(this.extents.hx, this.extents.hy);
  }

  // The highest point of the sub, including the nose or tail when it tilts.
  get top() {
    const e = this.extents;
    const a = this.screenTilt;
    return this.center.y + Math.abs(e.hx * Math.sin(a)) + e.hy * Math.cos(a);
  }

  setDarkness(dark) {
    const lamps = this.levels.spotlight;
    const power = 1 + 0.35 * lamps;
    const light = this.headlight;
    light.intensity = lamps ? (6 + 40 * dark) * power * (0.7 + 0.3 * lamps) : 9 * dark;
    light.distance = lamps ? 50 + 10 * lamps : 34;
    light.angle = lamps ? 0.42 + 0.06 * lamps : 0.42;
    this.beam.material.uniforms.uStrength.value = 0.035 * dark;
    this.beam.visible = dark > 0.02;
    this.glow.intensity = (2.5 + 9 * lamps) * dark;
    this.glow.distance = 12 + 4 * lamps;
    for (const spot of this.spots) spot.beam.material.uniforms.uStrength.value = 0.01 + 0.032 * dark;
  }

  get spotRange() {
    return 22 + 5 * this.levels.spotlight;
  }

  update(dt, input, bounds) {
    this.time += dt;
    this.lastInput = input;
    const thrust = new THREE.Vector2(input.x, input.y);
    if (thrust.lengthSq() > 1) thrust.normalize();
    const pushing = thrust.lengthSq() > 0.01;
    // Propellers spin up while a direction is held and wind down to a stop when it is let go.
    this.drive = THREE.MathUtils.lerp(this.drive ?? 0, pushing && this.alive && !this.airborne ? 1 : 0,
      1 - Math.exp(-dt * (pushing ? 6 : 2.5)));
    const pushDir = pushing ? thrust.clone().normalize() : null;
    if (!this.alive || this.airborne) thrust.set(0, 0);
    // Holding a steady heading builds up cruising speed; turning or letting go bleeds it away.
    if (thrust.lengthSq() > 0.01) {
      const dir = thrust.clone().normalize();
      const steady = dir.dot(this.heading) > 0.85;
      this.cruise = steady ? Math.min(1, this.cruise + CRUISE_BUILD * dt) : Math.max(0, this.cruise - dt * 2.5);
      this.heading.lerp(dir, 1 - Math.exp(-dt * 3)).normalize();
    } else {
      this.cruise = Math.max(0, this.cruise - dt * 1.5);
    }
    const drag = this.airborne ? AIR_DRAG : DRAG / this.mass;
    this.vel.addScaledVector(thrust, this.speed * (1 + this.cruise * CRUISE_BOOST) * drag * dt);
    this.vel.multiplyScalar(Math.exp(-drag * dt));
    const p = this.group.position;
    const ice = bounds.ice;
    this.iceBump = null;
    if (this.airborne && ice && !this.tumbling) {
      this.tumbling = !!this.iceOverlap(p.x + this.vel.x * dt, p.y + this.vel.y * dt, ice);
      if (this.tumbling) this.spin = this.pitchVel * this.facingSign;
    }
    if (this.tumbling) this.tumble(dt, ice);
    else this.move(dt, bounds);
    if (bounds.left !== undefined) p.x = THREE.MathUtils.clamp(p.x, bounds.left, bounds.right);
    if (bounds.top !== undefined) p.y = Math.min(p.y, bounds.top);
    this.airborne = p.y > SURFACE_Y + 0.3;
    if (!this.airborne && this.tumbling) {
      this.tumbling = false;
      this.righting = true;
    }
    this.steer(dt, input, pushDir);
  }

  move(dt, bounds) {
    if (this.airborne) this.vel.y -= GRAVITY * dt;
    const p = this.group.position;
    const dx = this.vel.x * dt;
    const nx = p.x + dx;
    // Gentle slopes lift the sub as it slides along them; anything steeper is a wall. Floating ice works the same
    // way from above: a sloping keel presses the sub down, a sheer one stops it.
    const lift = this.rockDepth(nx, p.y, bounds.bottom);
    // Floating ice is solid all round: a sub can slide along a gently sloping face, under a keel or over a top, but a
    // steep one is a wall.
    const ice = bounds.ice;
    const deep = (o) => (o ? Math.min(o.down, o.up) : 0);
    const pressBefore = ice ? deep(this.iceOverlap(p.x, p.y, ice)) : 0;
    const press = ice ? deep(this.iceOverlap(nx, p.y, ice)) : 0;
    const walled = press - pressBefore > Math.abs(dx) * MAX_CLIMB;
    if ((lift > 0 && lift > Math.abs(dx) * MAX_CLIMB) || walled) {
      if (walled) this.iceBump = { x: nx + Math.sign(dx) * this.extents.hx, vx: this.vel.x, vy: 0 };
      // A real crash bounces off; pressing on into the wall just stops dead, so the speed never flickers.
      this.vel.x = Math.abs(this.vel.x) > WALL_BOUNCE_SPEED ? this.vel.x * -0.25 : 0;
    } else {
      p.x = nx;
    }
    p.y += this.vel.y * dt;
    const overlap = ice && this.iceOverlap(p.x, p.y, ice);
    if (overlap) {
      // Pushed out the shortest way: under a berg it is pressed back down, on top of one it is lifted clear.
      const below = overlap.down <= overlap.up;
      if (Math.abs(this.vel.y) > 0.5) this.iceBump = { x: p.x, vx: 0, vy: this.vel.y };
      p.y += below ? -overlap.down : overlap.up;
      if (below ? this.vel.y > 0 : this.vel.y < 0) this.vel.y *= -0.2;
    }
    const sunk = this.rockDepth(p.x, p.y, bounds.bottom);
    this.onFloor = sunk > -0.05;
    if (sunk > 0) {
      this.impact = Math.max(this.impact ?? 0, -this.vel.y);
      p.y += sunk;
      this.vel.y *= -0.2;
    }
  }

  steer(dt, input, pushDir) {
    // Holding left or right spins the turn up; letting go lets it coast to a stop wherever it ends up.
    // Each turnaround picks at random whether the nose swings past the camera or away from it. Reversing mid-turn
    // heads back the way it came.
    if (Math.abs(input.x) > 0.1 && !this.tumbling) {
      const dir = Math.sign(input.x);
      if (dir !== this.facing) {
        this.facing = dir;
        if (Math.abs(this.yaw - this.restYaw) < 0.25) {
          this.prevRestYaw = this.restYaw;
          this.restYaw += (Math.random() < 0.5 ? -1 : 1) * Math.PI;
        } else {
          [this.restYaw, this.prevRestYaw] = [this.prevRestYaw, this.restYaw];
        }
      }
      const want = THREE.MathUtils.clamp((this.restYaw - this.yaw) * 6, -TURN_SPEED, TURN_SPEED);
      this.yawVel += THREE.MathUtils.clamp(want - this.yawVel, -dt * TURN_ACCEL, dt * TURN_ACCEL);
    } else {
      this.yawVel *= Math.exp(-dt * TURN_DRAG);
    }
    const before = this.yaw - this.restYaw;
    this.yaw += this.yawVel * dt;
    const lo = Math.min(this.restYaw, this.prevRestYaw);
    const hi = Math.max(this.restYaw, this.prevRestYaw);
    if (Math.sign(this.yaw - this.restYaw) !== Math.sign(before) && before !== 0) {
      this.yaw = this.restYaw;
      this.yawVel = 0;
    } else if (this.yaw < lo || this.yaw > hi) {
      this.yaw = THREE.MathUtils.clamp(this.yaw, lo, hi);
      this.yawVel = 0;
    }
    if (this.yaw === this.restYaw && Math.abs(this.restYaw) > Math.PI * 3) {
      const wrapBy = Math.round(this.restYaw / (Math.PI * 2)) * Math.PI * 2;
      this.yaw -= wrapBy;
      this.restYaw -= wrapBy;
      this.prevRestYaw -= wrapBy;
    }
    this.yawPivot.rotation.y = this.yaw;
    this.updateExtents();
    // The nose tips toward where you push with some momentum, and coasts to a stop at whatever tilt it reached when
    // you let go. In the air it follows the arc of the jump.
    if (this.tumbling) {
      this.pitchPivot.rotation.z = this.pitch;
      return this.animate(dt);
    }
    let wantPitch = null;
    if (this.airborne) wantPitch = Math.atan2(this.vel.y, Math.abs(this.vel.x) + 0.3);
    else if (pushDir) wantPitch = Math.atan2(pushDir.y, Math.abs(pushDir.x));
    // After a fall off the ice the sub levels out by itself until it is steered.
    if (pushDir || this.airborne) this.righting = false;
    else if (this.righting) wantPitch = 0;
    if (wantPitch === null) {
      this.pitchVel *= Math.exp(-dt * TURN_DRAG);
    } else {
      wantPitch = THREE.MathUtils.clamp(wantPitch, -MAX_PITCH, MAX_PITCH);
      const rate = THREE.MathUtils.clamp((wantPitch - this.pitch) * 5, -PITCH_SPEED, PITCH_SPEED);
      const accel = this.airborne ? PITCH_ACCEL * 2 : PITCH_ACCEL;
      this.pitchVel += THREE.MathUtils.clamp(rate - this.pitchVel, -dt * accel, dt * accel);
    }
    // A sub that tipped past the steepest climb on the ice swings back within it on its own.
    const beyond = Math.abs(this.pitch) > MAX_PITCH;
    this.pitch += this.pitchVel * dt;
    if (!beyond && Math.abs(this.pitch) >= MAX_PITCH) {
      this.pitch = THREE.MathUtils.clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
      this.pitchVel = 0;
    }
    this.pitchPivot.rotation.z = this.pitch;
    this.animate(dt);
  }

  animate(dt) {
    this.pitchPivot.rotation.x = Math.sin(this.time * 1.7) * 0.03;
    this.rig.position.y = Math.sin(this.time * 2.1) * 0.08;

    for (const key of ['x', 'yz']) this.fat[key] = THREE.MathUtils.lerp(this.fat[key], this.fatTarget[key], 1 - Math.exp(-dt * 7));
    this.squash = Math.max(0, this.squash - dt * 2.2);
    const wob = Math.sin(this.squash * 14) * this.squash * 0.12;
    this.hullPivot.scale.set(this.fat.x * (1 + wob), this.fat.yz * (1 - wob), this.fat.yz * (1 - wob));
    this.lamp.position.set(1.85 * this.fat.x, -0.62 * this.fat.yz, 0);

    for (const part of this.parts) {
      part.pivot.position.lerp(part.target, 1 - Math.exp(-dt * 7));
      if (part.pop < 1) {
        part.pop = Math.min(1, part.pop + dt * 1.8);
        part.pivot.scale.setScalar(Math.max(0.01, elasticOut(part.pop)));
      }
      for (const prop of part.props) prop.rotation.x += dt * 18 * this.drive;
      if (part.dish) part.dish.rotation.y += dt * 2.2;
    }
    const spin = (8 + this.levels.propulsion * 3 + this.vel.length() * 2 + this.cruise * 25) * this.drive;
    if (this.propeller) this.propeller.rotation.x -= dt * spin;

    if (this.shieldCharges < this.shieldMax) {
      this.shieldTimer += dt;
      if (this.shieldTimer > 9 - this.levels.shield) {
        this.shieldTimer = 0;
        this.shieldCharges++;
        this.shieldFlash = 0.15;
        this.shieldCharge = 0;
      }
    }
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2);
    this.shieldHitAge += dt;
    this.shieldBreak = Math.max(0, this.shieldBreak - dt * 1.4);
    if (this.shieldCharge >= 0) this.shieldCharge = this.shieldCharge + dt * 1.6 > 1 ? -1 : this.shieldCharge + dt * 1.6;
    const su = this.shield.material.uniforms;
    su.uTime.value = this.time;
    su.uFlash.value = this.shieldFlash;
    su.uHitAge.value = this.shieldHitAge;
    su.uCharge.value = this.shieldCharge;
    su.uBreak.value = this.shieldBreak;
    su.uStrength.value = THREE.MathUtils.lerp(su.uStrength.value, this.shieldCharges > 0 ? 1 : 0, 1 - Math.exp(-dt * 5));
    this.shield.visible = this.alive && (su.uStrength.value > 0.02 || this.shieldFlash > 0.01 || this.shieldHitAge < 1.2
      || this.shieldBreak > 0 || this.shieldCharge >= 0);

    this.sinceHit += dt;
    if (this.alive && this.sinceHit > REGEN_DELAY) this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.rig.visible = this.alive;

    if (this.hurtFlash > 0) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
      for (const { m, e } of this.mats) m.emissive.copy(e).lerp(HOT, this.hurtFlash * 0.55);
    }
    const repaired = this.hp >= this.maxHp - 0.01;
    for (const s of this.scorches) {
      s.material.opacity = Math.max(0, s.material.opacity - (repaired ? dt * 0.6 : 0));
    }
    this.scorches = this.scorches.filter((s) => {
      if (s.material.opacity > 0.01) return true;
      s.removeFromParent();
      return false;
    });
  }

  // A sooty burn on both flanks of the hull, roughly where the hit landed.
  scorch(from) {
    const local = this.hullPivot.worldToLocal(new THREE.Vector3(from.x, from.y, 0));
    const x = THREE.MathUtils.clamp(local.x, -1.7, 1.6);
    const a = Math.atan2(local.y, 0.8) + THREE.MathUtils.randFloatSpread(0.4);
    const r = hullRadius(x);
    const size = THREE.MathUtils.randFloat(0.65, 1.05);
    for (const angle of [a, Math.PI - a]) {
      const normal = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle));
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({
          map: sootTexture, transparent: true, depthWrite: false, roughness: 1, color: '#ffffff',
          polygonOffset: true, polygonOffsetFactor: -4, opacity: 1,
        }),
      );
      decal.position.set(x, 0, 0).addScaledVector(normal, r + 0.015);
      decal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      decal.rotateZ(Math.random() * Math.PI * 2);
      this.hullPivot.add(decal);
      this.scorches.push(decal);
    }
    while (this.scorches.length > MAX_SCORCHES * 2) this.scorches.shift().removeFromParent();
  }

  // Points on the camera-facing flank where damage smokes; the tower stands in until the hull is scorched.
  damageSpots() {
    const spots = this.scorches.filter((_, i) => i % 2 === (this.facingSign > 0 ? 0 : 1));
    return spots.length ? spots : [this.hull];
  }

  // Returns 'shield', 'shield-broken', 'hit', or 'dead'.
  takeHit(amount, from) {
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      this.shieldTimer = 0;
      this.shieldFlash = 0.5;
      this.shieldHitAge = 0;
      if (from) {
        this.shield.updateWorldMatrix(true, false);
        this.shield.material.uniforms.uHitDir.value.copy(this.shield.worldToLocal(new THREE.Vector3(from.x, from.y, 0)))
          .normalize();
      }
      if (this.shieldCharges === 0) this.shieldBreak = 1;
      this.invuln = 0.4;
      return this.shieldCharges === 0 ? 'shield-broken' : 'shield';
    }
    this.hp -= amount;
    this.sinceHit = 0;
    this.invuln = 0.35;
    this.squash = 0.6;
    this.hurtFlash = 1;
    if (from) {
      const c = this.center;
      const push = new THREE.Vector2(c.x - from.x, c.y - from.y).normalize();
      this.vel.addScaledVector(push, 4 + amount * 0.18);
      this.scorch(from);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      return 'dead';
    }
    return 'hit';
  }

  partsOf(cat) {
    return this.parts.filter((p) => p.cat === cat && p.pop > 0.3);
  }

  propellerWorld(out = new THREE.Vector3()) {
    return this.propeller.getWorldPosition(out);
  }
}
