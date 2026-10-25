// Drives the game frame by frame through trailer/shots.js and saves every frame as a JPEG.
//
//   node trailer/capture.mjs [--url http://localhost:5317/] [--out /tmp/trailer/frames] [--from 0] [--to 101.5]
//                            [--every 1]
//
// --every N keeps only every Nth frame, for quick previews of a time range. The game itself still steps every frame,
// so the scene plays out the same as in the full render.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((a) => a.trim().split(/\s+/)));
const url = args.url ?? 'http://localhost:5317/';
const out = args.out ?? '/tmp/trailer/frames';
const every = Number(args.every ?? 1);
const here = path.dirname(new URL(import.meta.url).pathname);

fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.jpg')) fs.unlinkSync(path.join(out, f));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__debug && window.__game, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__debug.lockResolution(1);
  window.__debug.manual(true);
  window.__debug.start();
});
await page.addScriptTag({ path: path.join(here, 'shots.js') });

const fps = await page.evaluate(() => window.__trailer.fps);
const duration = await page.evaluate(() => window.__trailer.duration);
const from = Math.round(Number(args.from ?? 0) * fps);
const to = Math.round(Number(args.to ?? duration) * fps);
const started = Date.now();
for (let n = 0; n < to; n++) {
  await page.evaluate((i) => window.__trailer.frame(i), n);
  if (n < from || (n - from) % every) continue;
  await page.screenshot({ path: path.join(out, `${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  if (n % 150 === 0) console.log(`frame ${n}/${to}  ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
await browser.close();
console.log('done', out);
