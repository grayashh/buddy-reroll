#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, copyFileSync, renameSync, unlinkSync, statSync, chmodSync } from "fs";
import { platform } from "os";
import { execFileSync, spawnSync } from "child_process";
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
  STAT_NAMES,
  bruteForce,
  findCurrentSalt,
  matches,
  rollFrom,
} from "./lib/companion.js";
import { formatDoctorReport, getDoctorReport } from "./lib/doctor.js";
import { findBinaryPath, findConfigPath, getClaudeBinaryOverride, getPatchability } from "./lib/runtime.js";
import { parallelBruteForce } from "./lib/finder.js";
import { estimateAttempts, formatProgress } from "./lib/estimator.js";
import { installHook, removeHook, storeSalt, readStoredSalt } from "./lib/hooks.js";

const IS_BUN = typeof Bun !== "undefined";
const IS_APPLY_HOOK = process.argv.includes("--apply-hook");

if (!IS_BUN && !IS_APPLY_HOOK) {
  try {
    const cmd = platform() === "win32" ? "where.exe" : "which";
    const bunPath = execFileSync(cmd, ["bun"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
    if (bunPath) {
      const result = spawnSync(bunPath, process.argv.slice(1), { stdio: "inherit" });
      process.exit(result.status ?? 0);
    }
  } catch {}
}

function getUserId(configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  return config.oauthAccount?.accountUuid ?? config.userID ?? "anon";
}

// ── Binary patch ─────────────────────────────────────────────────────────

function isClaudeRunning() {
  try {
    if (platform() === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.toLowerCase().includes("claude.exe");
    }
    const out = execFileSync("pgrep", ["-af", "claude"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").some((line) => !line.includes("buddy-reroll") && line.trim().length > 0);
  } catch {
    return false;
  }
}

function sleepMs(ms) {
  if (typeof Bun !== "undefined") return Bun.sleepSync(ms);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function patchBinary(binaryPath, oldSalt, newSalt) {
  if (oldSalt.length !== newSalt.length) {
    throw new Error(`Salt length mismatch: "${oldSalt}" (${oldSalt.length}) vs "${newSalt}" (${newSalt.length})`);
  }

  const originalMode = statSync(binaryPath).mode;
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
      const tmpPath = binaryPath + ".tmp";
      writeFileSync(tmpPath, data, { mode: originalMode });
      try {
        renameSync(tmpPath, binaryPath);
      } catch {
        if (existsSync(binaryPath + ".backup")) {
          try { unlinkSync(binaryPath); } catch {}
        }
        renameSync(tmpPath, binaryPath);
      }

      chmodSync(binaryPath, originalMode);

      const verify = readFileSync(binaryPath);
      const found = verify.indexOf(Buffer.from(newSalt));
      if (found === -1) throw new Error("Patch verification failed — new salt not found after write");

      return count;
    } catch (err) {
      try { unlinkSync(binaryPath + ".tmp"); } catch {}
      if (isWin && (err.code === "EACCES" || err.code === "EPERM" || err.code === "EBUSY") && attempt < maxRetries - 1) {
        sleepMs(2000);
        continue;
      }
      if (isWin && (err.code === "EPERM" || err.code === "EBUSY")) {
        throw new Error("Can't write — Claude Code might still be running. Close it and try again.");
      }
      throw new Error(`Failed to write: ${err.message}`);
    }
  }
}

function resignBinary(binaryPath) {
  if (platform() !== "darwin") return false;
  try {
    execFileSync("codesign", ["-s", "-", "--force", binaryPath], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return true;
  } catch (err) {
    console.warn(`  ⚠ Code signing failed: ${err.message}\n    Try manually: codesign --force --sign - "${binaryPath}"`);
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
  let currentSalt = findCurrentSalt(binaryData);

  if (!currentSalt) {
    const stored = readStoredSalt();
    if (stored) {
      const storedBuf = Buffer.from(stored.salt);
      if (binaryData.includes(storedBuf)) {
        currentSalt = stored.salt;
      }
    }
  }

  if (!currentSalt) {
    const backupPath = binaryPath + ".backup";
    if (existsSync(backupPath)) {
      console.log("  ⚠ Can't find salt in binary — restoring from backup...");
      try {
        copyFileSync(backupPath, binaryPath);
        resignBinary(binaryPath);
        const restored = readFileSync(binaryPath);
        currentSalt = findCurrentSalt(restored);
        if (currentSalt) console.log("  ✓ Restored successfully.");
      } catch {}
    }
  }

  if (!currentSalt) fail("  ✗ Couldn't read your current buddy from the Claude binary.");
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
  if (args.peak) {
    const p = args.peak.toUpperCase();
    if (!STAT_NAMES.includes(p)) fail(`  ✗ "${args.peak}" isn't a stat. Pick one: ${STAT_NAMES.join(", ")}`);
    target.peak = p;
  }
  if (args.dump) {
    const d = args.dump.toUpperCase();
    if (!STAT_NAMES.includes(d)) fail(`  ✗ "${args.dump}" isn't a stat. Pick one: ${STAT_NAMES.join(", ")}`);
    if (target.peak && d === target.peak) fail("  ✗ Your weakest stat can't be the same as your strongest!");
    target.dump = d;
  }

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

  const uiOpts = {
    currentRoll,
    currentSalt,
    binaryPath,
    configPath,
    userId,
    bruteForce: parallelBruteForce,
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
    STAT_NAMES,
    storeSalt,
    installHook,
  };

  try {
    const { runInteractiveUI } = await import("./ui.jsx");
    await runInteractiveUI(uiOpts);
  } catch {
    const { runInteractiveUI } = await import("./ui-fallback.js");
    await runInteractiveUI(uiOpts);
  }
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

    console.log("  ✓ Restored! Restart Claude Code and say /buddy to see your original friend.");
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
  if (Object.keys(target).length === 0) fail("  ✗ Tell me what kind of buddy you want! Use --help to see options.");

  const patchability = assertPatchable(binaryPath);

  if (matches(currentRoll, target)) {
    console.log("  ✓ Your buddy already looks like that!\n" + formatCompanionCard(currentRoll));
    return;
  }

  const expected = estimateAttempts(target);
  console.log(`  Target:  ${Object.entries(target).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  This might take ~${expected.toLocaleString()} tries\n`);

  if (isClaudeRunning()) {
    console.warn("  ⚠ Claude Code is still running — close it first so the changes stick.");
  }

  console.log("  Looking for your buddy...");
  let found;
  try {
    found = await parallelBruteForce(userId, target, (attempts, elapsed, est, workers) => {
      process.stdout.write(`\r  ${formatProgress(attempts, elapsed, est, workers)}`);
    });
  } catch (err) {
    fail(`\n  ✗ ${err.message}`);
  }
  if (!found) fail("\n  ✗ Couldn't find a match. Try being less picky!");
  console.log(`\n  ✓ Found it! (${found.checked.toLocaleString()} tries, ${(found.elapsed / 1000).toFixed(1)}s)`);
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
    console.log("  Applied ✓");
    if (resignBinary(binaryPath)) console.log("  Re-signed for macOS ✓");
    clearCompanion(configPath);
    storeSalt(found.salt);
    try { installHook(); } catch {}
    console.log("  Cleaned up old buddy data ✓");
    console.log("\n  All set! Your buddy will stick around even after Claude updates.\n  Restart Claude Code and say /buddy to meet your new friend.\n");
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
      peak: { type: "string" },
      dump: { type: "string" },
      list: { type: "boolean", default: false },
      restore: { type: "boolean", default: false },
      current: { type: "boolean", default: false },
      doctor: { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      hook: { type: "boolean", default: false },
      unhook: { type: "boolean", default: false },
      "apply-hook": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: false,
  });

  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
    console.log(`buddy-reroll v${pkg.version}`);
    return;
  }

  if (args.help) {
    console.log(`
  buddy-reroll — Pick the perfect /buddy companion

  Usage:
    buddy-reroll                                     Pick your buddy (interactive)
    buddy-reroll --species dragon --rarity legendary --eye ✦ --shiny
    buddy-reroll --list                              See all options
    buddy-reroll --current                           Show current buddy
    buddy-reroll --doctor                            Check setup
    buddy-reroll --restore                           Undo changes
    buddy-reroll --unhook                            Stop auto-keeping after updates

  Appearance (all optional — skip to leave random):
    --species <name>    ${SPECIES.join(", ")}
    --rarity <name>     ${RARITIES.join(", ")}
    --eye <char>        ${EYES.join(" ")}
    --hat <name>        ${HATS.join(", ")}
    --shiny / --no-shiny

  Stats (optional):
    --peak <stat>       Best at: ${STAT_NAMES.join(", ")}
    --dump <stat>       Worst at (can't match peak)

  Other:
    --version, -v
`);
    return;
  }

  if (args.hook) {
    const result = installHook();
    if (result.installed) console.log(`✓ Got it — your buddy will survive Claude updates now.\n  Settings: ${result.path}`);
    else console.log("  Already set up!");
    return;
  }

  if (args.unhook) {
    const result = removeHook();
    if (result.removed) console.log("✓ Removed — your buddy won't be kept after updates anymore.");
    else console.log("  Nothing to remove.");
    return;
  }

  if (args["apply-hook"]) {
    try {
      const stored = readStoredSalt();
      if (!stored) process.exit(0);
      const bp = findBinaryPath();
      const cp = findConfigPath();
      if (!bp || !cp) process.exit(0);
      const uid = getUserId(cp);
      const binaryData = readFileSync(bp);
      const currentSalt = findCurrentSalt(binaryData);
      if (!currentSalt) process.exit(0);
      if (currentSalt === stored.salt) process.exit(0);
      const patchability = getPatchability(bp);
      if (!patchability.ok) process.exit(0);
      const backupPath = patchability.backupPath;
      if (!existsSync(backupPath)) copyFileSync(bp, backupPath);
      patchBinary(bp, currentSalt, stored.salt);
      if (platform() === "darwin") {
        try {
          execFileSync("codesign", ["-s", "-", "--force", bp], { stdio: "ignore", timeout: 30000 });
        } catch {
          copyFileSync(backupPath, bp);
          process.exit(1);
        }
      }
      clearCompanion(cp);
    } catch {}
    process.exit(0);
  }

  if (args.doctor) {
    const report = getDoctorReport();
    if (report.status === "not-executable" && report.binaryPath) {
      try {
        const { chmodSync, statSync } = await import("fs");
        const mode = statSync(report.binaryPath).mode | 0o111;
        chmodSync(report.binaryPath, mode);
        console.log(`\n  ✓ Fixed: restored execute permission on ${report.binaryPath}`);
        const fixed = getDoctorReport();
        console.log(`\n${formatDoctorReport(fixed, "buddy-reroll doctor")}\n`);
      } catch (err) {
        console.log(`\n${formatDoctorReport(report, "buddy-reroll doctor")}\n`);
        console.log(`  ⚠ Auto-fix failed: ${err.message}\n    Run manually: chmod +x "${report.binaryPath}"\n`);
      }
    } else {
      console.log(`\n${formatDoctorReport(report, "buddy-reroll doctor")}\n`);
    }
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
    const override = getClaudeBinaryOverride();
    if (override) fail(`✗ CLAUDE_BINARY_PATH is set to "${override}" but no valid Claude binary was found at that path.`);
    fail("✗ Could not find Claude Code binary. Checked PATH and known install locations.");
  }

  const configPath = findConfigPath();
  if (!configPath) fail("✗ Could not find Claude Code config file. Checked ~/.claude/.config.json and ~/.claude.json.");

  const userId = getUserId(configPath);
  if (userId === "anon") {
    console.warn("⚠ No user ID found — using anonymous. Your buddy might change when you log in.");
  }

  const hasTargetFlags = args.species || args.rarity || args.eye || args.hat || args.shiny !== undefined || args.peak || args.dump;
  const isCommand = args.restore || args.current || args.doctor || args.hook || args.unhook || args["apply-hook"];

  if (!hasTargetFlags && !isCommand) {
    await interactiveMode(binaryPath, configPath, userId);
  } else {
    await nonInteractiveMode(args, binaryPath, configPath, userId);
  }
}

main();
