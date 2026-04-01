#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync, realpathSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { parseArgs } from "util";
import chalk from "chalk";
import { renderSprite, colorizeSprite, RARITY_STARS, RARITY_COLORS } from "./sprites.js";

if (typeof Bun === "undefined") {
  console.error("buddy-reroll requires Bun runtime (uses Bun.hash).\nInstall: https://bun.sh");
  process.exit(1);
}

// ── Constants (synced with Claude Code src/buddy/types.ts) ───────────────

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

// ── PRNG (synced with Claude Code src/buddy/companion.ts) ────────────────

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

function hashString(s) {
  return Number(BigInt(Bun.hash(s)) & 0xffffffffn);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function rollRarity(rng) {
  let roll = rng() * RARITY_TOTAL;
  for (const r of RARITIES) {
    roll -= RARITY_WEIGHTS[r];
    if (roll < 0) return r;
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

// ── Path detection ───────────────────────────────────────────────────────

function getClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

function findBinaryPath() {
  const isWin = platform() === "win32";

  try {
    const cmd = isWin ? "where.exe claude 2>nul" : "which -a claude 2>/dev/null";
    const allPaths = execSync(cmd, { encoding: "utf-8" }).trim().split("\n");
    for (const entry of allPaths) {
      try {
        const resolved = realpathSync(entry.trim());
        if (resolved && existsSync(resolved) && statSync(resolved).size > 1_000_000) return resolved;
      } catch {}
    }
  } catch {}

  const versionsDirs = [
    join(homedir(), ".local", "share", "claude", "versions"),
    ...(isWin ? [join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Claude", "versions")] : []),
  ];
  for (const versionsDir of versionsDirs) {
    if (!existsSync(versionsDir)) continue;
    try {
      const versions = readdirSync(versionsDir)
        .filter((f) => !f.includes(".backup"))
        .sort();
      if (versions.length > 0) return join(versionsDir, versions[versions.length - 1]);
    } catch {}
  }

  return null;
}

function findConfigPath() {
  const claudeDir = getClaudeConfigDir();

  const legacyPath = join(claudeDir, ".config.json");
  if (existsSync(legacyPath)) return legacyPath;

  const home = process.env.CLAUDE_CONFIG_DIR || homedir();
  const defaultPath = join(home, ".claude.json");
  if (existsSync(defaultPath)) return defaultPath;

  // Windows: check AppData\Roaming\Claude
  if (platform() === "win32" && process.env.APPDATA) {
    const appDataPath = join(process.env.APPDATA, "Claude", "config.json");
    if (existsSync(appDataPath)) return appDataPath;
  }

  return null;
}

function getUserId(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config.oauthAccount?.accountUuid ?? config.userID ?? "anon";
}

// ── Salt detection ───────────────────────────────────────────────────────

function findCurrentSalt(binaryData, userId) {
  if (binaryData.includes(Buffer.from(ORIGINAL_SALT))) return ORIGINAL_SALT;

  const text = binaryData.toString("latin1");

  // Scan for previously patched salts
  const patterns = [
    new RegExp(`x{${SALT_LEN - 8}}\\d{8}`, "g"),
    new RegExp(`friend-\\d{4}-.{${SALT_LEN - 12}}`, "g"),
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      if (m[0].length === SALT_LEN) return m[0];
    }
  }

  const saltRegex = new RegExp(`"([a-zA-Z0-9_-]{${SALT_LEN}})"`, "g");
  const candidates = new Set();
  const markers = ["rollRarity", "CompanionBones", "inspirationSeed", "companionUserId"];
  for (const marker of markers) {
    const markerIdx = text.indexOf(marker);
    if (markerIdx === -1) continue;
    const window = text.slice(Math.max(0, markerIdx - 5000), Math.min(text.length, markerIdx + 5000));
    let match;
    while ((match = saltRegex.exec(window)) !== null) {
      candidates.add(match[1]);
    }
  }

  for (const c of candidates) {
    if (/[\d-]/.test(c)) return c;
  }

  return null;
}

// ── Brute-force ──────────────────────────────────────────────────────────

async function bruteForce(userId, target, onProgress) {
  const startTime = Date.now();
  let checked = 0;

  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const suffixLen = SALT_LEN - "friend-2026-".length;
  if (suffixLen > 0 && suffixLen <= 4) {
    const gen = function* (prefix, depth) {
      if (depth === 0) { yield prefix; return; }
      for (const ch of chars) yield* gen(prefix + ch, depth - 1);
    };
    for (const suffix of gen("", suffixLen)) {
      const salt = `friend-2026-${suffix}`;
      checked++;
      const r = rollFrom(salt, userId);
      if (matches(r, target)) return { salt, result: r, checked, elapsed: Date.now() - startTime };
    }
  }

  for (let i = 0; i < 1_000_000_000; i++) {
    const salt = String(i).padStart(SALT_LEN, "x");
    checked++;
    const r = rollFrom(salt, userId);
    if (matches(r, target)) return { salt, result: r, checked, elapsed: Date.now() - startTime };

    if (checked % 100_000 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    if (checked % 5_000_000 === 0) {
      if (onProgress) onProgress(checked, Date.now() - startTime);
    }
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

// ── Binary patch ─────────────────────────────────────────────────────────

function isClaudeRunning() {
  try {
    if (platform() === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV 2>nul', { encoding: "utf-8" });
      return out.toLowerCase().includes("claude.exe");
    }
    const out = execSync("pgrep -af claude 2>/dev/null", { encoding: "utf-8" });
    return out.split("\n").some((line) => !line.includes("buddy-reroll") && line.trim().length > 0);
  } catch {
    return false;
  }
}

function patchBinary(binaryPath, oldSalt, newSalt) {
  if (oldSalt.length !== newSalt.length) {
    throw new Error(`Salt length mismatch: "${oldSalt}" (${oldSalt.length}) vs "${newSalt}" (${newSalt.length})`);
  }

  const data = readFileSync(binaryPath);
  const oldBuf = Buffer.from(oldSalt);
  const newBuf = Buffer.from(newSalt);

  let count = 0;
  let idx = 0;
  while (true) {
    idx = data.indexOf(oldBuf, idx);
    if (idx === -1) break;
    newBuf.copy(data, idx);
    count++;
    idx += newBuf.length;
  }

  if (count === 0) throw new Error(`Salt "${oldSalt}" not found in binary`);

  const isWin = platform() === "win32";
  const maxRetries = isWin ? 3 : 1;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      writeFileSync(binaryPath, data);
      return count;
    } catch (err) {
      if (isWin && (err.code === "EACCES" || err.code === "EPERM" || err.code === "EBUSY") && attempt < maxRetries - 1) {
        execSync("timeout /t 2 /nobreak >nul 2>&1", { shell: true, stdio: "ignore" });
        continue;
      }
      throw new Error(`Failed to write binary: ${err.message}${isWin ? " (ensure Claude Code is fully closed)" : ""}`);
    }
  }
}

function resignBinary(binaryPath) {
  if (platform() !== "darwin") return false;
  try {
    execSync(`codesign -s - --force "${binaryPath}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function clearCompanion(configPath) {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw);
  delete config.companion;
  delete config.companionMuted;
  const indent = raw.match(/^(\s+)"/m)?.[1] ?? "  ";
  writeFileSync(configPath, JSON.stringify(config, null, indent) + "\n");
}

// ── Display ──────────────────────────────────────────────────────────────

function formatCompanionCard(result) {
  const sprite = renderSprite({ species: result.species, eye: result.eye, hat: result.hat });
  const colored = colorizeSprite(sprite, result.rarity);
  const colorFn = chalk[RARITY_COLORS[result.rarity]] ?? chalk.white;
  const stars = RARITY_STARS[result.rarity] ?? "";

  const meta = [];
  meta.push(`${result.species} / ${result.rarity}${result.shiny ? " / shiny" : ""}`);
  meta.push(`eye:${result.eye} / hat:${result.hat}`);
  meta.push(stars);

  const lines = [];
  const spriteWidth = 14;
  for (let i = 0; i < colored.length; i++) {
    const right = meta[i] ?? "";
    lines.push(`  ${colored[i]}${" ".repeat(Math.max(0, spriteWidth - sprite[i].length))}${right}`);
  }

  for (const [k, v] of Object.entries(result.stats)) {
    const filled = Math.min(10, Math.max(0, Math.round(v / 10)));
    const bar = colorFn("█".repeat(filled) + "░".repeat(10 - filled));
    lines.push(`  ${k.padEnd(10)} ${bar} ${String(v).padStart(3)}`);
  }

  return lines.join("\n");
}

// ── Interactive mode ─────────────────────────────────────────────────────

async function interactiveMode(binaryPath, configPath, userId) {
  const binaryData = readFileSync(binaryPath);
  const currentSalt = findCurrentSalt(binaryData, userId);
  if (!currentSalt) {
    console.error("✗ Could not find companion salt in binary.");
    process.exit(1);
  }
  const currentRoll = rollFrom(currentSalt, userId);

  const { runInteractiveUI } = await import("./ui.jsx");
  await runInteractiveUI({
    currentRoll,
    currentSalt,
    binaryPath,
    configPath,
    userId,
    bruteForce,
    patchBinary,
    resignBinary,
    clearCompanion,
    isClaudeRunning,
    rollFrom,
    matches,
    SPECIES,
    RARITIES,
    RARITY_LABELS,
    EYES,
    HATS,
  });
}

// ── Non-interactive mode ─────────────────────────────────────────────────

async function nonInteractiveMode(args, binaryPath, configPath, userId) {
  console.log(`  Binary:  ${binaryPath}`);
  console.log(`  Config:  ${configPath}`);
  console.log(`  User ID: ${userId.slice(0, 8)}...`);

  if (args.restore) {
    const backupPath = binaryPath + ".backup";
    if (!existsSync(backupPath)) {
      console.error("  ✗ No backup found at", backupPath);
      process.exit(1);
    }
    copyFileSync(backupPath, binaryPath);
    resignBinary(binaryPath);
    clearCompanion(configPath);
    console.log("  ✓ Restored. Restart Claude Code and run /buddy.");
    return;
  }

  const binaryData = readFileSync(binaryPath);
  const currentSalt = findCurrentSalt(binaryData, userId);
  if (!currentSalt) {
    console.error("  ✗ Could not find companion salt in binary.");
    process.exit(1);
  }

  if (args.current) {
    const result = rollFrom(currentSalt, userId);
    console.log(`\n  Current companion (salt: ${currentSalt}):`);
    console.log(formatCompanionCard(result));
    console.log();
    return;
  }

  const target = {};
  if (args.species) {
    if (!SPECIES.includes(args.species)) { console.error(`  ✗ Unknown species "${args.species}". Use --list.`); process.exit(1); }
    target.species = args.species;
  }
  if (args.rarity) {
    if (!RARITIES.includes(args.rarity)) { console.error(`  ✗ Unknown rarity "${args.rarity}". Use --list.`); process.exit(1); }
    target.rarity = args.rarity;
  }
  if (args.eye) {
    if (!EYES.includes(args.eye)) { console.error(`  ✗ Unknown eye "${args.eye}". Use --list.`); process.exit(1); }
    target.eye = args.eye;
  }
  if (args.hat) {
    if (!HATS.includes(args.hat)) { console.error(`  ✗ Unknown hat "${args.hat}". Use --list.`); process.exit(1); }
    target.hat = args.hat;
  }
  if (args.shiny !== undefined) target.shiny = args.shiny;

  if (Object.keys(target).length === 0) {
    console.error("  ✗ Specify at least one target. Use --help for usage.");
    process.exit(1);
  }

  console.log(`  Target:  ${Object.entries(target).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

  const currentRoll = rollFrom(currentSalt, userId);
  if (matches(currentRoll, target)) {
    console.log("  ✓ Already matches!\n" + formatCompanionCard(currentRoll));
    return;
  }

  if (isClaudeRunning()) {
    console.warn("  ⚠ Claude Code appears to be running. Quit it before patching to avoid issues.");
  }

  console.log("  Searching...");
  const found = await bruteForce(userId, target, null);
  if (!found) {
    console.error("  ✗ No matching salt found. Try relaxing constraints.");
    process.exit(1);
  }
  console.log(`  ✓ Found in ${found.checked.toLocaleString()} attempts (${(found.elapsed / 1000).toFixed(1)}s)`);
  console.log(formatCompanionCard(found.result));

  const backupPath = binaryPath + ".backup";
  if (!existsSync(backupPath)) {
    copyFileSync(binaryPath, backupPath);
    console.log(`\n  Backup:  ${backupPath}`);
  }

  const patchCount = patchBinary(binaryPath, currentSalt, found.salt);
  console.log(`  Patched: ${patchCount} occurrence(s)`);
  if (resignBinary(binaryPath)) console.log("  Signed:  ad-hoc codesign ✓");
  clearCompanion(configPath);
  console.log("  Config:  companion data cleared");
  console.log("\n  Done! Restart Claude Code and run /buddy.\n");
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const { values: args } = parseArgs({
    options: {
      species: { type: "string" },
      rarity: { type: "string" },
      eye: { type: "string" },
      hat: { type: "string" },
      shiny: { type: "boolean", default: undefined },
      list: { type: "boolean", default: false },
      restore: { type: "boolean", default: false },
      current: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: false,
  });

  if (args.help) {
    console.log(`
  buddy-reroll — Reroll your Claude Code companion

  Usage:
    bunx buddy-reroll                  Interactive mode (recommended)
    bunx buddy-reroll --species dragon --rarity legendary --eye ✦ --shiny
    bunx buddy-reroll --list           Show all available options
    bunx buddy-reroll --current        Show current companion
    bunx buddy-reroll --restore        Restore original binary

  Flags (all optional — omit to leave random):
    --species <name>    ${SPECIES.join(", ")}
    --rarity <name>     ${RARITIES.join(", ")}
    --eye <char>        ${EYES.join(" ")}
    --hat <name>        ${HATS.join(", ")}
    --shiny / --no-shiny
`);
    return;
  }

  if (args.list) {
    console.log("\n  buddy-reroll — available options\n");
    console.log("  Species:  ", SPECIES.join(", "));
    console.log("  Rarity:   ", RARITIES.map((r) => `${r} (${RARITY_WEIGHTS[r]}%)`).join(", "));
    console.log("  Eye:       " + EYES.join("  "));
    console.log("  Hat:      ", HATS.join(", "));
    console.log("  Shiny:     true / false (1% natural chance)\n");
    return;
  }

  const binaryPath = findBinaryPath();
  if (!binaryPath) {
    console.error("✗ Could not find Claude Code binary. Is it installed?");
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error("✗ Could not find Claude Code config file.");
    process.exit(1);
  }

  const userId = getUserId(configPath);
  if (userId === "anon") {
    console.warn("⚠ No user ID found — using anonymous identity. Roll will change if you log in later.");
  }

  const hasTargetFlags = args.species || args.rarity || args.eye || args.hat || args.shiny !== undefined;
  const isCommand = args.restore || args.current;

  if (!hasTargetFlags && !isCommand) {
    await interactiveMode(binaryPath, configPath, userId);
  } else {
    await nonInteractiveMode(args, binaryPath, configPath, userId);
  }
}

main();
