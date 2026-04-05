import { select, confirm } from "@inquirer/prompts";
import { existsSync, copyFileSync } from "fs";
import chalk from "chalk";
import { renderSprite, colorizeSprite, RARITY_STARS, RARITY_COLORS } from "./sprites.js";

function printSprite(roll) {
  const sprite = renderSprite({ species: roll.species, eye: roll.eye, hat: roll.hat });
  const colored = colorizeSprite(sprite, roll.rarity);
  const colorFn = chalk[RARITY_COLORS[roll.rarity]] ?? chalk.white;
  const stars = RARITY_STARS[roll.rarity] ?? "";

  console.log("");
  for (const line of colored) console.log(`  ${line}`);
  console.log(`  ${chalk.bold(roll.species)} / ${colorFn(roll.rarity)}${roll.shiny ? " / ✦shiny" : ""}`);
  console.log(`  eye:${roll.eye} hat:${roll.hat}  ${stars}`);

  if (roll.stats) {
    console.log("");
    for (const [k, v] of Object.entries(roll.stats)) {
      const filled = Math.min(10, Math.max(0, Math.round(v / 10)));
      const bar = colorFn("█".repeat(filled)) + chalk.dim("░".repeat(10 - filled));
      console.log(`  ${k.padEnd(10)} ${bar} ${String(v).padStart(3)}`);
    }
  }
  console.log("");
}

export async function runInteractiveUI(opts) {
  const {
    currentRoll, currentSalt, binaryPath, configPath, userId,
    bruteForce, patchBinary, resignBinary, clearCompanion, getPatchability, isClaudeRunning,
    rollFrom, matches, SPECIES, RARITIES, RARITY_LABELS, EYES, HATS, STAT_NAMES,
    storeSalt, installHook,
  } = opts;

  console.log(chalk.bold.dim("\n  buddy-reroll\n"));
  printSprite(currentRoll);

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Pick a new buddy", value: "reroll" },
      { name: "Go back to default", value: "restore" },
      { name: "See my buddy", value: "current" },
    ],
  });

  if (action === "current") {
    console.log(chalk.green("✓ That's your buddy!"));
    return;
  }

  if (action === "restore") {
    const patchability = getPatchability(binaryPath);
    if (!patchability.ok) {
      console.log(chalk.red(`✗ ${patchability.message}`));
      return;
    }
    const { backupPath } = patchability;
    if (!existsSync(backupPath)) {
      console.log(chalk.yellow("No backup found. Nothing to restore."));
      return;
    }
    try {
      copyFileSync(backupPath, binaryPath);
      resignBinary(binaryPath);
      clearCompanion(configPath);
      console.log(chalk.green("✓ Restored! Restart Claude Code and say /buddy to see your original friend."));
    } catch (err) {
      console.log(chalk.red(`✗ ${err.message}`));
    }
    return;
  }

  const species = await select({
    message: "Species",
    choices: SPECIES.map((s) => ({ name: s, value: s })),
    default: currentRoll.species,
  });

  const rarity = await select({
    message: "Rarity",
    choices: RARITIES.map((r) => ({ name: RARITY_LABELS[r], value: r })),
    default: currentRoll.rarity,
  });

  const eye = await select({
    message: "Eye",
    choices: EYES.map((e) => ({ name: e, value: e })),
    default: currentRoll.eye,
  });

  let hat = "none";
  if (rarity !== "common") {
    hat = await select({
      message: "Hat",
      choices: HATS.map((h) => ({ name: h, value: h })),
      default: currentRoll.hat === "none" ? "crown" : currentRoll.hat,
    });
  }

  const shiny = await confirm({ message: "Shiny?", default: false });

  let peak = null;
  let dump = null;
  if (STAT_NAMES) {
    const wantStats = await confirm({ message: "Choose your buddy's strong and weak stats?", default: false });
    if (wantStats) {
      peak = await select({
        message: "Best at",
        choices: [
          { name: "Surprise me!", value: null },
          ...STAT_NAMES.map((s) => ({ name: s, value: s })),
        ],
      });
      if (peak) {
        dump = await select({
          message: "Worst at",
          choices: [
            { name: "Surprise me!", value: null },
            ...STAT_NAMES.filter((s) => s !== peak).map((s) => ({ name: s, value: s })),
          ],
        });
      }
    }
  }

  const preview = { species, rarity, eye, hat, shiny, stats: null };
  printSprite(preview);

  const target = { species, rarity, eye, hat: rarity === "common" ? "none" : hat };
  if (shiny) target.shiny = true;
  if (peak) target.peak = peak;
  if (dump) target.dump = dump;

  if (matches(currentRoll, target)) {
    console.log(chalk.green("✓ Your buddy already looks like that!"));
    return;
  }

  const patchability = getPatchability(binaryPath);
  if (!patchability.ok) {
    console.log(chalk.red(`✗ ${patchability.message}`));
    return;
  }

  if (isClaudeRunning()) {
    console.log(chalk.yellow("⚠ Claude Code is still running — close it first so the changes stick."));
  }

  const proceed = await confirm({ message: "Let's go?", default: true });
  if (!proceed) return;

  console.log("  Looking for your buddy...");
  let found;
  try {
    found = await bruteForce(userId, target, (attempts, elapsed, expected, workers) => {
      const elapsedSec = elapsed / 1000;
      const rate = attempts / elapsedSec;
      const rateStr = rate >= 1e6 ? `${(rate / 1e6).toFixed(1)}M/s` : `${(rate / 1e3).toFixed(1)}k/s`;
      const fmtTime = (s) => s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
      if (attempts >= expected) {
        process.stdout.write(`\r  Still searching... ${fmtTime(elapsedSec)} | ${rateStr} | taking longer than usual`);
      } else {
        const remaining = (expected - attempts) / rate;
        process.stdout.write(`\r  Searching... ${fmtTime(elapsedSec)} | ${rateStr} | ~${fmtTime(remaining)} left`);
      }
    });
  } catch (err) {
    console.log(chalk.red(`\n✗ ${err.message}`));
    return;
  }

  if (!found) {
    console.log(chalk.red("\n✗ Couldn't find a match. Try being less picky!"));
    return;
  }

  console.log(chalk.green(`\n✓ Found your buddy! (${found.checked.toLocaleString()} tries, ${(found.elapsed / 1000).toFixed(1)}s)`));
  printSprite(found.result);

  const { backupPath } = patchability;
  try {
    if (!existsSync(backupPath)) {
      copyFileSync(binaryPath, backupPath);
      console.log(`  Backup saved to ${backupPath}`);
    }
    patchBinary(binaryPath, currentSalt, found.salt);
    console.log("  Applied ✓");
    if (resignBinary(binaryPath)) console.log("  Re-signed for macOS ✓");
    clearCompanion(configPath);
    console.log("  Cleaned up old buddy data ✓");
    if (storeSalt) storeSalt(found.salt);
    if (installHook) installHook();
    console.log(chalk.bold("\n  All set! Your buddy will stick around even after Claude updates.\n  Restart Claude Code and say /buddy to meet your new friend.\n"));
  } catch (err) {
    console.log(chalk.red(`\n✗ ${err.message}`));
  }
}
