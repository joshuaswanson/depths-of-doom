import { ACHIEVEMENTS, isUnlocked, unlockedCount } from './achievements.js';
import { LANGUAGES, getLanguage, setLanguage, t } from './i18n.js';
import { UPGRADES, upgradeCost } from './upgrades.js';
import { touchScreen } from './touch.js';

const ICON = (name) => `${import.meta.env.BASE_URL}icons/${name}.webp`;
const LOGO = `<div class="logo-wrap"><img class="logo-img" src="${import.meta.env.BASE_URL}logo.webp" alt="Submania">
  <a class="badge" href="https://joshuaswanson.github.io" target="_blank" rel="noopener">
    <img src="${import.meta.env.BASE_URL}badge.webp" alt="by Joshua Swanson"></a></div>`;
const TROPHY = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4
  4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1
  1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2
  2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg>`;
const achievementsButton = () => `<button class="side-btn ach-btn">${TROPHY}${t('achievements')}
  <b>${unlockedCount()}/${ACHIEVEMENTS.length}</b></button>`;
const FRIENDS = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M9 11a4 4 0 1 0 0-8
  4 4 0 0 0 0 8zm7.5 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM1 20c0-3.3 3.6-6 8-6s8 2.7 8 6v1H1v-1zm17.5 1v-1c0-2-1-3.8
  -2.6-5.1 3.6.2 6.1 2.4 6.1 5.1v1h-3.5z"/></svg>`;
const COFFEE = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M4 8h13v5a5 5 0 0
  1-5 5H9a5 5 0 0 1-5-5V8zm13 1h1.5a2.5 2.5 0 0 1 0 5H17v-2h1.5a.5.5 0 0 0 0-1H17V9zM7 2c.6.8.6 1.7 0 2.5S6.4 6.2 7 7H5.6
  c-.6-.8-.6-1.7 0-2.5S6.2 2.8 5.6 2H7zm4 0c.6.8.6 1.7 0 2.5s-.6 1.7 0 2.5H9.6c-.6-.8-.6-1.7 0-2.5s.6-1.7 0-2.5H11zM3
  20h16v2H3z"/></svg>`;
const LINK = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M10.6 13.4a1 1 0 0 1
  0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8.5 19.8a4.2 4.2 0 0 1-3-7.2l2.1-2.1a1 1 0 1 1 1.4 1.4L6.9
  14a2.2 2.2 0 0 0 3.1 3.1l2.1-2.1a1 1 0 1 1 1.4 1.4l-2.1 2.1a4.2 4.2 0 0 1-2.9 1.3zm7.9-6.3a1 1 0 0 1-.7-1.7l2.1-2.1A2.2
  2.2 0 0 0 14.7 6.6l-2.1 2.1a1 1 0 1 1-1.4-1.4l2.1-2.1a4.2 4.2 0 0 1 5.9 5.9l-2.1 2.1a1 1 0 0 1-.7.3z"/></svg>`;
const BUG = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M9 4.5 7.6 3.1l1.4-1.4
  1.8 1.8a5 5 0 0 1 2.4 0l1.8-1.8 1.4 1.4L15 4.5A5 5 0 0 1 17 8H7a5 5 0 0 1 2-3.5zM6 10h12v4a6 6 0 0 1-5 5.9V12h-2v7.9A6
  6 0 0 1 6 14v-4zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM3 6.4l1.4-1.4L7 7.6 5.6 9 3 6.4zm15.4 2.6L17 7.6 19.6 5 21 6.4 18.4
  9zM5.6 15 7 16.4 4.4 19 3 17.6 5.6 15zm12.8 0 2.6 2.6-1.4 1.4-2.6-2.6 1.4-1.4z"/></svg>`;
const GEAR = `<svg viewBox="0 0 24 24" class="trophy" aria-hidden="true"><path fill="currentColor" d="M10.3 2h3.4l.5 2.6
  1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.6.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7
  -2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6L2 13.7v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7.5-2.6zM12 8.5a3.5 3.5 0 1 0
  0 7 3.5 3.5 0 0 0 0-7z"/></svg>`;
const titleControls = () => `<div class="title-row">
  <button class="side-btn friends-btn">${FRIENDS}${t('diveFriends')}</button>
  <button class="big-btn">${t('dive')}</button>
  <div class="ach-slot">${achievementsButton()}</div></div>`;
// Movement keys laid out as they sit on a keyboard: one key above, three below.
const keyCluster = (up, left, down, right) => `<div class="key-grid"><kbd class="k-up">${up}</kbd>
  <kbd class="k-left">${left}</kbd><kbd class="k-down">${down}</kbd><kbd class="k-right">${right}</kbd></div>`;

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
  constructor(root, { onBuy, onStart, onResume, onPause, onHost, onJoin, onVolume, volume }) {
    this.root = root;
    this.onBuy = onBuy;

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

    this.pauseBtn = el('button', 'pause-btn', '<span class="bars"><i></i><i></i></span>');
    this.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPause();
    });
    this.radar = el('canvas', 'radar');
    this.radar.width = this.radar.height = 320;
    this.radarCtx = this.radar.getContext('2d');

    this.banner = el('div', 'banner');
    this.toast = el('div', 'toast');
    this.bossBar = el('div', 'boss-bar', '<div class="boss-name"></div><div class="boss-track"><div class="boss-fill"></div></div>');
    this.bossFill = this.bossBar.querySelector('.boss-fill');

    this.bar = el('div', 'upgrade-bar');
    this.bar.append(this.coinBox);
    this.slots = UPGRADES.map((def) => {
      const slot = el('button', 'slot', `
        <span class="bolt tl"></span><span class="bolt tr"></span><span class="bolt bl"></span><span class="bolt br"></span>
        <span class="port"><img src="${ICON(def.icon)}" alt=""></span>
        <span class="name"></span>
        <span class="level"></span>
        <span class="price"><img src="${ICON('coin')}" alt=""><span class="amount"></span></span>
        <span class="tip"><b></b><span class="blurb"></span><span class="cost"></span></span>`);
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onBuy(def.id);
      });
      this.bar.append(slot);
      return {
        def, slot, level: slot.querySelector('.level'), amount: slot.querySelector('.amount'),
        cost: slot.querySelector('.cost'),
      };
    });

    this.overlay = el('div', 'overlay');
    this.achievementPops = el('div', 'ach-pops');
    root.append(this.pauseBtn, this.radar, this.bossBar, this.banner, this.toast, this.bar, this.overlay,
      this.achievementPops);
    this.onStart = onStart;
    this.onHost = onHost;
    this.onJoin = onJoin;
    this.onResume = onResume;
    this.onVolume = onVolume;
    this.volume = volume;
    this.room = el('div', 'room-code');
    this.rotateNote = el('div', 'rotate-note', '<div class="rotate-phone"></div><span></span>');
    root.append(this.room, this.rotateNote);
    this.lastPips = '';
    this.screen = null;
    // Keyboard hints name the keys as printed on the player's own keyboard, where the browser can tell.
    this.keys = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyP: 'P', KeyM: 'M' };
    navigator.keyboard?.getLayoutMap?.().then((map) => {
      for (const code of Object.keys(this.keys)) this.keys[code] = (map.get(code) ?? this.keys[code]).toUpperCase();
      if (this.hints) this.showControlHints();
    }).catch(() => {});
    this.relabel();
  }

  // Text that stays on screen between redraws, set again whenever the language changes.
  relabel() {
    this.pauseBtn.setAttribute('aria-label', t('pause'));
    this.bossBar.querySelector('.boss-name').textContent = t('boss');
    this.rotateNote.querySelector('span').textContent = t('rotate');
    for (const s of this.slots) {
      s.slot.querySelector('.name').textContent = s.def.name;
      s.slot.querySelector('.tip b').textContent = s.def.name;
      s.slot.querySelector('.blurb').textContent = s.def.blurb;
    }
    this.lastPlayers = null;
  }

  // Switches the language and redraws whatever is showing, with the settings still open over it.
  changeLanguage(code) {
    setLanguage(code);
    this.relabel();
    if (this.roomCode) this.showRoom(this.roomCode, this.roomSlot);
    if (this.hints) this.showControlHints();
    if (this.screen === 'title') this.showTitle();
    else if (this.screen === 'pause') this.showPause();
    else if (this.screen === 'gameover') this.showGameOver(this.lastStats);
    this.showSettings();
  }

  flashHealth() {
    this.health.classList.remove('hurt');
    void this.health.offsetWidth;
    this.health.classList.add('hurt');
  }

  // The loading screen lays out the title screen's controls unseen beneath the logo, so the logo and badge sit
  // exactly where they will on the title screen, and keeps the same logo element through the switch so its bob
  // carries on unbroken.
  showLoading(progress) {
    let fill = this.overlay.querySelector('.loading-fill');
    if (!fill) {
      this.overlay.className = 'overlay show';
      this.overlay.innerHTML = `<div class="panel">${LOGO}<div class="below"><div class="unseen">${titleControls()}</div>
        <div class="loading"><div class="loading-fill"></div></div></div></div>`;
      fill = this.overlay.querySelector('.loading-fill');
    }
    fill.style.width = `${Math.round(progress * 100)}%`;
  }

  showTitle() {
    this.screen = 'title';
    this.closePopup();
    this.overlay.className = 'overlay show';
    const below = this.overlay.querySelector('.below');
    if (below) below.innerHTML = titleControls();
    else this.overlay.innerHTML = `<div class="panel">${LOGO}<div class="below">${titleControls()}</div></div>`;
    this.overlay.querySelector('.gear-btn')?.remove();
    const gear = el('button', 'gear-btn', GEAR);
    gear.setAttribute('aria-label', t('settings'));
    gear.addEventListener('click', () => {
      gear.blur();
      this.showSettings();
    });
    this.overlay.append(gear);
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onStart());
    this.addAchievementsButton(this.overlay.querySelector('.ach-slot'));
    this.overlay.querySelector('.friends-btn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.showFriends();
    });
  }

  setPlayers(slots) {
    const box = this.room.querySelector('.room-players');
    if (!box) return;
    const key = slots.join(',');
    if (key === this.lastPlayers) return;
    this.lastPlayers = key;
    const colors = ['#ffd23a', '#38c8ff', '#5be37a', '#c77dff'];
    box.innerHTML = slots.map((n) => `<span class="room-player${n === this.roomSlot ? ' me' : ''}" style="--c:${colors[n - 1]}">
      P${n}${n === this.roomSlot ? ` (${t('you')})` : ''}</span>`).join('');
  }

  coopStatus(text) {
    if (!this.popup?.querySelector('.coop-status') && this.overlay.querySelector('.friends-btn')) this.showFriends();
    const box = this.popup?.querySelector('.coop-status');
    if (!box) return;
    box.textContent = text;
    box.classList.add('alert');
  }

  // The co-op badge: the room code, a button to copy an invite link, and a dot for each sub in the game.
  showRoom(code, slot) {
    this.roomCode = code;
    this.room.innerHTML = `<div class="room-label">${t('room')}</div><div class="room-id">${code}</div>
      <button class="room-copy">${LINK}${t('copyInvite')}</button><div class="room-players"></div>`;
    this.room.classList.add('show');
    this.room.querySelector('.room-copy').addEventListener('click', (e) => {
      const link = `${location.origin}${location.pathname}?join=${code}`;
      navigator.clipboard?.writeText(link).then(() => this.showToast(t('inviteCopied')),
        () => this.showToast(link));
      e.currentTarget.blur();
    });
    this.roomSlot = slot ?? 1;
    // A shared game can't be paused, so its pause button goes.
    this.pauseBtn.style.display = 'none';
  }

  showGameOver(stats) {
    this.screen = 'gameover';
    this.lastStats = stats;
    this.closePopup();
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel">
      <div class="logo small">${t('glub')}</div>
      <div class="subtitle">${t('sank', { n: stats.wave })}</div>
      <div class="stats"><div><b>${stats.kills}</b>${t('subsSunk')}</div><div><b>${stats.coins}</b>${t('coinsFound')}</div>
      <div><b>${stats.parts}</b>${t('boltedOn')}</div></div>
      <button class="big-btn">${t('diveAgain')}</button><div class="ach-slot"></div></div>`;
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onStart());
    this.addAchievementsButton(this.overlay.querySelector('.ach-slot'));
  }

  showPause() {
    this.screen = 'pause';
    this.closePopup();
    this.overlay.className = 'overlay show';
    this.overlay.innerHTML = `<div class="panel"><div class="logo small">${t('paused')}</div>
      <button class="big-btn">${t('resume')}</button>
      <div><button class="side-btn settings-btn">${GEAR}${t('settings')}</button></div></div>`;
    this.overlay.querySelector('.big-btn').addEventListener('click', () => this.onResume());
    this.overlay.querySelector('.settings-btn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.showSettings();
    });
  }

  hideOverlay() {
    this.screen = null;
    this.closePopup();
    this.overlay.className = 'overlay';
  }

  // Music and sound effect volumes, the language, a place to report bugs, and a tip jar.
  showSettings() {
    const slider = (kind) => `<label class="setting"><span>${t(kind)}</span>
      <input type="range" class="volume" data-kind="${kind}" min="0" max="100" value="${Math.round(this.volume(kind) * 100)}"></label>`;
    const languages = LANGUAGES.map(([code, name]) => `<button class="lang-btn${code === getLanguage() ? ' on' : ''}"
      data-lang="${code}" lang="${code}">${name}</button>`).join('');
    const popup = this.openPopup(`<div class="ach-box settings-box">
      <div class="ach-head">${GEAR}${t('settings')}</div>
      ${slider('music')}${slider('effects')}
      <div class="setting"><span>${t('language')}</span><div class="lang-pick">${languages}</div></div>
      <div class="settings-links">
        <a class="bug-btn" href="https://github.com/joshuaswanson/submania/issues/new" target="_blank" rel="noopener">${BUG}${t('bug')}</a>
        <a class="coffee-btn" href="https://buymeacoffee.com/swanson" target="_blank" rel="noopener">${COFFEE}${t('coffee')}</a>
      </div>
      <button class="coop-btn ach-close">${t('back')}</button></div>`);
    for (const input of popup.querySelectorAll('.volume')) {
      const show = () => input.style.setProperty('--fill', `${input.value}%`);
      show();
      input.addEventListener('input', () => {
        show();
        this.onVolume(input.dataset.kind, input.value / 100);
      });
    }
    for (const button of popup.querySelectorAll('.lang-btn')) {
      button.addEventListener('click', () => {
        if (button.dataset.lang !== getLanguage()) this.changeLanguage(button.dataset.lang);
      });
    }
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

  // The controls, shown to the right of the sub at the start of the first dive until it first moves.
  showControlHints() {
    this.hints?.remove();
    const k = this.keys;
    // On a touch screen the stick hint waits in the lower left corner, under the thumb that steers.
    this.hints = el('div', touchScreen ? 'hints corner' : 'hints', touchScreen ? `<div class="hint"><div class="hint-swim">
        <div class="hint-stick"><i></i></div><div class="hint-label">${t('dragToSwim')}</div></div></div>` : `<div class="hint">
        <div class="hint-swim"><div class="hint-keys">${keyCluster(k.KeyW, k.KeyA, k.KeyS, k.KeyD)}
        <span class="hint-or">${t('or')}</span>
        ${keyCluster('&uarr;', '&larr;', '&darr;', '&rarr;')}</div><div class="hint-label">${t('swim')}</div></div>
        <div class="hint-more"><div><kbd>${k.KeyP}</kbd> ${t('pauseKey')}</div><div><kbd>${k.KeyM}</kbd> ${t('muteKey')}</div></div>
        </div>`);
    this.root.append(this.hints);
  }

  dismissHints() {
    const hints = this.hints;
    if (!hints) return;
    this.hints = null;
    hints.classList.add('leaving');
    setTimeout(() => hints.remove(), 900);
  }

  // Keeps the hints beside the sub, `gap` pixels clear of its centre.
  placeHints(x, y, gap) {
    if (!this.hints) return;
    this.hints.style.setProperty('--x', `${x}px`);
    this.hints.style.setProperty('--y', `${y}px`);
    this.hints.style.setProperty('--gap', `${gap}px`);
  }

  addAchievementsButton(slot) {
    slot.innerHTML = achievementsButton();
    slot.querySelector('.ach-btn').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.showAchievements();
    });
  }

  get popupOpen() {
    return Boolean(this.popup);
  }

  // One window at a time opens over the title, pause or game-over screen: the achievements, the co-op controls or the
  // settings.
  // Clicking the dimmed backdrop or Back closes it.
  openPopup(html) {
    this.closePopup();
    this.popup = el('div', 'ach-list', html);
    this.popup.querySelector('.ach-close').addEventListener('click', () => this.closePopup());
    this.popup.addEventListener('pointerdown', (e) => {
      if (e.target === this.popup) this.closePopup();
    });
    this.overlay.append(this.popup);
    return this.popup;
  }

  closePopup() {
    this.popup?.remove();
    this.popup = null;
  }

  // Every achievement by name, earned ones lit in gold. Pointing at or tapping one shows how to earn it.
  showAchievements() {
    const buttons = ACHIEVEMENTS.map((a) => `<button class="ach-tile${isUnlocked(a.id) ? ' got' : ''}" data-id="${a.id}">${
      isUnlocked(a.id) ? TROPHY : LOCK}${a.name}</button>`).join('');
    const share = (100 * unlockedCount()) / ACHIEVEMENTS.length;
    const popup = this.openPopup(`<div class="ach-box">
      <div class="ach-head">${TROPHY}${t('achievements')} <b>${unlockedCount()}/${ACHIEVEMENTS.length}</b></div>
      <div class="ach-bar"><i style="width: ${share}%"></i></div>
      <div class="ach-tiles">${buttons}</div>
      <div class="ach-detail"><span class="ach-hint">${t('achHint')}</span></div>
      <button class="coop-btn ach-close">${t('back')}</button></div>`);
    const detail = popup.querySelector('.ach-detail');
    const tiles = popup.querySelectorAll('.ach-tile');
    const select = (tile) => {
      const a = ACHIEVEMENTS.find((x) => x.id === tile.dataset.id);
      const got = isUnlocked(a.id);
      for (const t of tiles) t.classList.toggle('picked', t === tile);
      detail.innerHTML = `<span class="ach-icon${got ? ' got' : ''}">${got ? TROPHY : LOCK}</span>
        <span class="ach-text"><b>${a.name}</b><span>${a.desc}</span></span>`;
    };
    for (const tile of tiles) {
      tile.addEventListener('pointerenter', () => select(tile));
      tile.addEventListener('click', () => select(tile));
    }
  }

  // Hosting or joining a shared dive, behind its own button so the title screen stays clear.
  showFriends() {
    const popup = this.openPopup(`<div class="ach-box friends-box">
      <div class="ach-head">${FRIENDS}${t('diveFriends')}</div>
      <div class="coop">
        <button class="coop-btn host">${t('host')}</button>
        <span class="coop-or">${t('or')}</span>
        <input class="coop-code" maxlength="4" placeholder="CODE" spellcheck="false" autocomplete="off">
        <button class="coop-btn join">${t('join')}</button>
      </div>
      <div class="coop-status">${t('coopIntro')}</div>
      <button class="coop-btn ach-close">${t('back')}</button></div>`);
    const code = popup.querySelector('.coop-code');
    code.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' && code.value.trim().length === 4) this.onJoin(code.value);
    });
    popup.querySelector('.coop-btn.host').addEventListener('click', () => this.onHost());
    popup.querySelector('.coop-btn.join').addEventListener('click', () => {
      if (code.value.trim().length === 4) this.onJoin(code.value);
      else this.coopStatus(t('typeCode'));
    });
  }

  // A gold card that drops in at the top of the screen, with the coins it paid.
  showAchievement(def, reward) {
    const pop = el('div', 'ach-pop', `<span class="ach-icon">${TROPHY}</span><span class="ach-text">
      <small>${t('achUnlocked')}</small><b>${def.name}</b><span>${def.desc}</span></span>
      <span class="ach-reward"><img src="${ICON('coin')}" alt="">+${reward}</span>`);
    this.achievementPops.append(pop);
    // As it fades, the card pulls the ones stacked under it up into its place, so they glide there.
    setTimeout(() => {
      const room = pop.offsetHeight + parseFloat(getComputedStyle(this.achievementPops).rowGap);
      pop.animate([{ marginTop: '0px' }, { marginTop: `${-room}px` }], { duration: 450, easing: 'ease-in-out', fill: 'forwards' })
        .finished.then(() => pop.remove());
    }, 4150);
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
    this.coinText.textContent = coins;

    for (const s of this.slots) {
      const lvl = player.levels[s.def.id];
      const maxed = lvl >= s.def.max;
      const cost = upgradeCost(s.def, lvl);
      const room = player.hasRoomFor(s.def.id);
      const slots = s.def.id === 'hull' ? ` · ${player.mountsUsed}/${player.mountCapacity}` : '';
      s.level.textContent = maxed ? `${t('max')}${slots}` : `${t('level', { n: lvl })}${slots}`;
      const affordable = !maxed && room && coins >= cost;
      s.amount.textContent = maxed ? t('max') : !room ? t('noRoom') : cost;
      s.cost.textContent = maxed ? t('fullyBolted') : !room ? t('noRoomTip') : t('cost', { n: cost });
      s.slot.classList.toggle('noroom', !maxed && !room);
      s.slot.classList.toggle('affordable', affordable);
      s.slot.classList.toggle('locked', !affordable && !maxed);
      s.slot.classList.toggle('maxed', maxed);
    }

    this.bossBar.classList.toggle('show', !!boss);
    if (boss) this.bossFill.style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  }

  // A green phosphor sonar scope: bezel, range rings, bearing ticks, and a sweep that lights blips as it passes,
  // leaving them to fade until the next pass.
  drawRadar(player, enemies, range, sweep, coins = []) {
    const g = this.radarCtx;
    const S = this.radar.width;
    const c = S / 2;
    const R = c - 26;
    const TAU = Math.PI * 2;
    g.clearRect(0, 0, S, S);

    const bezel = g.createRadialGradient(c, c * 0.8, R * 0.6, c, c, c);
    bezel.addColorStop(0, '#6c7884');
    bezel.addColorStop(0.75, '#3c4651');
    bezel.addColorStop(1, '#1a2027');
    g.fillStyle = bezel;
    g.beginPath();
    g.arc(c, c, c - 2, 0, TAU);
    g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      const x = c + Math.cos(a) * (c - 13);
      const y = c + Math.sin(a) * (c - 13);
      const bolt = g.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
      bolt.addColorStop(0, '#eef2f6');
      bolt.addColorStop(1, '#4a535d');
      g.fillStyle = bolt;
      g.beginPath();
      g.arc(x, y, 5.5, 0, TAU);
      g.fill();
    }

    g.save();
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.clip();
    const screen = g.createRadialGradient(c, c, 0, c, c, R);
    screen.addColorStop(0, '#0b2a1a');
    screen.addColorStop(1, '#03110a');
    g.fillStyle = screen;
    g.fillRect(0, 0, S, S);

    const trail = g.createConicGradient(sweep - 1.2, c, c);
    trail.addColorStop(0, 'rgba(70, 255, 140, 0)');
    trail.addColorStop(1.2 / TAU, 'rgba(70, 255, 140, 0.32)');
    trail.addColorStop(1.2 / TAU + 0.001, 'rgba(70, 255, 140, 0)');
    g.fillStyle = trail;
    g.fillRect(0, 0, S, S);

    g.strokeStyle = 'rgba(90, 255, 150, 0.28)';
    g.lineWidth = 1.5;
    for (const f of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.arc(c, c, R * f, 0, TAU);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      const inner = R * (i % 3 === 0 ? 0.9 : 0.95);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      g.stroke();
    }

    g.strokeStyle = 'rgba(160, 255, 190, 0.9)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(sweep) * R, c + Math.sin(sweep) * R);
    g.stroke();

    const p = player.center;
    const blip = (x, y, size, color) => {
      const dx = (x - p.x) / range;
      const dy = (y - p.y) / range;
      if (dx * dx + dy * dy > 1) return;
      const bx = c + dx * R;
      const by = c - dy * R;
      const since = (((sweep - Math.atan2(by - c, bx - c)) % TAU) + TAU) % TAU;
      const glow = Math.max(0.15, 1 - since / TAU);
      g.globalAlpha = glow;
      g.shadowColor = color;
      g.shadowBlur = 14 * glow;
      g.fillStyle = color;
      g.beginPath();
      g.arc(bx, by, size, 0, TAU);
      g.fill();
    };
    for (const coin of coins) blip(coin.x, coin.y, 4, '#ffe05a');
    for (const e of enemies) blip(e.x, e.y, e.type === 'boss' ? 12 : e.type === 'mine' ? 5 : 8, e.type === 'mine' ? '#ffb347' : '#ff4a3a');
    g.globalAlpha = 1;
    g.shadowBlur = 0;

    g.fillStyle = '#b6ffcf';
    g.beginPath();
    const f = player.facing >= 0 ? 1 : -1;
    g.moveTo(c + 13 * f, c);
    g.lineTo(c - 8 * f, c - 8);
    g.lineTo(c - 4 * f, c);
    g.lineTo(c - 8 * f, c + 8);
    g.closePath();
    g.fill();

    const glass = g.createLinearGradient(c - R, c - R, c, c);
    glass.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    glass.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = glass;
    g.beginPath();
    g.ellipse(c - R * 0.25, c - R * 0.35, R * 0.75, R * 0.45, -0.6, 0, TAU);
    g.fill();
    g.restore();

    g.strokeStyle = '#c9973f';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c, c, R + 2, 0, TAU);
    g.stroke();
  }

}
