import React, { useState, useEffect, useRef, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import { renderSprite, RARITY_STARS, RARITY_COLORS } from "./sprites.js";
import { existsSync, copyFileSync } from "fs";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function Spinner({ label }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text><Text color="cyan">{SPINNER_FRAMES[frame]}</Text> {label}</Text>;
}

// ── Components ──────────────────────────────────────────────────────────

function KeyHint({ children }) {
  return <Text italic dimColor>{children}</Text>;
}

function ListSelect({ label, options, defaultValue, onChange, onSubmit, onBack, isActive }) {
  const [idx, setIdx] = useState(() => Math.max(0, options.findIndex((o) => o.value === defaultValue)));

  useInput((input, key) => {
    if (key.escape && onBack) { onBack(); return; }
    if (key.upArrow || key.leftArrow) {
      const next = (idx - 1 + options.length) % options.length;
      setIdx(next);
      if (onChange) onChange(options[next].value);
    }
    if (key.downArrow || key.rightArrow) {
      const next = (idx + 1) % options.length;
      setIdx(next);
      if (onChange) onChange(options[next].value);
    }
    if (key.return) onSubmit(options[idx].value);
  }, { isActive: isActive !== false });

  return (
    <Box flexDirection="column">
      {label && <Text bold>{label}</Text>}
      {options.map((opt, i) => (
        <Text key={opt.value}>
          <Text color={i === idx ? "cyan" : undefined}>
            {i === idx ? "❯ " : "  "}{opt.label}
          </Text>
          {opt.hint && <Text dimColor> ({opt.hint})</Text>}
        </Text>
      ))}
      <KeyHint>{onBack ? "↑↓ select · enter confirm · esc back" : "↑↓ select · enter confirm"}</KeyHint>
    </Box>
  );
}

function ConfirmSelect({ label, onConfirm, onCancel, onBack, isActive }) {
  const [idx, setIdx] = useState(0);
  const options = [
    { label: "Yes", value: true },
    { label: "No", value: false },
  ];

  useInput((input, key) => {
    if (key.escape && onBack) { onBack(); return; }
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      setIdx(idx === 0 ? 1 : 0);
    }
    if (key.return) {
      if (options[idx].value) onConfirm();
      else onCancel();
    }
  }, { isActive: isActive !== false });

  return (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      <Box gap={2}>
        {options.map((opt, i) => (
          <Text key={opt.label} color={i === idx ? "cyan" : undefined}>
            {i === idx ? "❯ " : "  "}{opt.label}
          </Text>
        ))}
      </Box>
      <KeyHint>{onBack ? "←→ select · enter confirm · esc back" : "←→ select · enter confirm"}</KeyHint>
    </Box>
  );
}

function PreviewCard({ species, rarity, eye, hat, shiny, stats }) {
  const color = RARITY_COLORS[rarity] ?? "white";
  const stars = RARITY_STARS[rarity] ?? "";
  const sprite = renderSprite({ species, eye, hat });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box>
        <Box flexDirection="column">
          {sprite.map((line, lineIdx) => (
            <Text key={`sprite-${lineIdx}-${line.trim()}`} color={color}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text bold>{species}</Text>
          <Text color={color}>{rarity}{shiny ? " ✦shiny" : ""}</Text>
          <Text dimColor>eye:{eye} hat:{hat}</Text>
          <Text>{stars}</Text>
        </Box>
      </Box>
      {stats && (
        <Box flexDirection="column" marginTop={1}>
          {Object.entries(stats).map(([k, v]) => {
            const filled = Math.min(10, Math.max(0, Math.round(v / 10)));
            return (
              <Text key={k}>
                <Text>{k.padEnd(10)} </Text>
                <Text color={color}>{"█".repeat(filled)}</Text>
                <Text dimColor>{"░".repeat(10 - filled)}</Text>
                <Text> {String(v).padStart(3)}</Text>
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function ExitOnKey({ isActive, children }) {
  const { exit } = useApp();
  const exiting = useRef(false);

  const doExit = useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    exit();
    setTimeout(() => process.exit(0), 200);
  }, [exit]);

  useInput(() => doExit(), { isActive });

  useEffect(() => {
    if (!isActive) return;
    const fallback = () => doExit();
    process.stdin.once("data", fallback);
    const timer = setTimeout(() => doExit(), 30000);
    return () => {
      process.stdin.removeListener("data", fallback);
      clearTimeout(timer);
    };
  }, [isActive, doExit]);

  return children;
}

function ShowCurrentStep({ isActive }) {
  return (
    <ExitOnKey isActive={isActive}>
      <Box flexDirection="column">
        <Text color="green">✓ Current companion shown above.</Text>
        <KeyHint>Press any key to exit</KeyHint>
      </Box>
    </ExitOnKey>
  );
}

function SpeciesStep({ speciesList, current, onChange, onSubmit, onBack, isActive }) {
  const [idx, setIdx] = useState(Math.max(0, speciesList.indexOf(current)));

  useInput((input, key) => {
    if (key.escape && onBack) { onBack(); return; }
    if (key.leftArrow || key.upArrow) {
      const next = (idx - 1 + speciesList.length) % speciesList.length;
      setIdx(next);
      onChange(speciesList[next]);
    }
    if (key.rightArrow || key.downArrow) {
      const next = (idx + 1) % speciesList.length;
      setIdx(next);
      onChange(speciesList[next]);
    }
    if (key.return) onSubmit();
  }, { isActive });

  return (
    <Box flexDirection="column">
      <Text bold>Species: <Text color="cyan">{speciesList[idx]}</Text> <Text dimColor>({idx + 1}/{speciesList.length})</Text></Text>
      <KeyHint>←→ browse · enter select · esc back</KeyHint>
    </Box>
  );
}

function SearchStep({ userId, target, bruteForce, onFound, onFail, isActive }) {
  const [progress, setProgress] = useState("");
  const abortRef = useRef(null);
  const hasStarted = useRef(false);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape) {
      if (abortRef.current) abortRef.current.abort();
      exit();
      setTimeout(() => process.exit(0), 200);
    }
  }, { isActive });

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      let found;
      try {
        found = await bruteForce(userId, target, (attempts, elapsed, expected, workers) => {
          if (!ac.signal.aborted) {
            const pct = Math.min(100, Math.round((attempts / expected) * 100));
            const rate = attempts / (elapsed / 1000);
            const rateStr = rate >= 1e6 ? `${(rate / 1e6).toFixed(1)}M` : `${(rate / 1e3).toFixed(1)}k`;
            const eta = Math.max(0, (expected - attempts) / rate);
            setProgress(`${pct}% | ${rateStr} tries/s | ~${Math.round(eta)}s left | ${workers} cores`);
          }
        }, ac.signal);
      } catch {
        if (!ac.signal.aborted) onFail();
        return;
      }
      if (ac.signal.aborted) return;
      if (found) onFound(found);
      else onFail();
    })();
    return () => ac.abort();
  }, [bruteForce, userId, target, onFound, onFail]);

  return (
    <Box flexDirection="column">
      <Spinner label={progress || "Looking for your buddy..."} />
      <KeyHint>esc to cancel</KeyHint>
    </Box>
  );
}

function DoneStep({ messages, isActive }) {
  const hasErrors = messages.some((msg) => msg.type === "error");

  return (
    <ExitOnKey isActive={isActive}>
      <Box flexDirection="column">
        {messages.map((msg) => (
          <Text key={`${msg.type}-${msg.text}`} color={msg.type === "error" ? "red" : "green"}>
            {msg.type === "error" ? "✗ " : "✓ "}{msg.text}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text bold>
            {hasErrors
              ? "Something went wrong — check the issue above and try again."
              : "All set! Your buddy will stick around even after updates. Restart Claude Code and say /buddy!"}
          </Text>
        </Box>
        <KeyHint>Press any key to exit</KeyHint>
      </Box>
    </ExitOnKey>
  );
}

const STEP_ORDER = ["action", "species", "rarity", "eye", "hat", "shiny", "peak", "dump", "confirm"];

function getPrevStep(current, rarity, peak) {
  const idx = STEP_ORDER.indexOf(current);
  if (idx <= 0) return null;
  let prev = STEP_ORDER[idx - 1];
  if (prev === "hat" && rarity === "common") prev = "eye";
  if (prev === "dump" && !peak) prev = "peak";
  return prev;
}

function App({ opts }) {
  const { exit } = useApp();
  const {
    currentRoll, currentSalt, binaryPath, configPath, userId,
    bruteForce, patchBinary, resignBinary, clearCompanion, getPatchability, isClaudeRunning,
    rollFrom, matches, SPECIES, RARITIES, RARITY_LABELS, EYES, HATS, STAT_NAMES,
    storeSalt, installHook,
  } = opts;

  const [step, setStep] = useState("action");
  const [species, setSpecies] = useState(currentRoll.species);
  const [rarity, setRarity] = useState(currentRoll.rarity);
  const [eye, setEye] = useState(currentRoll.eye);
  const [hat, setHat] = useState(currentRoll.hat);
  const [shiny, setShiny] = useState(currentRoll.shiny);
  const [peak, setPeak] = useState(null);
  const [dump, setDump] = useState(null);
  const [found, setFound] = useState(null);
  const [doneMessages, setDoneMessages] = useState([]);

  const showStats = step === "showCurrent" || step === "result" || step === "done";
  const displayRoll = found ? found.result : { species, rarity, eye, hat, shiny, stats: currentRoll.stats };
  const effectiveHat = rarity === "common" ? "none" : hat;
  const buildTarget = (s = shiny) => {
    const t = { species, rarity, eye, hat: effectiveHat, shiny: s };
    if (peak) t.peak = peak;
    if (dump) t.dump = dump;
    return t;
  };

  const goBack = (toStep) => {
    const prev = toStep || getPrevStep(step, rarity, peak);
    if (prev) setStep(prev);
    else exit();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold dimColor>buddy-reroll</Text>

      <PreviewCard
        species={displayRoll.species}
        rarity={displayRoll.rarity}
        eye={displayRoll.eye}
        hat={displayRoll.hat}
        shiny={displayRoll.shiny}
        stats={showStats ? displayRoll.stats : null}
      />

      <Box marginTop={1}>
        {step === "action" && (
          <ListSelect
            label="What would you like to do?"
            options={[
              { label: "Reroll companion", value: "reroll" },
              { label: "Restore original", value: "restore" },
              { label: "Show current", value: "current" },
            ]}
            isActive={step === "action"}
            onSubmit={(action) => {
              if (action === "current") {
                setStep("showCurrent");
              } else if (action === "restore") {
                const patchability = getPatchability(binaryPath);
                if (!patchability.ok) {
                  setDoneMessages([{ type: "error", text: patchability.message }]);
                  setStep("done");
                  return;
                }

                const { backupPath } = patchability;
                if (!existsSync(backupPath)) {
                  setDoneMessages([{ type: "info", text: "No backup found — nothing to undo." }]);
                  setStep("done");
                  return;
                }

                try {
                  copyFileSync(backupPath, binaryPath);
                  resignBinary(binaryPath);
                  clearCompanion(configPath);
                  setDoneMessages([{ type: "success", text: "Restored! Restart Claude Code and say /buddy to see your original friend." }]);
                } catch (err) {
                  setDoneMessages([{ type: "error", text: err.message }]);
                }

                setStep("done");
              } else {
                setStep("species");
              }
            }}
          />
        )}

        {step === "showCurrent" && (
          <ShowCurrentStep isActive={step === "showCurrent"} />
        )}

        {step === "species" && (
          <SpeciesStep
            speciesList={SPECIES}
            current={species}
            onChange={setSpecies}
            onSubmit={() => setStep("rarity")}
            onBack={() => goBack("action")}
            isActive={step === "species"}
          />
        )}

        {step === "rarity" && (
          <ListSelect
            label="Rarity"
            options={RARITIES.map((r) => ({ label: RARITY_LABELS[r], value: r }))}
            defaultValue={rarity}
            onChange={(r) => {
              setRarity(r);
              if (r === "common") setHat("none");
            }}
            onSubmit={() => setStep("eye")}
            onBack={() => goBack()}
            isActive={step === "rarity"}
          />
        )}

        {step === "eye" && (
          <ListSelect
            label="Eye"
            options={EYES.map((e) => ({ label: e, value: e }))}
            defaultValue={eye}
            onChange={setEye}
            onSubmit={() => setStep(rarity === "common" ? "shiny" : "hat")}
            onBack={() => goBack()}
            isActive={step === "eye"}
          />
        )}

        {step === "hat" && (
          <ListSelect
            label="Hat"
            options={HATS.map((h) => ({ label: h, value: h }))}
            defaultValue={hat === "none" ? "crown" : hat}
            onChange={setHat}
            onSubmit={() => setStep("shiny")}
            onBack={() => goBack()}
            isActive={step === "hat"}
          />
        )}

        {step === "shiny" && (
          <ConfirmSelect
            label="Shiny?"
            isActive={step === "shiny"}
            onConfirm={() => {
              setShiny(true);
              setStep("peak");
            }}
            onCancel={() => {
              setShiny(false);
              setStep("peak");
            }}
            onBack={() => goBack()}
          />
        )}

        {step === "peak" && (
          <ListSelect
            label="Best at"
            options={[
              { label: "Any (random)", value: "any" },
              ...(STAT_NAMES || []).map(s => ({ label: s, value: s })),
            ]}
            defaultValue="any"
            onSubmit={(v) => {
              setPeak(v === "any" ? null : v);
              if (v === "any") {
                setStep("confirm");
              } else {
                setStep("dump");
              }
            }}
            onBack={() => goBack()}
            isActive={step === "peak"}
          />
        )}

        {step === "dump" && (
          <ListSelect
            label="Worst at"
            options={[
              { label: "Any (random)", value: "any" },
              ...(STAT_NAMES || []).filter(s => s !== peak).map(s => ({ label: s, value: s })),
            ]}
            defaultValue="any"
            onSubmit={(v) => {
              setDump(v === "any" ? null : v);
              setStep("confirm");
            }}
            onBack={() => goBack()}
            isActive={step === "dump"}
          />
        )}

        {step === "confirm" && (
          <Box flexDirection="column">
            <Text>Target: <Text bold>{species}</Text> / <Text bold>{rarity}</Text> / eye:{eye} / hat:{effectiveHat}{shiny ? " / shiny" : ""}{peak ? ` / peak:${peak}` : ""}{dump ? ` / dump:${dump}` : ""}</Text>
            {isClaudeRunning() && <Text color="yellow">⚠ Claude Code appears to be running. Quit it before patching.</Text>}
            <ConfirmSelect
              label="Search and apply?"
              isActive={step === "confirm"}
              onConfirm={() => {
                const patchability = getPatchability(binaryPath);
                if (!patchability.ok) {
                  setDoneMessages([{ type: "error", text: patchability.message }]);
                  setStep("done");
                  return;
                }
                setStep("search");
              }}
              onCancel={() => exit()}
              onBack={() => goBack()}
            />
          </Box>
        )}

        {step === "search" && (
          <SearchStep
            userId={userId}
            target={buildTarget()}
            bruteForce={bruteForce}
            onFound={(f) => { setFound(f); setStep("result"); }}
            onFail={() => {
              setDoneMessages([{ type: "error", text: "Couldn't find a match. Try being less picky!" }]);
              setStep("done");
            }}
            isActive={step === "search"}
          />
        )}

        {step === "result" && (
          <Box flexDirection="column">
            <Text bold color="green">✓ Found your buddy! ({found.checked.toLocaleString()} tries, {(found.elapsed / 1000).toFixed(1)}s)</Text>
            <ConfirmSelect
              label="Apply patch?"
              isActive={step === "result"}
              onConfirm={() => {
                const patchability = getPatchability(binaryPath);
                if (!patchability.ok) {
                  setDoneMessages([{ type: "error", text: patchability.message }]);
                  setStep("done");
                  return;
                }

                const msgs = [];
                const { backupPath } = patchability;

                try {
                  if (!existsSync(backupPath)) {
                    copyFileSync(binaryPath, backupPath);
                    msgs.push({ type: "success", text: `Saved a backup just in case` });
                  }
                  const count = patchBinary(binaryPath, currentSalt, found.salt);
                  msgs.push({ type: "success", text: "Applied!" });
                  if (resignBinary(binaryPath)) msgs.push({ type: "success", text: "Re-signed for macOS" });
                  clearCompanion(configPath);
                  if (storeSalt) storeSalt(found.salt);
                  if (installHook) installHook();
                  msgs.push({ type: "success", text: "Cleaned up old buddy data" });
                } catch (err) {
                  msgs.push({ type: "error", text: err.message });
                }

                setDoneMessages(msgs);
                setStep("done");
              }}
              onCancel={() => exit()}
            />
          </Box>
        )}

        {step === "done" && <DoneStep messages={doneMessages} isActive={step === "done"} />}
      </Box>
    </Box>
  );
}

export async function runInteractiveUI(opts) {
  const { waitUntilExit } = render(<App opts={opts} />);
  await waitUntilExit();
}
