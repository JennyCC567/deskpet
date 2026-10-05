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

function detailsFromCommand(command, pid) {
  const appMain = command.match(/(\S+\/pet-app\/main\.js)/)?.[1];
  const cwd = command.match(/(?:^|\s)PWD=([^\s]+)/)?.[1];
  const root = command.match(/(?:^|\s)DESKPET_ROOT=([^\s]+)/)?.[1];
  const inferredRoot = appMain ? appMain.replace(/\/pet-app\/main\.js$/, "") : undefined;

  return {
    pid,
    appMain,
    cwd,
    root: root || inferredRoot
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

function addTarget(targets, pid) {
  if (Number.isFinite(pid) && pid > 0 && isProcessAlive(pid)) {
    targets.add(pid);
  }
}

async function main() {
  const stopAll = process.argv.includes("--all");
  const targets = new Set();
  addTarget(targets, readPid());

  for (const item of findDeskpetProcesses()) {
    if (stopAll || samePath(item.root, appRoot) || samePath(item.cwd, appRoot)) {
      addTarget(targets, item.pid);
    }
  }

  if (targets.size === 0) {
    fs.rmSync(pidFile, { force: true });
    console.log("Deskpet is not running.");
    return;
  }

  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Stopping Deskpet process ${pid}.`);
    } catch {
      console.log(`Deskpet process ${pid} was not running.`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 600));

  for (const pid of targets) {
    if (isProcessAlive(pid)) {
      console.log(`Deskpet process ${pid} is still shutting down.`);
    } else {
      console.log(`Stopped Deskpet process ${pid}.`);
    }
  }

  fs.rmSync(pidFile, { force: true });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
