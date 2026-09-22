const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function readConfig() {
  try {
    return JSON.parse(process.env.DESKPET_CONFIG || "{}");
  } catch {
    return {};
  }
}

function readManifest(appRoot, petDir) {
  const manifestPath = path.join(appRoot, petDir, "manifest.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

const appRoot = process.env.DESKPET_ROOT || path.resolve(__dirname, "..");
const config = {
  petId: "puppy",
  petDir: "puppy",
  scale: 0.2,
  ...readConfig()
};
const petDir = path.join(appRoot, config.petDir);
const manifest = readManifest(appRoot, config.petDir);
const assetBaseUrl = `${pathToFileURL(petDir).href}/`;

contextBridge.exposeInMainWorld("deskpet", {
  config,
  manifest,
  assetBaseUrl,
  ready(size) {
    ipcRenderer.send("deskpet:ready", size);
  },
  pointerDown(point) {
    ipcRenderer.send("deskpet:pointer-down", point);
  },
  pointerUp() {
    ipcRenderer.send("deskpet:pointer-up");
  },
  click() {
    ipcRenderer.send("deskpet:click");
  },
  longPress() {
    ipcRenderer.send("deskpet:long-press");
  },
  contextMenu() {
    ipcRenderer.send("deskpet:context-menu");
  },
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("deskpet:state", listener);
    return () => ipcRenderer.removeListener("deskpet:state", listener);
  }
});
