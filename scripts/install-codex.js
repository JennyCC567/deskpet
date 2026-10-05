#!/usr/bin/env node
const childProcess = require("child_process");
const path = require("path");

function usage() {
  console.log(`Usage: node scripts/install-codex.js [options]

Installs both Codex integration tracks:
  1. Codex native custom pet skin in ~/.codex/pets/<id>.
  2. Deskpet bridge hooks that write <project>/.deskpet/state.json.

Options:
  --project <path>       Project that Deskpet should watch. Defaults to this repository.
  --codex-home <path>    Codex home directory. Defaults to $CODEX_HOME or ~/.codex.
  --id <id>              Codex native pet id. Defaults to puppy.
  --display-name <n>     Display name for the Codex native pet.
  --global-hooks         Install hooks into ~/.codex/hooks.json instead of <project>/.codex/hooks.json.
  --no-trust             Do not write trusted_hash entries for hooks.
  --no-select            Install native pet files without selecting it.
  --skip-native-pet      Install only the Deskpet hook bridge.
  --skip-bridge          Install only the Codex native pet skin.
  --help                 Show this help.
`);
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const result = {
    project: path.resolve(__dirname, ".."),
    codexHome: "",
    id: "",
    displayName: "",
    globalHooks: false,
    trust: true,
    select: true,
    nativePet: true,
    bridge: true,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
    } else if (value === "--global-hooks") {
      result.globalHooks = true;
    } else if (value === "--no-trust") {
      result.trust = false;
    } else if (value === "--no-select") {
      result.select = false;
    } else if (value === "--skip-native-pet") {
      result.nativePet = false;
    } else if (value === "--skip-bridge") {
      result.bridge = false;
    } else if (value === "--project") {
      result.project = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--codex-home") {
      result.codexHome = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--id") {
      result.id = readOptionValue(argv, ++index, value);
    } else if (value === "--display-name") {
      result.displayName = readOptionValue(argv, ++index, value);
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  if (!result.nativePet && !result.bridge) {
    throw new Error("Nothing to install: both --skip-native-pet and --skip-bridge were provided.");
  }

  return result;
}

function runScript(scriptName, args, cwd) {
  const scriptPath = path.join(__dirname, scriptName);
  childProcess.execFileSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit"
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const cwd = path.resolve(__dirname, "..");

  if (options.nativePet) {
    const args = ["--source", options.project];
    if (options.codexHome) {
      args.push("--codex-home", options.codexHome);
    }
    if (options.id) {
      args.push("--id", options.id);
    }
    if (options.displayName) {
      args.push("--display-name", options.displayName);
    }
    if (!options.select) {
      args.push("--no-select");
    }
    runScript("install-codex-pet.js", args, cwd);
  }

  if (options.bridge) {
    const args = ["--project", options.project];
    if (options.globalHooks) {
      args.push("--global");
    }
    if (options.trust) {
      args.push("--trust");
    }
    runScript("install-codex-hooks.js", args, cwd);
  }

  console.log("Deskpet Codex install complete.");
  console.log("Restart the standalone Deskpet runtime after install so it watches this project's .deskpet/state.json.");
}

try {
  main();
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}
