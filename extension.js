const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vscode = require("vscode");

const PID_FILE = path.join(os.tmpdir(), "deskpet.pid");
const SCALE_STEP = 0.04;
let petProcess;
let stateTimer;

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
    launchOnStartup: config.get("launchOnStartup", false)
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

function getDiagnosticsSummary() {
  const diagnostics = vscode.languages.getDiagnostics();
  let errors = 0;
  let warnings = 0;

  for (const [, entries] of diagnostics) {
    for (const diagnostic of entries) {
      if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
        errors += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
        warnings += 1;
      }
    }
  }

  return { errors, warnings };
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
      resolve({ branch, dirtyFiles });
    });
  });
}

async function writeProjectState() {
  const root = getWorkspaceRoot();
  const statePath = getProjectStatePath();
  if (!root || !statePath) {
    return undefined;
  }

  const state = {
    workspacePath: root,
    source: "vscode",
    timestamp: new Date().toISOString(),
    git: await getGitState(root),
    diagnostics: getDiagnosticsSummary(),
    activity: {
      activeFile: getActiveFile(),
      lastEvent: "stateUpdated"
    }
  };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return statePath;
}

function startStateWriter() {
  if (stateTimer) {
    return;
  }

  writeProjectState().catch(() => {});
  stateTimer = setInterval(() => {
    writeProjectState().catch(() => {});
  }, 2500);
}

function stopStateWriter() {
  if (stateTimer) {
    clearInterval(stateTimer);
    stateTimer = undefined;
  }
}

async function startDeskpet(context, source = "command") {
  const config = getDeskpetConfig();
  if (source === "startup" && !config.launchOnStartup) {
    return;
  }

  const existingPid = readPid();
  if (isProcessAlive(existingPid)) {
    startStateWriter();
    return;
  }

  const electronPath = resolveElectronPath(context);
  const appMain = path.join(context.extensionPath, "pet-app", "main.js");
  const statePath = await writeProjectState();
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
  startStateWriter();
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

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("deskpet.start", () => startDeskpet(context, "command")),
    vscode.commands.registerCommand("deskpet.stop", stopDeskpet),
    vscode.commands.registerCommand("deskpet.restart", () => restartDeskpet(context)),
    vscode.commands.registerCommand("deskpet.larger", () => updateScale(context, SCALE_STEP)),
    vscode.commands.registerCommand("deskpet.smaller", () => updateScale(context, -SCALE_STEP)),
    vscode.window.onDidChangeActiveTextEditor(() => writeProjectState().catch(() => {})),
    vscode.workspace.onDidSaveTextDocument(() => writeProjectState().catch(() => {}))
  );

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
