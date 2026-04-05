import { describe, it, expect } from "bun:test";
import { estimateAttempts, formatProgress } from "./estimator.js";

describe("estimateAttempts", () => {
  it("returns 1 for empty target", () => {
    expect(estimateAttempts({})).toBe(1);
  });

  it("returns 18 for species only", () => {
    expect(estimateAttempts({ species: "duck" })).toBe(18);
  });

  it("returns 30 for species + common rarity", () => {
    expect(estimateAttempts({ species: "duck", rarity: "common" })).toBe(30);
  });

  it("returns 1800 for species + legendary rarity", () => {
    expect(estimateAttempts({ species: "duck", rarity: "legendary" })).toBe(1800);
  });

  it("returns 180 for species + rarity + eye", () => {
    expect(estimateAttempts({ species: "duck", rarity: "common", eye: "·" })).toBe(180);
  });

  it("returns 3456 for species + rarity + eye + hat (non-common)", () => {
    expect(estimateAttempts({ species: "duck", rarity: "uncommon", eye: "·", hat: "crown" })).toBe(3456);
  });

  it("returns 1800 for shiny only", () => {
    expect(estimateAttempts({ shiny: true })).toBe(100);
  });

  it("returns 5 for peak only", () => {
    expect(estimateAttempts({ peak: "DEBUGGING" })).toBe(5);
  });

  it("returns 4 for dump only", () => {
    expect(estimateAttempts({ dump: "DEBUGGING" })).toBe(4);
  });

  it("returns large number for full combo", () => {
    const result = estimateAttempts({
      species: "dragon",
      rarity: "legendary",
      eye: "✦",
      hat: "propeller",
      shiny: true,
      peak: "WISDOM",
      dump: "SNARK",
    });
    expect(result).toBeGreaterThan(1_000_000);
  });

  it("does not multiply by hat for common rarity", () => {
    const withoutHat = estimateAttempts({ species: "duck", rarity: "common" });
    const withHat = estimateAttempts({ species: "duck", rarity: "common", hat: "none" });
    expect(withoutHat).toBe(withHat);
  });
});

describe("formatProgress", () => {
  it("shows elapsed time and rate", () => {
    const result = formatProgress(5_000_000, 2000, 10_000_000, 8);
    expect(result).toContain("Searching...");
    expect(result).toContain("2s");
    expect(result).toContain("2.5M/s");
  });

  it("shows ETA when under expected", () => {
    const result = formatProgress(50_000, 5000, 100_000, 4);
    expect(result).toContain("Searching...");
    expect(result).toContain("left");
  });

  it("formats ETA in minutes and seconds", () => {
    const result = formatProgress(1_000_000, 1000, 100_000_000, 8);
    expect(result).toContain("m");
    expect(result).toContain("left");
  });

  it("shows 'taking longer than usual' past expected", () => {
    const result = formatProgress(10_000_000, 2000, 10_000_000, 8);
    expect(result).toContain("Still searching...");
    expect(result).toContain("taking longer than usual");
    expect(result).not.toContain("left");
  });

  it("shows 'taking longer than usual' well past expected", () => {
    const result = formatProgress(30_000_000, 6000, 10_000_000, 8);
    expect(result).toContain("Still searching...");
    expect(result).toContain("6s");
  });

  it("handles very small elapsed time", () => {
    const result = formatProgress(1_000_000, 1, 10_000_000, 8);
    expect(result).toContain("Searching...");
    expect(result).toContain("/s");
  });
});
