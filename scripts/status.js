const fs = require("fs");
const os = require("os");
const path = require("path");

const pidFile = process.env.DESKPET_PID_FILE || path.join(os.tmpdir(), "deskpet.pid");

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

const pid = readPid();
if (isProcessAlive(pid)) {
  console.log(`Deskpet is running: pid ${pid}`);
  console.log(`PID file: ${pidFile}`);
} else {
  console.log("Deskpet is not running.");
  console.log(`PID file: ${pidFile}`);
}
