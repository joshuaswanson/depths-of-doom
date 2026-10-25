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
  { id: 'spotlight', name: 'Spotlight', icon: 'spotlight', start: 0, max: 4, base: 45, growth: 1.7,
    blurb: 'Searchlights for the depths. Dazzled foes slow down and fire less' },
];

export function upgradeCost(def, level) {
  return Math.round(def.base * def.growth ** (level - def.start) / 5) * 5;
}

// Mount points on the hull as [x along the hull, angle around it in degrees]. 0 faces the camera when the sub
// heads right, 90 is the top, 180 is the other flank, 270 is the bottom. Lists alternate flanks at different
// spots, so the sub looks crammed from both sides without being a mirror image. Parts are handed out in order.
// The top of the hull from x -0.5 to 0.9 stays clear for the conning tower and periscope.
export const SOCKETS = {
  cannon: [[0.95, -38], [0.7, 205], [0.3, 40], [0.45, 150], [-0.35, -20], [0.1, 235]],
  torpedo: [[-0.1, -8], [-0.6, 175], [0.15, -48], [-0.9, 215], [-0.2, 135]],
  missile: [[-1.0, 82], [1.25, 72], [-1.5, 62], [1.35, 108], [-1.0, 128]],
  shield: [[-1.3, 40], [1.2, 140], [-1.5, 200], [0.6, -85], [-0.6, 160]],
  grapple: [[0.45, -90]],
  sonar: [[-1.6, 100]],
  propulsion: [[-0.65, -72], [0.7, 250], [-1.25, -40], [0.1, 230]],
  spotlight: [[1.2, 52], [1.2, 135], [0.2, 24], [1.35, -55]],
  junk: [
    ['junk_crate', -0.55, 45], ['junk_ammo', 0.95, 130], ['junk_canister', -1.15, 8], ['junk_toolbox', 1.3, 195],
    ['junk_barrel', -1.45, 115], ['junk_crate', 0.55, -30], ['junk_ammo', -0.5, 220], ['junk_canister', -0.2, 22],
    ['junk_crate', -1.6, 160], ['junk_toolbox', -0.3, 150],
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
  spotlight: 'part_spotlight',
};

export function partCount(cat, level) {
  if (cat === 'propulsion') return Math.max(0, level - 1);
  if (cat === 'grapple' || cat === 'sonar') return level > 0 ? 1 : 0;
  return level;
}
