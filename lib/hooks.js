import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const HOOK_COMMAND = "npx buddy-reroll --apply-hook";

const HOOK_ENTRY = {
  hooks: [{ type: "command", command: HOOK_COMMAND }],
};

function isOurHook(entry) {
  if (typeof entry === "string") return entry === HOOK_COMMAND;
  if (entry?.hooks) return entry.hooks.some((h) => h.command === HOOK_COMMAND);
  return false;
}

export function getSettingsPath() {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
}

export function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeSettingsAtomic(settingsPath, obj) {
  const dir = dirname(settingsPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = settingsPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + "\n");
  renameSync(tmpPath, settingsPath);
}

export function writeSettings(settingsPath, obj) {
  writeSettingsAtomic(settingsPath, obj);
}

export function installHook(settingsPath = getSettingsPath()) {
  const settings = readSettings(settingsPath);
  if (!settings) return { installed: false, reason: "settings file is corrupted, not modifying" };

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];

  const existing = settings.hooks.SessionStart.find(isOurHook);
  if (existing && typeof existing === "object") {
    return { installed: false, reason: "already installed" };
  }

  settings.hooks.SessionStart = settings.hooks.SessionStart.filter((e) => !isOurHook(e));
  settings.hooks.SessionStart.push(HOOK_ENTRY);
  writeSettingsAtomic(settingsPath, settings);

  return { installed: true, path: settingsPath };
}

export function removeHook(settingsPath = getSettingsPath()) {
  const settings = readSettings(settingsPath);
  if (!settings) return { removed: false, reason: "settings file is corrupted, not modifying" };

  if (!settings.hooks || !Array.isArray(settings.hooks.SessionStart)) {
    return { removed: false, reason: "not installed" };
  }

  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter((e) => !isOurHook(e));

  if (settings.hooks.SessionStart.length === before) {
    return { removed: false, reason: "not installed" };
  }

  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeSettingsAtomic(settingsPath, settings);
  return { removed: true, path: settingsPath };
}

export function isHookInstalled(settingsPath = getSettingsPath()) {
  const settings = readSettings(settingsPath);
  if (!settings) return false;
  return Array.isArray(settings.hooks?.SessionStart) && settings.hooks.SessionStart.some(isOurHook);
}

export function getSaltStorePath() {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), ".buddy-reroll.json");
}

export function storeSalt(salt) {
  const path = getSaltStorePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ salt, timestamp: Date.now() }, null, 2) + "\n");
}

export function readStoredSalt() {
  const path = getSaltStorePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
