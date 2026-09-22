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

const pid = readPid();
if (!pid) {
  console.log("Deskpet is not running.");
  process.exit(0);
}

try {
  process.kill(pid, "SIGTERM");
  fs.rmSync(pidFile, { force: true });
  console.log(`Stopped Deskpet process ${pid}.`);
} catch (error) {
  fs.rmSync(pidFile, { force: true });
  console.log(`Deskpet process ${pid} was not running.`);
}
