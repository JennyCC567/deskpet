const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require("electron");
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
  baseIdleMinMs: 4500,
  baseIdleMaxMs: 9500,
  actionMinMs: 5000,
  actionMaxMs: 13000,
  wanderMinMs: 3000,
  wanderMaxMs: 8500,
  gravity: 1900,
  completionHoldMs: 6500,
  projectFreshMs: 30000,
  projectStatePollMs: 1000,
  statusBubble: true,
  statusBubblePinned: true
};

const LOGIC_TO_GROUP = {
  offline: "idle",
  idle: "idle",
  editing: "idle",
  in_progress: "taskInProgress",
  thinking: "taskInProgress",
  running_command: "taskInProgress",
  editing_files: "taskInProgress",
  waiting_approval: "taskInProgress",
  warning: "taskInProgress",
  error: "taskInProgress",
  bug_hunt: "bug",
  completed: "taskCompleted",
  interrupted: "idle"
};

const ACTIVE_PROJECT_STATES = new Set([
  "in_progress",
  "thinking",
  "running_command",
  "editing_files",
  "waiting_approval",
  "warning",
  "error",
  "bug_hunt"
]);
const TRANSIENT_PROJECT_STATES = new Set(["completed", "interrupted"]);

const config = readConfig();
const appRoot = process.env.DESKPET_ROOT || path.resolve(__dirname, "..");
const pidFile = process.env.DESKPET_PID_FILE || path.join(os.tmpdir(), "deskpet.pid");
const projectStateFile = process.env.DESKPET_PROJECT_STATE_FILE || "";
const manifest = readManifest();

let window;
let tray;
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
  action: manifest.defaultAction || "music",
  visualVariant: "still",
  pose: manifest.defaultPose || "sit",
  visualRevision: 0,
  timerMs: 2500,
  velocityY: 0,
  dragging: false,
  dragPhase: "",
  dragMotionEnabled: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  sleeping: false,
  clickCount: 0,
  lastClickAt: 0,
  logicState: projectStateFile ? "idle" : "offline",
  projectState: undefined,
  projectStateSeenAt: 0,
  projectEventKey: "",
  projectHoldUntil: 0,
  manualLogicState: undefined,
  pendingAction: undefined,
  pendingAfterHold: undefined,
  activeActionPlayback: undefined,
  statusText: projectStateFile ? "Deskpet is watching this workspace." : "Deskpet is running in desktop mode.",
  bubbleVisible: config.statusBubble !== false && config.statusBubblePinned !== false,
  bubblePinned: config.statusBubblePinned !== false,
  bubbleDurationMs: 0
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
      animationGroups: {
        idle: ["idle"],
        taskInProgress: ["idle"],
        taskCompleted: ["idle"]
      },
      stateMappings: {
        idle: ["idle"],
        in_progress: ["idle"],
        completed: ["idle"]
      },
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
    logicState: state.logicState,
    action: state.action,
    visualVariant: state.visualVariant,
    pose: state.pose,
    visualRevision: state.visualRevision,
    direction: state.direction,
    projectState: state.projectState,
    bubble: {
      text: state.statusText,
      visible: state.bubbleVisible && Boolean(state.statusText),
      pinned: state.bubblePinned,
      durationMs: state.bubblePinned ? 0 : state.bubbleDurationMs,
      state: state.logicState
    },
    ...extra
  });

  refreshTrayMenu();
}

function actionEntriesFromNames(names) {
  const seen = new Set();
  return (Array.isArray(names) ? names : [])
    .filter((name) => {
      if (!manifest.actions?.[name] || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .map((name) => [name, manifest.actions[name]]);
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

function resolveAction(actionName) {
  return manifest.actions?.[actionName];
}

function actionDuration(actionName, fallbackMs) {
  const duration = resolveAction(actionName)?.durationMs;
  return Number.isFinite(duration) && duration >= 0 ? duration : fallbackMs;
}

function actionPose(actionName) {
  return resolveAction(actionName)?.pose;
}

function actionNextPose(actionName) {
  return resolveAction(actionName)?.nextPose || actionPose(actionName);
}

function actionFromPose(actionName) {
  return resolveAction(actionName)?.fromPose;
}

function actionSettleAction(actionName) {
  return resolveAction(actionName)?.settleAction;
}

function actionEnterAction(actionName) {
  return resolveAction(actionName)?.enterAction;
}

function actionExitAction(actionName) {
  return resolveAction(actionName)?.exitAction;
}

function actionCycleNextAction(actionName) {
  return resolveAction(actionName)?.cycleNextAction;
}

function actionHoldDuration(actionName, fallbackMs = 0) {
  const duration = resolveAction(actionName)?.holdMs;
  return Number.isFinite(duration) && duration >= 0 ? duration : fallbackMs;
}

function actionIsLooping(actionName) {
  return resolveAction(actionName)?.loop !== false;
}

function actionRepeatCount(actionName, options = {}) {
  const action = resolveAction(actionName) || {};
  const min = Number.isFinite(options.repeatMin)
    ? options.repeatMin
    : Number.isFinite(action.repeatMin)
      ? action.repeatMin
      : Number.isFinite(action.repeatCount)
        ? action.repeatCount
        : 1;
  const max = Number.isFinite(options.repeatMax)
    ? options.repeatMax
    : Number.isFinite(action.repeatMax)
      ? action.repeatMax
      : min;
  const low = Math.max(1, Math.floor(Math.min(min, max)));
  const high = Math.max(low, Math.floor(Math.max(min, max)));

  return Math.floor(randomBetween(low, high + 1));
}

function visualVariantForAction(actionName, preferredVariant = "animated") {
  const action = resolveAction(actionName);
  if (!action) {
    return "still";
  }

  if (preferredVariant === "still" || !action.animated) {
    return "still";
  }

  return "animated";
}

function baseActionForPose(pose) {
  const baseEntries = actionEntriesFromNames(manifest.animationGroups?.baseIdle);
  return baseEntries.find(([, item]) => item.pose === pose)?.[0]
    || baseEntries.find(([, item]) => item.pose)?.[0]
    || Object.entries(manifest.actions || {}).find(([, item]) => item.pose === pose)?.[0]
    || manifest.defaultAction
    || state.action;
}

function entriesForGroup(groupName) {
  return actionEntriesFromNames(manifest.animationGroups?.[groupName]);
}

function entriesForLogic(logicState) {
  const mapped = actionEntriesFromNames(manifest.stateMappings?.[logicState]);
  if (mapped.length > 0) {
    return mapped;
  }

  const grouped = entriesForGroup(LOGIC_TO_GROUP[logicState]);
  if (grouped.length > 0) {
    return grouped;
  }

  if (logicState === "completed") {
    return actionsWithTag("celebrate");
  }

  if (logicState === "idle" || logicState === "offline") {
    return actionsWithTag("idle");
  }

  return Object.entries(manifest.actions || {}).filter(([, item]) => item.loop !== false);
}

function entriesForInteraction(interactionName) {
  const mapped = actionEntriesFromNames(manifest.interactionMappings?.[interactionName]);
  if (mapped.length > 0) {
    return mapped;
  }

  const grouped = entriesForGroup("interaction");
  if (grouped.length > 0) {
    return grouped;
  }

  return Object.entries(manifest.actions || {});
}

function logicTimerMs(logicState) {
  if (logicState === "completed") {
    return config.completionHoldMs;
  }

  if (logicState === "error" || logicState === "waiting_approval") {
    return randomBetween(6500, 10000);
  }

  if (logicState === "warning") {
    return randomBetween(5000, 8500);
  }

  if (ACTIVE_PROJECT_STATES.has(logicState)) {
    return randomBetween(config.actionMinMs, config.actionMaxMs);
  }

  return randomBetween(config.idleMinMs, config.idleMaxMs);
}

function setVisual(mode, action, timerMs, options = {}) {
  state.mode = mode;
  state.action = action || state.action;
  state.visualVariant = visualVariantForAction(state.action, options.visualVariant || "animated");
  state.visualRevision += 1;
  const nextPose = actionNextPose(state.action);
  if (nextPose && options.updatePose !== false) {
    state.pose = nextPose;
  }
  state.timerMs = timerMs;
  sendState();
}

function clearPendingAction() {
  state.pendingAction = undefined;
}

function clearPendingAfterHold() {
  state.pendingAfterHold = undefined;
}

function clearActiveActionPlayback() {
  state.activeActionPlayback = undefined;
}

function replayActiveAction(actionPlayback) {
  if (!actionPlayback || !resolveAction(actionPlayback.action)) {
    chooseNextMode();
    return;
  }

  state.activeActionPlayback = actionPlayback;
  setVisual(actionPlayback.mode, actionPlayback.action, actionPlayback.playbackMs, {
    visualVariant: "animated"
  });
}

function beginTimedAction(mode, action, timerMs = actionDuration(action, config.actionMinMs), options = {}) {
  const actionDef = resolveAction(action);
  if (!actionDef) {
    chooseNextMode();
    return;
  }

  clearPendingAfterHold();
  clearActiveActionPlayback();
  const fromPose = options.allowPoseTransition === false ? undefined : actionFromPose(action);
  if (fromPose && fromPose !== state.pose) {
    const transition = transitionAction(state.pose, fromPose);
    if (transition && resolveAction(transition)) {
      state.pendingAction = {
        mode,
        action,
        timerMs,
        options: {
          ...options,
          allowPoseTransition: false
        }
      };
      beginPoseTransition(fromPose);
      return;
    }

    state.pose = fromPose;
  }

  const enterAction = options.allowEnterTransition === false ? undefined : actionEnterAction(action);
  if (enterAction && resolveAction(enterAction)) {
    state.pendingAction = {
      mode,
      action,
      timerMs,
      options: {
        ...options,
        allowPoseTransition: false,
        allowEnterTransition: false
      }
    };
    setVisual("action_enter", enterAction, actionDuration(enterAction, 1000), { visualVariant: "animated" });
    return;
  }

  clearPendingAction();
  const playbackMs = actionIsLooping(action)
    ? timerMs
    : actionDuration(action, timerMs);
  const repeatCount = actionIsLooping(action) ? 1 : actionRepeatCount(action, options);
  state.activeActionPlayback = actionIsLooping(action)
    ? undefined
    : {
      mode,
      action,
      playbackMs,
      remainingPlays: Math.max(0, repeatCount - 1)
    };
  setVisual(mode, action, playbackMs, {
    ...options,
    visualVariant: options.visualVariant || "animated"
  });
}

function settleAfterAction() {
  clearPendingAction();
  const completedAction = state.action;
  const actionDef = resolveAction(completedAction);
  const exitAction = actionExitAction(completedAction);
  const settleAction = actionSettleAction(completedAction);
  const cycleNextAction = actionCycleNextAction(completedAction);
  const nextPose = actionNextPose(completedAction);
  const holdMs = actionHoldDuration(completedAction, 0);
  const actionPlayback = state.activeActionPlayback?.action === completedAction
    ? { ...state.activeActionPlayback }
    : undefined;

  if (nextPose) {
    state.pose = nextPose;
  }

  if (holdMs > 0 && actionDef?.still && state.visualVariant !== "still") {
    state.pendingAfterHold = {
      exitAction,
      settleAction,
      nextPose,
      actionPlayback
    };
    setVisual("action_hold", completedAction, holdMs, {
      visualVariant: "still",
      updatePose: false
    });
    return;
  }

  if (actionPlayback?.remainingPlays > 0) {
    replayActiveAction({
      ...actionPlayback,
      remainingPlays: actionPlayback.remainingPlays - 1
    });
    return;
  }

  clearActiveActionPlayback();
  if (cycleNextAction && resolveAction(cycleNextAction) && shouldUseProjectVisual(state.logicState)) {
    beginTimedAction(state.mode, cycleNextAction, logicTimerMs(state.logicState));
    return;
  }

  if (exitAction && resolveAction(exitAction)) {
    setVisual("action_exit", exitAction, actionDuration(exitAction, 1000), { visualVariant: "animated" });
    return;
  }

  if (settleAction && resolveAction(settleAction)) {
    beginPoseIdle(actionPose(settleAction) || nextPose || state.pose);
    return;
  }

  chooseNextMode();
}

function finishActionHold() {
  const afterHold = state.pendingAfterHold;
  clearPendingAfterHold();

  if (afterHold?.nextPose) {
    state.pose = afterHold.nextPose;
  }

  if (afterHold?.actionPlayback?.remainingPlays > 0) {
    replayActiveAction({
      ...afterHold.actionPlayback,
      remainingPlays: afterHold.actionPlayback.remainingPlays - 1
    });
    return;
  }

  clearActiveActionPlayback();
  if (afterHold?.actionPlayback?.action) {
    const cycleNextAction = actionCycleNextAction(afterHold.actionPlayback.action);
    if (cycleNextAction && resolveAction(cycleNextAction) && shouldUseProjectVisual(state.logicState)) {
      beginTimedAction(afterHold.actionPlayback.mode, cycleNextAction, logicTimerMs(state.logicState));
      return;
    }
  }

  if (afterHold?.exitAction && resolveAction(afterHold.exitAction)) {
    setVisual("action_exit", afterHold.exitAction, actionDuration(afterHold.exitAction, 1000), { visualVariant: "animated" });
    return;
  }

  if (afterHold?.settleAction && resolveAction(afterHold.settleAction)) {
    beginPoseIdle(actionPose(afterHold.settleAction) || afterHold.nextPose || state.pose);
    return;
  }

  chooseNextMode();
}

function beginMappedState(logicState, timerMs = logicTimerMs(logicState)) {
  const action = weightedAction(entriesForLogic(logicState));
  beginTimedAction(logicState, action, timerMs);
}

function beginPoseIdle(pose = state.pose, timerMs = randomBetween(config.baseIdleMinMs, config.baseIdleMaxMs)) {
  clearPendingAction();
  clearPendingAfterHold();
  clearActiveActionPlayback();
  const action = baseActionForPose(pose);
  state.pose = actionPose(action) || pose || state.pose;
  setVisual("idle", action, timerMs, { visualVariant: "still" });
}

function transitionAction(fromPose, toPose) {
  return manifest.poseTransitions?.[fromPose]?.[toPose];
}

function beginPoseTransition(toPose) {
  clearActiveActionPlayback();
  if (!toPose || toPose === state.pose) {
    beginPoseIdle(state.pose);
    return;
  }

  const action = transitionAction(state.pose, toPose);
  if (!action || !manifest.actions?.[action]) {
    beginPoseIdle(toPose);
    return;
  }

  setVisual("pose_transition", action, actionDuration(action, 1000), { visualVariant: "animated" });
}

function chooseNextBaseIdle() {
  const baseEntries = actionEntriesFromNames(manifest.animationGroups?.baseIdle);
  const basePoses = baseEntries
    .map(([name, item]) => item.pose || name)
    .filter(Boolean);
  const uniquePoses = Array.from(new Set(basePoses));

  if (uniquePoses.length <= 1) {
    beginPoseIdle(uniquePoses[0] || state.pose);
    return;
  }

  const shouldSwitchPose = Math.random() < 0.58;
  const nextPose = shouldSwitchPose
    ? uniquePoses.filter((pose) => pose !== state.pose)[Math.floor(Math.random() * Math.max(1, uniquePoses.length - 1))]
    : state.pose;

  beginPoseTransition(nextPose || state.pose);
}

function beginIdle() {
  if (!state.manualLogicState) {
    state.logicState = state.projectState ? state.logicState : "offline";
  }
  chooseNextBaseIdle();
}

function beginAction() {
  const action = weightedAction(entriesForGroup("ambientIdle"));
  beginTimedAction("action", action, randomBetween(config.actionMinMs, config.actionMaxMs));
}

function beginWander() {
  const action = weightedAction(entriesForGroup("ambientIdle"));
  state.direction = Math.random() < 0.5 ? -1 : 1;
  beginTimedAction("wander", action, randomBetween(config.wanderMinMs, config.wanderMaxMs));
}

function beginInteraction(interactionName, timerMs = 2600) {
  const action = weightedAction(entriesForInteraction(interactionName));
  beginTimedAction(`interaction:${interactionName}`, action, timerMs);
}

function beginClickReaction() {
  const mappings = manifest.clickMappings || {};
  const action = weightedAction(actionEntriesFromNames(mappings[state.pose]));

  if (action && resolveAction(action)) {
    beginTimedAction("click_reaction", action, actionDuration(action, 1800));
    return;
  }

  const fallback = weightedAction(actionEntriesFromNames(mappings.default));
  beginPoseTransition(actionPose(fallback) || fallback || state.pose);
}

function beginAmbientClickSwitch() {
  const mappings = manifest.clickMappings || {};
  const action = weightedAction(actionEntriesFromNames(mappings.ambient || mappings.default));
  const nextPose = actionPose(action);

  if (nextPose) {
    beginPoseTransition(nextPose);
    return;
  }

  beginTimedAction("action", action, actionDuration(action, randomBetween(config.actionMinMs, config.actionMaxMs)));
}

function beginDragLift() {
  const action = manifest.dragSequence?.liftByPose?.[state.pose]
    || manifest.dragSequence?.lift
    || "sit_lift_up";
  state.dragPhase = "lift";
  state.dragMotionEnabled = false;
  beginTimedAction("drag_lift", action, actionDuration(action, 1000), { allowPoseTransition: false });
}

function beginDragSway() {
  clearPendingAction();
  clearPendingAfterHold();
  clearActiveActionPlayback();
  const action = manifest.dragSequence?.dragging || "sway";
  state.dragPhase = "sway";
  state.dragMotionEnabled = true;
  setVisual("drag_sway", action, 0, { visualVariant: "animated", updatePose: false });
}

function beginDragDrop() {
  const action = manifest.dragSequence?.drop || "put_down";
  state.dragPhase = "drop";
  state.dragMotionEnabled = false;
  beginTimedAction("drag_drop", action, actionDuration(action, 1000), { allowPoseTransition: false });
}

function beginSleep() {
  clearPendingAction();
  clearPendingAfterHold();
  clearActiveActionPlayback();
  const action = weightedAction(entriesForInteraction("sleep"));
  setVisual("sleep", action, randomBetween(7000, 15000), { visualVariant: "still" });
}

function shouldUseProjectVisual(logicState) {
  if (state.manualLogicState === logicState) {
    if (TRANSIENT_PROJECT_STATES.has(logicState)) {
      return Date.now() <= state.projectHoldUntil;
    }

    return ACTIVE_PROJECT_STATES.has(logicState);
  }

  if (!state.projectState || Date.now() - state.projectStateSeenAt > config.projectFreshMs) {
    return false;
  }

  if (TRANSIENT_PROJECT_STATES.has(logicState)) {
    return Date.now() <= state.projectHoldUntil;
  }

  return ACTIVE_PROJECT_STATES.has(logicState);
}

function chooseNextMode() {
  if (state.sleeping) {
    beginSleep();
    return;
  }

  if (shouldUseProjectVisual(state.logicState)) {
    beginMappedState(state.logicState);
    return;
  }

  const roll = Math.random();
  if (roll < 0.14) {
    beginWander();
  } else if (roll < 0.28) {
    beginSleep();
  } else if (roll < 0.62) {
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

function toKey(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");
}

function normalizeLogicState(value) {
  const key = toKey(value);
  const aliases = {
    active: "in_progress",
    busy: "in_progress",
    working: "in_progress",
    running: "in_progress",
    task_started: "in_progress",
    task_running: "in_progress",
    started: "in_progress",
    model_started: "thinking",
    model_thinking: "thinking",
    command_started: "running_command",
    command_running: "running_command",
    terminal_started: "running_command",
    terminal_command_started: "running_command",
    tool_started: "running_command",
    pre_tool_use: "running_command",
    post_tool_use: "in_progress",
    bug: "bug_hunt",
    bughunt: "bug_hunt",
    caterpillar: "bug_hunt",
    target_spawn: "bug_hunt",
    patch_started: "editing_files",
    file_changed: "editing_files",
    file_saved: "editing",
    edit_started: "editing_files",
    editing_file: "editing_files",
    permission_request: "waiting_approval",
    waiting_for_approval: "waiting_approval",
    approval_needed: "waiting_approval",
    done: "completed",
    success: "completed",
    succeeded: "completed",
    passed: "completed",
    pass: "completed",
    tests_passed: "completed",
    task_ended: "completed",
    task_completed: "completed",
    terminal_ended: "completed",
    command_completed: "completed",
    failed: "error",
    failure: "error",
    task_failed: "error",
    tests_failed: "error",
    terminal_failed: "error",
    command_failed: "error",
    stopped: "interrupted",
    cancelled: "interrupted",
    canceled: "interrupted"
  };

  if (aliases[key]) {
    return aliases[key];
  }

  if (Object.prototype.hasOwnProperty.call(LOGIC_TO_GROUP, key)) {
    return key;
  }

  return undefined;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function inferProjectLogic(projectState) {
  if (!projectState) {
    return "offline";
  }

  const explicit = firstDefined(
    projectState.deskpet?.state,
    projectState.runtime?.state,
    projectState.codex?.state,
    projectState.task?.state,
    projectState.state,
    projectState.status
  );
  const explicitLogic = normalizeLogicState(explicit);
  if (explicitLogic) {
    return explicitLogic;
  }

  const taskStatus = normalizeLogicState(projectState.task?.status);
  if (projectState.task?.activeCount > 0 || taskStatus === "in_progress" || taskStatus === "running_command") {
    return taskStatus || "in_progress";
  }
  if (taskStatus === "error" || taskStatus === "completed" || taskStatus === "interrupted") {
    return taskStatus;
  }

  const terminalStatus = normalizeLogicState(projectState.terminal?.status);
  if (terminalStatus === "running_command" || terminalStatus === "in_progress") {
    return "running_command";
  }
  if (terminalStatus === "error" || terminalStatus === "completed") {
    return terminalStatus;
  }

  const debugStatus = normalizeLogicState(projectState.debug?.status);
  if (projectState.debug?.activeCount > 0 || debugStatus === "in_progress") {
    return "in_progress";
  }

  const activityEvent = normalizeLogicState(projectState.activity?.lastEvent);
  if (activityEvent && activityEvent !== "editing") {
    if (activityEvent === "completed" && projectState.task?.lastExitCode && projectState.task.lastExitCode !== 0) {
      return "error";
    }
    return activityEvent;
  }

  const errors = projectState.diagnostics?.errors || 0;
  const warnings = projectState.diagnostics?.warnings || 0;
  if (errors > 0) {
    return "error";
  }
  if (warnings > 0) {
    return "warning";
  }

  if (projectState.activity?.activeFile) {
    return "editing";
  }

  return "idle";
}

function buildProjectEventKey(projectState, logicState) {
  const activity = projectState?.activity || {};
  const task = projectState?.task || {};
  const terminal = projectState?.terminal || {};
  const debug = projectState?.debug || {};
  const diagnostics = projectState?.diagnostics || {};

  return [
    logicState,
    activity.eventId,
    activity.lastEvent,
    activity.message,
    task.status,
    task.activeCount,
    task.lastExitCode,
    terminal.status,
    terminal.exitCode,
    debug.status,
    debug.activeCount,
    diagnostics.errors,
    diagnostics.warnings
  ].join("|");
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function compactText(text, maxLength = 54) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function formatProjectStatus(projectState, logicState) {
  const activityMessage = compactText(projectState?.activity?.message);
  if (activityMessage) {
    return activityMessage;
  }

  const codexMessage = compactText(projectState?.codex?.message);
  if (codexMessage) {
    return codexMessage;
  }

  const errors = projectState?.diagnostics?.errors || 0;
  const warnings = projectState?.diagnostics?.warnings || 0;
  const dirtyFiles = projectState?.git?.dirtyFiles || 0;
  const activeFile = compactText(projectState?.activity?.activeFile, 42);
  const taskName = compactText(projectState?.task?.name || projectState?.task?.current, 42);
  const command = compactText(projectState?.terminal?.command, 42);

  if (logicState === "waiting_approval") {
    return "Waiting for approval.";
  }
  if (logicState === "running_command") {
    return command ? `Running: ${command}` : "Running a terminal command.";
  }
  if (logicState === "in_progress" || logicState === "thinking" || logicState === "editing_files") {
    return taskName ? `Working on: ${taskName}` : "Task in progress.";
  }
  if (logicState === "completed") {
    return taskName ? `Completed: ${taskName}` : "Task completed.";
  }
  if (logicState === "error") {
    if (errors > 0) {
      return `${plural(errors, "error")} in workspace.`;
    }
    return "Task needs attention.";
  }
  if (logicState === "bug_hunt") {
    return "Caterpillar spotted.";
  }
  if (logicState === "warning") {
    return `${plural(warnings, "warning")} in workspace.`;
  }
  if (logicState === "editing") {
    return activeFile ? `Editing: ${activeFile}` : "Editing workspace.";
  }
  if (dirtyFiles > 0) {
    return `${plural(dirtyFiles, "changed file")}.`;
  }
  if (projectState?.git?.branch) {
    return `${projectState.git.branch} is ready.`;
  }

  return projectStateFile ? "Workspace is ready." : "Deskpet is running.";
}

function syncBubbleVisibility(logicState, changed) {
  if (config.statusBubble === false) {
    state.bubbleVisible = false;
    return;
  }

  if (state.bubblePinned) {
    state.bubbleVisible = true;
    state.bubbleDurationMs = 0;
    return;
  }

  if (changed || logicState !== "idle") {
    state.bubbleVisible = true;
    state.bubbleDurationMs = logicState === "completed" ? 4400 : 3000;
  }
}

function applyProjectState(projectState) {
  const nextLogic = inferProjectLogic(projectState);
  const nextEventKey = buildProjectEventKey(projectState, nextLogic);
  const logicChanged = nextLogic !== state.logicState;
  const eventChanged = nextEventKey !== state.projectEventKey;

  state.manualLogicState = undefined;
  state.projectState = projectState;
  state.projectStateSeenAt = Date.now();
  state.logicState = nextLogic;
  state.projectEventKey = nextEventKey;
  state.statusText = formatProjectStatus(projectState, nextLogic);

  if (TRANSIENT_PROJECT_STATES.has(nextLogic) && (logicChanged || eventChanged)) {
    state.projectHoldUntil = Date.now() + config.completionHoldMs;
  }

  syncBubbleVisibility(nextLogic, logicChanged || eventChanged);

  const shouldSwitchVisual = shouldUseProjectVisual(nextLogic)
    && !state.dragging
    && state.mode !== "falling"
    && !state.sleeping
    && (logicChanged || eventChanged || state.mode === "idle" || state.mode === "action" || state.mode === "wander");

  if (shouldSwitchVisual) {
    beginMappedState(nextLogic);
    return;
  }

  sendState();
}

function showStatusBubble(durationMs = 2600) {
  if (!state.statusText) {
    return;
  }

  state.bubbleVisible = true;
  state.bubbleDurationMs = state.bubblePinned ? 0 : durationMs;
  sendState();
}

function hideStatusBubble() {
  state.bubbleVisible = false;
  state.bubblePinned = false;
  sendState();
}

function toggleStatusBubble() {
  state.bubbleVisible = !state.bubbleVisible;
  if (!state.bubbleVisible) {
    state.bubblePinned = false;
  }
  sendState();
}

function toggleBubblePin() {
  state.bubblePinned = !state.bubblePinned;
  state.bubbleVisible = state.bubblePinned || state.bubbleVisible;
  state.bubbleDurationMs = state.bubblePinned ? 0 : 2600;
  sendState();
}

function setManualLogic(logicState) {
  state.sleeping = false;
  state.manualLogicState = logicState;
  state.logicState = logicState;
  state.statusText = formatProjectStatus(state.projectState, logicState);
  syncBubbleVisibility(logicState, true);
  if (TRANSIENT_PROJECT_STATES.has(logicState)) {
    state.projectHoldUntil = Date.now() + config.completionHoldMs;
  }
  beginMappedState(logicState);
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

  if (state.dragging && state.dragMotionEnabled) {
    const cursor = screen.getCursorScreenPoint();
    state.x = clamp(cursor.x - state.dragOffsetX, area.x, area.x + area.width - state.width);
    state.y = clamp(cursor.y - state.dragOffsetY, area.y, area.y + area.height - state.height);
    moveWindow();
    return;
  } else if (state.dragging) {
    state.timerMs -= dt * 1000;
    if (state.dragPhase === "lift" && state.timerMs <= 0) {
      beginDragSway();
    }
    moveWindow();
    return;
  }

  if (state.mode === "drag_drop") {
    state.timerMs -= dt * 1000;
    if (state.timerMs <= 0) {
      settleAfterAction();
    }
    moveWindow();
    return;
  }

  if (state.mode === "falling") {
    state.velocityY += config.gravity * dt;
    state.y += state.velocityY * dt;

    if (state.y >= floorY) {
      state.y = floorY;
      state.velocityY = 0;
      chooseNextMode();
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
    if (state.mode === "pose_transition" || state.mode === "action_enter") {
      const pending = state.pendingAction;
      if (pending) {
        state.pendingAction = undefined;
        beginTimedAction(pending.mode, pending.action, pending.timerMs, pending.options);
        moveWindow();
        return;
      }

      beginPoseIdle(state.pose);
      moveWindow();
      return;
    }

    if (state.mode === "action_hold") {
      finishActionHold();
      moveWindow();
      return;
    }

    if (resolveAction(state.action)?.loop === false) {
      settleAfterAction();
      moveWindow();
      return;
    }

    chooseNextMode();
  }

  moveWindow();
}

function resolveTrayImage() {
  const preferredAction = manifest.actions?.[manifest.defaultAction] || Object.values(manifest.actions || {})[0];
  const iconFile = preferredAction?.still || preferredAction?.animated;
  if (!iconFile) {
    return nativeImage.createEmpty();
  }

  const iconPath = path.join(appRoot, config.petDir, iconFile);
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return image;
  }

  return image.resize({ width: 18, height: 18 });
}

function showPetWindow() {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.showInactive();
  keepInsideWorkArea();
  moveWindow();
  showStatusBubble(1800);
}

function hidePetWindow() {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.hide();
}

function quitDeskpet() {
  removePidFile();
  app.quit();
}

function buildPetMenuTemplate() {
  const visible = Boolean(window && !window.isDestroyed() && window.isVisible());
  return [
    {
      label: visible ? "Hide Deskpet" : "Show Deskpet",
      click: () => {
        if (visible) {
          hidePetWindow();
        } else {
          showPetWindow();
        }
      }
    },
    {
      label: "Show Status Bubble",
      type: "checkbox",
      checked: state.bubbleVisible,
      click: () => toggleStatusBubble()
    },
    {
      label: "Pin Status Bubble",
      type: "checkbox",
      checked: state.bubblePinned,
      click: () => toggleBubblePin()
    },
    { type: "separator" },
    {
      label: "State",
      submenu: [
        {
          label: "Idle",
          click: () => setManualLogic("idle")
        },
        {
          label: "Task In Progress",
          click: () => setManualLogic("in_progress")
        },
        {
          label: "Task Completed",
          click: () => setManualLogic("completed")
        },
        {
          label: "Bug Hunt",
          click: () => setManualLogic("bug_hunt")
        },
        {
          label: "Random Idle Action",
          click: () => {
            state.sleeping = false;
            state.manualLogicState = undefined;
            beginAction();
          }
        }
      ]
    },
    {
      label: state.sleeping ? "Wake" : "Sleep",
      click: () => {
        state.sleeping = !state.sleeping;
        if (state.sleeping) {
          beginSleep();
        } else {
          chooseNextMode();
        }
      }
    },
    { type: "separator" },
    {
      label: "Quit Deskpet",
      click: quitDeskpet
    }
  ];
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(Menu.buildFromTemplate(buildPetMenuTemplate()));
  }
}

function createTray() {
  tray = new Tray(resolveTrayImage());
  tray.setToolTip("Deskpet");
  tray.on("click", showPetWindow);
  refreshTrayMenu();
}

function showPetContextMenu() {
  if (!window || window.isDestroyed()) {
    return;
  }

  const menu = Menu.buildFromTemplate(buildPetMenuTemplate());
  menu.popup({ window });
  refreshTrayMenu();
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
    applyProjectState(JSON.parse(raw));
  } catch {
    // The editor bridge is optional; missing or partial state is fine.
  }
}

app.whenReady().then(() => {
  writePidFile();
  createWindow();
  createTray();
  tickHandle = setInterval(tick, 16);
  projectStateHandle = setInterval(readProjectState, Math.max(250, config.projectStatePollMs));
});

app.on("activate", showPetWindow);

app.on("second-instance", showPetWindow);

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
  showStatusBubble(2400);
});

ipcMain.on("deskpet:pointer-down", (_event, point) => {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  state.dragging = true;
  state.dragPhase = "lift";
  state.dragMotionEnabled = false;
  state.dragOffsetX = point.x;
  state.dragOffsetY = point.y;
  state.velocityY = 0;
  state.sleeping = false;
  beginDragLift();
});

ipcMain.on("deskpet:pointer-up", () => {
  if (!state.dragging) {
    return;
  }

  state.dragging = false;
  state.dragMotionEnabled = false;
  state.velocityY = 0;
  beginDragDrop();
});

ipcMain.on("deskpet:click", () => {
  const now = Date.now();
  const withinClickWindow = now - state.lastClickAt <= 520;
  state.clickCount = withinClickWindow ? state.clickCount + 1 : 1;
  state.lastClickAt = now;
  state.sleeping = false;

  if (state.clickCount >= 3) {
    state.clickCount = 0;
    state.sleeping = true;
    beginSleep();
    return;
  }

  if (state.clickCount === 2) {
    toggleBubblePin();
    beginClickReaction();
    return;
  }

  showStatusBubble(2600);
  if (state.mode === "idle" && (state.pose === "sit" || state.pose === "lie")) {
    beginClickReaction();
  } else {
    beginAmbientClickSwitch();
  }
});

ipcMain.on("deskpet:long-press", () => {
  showStatusBubble(3200);
});

ipcMain.on("deskpet:context-menu", showPetContextMenu);
