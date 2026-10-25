let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;
let sfxBus = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  // Sound effects pass through a lowpass that closes underwater, so everything below the surface sounds muffled.
  sfxBus = ctx.createBiquadFilter();
  sfxBus.type = 'lowpass';
  sfxBus.frequency.value = 18000;
  sfxBus.connect(master);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

// `dry` sounds skip the underwater muffling: interface cues like coins, upgrades and the sonar scope.
function tone({ type = 'sine', freq = 440, to = freq, dur = 0.15, vol = 0.3, delay = 0, dry = false }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(dry ? master : sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.4, freq = 800, to = 200, q = 1, delay = 0, dry = false, type = 'lowpass' }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(dry ? master : sfxBus);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Looping water beds. At the surface: a rumble, a rush that grows with speed, and waves washing. Below it: a deep,
// soft pressure rumble that sinks lower with depth, trains of bubbles, and the odd groan from the hull far down.
let amb = null;
// Low enough to sound submerged, high enough that explosions and gunfire keep their punch.
const UNDERWATER_CUTOFF = 2600;
const lerp = (a, b, t) => a + (b - a) * t;

function waterBed(type, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.loopEnd = noiseBuffer.duration;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  return { filter, gain };
}

function hum(freq) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain).connect(master);
  osc.start();
  return { osc, gain };
}

function bubbleTrain(size) {
  const count = 2 + Math.floor(Math.random() * 5);
  let delay = 0;
  for (let i = 0; i < count; i++) {
    const f = (380 + Math.random() * 700) / size;
    tone({ type: 'sine', freq: f, to: f * (1.8 + Math.random() * 0.5), dur: 0.04 + Math.random() * 0.05,
      vol: 0.03 + Math.random() * 0.04, delay });
    delay += 0.03 + Math.random() * 0.09;
  }
}

function hullGroan() {
  const f = 55 + Math.random() * 40;
  tone({ type: 'sawtooth', freq: f, to: f * (0.75 + Math.random() * 0.5), dur: 1.4 + Math.random(), vol: 0.05 });
  tone({ type: 'triangle', freq: f * 2.02, to: f * 1.7, dur: 1.1, vol: 0.025, delay: 0.15 });
}

export function setAmbience(dt, { active = false, surface = 0, speed = 0, underwater = 0, depth = 0 } = {}) {
  if (!ctx) return;
  if (!amb) {
    amb = { rumble: waterBed('lowpass', 500, 0.8), rush: waterBed('bandpass', 700, 0.9),
      surf: waterBed('bandpass', 900, 0.6), deep: waterBed('lowpass', 160, 0.7), drift: waterBed('lowpass', 320, 0.5),
      hum: hum(46), t: 0 };
  }
  amb.t += dt;
  const now = ctx.currentTime;
  const on = active ? 1 : 0;
  const swell = 0.5 + 0.5 * Math.sin(amb.t * 0.55) * Math.sin(amb.t * 0.23 + 1);
  amb.rumble.gain.gain.setTargetAtTime(on * surface * 0.1, now, 0.4);
  amb.rumble.filter.frequency.setTargetAtTime(420 + 60 * Math.sin(amb.t * 0.4), now, 0.4);
  amb.rush.gain.gain.setTargetAtTime(on * surface * speed * 0.2, now, 0.15);
  amb.rush.filter.frequency.setTargetAtTime(500 + 1100 * speed, now, 0.15);
  amb.surf.gain.gain.setTargetAtTime(on * surface * (0.06 + 0.16 * swell), now, 0.3);
  amb.surf.filter.frequency.setTargetAtTime(700 + 500 * swell, now, 0.3);
  const below = on * underwater;
  const tide = 0.5 + 0.5 * Math.sin(amb.t * 0.17) * Math.sin(amb.t * 0.11 + 2);
  amb.deep.gain.gain.setTargetAtTime(below * (0.28 + 0.14 * depth) * (0.75 + 0.25 * tide), now, 0.6);
  amb.deep.filter.frequency.setTargetAtTime(170 - 90 * depth + 25 * tide, now, 0.6);
  amb.drift.gain.gain.setTargetAtTime(below * (0.035 + speed * 0.09), now, 0.3);
  amb.drift.filter.frequency.setTargetAtTime(260 + 300 * speed, now, 0.3);
  amb.hum.gain.gain.setTargetAtTime(below * depth * 0.05, now, 1);
  amb.hum.osc.frequency.setTargetAtTime(44 + 6 * tide, now, 1);
  sfxBus.frequency.setTargetAtTime(lerp(18000, UNDERWATER_CUTOFF, underwater), now, 0.08);
  if (active && Math.random() < dt * surface * (0.35 + speed * 3)) {
    const f = 500 + Math.random() * 900;
    tone({ type: 'sine', freq: f, to: f * (1.6 + Math.random() * 0.6), dur: 0.05 + Math.random() * 0.04,
      vol: 0.025 + Math.random() * 0.035 });
  }
  if (below > 0.5 && Math.random() < dt * (0.3 + speed * 2.2)) bubbleTrain(0.8 + Math.random() * 0.8);
  if (below > 0.5 && depth > 0.5 && Math.random() < dt / 11) hullGroan();
}

// Music tracks streamed from files, each looped by starting a fresh copy as the old one fades out at its end.
const MUSIC_VOLUME = 0.55;
const MUSIC_FADE = 4;
// `tail` is how long each recording takes to fade out at its end; the next copy starts as that fade begins.
const TRACKS = {
  surface: { file: 'sunlight_on_the_reef.m4a', tail: 4.5 },
  deep: { file: 'below_the_pressure.m4a', tail: 6.5 },
  battle: { file: 'reef_pirates_charge.m4a', tail: 1.6 },
  battleDeep: { file: 'shadows_in_the_trench.m4a', tail: 1.5 },
};
const music = {};

function musicTrack(name) {
  if (music[name]) return music[name];
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(master);
  const players = [0, 1].map(() => {
    const el = new Audio(`${import.meta.env.BASE_URL}music/${TRACKS[name].file}`);
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(bus);
    return { el, gain };
  });
  music[name] = { bus, players, current: -1, level: 0 };
  return music[name];
}

function startCopy(track) {
  const now = ctx.currentTime;
  const prev = track.players[track.current];
  track.current = (track.current + 1) % 2;
  const next = track.players[track.current];
  next.el.currentTime = 0;
  next.el.play().catch(() => {});
  next.gain.gain.cancelScheduledValues(now);
  next.gain.gain.setValueAtTime(prev ? 0 : 1, now);
  if (prev) {
    next.gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE * 0.5);
    prev.gain.gain.setTargetAtTime(0, now, MUSIC_FADE / 4);
  }
}

// `mix` gives each track's target loudness from 0 to 1.
export function setMusic(mix) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const name of Object.keys(TRACKS)) {
    const level = mix[name] ?? 0;
    if (level <= 0 && !music[name]) continue;
    const track = musicTrack(name);
    track.bus.gain.setTargetAtTime(level * MUSIC_VOLUME, now, 1.2);
    if (level > 0 && track.current < 0) startCopy(track);
    const playing = track.players[track.current];
    if (!playing) continue;
    const { el } = playing;
    if (el.duration && el.currentTime > el.duration - TRACKS[name].tail) startCopy(track);
    track.level = level > 0 ? 1 : track.level - 1 / 600;
    if (track.level <= 0) {
      for (const p of track.players) p.el.pause();
      track.current = -1;
      track.level = 0;
    }
  }
}

export const sfx = {
  torpedo() {
    noise({ dur: 0.5, vol: 0.25, freq: 1500, to: 300 });
    tone({ type: 'sine', freq: 200, to: 90, dur: 0.3, vol: 0.2 });
  },
  missile() {
    noise({ dur: 0.45, vol: 0.2, freq: 3000, to: 600, q: 3 });
  },
  enemyShot() {
    tone({ type: 'sawtooth', freq: 320, to: 140, dur: 0.18, vol: 0.06 });
  },
  boom(big = false) {
    noise({ dur: big ? 1.2 : 0.6, vol: big ? 0.8 : 0.5, freq: big ? 1200 : 1800, to: 60 });
    tone({ type: 'sine', freq: big ? 110 : 160, to: 30, dur: big ? 0.9 : 0.45, vol: 0.45 });
  },
  pop() {
    tone({ type: 'sine', freq: 500, to: 1100, dur: 0.08, vol: 0.12 });
  },
  coin() {
    tone({ type: 'square', freq: 988, dur: 0.07, vol: 0.06, dry: true });
    tone({ type: 'square', freq: 1319, dur: 0.16, vol: 0.06, delay: 0.06, dry: true });
  },
  hurt() {
    tone({ type: 'sawtooth', freq: 220, to: 60, dur: 0.4, vol: 0.3 });
    noise({ dur: 0.3, vol: 0.3, freq: 900, to: 100 });
  },
  shield() {
    tone({ type: 'sine', freq: 180, to: 90, dur: 0.35, vol: 0.28 });
    tone({ type: 'triangle', freq: 1400, to: 600, dur: 0.3, vol: 0.16 });
    tone({ type: 'sine', freq: 2400, to: 2000, dur: 0.45, vol: 0.07, delay: 0.02 });
    noise({ dur: 0.12, vol: 0.18, freq: 5000, to: 2500 });
  },
  shieldBreak() {
    [1900, 1500, 1150, 850].forEach((f, i) => tone({ type: 'triangle', freq: f, to: f * 0.7, dur: 0.22, vol: 0.12,
      delay: i * 0.05 }));
    tone({ type: 'sine', freq: 220, to: 60, dur: 0.5, vol: 0.25 });
    noise({ dur: 0.45, vol: 0.25, freq: 6000, to: 800 });
  },
  shieldUp() {
    tone({ type: 'sine', freq: 500, to: 1300, dur: 0.4, vol: 0.12, dry: true });
    tone({ type: 'triangle', freq: 1600, dur: 0.18, vol: 0.06, delay: 0.32, dry: true });
  },
  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.18, delay: i * 0.07,
      dry: true }));
    noise({ dur: 0.12, vol: 0.25, freq: 4000, to: 1500, delay: 0.3, dry: true });
  },
  denied() {
    tone({ type: 'square', freq: 180, to: 150, dur: 0.15, vol: 0.08, dry: true });
  },
  // Hull on hull: a sharp strike, a dull thump, then a metallic ring. The partials follow a struck plate's
  // inharmonic modes, and a detuned twin on two of them gives the ring its shimmer.
  bump(strength = 0.5) {
    const v = 0.12 + 0.2 * strength;
    const f0 = 82 + Math.random() * 30;
    noise({ type: 'bandpass', dur: 0.06, vol: v * 1.1, freq: 1600, to: 900, q: 1.1 });
    tone({ type: 'sine', freq: 70, to: 38, dur: 0.28, vol: v * 1.1 });
    const modes = [[1, 1.4, 1], [2.76, 1.0, 0.8], [5.4, 0.65, 0.5], [8.93, 0.4, 0.26]];
    modes.forEach(([ratio, ring, amp]) => {
      const f = f0 * ratio;
      tone({ type: 'sine', freq: f, to: f * 0.99, dur: ring * (0.6 + strength * 0.5), vol: v * amp * 0.6 });
      if (ratio === 2.76 || ratio === 5.4) tone({ type: 'sine', freq: f * 1.01, dur: ring * 0.8, vol: v * amp * 0.32 });
    });
  },
  clank() {
    tone({ type: 'square', freq: 260, to: 120, dur: 0.08, vol: 0.1 });
  },
  wave() {
    [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.25, vol: 0.15, delay: i * 0.12,
      dry: true }));
  },
  splash() {
    noise({ dur: 0.6, vol: 0.35, freq: 2500, to: 400, q: 0.7 });
    tone({ type: 'sine', freq: 300, to: 120, dur: 0.25, vol: 0.12 });
  },
  thud(strength = 1) {
    noise({ dur: 0.5, vol: 0.25 * strength, freq: 500, to: 60 });
    tone({ type: 'sine', freq: 90, to: 40, dur: 0.35, vol: 0.3 * Math.min(1, strength) });
  },
  bigSplash(scale = 2) {
    const v = Math.min(1, scale / 3);
    noise({ dur: 1.1, vol: 0.55 * v + 0.15, freq: 2200, to: 250, q: 0.6 });
    noise({ dur: 0.5, vol: 0.35 * v, freq: 5000, to: 1800, q: 0.8, delay: 0.05 });
    tone({ type: 'sine', freq: 140, to: 50, dur: 0.5, vol: 0.3 * v });
  },
  gull() {
    [0, 0.2, 0.36].forEach((d) => {
      tone({ type: 'sawtooth', freq: 1800, to: 1050, dur: 0.17, vol: 0.045, delay: d });
      tone({ type: 'square', freq: 2300, to: 1450, dur: 0.12, vol: 0.018, delay: d });
    });
  },
  // A classic sonar ping that rings out and comes back as fainter echoes.
  sonar(strength = 1) {
    [0, 0.38, 0.76].forEach((delay, i) => {
      const vol = 0.05 * strength * [1, 0.35, 0.12][i];
      tone({ type: 'sine', freq: 1180, to: 1120, dur: 1.3, vol, delay, dry: true });
      tone({ type: 'sine', freq: 2360, to: 2240, dur: 0.5, vol: vol * 0.25, delay, dry: true });
    });
  },
  blip(big = false) {
    tone({ type: 'sine', freq: big ? 1250 : 1900, to: big ? 1150 : 1800, dur: 0.09, vol: 0.035, dry: true });
  },
};
