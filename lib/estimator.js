import { RARITY_WEIGHTS } from "./companion.js";

export function estimateAttempts(target) {
  if (!target || Object.keys(target).length === 0) return 1;

  let probability = 1;

  if (target.species) probability *= 1 / 18;
  if (target.rarity) probability *= RARITY_WEIGHTS[target.rarity] / 100;
  if (target.eye) probability *= 1 / 6;
  if (target.hat && target.hat !== "none" && target.rarity !== "common") probability *= 1 / 8;
  if (target.shiny === true) probability *= 0.01;
  if (target.peak) probability *= 1 / 5;
  if (target.dump) probability *= 1 / 4;

  return Math.round(1 / probability);
}

function formatTime(seconds) {
  if (seconds < 60) return Math.round(seconds) + "s";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return minutes + "m " + secs + "s";
}

function formatRate(rate) {
  if (rate >= 1_000_000) return (rate / 1_000_000).toFixed(1) + "M/s";
  if (rate >= 1_000) return (rate / 1_000).toFixed(1) + "k/s";
  return rate.toFixed(1) + "/s";
}

export function formatProgress(attempts, elapsed, expected, workers) {
  const elapsedSec = elapsed / 1000;
  const rate = attempts / elapsedSec;

  if (attempts >= expected) {
    return `Still searching... ${formatTime(elapsedSec)} | ${formatRate(rate)} | taking longer than usual`;
  }

  const remaining = (expected - attempts) / rate;
  return `Searching... ${formatTime(elapsedSec)} | ${formatRate(rate)} | ~${formatTime(remaining)} left`;
}
