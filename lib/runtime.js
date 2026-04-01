import { accessSync, constants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname, isAbsolute } from "path";
import { homedir, platform } from "os";

const MIN_BINARY_SIZE = 1_000_000;
const MAX_WRAPPER_SIZE = 64 * 1024;
const MAX_RESOLVE_DEPTH = 4;
const SHELL_EXEC_PATTERN = /^\s*exec\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))(?:\s|$)/m;

function isRealBinary(candidatePath) {
  try {
    const stats = statSync(candidatePath);
    return stats.isFile() && stats.size > MIN_BINARY_SIZE;
  } catch {
    return false;
  }
}

export function getClaudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

export function getClaudeBinaryOverride() {
  return process.env.CLAUDE_BINARY_PATH?.trim() || null;
}

function expandShellPath(pathExpression) {
  if (!pathExpression) return null;

  const expanded = pathExpression
    .replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] ?? "");

  if (expanded === "~") return homedir();
  if (expanded.startsWith("~/")) return join(homedir(), expanded.slice(2));
  return isAbsolute(expanded) ? expanded : null;
}

export function resolveClaudeExecutable(candidatePath, depth = 0, visited = new Set()) {
  if (!candidatePath || depth > MAX_RESOLVE_DEPTH) return null;

  const trimmedPath = candidatePath.trim();
  if (!trimmedPath) return null;

  let resolvedPath;
  try {
    resolvedPath = realpathSync(trimmedPath);
  } catch {
    resolvedPath = trimmedPath;
  }

  if (visited.has(resolvedPath)) return null;
  visited.add(resolvedPath);

  if (!existsSync(resolvedPath)) return null;
  if (isRealBinary(resolvedPath)) return resolvedPath;

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile() || stats.size > MAX_WRAPPER_SIZE) return null;

    const script = readFileSync(resolvedPath, "utf-8");
    const execMatch = script.match(SHELL_EXEC_PATTERN);
    if (!execMatch) return null;

    const execTarget = expandShellPath(execMatch[1] ?? execMatch[2] ?? execMatch[3]);
    if (!execTarget) return null;

    return resolveClaudeExecutable(execTarget, depth + 1, visited);
  } catch {
    return null;
  }
}

function getPathCandidates() {
  const isWin = platform() === "win32";
  const override = getClaudeBinaryOverride();

  if (override) return [override];

  try {
    const command = isWin ? "where.exe" : "which";
    const args = isWin ? ["claude"] : ["-a", "claude"];
    return execFileSync(command, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getVersionCandidates() {
  const isWin = platform() === "win32";
  const versionsDirs = [
    join(homedir(), ".local", "share", "claude", "versions"),
    ...(isWin ? [join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Claude", "versions")] : []),
  ];

  const candidates = [];
  for (const entry of versionsDirs) {
    if (!existsSync(entry)) continue;

    try {
      const stats = statSync(entry);
      if (stats.isFile()) {
        candidates.push(entry);
        continue;
      }

      const versions = readdirSync(entry)
        .filter((file) => !file.includes(".backup"))
        .sort();

      if (versions.length > 0) {
        candidates.push(join(entry, versions[versions.length - 1]));
      }
    } catch {}
  }

  return candidates;
}

export function findBinaryPath() {
  const seen = new Set();
  const candidates = [...getPathCandidates(), ...getVersionCandidates()];

  for (const candidate of candidates) {
    const resolved = resolveClaudeExecutable(candidate);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      return resolved;
    }
  }

  return null;
}

export function findConfigPath() {
  const claudeDir = getClaudeConfigDir();

  const legacyPath = join(claudeDir, ".config.json");
  if (existsSync(legacyPath)) return legacyPath;

  const defaultPath = join(homedir(), ".claude.json");
  if (existsSync(defaultPath)) return defaultPath;

  if (platform() === "win32" && process.env.APPDATA) {
    const appDataPath = join(process.env.APPDATA, "Claude", "config.json");
    if (existsSync(appDataPath)) return appDataPath;
  }

  return null;
}

export function getPatchability(binaryPath) {
  if (!binaryPath) {
    return { ok: false, message: "Claude Code binary path is missing.", backupPath: null };
  }

  if (!existsSync(binaryPath)) {
    return { ok: false, message: `Claude Code binary was not found at ${binaryPath}.`, backupPath: null };
  }

  const backupPath = `${binaryPath}.backup`;

  try {
    accessSync(binaryPath, constants.W_OK);
    if (!existsSync(backupPath)) {
      accessSync(dirname(binaryPath), constants.W_OK);
    }
    return { ok: true, message: null, backupPath };
  } catch {
    return {
      ok: false,
      message: `Claude install found at ${binaryPath}, but it is not writable by the current user. buddy-reroll can show the current companion, but reroll and restore require a user-writable Claude install.`,
      backupPath,
    };
  }
}
