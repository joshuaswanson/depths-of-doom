import './style.css';

// Touch-only devices have no keyboard to steer with, so they get a notice and the game is never loaded.
const touchOnly = matchMedia('(hover: none) and (pointer: coarse)').matches;
const mobileAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (touchOnly || mobileAgent) {
  import('@fontsource/fredoka/600.css');
  const base = import.meta.env.BASE_URL;
  document.getElementById('app').innerHTML = `<div class="overlay show blocked"><div class="panel">
    <div class="logo-wrap"><img class="logo-img" src="${base}logo.webp" alt="Depths of Doom"></div>
    <div class="blocked-note">Depths of Doom needs a keyboard.<br>Play on a computer to dive in!</div>
    </div></div>`;
} else {
  import('./main.js');
}
