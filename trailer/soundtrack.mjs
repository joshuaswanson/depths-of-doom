// Builds the trailer soundtrack from trailer/timeline.json and muxes it with the captured frames.
//
//   node trailer/soundtrack.mjs [--frames /tmp/trailer/frames] [--out art/trailer/submania-trailer.mp4]
//
// Narration comes from the Kokoro voice model (trailer/narrate.py); sound effects are rendered offline from the game's own src/audio.js.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((a) => a.trim().split(/\s+/)));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const work = '/tmp/trailer';
const frames = args.frames ?? path.join(work, 'frames');
const out = path.resolve(root, args.out ?? 'art/trailer/submania-trailer.mp4');
const timeline = JSON.parse(fs.readFileSync(path.join(root, 'trailer/timeline.json'), 'utf8'));
const run = (cmd, list) => execFileSync(cmd, list, { stdio: ['ignore', 'ignore', 'inherit'] });

for (const dir of ['vo', 'sfx']) fs.mkdirSync(path.join(work, dir), { recursive: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

// Narration from the Kokoro neural voice, given a little warmth and room and normalised to a steady level.
execFileSync('uv', ['run', '--quiet', '--python', '3.12', '--with', 'kokoro', '--with', 'soundfile', '--with',
  'misaki[en]', path.join(root, 'trailer/narrate.py'), path.join(work, 'vo')], { stdio: ['ignore', 'inherit', 'ignore'] });
const voice = timeline.narration.map((line, i) => {
  const raw = path.join(work, 'vo', `n${i}.wav`);
  const wav = path.join(work, 'vo', `n${i}-mix.wav`);
  run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
    'aresample=44100,highpass=f=60,equalizer=f=180:t=q:w=1:g=2,'
    + 'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=150,aecho=0.85:0.5:28:0.08,loudnorm=I=-16:TP=-1.5',
    '-ar', '44100', '-ac', '2', wav]);
  return { ...line, wav };
});

// Sound effects, rendered from the game's synth code in an offline audio context.
const audioSrc = fs.readFileSync(path.join(root, 'src/audio.js'), 'utf8');
const sfxBody = audioSrc.slice(audioSrc.indexOf('export const sfx = {') + 'export const sfx = {'.length,
  audioSrc.lastIndexOf('};'));
const sounds = {
  boom: 'sfx.boom(false)', boomBig: 'sfx.boom(true)', splash: 'sfx.splash()', bigSplash: 'sfx.bigSplash(2.6)',
  sonar: 'sfx.sonar(1.6)', coin: 'sfx.coin()',
  stinger: 'sfx.bump(1); tone({ type: "sine", freq: 62, to: 28, dur: 2.6, vol: 0.7 }); '
    + 'noise({ dur: 1.4, vol: 0.5, freq: 300, to: 2400, q: 0.8 });',
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
for (const [name, call] of Object.entries(sounds)) {
  const samples = await page.evaluate(async ({ body, call }) => {
    const ctx = new OfflineAudioContext(2, 44100 * 3, 44100);
    const master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    const sfxBus = master;
    const noiseBuffer = ctx.createBuffer(1, 44100, 44100);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const muted = false;
    function tone({ type = 'sine', freq = 440, to = freq, dur = 0.15, vol = 0.3, delay = 0 }) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, delay);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), delay + dur);
      gain.gain.setValueAtTime(vol, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + dur);
      osc.connect(gain).connect(sfxBus);
      osc.start(delay);
      osc.stop(delay + dur + 0.02);
    }
    function noise({ dur = 0.3, vol = 0.4, freq = 800, to = 200, q = 1, delay = 0, type = 'lowpass' }) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(freq, delay);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), delay + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, delay + dur);
      src.connect(filter).connect(gain).connect(sfxBus);
      src.start(delay);
      src.stop(delay + dur + 0.02);
    }
    void muted;
    const sfx = eval(`({${body}})`);
    eval(call);
    const buf = await ctx.startRendering();
    return [Array.from(buf.getChannelData(0)), Array.from(buf.getChannelData(1))];
  }, { body: sfxBody, call });
  writeWav(path.join(work, 'sfx', `${name}.wav`), samples);
}
await browser.close();

function writeWav(file, [left, right]) {
  const n = left.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24);
  b.writeUInt32LE(44100 * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  const clip = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(clip(left[i]), 44 + i * 4);
    b.writeInt16LE(clip(right[i]), 46 + i * 4);
  }
  fs.writeFileSync(file, b);
}

// Mix: music segments with fades, ducked under the narration, plus the sound effects on their cues.
const inputs = [];
const chains = [];
const ms = (s) => Math.round(s * 1000);
const music = timeline.music.map((m, i) => {
  inputs.push('-ss', String(m.from), '-to', String(m.to), '-i', path.join(root, 'public/music', m.file));
  const len = m.to - m.from;
  chains.push(`[${inputs.filter((x) => x === '-i').length - 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,`
    + `afade=t=in:d=${m.fadeIn},afade=t=out:st=${(len - m.fadeOut).toFixed(3)}:d=${m.fadeOut},`
    + `adelay=${ms(m.at)}|${ms(m.at)}[m${i}]`);
  return `[m${i}]`;
});
const vo = voice.map((v, i) => {
  inputs.push('-i', v.wav);
  chains.push(`[${inputs.filter((x) => x === '-i').length - 1}:a]volume=${v.gain ?? 1},adelay=${ms(v.at)}|${ms(v.at)}[v${i}]`);
  return `[v${i}]`;
});
const fx = timeline.sfx.map((s, i) => {
  inputs.push('-i', path.join(work, 'sfx', `${s.sound}.wav`));
  chains.push(`[${inputs.filter((x) => x === '-i').length - 1}:a]volume=${s.gain ?? 0.55},adelay=${ms(s.at)}|${ms(s.at)}[f${i}]`);
  return `[f${i}]`;
});
const n = (list) => list.length;
chains.push(`${music.join('')}amix=inputs=${n(music)}:normalize=0:duration=longest,volume=0.9[mus]`);
chains.push(`${vo.join('')}amix=inputs=${n(vo)}:normalize=0:duration=longest,volume=1.25,asplit=2[vo][key]`);
chains.push(`${fx.join('')}amix=inputs=${n(fx)}:normalize=0:duration=longest[fx]`);
// The ducking filter stops when its key input does, so the key is padded to the full length.
chains.push(`[key]apad=whole_dur=${timeline.duration}[keypad]`);
chains.push('[mus][keypad]sidechaincompress=threshold=0.04:ratio=5:attack=30:release=450:makeup=1[duck]');
chains.push(`[duck][vo][fx]amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.95,`
  + `atrim=0:${timeline.duration},afade=t=out:st=${timeline.duration - 1.5}:d=1.5[out]`);
const soundtrack = path.join(work, 'soundtrack.wav');
run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-ar', '44100',
  soundtrack]);
console.log('soundtrack', soundtrack);

if (fs.existsSync(frames) && fs.readdirSync(frames).some((f) => f.endsWith('.jpg'))) {
  // Finishing: 60 fps frames blended in pairs into 30 fps motion blur, a contrast and colour grade, a vignette,
  // light film grain, and 2.39:1 letterbox bars.
  const bar = Math.round((1080 - 1920 / 2.39) / 2);
  const finish = ['tmix=frames=2', 'fps=30', 'eq=contrast=1.06:saturation=1.12:gamma=0.98',
    'vignette=angle=0.5', 'noise=alls=5:allf=t', `drawbox=y=0:w=iw:h=${bar}:color=black:t=fill`,
    `drawbox=y=ih-${bar}:w=iw:h=${bar}:color=black:t=fill`].join(',');
  run('ffmpeg', ['-v', 'error', '-y', '-framerate', '60', '-pattern_type', 'glob', '-i', path.join(frames, '*.jpg'),
    '-i', soundtrack, '-vf', finish, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-b:a', '192k', '-movflags', '+faststart', '-shortest', out]);
  console.log('trailer', out);
}
