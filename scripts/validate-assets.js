const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const petDir = path.join(root, "puppy");
const manifestPath = path.join(petDir, "manifest.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`Could not read ${manifestPath}: ${error.message}`);
}

if (!manifest.id || !manifest.displayName || !manifest.actions) {
  fail("Manifest must include id, displayName, and actions.");
}

const missing = [];
for (const [actionName, action] of Object.entries(manifest.actions)) {
  for (const key of ["still", "animated"]) {
    if (action[key] && !fs.existsSync(path.join(petDir, action[key]))) {
      missing.push(`${actionName}.${key}: ${action[key]}`);
    }
  }
}

if (missing.length > 0) {
  fail(`Missing assets:\n${missing.map((item) => `- ${item}`).join("\n")}`);
}

const invalidRefs = [];

function validateActionReference(scope, actionName) {
  if (!actionName || typeof actionName !== "string") {
    invalidRefs.push(`${scope} must reference an action name`);
    return;
  }

  if (!manifest.actions[actionName]) {
    invalidRefs.push(`${scope}: ${actionName}`);
  }
}

for (const [groupName, actionNames] of Object.entries(manifest.animationGroups || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`animationGroups.${groupName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    validateActionReference(`animationGroups.${groupName}`, actionName);
  }
}

for (const [stateName, actionNames] of Object.entries(manifest.stateMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`stateMappings.${stateName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    validateActionReference(`stateMappings.${stateName}`, actionName);
  }
}

for (const [interactionName, actionNames] of Object.entries(manifest.interactionMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`interactionMappings.${interactionName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    validateActionReference(`interactionMappings.${interactionName}`, actionName);
  }
}

for (const [fromPose, transitions] of Object.entries(manifest.poseTransitions || {})) {
  for (const [toPose, actionName] of Object.entries(transitions || {})) {
    validateActionReference(`poseTransitions.${fromPose}.${toPose}`, actionName);
  }
}

for (const [poseName, actionNames] of Object.entries(manifest.clickMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`clickMappings.${poseName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    validateActionReference(`clickMappings.${poseName}`, actionName);
  }
}

for (const [stepName, value] of Object.entries(manifest.dragSequence || {})) {
  if (stepName === "returnPose") {
    continue;
  }

  if (typeof value === "string") {
    validateActionReference(`dragSequence.${stepName}`, value);
  } else if (value && typeof value === "object") {
    for (const [key, actionName] of Object.entries(value)) {
      validateActionReference(`dragSequence.${stepName}.${key}`, actionName);
    }
  } else {
    invalidRefs.push(`dragSequence.${stepName} must be an action name or action map`);
  }
}

for (const [actionName, action] of Object.entries(manifest.actions)) {
  if (action.enterAction) {
    validateActionReference(`actions.${actionName}.enterAction`, action.enterAction);
  }

  if (action.exitAction) {
    validateActionReference(`actions.${actionName}.exitAction`, action.exitAction);
  }

  if (action.cycleNextAction) {
    validateActionReference(`actions.${actionName}.cycleNextAction`, action.cycleNextAction);
  }

  if (action.settleAction) {
    validateActionReference(`actions.${actionName}.settleAction`, action.settleAction);
  }

  for (const key of ["repeatCount", "repeatMin", "repeatMax"]) {
    if (action[key] !== undefined && (!Number.isFinite(action[key]) || action[key] < 1)) {
      invalidRefs.push(`actions.${actionName}.${key} must be a number >= 1`);
    }
  }
}

if (invalidRefs.length > 0) {
  fail(`Invalid manifest action references:\n${invalidRefs.map((item) => `- ${item}`).join("\n")}`);
}

console.log(`Asset manifest ok: ${Object.keys(manifest.actions).length} actions.`);
