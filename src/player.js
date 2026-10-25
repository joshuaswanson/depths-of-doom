import * as THREE from 'three';
import { findNode, findNodes, spawn } from './assets.js';
import { JUNK_PER_HULL, PART_MODEL, SOCKETS, UPGRADES, partCount } from './upgrades.js';

// The sub always shows three quarters of its front to the camera, so turning around swings the nose through
// the viewer instead of showing the stern.
const YAW_RIGHT = -0.75;
const YAW_LEFT = -(Math.PI - 0.75);
const TURN_SPEED = 7;
const MAX_PITCH = 0.8;
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

function makeBeam() {
  const geo = new THREE.ConeGeometry(3.2, 13, 32, 1, true);
  geo.translate(0, -6.5, 0);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uStrength: { value: 0 } },
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
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs( dot( vNormal, vView ) );
        float a = ( 1.0 - vAlong ) * ( 1.0 - vAlong ) * facing * uStrength;
        gl_FragColor = vec4( vec3( 1.0, 0.92, 0.7 ) * a, 1.0 );
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.pitchPivot = new THREE.Group();
    this.yawPivot = new THREE.Group();
    this.group.add(this.pitchPivot);
    this.pitchPivot.add(this.yawPivot);
    this.rig = new THREE.Group();
    this.rig.scale.setScalar(RIG_SCALE);
    this.yawPivot.add(this.rig);
    this.hullPivot = new THREE.Group();
    this.rig.add(this.hullPivot);
    this.hull = spawn('player_hull');
    this.hullPivot.add(this.hull);
    this.propeller = findNode(this.hull, 'propeller');
    this.duck = spawn('junk_duck');
    this.duck.position.set(0.5, 1.58, 0.05);
    this.duck.scale.setScalar(1.3);
    this.duck.visible = false;
    this.hull.add(this.duck);
    this.shield = makeShieldBubble();
    this.yawPivot.add(this.shield);

    this.lamp = new THREE.Group();
    this.rig.add(this.lamp);
    this.headlight = new THREE.SpotLight('#ffe2a8', 0, 34, 0.42, 0.65, 1.1);
    this.headlight.target.position.set(10, -1.5, 0);
    this.lamp.add(this.headlight, this.headlight.target);
    this.beam = makeBeam();
    this.beam.rotation.z = -0.12;
    this.lamp.add(this.beam);
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
    for (const part of this.parts) {
      part.pivot.removeFromParent();
      part.twin.removeFromParent();
    }
    this.parts = [];
    this.group.position.set(0, 0, 0);
    this.vel.set(0, 0);
    this.facing = 1;
    this.yaw = YAW_RIGHT;
    this.pitch = 0;
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
    return Math.max(3.4, 6.4 + (this.levels.propulsion - 1) * 1.3 - weight);
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

  // Each part is bolted on twice, once per side, so the sub looks loaded from whichever side faces the camera.
  mountPivot(cat, model, angle, animate) {
    const pivot = new THREE.Group();
    const obj = spawn(model);
    pivot.add(obj);
    const { rotX } = this.socketTransform(0, angle);
    if (cat === 'grapple') obj.rotation.x = rotX;
    else pivot.rotation.x = rotX;
    if (animate) pivot.scale.setScalar(0.01);
    this.rig.add(pivot);
    return { pivot, obj };
  }

  addPart(cat, model, x, angle, animate) {
    const main = this.mountPivot(cat, model, angle, animate);
    const twin = this.mountPivot(cat, model, 180 - angle, animate);
    const part = {
      cat, obj: main.obj, pivot: main.pivot, twin: twin.pivot, twinObj: twin.obj, socket: [x, angle],
      pop: animate ? 0 : 1, muzzle: findNode(main.obj, 'muzzle'),
      props: [...findNodes(main.obj, 'thruster_prop'), ...findNodes(twin.obj, 'thruster_prop')],
      dishes: [findNode(main.obj, 'sonar_dish'), findNode(twin.obj, 'sonar_dish')].filter(Boolean),
      arms: [findNode(main.obj, 'grapple_arm'), findNode(twin.obj, 'grapple_arm')].filter(Boolean),
      claws: [findNode(main.obj, 'grapple_claw'), findNode(twin.obj, 'grapple_claw')].filter(Boolean),
      timer: Math.random(),
    };
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
      part.twinTarget = part.target.clone().setZ(-part.target.z);
      if (!animate) {
        part.pivot.position.copy(part.target);
        part.twin.position.copy(part.twinTarget);
      }
    }
    this.measure();
    return added;
  }

  measure() {
    const scale = this.rig.scale.clone();
    const hullScale = this.hullPivot.scale.clone();
    this.yawPivot.rotation.y = 0;
    this.rig.scale.setScalar(RIG_SCALE);
    this.hullPivot.scale.set(this.fatTarget.x, this.fatTarget.yz, this.fatTarget.yz);
    const saved = this.parts.map((p) => [p.pivot.position.clone(), p.pivot.scale.clone(), p.twin.position.clone(),
      p.twin.scale.clone()]);
    for (const part of this.parts) {
      part.pivot.position.copy(part.target);
      part.twin.position.copy(part.twinTarget);
      part.pivot.scale.setScalar(1);
      part.twin.scale.setScalar(1);
    }
    this.yawPivot.updateMatrixWorld(true);
    const toLocal = this.yawPivot.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const parts = [this.hullPivot, ...this.parts.map((p) => p.pivot)];
    for (const root of parts) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(toLocal.clone().multiply(o.matrixWorld)));
      });
    }
    this.parts.forEach((p, i) => {
      p.pivot.position.copy(saved[i][0]);
      p.pivot.scale.copy(saved[i][1]);
      p.twin.position.copy(saved[i][2]);
      p.twin.scale.copy(saved[i][3]);
    });
    this.yawPivot.rotation.y = this.yaw;
    this.rig.scale.copy(scale);
    this.hullPivot.scale.copy(hullScale);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const cosY = Math.abs(Math.cos(YAW_RIGHT));
    this.extents = { hx: (s.x / 2) * cosY + 0.3, hy: s.y / 2, cx: c.x * cosY, cy: c.y };
    this.shield.position.set(c.x, c.y, 0);
    this.shield.scale.set(s.x * 0.62, s.y * 0.68, Math.max(s.y, s.x * 0.5) * 0.7);
  }

  get facingSign() {
    return Math.cos(this.yaw) >= 0 ? 1 : -1;
  }

  // Point in the sub's own frame: x along its nose, y up through its tower.
  toLocal(x, y) {
    const a = -this.pitchPivot.rotation.z;
    const dx = x - this.group.position.x;
    const dy = y - this.group.position.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: lx * this.facing, y: ly };
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
    const a = this.pitchPivot.rotation.z;
    const lx = e.cx * this.facing;
    return new THREE.Vector2(
      this.group.position.x + lx * Math.cos(a) - e.cy * Math.sin(a),
      this.group.position.y + lx * Math.sin(a) + e.cy * Math.cos(a),
    );
  }

  get forward() {
    return new THREE.Vector2(this.facing * Math.cos(this.pitch), Math.sin(this.pitch));
  }

  get radius() {
    return Math.max(this.extents.hx, this.extents.hy);
  }

  setDarkness(dark) {
    this.headlight.intensity = 40 * dark;
    this.beam.material.uniforms.uStrength.value = 0.22 * dark;
    this.beam.visible = dark > 0.02;
    this.glow.intensity = 14 * dark;
  }

  update(dt, input, bounds) {
    this.time += dt;
    const target = new THREE.Vector2(input.x, input.y);
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(this.alive ? this.speed : 0);
    this.vel.lerp(target, 1 - Math.exp(-dt * 6));
    const p = this.group.position;
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    const e = this.extents;
    p.y = THREE.MathUtils.clamp(p.y, bounds.bottom(p.x) + e.hy, bounds.top);
    if (bounds.left !== undefined) p.x = THREE.MathUtils.clamp(p.x, bounds.left, bounds.right);

    if (Math.abs(input.x) > 0.1) this.facing = Math.sign(input.x);
    const wantYaw = this.facing > 0 ? YAW_RIGHT : YAW_LEFT;
    this.yaw += THREE.MathUtils.clamp(wantYaw - this.yaw, -dt * TURN_SPEED, dt * TURN_SPEED);
    this.yawPivot.rotation.y = this.yaw;
    const moving = Math.abs(input.x) + Math.abs(input.y) > 0.1;
    const wantPitch = moving ? THREE.MathUtils.clamp(Math.atan2(this.vel.y, Math.abs(this.vel.x) + 0.5), -MAX_PITCH, MAX_PITCH) : 0;
    this.pitch = THREE.MathUtils.lerp(this.pitch, wantPitch, 1 - Math.exp(-dt * 5));
    this.pitchPivot.rotation.z = this.pitch * this.facingSign;
    this.pitchPivot.rotation.x = Math.sin(this.time * 1.7) * 0.03;
    this.rig.position.y = Math.sin(this.time * 2.1) * 0.08;

    for (const key of ['x', 'yz']) this.fat[key] = THREE.MathUtils.lerp(this.fat[key], this.fatTarget[key], 1 - Math.exp(-dt * 7));
    this.squash = Math.max(0, this.squash - dt * 2.2);
    const wob = Math.sin(this.squash * 14) * this.squash * 0.12;
    this.hullPivot.scale.set(this.fat.x * (1 + wob), this.fat.yz * (1 - wob), this.fat.yz * (1 - wob));
    this.lamp.position.set(1.85 * this.fat.x, -0.62 * this.fat.yz, 0);

    for (const part of this.parts) {
      const k = 1 - Math.exp(-dt * 7);
      part.pivot.position.lerp(part.target, k);
      part.twin.position.lerp(part.twinTarget, k);
      if (part.pop < 1) {
        part.pop = Math.min(1, part.pop + dt * 1.8);
        const s = Math.max(0.01, elasticOut(part.pop));
        part.pivot.scale.setScalar(s);
        part.twin.scale.setScalar(s);
      }
      for (const prop of part.props) prop.rotation.x += dt * 18;
      for (const dish of part.dishes) dish.rotation.y += dt * 2.2;
    }
    const spin = 8 + this.levels.propulsion * 3 + this.vel.length() * 2;
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
    this.rig.visible = this.alive && (this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0);
  }

  // Returns 'shield', 'hit', or 'dead'.
  takeHit(amount) {
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      this.shieldTimer = 0;
      this.shieldFlash = 1;
      this.invuln = 0.4;
      return 'shield';
    }
    this.hp -= amount;
    this.sinceHit = 0;
    this.invuln = 0.5;
    this.squash = 0.6;
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
