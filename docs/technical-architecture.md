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
  - animation, interaction, and task state machine
            |
            v
Renderer Canvas/DOM
  - base PNG and animated WebP rendering
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
- read configuration from `vscode.workspace.getConfiguration("deskpet")`;
- locate the bundled Electron binary;
- spawn `pet-app/main.js`;
- write/read a PID file to avoid duplicate windows;
- send startup config through environment variables;
- write project state to `.deskpet/state.json`.
- support bridge modes:
  - `vscode`: collect editor state and write the state file;
  - `external`: launch the pet and watch a state file owned by Codex/Claude Code adapters;
  - `desktop`: launch the pet without a project state file.

Current bridge signals:

- diagnostics: error, warning, information, hint counts;
- tasks: start, end, process exit code, active task count;
- terminal shell execution: command start/end when the installed VS Code/Cursor API exposes shell integration events;
- debug sessions: start/end and active debug count;
- editor activity: active file changes and saves;
- Git: branch, dirty file count, staged file count, unstaged file count.

### Electron Main Process

Planned file: `pet-app/main.js`

Responsibilities:

- create a transparent frameless `BrowserWindow`;
- keep the pet inside the nearest display's work area;
- apply desktop-level movement, gravity, and drag release behavior;
- own the authoritative window position;
- receive pointer and animation events from the renderer through IPC;
- read `.deskpet/state.json` when present;
- normalize editor/Codex/CLI events into Deskpet logic states;
- select animation actions from manifest mappings;
- send high-level state and status bubble data to the renderer;
- own right-click context menu and tray recovery.

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
  longPress(),
  contextMenu(),
  onState(callback)
};
```

### Renderer

Planned file: `pet-app/renderer.js`

Responsibilities:

- load a pet manifest;
- load transparent base PNG and animated WebP assets;
- render the current action;
- choose `still` PNG or `animated` WebP from the main-process `visualVariant`;
- handle pointer down/move/up;
- handle right-click and long-press gestures;
- animate local effects;
- report animation completion when the implementation can detect it.

For animated WebP, the first implementation can render with `<img>` because browser/Electron handles animation playback. For frame-accurate actions, later switch that action to PNG sequences or sprite sheets.

## Data Contracts

### Pet Manifest

Current file: `puppy/manifest.json`

Purpose:

- define the pet id and display name;
- list supported actions;
- map each action to a base PNG still or animated WebP;
- group actions into idle, interaction, task-in-progress, and task-completed pools;
- map logic states to action pools;
- define pose requirements, enter transitions, exit transitions, repeat counts, and settle actions;
- keep animation behavior data-driven.

### Runtime Config

Passed from extension to Electron through environment variables:

```json
{
  "petId": "puppy",
  "scale": 0.26,
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
  "deskpet": {
    "state": "in_progress"
  },
  "git": {
    "branch": "main",
    "dirtyFiles": 3,
    "stagedFiles": 1,
    "unstagedFiles": 2
  },
  "diagnostics": {
    "errors": 1,
    "warnings": 4,
    "information": 0,
    "hints": 0
  },
  "task": {
    "status": "running",
    "activeCount": 1,
    "name": "npm: test"
  },
  "terminal": {
    "status": "running",
    "command": "npm test"
  },
  "debug": {
    "status": "idle",
    "activeCount": 0
  },
  "activity": {
    "activeFile": "src/app.ts",
    "lastEvent": "taskStarted",
    "message": "Task started: npm: test",
    "eventId": "unique-local-id"
  }
}
```

This keeps Codex/CLI integration optional. Any tool can update the state file later without requiring the desktop pet to know where the signal came from.

The `deskpet.state` field is the preferred normalized state. If it is absent, Electron infers a state from task, terminal, debug, diagnostics, and activity fields.

### Local CLI Events

For local testing and future Codex hooks:

```bash
npm run event -- in_progress "Codex is editing files"
npm run event -- completed "Task completed"
npm run event -- error "Tests failed"
```

This writes `.deskpet/state.json` in the current working directory. `npm start` watches that file by default.

### Codex Adapter Strategy

Do not couple Deskpet to a private UI implementation. Preferred options:

- a Codex hook writes `deskpet.state` and `activity.message` into `.deskpet/state.json`;
- a wrapper around a JSON/event stream translates agent events into the same state file;
- project scripts write explicit events through `npm run event -- <state> [message]`.

Suggested Codex-to-Deskpet mapping:

- session/user prompt/turn started: `in_progress`;
- model reasoning: `thinking`;
- tool or shell command started: `running_command`;
- file edit or patch activity: `editing_files`;
- permission request: `waiting_approval`;
- turn completed: `completed`;
- command/tool failure or turn failed: `error`;
- stop/session end/cancel: `interrupted`.

## State Machine

Desktop pet modes:

- `idle`
- `wander`
- `action`
- `sleep`
- `dragged`
- `falling`
- `celebrate`
- `alert`

Project logic states:

- `offline`
- `idle`
- `editing`
- `in_progress`
- `thinking`
- `running_command`
- `editing_files`
- `waiting_approval`
- `warning`
- `error`
- `bug_hunt`
- `completed`
- `interrupted`

Animation mode chain for most non-looping WebP actions:

```text
optional enterAction -> animated action x repeatCount/repeatMin-repeatMax -> optional exitAction -> settleAction/base pose
```

Actions may also declare `cycleNextAction`. The current `bug_hunt` mapping uses it to alternate `caterpillar` and `poke_bug` while the project/manual state is still active.

Drag is handled as a special interaction chain:

```text
sit_lift_up or lie_lift_up -> sway loop while dragging -> put_down -> sit
```

Future target interaction states:

- `targetSpawn`
- `targetMove`
- `chaseTarget`
- `catchTarget`
- `targetEscaped`

The Electron main process owns desktop physics. The renderer owns visual animation. This split keeps window movement reliable and visual code simple.

## Asset Strategy

Start with the current `puppy/` folder:

- PNG stills are reserved for base poses and emergency fallbacks.
- WebP files are preferred for finite action units, transitions, task reactions, celebrations, and explicit interaction loops.
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
