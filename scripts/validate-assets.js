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
for (const [groupName, actionNames] of Object.entries(manifest.animationGroups || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`animationGroups.${groupName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    if (!manifest.actions[actionName]) {
      invalidRefs.push(`animationGroups.${groupName}: ${actionName}`);
    }
  }
}

for (const [stateName, actionNames] of Object.entries(manifest.stateMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`stateMappings.${stateName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    if (!manifest.actions[actionName]) {
      invalidRefs.push(`stateMappings.${stateName}: ${actionName}`);
    }
  }
}

for (const [interactionName, actionNames] of Object.entries(manifest.interactionMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`interactionMappings.${interactionName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    if (!manifest.actions[actionName]) {
      invalidRefs.push(`interactionMappings.${interactionName}: ${actionName}`);
    }
  }
}

for (const [fromPose, transitions] of Object.entries(manifest.poseTransitions || {})) {
  for (const [toPose, actionName] of Object.entries(transitions || {})) {
    if (!manifest.actions[actionName]) {
      invalidRefs.push(`poseTransitions.${fromPose}.${toPose}: ${actionName}`);
    }
  }
}

for (const [poseName, actionNames] of Object.entries(manifest.clickMappings || {})) {
  if (!Array.isArray(actionNames)) {
    invalidRefs.push(`clickMappings.${poseName} must be an array`);
    continue;
  }

  for (const actionName of actionNames) {
    if (!manifest.actions[actionName]) {
      invalidRefs.push(`clickMappings.${poseName}: ${actionName}`);
    }
  }
}

for (const [stepName, actionName] of Object.entries(manifest.dragSequence || {})) {
  if (stepName === "returnPose") {
    continue;
  }

  if (!manifest.actions[actionName]) {
    invalidRefs.push(`dragSequence.${stepName}: ${actionName}`);
  }
}

if (invalidRefs.length > 0) {
  fail(`Invalid manifest action references:\n${invalidRefs.map((item) => `- ${item}`).join("\n")}`);
}

console.log(`Asset manifest ok: ${Object.keys(manifest.actions).length} actions.`);
