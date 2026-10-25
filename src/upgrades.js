export const UPGRADES = [
  { id: 'hull', name: 'Hull', icon: 'hull', start: 1, max: 6, base: 70, growth: 1.7,
    blurb: 'Fatter hull, +35 max health, more junk' },
  { id: 'cannon', name: 'Cannon', icon: 'cannon', start: 1, max: 6, base: 35, growth: 1.6,
    blurb: 'Bolt on another gatling gun' },
  { id: 'torpedo', name: 'Torpedos', icon: 'torpedo', start: 0, max: 5, base: 55, growth: 1.65,
    blurb: 'Seeking torpedo racks' },
  { id: 'missile', name: 'Missiles', icon: 'missile', start: 0, max: 5, base: 75, growth: 1.65,
    blurb: 'Homing missile pods' },
  { id: 'shield', name: 'Shield', icon: 'shield', start: 0, max: 5, base: 60, growth: 1.7,
    blurb: 'Bubble shield blocks hits' },
  { id: 'grapple', name: 'Grapple', icon: 'grapple', start: 0, max: 4, base: 45, growth: 1.8,
    blurb: 'Grabs coins and pinches foes' },
  { id: 'sonar', name: 'Sonar', icon: 'sonar', start: 0, max: 4, base: 50, growth: 1.8,
    blurb: 'Radar range and +15% damage' },
  { id: 'propulsion', name: 'Propulsion', icon: 'propulsion', start: 1, max: 5, base: 40, growth: 1.7,
    blurb: 'Extra thrusters for speed' },
];

export function upgradeCost(def, level) {
  return Math.round(def.base * def.growth ** (level - def.start) / 5) * 5;
}

// Mount points on the hull as [x along the hull, angle around it in degrees]. 0 faces the camera, 90 is the
// top, -90 is the bottom. Parts are handed out in order as levels go up.
export const SOCKETS = {
  cannon: [[0.95, -38], [0.85, 12], [0.35, -62], [0.25, 40], [-0.35, -20], [0.5, 75]],
  torpedo: [[-0.1, -8], [-0.75, 28], [0.15, -48], [-0.95, -30], [0.0, 30]],
  missile: [[-0.45, 82], [0.85, 78], [-1.2, 70], [0.2, 104], [-0.6, 120]],
  shield: [[-1.0, 50], [1.25, 50], [-1.55, 20], [0.6, -85], [-0.3, 68]],
  grapple: [[0.45, -90]],
  sonar: [[-0.95, 100]],
  propulsion: [[-0.65, -72], [0.7, -78], [-1.25, -45], [0.1, -100]],
  junk: [
    ['junk_crate', -0.35, 58], ['junk_ammo', 0.95, 52], ['junk_canister', -1.15, 8], ['junk_toolbox', 1.35, -18],
    ['junk_barrel', -1.45, 62], ['junk_crate', 0.55, -30], ['junk_ammo', -0.5, -42], ['junk_canister', 0.1, 70],
    ['junk_crate', -1.6, -15], ['junk_toolbox', 0.0, 118],
  ],
};

export const JUNK_PER_HULL = [0, 0, 2, 4, 6, 8, 10];

export const PART_MODEL = {
  cannon: 'part_cannon',
  torpedo: 'part_torpedo',
  missile: 'part_missile',
  shield: 'part_shield',
  grapple: 'part_grapple',
  sonar: 'part_sonar',
  propulsion: 'part_thruster',
};

export function partCount(cat, level) {
  if (cat === 'propulsion') return Math.max(0, level - 1);
  if (cat === 'grapple' || cat === 'sonar') return level > 0 ? 1 : 0;
  return level;
}
