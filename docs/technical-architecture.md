# Technical Architecture

## Overview

Deskpet should be built as a local desktop runtime with optional editor bridges.

```text
VS Code / Cursor Extension
  - command registration
  - workspace/project state collection
  - process lifecycle control
            |
            v
Electron Desktop Pet
  - transparent always-on-top BrowserWindow
  - local asset loading
  - animation and interaction state machine
            |
            v
Renderer Canvas/DOM
  - PNG/WebP rendering
  - pointer interaction
  - visual effects
```

## Component Responsibilities

### Extension Host

Planned file: `extension.js`

Responsibilities:

- register commands:
  - `deskpet.start`
  - `deskpet.stop`
  - `deskpet.restart`
  - `deskpet.larger`
  - `deskpet.smaller`
  - `deskpet.spawnTarget`
- read configuration from `vscode.workspace.getConfiguration("deskpet")`;
- locate the bundled Electron binary;
- spawn `pet-app/main.js`;
- write/read a PID file to avoid duplicate windows;
- send startup config through environment variables;
- optionally write or stream project state.

### Electron Main Process

Planned file: `pet-app/main.js`

Responsibilities:

- create a transparent frameless `BrowserWindow`;
- keep the pet inside the nearest display's work area;
- apply desktop-level movement, gravity, and drag release behavior;
- own the authoritative window position;
- receive pointer and animation events from the renderer through IPC;
- send high-level state to the renderer.

Recommended window options:

```js
{
  transparent: true,
  frame: false,
  resizable: false,
  hasShadow: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  backgroundColor: "#00000000"
}
```

### Preload Bridge

Planned file: `pet-app/preload.js`

Responsibilities:

- expose a small IPC surface;
- keep `contextIsolation: true`;
- keep `nodeIntegration: false`;
- avoid exposing raw Node APIs to the renderer.

Initial API shape:

```js
window.deskpet = {
  config,
  ready(size),
  pointerDown(point),
  pointerUp(),
  click(),
  animationEnded(mode),
  onState(callback)
};
```

### Renderer

Planned file: `pet-app/renderer.js`

Responsibilities:

- load a pet manifest;
- load transparent PNG and animated WebP assets;
- render the current action;
- handle pointer down/move/up;
- animate local effects;
- report animation completion when the implementation can detect it.

For animated WebP, the first implementation can render with `<img>` because browser/Electron handles animation playback. For frame-accurate actions, later switch that action to PNG sequences or sprite sheets.

## Data Contracts

### Pet Manifest

Current file: `puppy/manifest.json`

Purpose:

- define the pet id and display name;
- list supported actions;
- map each action to a PNG fallback and/or animated WebP;
- keep animation behavior data-driven.

### Runtime Config

Passed from extension to Electron through environment variables:

```json
{
  "petId": "puppy",
  "scale": 0.32,
  "speed": 32,
  "bottomMargin": 12,
  "launchOnStartup": true
}
```

### Project State

Future local bridge file:

```text
.deskpet/state.json
```

Suggested shape:

```json
{
  "workspacePath": "/path/to/project",
  "source": "vscode",
  "timestamp": "2026-09-22T12:00:00.000Z",
  "git": {
    "branch": "main",
    "dirtyFiles": 3
  },
  "diagnostics": {
    "errors": 1,
    "warnings": 4
  },
  "activity": {
    "activeFile": "src/app.ts",
    "lastEvent": "fileSaved"
  }
}
```

This keeps Codex/CLI integration optional. Any tool can update the state file later without requiring the desktop pet to know where the signal came from.

## State Machine

Initial pet states:

- `idle`
- `wander`
- `action`
- `sleep`
- `dragged`
- `falling`
- `celebrate`
- `alert`

Future target interaction states:

- `targetSpawn`
- `targetMove`
- `chaseTarget`
- `catchTarget`
- `targetEscaped`

The Electron main process owns desktop physics. The renderer owns visual animation. This split keeps window movement reliable and visual code simple.

## Asset Strategy

Start with the current `puppy/` folder:

- PNG stills are fallback and poster images.
- WebP files are preferred for looping animations.
- New actions should be added to `puppy/manifest.json`.

Later, when packaging:

```text
assets/
  puppy/
    manifest.json
    *.png
    *.webp
```

The runtime should resolve assets relative to the extension/app root so the same manifest works in development and packaged builds.

## Testing Strategy

Minimum local checks:

- JSON validation for manifests.
- Electron window opens without a white/black background.
- Transparency works on macOS.
- Pet is visible at desktop and laptop resolutions.
- Drag/drop does not lose the window offscreen.
- Start command does not spawn duplicate processes.
- Stop command cleans up the PID file.

Future automated checks:

- unit tests for manifest loading;
- unit tests for state transitions;
- screenshot checks for renderer output;
- smoke test for extension command registration.

## Security And Privacy

- Do not send project state to a network service.
- Do not expose file system access in the renderer.
- Use `contextIsolation: true`.
- Use `nodeIntegration: false`.
- Keep project context compact and user-visible.
- Make editor/Codex integration optional.
