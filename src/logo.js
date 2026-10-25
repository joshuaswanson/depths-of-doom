// The title logo: sunny "DEPTHS" above a wavy waterline, sinister "DOOM" below it with porthole O's whose red eyes
// stare out like the enemy subs.
function porthole(cx, cy) {
  const bolts = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return `<circle cx="${cx + Math.cos(a) * 66}" cy="${cy + Math.sin(a) * 66}" r="5.5" fill="#d9a548" stroke="#3a1c06" stroke-width="2"/>`;
  }).join('');
  return `
    <g>
      <circle cx="${cx}" cy="${cy + 9}" r="80" fill="#12040c"/>
      <circle cx="${cx}" cy="${cy}" r="78" fill="#2a2d34" stroke="#12040c" stroke-width="10"/>
      <circle cx="${cx}" cy="${cy}" r="57" fill="url(#doomGlass)" stroke="#c9973f" stroke-width="9"/>
      ${bolts}
      <g filter="url(#eyeGlow)">
        <path d="M${cx - 38} ${cy - 6} L${cx - 6} ${cy + 4} L${cx - 10} ${cy + 18} L${cx - 34} ${cy + 12} Z" fill="#ff4a2a"/>
        <path d="M${cx + 38} ${cy - 6} L${cx + 6} ${cy + 4} L${cx + 10} ${cy + 18} L${cx + 34} ${cy + 12} Z" fill="#ff4a2a"/>
      </g>
      <ellipse cx="${cx - 22}" cy="${cy - 28}" rx="18" ry="9" fill="#ffffff" opacity="0.45" transform="rotate(-30 ${cx - 22} ${cy - 28})"/>
    </g>`;
}

function layeredText(text, x, y, size, fill, outline, shadow, extra = '') {
  const common = `x="${x}" y="${y}" font-family="Fredoka, sans-serif" font-weight="700" font-size="${size}"
    text-anchor="middle" letter-spacing="4" ${extra}`;
  return `
    <text ${common} fill="${shadow}" transform="translate(0 11)">${text}</text>
    <text ${common} fill="none" stroke="${outline}" stroke-width="20" stroke-linejoin="round">${text}</text>
    <text ${common} fill="${fill}">${text}</text>
    <text ${common} fill="url(#gloss)">${text}</text>`;
}

export function logoSVG(byline = true) {
  const bubbles = [[90, 300, 12], [120, 220, 7], [880, 260, 10], [915, 330, 6], [60, 380, 8], [940, 190, 8]]
    .map(([x, y, r], i) => `<circle class="logo-bubble" style="animation-delay:${i * 0.7}s" cx="${x}" cy="${y}" r="${r}"
      fill="rgba(190,240,255,0.15)" stroke="rgba(220,250,255,0.8)" stroke-width="2.5"/>`).join('');
  return `
  <svg class="logo-svg" viewBox="0 0 1000 ${byline ? 490 : 440}" xmlns="http://www.w3.org/2000/svg" aria-label="Depths of Doom">
    <defs>
      <linearGradient id="sunny" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff27a"/><stop offset="0.55" stop-color="#ffc228"/><stop offset="1" stop-color="#f08a0c"/>
      </linearGradient>
      <linearGradient id="doom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff7448"/><stop offset="0.5" stop-color="#c8152f"/><stop offset="1" stop-color="#4c0a2c"/>
      </linearGradient>
      <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.42" stop-color="#ffffff" stop-opacity="0.1"/>
        <stop offset="0.43" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="doomGlass" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0" stop-color="#4a1418"/><stop offset="1" stop-color="#0c0306"/>
      </radialGradient>
      <filter id="eyeGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${bubbles}
    <g>
      <path d="M738 128 L738 52 Q738 34 756 34 L792 34" fill="none" stroke="#4a1c04" stroke-width="30" stroke-linecap="round"/>
      <path d="M738 128 L738 52 Q738 34 756 34 L792 34" fill="none" stroke="#ffc228" stroke-width="18" stroke-linecap="round"/>
      <circle cx="802" cy="34" r="22" fill="#2e3239" stroke="#4a1c04" stroke-width="6"/>
      <circle cx="802" cy="34" r="13" fill="#9eebff"/>
    </g>
    ${layeredText('DEPTHS', 500, 178, 168, 'url(#sunny)', '#4a1c04', '#7a3207')}
    <path d="M80 226 Q130 206 180 226 T280 226 T380 226 T480 226 T580 226 T680 226 T780 226 T880 226 T920 220"
      fill="none" stroke="#0b3a5c" stroke-width="16" stroke-linecap="round"/>
    <path d="M80 226 Q130 206 180 226 T280 226 T380 226 T480 226 T580 226 T680 226 T780 226 T880 226 T920 220"
      fill="none" stroke="#6fe6ff" stroke-width="8" stroke-linecap="round"/>
    <g transform="rotate(-6 500 228)">
      <rect x="444" y="200" width="112" height="56" rx="28" fill="#1a9bdb" stroke="#0b3a5c" stroke-width="6"/>
      <text x="500" y="242" font-family="Fredoka, sans-serif" font-weight="600" font-size="40" font-style="italic"
        text-anchor="middle" fill="#ffffff">of</text>
    </g>
    ${layeredText('D', 298, 410, 196, 'url(#doom)', '#12040c', '#12040c')}
    ${porthole(446, 342)}
    ${porthole(598, 342)}
    ${layeredText('M', 752, 410, 196, 'url(#doom)', '#12040c', '#12040c')}
    ${byline ? `<text x="500" y="474" font-family="Fredoka, sans-serif" font-weight="500" font-size="34" letter-spacing="6"
      text-anchor="middle" fill="#e6f6ff" stroke="#0b2238" stroke-width="5" paint-order="stroke">by Joshua Swanson</text>` : ''}
  </svg>`;
}
