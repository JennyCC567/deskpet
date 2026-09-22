const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const PID_FILE = path.join(os.tmpdir(), "deskpet.pid");
const SCALE_STEP = 0.04;
const TRANSIENT_STATE_MS = 9000;
let petProcess;
let stateTimer;
let writeQueue = Promise.resolve();
let activeBridgeMode;

const bridgeState = {
  activeTasks: new Map(),
  activeDebugSessions: new Map(),
  lastTask: undefined,
  lastTerminal: undefined,
  lastActivity: {
    lastEvent: "extensionActivated",
    message: "Deskpet is watching this workspace.",
    eventId: createEventId()
  }
};

function createEventId() {
  return crypto.randomBytes(6).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function isFreshTimestamp(value, maxAgeMs) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= maxAgeMs;
}

function compactText(text, maxLength = 90) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function updateActivity(lastEvent, message) {
  bridgeState.lastActivity = {
    lastEvent,
    message: compactText(message),
    eventId: createEventId(),
    at: nowIso()
  };
  scheduleProjectStateWrite();
}

function readPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveElectronPath(context) {
  try {
    const electronPath = require("electron");
    if (typeof electronPath === "string") {
      return electronPath;
    }
  } catch {
    // Fall through to the installed package layout below.
  }

  const electronDir = path.join(context.extensionPath, "node_modules", "electron");
  const executableName = fs.readFileSync(path.join(electronDir, "path.txt"), "utf8").trim();
  const electronPath = path.join(electronDir, "dist", executableName);
  fs.accessSync(electronPath, fs.constants.X_OK);
  return electronPath;
}

function getDeskpetConfig() {
  const config = vscode.workspace.getConfiguration("deskpet");
  return {
    petId: "puppy",
    petDir: "puppy",
    scale: config.get("scale", 0.32),
    speed: config.get("speed", 34),
    bottomMargin: config.get("bottomMargin", 16),
    launchOnStartup: config.get("launchOnStartup", false),
    statusBubble: config.get("statusBubble", true),
    statusBubblePinned: config.get("statusBubblePinned", true),
    bridgeMode: config.get("bridgeMode", "vscode"),
    externalStateFile: config.get("externalStateFile", "")
  };
}

function getWorkspaceRoot() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function getProjectStatePath() {
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }

  return path.join(root, ".deskpet", "state.json");
}

function resolveExternalStatePath(config) {
  if (!config.externalStateFile) {
    return undefined;
  }

  if (path.isAbsolute(config.externalStateFile)) {
    return config.externalStateFile;
  }

  const root = getWorkspaceRoot();
  return root ? path.resolve(root, config.externalStateFile) : undefined;
}

function resolveStatePathForMode(config) {
  if (config.bridgeMode === "desktop") {
    return undefined;
  }

  if (config.bridgeMode === "external") {
    return resolveExternalStatePath(config) || getProjectStatePath();
  }

  return getProjectStatePath();
}

function getDiagnosticsSummary() {
  const diagnostics = vscode.languages.getDiagnostics();
  let errors = 0;
  let warnings = 0;
  let information = 0;
  let hints = 0;

  for (const [, entries] of diagnostics) {
    for (const diagnostic of entries) {
      if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
        errors += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
        warnings += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Information) {
        information += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Hint) {
        hints += 1;
      }
    }
  }

  return { errors, warnings, information, hints };
}

function getActiveFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const root = getWorkspaceRoot();
  const filePath = editor.document.uri.fsPath;
  return root ? path.relative(root, filePath) : filePath;
}

function getGitState(root) {
  return new Promise((resolve) => {
    if (!root) {
      resolve(undefined);
      return;
    }

    childProcess.execFile("git", ["status", "--short", "--branch"], { cwd: root }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }

      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const branchLine = lines[0] || "";
      const branch = branchLine.replace(/^##\s*/, "").split("...")[0].trim() || undefined;
      const dirtyFiles = Math.max(0, lines.length - 1);
      const stagedFiles = lines.slice(1).filter((line) => line[0] && line[0] !== " " && line[0] !== "?").length;
      const unstagedFiles = lines.slice(1).filter((line) => !line.startsWith("??") && line[1] && line[1] !== " ").length
        + lines.slice(1).filter((line) => line.startsWith("??")).length;

      resolve({ branch, dirtyFiles, stagedFiles, unstagedFiles });
    });
  });
}

function getTaskState() {
  const activeTasks = Array.from(bridgeState.activeTasks.values());
  const current = activeTasks[activeTasks.length - 1] || bridgeState.lastTask;

  if (!current) {
    return {
      status: "idle",
      activeCount: 0
    };
  }

  return {
    status: activeTasks.length > 0 ? "running" : current.status,
    activeCount: activeTasks.length,
    name: current.name,
    source: current.source,
    lastExitCode: current.exitCode,
    updatedAt: current.updatedAt
  };
}

function getTerminalState() {
  return bridgeState.lastTerminal || {
    status: "idle"
  };
}

function getDebugState() {
  const activeSessions = Array.from(bridgeState.activeDebugSessions.values());
  const current = activeSessions[activeSessions.length - 1];

  return {
    status: activeSessions.length > 0 ? "running" : "idle",
    activeCount: activeSessions.length,
    name: current?.name,
    type: current?.type
  };
}

function inferDeskpetState(diagnostics, task, terminal, debug) {
  if (task.status === "running" || task.activeCount > 0) {
    return "in_progress";
  }
  if (terminal.status === "running") {
    return "running_command";
  }
  if (debug.status === "running" || debug.activeCount > 0) {
    return "in_progress";
  }
  if (task.status === "failed" || terminal.status === "failed") {
    if (isFreshTimestamp(task.updatedAt, TRANSIENT_STATE_MS) || isFreshTimestamp(terminal.updatedAt, TRANSIENT_STATE_MS)) {
      return "error";
    }
  }
  if (task.status === "completed" || terminal.status === "completed") {
    if (isFreshTimestamp(task.updatedAt, TRANSIENT_STATE_MS) || isFreshTimestamp(terminal.updatedAt, TRANSIENT_STATE_MS)) {
      return "completed";
    }
  }
  if (diagnostics.errors > 0) {
    return "error";
  }
  if (diagnostics.warnings > 0) {
    return "warning";
  }
  if (getActiveFile()) {
    return "editing";
  }

  return "idle";
}

async function writeProjectState() {
  const root = getWorkspaceRoot();
  const statePath = getProjectStatePath();
  if (!root || !statePath) {
    return undefined;
  }

  const diagnostics = getDiagnosticsSummary();
  const task = getTaskState();
  const terminal = getTerminalState();
  const debug = getDebugState();
  const deskpetState = inferDeskpetState(diagnostics, task, terminal, debug);
  const state = {
    workspacePath: root,
    source: "vscode",
    timestamp: nowIso(),
    deskpet: {
      state: deskpetState
    },
    git: await getGitState(root),
    diagnostics,
    task,
    terminal,
    debug,
    activity: {
      activeFile: getActiveFile(),
      ...bridgeState.lastActivity
    }
  };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return statePath;
}

function scheduleProjectStateWrite() {
  if (activeBridgeMode !== "vscode") {
    return writeQueue;
  }

  writeQueue = writeQueue
    .catch(() => {})
    .then(() => writeProjectState())
    .catch(() => {});
  return writeQueue;
}

function startStateWriter(config = getDeskpetConfig()) {
  if (config.bridgeMode !== "vscode") {
    stopStateWriter();
    activeBridgeMode = config.bridgeMode;
    return;
  }

  activeBridgeMode = config.bridgeMode;
  if (stateTimer) {
    return;
  }

  scheduleProjectStateWrite();
  stateTimer = setInterval(scheduleProjectStateWrite, 2500);
}

function stopStateWriter() {
  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = undefined;
  }
  activeBridgeMode = undefined;
}

async function startDeskpet(context, source = "command") {
  const config = getDeskpetConfig();
  if (source === "startup" && !config.launchOnStartup) {
    return;
  }

  const existingPid = readPid();
  if (isProcessAlive(existingPid)) {
    startStateWriter(config);
    return;
  }

  const electronPath = resolveElectronPath(context);
  const appMain = path.join(context.extensionPath, "pet-app", "main.js");
  const statePath = resolveStatePathForMode(config);
  if (config.bridgeMode === "vscode") {
    await writeProjectState();
  }
  const env = {
    ...process.env,
    DESKPET_ROOT: context.extensionPath,
    DESKPET_PID_FILE: PID_FILE,
    DESKPET_PROJECT_STATE_FILE: statePath || "",
    DESKPET_CONFIG: JSON.stringify(config)
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const args = process.platform === "linux"
    ? ["--no-sandbox", "--disable-gpu", appMain]
    : [appMain];

  petProcess = childProcess.spawn(electronPath, args, {
    cwd: context.extensionPath,
    detached: true,
    env,
    stdio: "ignore"
  });

  petProcess.once("error", (error) => {
    vscode.window.showWarningMessage(`Could not start Deskpet: ${error.message}`);
  });

  petProcess.unref();
  startStateWriter(config);
}

async function stopDeskpet() {
  stopStateWriter();
  const pid = readPid();
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      vscode.window.showWarningMessage(`Could not stop Deskpet: ${error.message}`);
    }
  }

  if (petProcess && !petProcess.killed) {
    try {
      petProcess.kill("SIGTERM");
    } catch {
      // PID cleanup handles the important case.
    }
  }

  fs.rmSync(PID_FILE, { force: true });
}

async function restartDeskpet(context) {
  await stopDeskpet();
  await new Promise((resolve) => setTimeout(resolve, 350));
  await startDeskpet(context, "command");
}

async function updateScale(context, delta) {
  const config = vscode.workspace.getConfiguration("deskpet");
  const current = config.get("scale", 0.32);
  const next = Math.min(0.8, Math.max(0.12, Number((current + delta).toFixed(2))));
  await config.update("scale", next, vscode.ConfigurationTarget.Global);
  await restartDeskpet(context);
  vscode.window.showInformationMessage(`Deskpet size set to ${next}.`);
}

async function selectBridgeMode(context) {
  const options = [
    {
      label: "VS Code",
      mode: "vscode",
      description: "Use VS Code/Cursor diagnostics, tasks, terminal, debug, Git, and editor activity."
    },
    {
      label: "Codex / Claude Code",
      mode: "external",
      description: "Watch a local state file written by an external adapter."
    },
    {
      label: "Desktop Only",
      mode: "desktop",
      description: "Run as a pet without project-state integration."
    }
  ];
  const selected = await vscode.window.showQuickPick(options, {
    title: "Deskpet Bridge Mode",
    placeHolder: "Choose where Deskpet should read coding state from"
  });
  if (!selected) {
    return;
  }

  const config = vscode.workspace.getConfiguration("deskpet");
  await config.update("bridgeMode", selected.mode, vscode.ConfigurationTarget.Global);

  if (selected.mode === "external") {
    const root = getWorkspaceRoot();
    const defaultPath = root ? path.join(".deskpet", "state.json") : "";
    const externalStateFile = await vscode.window.showInputBox({
      title: "External Deskpet State File",
      prompt: "Codex or Claude Code adapters should write Deskpet state to this JSON file.",
      value: config.get("externalStateFile", "") || defaultPath
    });
    if (externalStateFile !== undefined) {
      await config.update("externalStateFile", externalStateFile, vscode.ConfigurationTarget.Global);
    }
  }

  await restartDeskpet(context);
  vscode.window.showInformationMessage(`Deskpet bridge mode set to ${selected.label}.`);
}

function taskSnapshot(execution, status, exitCode) {
  return {
    name: execution.task.name,
    source: execution.task.source,
    status,
    exitCode,
    updatedAt: nowIso()
  };
}

function registerBridgeListeners(context) {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      const activeFile = getActiveFile();
      updateActivity("activeFileChanged", activeFile ? `Editing: ${activeFile}` : "Editor focus changed.");
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const root = getWorkspaceRoot();
      const filePath = root ? path.relative(root, document.uri.fsPath) : document.uri.fsPath;
      updateActivity("fileSaved", `Saved: ${filePath}`);
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      const diagnostics = getDiagnosticsSummary();
      if (diagnostics.errors > 0) {
        updateActivity("diagnosticsChanged", `${diagnostics.errors} error${diagnostics.errors === 1 ? "" : "s"} in workspace.`);
      } else if (diagnostics.warnings > 0) {
        updateActivity("diagnosticsChanged", `${diagnostics.warnings} warning${diagnostics.warnings === 1 ? "" : "s"} in workspace.`);
      } else {
        updateActivity("diagnosticsChanged", "No diagnostics blocking the workspace.");
      }
    }),
    vscode.tasks.onDidStartTask((event) => {
      const snapshot = taskSnapshot(event.execution, "running");
      bridgeState.activeTasks.set(event.execution, snapshot);
      bridgeState.lastTask = snapshot;
      updateActivity("taskStarted", `Task started: ${snapshot.name}`);
    }),
    vscode.tasks.onDidEndTaskProcess((event) => {
      const status = event.exitCode === undefined || event.exitCode === 0 ? "completed" : "failed";
      const snapshot = taskSnapshot(event.execution, status, event.exitCode);
      bridgeState.activeTasks.delete(event.execution);
      bridgeState.lastTask = snapshot;
      updateActivity(
        status === "completed" ? "taskCompleted" : "taskFailed",
        event.exitCode === undefined ? `Task finished: ${snapshot.name}` : `${snapshot.name} exited with ${event.exitCode}.`
      );
    }),
    vscode.tasks.onDidEndTask((event) => {
      if (!bridgeState.activeTasks.has(event.execution)) {
        return;
      }

      const snapshot = taskSnapshot(event.execution, "completed");
      bridgeState.activeTasks.delete(event.execution);
      bridgeState.lastTask = snapshot;
      updateActivity("taskCompleted", `Task finished: ${snapshot.name}`);
    }),
    vscode.debug.onDidStartDebugSession((session) => {
      bridgeState.activeDebugSessions.set(session.id, {
        id: session.id,
        name: session.name,
        type: session.type
      });
      updateActivity("debugStarted", `Debugging: ${session.name}`);
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      bridgeState.activeDebugSessions.delete(session.id);
      updateActivity("debugEnded", `Debug ended: ${session.name}`);
    })
  );

  if (vscode.window.onDidStartTerminalShellExecution && vscode.window.onDidEndTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const command = event.execution?.commandLine?.value || event.execution?.commandLine || "";
        bridgeState.lastTerminal = {
          status: "running",
          terminal: event.terminal?.name,
          command: compactText(command),
          updatedAt: nowIso()
        };
        updateActivity("terminalCommandStarted", command ? `Running: ${command}` : "Terminal command started.");
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        const command = event.execution?.commandLine?.value || event.execution?.commandLine || "";
        const exitCode = event.exitCode;
        const status = exitCode === undefined || exitCode === 0 ? "completed" : "failed";
        bridgeState.lastTerminal = {
          status,
          terminal: event.terminal?.name,
          command: compactText(command),
          exitCode,
          updatedAt: nowIso()
        };
        updateActivity(
          status === "completed" ? "terminalCompleted" : "terminalFailed",
          command ? `Command exited with ${exitCode ?? "unknown"}: ${command}` : `Terminal command exited with ${exitCode ?? "unknown"}.`
        );
      })
    );
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("deskpet.start", () => startDeskpet(context, "command")),
    vscode.commands.registerCommand("deskpet.stop", stopDeskpet),
    vscode.commands.registerCommand("deskpet.restart", () => restartDeskpet(context)),
    vscode.commands.registerCommand("deskpet.larger", () => updateScale(context, SCALE_STEP)),
    vscode.commands.registerCommand("deskpet.smaller", () => updateScale(context, -SCALE_STEP)),
    vscode.commands.registerCommand("deskpet.selectBridgeMode", () => selectBridgeMode(context))
  );

  registerBridgeListeners(context);

  setTimeout(() => {
    startDeskpet(context, "startup").catch((error) => {
      vscode.window.showWarningMessage(`Could not start Deskpet: ${error.message}`);
    });
  }, 700);
}

function deactivate() {
  stopStateWriter();
}

module.exports = {
  activate,
  deactivate
};
