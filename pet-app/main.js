const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

app.disableHardwareAcceleration();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const DEFAULT_CONFIG = {
  petId: "puppy",
  petDir: "puppy",
  scale: 0.32,
  speed: 34,
  bottomMargin: 16,
  idleMinMs: 3500,
  idleMaxMs: 9000,
  actionMinMs: 5000,
  actionMaxMs: 13000,
  wanderMinMs: 3000,
  wanderMaxMs: 8500,
  gravity: 1900
};

const config = readConfig();
const appRoot = process.env.DESKPET_ROOT || path.resolve(__dirname, "..");
const pidFile = process.env.DESKPET_PID_FILE || path.join(os.tmpdir(), "deskpet.pid");
const projectStateFile = process.env.DESKPET_PROJECT_STATE_FILE || "";
const manifest = readManifest();

let window;
let tickHandle;
let projectStateHandle;
let lastTick = Date.now();
let lastProjectStateRaw = "";

const state = {
  ready: false,
  x: 0,
  y: 0,
  width: 320,
  height: 320,
  direction: 1,
  mode: "idle",
  action: manifest.defaultAction || "idle_flowers",
  timerMs: 2500,
  velocityY: 0,
  dragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  clickCount: 0,
  lastClickAt: 0
};

function readConfig() {
  try {
    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(process.env.DESKPET_CONFIG || "{}")
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function readManifest() {
  const manifestPath = path.join(appRoot, config.petDir, "manifest.json");
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return {
      id: "fallback",
      displayName: "Deskpet",
      defaultAction: "idle",
      assetSize: { width: 1000, height: 1000 },
      actions: {
        idle: {
          label: "Idle",
          still: "",
          animated: "",
          loop: true,
          weight: 1,
          tags: ["idle"]
        }
      }
    };
  }
}

function writePidFile() {
  try {
    fs.writeFileSync(pidFile, String(process.pid), "utf8");
  } catch {
    // The app can still run without a PID marker.
  }
}

function removePidFile() {
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // Best effort cleanup.
  }
}

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.random() * (high - low);
}

function getWindowCenter() {
  if (!state.ready) {
    return screen.getCursorScreenPoint();
  }

  return {
    x: Math.round(state.x + state.width / 2),
    y: Math.round(state.y + state.height / 2)
  };
}

function getWorkArea() {
  return screen.getDisplayNearestPoint(getWindowCenter()).workArea;
}

function getFloorY() {
  const area = getWorkArea();
  return area.y + area.height - config.bottomMargin - state.height;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function moveWindow() {
  if (!window || window.isDestroyed() || !state.ready) {
    return;
  }

  window.setBounds({
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: state.width,
    height: state.height
  });
}

function sendState(extra = {}) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send("deskpet:state", {
    mode: state.mode,
    action: state.action,
    direction: state.direction,
    ...extra
  });
}

function actionsWithTag(tag) {
  return Object.entries(manifest.actions || {})
    .filter(([, action]) => Array.isArray(action.tags) && action.tags.includes(tag));
}

function weightedAction(entries) {
  const available = entries.length ? entries : Object.entries(manifest.actions || {});
  const total = available.reduce((sum, [, action]) => sum + Math.max(0, action.weight || 0), 0);

  if (total <= 0) {
    return available[0]?.[0] || state.action;
  }

  let ticket = Math.random() * total;
  for (const [name, action] of available) {
    ticket -= Math.max(0, action.weight || 0);
    if (ticket <= 0) {
      return name;
    }
  }

  return available[available.length - 1]?.[0] || state.action;
}

function setVisual(mode, action, timerMs) {
  state.mode = mode;
  state.action = action || state.action;
  state.timerMs = timerMs;
  sendState();
}

function beginIdle() {
  const action = weightedAction(actionsWithTag("idle"));
  setVisual("idle", action, randomBetween(config.idleMinMs, config.idleMaxMs));
}

function beginAction() {
  const action = weightedAction(Object.entries(manifest.actions || {}).filter(([, item]) => item.loop !== false));
  setVisual("action", action, randomBetween(config.actionMinMs, config.actionMaxMs));
}

function beginWander() {
  const wanderAction = actionsWithTag("wander")[0]?.[0] || state.action;
  state.direction = Math.random() < 0.5 ? -1 : 1;
  setVisual("wander", wanderAction, randomBetween(config.wanderMinMs, config.wanderMaxMs));
}

function beginCelebrate() {
  const celebrateAction = actionsWithTag("celebrate")[0]?.[0] || state.action;
  setVisual("celebrate", celebrateAction, 3600);
}

function beginSleep() {
  const sleepAction = actionsWithTag("sleep")[0]?.[0] || state.action;
  setVisual("sleep", sleepAction, randomBetween(7000, 15000));
}

function chooseNextMode() {
  const roll = Math.random();
  if (roll < 0.25) {
    beginWander();
  } else if (roll < 0.42) {
    beginSleep();
  } else if (roll < 0.75) {
    beginAction();
  } else {
    beginIdle();
  }
}

function keepInsideWorkArea() {
  const area = getWorkArea();
  state.x = clamp(state.x, area.x, area.x + area.width - state.width);
  state.y = clamp(state.y, area.y, area.y + area.height - state.height);
}

function tick() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;

  if (!state.ready) {
    return;
  }

  const area = getWorkArea();
  const floorY = getFloorY();

  if (state.dragging) {
    const cursor = screen.getCursorScreenPoint();
    state.x = clamp(cursor.x - state.dragOffsetX, area.x, area.x + area.width - state.width);
    state.y = clamp(cursor.y - state.dragOffsetY, area.y, area.y + area.height - state.height);
    moveWindow();
    return;
  }

  if (state.mode === "falling") {
    state.velocityY += config.gravity * dt;
    state.y += state.velocityY * dt;

    if (state.y >= floorY) {
      state.y = floorY;
      state.velocityY = 0;
      beginIdle();
    }

    moveWindow();
    return;
  }

  if (state.mode === "wander") {
    state.x += state.direction * config.speed * dt;
    state.y = floorY;

    if (state.x <= area.x) {
      state.x = area.x;
      state.direction = 1;
      sendState();
    } else if (state.x + state.width >= area.x + area.width) {
      state.x = area.x + area.width - state.width;
      state.direction = -1;
      sendState();
    }
  }

  state.timerMs -= dt * 1000;
  if (state.timerMs <= 0) {
    chooseNextMode();
  }

  moveWindow();
}

function createWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  window = new BrowserWindow({
    x: Math.round(area.x + (area.width - state.width) / 2),
    y: Math.round(area.y + area.height - config.bottomMargin - state.height),
    width: state.width,
    height: state.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    fullscreenable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  window.setAlwaysOnTop(true, "screen-saver");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(path.join(__dirname, "index.html"));
}

function readProjectState() {
  if (!projectStateFile) {
    return;
  }

  try {
    const raw = fs.readFileSync(projectStateFile, "utf8");
    if (raw === lastProjectStateRaw) {
      return;
    }

    lastProjectStateRaw = raw;
    const projectState = JSON.parse(raw);
    sendState({ projectState });
  } catch {
    // The editor bridge is optional; missing or partial state is fine.
  }
}

app.whenReady().then(() => {
  writePidFile();
  createWindow();
  tickHandle = setInterval(tick, 16);
  projectStateHandle = setInterval(readProjectState, 2500);
});

app.on("second-instance", () => {
  if (window && !window.isDestroyed()) {
    window.showInactive();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (tickHandle) {
    clearInterval(tickHandle);
  }
  if (projectStateHandle) {
    clearInterval(projectStateHandle);
  }
  removePidFile();
});

process.on("SIGTERM", () => {
  removePidFile();
  app.quit();
});

ipcMain.on("deskpet:ready", (_event, size) => {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    return;
  }

  const area = getWorkArea();
  state.width = Math.round(size.width);
  state.height = Math.round(size.height);
  state.x = Math.round(area.x + (area.width - state.width) / 2);
  state.y = getFloorY();
  state.ready = true;
  keepInsideWorkArea();
  moveWindow();
  beginIdle();
  readProjectState();
});

ipcMain.on("deskpet:pointer-down", (_event, point) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  state.dragging = true;
  state.dragOffsetX = point.x;
  state.dragOffsetY = point.y;
  state.velocityY = 0;
  setVisual("dragged", state.action, 0);
});

ipcMain.on("deskpet:pointer-up", () => {
  if (!state.dragging) {
    return;
  }

  state.dragging = false;
  state.velocityY = 0;
  setVisual("falling", actionsWithTag("active")[0]?.[0] || state.action, 0);
});

ipcMain.on("deskpet:click", () => {
  const now = Date.now();
  const withinTripleClickWindow = now - state.lastClickAt <= 750;
  state.clickCount = withinTripleClickWindow ? state.clickCount + 1 : 1;
  state.lastClickAt = now;

  if (state.clickCount >= 3) {
    state.clickCount = 0;
    beginSleep();
    return;
  }

  beginCelebrate();
});
