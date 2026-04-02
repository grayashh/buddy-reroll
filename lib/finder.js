import { spawn } from "child_process";
import { cpus } from "os";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { estimateAttempts } from "./estimator.js";
import { rollFrom } from "./companion.js";

const WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "worker.js");

export async function parallelBruteForce(userId, target, onProgress, signal) {
  const numWorkers = Math.max(1, Math.min(cpus().length, 8));
  const expected = estimateAttempts(target);

  return new Promise((resolve, reject) => {
    const children = [];
    const workerStdout = [];
    const workerStderr = [];
    const workerAttempts = [];
    let resolved = false;
    let exited = 0;
    let timer;

    function finish(fn, val) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      killAll();
      fn(val);
    }

    function killAll() {
      for (const child of children) {
        try { child.kill("SIGKILL"); } catch {}
      }
    }

    if (signal?.aborted) { reject(new Error("Cancelled")); return; }
    signal?.addEventListener("abort", () => finish(reject, new Error("Cancelled")), { once: true });

    for (let i = 0; i < numWorkers; i++) {
      workerStdout[i] = "";
      workerStderr[i] = "";
      workerAttempts[i] = 0;

      const child = spawn(process.execPath, [WORKER_SCRIPT, userId, JSON.stringify(target)], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);

      child.stdout.on("data", (chunk) => {
        workerStdout[i] += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        workerStderr[i] += text;
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const progress = JSON.parse(line);
            if (progress.attempts) {
              workerAttempts[i] = progress.attempts;
              const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
              const elapsed = progress.elapsed || 0;
              if (onProgress) onProgress(totalAttempts, elapsed, expected, numWorkers);
            }
          } catch {}
        }
      });

      child.on("close", (code) => {
        exited++;
        if (resolved) return;

        if (code === 0 && workerStdout[i].trim()) {
          try {
            const result = JSON.parse(workerStdout[i].trim());
            const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
            const roll = rollFrom(result.salt, userId);
            finish(resolve, {
              salt: result.salt,
              result: roll,
              checked: Math.max(totalAttempts, result.attempts),
              elapsed: result.elapsed,
              workers: numWorkers,
            });
          } catch (err) {
            finish(reject, err);
          }
          return;
        }

        if (exited === numWorkers) {
          const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
          const stderr = workerStderr.filter(Boolean).join("\n").trim();
          const detail = stderr ? `\n  Worker output: ${stderr.slice(0, 200)}` : "";
          finish(reject, new Error(`All ${numWorkers} workers exited without finding a match (${totalAttempts.toLocaleString()} tries).${detail}`));
        }
      });

      child.on("error", (err) => {
        exited++;
        if (exited === numWorkers && !resolved) {
          finish(reject, new Error(`Worker failed to start: ${err.message}`));
        }
      });
    }

    const timeoutMs = Math.max(600_000, Math.ceil(expected / 50_000_000) * 60_000 + 600_000);
    timer = setTimeout(() => {
      const totalAttempts = workerAttempts.reduce((a, b) => a + b, 0);
      finish(reject, new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s (${totalAttempts.toLocaleString()} tries). This combination might be extremely rare — try fewer constraints.`));
    }, timeoutMs);
  });
}
