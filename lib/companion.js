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

function hashString(value) {
  return Number(BigInt(Bun.hash(value)) & 0xffffffffn);
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

  return { rarity, species, eye, hat, shiny, stats };
}

function findCurrentSalt(binaryData) {
  if (binaryData.includes(Buffer.from(ORIGINAL_SALT))) return ORIGINAL_SALT;

  const text = binaryData.toString("latin1");

  const patchedSaltPatterns = [
    new RegExp(`x{${SALT_LEN - 8}}\\d{8}`, "g"),
    new RegExp(`friend-\\d{4}-.{${SALT_LEN - 12}}`, "g"),
  ];
  for (const pattern of patchedSaltPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[0].length === SALT_LEN) return match[0];
    }
  }

  const saltRegex = new RegExp(`"([a-zA-Z0-9_-]{${SALT_LEN}})"`, "g");
  const candidates = new Set();
  const markers = ["rollRarity", "CompanionBones", "inspirationSeed", "companionUserId"];
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) continue;

    const window = text.slice(Math.max(0, markerIndex - 5000), Math.min(text.length, markerIndex + 5000));
    let match;
    while ((match = saltRegex.exec(window)) !== null) {
      candidates.add(match[1]);
    }
  }

  for (const candidate of candidates) {
    if (/[\d-]/.test(candidate)) return candidate;
  }

  return null;
}

function matches(roll, target) {
  if (target.species && roll.species !== target.species) return false;
  if (target.rarity && roll.rarity !== target.rarity) return false;
  if (target.eye && roll.eye !== target.eye) return false;
  if (target.hat && roll.hat !== target.hat) return false;
  if (target.shiny !== undefined && roll.shiny !== target.shiny) return false;
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
  ORIGINAL_SALT,
  RARITIES,
  RARITY_LABELS,
  RARITY_WEIGHTS,
  SPECIES,
  bruteForce,
  findCurrentSalt,
  matches,
  rollFrom,
};
