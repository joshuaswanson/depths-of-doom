let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
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

function tone({ type = 'sine', freq = 440, to = freq, dur = 0.15, vol = 0.3, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.4, freq = 800, to = 200, q = 1, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Looping water beds: a low rumble that darkens with depth, a rush that grows with speed, and waves washing at the
// surface. Bubbles pop now and then on top.
let amb = null;

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

export function setAmbience(dt, { active = false, depth = 0, surface = 0, speed = 0 } = {}) {
  if (!ctx) return;
  if (!amb) {
    amb = { rumble: waterBed('lowpass', 500, 0.8), rush: waterBed('bandpass', 700, 0.9),
      surf: waterBed('bandpass', 900, 0.6), t: 0 };
  }
  amb.t += dt;
  const now = ctx.currentTime;
  const on = active ? 1 : 0;
  const swell = 0.5 + 0.5 * Math.sin(amb.t * 0.55) * Math.sin(amb.t * 0.23 + 1);
  amb.rumble.gain.gain.setTargetAtTime(on * (0.16 + 0.12 * depth) * (1 - surface * 0.5), now, 0.4);
  amb.rumble.filter.frequency.setTargetAtTime(480 - 360 * depth + 60 * Math.sin(amb.t * 0.4), now, 0.4);
  amb.rush.gain.gain.setTargetAtTime(on * speed * 0.2, now, 0.15);
  amb.rush.filter.frequency.setTargetAtTime(500 + 1100 * speed, now, 0.15);
  amb.surf.gain.gain.setTargetAtTime(on * surface * (0.06 + 0.16 * swell), now, 0.3);
  amb.surf.filter.frequency.setTargetAtTime(700 + 500 * swell, now, 0.3);
  if (active && Math.random() < dt * (0.35 + speed * 3)) {
    const f = 500 + Math.random() * 900;
    tone({ type: 'sine', freq: f, to: f * (1.6 + Math.random() * 0.6), dur: 0.05 + Math.random() * 0.04,
      vol: 0.025 + Math.random() * 0.035 });
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
    tone({ type: 'square', freq: 988, dur: 0.07, vol: 0.06 });
    tone({ type: 'square', freq: 1319, dur: 0.16, vol: 0.06, delay: 0.06 });
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
    tone({ type: 'sine', freq: 500, to: 1300, dur: 0.4, vol: 0.12 });
    tone({ type: 'triangle', freq: 1600, dur: 0.18, vol: 0.06, delay: 0.32 });
  },
  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.18, delay: i * 0.07 }));
    noise({ dur: 0.12, vol: 0.25, freq: 4000, to: 1500, delay: 0.3 });
  },
  denied() {
    tone({ type: 'square', freq: 180, to: 150, dur: 0.15, vol: 0.08 });
  },
  bump(strength = 0.5) {
    const v = 0.12 + 0.2 * strength;
    tone({ type: 'square', freq: 190, to: 95, dur: 0.12, vol: v });
    tone({ type: 'triangle', freq: 620, to: 540, dur: 0.35, vol: v * 0.6 });
    tone({ type: 'sine', freq: 1240, to: 1180, dur: 0.25, vol: v * 0.3, delay: 0.01 });
    noise({ dur: 0.12, vol: v * 0.8, freq: 3000, to: 900 });
  },
  clank() {
    tone({ type: 'square', freq: 260, to: 120, dur: 0.08, vol: 0.1 });
  },
  wave() {
    [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.25, vol: 0.15, delay: i * 0.12 }));
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
      tone({ type: 'sine', freq: 1180, to: 1120, dur: 1.3, vol, delay });
      tone({ type: 'sine', freq: 2360, to: 2240, dur: 0.5, vol: vol * 0.25, delay });
    });
  },
  blip(big = false) {
    tone({ type: 'sine', freq: big ? 1250 : 1900, to: big ? 1150 : 1800, dur: 0.09, vol: 0.035 });
  },
};
