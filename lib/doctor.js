import { accessSync, constants, chmodSync, statSync } from "fs";
import { getClaudeBinaryOverride, getClaudeConfigDir, findBinaryPath, findConfigPath, getPatchability } from "./runtime.js";

function buildStatus(binaryPath, configPath, patchability) {
  if (!binaryPath && !configPath) return "missing-binary-and-config";
  if (!binaryPath) return "missing-binary";
  if (!configPath) return "missing-config";
  if (!patchability.ok) return "read-only";
  try {
    accessSync(binaryPath, constants.X_OK);
  } catch {
    return "not-executable";
  }
  return "ready";
}

function buildNextStep(status) {
  switch (status) {
    case "missing-binary-and-config":
      return "Install Claude Code, make sure `claude` is discoverable on PATH, or set `CLAUDE_BINARY_PATH` and `CLAUDE_CONFIG_DIR`.";
    case "missing-binary":
      return "Make sure `claude` is discoverable on PATH or set `CLAUDE_BINARY_PATH` to the real Claude executable.";
    case "missing-config":
      return "Open Claude Code once so it writes config, or point `CLAUDE_CONFIG_DIR` to the correct config directory.";
    case "read-only":
      return "Use a user-writable Claude install, or point `CLAUDE_BINARY_PATH` to a writable Claude binary copy; `--current` can still work with a read-only install.";
    case "not-executable":
      return "Claude binary lost its execute permission (likely from a patch). Run: chmod +x <binary-path>";
    default:
      return "`--current` and reroll commands are ready to run on this machine.";
  }
}

export function getDoctorReport() {
  const binaryOverride = getClaudeBinaryOverride();
  const configDir = getClaudeConfigDir();
  const binaryPath = findBinaryPath();
  const configPath = findConfigPath();
  const patchability = binaryPath
    ? getPatchability(binaryPath)
    : { ok: false, message: "Claude Code binary path is missing.", backupPath: null };
  const status = buildStatus(binaryPath, configPath, patchability);

  return {
    status,
    binaryOverride,
    configDir,
    binaryPath,
    configPath,
    patchability,
    canRunCurrent: Boolean(binaryPath && configPath),
    nextStep: buildNextStep(status),
  };
}

export function formatDoctorReport(report, title = "Doctor report") {
  const lines = [
    title,
    `  Status:          ${report.status}`,
    `  Binary override: ${report.binaryOverride ?? "not set"}`,
    `  Config dir:      ${report.configDir}`,
    `  Binary path:     ${report.binaryPath ?? "not found"}`,
    `  Config path:     ${report.configPath ?? "not found"}`,
    `  Read current:    ${report.canRunCurrent ? "yes" : "no"}`,
  ];

  if (report.binaryPath) {
    lines.push(`  Patchability:    ${report.patchability.ok ? "writable" : "read-only"}`);
    lines.push(`  Backup path:     ${report.patchability.backupPath ?? "not available"}`);
  } else {
    lines.push("  Patchability:    not available");
    lines.push("  Backup path:     not available");
  }

  if (!report.patchability.ok && report.patchability.message) {
    lines.push(`  Note:            ${report.patchability.message}`);
  }

  lines.push(`  Next step:       ${report.nextStep}`);
  return lines.join("\n");
}
