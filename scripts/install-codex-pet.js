#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 11;
const ATLAS_WIDTH = CELL_WIDTH * COLUMNS;
const ATLAS_HEIGHT = CELL_HEIGHT * ROWS;

const ROW_DEFINITIONS = [
  { name: "idle", action: "sit" },
  { name: "running-right", action: "sway" },
  { name: "running-left", action: "sway", flop: true },
  { name: "waving", action: "wave" },
  // Codex native hover only exposes five timed slots and loops them. Keep a
  // short lift-up lead-in, then spend the remaining slots on the lifted hold.
  {
    name: "jumping",
    action: "sit_lift_up",
    framePages: [0, 13, 0, 0, 0, 0, 0, 0],
    cellAssets: {
      2: "pet_11_lifted.png",
      3: "pet_11_lifted.png",
      4: "pet_11_lifted.png",
      5: "pet_11_lifted.png",
      6: "pet_11_lifted.png",
      7: "pet_11_lifted.png"
    }
  },
  { name: "failed", action: "caterpillar" },
  { name: "waiting", action: "caterpillar" },
  { name: "running", action: "cycling" },
  { name: "review", action: "reading" },
  { name: "look-000-to-157", action: "sit" },
  { name: "look-180-to-337", action: "sit" }
];

function usage() {
  console.log(`Usage: node scripts/install-codex-pet.js [options]

Options:
  --source <path>      Deskpet repository path. Defaults to this repository.
  --codex-home <path>  Codex home directory. Defaults to $CODEX_HOME or ~/.codex.
  --id <id>            Codex pet id. Defaults to puppy.
  --display-name <n>   Display name. Defaults to the Deskpet manifest name.
  --no-select          Install files only, without changing selected-avatar-id.
  --print              Print paths without writing files.
  --help               Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    source: path.resolve(__dirname, ".."),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    id: "puppy",
    displayName: "",
    select: true,
    print: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      options.help = true;
    } else if (value === "--no-select") {
      options.select = false;
    } else if (value === "--print") {
      options.print = true;
    } else if (value === "--source") {
      options.source = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--codex-home") {
      options.codexHome = path.resolve(readOptionValue(argv, ++index, value));
    } else if (value === "--id") {
      options.id = normalizeId(readOptionValue(argv, ++index, value));
    } else if (value === "--display-name") {
      options.displayName = readOptionValue(argv, ++index, value);
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  options.petDir = path.join(options.codexHome, "pets", options.id);
  options.spritePath = path.join(options.petDir, "spritesheet.webp");
  options.manifestPath = path.join(options.petDir, "pet.json");
  options.configPath = path.join(options.codexHome, "config.toml");
  options.avatarId = `custom:${options.id}`;
  return options;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function normalizeId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Pet id cannot be empty.");
  }
  return id;
}

function loadSharp() {
  const candidates = [
    () => require("sharp"),
    () => Module.createRequire("/Applications/Codex.app/Contents/Resources/cua_node/lib/node_modules/")("sharp")
  ];

  const errors = [];
  for (const load of candidates) {
    try {
      return load();
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(`Could not load sharp. Install it locally or run from Codex Desktop's bundled Node environment.\n${errors.join("\n")}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveActionAsset(sourceDir, manifest, actionName) {
  const action = manifest.actions?.[actionName];
  if (!action) {
    throw new Error(`Missing action in puppy manifest: ${actionName}`);
  }

  const asset = action.animated || action.still;
  if (!asset) {
    throw new Error(`Action ${actionName} has no asset.`);
  }

  const assetPath = path.join(sourceDir, "puppy", asset);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing asset for ${actionName}: ${assetPath}`);
  }

  return assetPath;
}

function resolvePuppyAsset(sourceDir, asset) {
  const assetPath = path.join(sourceDir, "puppy", asset);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing puppy asset: ${assetPath}`);
  }

  return assetPath;
}

async function sourceMetadata(sharp, assetPath) {
  return sharp(assetPath, { animated: true }).metadata();
}

function pageForColumn(metadata, column, definition = {}) {
  const pages = metadata.pages || 1;
  if (pages <= 1) {
    return 0;
  }
  const explicitPage = definition.framePages?.[column];
  if (Number.isFinite(explicitPage)) {
    return Math.min(pages - 1, Math.max(0, Math.round(explicitPage)));
  }
  return Math.min(pages - 1, Math.round((column / (COLUMNS - 1)) * (pages - 1)));
}

async function makeCell(sharp, assetPath, metadata, column, options = {}) {
  const page = pageForColumn(metadata, column, options);
  const frame = sharp(assetPath, { page, pages: 1 })
    .ensureAlpha()
    .resize(CELL_WIDTH, CELL_HEIGHT, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    });

  if (options.flop) {
    frame.flop();
  }

  return frame.webp({ lossless: true }).toBuffer();
}

async function buildAtlas(sharp, options, manifest) {
  const cache = new Map();
  const composites = [];

  for (let row = 0; row < ROW_DEFINITIONS.length; row += 1) {
    const definition = ROW_DEFINITIONS[row];
    const rowAssetPath = resolveActionAsset(options.source, manifest, definition.action);

    for (let column = 0; column < COLUMNS; column += 1) {
      const assetPath = definition.cellAssets?.[column]
        ? resolvePuppyAsset(options.source, definition.cellAssets[column])
        : rowAssetPath;
      let metadata = cache.get(assetPath);
      if (!metadata) {
        metadata = await sourceMetadata(sharp, assetPath);
        cache.set(assetPath, metadata);
      }
      const input = await makeCell(sharp, assetPath, metadata, column, definition);
      composites.push({
        input,
        left: column * CELL_WIDTH,
        top: row * CELL_HEIGHT
      });
    }
  }

  return sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .webp({ lossless: true })
    .toBuffer();
}

function petManifest(options, manifest) {
  return {
    id: options.id,
    displayName: options.displayName || manifest.displayName || "Puppy",
    description: manifest.description || "Transparent puppy companion for Codex.",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp"
  };
}

function writeConfigSelection(options) {
  const selectedLine = `selected-avatar-id = "${options.avatarId}"`;
  let config = "";
  try {
    config = fs.readFileSync(options.configPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (!config.trim()) {
    fs.mkdirSync(path.dirname(options.configPath), { recursive: true });
    fs.writeFileSync(options.configPath, `[desktop]\n${selectedLine}\n`, "utf8");
    return;
  }

  const backupPath = `${options.configPath}.bak.deskpet-pet-${timestamp()}`;
  fs.copyFileSync(options.configPath, backupPath);

  if (/^\[desktop\]\s*$/m.test(config)) {
    config = replaceDesktopSelection(config, selectedLine);
  } else {
    config = `${config.replace(/\s*$/, "")}\n\n[desktop]\n${selectedLine}\n`;
  }

  fs.writeFileSync(options.configPath, config, "utf8");
}

function replaceDesktopSelection(config, selectedLine) {
  const newline = config.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = /\r?\n$/.test(config);
  const lines = config.split(/\r?\n/);
  const desktopStart = lines.findIndex((line) => /^\[desktop\]\s*$/.test(line));
  const desktopEnd = lines.findIndex((line, index) => index > desktopStart && /^\[[^\]]+\]\s*$/.test(line));
  const end = desktopEnd === -1 ? lines.length : desktopEnd;
  const before = lines.slice(0, desktopStart + 1);
  const body = lines
    .slice(desktopStart + 1, end)
    .filter((line) => !/^\s*selected-avatar-id\s*=/.test(line));
  const after = lines.slice(end);
  const next = [...before, selectedLine, ...body, ...after].join(newline);
  return hadTrailingNewline ? next.replace(/\r?\n?$/, newline) : next.replace(/\r?\n$/, "");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const manifestPath = path.join(options.source, "puppy", "manifest.json");
  const manifest = readJson(manifestPath);
  const installedManifest = petManifest(options, manifest);

  if (options.print) {
    console.log(JSON.stringify({
      petDir: options.petDir,
      manifestPath: options.manifestPath,
      spritePath: options.spritePath,
      configPath: options.configPath,
      selectedAvatarId: options.select ? options.avatarId : null
    }, null, 2));
    return;
  }

  const sharp = loadSharp();
  const atlas = await buildAtlas(sharp, options, manifest);

  fs.mkdirSync(options.petDir, { recursive: true });
  fs.writeFileSync(options.spritePath, atlas);
  fs.writeFileSync(options.manifestPath, `${JSON.stringify(installedManifest, null, 2)}\n`, "utf8");

  const metadata = await sharp(options.spritePath).metadata();
  if (metadata.width !== ATLAS_WIDTH || metadata.height !== ATLAS_HEIGHT) {
    throw new Error(`Invalid spritesheet size: expected ${ATLAS_WIDTH}x${ATLAS_HEIGHT}, got ${metadata.width}x${metadata.height}`);
  }

  if (options.select) {
    writeConfigSelection(options);
  }

  console.log(`Installed Codex pet: ${options.id}`);
  console.log(`Manifest: ${options.manifestPath}`);
  console.log(`Spritesheet: ${options.spritePath}`);
  if (options.select) {
    console.log(`Selected avatar id: ${options.avatarId}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
