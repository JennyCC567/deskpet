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

console.log(`Asset manifest ok: ${Object.keys(manifest.actions).length} actions.`);
