import * as THREE from 'three';
import { findNode, findNodes, ownMaterials, spawn } from './assets.js';
import { JUNK_PER_HULL, PART_MODEL, SOCKETS, UPGRADES, partCount } from './upgrades.js';
import { SURFACE_Y } from './water.js';

// Swimming in any direction shows the sub in full profile; idling, it drifts round to show three quarters of its
// face.
// Yaw stays within [-PI, 0], so every turn swings the nose past the camera instead of showing the stern.
const YAW = {
  right: { swim: 0, idle: -0.75 },
  left: { swim: -Math.PI, idle: -(Math.PI - 0.75) },
};
const DRAG = 1.9;
const MAX_SPOTLIGHTS = 4;
const GRAVITY = 18;
const AIR_DRAG = 0.15;
const TURN_RATE = 2.4;
const TURN_MAX_SPEED = 2.2;
const MAX_PITCH = 1.52;
const CRUISE_BUILD = 0.32;
const CRUISE_BOOST = 0.9;
const RIG_SCALE = 0.82;
const REGEN_DELAY = 5;
const REGEN_RATE = 3;

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

function makeShieldBubble() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uStrength: { value: 0 } },
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
      uniform float uTime, uFlash, uStrength;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        float rim = pow( 1.0 - abs( dot( vNormal, vView ) ), 2.2 );
        float bands = 0.5 + 0.5 * sin( vPos.y * 14.0 - uTime * 3.0 + vPos.x * 4.0 );
        vec3 col = mix( vec3( 0.25, 0.75, 1.0 ), vec3( 0.8, 0.97, 1.0 ), rim );
        float a = ( rim * 0.38 + bands * 0.02 + 0.008 ) * uStrength + uFlash * ( 0.3 + rim );
        gl_FragColor = vec4( col * a, 1.0 );
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
}

export function makeBeam(color = '#fff0b8') {
  const geo = new THREE.ConeGeometry(3.2, 13, 32, 1, true);
  geo.translate(0, -6.5, 0);
  geo.rotateZ(Math.PI / 2);
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
    this.hull = spawn('player_hull');
    this.hullPivot.add(this.hull);
    this.mats = ownMaterials(this.hull).map((m) => ({ m, e: m.emissive.clone(), hull: true }));
    this.scorches = [];
    this.propeller = findNode(this.hull, 'propeller');
    this.duck = spawn('junk_duck');
    this.duck.position.set(0.5, 1.58, 0.05);
    this.duck.scale.setScalar(1.3);
    this.duck.visible = false;
    this.hull.add(this.duck);
    this.shield = makeShieldBubble();
    this.pitchPivot.add(this.shield);

    this.lamp = new THREE.Group();
    this.rig.add(this.lamp);
    this.headlight = new THREE.SpotLight('#ffe2a8', 0, 34, 0.42, 0.65, 1.1);
    this.headlight.target.position.set(10, -1.5, 0);
    this.lamp.add(this.headlight, this.headlight.target);
    this.beam = makeBeam();
    this.beam.rotation.z = -0.12;
    this.lamp.add(this.beam);
    // A fixed pool of searchlights keeps the scene's light count constant, so buying one never recompiles shaders.
    this.spots = Array.from({ length: MAX_SPOTLIGHTS }, () => {
      const light = new THREE.SpotLight('#fff1c9', 0, 50, 0.3, 0.5, 1.0);
      light.target.position.set(10, 0, 0);
      const beam = makeBeam();
      beam.scale.set(1.6, 0.75, 0.75);
      beam.userData.light = true;
      const holder = new THREE.Group();
      holder.add(light, light.target, beam);
      holder.visible = false;
      this.rig.add(holder);
      return { holder, light, beam };
    });
    this.glow = new THREE.PointLight('#9fdfff', 0, 12, 1.4);
    this.glow.position.set(0, 1.5, 3);
    this.rig.add(this.glow);
    scene.add(this.group);

    this.parts = [];
    this.fat = { x: 1, yz: 1 };
    this.fatTarget = { x: 1, yz: 1 };
    this.squash = 0;
    this.vel = new THREE.Vector2();
    this.extents = { hx: 2, hy: 1, cx: 0, cy: 0 };
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
    this.yaw = YAW.right.idle;
    this.pitch = 0;
    this.airborne = false;
    this.invuln = 0;
    this.sinceHit = 99;
    this.shieldCharges = 0;
    this.shieldTimer = 0;
    this.shieldFlash = 0;
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

  socketTransform(x, angleDeg) {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const r = hullRadius(x);
    return {
      pos: new THREE.Vector3(x * this.fatTarget.x, r * Math.sin(a) * this.fatTarget.yz, r * Math.cos(a) * this.fatTarget.yz),
      rotX: Math.PI / 2 - a,
    };
  }

  addPart(cat, model, x, angle, animate) {
    const pivot = new THREE.Group();
    const obj = spawn(model);
    pivot.add(obj);
    for (const m of ownMaterials(obj)) this.mats.push({ m, e: m.emissive.clone() });
    const { rotX } = this.socketTransform(0, angle);
    if (cat === 'grapple') obj.rotation.x = rotX;
    else pivot.rotation.x = rotX;
    if (animate) pivot.scale.setScalar(0.01);
    this.rig.add(pivot);
    const part = {
      cat, obj, pivot, socket: [x, angle], pop: animate ? 0 : 1, muzzle: findNode(obj, 'muzzle'),
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
    this.fatTarget = { x: 1 + 0.07 * (L - 1), yz: 1 + 0.16 * (L - 1) };
    if (!animate) this.fat = { ...this.fatTarget };
    this.duck.visible = L >= 2;
    const added = [];
    for (const cat of Object.keys(PART_MODEL)) {
      const have = this.parts.filter((p) => p.cat === cat).length;
      const want = Math.min(partCount(cat, this.levels[cat]), SOCKETS[cat].length);
      for (let i = have; i < want; i++) {
        const [x, angle] = SOCKETS[cat][i];
        added.push(this.addPart(cat, PART_MODEL[cat], x, angle, animate));
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
    this.shield.scale.set(s.x * 0.62, s.y * 0.68, Math.max(s.y, s.x * 0.5) * 0.7);
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

  hitTest(x, y, r = 0) {
    const e = this.extents;
    const p = this.toLocal(x, y);
    const dx = (p.x - e.cx) / (e.hx * 0.82 + r);
    const dy = (p.y - e.cy) / (e.hy * 0.78 + r);
    return dx * dx + dy * dy < 1;
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

  setDarkness(dark) {
    this.headlight.intensity = 40 * dark;
    this.beam.material.uniforms.uStrength.value = 0.22 * dark;
    this.beam.visible = dark > 0.02;
    this.glow.intensity = 14 * dark;
    const power = 1 + 0.3 * this.levels.spotlight;
    for (const spot of this.spots) {
      spot.light.intensity = spot.holder.visible ? (6 + 90 * dark) * power : 0;
      spot.light.distance = 40 + 8 * this.levels.spotlight;
      spot.beam.material.uniforms.uStrength.value = 0.02 + 0.12 * dark;
    }
  }

  get spotRange() {
    return 22 + 5 * this.levels.spotlight;
  }

  update(dt, input, bounds) {
    this.time += dt;
    const thrust = new THREE.Vector2(input.x, input.y);
    if (thrust.lengthSq() > 1) thrust.normalize();
    const pushing = thrust.lengthSq() > 0.01;
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
    if (this.airborne) this.vel.y -= GRAVITY * dt;
    this.vel.multiplyScalar(Math.exp(-drag * dt));
    const p = this.group.position;
    const e = this.extents;
    const nx = p.x + this.vel.x * dt;
    if (bounds.bottom(nx) + e.hy > p.y + 0.4) {
      this.vel.x *= -0.25;
    } else {
      p.x = nx;
    }
    p.y += this.vel.y * dt;
    const floor = bounds.bottom(p.x) + e.hy;
    if (p.y < floor) {
      p.y = floor;
      this.vel.y *= -0.2;
    }
    if (bounds.left !== undefined) p.x = THREE.MathUtils.clamp(p.x, bounds.left, bounds.right);
    if (bounds.top !== undefined) p.y = Math.min(p.y, bounds.top);
    this.airborne = p.y > SURFACE_Y + 0.3;

    if (Math.abs(input.x) > 0.1) this.facing = Math.sign(input.x);
    const swimming = pushing || this.airborne;
    const pose = this.facing > 0 ? YAW.right : YAW.left;
    const wantYaw = swimming ? pose.swim : pose.idle;
    const step = (wantYaw - this.yaw) * (1 - Math.exp(-dt * TURN_RATE));
    this.yaw += THREE.MathUtils.clamp(step, -dt * TURN_MAX_SPEED, dt * TURN_MAX_SPEED);
    this.yawPivot.rotation.y = this.yaw;
    this.updateExtents();
    // In the water the nose points where you push; in the air it follows the arc of the jump.
    let wantPitch = 0;
    if (this.airborne) wantPitch = Math.atan2(this.vel.y, Math.abs(this.vel.x) + 0.3);
    else if (pushDir) wantPitch = Math.atan2(pushDir.y, Math.abs(pushDir.x));
    wantPitch = THREE.MathUtils.clamp(wantPitch, -MAX_PITCH, MAX_PITCH);
    this.pitch = THREE.MathUtils.lerp(this.pitch, wantPitch, 1 - Math.exp(-dt * (this.airborne ? 6 : 3.5)));
    this.pitchPivot.rotation.z = this.pitch;
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
      for (const prop of part.props) prop.rotation.x += dt * 18;
      if (part.dish) part.dish.rotation.y += dt * 2.2;
    }
    const spin = 8 + this.levels.propulsion * 3 + this.vel.length() * 2 + this.cruise * 25;
    if (this.propeller) this.propeller.rotation.x -= dt * spin;

    if (this.shieldCharges < this.shieldMax) {
      this.shieldTimer += dt;
      if (this.shieldTimer > 9 - this.levels.shield) {
        this.shieldTimer = 0;
        this.shieldCharges++;
        this.shieldFlash = 0.6;
      }
    }
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2);
    const su = this.shield.material.uniforms;
    su.uTime.value = this.time;
    su.uFlash.value = this.shieldFlash;
    su.uStrength.value = THREE.MathUtils.lerp(su.uStrength.value, this.shieldCharges > 0 ? 1 : 0, 1 - Math.exp(-dt * 5));
    this.shield.visible = su.uStrength.value > 0.02 || this.shieldFlash > 0.01;

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

  // Returns 'shield', 'hit', or 'dead'.
  takeHit(amount, from) {
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      this.shieldTimer = 0;
      this.shieldFlash = 1;
      this.invuln = 0.4;
      return 'shield';
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
