import { UPGRADES, upgradeCost } from './upgrades.js';

const ICON = (name) => `${import.meta.env.BASE_URL}icons/${name}.png`;
const LOGO = `<img class="logo-img" src="${import.meta.env.BASE_URL}logo.png" alt="Depths of Doom">
  <div class="byline">by Joshua Swanson</div>`;

const HEART = `<svg viewBox="0 0 34 31" class="heart-svg"><defs>
  <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b6b"/>
  <stop offset="1" stop-color="#d4142c"/></linearGradient></defs>
  <path class="heart-shape" d="M17 29.5C7 21.5 1.5 16 1.5 9.6 1.5 5 5 1.5 9.4 1.5c3.1 0 5.9 1.7 7.6 4.4 1.7-2.7 4.5-4.4 7.6-4.4 4.4 0 7.9 3.5 7.9 8.1 0 6.4-5.5 11.9-15.5 19.9z"/>
  <path class="heart-gloss" d="M7 6.5c1.8-1.6 4.4-1.4 5.6.3-2.2-.2-3.9.6-5 2.3-.9-.6-1.2-1.7-.6-2.6z"/></svg>`;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class Hud {
  constructor(root, { onBuy, onStart, onResume }) {
    this.root = root;
    this.onBuy = onBuy;

    const topLeft = el('div', 'hud-topleft');
    this.health = el('div', 'health', `<span class="heart">${HEART}</span>
      <div class="health-track"><div class="health-lag"></div><div class="health-fill"></div>
      <span class="health-text"></span></div>`);
    this.healthTrack = this.health.querySelector('.health-track');
    this.healthFill = this.health.querySelector('.health-fill');
    this.healthLag = this.health.querySelector('.health-lag');
    this.healthText = this.health.querySelector('.health-text');
    this.shieldPips = el('div', 'shield-pips');
    this.lagFrac = 1;
    this.coinBox = el('div', 'coins', `<img src="${ICON('coin')}" alt=""><span>0</span>`);
    this.coinText = this.coinBox.querySelector('span');
    topLeft.append(this.coinBox);

    this.waveTag = el('div', 'wave-tag');
    topLeft.append(this.waveTag);

    this.radar = el('canvas', 'radar');
    this.radar.width = this.radar.height = 320;
    this.radarCtx = this.radar.getContext('2d');

    this.banner = el('div', 'banner');
    this.toast = el('div', 'toast');
    this.bossBar = el('div', 'boss-bar', '<div class="boss-name">BIG BAD BARNACLE</div><div class="boss-track"><div class="boss-fill"></div></div>');
    this.bossFill = this.bossBar.querySelector('.boss-fill');

    this.bar = el('div', 'upgrade-bar');
    this.slots = UPGRADES.map((def) => {
      const slot = el('button', 'slot', `
        <img src="${ICON(def.icon)}" alt="">
        <span class="name">${def.name}</span>
        <span class="level"></span>
        <span class="progress"><span class="fill"></span></span>
        <span class="tip"><b>${def.name}</b><span class="blurb">${def.blurb}</span><span class="cost"></span></span>`);
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onBuy(def.id);
      });
      this.bar.append(slot);
      return {
        def, slot, level: slot.querySelector('.level'), fill: slot.querySelector('.fill'),
        cost: slot.querySelector('.cost'),
      };
    });

    this.overlay = el('div', 'overlay');
    root.append(topLeft, this.radar, this.bossBar, this.banner, this.toast, this.bar, this.overlay);
    this.onStart = onStart;
    this.onResume = onResume;
    this.lastPips = '';
  }

  flashHealth() {
    this.health.classList.remove('hurt');
    void this.health.offsetWidth;
    this.health.classList.add('hurt');
  }

  showLoading(progress) {
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel">${LOGO}
      <div class="loading"><div class="loading-fill" style="width:${Math.round(progress * 100)}%"></div></div></div>`;
  }

  showTitle() {
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel">
      ${LOGO}
      <button class="big-btn">Dive!</button>
      <div class="controls">
        <div><kbd>WASD</kbd> / <kbd>Arrows</kbd> swim</div>
        <div><kbd>P</kbd> pause &nbsp; <kbd>M</kbd> mute</div>
      </div></div>`;
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onStart());
  }

  showGameOver(stats) {
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel">
      <div class="logo small">Glub glub...</div>
      <div class="subtitle">Your magnificent tub sank on wave ${stats.wave}</div>
      <div class="stats"><div><b>${stats.kills}</b>subs sunk</div><div><b>${stats.coins}</b>coins found</div>
      <div><b>${stats.parts}</b>things bolted on</div></div>
      <button class="big-btn">Dive again</button></div>`;
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onStart());
  }

  showPause() {
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel"><div class="logo small">Paused</div>
      <button class="big-btn">Resume</button></div>`;
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onResume());
  }

  hideOverlay() {
    this.overlay.className = 'overlay';
  }

  setVisible(v) {
    this.root.classList.toggle('playing', v);
  }

  showBanner(text, sub = '') {
    this.banner.innerHTML = `<div>${text}</div>${sub ? `<small>${sub}</small>` : ''}`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  showToast(text) {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  flashSlot(id, ok) {
    const s = this.slots.find((x) => x.def.id === id);
    const cls = ok ? 'bought' : 'denied';
    s.slot.classList.remove(cls);
    void s.slot.offsetWidth;
    s.slot.classList.add(cls);
  }

  pulseCoins() {
    this.coinBox.classList.remove('pulse');
    void this.coinBox.offsetWidth;
    this.coinBox.classList.add('pulse');
  }

  update(state) {
    const { player, coins, wave, boss } = state;
    const frac = Math.max(0, player.hp / player.maxHp);
    this.lagFrac = frac > this.lagFrac ? frac : Math.max(frac, this.lagFrac - 0.008);
    this.healthTrack.style.width = `${15 + (player.maxHp - 100) * 0.025}vw`;
    this.healthFill.style.width = `${frac * 100}%`;
    this.healthLag.style.width = `${this.lagFrac * 100}%`;
    this.healthFill.classList.toggle('low', frac < 0.3);
    this.healthText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    const pips = `${player.shieldCharges}/${player.shieldMax}`;
    if (pips !== this.lastPips) {
      this.shieldPips.innerHTML = Array.from({ length: player.shieldMax },
        (_, i) => `<span class="pip ${i < player.shieldCharges ? 'on' : ''}"></span>`).join('');
      this.lastPips = pips;
    }
    this.coinText.textContent = state.unlimited ? '∞' : coins;
    this.waveTag.textContent = `Wave ${wave}`;

    for (const s of this.slots) {
      const lvl = player.levels[s.def.id];
      const maxed = lvl >= s.def.max;
      const cost = upgradeCost(s.def, lvl);
      const room = player.hasRoomFor(s.def.id);
      const slots = s.def.id === 'hull' ? ` · ${player.mountsUsed}/${player.mountCapacity}` : '';
      s.level.textContent = maxed ? `MAX${slots}` : `Lv. ${lvl}${slots}`;
      s.slot.classList.toggle('noroom', !maxed && !room);
      s.fill.style.width = `${maxed || state.unlimited ? 100 : Math.min(100, (coins / cost) * 100)}%`;
      s.cost.textContent = maxed ? 'Fully bolted' : !room ? 'No room — upgrade the Hull' : `Cost: ${cost} coins`;
      s.slot.classList.toggle('affordable', !maxed && room && (state.unlimited || coins >= cost));
      s.slot.classList.toggle('maxed', maxed);
    }

    this.bossBar.classList.toggle('show', !!boss);
    if (boss) this.bossFill.style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  }

  drawRadar(player, enemies, range, sweep, coins = []) {
    const g = this.radarCtx;
    const S = this.radar.width;
    const c = S / 2;
    const R = c - 10;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fillStyle = 'rgba(6, 30, 52, 0.72)';
    g.fill();
    g.clip();
    const grad = g.createConicGradient(sweep, c, c);
    grad.addColorStop(0, 'rgba(80, 230, 255, 0.35)');
    grad.addColorStop(0.12, 'rgba(80, 230, 255, 0)');
    grad.addColorStop(1, 'rgba(80, 230, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(110, 220, 255, 0.35)';
    g.lineWidth = 2;
    for (const f of [0.33, 0.66]) {
      g.beginPath();
      g.arc(c, c, R * f, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    const p = player.center;
    g.fillStyle = '#ffd23a';
    for (const coin of coins) {
      const dx = (coin.x - p.x) / range;
      const dy = (coin.y - p.y) / range;
      if (dx * dx + dy * dy > 1) continue;
      g.beginPath();
      g.arc(c + dx * R, c - dy * R, 5, 0, Math.PI * 2);
      g.fill();
    }
    for (const e of enemies) {
      const dx = (e.x - p.x) / range;
      const dy = (e.y - p.y) / range;
      if (dx * dx + dy * dy > 1) continue;
      g.beginPath();
      g.arc(c + dx * R, c - dy * R, e.type === 'boss' ? 13 : e.type === 'mine' ? 6 : 9, 0, Math.PI * 2);
      g.fillStyle = e.type === 'mine' ? '#ff9a3a' : '#ff3b3b';
      g.shadowColor = '#ff3b3b';
      g.shadowBlur = 12;
      g.fill();
    }
    g.shadowBlur = 0;
    g.fillStyle = '#ffd23a';
    g.beginPath();
    g.moveTo(c + 16, c);
    g.lineTo(c - 10, c - 11);
    g.lineTo(c - 4, c);
    g.lineTo(c - 10, c + 11);
    g.closePath();
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(120, 220, 255, 0.85)';
    g.lineWidth = 5;
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (R - 4), c + Math.sin(a) * (R - 4));
      g.lineTo(c + Math.cos(a) * (R + 8), c + Math.sin(a) * (R + 8));
      g.stroke();
    }
  }
}
