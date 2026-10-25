import * as THREE from 'three';
import { ownMaterials, spawn } from './assets.js';
import { sfx } from './audio.js';
import { UPGRADES, upgradeCost } from './upgrades.js';
import { CAMERA_Z, SURFACE_Y, TAN_HALF_FOV } from './water.js';
import { seabedAt } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);
const WHITE = new THREE.Color(1, 1, 1);
// Enemy models face -X; these yaws keep their faces turned toward the camera while heading left or right.
const ENEMY_YAW_LEFT = 0.75;
const ENEMY_YAW_RIGHT = Math.PI - 0.75;
const DESPAWN_DIST = 60;
const ENEMY_TOP = SURFACE_Y - 1.8;
const enemyFloor = (x) => seabedAt(x) + 1.8;
const DAMAGE = { missile: 12, ram: 15, mine: 22 };

const ENEMY_TYPES = {
  scout: { model: 'enemy_scout', hp: 5, scale: 0.85, rx: 1.25, ry: 0.62, coins: 3, boom: 0.9, speed: 4.2 },
  gunner: { model: 'enemy_gunner', hp: 16, scale: 0.95, rx: 1.75, ry: 0.9, coins: 8, boom: 1.2, speed: 3.2 },
  boss: { model: 'enemy_boss', hp: 170, scale: 0.95, rx: 2.9, ry: 1.45, coins: 70, boom: 2.4, speed: 2.4 },
  mine: { model: 'mine', hp: 3, scale: 1.05, rx: 0.62, ry: 0.62, coins: 1, boom: 1.0, speed: 1.0 },
};

function angleLerp(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

export class Game {
  constructor({ scene, camera, world, effects, player, hud }) {
    Object.assign(this, { scene, camera, world, effects, player, hud });
    this.enemies = [];
    this.torpedoes = [];
    this.missiles = [];
    this.enemyMissiles = [];
    this.coinsList = [];
    this.bullets = [];
    this.aspect = 1.5;
    this.cam = new THREE.Vector2(0, 0);
    this.makeBulletMesh();
    this.tmp = new THREE.Vector3();
    this.radarSweep = 0;
    this.reset();
  }

  makeBulletMesh() {
    const geo = new THREE.CapsuleGeometry(0.05, 0.42, 4, 8);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.4, 0.45) });
    this.bulletMesh = new THREE.InstancedMesh(geo, mat, 500);
    this.bulletMesh.frustumCulled = false;
    this.bulletMesh.count = 0;
    this.scene.add(this.bulletMesh);
  }

  reset() {
    for (const list of [this.enemies, this.torpedoes, this.missiles, this.enemyMissiles, this.coinsList]) {
      for (const e of list) this.scene.remove(e.obj);
      list.length = 0;
    }
    this.bullets.length = 0;
    this.player.reset();
    this.player.group.position.set(0, 2, 0);
    this.cam.set(0, 2);
    this.coins = 40;
    this.coinsTotal = 0;
    this.kills = 0;
    this.wave = 0;
    this.queue = [];
    this.spawnTimer = 0;
    this.waveBreak = 2.0;
    this.boss = null;
    this.over = false;
    this.overTimer = 0;
    this.wasAbove = false;
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
    return { top: SURFACE_Y + 0.5, bottom: (x) => seabedAt(x) + 0.7 };
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
    const cost = upgradeCost(def, lvl);
    if (this.coins < cost) {
      sfx.denied();
      this.hud.flashSlot(id, false);
      return;
    }
    this.coins -= cost;
    const added = this.player.upgrade(id);
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
    }
    this.queue = q;
    this.spawnTimer = 1.5;
    sfx.wave();
  }

  spawnEnemy(spec) {
    const type = ENEMY_TYPES[spec.type];
    const obj = new THREE.Group();
    const flip = new THREE.Group();
    const model = spawn(type.model);
    model.scale.setScalar(type.scale);
    flip.add(model);
    obj.add(flip);
    const mats = ownMaterials(model).map((m) => ({ m, e: m.emissive.clone() }));
    const hpMult = 1 + 0.17 * (this.wave - 1);
    if (spec.pos) {
      obj.position.set(spec.pos.x, spec.pos.y, 0);
    } else {
      const angle = spec.angle ?? rand(0, Math.PI * 2);
      const dist = Math.hypot(this.halfW, this.halfH) + 3 + (spec.type === 'boss' ? 4 : 0);
      const pc = this.player.center;
      const x = pc.x + Math.cos(angle) * dist;
      obj.position.set(x, THREE.MathUtils.clamp(pc.y + Math.sin(angle) * dist * 0.6, enemyFloor(x), ENEMY_TOP), 0);
    }
    if (spec.type === 'mine') obj.position.z = rand(-0.5, 0.5);
    this.scene.add(obj);
    const bossTier = Math.floor(this.wave / 5);
    const toPlayer = new THREE.Vector2().subVectors(this.player.center, obj.position).normalize();
    const e = {
      type: spec.type, def: type, obj, flip, model, mats, flash: 0, t: rand(0, 5),
      hp: type.hp * hpMult * (spec.type === 'boss' ? 0.7 + bossTier * 0.45 : 1),
      fire: rand(1.0, 2.2), attack: 0, steer: 0, orbit: Math.random() < 0.5 ? -1 : 1,
      vel: toPlayer.multiplyScalar(type.speed), facing: 1, propeller: null, spin: rand(-1, 1),
    };
    e.maxHp = e.hp;
    e.facing = e.vel.x >= 0 ? 1 : -1;
    if (spec.type !== 'mine') flip.rotation.y = e.facing > 0 ? ENEMY_YAW_RIGHT : ENEMY_YAW_LEFT;
    model.traverse((o) => {
      if (!e.propeller && o.name.startsWith('propeller')) e.propeller = o;
      if (!e.muzzle && o.name.startsWith('muzzle')) e.muzzle = o;
    });
    if (spec.type === 'boss') this.boss = e;
    this.enemies.push(e);
    return e;
  }

  enemyHit(e, x, y, r = 0) {
    const s = e.def;
    const a = -e.obj.rotation.z;
    const dx0 = x - e.obj.position.x;
    const dy0 = y - e.obj.position.y;
    const dx = (dx0 * Math.cos(a) - dy0 * Math.sin(a)) / (s.rx + r);
    const dy = (dx0 * Math.sin(a) + dy0 * Math.cos(a)) / (s.ry + r);
    return dx * dx + dy * dy < 1;
  }

  damageEnemy(e, amount) {
    if (e.dead) return;
    e.hp -= amount * this.player.damageMult;
    e.flash = Math.min(1, Math.max(e.flash, 0.35 + amount * 0.08));
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    e.dead = true;
    const p = e.obj.position.clone();
    this.effects.explosion(p, e.def.boom);
    sfx.boom(e.type === 'boss' || e.type === 'gunner');
    if (e.type !== 'mine') this.kills++;
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
    if (e.type === 'mine') {
      for (const other of this.enemies) {
        if (other !== e && !other.dead && other.obj.position.distanceTo(p) < 2.8) this.damageEnemy(other, 8);
      }
      if (this.player.alive && this.player.hitTest(p.x, p.y, 1.4)) this.hurtPlayer(DAMAGE.mine);
    }
    this.dropCoins(p, e.def.coins + (e.type === 'boss' ? this.wave * 6 : 0));
    this.scene.remove(e.obj);
  }

  dropCoins(pos, value) {
    const n = Math.min(value, 14);
    const base = Math.floor(value / n);
    let extra = value - base * n;
    for (let i = 0; i < n; i++) {
      const obj = spawn('pickup_coin');
      const v = base + (extra-- > 0 ? 1 : 0);
      obj.scale.setScalar(v > 3 ? 0.75 : 0.55);
      obj.position.set(pos.x, Math.min(pos.y, SURFACE_Y - 0.5), 0.3);
      this.scene.add(obj);
      const a = rand(0, Math.PI * 2);
      const s = rand(1.5, 4.5);
      this.coinsList.push({ obj, value: v, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1.5, t: 0, spin: rand(2, 4) });
    }
  }

  hurtPlayer(amount) {
    if (this.player.invuln > 0 || !this.player.alive) return;
    const res = this.player.takeHit(amount * (1 + this.wave * 0.04));
    this.hud.flashHealth();
    const c = this.player.center;
    if (res === 'shield') {
      sfx.shield();
      this.effects.sparkle({ x: c.x, y: c.y, z: 1 }, '#9eeaff', 16, 7);
      return;
    }
    sfx.hurt();
    this.effects.shake = Math.min(1.5, this.effects.shake + 0.8);
    this.effects.sparkle({ x: c.x, y: c.y, z: 1 }, '#ffb08a', 14, 6);
    if (res === 'dead') {
      this.effects.explosion({ x: c.x, y: c.y, z: 0.5 }, 2.2);
      for (let i = 1; i <= 4; i++) {
        setTimeout(() => this.effects.explosion({ x: c.x + rand(-2, 2), y: c.y + rand(-1, 1), z: 0.5 }, 1.2), i * 180);
      }
      sfx.boom(true);
      this.over = true;
      this.overTimer = 2.4;
    }
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
    const active = this.enemiesOnScreen();
    const fwd = pl.forward;
    const side = new THREE.Vector2(-fwd.y, fwd.x);
    const cannonInterval = 0.2 - 0.012 * pl.levels.cannon;
    for (const part of pl.partsOf('cannon')) {
      part.timer -= dt;
      if (part.timer > 0) continue;
      part.timer += cannonInterval * rand(0.9, 1.1);
      if (!active) {
        part.timer = Math.max(part.timer, 0.1);
        continue;
      }
      part.muzzle.getWorldPosition(this.tmp);
      const spread = rand(-0.6, 0.6);
      this.bullets.push({
        x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, life: 1.1,
        vx: fwd.x * 26 + side.x * spread + pl.vel.x * 0.5, vy: fwd.y * 26 + side.y * spread + pl.vel.y * 0.5,
      });
      this.effects.muzzle(this.tmp);
      sfx.shoot();
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
      this.torpedoes.push({ obj, speed: 3, angle: Math.atan2(fwd.y, fwd.x), life: 4.5, trail: 0 });
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
      this.missiles.push({ obj, vx: fwd.x * 2, vy: 6 * up, life: 5, trail: 0, age: 0 });
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
    part.twin.rotation.z = part.pivot.rotation.z;
    for (const arm of part.arms) arm.scale.y = ext;
    for (const claw of part.claws) claw.scale.y = 1 / ext;
  }

  steerEnemy(e, desired, dt, turn = 2) {
    e.vel.lerp(desired, 1 - Math.exp(-dt * turn));
  }

  updateEnemies(dt) {
    const pl = this.player;
    const pc = pl.center;
    const fireMult = 1 + this.wave * 0.05;
    const desired = new THREE.Vector2();
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      const p = e.obj.position;
      const toP = new THREE.Vector2(pc.x - p.x, pc.y - p.y);
      const dist = toP.length();
      const dir = toP.clone().divideScalar(dist || 1);
      const tangent = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(e.orbit);
      const speed = e.def.speed + this.wave * 0.06;
      const visible = this.onScreen(p.x, p.y, -0.5);

      if (e.type === 'scout') {
        e.steer -= dt;
        if (e.steer <= 0) {
          e.steer = rand(2.2, 3.5);
          e.target = dir.clone().multiplyScalar(speed).add(tangent.clone().multiplyScalar(rand(0.5, 1.8)));
        }
        desired.copy(e.target ?? dir);
        const weave = tangent.clone().multiplyScalar(Math.sin(e.t * 2.2) * 1.4);
        this.steerEnemy(e, desired.add(weave), dt, 1.5);
        e.fire -= dt * fireMult;
        if (e.fire <= 0 && visible && dist < 15) {
          e.fire = rand(2.0, 3.2);
          this.enemyAimed(e, pc, rand(-0.1, 0.1));
        }
      } else if (e.type === 'gunner') {
        const range = dist - 9;
        desired.copy(dir).multiplyScalar(THREE.MathUtils.clamp(range, -1, 1) * speed).add(tangent.clone().multiplyScalar(speed * 0.5));
        this.steerEnemy(e, desired, dt, 1.2);
        e.fire -= dt * fireMult;
        if (e.fire <= 0 && visible) {
          e.fire = rand(2.8, 3.6);
          const n = 2 + Math.floor(this.wave / 4);
          for (let i = 0; i < n; i++) {
            setTimeout(() => {
              if (!e.dead) this.enemyAimed(e, this.player.center, rand(-0.12, 0.12));
            }, i * 220);
          }
        }
      } else if (e.type === 'boss') {
        const range = dist - 11;
        desired.copy(dir).multiplyScalar(THREE.MathUtils.clamp(range, -1, 1) * speed).add(tangent.clone().multiplyScalar(speed * 0.35));
        this.steerEnemy(e, desired, dt, 0.8);
        e.fire -= dt * (1 + this.wave * 0.02);
        if (e.fire <= 0 && visible) {
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
                if (!e.dead) this.enemyAimed(e, this.player.center, rand(-0.08, 0.08));
              }, i * 150);
            }
          }
        }
      } else if (e.type === 'mine') {
        desired.copy(dir).multiplyScalar(speed);
        desired.y += Math.sin(e.t * 1.5) * 0.4;
        this.steerEnemy(e, desired, dt, 0.6);
        e.model.rotation.z += e.spin * dt * 0.6;
        e.model.rotation.y += e.spin * dt * 0.3;
      }

      p.x += e.vel.x * dt;
      p.y += e.vel.y * dt;
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
        const wantYaw = e.facing > 0 ? ENEMY_YAW_RIGHT : ENEMY_YAW_LEFT;
        e.flip.rotation.y += THREE.MathUtils.clamp(wantYaw - e.flip.rotation.y, -dt * 4, dt * 4);
        const pitch = THREE.MathUtils.clamp(Math.atan2(e.vel.y, Math.abs(e.vel.x) + 0.5), -0.6, 0.6);
        e.obj.rotation.z = THREE.MathUtils.lerp(e.obj.rotation.z, pitch * e.facing + Math.sin(e.t * 1.6) * 0.04,
          1 - Math.exp(-dt * 4));
      }
      if (e.propeller) e.propeller.rotation.x += dt * 14;

      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 9);
        for (const { m, e: base } of e.mats) m.emissive.copy(base).lerp(WHITE, e.flash * 0.35);
      }

      if (pl.alive && pl.invuln <= 0 && pl.hitTest(p.x, p.y, Math.min(e.def.ry, 1.0))) {
        if (e.type === 'mine') {
          this.killEnemy(e);
        } else {
          this.hurtPlayer(DAMAGE.ram);
          this.damageEnemy(e, 6);
        }
      }

      if (e.type !== 'boss' && dist > DESPAWN_DIST) {
        e.dead = true;
        this.scene.remove(e.obj);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  muzzleOf(e) {
    return e.muzzle ? e.muzzle.getWorldPosition(new THREE.Vector3()) : e.obj.position.clone();
  }

  enemyAimed(e, target, spread, angle = null, speed = 7.2 + this.wave * 0.12) {
    const pos = this.muzzleOf(e);
    const a = (angle ?? Math.atan2(target.y - pos.y, target.x - pos.x)) + spread;
    this.spawnEnemyMissile(pos, Math.cos(a) * speed, Math.sin(a) * speed);
  }

  spawnEnemyMissile(pos, vx, vy) {
    const obj = spawn('proj_missile');
    obj.scale.setScalar(0.9);
    obj.position.set(pos.x, pos.y, 0.2);
    obj.rotation.z = Math.atan2(vy, vx);
    this.scene.add(obj);
    this.enemyMissiles.push({ obj, vx, vy, life: 6, trail: 0 });
    this.effects.muzzle(pos);
    sfx.enemyShot();
  }

  updateProjectiles(dt) {
    const pl = this.player;

    let alive = 0;
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
      let hit = false;
      for (const e of this.enemies) {
        if (!e.dead && this.enemyHit(e, b.x, b.y, 0.1)) {
          this.damageEnemy(e, 1);
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
      this.bullets[alive++] = b;
    }
    this.bullets.length = alive;
    this.bulletMesh.count = alive;
    this.bulletMesh.instanceMatrix.needsUpdate = true;

    for (const t of this.torpedoes) {
      t.life -= dt;
      t.speed = Math.min(15, t.speed + dt * 14);
      const p = t.obj.position;
      const target = this.nearestEnemy(p.x, p.y);
      if (target) t.angle = angleLerp(t.angle, Math.atan2(target.obj.position.y - p.y, target.obj.position.x - p.x), dt * 1.6);
      p.x += Math.cos(t.angle) * t.speed * dt;
      p.y += Math.sin(t.angle) * t.speed * dt;
      t.obj.rotation.z = t.angle;
      t.trail -= dt;
      if (t.trail <= 0) {
        t.trail = 0.025;
        this.effects.bubble({ x: p.x - Math.cos(t.angle) * 0.5, y: p.y - Math.sin(t.angle) * 0.5, z: p.z },
          { spread: 0.08, size: [0.1, 0.22], life: [0.6, 1.2] });
      }
      const hitE = this.enemies.find((e) => !e.dead && this.enemyHit(e, p.x, p.y, 0.2));
      if (hitE || t.life <= 0 || p.y > SURFACE_Y) {
        if (hitE) {
          this.damageEnemy(hitE, 5);
          this.effects.explosion(p, 0.7);
          sfx.boom();
          for (const e of this.enemies) if (e !== hitE && !e.dead && e.obj.position.distanceTo(p) < 2) this.damageEnemy(e, 2);
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
      if (mi.age > 0.3) {
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
      mi.obj.rotation.z = Math.atan2(mi.vy, mi.vx);
      mi.trail -= dt;
      if (mi.trail <= 0) {
        mi.trail = 0.02;
        const back = { x: p.x - Math.cos(mi.obj.rotation.z) * 0.45, y: p.y - Math.sin(mi.obj.rotation.z) * 0.45, z: p.z };
        this.effects.smokeTrail(back, 0.8);
        this.effects.flame(back, 0.8);
      }
      const hitE = this.enemies.find((e) => !e.dead && this.enemyHit(e, p.x, p.y, 0.15));
      if (hitE || mi.life <= 0) {
        if (hitE) {
          this.damageEnemy(hitE, 4);
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
      const p = em.obj.position;
      p.x += em.vx * dt;
      p.y += em.vy * dt;
      em.trail -= dt;
      if (em.trail <= 0) {
        em.trail = 0.025;
        const a = em.obj.rotation.z;
        const back = { x: p.x - Math.cos(a) * 0.45, y: p.y - Math.sin(a) * 0.45, z: p.z };
        this.effects.smokeTrail(back, 0.9);
        this.effects.flame(back, 1);
      }
      if (pl.alive && pl.hitTest(p.x, p.y, 0.12)) {
        em.dead = true;
        this.effects.explosion(p, 0.55);
        sfx.boom();
        this.hurtPlayer(DAMAGE.missile);
      }
      const floor = seabedAt(p.x);
      if (em.life <= 0 || p.y > SURFACE_Y + 0.5 || p.y < floor) {
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
      } else {
        c.vx *= Math.exp(-dt * 2.5);
        c.vy = c.vy * Math.exp(-dt * 2.5) + Math.sin(c.t * 2) * dt * 0.6;
      }
      p.x += c.vx * dt;
      p.y = THREE.MathUtils.clamp(p.y + c.vy * dt, seabedAt(p.x) + 0.5, SURFACE_Y - 0.4);
      c.obj.rotation.y += c.spin * dt;
      if (c.t > 11) c.obj.visible = Math.floor(c.t * 10) % 2 === 0;
      if (pl.alive && pl.hitTest(p.x, p.y, 0.3)) {
        c.dead = true;
        this.coins += c.value;
        this.coinsTotal += c.value;
        this.effects.coinBurst(p);
        this.hud.pulseCoins();
        sfx.coin();
      }
      if (c.t > 14) c.dead = true;
      if (c.dead) this.scene.remove(c.obj);
    }
    this.coinsList = this.coinsList.filter((c) => !c.dead);
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
      this.waveBreak = 3.2;
      const bonus = 5 + this.wave * 5;
      this.coins += bonus;
      this.coinsTotal += bonus;
      this.hud.showToast(`Wave ${this.wave} cleared! +${bonus} coins`);
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
    const pc = this.player.center;
    const fwd = this.player.forward;
    const tx = pc.x + fwd.x * 3 + this.player.vel.x * 0.25;
    const ty = pc.y + this.player.vel.y * 0.15;
    this.cam.x = THREE.MathUtils.lerp(this.cam.x, tx, 1 - Math.exp(-dt * 3));
    this.cam.y = THREE.MathUtils.lerp(this.cam.y, ty, 1 - Math.exp(-dt * 3));
    this.cam.y = THREE.MathUtils.clamp(this.cam.y, seabedAt(this.cam.x) + this.halfH - 3, SURFACE_Y - this.halfH + 4.5);
  }

  splashCheck() {
    const pc = this.player.center;
    const above = pc.y > SURFACE_Y - 0.3;
    if (above !== this.wasAbove && this.player.alive) {
      this.effects.splash({ x: pc.x, y: SURFACE_Y, z: 0.5 }, 1.2);
      sfx.splash();
    }
    this.wasAbove = above;
  }

  update(dt, input) {
    const pl = this.player;
    pl.update(dt, input, this.bounds);
    this.fireWeapons(dt);
    this.updateGrapple(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateCoins(dt);
    this.updateWaves(dt);
    this.updateCamera(dt);
    this.splashCheck();

    if (pl.alive) {
      const prop = pl.propellerWorld(this.tmp);
      const rate = 0.5 + pl.vel.length() * 0.25 + pl.levels.propulsion * 0.15;
      const back = pl.forward.multiplyScalar(-2);
      if (Math.random() < rate) this.effects.bubble(prop, { spread: 0.25, vel: { x: back.x, y: back.y } });
      for (const part of pl.partsOf('propulsion')) {
        if (Math.random() < 0.35 && part.props[0]) {
          part.props[0].getWorldPosition(this.tmp);
          this.effects.bubble(this.tmp, { spread: 0.12, size: [0.08, 0.2], vel: { x: back.x, y: back.y } });
        }
      }
    }

    this.radarSweep = (this.radarSweep + dt * 2.2) % (Math.PI * 2);
    if (this.over) this.overTimer -= dt;
  }

  radarEnemies() {
    return this.enemies.map((e) => ({ x: e.obj.position.x, y: e.obj.position.y, type: e.type }));
  }

  get radarRange() {
    return 18 + this.player.levels.sonar * 9;
  }

  get partCount() {
    return this.player.parts.length;
  }
}
