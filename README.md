# Deskpet

Deskpet is a desktop companion project for a transparent puppy pet. The first target is a floating desktop pet that can run on its own, then optionally connect to VS Code, Cursor, or Codex-related project state.

The puppy assets live in `puppy/` as transparent PNG stills and animated WebP files. The current implementation can run as a local Electron desktop pet and can optionally receive workspace state from VS Code, Cursor, Codex-style hooks, or CLI scripts.

## Product Direction

Deskpet should feel closer to a terminal or desktop companion than a VS Code panel widget:

- it lives on the desktop in a transparent always-on-top window;
- it can walk, idle, sleep, react, and be dragged around;
- it can use local PNG/WebP assets as character animations;
- it can optionally receive project signals from VS Code/Cursor/Codex workflows;
- it can later react to diagnostics, Git changes, test results, and coding activity.

The clean split is:

```text
Desktop pet app
  Renders and animates the pet. Can run independently.

Editor bridge
  Optional VS Code/Cursor extension that starts/stops the pet and sends project state.

Project state adapters
  Optional scripts or local state files for Codex/CLI/task integrations.
```

## Animation Groups

The current puppy manifest separates animation into three product layers:

- Idle animations: `music`, `lying`, `accordion`, `autumn`.
- Interaction animations: click, long press, drag, drop, sleep/wake.
- Task-coupled animations:
  - task in progress: `cycling`, `reading`, `reading_alt`;
  - task completed: `idle_flowers`, `firework`.

The mapping is data-driven in [puppy/manifest.json](/Users/bytedance/Desktop/deskpet/puppy/manifest.json), so new generated actions can be added without changing the Electron state machine.

## Current Repository

```text
deskpet/
  package.json
  extension.js
  README.md
  docs/
    asset-guide.md
    desktop-pet-research.md
    product-plan.md
    state-contract.md
    technical-architecture.md
  pet-app/
    index.html
    main.js
    preload.js
    renderer.js
    styles.css
  puppy/
    manifest.json
    pet_01_flowers.png
    pet_01_flowers.webp
    pet_02_cycling.png
    pet_02_cycling.webp
    ...
  scripts/
    event.js
    start.js
    status.js
    stop.js
    validate-assets.js
```

## Asset Support

Supported from the start:

- transparent PNG for still poses and fallback frames;
- transparent animated WebP for looping actions;
- later: sprite sheets or PNG frame sequences for frame-accurate interactions.

Current assets are described in [puppy/manifest.json](/Users/bytedance/Desktop/deskpet/puppy/manifest.json). See [docs/asset-guide.md](/Users/bytedance/Desktop/deskpet/docs/asset-guide.md) before adding new actions.

## Local Development

Install dependencies:

```bash
npm install
```

Run the desktop pet directly:

```bash
npm start
```

Stop the desktop pet:

```bash
npm run stop
```

Check whether it is running:

```bash
npm run status
```

Validate assets and JavaScript syntax:

```bash
npm run check
```

Simulate project or Codex events:

```bash
npm run event -- in_progress "Working on the current task"
npm run event -- completed "Task completed"
npm run event -- error "Tests failed"
```

The local event writer updates `.deskpet/state.json`. `npm start` watches that file by default, and the VS Code/Cursor extension writes the same file when launched from the editor.

## Interactions

- Single click: show current status and play a small reaction.
- Double click: pin or unpin the status bubble.
- Triple click: sleep.
- Long press: show current status.
- Drag and release: move the pet, then let it drop to the desktop floor.
- Right click: open the pet menu.
- Tray icon: show the pet again after hiding it.

## Roadmap

1. Planning and asset contract
   - Document product direction.
   - Define technical architecture.
   - Define puppy asset manifest.

2. Desktop pet MVP
   - Create Electron transparent frameless window.
   - Load puppy manifest.
   - Render PNG/WebP actions.
   - Add idle, walk, sleep, drag, and drop states.

3. Editor bridge
   - Add VS Code/Cursor commands: start, stop, restart, larger, smaller.
   - Send workspace path, Git dirty count, diagnostics count, task state, terminal command state, debug state, and current file.

4. Project-aware reactions
   - React to active tasks with progress animations.
   - React to successful tests/builds with Flower or Firework animations.
   - React to errors by showing attention state, then later spawning catchable targets.
   - Add a local `.deskpet/state.json` contract for CLI/Codex-style integrations.

5. Packaging
   - Package as a VS Code-compatible extension.
   - Keep the desktop pet runnable outside the editor.

## Documentation

- [Product Plan](/Users/bytedance/Desktop/deskpet/docs/product-plan.md)
- [Technical Architecture](/Users/bytedance/Desktop/deskpet/docs/technical-architecture.md)
- [Asset Guide](/Users/bytedance/Desktop/deskpet/docs/asset-guide.md)
- [State Contract](/Users/bytedance/Desktop/deskpet/docs/state-contract.md)
- [Research Notes](/Users/bytedance/Desktop/deskpet/docs/desktop-pet-research.md)

## GitHub

This folder is bound to:

```bash
https://github.com/JennyCC567/deskpet.git
```

Normal workflow:

```bash
git status
git add .
git commit -m "Describe the change"
git push
```
