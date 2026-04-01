import React, { useState, useEffect, useRef } from "react";
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
          {sprite.map((line, i) => (
            <Text key={i} color={color}>{line}</Text>
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

function ShowCurrentStep({ isActive }) {
  const { exit } = useApp();

  useInput(() => {
    exit();
  }, { isActive });

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Current companion shown above.</Text>
      <KeyHint>Press any key to exit</KeyHint>
    </Box>
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
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape) {
      cancelRef.current = true;
      exit();
    }
  }, { isActive });

  useEffect(() => {
    (async () => {
      const found = await bruteForce(userId, target, (checked, elapsed) => {
        if (!cancelRef.current) {
          setProgress(`${(checked / 1e6).toFixed(0)}M salts checked (${(elapsed / 1000).toFixed(1)}s)`);
        }
      });
      if (cancelRef.current) return;
      if (found) onFound(found);
      else setError("No matching salt found. Try relaxing constraints.");
    })();
  }, []);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {error}</Text>
        <KeyHint>Press esc to exit</KeyHint>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Spinner label={progress || "Searching for matching salt..."} />
      <KeyHint>esc to cancel</KeyHint>
    </Box>
  );
}

function DoneStep({ messages, isActive }) {
  const { exit } = useApp();

  useInput(() => {
    exit();
  }, { isActive });

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <Text key={i} color="green">✓ {msg}</Text>
      ))}
      <Box marginTop={1}>
        <Text bold>Done! Restart Claude Code and run /buddy to hatch your new companion.</Text>
      </Box>
      <KeyHint>Press any key to exit</KeyHint>
    </Box>
  );
}

const STEP_ORDER = ["action", "species", "rarity", "eye", "hat", "shiny", "confirm"];

function getPrevStep(current, rarity) {
  const idx = STEP_ORDER.indexOf(current);
  if (idx <= 0) return null;
  let prev = STEP_ORDER[idx - 1];
  if (prev === "hat" && rarity === "common") prev = "eye";
  return prev;
}

function App({ opts }) {
  const { exit } = useApp();
  const {
    currentRoll, currentSalt, binaryPath, configPath, userId,
    bruteForce, patchBinary, resignBinary, clearCompanion, isClaudeRunning,
    rollFrom, matches, SPECIES, RARITIES, RARITY_LABELS, EYES, HATS,
  } = opts;

  const [step, setStep] = useState("action");
  const [species, setSpecies] = useState(currentRoll.species);
  const [rarity, setRarity] = useState(currentRoll.rarity);
  const [eye, setEye] = useState(currentRoll.eye);
  const [hat, setHat] = useState(currentRoll.hat);
  const [shiny, setShiny] = useState(currentRoll.shiny);
  const [found, setFound] = useState(null);
  const [doneMessages, setDoneMessages] = useState([]);

  const showStats = step === "showCurrent" || step === "result" || step === "done";
  const displayRoll = found ? found.result : { species, rarity, eye, hat, shiny, stats: currentRoll.stats };
  const effectiveHat = rarity === "common" ? "none" : hat;
  const buildTarget = (s = shiny) => ({ species, rarity, eye, hat: effectiveHat, shiny: s });

  const goBack = (toStep) => {
    const prev = toStep || getPrevStep(step, rarity);
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
                const backupPath = binaryPath + ".backup";
                if (!existsSync(backupPath)) {
                  setDoneMessages(["No backup found. Nothing to restore."]);
                  setStep("done");
                  return;
                }
                copyFileSync(backupPath, binaryPath);
                resignBinary(binaryPath);
                clearCompanion(configPath);
                setDoneMessages(["Restored! Restart Claude Code and run /buddy."]);
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
              if (matches(currentRoll, buildTarget(true))) {
                setDoneMessages(["Already matching! No changes needed."]);
                setStep("done");
              } else {
                setStep("confirm");
              }
            }}
            onCancel={() => {
              setShiny(false);
              if (matches(currentRoll, buildTarget(false))) {
                setDoneMessages(["Already matching! No changes needed."]);
                setStep("done");
              } else {
                setStep("confirm");
              }
            }}
            onBack={() => goBack()}
          />
        )}

        {step === "confirm" && (
          <Box flexDirection="column">
            <Text>Target: <Text bold>{species}</Text> / <Text bold>{rarity}</Text> / eye:{eye} / hat:{effectiveHat}{shiny ? " / shiny" : ""}</Text>
            {isClaudeRunning() && <Text color="yellow">⚠ Claude Code appears to be running. Quit it before patching.</Text>}
            <ConfirmSelect
              label="Search and apply?"
              isActive={step === "confirm"}
              onConfirm={() => setStep("search")}
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
              setDoneMessages(["No matching salt found. Try relaxing constraints."]);
              setStep("done");
            }}
            isActive={step === "search"}
          />
        )}

        {step === "result" && (
          <Box flexDirection="column">
            <Text bold color="green">✓ Found in {found.checked.toLocaleString()} attempts ({(found.elapsed / 1000).toFixed(1)}s)</Text>
            <ConfirmSelect
              label="Apply patch?"
              isActive={step === "result"}
              onConfirm={() => {
                const msgs = [];
                const backupPath = binaryPath + ".backup";
                if (!existsSync(backupPath)) {
                  copyFileSync(binaryPath, backupPath);
                  msgs.push(`Backup saved to ${backupPath}`);
                }
                const count = patchBinary(binaryPath, currentSalt, found.salt);
                msgs.push(`Patched ${count} occurrence(s)`);
                if (resignBinary(binaryPath)) msgs.push("Binary re-signed (ad-hoc codesign)");
                clearCompanion(configPath);
                msgs.push("Companion data cleared");
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
