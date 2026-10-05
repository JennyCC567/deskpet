#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOK_EVENTS = [
  {
    name: "SessionStart",
    statusMessage: "Deskpet: session ready",
    matcher: "startup|resume"
  },
  {
    name: "UserPromptSubmit",
    statusMessage: "Deskpet: thinking"
  },
  {
    name: "PreToolUse",
    statusMessage: "Deskpet: working",
    matcher: "Bash|exec_command|functions.exec_command|multi_tool_use.parallel|apply_patch|functions.apply_patch|Edit|Write|MultiEdit",
    includeFallback: true
  },
  {
    name: "PermissionRequest",
    statusMessage: "Deskpet: needs attention"
  },
  {
    name: "PostToolUse",
    statusMessage: "Deskpet: tool finished",
    matcher: "Bash|exec_command|functions.exec_command|multi_tool_use.parallel|apply_patch|functions.apply_patch|Edit|Write|MultiEdit",
    includeFallback: true
  },
  {
    name: "Stop",
    statusMessage: "Deskpet: completed"
  },
  {
    name: "Interrupt",
    statusMessage: "Deskpet: interrupted"
  }
];

function usage() {
  console.log(`Usage: node scripts/install-codex-hooks.js [options]

Options:
  --project <path>       Project that Deskpet should watch. Defaults to this repository.
  --target <path>        Directory where hooks should be installed. Defaults to <project>/.codex.
  --global               Install hooks into ~/.codex/hooks.json instead of <project>/.codex/hooks.json.
  --state-file <path>    State JSON path. Defaults to <project>/.deskpet/state.json.
  --node <path>          Node executable used by Codex hooks. Defaults to the current Node.
  --portable             Write portable project hooks that use ./hooks/deskpet-state.js.
  --trust                Write matching trusted_hash entries into ~/.codex/config.toml.
  --print                Print the generated hook config without writing files.
  --help                 Show this help.
`);
}

function parseArgs(argv) {
  const result = {
    project: path.resolve(__dirname, ".."),
    target: "",
    stateFile: "",
    node: process.execPath,
    global: false,
    portable: false,
    trust: false,
    print: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
    } else if (value === "--global") {
      result.global = true;
    } else if (value === "--portable") {
      result.portable = true;
    } else if (value === "--trust") {
      result.trust = true;
    } else if (value === "--print") {
      result.print = true;
    } else if (value === "--project") {
      result.project = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--target") {
      result.target = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--state-file") {
      result.stateFile = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--node") {
      result.node = path.resolve(readOptionValue(argv, ++index, value));
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  result.stateFile = result.stateFile || path.join(result.project, ".deskpet", "state.json");
  result.target = result.global
    ? path.join(os.homedir(), ".codex")
    : result.target || path.join(result.project, ".codex");
  result.hooksJson = path.join(result.target, "hooks.json");
  result.hookScript = path.join(result.target, "hooks", "deskpet-state.js");
  if (result.global && result.portable) {
    throw new Error("--portable cannot be combined with --global");
  }
  return result;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function commandFor(eventName, options) {
  const parts = [
    `DESKPET_HOOK_EVENT=${shellQuote(eventName)}`,
    options.portable ? "node" : shellQuote(options.node),
    shellQuote(options.portable ? "./hooks/deskpet-state.js" : options.hookScript)
  ];

  if (!options.portable) {
    parts.splice(1, 0, `DESKPET_STATE_FILE=${shellQuote(options.stateFile)}`);
  }

  return parts.join(" ");
}

function hookCommand(eventName, options) {
  return {
    type: "command",
    command: commandFor(eventName, options),
    timeout: 3,
    statusMessage: HOOK_EVENTS.find((event) => event.name === eventName)?.statusMessage
  };
}

function hookEntry(event, options, withMatcher) {
  const entry = {
    hooks: [hookCommand(event.name, options)]
  };
  if (withMatcher && event.matcher) {
    entry.matcher = event.matcher;
  }
  return entry;
}

function buildHooks(options) {
  const hooks = {};
  for (const event of HOOK_EVENTS) {
    const entries = [hookEntry(event, options, true)];
    if (event.includeFallback) {
      entries.push(hookEntry(event, options, false));
    }
    hooks[event.name] = entries;
  }

  return { hooks };
}

function copyHookScript(options) {
  const sourceScript = path.join(__dirname, "..", "hooks", "deskpet-state.js");
  if (path.resolve(sourceScript) === path.resolve(options.hookScript)) {
    fs.chmodSync(options.hookScript, 0o755);
    return;
  }

  fs.mkdirSync(path.dirname(options.hookScript), { recursive: true });
  fs.copyFileSync(sourceScript, options.hookScript);
  fs.chmodSync(options.hookScript, 0o755);
}

function writeHooksJson(options, hooks) {
  fs.mkdirSync(path.dirname(options.hooksJson), { recursive: true });
  const existing = readJsonObject(options.hooksJson, { hooks: {} });
  const merged = {
    ...existing,
    hooks: {
      ...(existing.hooks || {})
    }
  };

  for (const [eventName, entries] of Object.entries(hooks.hooks || {})) {
    const existingEntries = Array.isArray(merged.hooks[eventName]) ? merged.hooks[eventName] : [];
    const withoutDeskpet = existingEntries
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !isDeskpetHookCommand(hook?.command))
          : entry.hooks
      }))
      .filter((entry) => !Array.isArray(entry.hooks) || entry.hooks.length > 0);
    merged.hooks[eventName] = [...withoutDeskpet, ...entries];
  }

  fs.writeFileSync(options.hooksJson, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

function readJsonObject(filePath, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isDeskpetHookCommand(command) {
  return typeof command === "string"
    && (command.includes("DESKPET_HOOK_EVENT=") || command.includes("deskpet-state.js"));
}

function normalizeEventName(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.\-\s]+/g, "_")
    .toLowerCase();
}

function trustKey(hooksJson, eventName, entryIndex) {
  return `${hooksJson}:${normalizeEventName(eventName)}:${entryIndex}:0`;
}

function trustedHash(command) {
  return `sha256:${crypto.createHash("sha256").update(command).digest("hex")}`;
}

function collectTrustEntries(options, hooks) {
  const entries = [];
  for (const [eventName, eventEntries] of Object.entries(hooks.hooks || {})) {
    eventEntries.forEach((entry, entryIndex) => {
      const commandHooks = Array.isArray(entry.hooks)
        ? entry.hooks
          .map((hook, hookIndex) => ({ hook, hookIndex }))
          .filter(({ hook }) => isDeskpetHookCommand(hook?.command))
        : [];
      if (commandHooks.length === 0) {
        return;
      }

      commandHooks.forEach(({ hook, hookIndex }) => {
        entries.push({
          key: `${options.hooksJson}:${normalizeEventName(eventName)}:${entryIndex}:${hookIndex}`,
          hash: trustedHash(hook.command)
        });
      });
    });
  }
  return entries;
}

function upsertTomlHookTrust(configPath, trustEntries) {
  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (content && !content.endsWith("\n")) {
    content += "\n";
  }

  const lines = content.split(/\n/);
  const filtered = [];
  const keys = new Set(trustEntries.map((entry) => entry.key));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\[hooks\.state\."(.+)"\]$/);
    if (!match || !keys.has(match[1])) {
      filtered.push(line);
      continue;
    }

    index += 1;
    while (index < lines.length && !/^\[/.test(lines[index])) {
      index += 1;
    }
    index -= 1;
  }

  let next = filtered.join("\n").replace(/\n{3,}$/g, "\n\n");
  if (!/\[hooks\.state\](?:\n|$)/.test(next)) {
    next += `${next.endsWith("\n") ? "" : "\n"}[hooks.state]\n`;
  }
  if (!next.endsWith("\n")) {
    next += "\n";
  }

  for (const entry of trustEntries) {
    next += `\n[hooks.state."${entry.key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]\n`;
    next += `trusted_hash = "${entry.hash}"\n`;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, next, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const hooks = buildHooks(options);

  if (options.print) {
    console.log(JSON.stringify(hooks, null, 2));
    return;
  }

  copyHookScript(options);
  const installedHooks = writeHooksJson(options, hooks);
  const trustEntries = collectTrustEntries(options, installedHooks);

  if (options.trust) {
    upsertTomlHookTrust(path.join(os.homedir(), ".codex", "config.toml"), trustEntries);
  }

  console.log(`Deskpet Codex hooks installed: ${options.hooksJson}`);
  console.log(`Hook script: ${options.hookScript}`);
  console.log(`State file: ${options.stateFile}`);
  if (options.trust) {
    console.log(`Trusted hook commands: ${trustEntries.length}`);
  } else {
    console.log("Trust not updated. Open /hooks in Codex, or rerun with --trust.");
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}
