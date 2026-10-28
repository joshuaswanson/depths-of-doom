// Achievements earned across every dive, kept in the browser's local storage.
export const ACHIEVEMENTS = [
  { id: 'first_sink', group: 'Battle', name: 'Fish Food', desc: 'Sink your first enemy sub.' },
  { id: 'sink_100', group: 'Battle', name: 'Scrap Merchant', desc: 'Sink 100 enemy subs, across all your dives.' },
  { id: 'mine_bump', group: 'Battle', name: 'Mine Sweeper', desc: 'Bump an enemy sub into a sea mine.' },
  { id: 'boss', group: 'Battle', name: 'Barnacle Buster', desc: 'Sink Big Bad Barnacle.' },
  { id: 'wave_5', group: 'Progress', name: 'Getting Deep', desc: 'Clear wave 5.' },
  { id: 'wave_10', group: 'Progress', name: 'Old Salt', desc: 'Clear wave 10.' },
  { id: 'wave_20', group: 'Progress', name: 'Abyssal Admiral', desc: 'Clear wave 20.' },
  { id: 'untouchable', group: 'Battle', name: 'Untouchable', desc: 'Clear wave 5 or later without taking a hit.' },
  { id: 'coins_1000', group: 'Progress', name: 'Treasure Hoarder', desc: 'Collect 1,000 coins in a single dive.' },
  { id: 'rubber_duck', group: 'Progress', name: 'Rubber Ducky', desc: 'Earn the rubber duck on your hull.' },
  { id: 'max_upgrade', group: 'Progress', name: 'Fully Loaded', desc: 'Max out any upgrade.' },
  { id: 'grapple_kill', group: 'Battle', name: 'Get Over Here', desc: 'Sink an enemy sub with the grapple claw.' },
  { id: 'dazzle', group: 'Battle', name: 'Lights Out', desc: 'Dazzle an enemy with your spotlight.' },
  { id: 'whale_song', group: 'Sea life', name: 'Whale Song', desc: 'Hear the humpback sing.' },
  { id: 'sperm_whale', group: 'Sea life', name: 'Something Big', desc: 'Shine your spotlight on the sperm whale down in a trench.' },
  { id: 'whale_shark', group: 'Sea life', name: 'Gentle Giant', desc: 'Spot the whale shark cruising the open ocean.' },
  { id: 'shipwreck', group: 'Exploring', name: 'Shipwrecked', desc: 'Shine your spotlight on the rusted fishing boat on a trench floor.' },
  { id: 'angler', group: 'Sea life', name: 'Lure-d In', desc: 'Swim up to an anglerfish as its lure flashes.' },
  { id: 'gulls', group: 'Sea life', name: 'Gull-ible', desc: 'Send the seagulls flying.' },
  { id: 'flying_sub', group: 'Exploring', name: 'Flying Sub', desc: 'Launch clear out of the water.' },
  { id: 'dolphin_jump', group: 'Sea life', name: 'Porpoise Pals', desc: 'Leap out of the water alongside the dolphins.' },
  { id: 'abyss', group: 'Exploring', name: 'Rock Bottom', desc: 'Touch the floor of a deep trench.' },
  { id: 'coop', group: 'Progress', name: 'Crew Up', desc: 'Dive with a friend.' },
  { id: 'north_pole', group: 'Exploring', name: 'True North', desc: 'Reach the North Pole.' },
  { id: 'south_pole', group: 'Exploring', name: 'Down Under the Ice', desc: 'Reach the South Pole.' },
  { id: 'polar_bear', group: 'Sea life', name: 'Bear Necessities', desc: 'Spot a polar bear on the ice.' },
  { id: 'penguin_swim', group: 'Sea life', name: 'Penguin Pal', desc: 'Swim alongside a diving penguin.' },
  { id: 'penguin_bowl', group: 'Sea life', name: 'Penguin Bowling', desc: 'Ram a floe and knock three penguins into the sea.' },
  { id: 'icebreaker', group: 'Exploring', name: 'Icebreaker', desc: 'Smash through 40 plates of pack ice.' },
];

const KEY = 'submania-achievements';
// Coins added to the dive for each achievement earned.
export const ACHIEVEMENT_REWARD = 10;
const state = load();
let notify = null;
// Achievements count only during a dive, not behind the title or game-over screens.
let active = false;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return { unlocked: saved.unlocked ?? {}, stats: saved.stats ?? {} };
  } catch {
    // Storage can be blocked or hold something unreadable; start fresh.
  }
  return { unlocked: {}, stats: {} };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Without storage, achievements last for this visit only.
  }
}

// Called with the achievement's definition whenever one is newly earned.
export function onUnlock(fn) {
  notify = fn;
}

export function setActive(on) {
  active = on;
}

export function unlock(id) {
  if (!active || state.unlocked[id]) return;
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return;
  state.unlocked[id] = Date.now();
  save();
  notify?.(def);
}

export function isUnlocked(id) {
  return Boolean(state.unlocked[id]);
}

export function unlockedCount() {
  return ACHIEVEMENTS.filter((a) => state.unlocked[a.id]).length;
}

// Adds to a running total kept across dives and returns the new total.
export function addStat(name, amount = 1) {
  state.stats[name] = (state.stats[name] ?? 0) + amount;
  save();
  return state.stats[name];
}
