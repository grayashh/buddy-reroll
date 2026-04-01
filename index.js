#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { platform } from "os";
import { execSync } from "child_process";
import { parseArgs } from "util";
import chalk from "chalk";
import { renderSprite, colorizeSprite, RARITY_STARS, RARITY_COLORS } from "./sprites.js";
import {
  EYES,
  HATS,
  RARITIES,
  RARITY_LABELS,
  RARITY_WEIGHTS,
  SPECIES,
  bruteForce,
  findCurrentSalt,
  matches,
  rollFrom,
} from "./lib/companion.js";
import { findBinaryPath, findConfigPath, getPatchability } from "./lib/runtime.js";

if (typeof Bun === "undefined") {
  console.error("buddy-reroll requires Bun runtime (uses Bun.hash).\nInstall: https://bun.sh");
  process.exit(1);
}

function getUserId(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config.oauthAccount?.accountUuid ?? config.userID ?? "anon";
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readCurrentCompanion(binaryPath, userId) {
  const binaryData = readFileSync(binaryPath);
  const currentSalt = findCurrentSalt(binaryData);
  if (!currentSalt) fail("  ✗ Could not find companion salt in binary.");
  return { currentSalt, currentRoll: rollFrom(currentSalt, userId) };
}

function buildTargetFromArgs(args) {
  const target = {};

  if (args.species) {
    if (!SPECIES.includes(args.species)) fail(`  ✗ Unknown species "${args.species}". Use --list.`);
    target.species = args.species;
  }
  if (args.rarity) {
    if (!RARITIES.includes(args.rarity)) fail(`  ✗ Unknown rarity "${args.rarity}". Use --list.`);
    target.rarity = args.rarity;
  }
  if (args.eye) {
    if (!EYES.includes(args.eye)) fail(`  ✗ Unknown eye "${args.eye}". Use --list.`);
    target.eye = args.eye;
  }
  if (args.hat) {
    if (!HATS.includes(args.hat)) fail(`  ✗ Unknown hat "${args.hat}". Use --list.`);
    target.hat = args.hat;
  }
  if (args.shiny !== undefined) target.shiny = args.shiny;

  return target;
}

function assertPatchable(binaryPath) {
  const patchability = getPatchability(binaryPath);
  if (!patchability.ok) fail(`  ✗ ${patchability.message}`);
  return patchability;
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
  const { currentSalt, currentRoll } = readCurrentCompanion(binaryPath, userId);

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
    getPatchability,
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
    const patchability = assertPatchable(binaryPath);
    const { backupPath } = patchability;
    if (!existsSync(backupPath)) fail(`  ✗ No backup found at ${backupPath}`);

    try {
      copyFileSync(backupPath, binaryPath);
      resignBinary(binaryPath);
      clearCompanion(configPath);
    } catch (err) {
      fail(`  ✗ ${err.message}`);
    }

    console.log("  ✓ Restored. Restart Claude Code and run /buddy.");
    return;
  }

  const { currentSalt, currentRoll } = readCurrentCompanion(binaryPath, userId);

  if (args.current) {
    console.log(`\n  Current companion (salt: ${currentSalt}):`);
    console.log(formatCompanionCard(currentRoll));
    console.log();
    return;
  }

  const target = buildTargetFromArgs(args);
  if (Object.keys(target).length === 0) fail("  ✗ Specify at least one target. Use --help for usage.");

  console.log(`  Target:  ${Object.entries(target).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

  if (matches(currentRoll, target)) {
    console.log("  ✓ Already matches!\n" + formatCompanionCard(currentRoll));
    return;
  }

  const patchability = assertPatchable(binaryPath);

  if (isClaudeRunning()) {
    console.warn("  ⚠ Claude Code appears to be running. Quit it before patching to avoid issues.");
  }

  console.log("  Searching...");
  const found = await bruteForce(userId, target, null);
  if (!found) fail("  ✗ No matching salt found. Try relaxing constraints.");
  console.log(`  ✓ Found in ${found.checked.toLocaleString()} attempts (${(found.elapsed / 1000).toFixed(1)}s)`);
  console.log(formatCompanionCard(found.result));

  const { backupPath } = patchability;
  if (!existsSync(backupPath)) {
    try {
      copyFileSync(binaryPath, backupPath);
      console.log(`\n  Backup:  ${backupPath}`);
    } catch (err) {
      fail(`  ✗ ${err.message}`);
    }
  }

  try {
    const patchCount = patchBinary(binaryPath, currentSalt, found.salt);
    console.log(`  Patched: ${patchCount} occurrence(s)`);
    if (resignBinary(binaryPath)) console.log("  Signed:  ad-hoc codesign ✓");
    clearCompanion(configPath);
    console.log("  Config:  companion data cleared");
    console.log("\n  Done! Restart Claude Code and run /buddy.\n");
  } catch (err) {
    fail(`  ✗ ${err.message}`);
  }
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
  buddy-reroll — Reroll your Claude Code companion (Bun runtime required)

  Usage:
    bunx buddy-reroll                               Interactive mode (recommended)
    bunx buddy-reroll --species dragon --rarity legendary --eye ✦ --shiny
    bunx buddy-reroll --list                        Show all available options
    bunx buddy-reroll --current                     Show current companion
    bunx buddy-reroll --restore                     Restore original binary

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
  if (!binaryPath) fail("✗ Could not find Claude Code binary. Checked PATH and known install locations.");

  const configPath = findConfigPath();
  if (!configPath) fail("✗ Could not find Claude Code config file. Checked ~/.claude/.config.json and ~/.claude.json.");

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
