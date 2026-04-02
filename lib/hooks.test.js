import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { realpathSync } from "fs";
import {
  readSettings,
  writeSettings,
  installHook,
  removeHook,
  isHookInstalled,
  storeSalt,
  readStoredSalt,
} from "./hooks.js";

const HOOK_COMMAND = "npx buddy-reroll --apply-hook";

function findOurHook(settings) {
  const entries = settings.hooks?.SessionStart ?? [];
  return entries.find(
    (e) => typeof e === "object" && e.hooks?.some((h) => h.command === HOOK_COMMAND)
  );
}

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(realpathSync(tmpdir()), "buddy-reroll-test-"));
  process.env.CLAUDE_CONFIG_DIR = tempDir;
});

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("readSettings", () => {
  it("returns empty object when file doesn't exist", () => {
    expect(readSettings(join(tempDir, "settings.json"))).toEqual({});
  });

  it("parses valid JSON file", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { permissions: { allow: [] } });
    expect(readSettings(p)).toEqual({ permissions: { allow: [] } });
  });

  it("returns empty object for corrupted JSON", () => {
    const p = join(tempDir, "settings.json");
    writeFileSync(p, "{ invalid json");
    expect(readSettings(p)).toEqual({});
  });
});

describe("writeSettings", () => {
  it("creates parent directories if needed", () => {
    const p = join(tempDir, "nested", "dir", "settings.json");
    writeSettings(p, { test: true });
    expect(readSettings(p)).toEqual({ test: true });
  });

  it("writes JSON with 2-space indent and trailing newline", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { a: 1 });
    const content = readFileSync(p, "utf-8");
    expect(content).toContain("  ");
    expect(content.endsWith("\n")).toBe(true);
  });
});

describe("installHook", () => {
  it("creates settings.json with correct hook format", () => {
    const p = join(tempDir, "settings.json");
    const result = installHook(p);
    expect(result.installed).toBe(true);
    const settings = readSettings(p);
    const hook = findOurHook(settings);
    expect(hook).toBeDefined();
    expect(hook.matcher).toBe("");
    expect(hook.hooks[0].type).toBe("command");
    expect(hook.hooks[0].command).toBe(HOOK_COMMAND);
  });

  it("adds hook to existing settings without clobbering", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { permissions: { allow: ["test"] } });
    installHook(p);
    const settings = readSettings(p);
    expect(settings.permissions).toEqual({ allow: ["test"] });
    expect(findOurHook(settings)).toBeDefined();
  });

  it("is idempotent", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    const result = installHook(p);
    expect(result.installed).toBe(false);
    expect(result.reason).toBe("already installed");
    const settings = readSettings(p);
    const hooks = settings.hooks.SessionStart.filter(
      (e) => typeof e === "object" && e.hooks?.some((h) => h.command === HOOK_COMMAND)
    );
    expect(hooks.length).toBe(1);
  });

  it("migrates old string-format hook to new format", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { hooks: { SessionStart: [HOOK_COMMAND] } });
    installHook(p);
    const settings = readSettings(p);
    const strings = settings.hooks.SessionStart.filter((e) => typeof e === "string");
    expect(strings.length).toBe(0);
    expect(findOurHook(settings)).toBeDefined();
  });

  it("preserves other hooks in SessionStart array", () => {
    const p = join(tempDir, "settings.json");
    const otherHook = { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] };
    writeSettings(p, { hooks: { SessionStart: [otherHook] } });
    installHook(p);
    const settings = readSettings(p);
    expect(settings.hooks.SessionStart.length).toBe(2);
    expect(settings.hooks.SessionStart[0]).toEqual(otherHook);
  });
});

describe("removeHook", () => {
  it("removes hook", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    const result = removeHook(p);
    expect(result.removed).toBe(true);
    expect(findOurHook(readSettings(p))).toBeUndefined();
  });

  it("removes old string-format hook too", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { hooks: { SessionStart: [HOOK_COMMAND] } });
    const result = removeHook(p);
    expect(result.removed).toBe(true);
  });

  it("deletes empty SessionStart and hooks", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    removeHook(p);
    const settings = readSettings(p);
    expect(settings.hooks).toBeUndefined();
  });

  it("returns false when not installed", () => {
    const p = join(tempDir, "settings.json");
    expect(removeHook(p).removed).toBe(false);
  });

  it("preserves other hooks", () => {
    const p = join(tempDir, "settings.json");
    const otherHook = { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] };
    writeSettings(p, { hooks: { SessionStart: [otherHook, HOOK_COMMAND] } });
    removeHook(p);
    const settings = readSettings(p);
    expect(settings.hooks.SessionStart).toEqual([otherHook]);
  });

  it("preserves other hook types", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    const settings = readSettings(p);
    settings.hooks.PostToolUse = [{ matcher: "Edit", hooks: [{ type: "command", command: "lint" }] }];
    writeSettings(p, settings);
    removeHook(p);
    const after = readSettings(p);
    expect(after.hooks.PostToolUse).toBeDefined();
  });
});

describe("isHookInstalled", () => {
  it("true after install", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    expect(isHookInstalled(p)).toBe(true);
  });

  it("false after remove", () => {
    const p = join(tempDir, "settings.json");
    installHook(p);
    removeHook(p);
    expect(isHookInstalled(p)).toBe(false);
  });

  it("false when no file", () => {
    expect(isHookInstalled(join(tempDir, "settings.json"))).toBe(false);
  });

  it("detects old string-format as installed", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, { hooks: { SessionStart: [HOOK_COMMAND] } });
    expect(isHookInstalled(p)).toBe(true);
  });
});

describe("storeSalt and readStoredSalt", () => {
  it("roundtrips salt", () => {
    storeSalt("test-salt");
    const stored = readStoredSalt();
    expect(stored.salt).toBe("test-salt");
    expect(stored.timestamp).toBeGreaterThan(0);
  });

  it("returns null when missing", () => {
    expect(readStoredSalt()).toBeNull();
  });

  it("returns null for corrupted file", () => {
    writeFileSync(join(tempDir, ".buddy-reroll.json"), "broken");
    expect(readStoredSalt()).toBeNull();
  });
});

describe("integration", () => {
  it("preserves complex settings through install and remove", () => {
    const p = join(tempDir, "settings.json");
    writeSettings(p, {
      permissions: { allow: ["some-permission"] },
      other: { nested: { value: 42 } },
    });
    installHook(p);
    const after = readSettings(p);
    expect(after.permissions).toEqual({ allow: ["some-permission"] });
    expect(after.other).toEqual({ nested: { value: 42 } });
    expect(findOurHook(after)).toBeDefined();

    removeHook(p);
    const final = readSettings(p);
    expect(final.permissions).toEqual({ allow: ["some-permission"] });
    expect(final.hooks).toBeUndefined();
  });
});
