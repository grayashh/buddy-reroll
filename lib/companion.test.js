import { describe, it, expect } from "bun:test";
import { rollFrom, matches, findCurrentSalt } from "./companion.js";

describe("rollFrom", () => {
  it("returns deterministic result for same salt + userId", () => {
    const a = rollFrom("friend-2026-401", "test-user");
    const b = rollFrom("friend-2026-401", "test-user");
    expect(a).toEqual(b);
  });

  it("returns different results for different salts", () => {
    const a = rollFrom("friend-2026-401", "test-user");
    const b = rollFrom("friend-2026-402", "test-user");
    expect(a.species === b.species && a.rarity === b.rarity && a.eye === b.eye).toBe(false);
  });

  it("returns all required fields", () => {
    const result = rollFrom("friend-2026-401", "test-user");
    expect(result).toHaveProperty("rarity");
    expect(result).toHaveProperty("species");
    expect(result).toHaveProperty("eye");
    expect(result).toHaveProperty("hat");
    expect(result).toHaveProperty("shiny");
    expect(result).toHaveProperty("stats");
  });

  it("returns valid rarity", () => {
    const validRarities = ["common", "uncommon", "rare", "epic", "legendary"];
    const result = rollFrom("friend-2026-401", "test-user");
    expect(validRarities).toContain(result.rarity);
  });

  it("common rarity always has hat=none", () => {
    let found = false;
    for (let i = 0; i < 1000 && !found; i++) {
      const salt = String(i).padStart(15, "x");
      const result = rollFrom(salt, "test-user");
      if (result.rarity === "common") {
        expect(result.hat).toBe("none");
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("stats values are within valid range (1-100)", () => {
    const result = rollFrom("friend-2026-401", "test-user");
    for (const value of Object.values(result.stats)) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("matches", () => {
  const roll = { species: "duck", rarity: "common", eye: "·", hat: "none", shiny: false };

  it("matches when target is empty", () => {
    expect(matches(roll, {})).toBe(true);
  });

  it("matches exact species", () => {
    expect(matches(roll, { species: "duck" })).toBe(true);
    expect(matches(roll, { species: "cat" })).toBe(false);
  });

  it("matches partial target", () => {
    expect(matches(roll, { species: "duck", rarity: "common" })).toBe(true);
    expect(matches(roll, { species: "duck", rarity: "rare" })).toBe(false);
  });

  it("matches shiny flag", () => {
    expect(matches(roll, { shiny: false })).toBe(true);
    expect(matches(roll, { shiny: true })).toBe(false);
  });

  it("ignores undefined shiny in target", () => {
    expect(matches(roll, { species: "duck", shiny: undefined })).toBe(true);
  });

  it("matches peak stat", () => {
    const rollWithStats = rollFrom("friend-2026-401", "test-user");
    expect(matches(rollWithStats, { peak: rollWithStats.peak })).toBe(true);
    const otherStats = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"].filter(s => s !== rollWithStats.peak);
    expect(matches(rollWithStats, { peak: otherStats[0] })).toBe(false);
  });

  it("matches dump stat", () => {
    const rollWithStats = rollFrom("friend-2026-401", "test-user");
    expect(matches(rollWithStats, { dump: rollWithStats.dump })).toBe(true);
    const otherStats = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"].filter(s => s !== rollWithStats.dump);
    expect(matches(rollWithStats, { dump: otherStats[0] })).toBe(false);
  });

  it("ignores peak/dump when not in target", () => {
    const rollWithStats = rollFrom("friend-2026-401", "test-user");
    expect(matches(rollWithStats, { species: rollWithStats.species })).toBe(true);
  });
});

describe("rollFrom peak/dump fields", () => {
  it("returns peak and dump stat names", () => {
    const result = rollFrom("friend-2026-401", "test-user");
    const validStats = ["DEBUGGING", "PATIENCE", "CHAOS", "WISDOM", "SNARK"];
    expect(validStats).toContain(result.peak);
    expect(validStats).toContain(result.dump);
    expect(result.peak).not.toBe(result.dump);
  });

  it("peak stat has highest value, dump has lowest", () => {
    const result = rollFrom("friend-2026-401", "test-user");
    expect(result.stats[result.peak]).toBeGreaterThanOrEqual(result.stats[result.dump]);
  });
});

describe("findCurrentSalt", () => {
  const ORIGINAL_SALT = "friend-2026-401";

  it("finds original salt in binary data", () => {
    const data = Buffer.from(`some binary data ${ORIGINAL_SALT} more data`);
    expect(findCurrentSalt(data)).toBe(ORIGINAL_SALT);
  });

  it("finds patched salt (numeric pattern)", () => {
    const patchedSalt = "xxxxxxx00000001";
    const data = Buffer.from(`some binary data "${patchedSalt}" rollRarity more data`);
    expect(findCurrentSalt(data)).toBe(patchedSalt);
  });

  it("finds purely-alphabetic patched salt via context markers", () => {
    const alphaSalt = "zaxZaEwKsjWqmfz";
    const data = Buffer.from(`some data "${alphaSalt}" inspirationSeed more data`);
    expect(findCurrentSalt(data)).toBe(alphaSalt);
  });

  it("returns null when no salt found", () => {
    const data = Buffer.from("no salt here at all");
    expect(findCurrentSalt(data)).toBeNull();
  });
});
