const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const electronPath = require("electron");
const appRoot = path.resolve(__dirname, "..");
const appMain = path.join(appRoot, "pet-app", "main.js");
const pidFile = process.env.DESKPET_PID_FILE || path.join(os.tmpdir(), "deskpet.pid");
const env = { ...process.env };
env.DESKPET_ROOT = env.DESKPET_ROOT || appRoot;
env.DESKPET_PID_FILE = pidFile;
env.DESKPET_PROJECT_STATE_FILE = env.DESKPET_PROJECT_STATE_FILE || path.join(appRoot, ".deskpet", "state.json");
delete env.ELECTRON_RUN_AS_NODE;

const detached = process.argv.includes("--detach");
const child = childProcess.spawn(electronPath, [appMain], {
  cwd: appRoot,
  env,
  detached,
  stdio: detached ? "ignore" : "inherit"
});

try {
  fs.writeFileSync(pidFile, String(child.pid), "utf8");
} catch {
  // The Electron app also writes the PID once ready; this is only a startup hint.
}

if (detached) {
  child.unref();
  process.exit(0);
}

child.on("exit", (code, signal) => {
  try {
    const currentPid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (currentPid === child.pid) {
      fs.rmSync(pidFile, { force: true });
    }
  } catch {
    // Best effort cleanup.
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
