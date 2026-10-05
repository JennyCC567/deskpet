const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const pidFile = process.env.DESKPET_PID_FILE || path.join(os.tmpdir(), "deskpet.pid");
const appRoot = path.resolve(__dirname, "..");

function readPid() {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
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

function processDetails(pid) {
  try {
    const output = childProcess.execFileSync("ps", ["eww", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const line = output.split(/\r?\n/).find((item) => item.includes("pet-app/main.js")) || "";
    return detailsFromCommand(line, pid);
  } catch {
    return {};
  }
}

function detailsFromCommand(command, pid) {
  const appMain = command.match(/(\S+\/pet-app\/main\.js)/)?.[1];
  const cwd = command.match(/(?:^|\s)PWD=([^\s]+)/)?.[1];
  const root = command.match(/(?:^|\s)DESKPET_ROOT=([^\s]+)/)?.[1];
  const inferredRoot = appMain ? appMain.replace(/\/pet-app\/main\.js$/, "") : undefined;
  const stateFile = command.match(/(?:^|\s)DESKPET_PROJECT_STATE_FILE=([^\s]+)/)?.[1];

  return {
    pid,
    appMain,
    cwd,
    root: root || inferredRoot,
    stateFile
  };
}

function findDeskpetProcesses() {
  try {
    const output = childProcess.execFileSync("ps", ["axww", "-o", "pid=,command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return output
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (!match || !match[2].includes("/pet-app/main.js")) {
          return undefined;
        }

        return detailsFromCommand(match[2], Number.parseInt(match[1], 10));
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function samePath(left, right) {
  return left && right && path.resolve(left) === path.resolve(right);
}

function printRunning(pid, details, note = "") {
  console.log(`Deskpet is running: pid ${pid}${note}`);
  if (details.appMain) {
    console.log(`App: ${details.appMain}`);
  }
  if (details.cwd) {
    console.log(`CWD: ${details.cwd}`);
  }
  if (details.root) {
    console.log(`Root: ${details.root}`);
  }
  if (details.stateFile) {
    console.log(`State file: ${details.stateFile}`);
  }
  console.log(`PID file: ${pidFile}`);
}

const pid = readPid();
if (isProcessAlive(pid)) {
  printRunning(pid, processDetails(pid));
} else {
  const discovered = findDeskpetProcesses();
  const currentProjectProcess = discovered.find((item) => samePath(item.root, appRoot) || samePath(item.cwd, appRoot));

  if (currentProjectProcess) {
    printRunning(currentProjectProcess.pid, currentProjectProcess, " (discovered)");
    if (pid) {
      console.log("PID file was stale or missing for the discovered process.");
    }
  } else if (discovered.length > 0) {
    console.log("Deskpet is not running for this project.");
    console.log("Other Deskpet processes:");
    for (const item of discovered) {
      console.log(`- pid ${item.pid}: ${item.root || item.cwd || item.appMain || "unknown location"}`);
      if (item.stateFile) {
        console.log(`  State file: ${item.stateFile}`);
      }
    }
  } else {
    console.log("Deskpet is not running.");
  }
  console.log(`PID file: ${pidFile}`);
}
