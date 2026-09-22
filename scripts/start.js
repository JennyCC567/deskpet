const childProcess = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appMain = path.resolve(__dirname, "..", "pet-app", "main.js");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = childProcess.spawn(electronPath, [appMain], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
