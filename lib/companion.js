const ORIGINAL_SALT = "friend-2026-401";
const SALT_LEN = ORIGINAL_SALT.length;

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };
const RARITY_TOTAL = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
const RARITY_FLOOR = { common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50 };

const SPECIES = [
  "duck", "goose", "blob", "cat", "dragon", "octopus", "owl", "penguin",
  "turtle", "snail", "ghost", "axolotl", "capybara", "cactus", "robot",
  "rabbit", "mushroom", "chonk",
];

const EYES = ["·", "✦", "×", "◉", "@", "°"];
const HATS = ["none", "crown", "tophat", "propeller", "halo", "wizard", "beanie", "tinyduck"];
const STAT_NAMES = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];

const RARITY_LABELS = {
  common: "Common (60%)",
  uncommon: "Uncommon (25%)",
  rare: "Rare (10%)",
  epic: "Epic (4%)",
  legendary: "Legendary (1%)",
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashString(value) {
  return fnv1a(value);
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function rollRarity(rng) {
  let roll = rng() * RARITY_TOTAL;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return "common";
}

function rollFrom(salt, userId) {
  const rng = mulberry32(hashString(userId + salt));
  const rarity = rollRarity(rng);
  const species = pick(rng, SPECIES);
  const eye = pick(rng, EYES);
  const hat = rarity === "common" ? "none" : pick(rng, HATS);
  const shiny = rng() < 0.01;

  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);

  const stats = {};
  for (const name of STAT_NAMES) {
    if (name === peak) stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    else if (name === dump) stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    else stats[name] = floor + Math.floor(rng() * 40);
  }

  return { rarity, species, eye, hat, shiny, stats, peak, dump };
}

function findCurrentSalt(binaryData) {
  if (binaryData.includes(Buffer.from(ORIGINAL_SALT))) return ORIGINAL_SALT;

  const text = binaryData.toString("latin1");

  const patchedSaltPatterns = [
    new RegExp(`x{${SALT_LEN - 8}}\\d{8}`, "g"),
    new RegExp(`friend-\\d{4}-.{${SALT_LEN - 12}}`, "g"),
  ];
  for (const pattern of patchedSaltPatterns) {
    let match = pattern.exec(text);
    while (match !== null) {
      if (match[0].length === SALT_LEN) return match[0];
      match = pattern.exec(text);
    }
  }

  const saltRegex = new RegExp(`"([a-zA-Z0-9_-]{${SALT_LEN}})"`, "g");
  const candidates = new Set();
  const markers = ["rollRarity", "CompanionBones", "inspirationSeed", "companionUserId"];
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) continue;

    const window = text.slice(Math.max(0, markerIndex - 5000), Math.min(text.length, markerIndex + 5000));
    let match = saltRegex.exec(window);
    while (match !== null) {
      candidates.add(match[1]);
      match = saltRegex.exec(window);
    }
  }

  for (const candidate of candidates) {
    if (/[\d-]/.test(candidate)) return candidate;
  }
  // Brute-forced salts can be purely alphabetic — accept any candidate
  if (candidates.size > 0) return candidates.values().next().value;

  return null;
}

function matches(roll, target) {
  if (target.species && roll.species !== target.species) return false;
  if (target.rarity && roll.rarity !== target.rarity) return false;
  if (target.eye && roll.eye !== target.eye) return false;
  if (target.hat && roll.hat !== target.hat) return false;
  if (target.shiny !== undefined && roll.shiny !== target.shiny) return false;
  if (target.peak && roll.peak !== target.peak) return false;
  if (target.dump && roll.dump !== target.dump) return false;
  return true;
}

async function bruteForce(userId, target, onProgress) {
  const startTime = Date.now();
  let checked = 0;

  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const suffixLen = SALT_LEN - "friend-2026-".length;
  if (suffixLen > 0 && suffixLen <= 4) {
    const generateSuffixes = function* (prefix, depth) {
      if (depth === 0) {
        yield prefix;
        return;
      }
      for (const char of chars) yield* generateSuffixes(prefix + char, depth - 1);
    };

    for (const suffix of generateSuffixes("", suffixLen)) {
      const salt = `friend-2026-${suffix}`;
      checked++;
      const result = rollFrom(salt, userId);
      if (matches(result, target)) return { salt, result, checked, elapsed: Date.now() - startTime };
    }
  }

  for (let index = 0; index < 1_000_000_000; index++) {
    const salt = String(index).padStart(SALT_LEN, "x");
    checked++;
    const result = rollFrom(salt, userId);
    if (matches(result, target)) return { salt, result, checked, elapsed: Date.now() - startTime };

    if (checked % 100_000 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (checked % 5_000_000 === 0 && onProgress) {
      onProgress(checked, Date.now() - startTime);
    }
  }

  return null;
}

export {
  EYES,
  HATS,
  RARITIES,
  RARITY_LABELS,
  RARITY_WEIGHTS,
  SPECIES,
  STAT_NAMES,
  bruteForce,
  findCurrentSalt,
  matches,
  rollFrom,
};
