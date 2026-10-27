import * as THREE from 'three';
import Peer from 'peerjs';
import { sfx } from './audio.js';
import { Player } from './player.js';

// Co-op over WebRTC. One player hosts: their game runs the enemies, waves and loot, and sends everyone a snapshot
// several times a second. Every player flies their own sub on their own machine and sends its state to the host,
// which passes it on. Damage to enemies is reported to the host; each player's machine decides the hits on its own
// sub. PeerJS's public server only introduces the browsers; after that they talk to each other directly.
const PREFIX = 'depths-of-doom-';
const SNAPSHOT_RATE = 15;
const STATE_RATE = 20;
const MAX_PLAYERS = 4;
// Player 1 (the host) keeps the yellow sub.
const COLORS = [null, '#38c8ff', '#5be37a', '#c77dff'];
const LABELS = ['P1', 'P2', 'P3', 'P4'];
const TINTED = new Set(['yellow', 'yellow_dark']);

function roomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

function tintSub(sub, slot) {
  const color = COLORS[slot - 1];
  if (!color) return;
  const target = new THREE.Color(color);
  sub.group.traverse((o) => {
    if (o.isMesh && TINTED.has(o.material.name)) {
      if (!o.userData.tinted) {
        o.material = o.material.clone();
        o.userData.tinted = true;
      }
      o.material.color.copy(target).multiplyScalar(o.material.name === 'yellow_dark' ? 0.75 : 1);
    }
  });
}

function nameTag(slot) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 40px Fredoka, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.strokeText(LABELS[slot - 1], 64, 46);
  g.fillStyle = COLORS[slot - 1] ?? '#ffd23a';
  g.fillText(LABELS[slot - 1], 64, 46);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true, fog: false,
  }));
  sprite.scale.set(1.6, 0.8, 1);
  sprite.renderOrder = 30;
  return sprite;
}

function stateOf(sub, slot) {
  const p = sub.group.position;
  return {
    id: slot, x: p.x, y: p.y, vx: sub.vel.x, vy: sub.vel.y, yaw: sub.yaw, pitch: sub.pitch, facing: sub.facing,
    ix: sub.lastInput?.x ?? 0, iy: sub.lastInput?.y ?? 0, lv: sub.levels, alive: sub.alive, hp: sub.hp,
    sh: sub.shieldCharges,
  };
}

export class Net {
  constructor(game, { onStatus = () => {}, onReady = () => {} } = {}) {
    this.game = game;
    this.onStatus = onStatus;
    this.onReady = onReady;
    this.peer = null;
    this.guests = new Map();
    this.conn = null;
    this.slot = 1;
    this.events = [];
    this.replicas = new Map();
    this.killed = new Set();
    this.snapTimer = 0;
    this.stateTimer = 0;
  }

  // Host a room. Resolves with the room code once the matchmaking server has registered it.
  host() {
    this.code = roomCode();
    this.role = 'host';
    this.peer = new Peer(PREFIX + this.code);
    this.peer.on('open', () => {
      this.onReady({ code: this.code });
      this.game.role = 'host';
      this.game.net = this;
      this.game.localPlayer.netId = 1;
    });
    this.peer.on('connection', (conn) => this.acceptGuest(conn));
    this.peer.on('error', (err) => this.onStatus(`Connection problem: ${err.type}`, true));
  }

  join(code) {
    this.code = code.trim().toUpperCase();
    this.role = 'guest';
    this.peer = new Peer();
    this.onStatus('Connecting...');
    this.peer.on('open', () => {
      this.conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      this.conn.on('data', (msg) => this.onGuestMessage(msg));
      this.conn.on('close', () => this.onStatus('The host left the game.'));
    });
    this.peer.on('error', (err) => {
      this.onStatus(err.type === 'peer-unavailable' ? `No game found with code ${this.code}.` : `Connection problem: ${err.type}`,
        true);
    });
  }

  acceptGuest(conn) {
    const used = new Set([1, ...[...this.guests.values()].map((g) => g.slot)]);
    const slot = [2, 3, 4].find((n) => !used.has(n));
    if (!slot || this.guests.size >= MAX_PLAYERS - 1) {
      conn.on('open', () => {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 500);
      });
      return;
    }
    const guest = { conn, slot, sub: null };
    this.guests.set(conn.peer, guest);
    conn.on('open', () => {
      guest.sub = this.addRemote(slot);
      const others = [1, ...[...this.guests.values()].filter((g) => g !== guest).map((g) => g.slot)];
      conn.send({ t: 'welcome', you: slot, others, wave: this.game.wave });
      this.event({ t: 'join', id: slot });
      this.game.hud.showToast(`${LABELS[slot - 1]} joined!`);
    });
    conn.on('data', (msg) => this.onHostMessage(guest, msg));
    conn.on('close', () => {
      this.guests.delete(conn.peer);
      this.removeRemote(slot);
      this.event({ t: 'leave', id: slot });
      this.game.hud.showToast(`${LABELS[slot - 1]} left`);
    });
  }

  addRemote(slot) {
    const sub = new Player(this.game.scene);
    sub.netId = slot;
    // Only the local sub lights the scene; extra lights would make every material recompile.
    for (const light of [sub.headlight, sub.headlight.target, sub.glow, sub.redGlow]) light.removeFromParent();
    tintSub(sub, slot);
    sub.tag = nameTag(slot);
    sub.tag.position.y = 2.4;
    sub.group.add(sub.tag);
    this.game.players.push(sub);
    return sub;
  }

  removeRemote(slot) {
    const sub = this.game.players.find((p) => p !== this.game.localPlayer && p.netId === slot);
    if (!sub) return;
    sub.group.removeFromParent();
    this.game.players = this.game.players.filter((p) => p !== sub);
  }

  remote(slot) {
    return this.game.players.find((p) => p !== this.game.localPlayer && p.netId === slot);
  }

  // Host side: queue something for every guest, sent with the next snapshot.
  event(msg) {
    if (this.role === 'host') this.events.push(msg);
  }

  send(msg) {
    if (this.role === 'guest' && this.conn?.open) this.conn.send(msg);
  }

  taken(id) {
    if (this.role === 'host') this.event({ t: 'take', id });
    else this.send({ t: 'take', id });
  }

  onHostMessage(guest, msg) {
    if (msg.t === 's') {
      guest.state = msg;
      if (guest.sub) guest.sub.netState = msg;
    } else if (msg.t === 'dmg') {
      this.game.applyRemoteDamage(msg.id, msg.a, guest.sub);
    } else if (msg.t === 'take') {
      this.game.removeCoin(msg.id);
      this.event({ t: 'take', id: msg.id });
    }
  }

  onGuestMessage(msg) {
    const game = this.game;
    if (msg.t === 'full') {
      this.onStatus('That game is full.', true);
    } else if (msg.t === 'welcome') {
      this.slot = msg.you;
      // Starting the game resets the local sub, so it comes first and the co-op setup goes on top.
      this.onReady({ code: this.code, slot: msg.you });
      game.role = 'guest';
      game.net = this;
      game.localPlayer.netId = msg.you;
      game.wave = msg.wave;
      game.waveBreak = 1e9;
      for (const id of msg.others) this.addRemote(id);
      tintSub(game.localPlayer, msg.you);
      // Arrive beside the host, not on top of them.
      game.localPlayer.group.position.x += 6 * (msg.you - 1);
    } else if (msg.t === 'snap') {
      game.wave = msg.wave;
      // Events first, so a sub that was sunk this snapshot explodes before the enemy list drops it.
      for (const ev of msg.ev) this.applyEvent(ev);
      this.applyEnemies(msg.e);
      for (const s of msg.p) {
        if (s.id === this.slot) continue;
        const sub = this.remote(s.id) ?? this.addRemote(s.id);
        sub.netState = s;
      }
    }
  }

  applyEvent(ev) {
    const game = this.game;
    if (ev.t === 'kill') {
      const e = this.replicas.get(ev.id);
      this.killed.add(ev.id);
      this.replicas.delete(ev.id);
      if (e && !e.dead) game.killEnemy(e, ev.by === this.slot ? game.localPlayer : null);
    } else if (ev.t === 'eb') {
      game.spawnEnemyBullet({ x: ev.x, y: ev.y, z: ev.z }, ev.vx, ev.vy);
    } else if (ev.t === 'em') {
      game.spawnEnemyMissile({ x: ev.x, y: ev.y, z: ev.z }, ev.vx, ev.vy, ev.steer);
    } else if (ev.t === 'coin') {
      game.addRemoteCoin(ev);
    } else if (ev.t === 'take') {
      game.removeCoin(ev.id);
    } else if (ev.t === 'cleared') {
      game.coins += ev.bonus;
      game.coinsTotal += ev.bonus;
      game.hud.showToast(`Wave ${ev.wave} cleared! +${ev.bonus} coins`);
      game.waveCleared(ev.wave);
      game.hud.pulseCoins();
      sfx.coin();
    } else if (ev.t === 'banner') {
      game.hud.showBanner(ev.a, ev.b);
      sfx.wave();
    } else if (ev.t === 'join') {
      if (ev.id !== this.slot && !this.remote(ev.id)) this.addRemote(ev.id);
      game.hud.showToast(`${LABELS[ev.id - 1]} joined!`);
    } else if (ev.t === 'leave') {
      this.removeRemote(ev.id);
      game.hud.showToast(`${LABELS[ev.id - 1]} left`);
    }
  }

  // Guest side: create, move and retire the copies of the host's enemies.
  applyEnemies(list) {
    const game = this.game;
    const seen = new Set();
    for (const [id, type, x, y, z, vx, vy, hp, maxHp, st] of list) {
      seen.add(id);
      let e = this.replicas.get(id);
      if (!e) {
        if (this.killed.has(id)) continue;
        e = game.spawnEnemy({ type, pos: { x, y }, id, replica: true });
        if (!e) continue;
        e.obj.position.set(x, y, z);
        this.replicas.set(id, e);
      }
      e.maxHp = maxHp;
      e.net = { x, y, z, vx, vy, hp, st };
    }
    for (const [id, e] of this.replicas) {
      if (seen.has(id)) continue;
      e.dead = true;
      game.scene.remove(e.obj);
      if (game.boss === e) game.boss = null;
      this.replicas.delete(id);
    }
  }

  // A remote sub runs its own animation from the player's input, then is pulled toward where its owner says it is.
  updateRemote(sub, dt) {
    const s = sub.netState;
    if (!s) {
      sub.group.visible = false;
      return;
    }
    sub.group.visible = true;
    if (Object.keys(s.lv).some((id) => s.lv[id] < sub.levels[id])) sub.reset();
    let grew = false;
    for (const id of Object.keys(s.lv)) {
      while (sub.levels[id] < s.lv[id]) {
        sub.upgrade(id);
        grew = true;
      }
    }
    if (grew) tintSub(sub, sub.netId);
    sub.update(dt, { x: s.ix, y: s.iy }, this.game.bounds);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const k = 1 - Math.exp(-dt * 8);
    const p = sub.group.position;
    p.x += (s.x - p.x) * k;
    p.y += (s.y - p.y) * k;
    sub.vel.set(s.vx, s.vy);
    sub.yaw += (s.yaw - sub.yaw) * k;
    sub.restYaw = sub.prevRestYaw = s.yaw;
    sub.facing = s.facing;
    sub.pitch += (s.pitch - sub.pitch) * k;
    sub.alive = s.alive;
    sub.hp = s.hp;
    sub.shieldCharges = s.sh;
    sub.invuln = 1;
  }

  tick(dt) {
    const game = this.game;
    if (this.role === 'host' && game.role === 'host') {
      this.snapTimer -= dt;
      if (this.snapTimer > 0) return;
      this.snapTimer = 1 / SNAPSHOT_RATE;
      const e = game.enemies.filter((o) => !o.dead).map((o) => {
        const p = o.obj.position;
        return [o.id, o.type, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +o.vel.x.toFixed(2), +o.vel.y.toFixed(2),
          Math.round(o.hp * 10) / 10, o.maxHp, o.stunned > 0 ? +o.stunned.toFixed(2) : 0];
      });
      const p = [stateOf(game.localPlayer, 1), ...[...this.guests.values()].filter((g) => g.state).map((g) => g.state)];
      const msg = { t: 'snap', wave: game.wave, e, p, ev: this.events };
      this.events = [];
      for (const g of this.guests.values()) if (g.conn.open && g.sub) g.conn.send(msg);
    } else if (this.role === 'guest' && game.role === 'guest') {
      this.stateTimer -= dt;
      if (this.stateTimer > 0) return;
      this.stateTimer = 1 / STATE_RATE;
      this.send({ t: 's', ...stateOf(game.localPlayer, this.slot) });
    }
  }

  // Upgrades can swap the hull model, which brings back the stock yellow paint.
  retintLocal() {
    tintSub(this.game.localPlayer, this.game.localPlayer.netId);
  }

  close() {
    this.peer?.destroy();
  }
}
