# Desktop Pet Plugin Research

This note captures the implementation paths for building a Codex-like desktop pet that can be launched from a VS Code/Cursor extension and customized with local art.

## Goal

Build a small desktop pet plugin that:

- can be started, stopped, and resized from editor commands;
- shows a transparent floating pet window above the desktop/editor;
- loads custom sprite assets from this repository;
- supports idle, walking, dragging/falling, sleeping, and later "bug catching" actions.

## Reference Paths

### 1. VS Code Pets

Repository: `tonybaloney/vscode-pets`

Important files:

- `package.json`
  - Registers extension commands like `vscode-pets.start`, `vscode-pets.spawn-pet`, and `vscode-pets.throw-ball`.
  - Contributes a webview view in the Explorer area.
  - Contributes settings for `petType`, `petColor`, `petSize`, `position`, and `theme`.
- `src/extension/extension.ts`
  - Extension host entrypoint.
  - Reads VS Code configuration.
  - Creates/reveals the webview panel or view.
  - Sends messages to the webview when the user changes pets or triggers commands.
- `src/panel/main.ts`
  - Browser-side runtime inside the VS Code webview.
  - Creates the canvas/DOM stage, handles messages, and runs the animation loop.
- `src/panel/basepettype.ts`
  - Base class for a pet instance.
  - Owns position, direction, size, speech bubble, current animation state, and state transitions.
- `src/panel/states.ts`
  - State machine for idle, running, jumping, climbing, chasing, etc.
- `src/panel/pets.ts` and `src/panel/pets/*`
  - Registry that maps a pet type to a class and available colors.
- `media/*`
  - Asset folders and CSS. Animated pets are generally loaded with naming conventions such as `*_idle_8fps.gif`.

Takeaway:

`vscode-pets` is the best pattern if the pet lives inside VS Code, because VS Code webviews are well supported and easy to package. It is less suitable for a true floating desktop pet because a webview is clipped to the editor UI.

### 2. Seal Walker VS Code Pet

Repository: `carlosandresfv2007/seal-walker-vscode-pet`

Important files:

- `package.json`
  - Registers editor commands such as start, stop, restart, smaller, larger, and reset size.
  - Declares configuration values for launch-on-startup, scale, speed, animation timing, and sprite-sheet geometry.
  - Depends on Electron so the extension can launch a separate transparent desktop window.
- `extension.js`
  - Runs in the VS Code extension host.
  - Reads configuration via `vscode.workspace.getConfiguration(...)`.
  - Locates Electron inside `node_modules/electron`.
  - Spawns `pet-app/main.js` as a detached child process.
  - Writes a PID file to avoid duplicate pet windows and to stop/restart the pet.
  - Passes runtime settings to the Electron app through environment variables.
- `pet-app/main.js`
  - Electron main process.
  - Creates a transparent, frameless, always-on-top `BrowserWindow`.
  - Uses `screen.getDisplayNearestPoint(...)` to keep the pet on the current display.
  - Moves the window with a timer, clamps it inside screen bounds, and applies gravity when dropped.
  - Handles IPC events from the renderer: ready, pointer down/up, click, animation ended.
- `pet-app/preload.js`
  - Exposes a small IPC API to the renderer while keeping `contextIsolation: true` and `nodeIntegration: false`.
- `pet-app/renderer.js`
  - Loads sprite sheets.
  - Extracts individual frames with canvas.
  - Removes dark background pixels and crops visible bounds.
  - Draws frames to a transparent canvas.
  - Sends pointer/animation events back to the Electron main process.
- `assets/sprites/*`
  - Sprite sheets for each action.

Takeaway:

This is the best fit for a Codex-like floating pet. The editor extension is just a controller. The real pet is a tiny Electron app with a transparent window, canvas renderer, state machine, and IPC.

### 3. OpenAI Codex Terminal Pets

Repository: `openai/codex`

Important files:

- `codex-rs/tui/src/pets/mod.rs`
  - TUI pet entrypoint.
  - Separates built-in pets from user-owned custom pets.
  - Built-in assets are cached under `CODEX_HOME`; custom pets live under `$CODEX_HOME/pets/<pet-id>/pet.json`.
- `codex-rs/tui/src/pets/picker.rs`
  - Builds the `/pets` picker.
  - Merges built-in pets, a disable option, and custom pets found on disk.
  - Uses a selector style like `custom:<pet-id>` for user pets.
- `codex-rs/tui/src/pets/frames.rs`
  - Slices a spritesheet into generated `frame_000.png`, `frame_001.png`, etc.
  - Caches extracted frames so rendering does not repeat expensive image work.
- `codex-rs/tui/src/app/pets.rs`
  - Handles pet selection, disabling, loading, preview errors, and persistence.

Takeaway:

Codex pets are terminal-rendered image companions, not desktop windows. The best idea to borrow is the manifest contract: every custom pet should be a folder with metadata plus a spritesheet/image path. That makes changing the character a data problem instead of a code change.

## Recommended Architecture For This Repo

Use the Seal Walker style as the base architecture, but keep the code smaller and asset-friendly:

```text
deskpet/
  package.json
  extension.js
  pet-app/
    index.html
    main.js
    preload.js
    renderer.js
    styles.css
  assets/
    bug/
      idle.png
      walk.png
      grab.png
      fall.png
      sleep.png
    puppy/
      pet_01_flowers.png
      ...
  docs/
    desktop-pet-research.md
```

The current `puppy/*.png` files can be moved or copied under `assets/puppy/` later. For a first working prototype, we can also use the existing PNGs as static frames instead of requiring full sprite sheets immediately.

## First Version Behavior

Start with a narrow, testable loop:

1. `Deskpet: Start`
   - VS Code command launches the Electron pet.
2. `Deskpet: Stop`
   - Stops the PID from the temp file.
3. `Deskpet: Larger` / `Deskpet: Smaller`
   - Updates config and restarts the pet.
4. Pet window
   - transparent;
   - frameless;
   - always on top;
   - skip taskbar;
   - lives near the bottom of the current display;
   - walks left/right;
   - can be dragged and dropped with gravity.
5. Art loading
   - `renderer.js` loads a manifest of local PNGs.
   - If an animation has only one image, loop the image with subtle bobbing.
   - If later we add sprite sheets, slice them into frames.

## Bug Catching Design

For the Codex-style "bug catching" feeling, add a second entity later:

- `bug` entity
  - Small floating target moving across the pet window or screen edge.
  - Has states: `spawn`, `fly`, `caught`, `escape`.
- `pet` entity
  - Has states: `idle`, `walk`, `chaseBug`, `catchBug`, `celebrate`, `dragged`, `fall`.
- Trigger sources
  - Manual command: `Deskpet: Spawn Bug`.
  - Automatic timer every few minutes.
  - Optional future hook: if diagnostics/errors appear in VS Code, spawn a bug.

The clean implementation path is:

- Keep desktop/window movement in `pet-app/main.js`.
- Keep animation, hit testing, and visual states in `pet-app/renderer.js`.
- Keep editor commands and settings in `extension.js`.

## Why Not Only Use A VS Code Webview?

VS Code webviews are simpler and safer, but they are contained inside VS Code. A Codex-like desktop companion needs desktop-level behavior: transparent always-on-top window, independent movement, dragging, gravity, and visibility across editor panels. Electron gives those abilities directly.

## Implementation Notes

- Keep `contextIsolation: true` and `nodeIntegration: false` in Electron.
- Expose only a tiny preload API: `ready`, `pointerDown`, `pointerUp`, `click`, `onState`, and later `bugCaught`.
- Use a PID file in `os.tmpdir()` so commands can stop/restart an already-running pet.
- Keep asset paths relative to `context.extensionPath` so packaged extensions can find images.
- Add `.vscode/launch.json` later for local extension debugging.
- Add `@vscode/vsce` only when packaging is needed.
