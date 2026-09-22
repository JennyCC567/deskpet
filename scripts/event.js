const fs = require("fs");
const path = require("path");

const STATE_ALIASES = {
  idle: "idle",
  editing: "editing",
  in_progress: "in_progress",
  progress: "in_progress",
  running: "in_progress",
  thinking: "thinking",
  command: "running_command",
  running_command: "running_command",
  editing_files: "editing_files",
  files: "editing_files",
  approval: "waiting_approval",
  waiting_approval: "waiting_approval",
  warning: "warning",
  error: "error",
  failed: "error",
  completed: "completed",
  complete: "completed",
  success: "completed",
  done: "completed",
  interrupted: "interrupted",
  stopped: "interrupted"
};

function usage() {
  console.log("Usage: npm run event -- <state> [message] [--task name] [--command cmd] [--exit-code code]");
  console.log("States: idle, editing, in_progress, thinking, running_command, editing_files, waiting_approval, warning, error, completed, interrupted");
}

function normalizeState(input) {
  return STATE_ALIASES[String(input || "").trim().toLowerCase()];
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const result = {
    messageParts: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--task") {
      result.task = argv[index + 1] || "";
      index += 1;
    } else if (value === "--command") {
      result.command = argv[index + 1] || "";
      index += 1;
    } else if (value === "--exit-code") {
      result.exitCode = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else {
      result.messageParts.push(value);
    }
  }

  result.message = result.messageParts.join(" ").trim();
  return result;
}

function stateToTaskStatus(state) {
  if (state === "completed") {
    return "completed";
  }
  if (state === "error") {
    return "failed";
  }
  if (state === "in_progress" || state === "thinking" || state === "editing_files") {
    return "running";
  }

  return "idle";
}

function stateToTerminalStatus(state) {
  if (state === "running_command") {
    return "running";
  }
  if (state === "completed") {
    return "completed";
  }
  if (state === "error") {
    return "failed";
  }

  return "idle";
}

const [stateArg, ...rest] = process.argv.slice(2);
const deskpetState = normalizeState(stateArg);
const args = parseArgs(rest);

if (!deskpetState) {
  usage();
  process.exit(stateArg ? 1 : 0);
}

const root = process.cwd();
const timestamp = new Date().toISOString();
const statePath = process.env.DESKPET_PROJECT_STATE_FILE || path.join(root, ".deskpet", "state.json");
const existing = readJson(statePath, {});
const next = {
  ...existing,
  workspacePath: existing.workspacePath || root,
  source: "cli",
  timestamp,
  deskpet: {
    ...(existing.deskpet || {}),
    state: deskpetState
  },
  activity: {
    ...(existing.activity || {}),
    lastEvent: deskpetState,
    message: args.message || existing.activity?.message || deskpetState.replace(/_/g, " "),
    eventId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: timestamp
  }
};

if (deskpetState !== "running_command" && existing.terminal?.status === "running") {
  next.terminal = {
    ...existing.terminal,
    status: "completed",
    updatedAt: timestamp
  };
}

if (!["in_progress", "thinking", "editing_files"].includes(deskpetState) && existing.task?.status === "running") {
  next.task = {
    ...existing.task,
    status: deskpetState === "error" ? "failed" : "completed",
    activeCount: 0,
    updatedAt: timestamp
  };
}

if (args.task) {
  next.task = {
    ...(existing.task || {}),
    status: stateToTaskStatus(deskpetState),
    activeCount: stateToTaskStatus(deskpetState) === "running" ? 1 : 0,
    name: args.task,
    lastExitCode: Number.isFinite(args.exitCode) ? args.exitCode : existing.task?.lastExitCode,
    updatedAt: timestamp
  };
}

if (args.command) {
  next.terminal = {
    ...(existing.terminal || {}),
    status: stateToTerminalStatus(deskpetState),
    command: args.command,
    exitCode: Number.isFinite(args.exitCode) ? args.exitCode : existing.terminal?.exitCode,
    updatedAt: timestamp
  };
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Deskpet event written: ${deskpetState}`);
console.log(statePath);
