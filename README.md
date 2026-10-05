# Deskpet

Deskpet is a desktop companion project for a transparent puppy pet. The first target is a floating desktop pet that can run on its own, then optionally connect to VS Code, Cursor, or Codex-related project state.

The puppy assets live in `puppy/` as transparent base-pose PNG stills and animated WebP files. The current implementation can run as a local Electron desktop pet and can optionally receive workspace state from VS Code, Cursor, Codex-style hooks, or CLI scripts.

## Quick Start

Clone the project, install dependencies, and start the standalone desktop pet:

```bash
git clone https://github.com/JennyCC567/deskpet.git
cd deskpet
npm install
npm start -- --detach
npm run status
```

Use Deskpet with Codex in two different ways:

```bash
# Install both Codex integrations for this project.
npm run install:codex

# Or install only the full external Deskpet bridge.
npm run install:codex-bridge -- --trust

# Or install only the lightweight native Codex pet skin.
npm run install:codex-native-pet
```

The two Codex tracks are intentionally different:

- **Codex native pet skin** changes Codex's built-in pet picker to a lightweight `custom:puppy` avatar.
- **Deskpet bridge** keeps the full floating desktop pet and lets Codex task state drive its animations through `.deskpet/state.json`.

For VS Code or Cursor, package the extension and install the generated VSIX from the editor:

```bash
npm run package:vscode
```

The VSIX is a lightweight controller package and does not bundle Electron's full desktop runtime. For cloned repository development, `npm install` provides Electron automatically. For a standalone VSIX install, set `deskpet.electronPath` in VS Code/Cursor settings, or set `DESKPET_ELECTRON_PATH`, to an Electron executable on the user's machine.

For local testing without Codex or an editor:

```bash
npm run event -- thinking "Codex is thinking"
npm run event -- running_command "Running tests" --command "npm test"
npm run event -- completed "Task completed"
```

## Product Direction

Deskpet should feel closer to a terminal or desktop companion than a VS Code panel widget:

- it lives on the desktop in a transparent always-on-top window;
- it can walk, idle, sleep, react, and be dragged around;
- it can use local WebP assets as character animations, with PNG reserved for base poses;
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

- Idle animations: the two main base poses are `sit` and `lie`, with `sit_to_lie` and `lie_to_sit` one-second transitions. Extra idle actions can still use `music`, `accordion`, and `autumn`.
- Interaction animations: click, long press, drag, drop, sleep/wake.
- Task-coupled animations:
  - task in progress: `cycling`, `reading`, `reading_alt`;
  - bug-hunt/special task: `caterpillar` alternating with `poke_bug`;
  - task completed: `flowers`, `firework`.

Non-looping WebP actions are treated as playback units: Deskpet plays the optional entry WebP, then repeats the main WebP directly for 2-5 cycles when `repeatMin`/`repeatMax` are set, then plays the optional exit WebP and settles back to `sit` or `lie`. Dragging is the main exception: `sway` loops while the pet is being moved.

The mapping is data-driven in [puppy/manifest.json](puppy/manifest.json), so new generated actions can be added without changing the Electron state machine.

## Current Repository

```text
deskpet/
  package.json
  extension.js
  README.md
  hooks.json
  plugin.json
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
    click_12_wave.webp
    click_13_petted.webp
    debug_10_caterpillar.webp
    debug_10_poke_bug.webp
    finish_01_flowers.webp
    finish_08_firework.webp
    move_sit_to_lift_1s.webp
    move_lie_to_lift_1s.webp
    move_16_sway.webp
    working_02_cycling.webp
    ...
  scripts/
    event.js
    install-codex.js
    install-codex-hooks.js
    install-codex-pet.js
    start.js
    status.js
    stop.js
    validate-assets.js
  hooks/
    deskpet-state.js
  .codex-plugin/
    plugin.json
  skills/
    deskpet-codex-bridge/SKILL.md
```

## Asset Support

Supported from the start:

- transparent PNG for the two base still poses;
- transparent animated WebP for one-shot actions, repeated action units, transitions, and explicit loops;
- later: sprite sheets or PNG frame sequences for frame-accurate interactions.

Current assets are described in [puppy/manifest.json](puppy/manifest.json). See [docs/asset-guide.md](docs/asset-guide.md) before adding new actions.

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
npm run event -- bug_hunt "Caterpillar spotted"
```

The local event writer updates `.deskpet/state.json`. `npm start` watches that file by default, and the VS Code/Cursor extension writes the same file when launched from the editor.

## Editor And Agent Bridge

The extension supports three bridge modes through `Deskpet: Select Bridge Mode` or the `deskpet.bridgeMode` setting:

- `vscode`: the extension writes `.deskpet/state.json` from VS Code/Cursor diagnostics, tasks, terminal shell execution, debug sessions, Git state, and active-file events.
- `external`: Deskpet watches a state file written by an external Codex or Claude Code adapter. Use `deskpet.externalStateFile` to choose the path.
- `desktop`: Deskpet runs without project-state integration.

Codex and Claude Code should integrate through the same local JSON contract instead of coupling directly to their UI internals. For local testing, `npm run event -- <state> [message]` writes that contract.

## Host Adapters

Deskpet is designed as a desktop runtime plus thin host adapters:

- VS Code/Cursor use `package.json` and `extension.js` to launch the pet and write editor state.
- Codex uses `.codex-plugin/plugin.json` for plugin metadata and `hooks.json` plus `hooks/deskpet-state.js` to translate lifecycle events.
- Other AI tools can integrate by writing the same `.deskpet/state.json` contract.

The root `plugin.json` is intentionally kept as generic package metadata for non-Codex hosts. Codex-specific plugin metadata lives in `.codex-plugin/plugin.json`.

## Codex Hooks

Deskpet supports two Codex integration tracks that can be installed together:

- **Codex native pet skin**: installs a lightweight `custom:puppy` avatar into Codex's own pet picker. This uses Codex's fixed 8x11 spritesheet states and cannot read Deskpet's full interaction manifest.
- **Deskpet bridge**: installs Codex hooks that write `.deskpet/state.json`. The standalone Deskpet Electron app reads that file and keeps the full Deskpet behavior: idle rotation, click reactions, sleep/wake, drag lift/drop, and the custom task-state mappings.

Install both tracks for the current project:

```bash
npm run install:codex
```

Install only the Codex native pet skin:

```bash
npm run install:codex-native-pet
```

This writes `~/.codex/pets/puppy/pet.json`, `~/.codex/pets/puppy/spritesheet.webp`, and selects `custom:puppy` in `~/.codex/config.toml`.

Install only the Deskpet hook bridge:

```bash
npm run install:codex-bridge -- --trust
```

The portable hook adapter is committed in the repository:

```text
hooks.json
hooks/deskpet-state.js
```

Running `npm run install:codex-hooks -- --trust` generates a local `.codex/hooks.json` and `.codex/hooks/deskpet-state.js` with absolute paths for the current machine. That generated `.codex/` directory is intentionally ignored by Git.

When this project is trusted by Codex, the hooks translate real Codex lifecycle events into `.deskpet/state.json`:

- user prompt submitted: `thinking`;
- tool or shell command starting: `running_command`;
- file edit or patch starting: `editing_files`;
- permission request: `waiting_approval`;
- failed shell/tool result: `error`;
- turn stopped normally: `completed`;
- interrupted turn: `interrupted`.

Install or refresh project-local Codex hooks:

```bash
npm run install:codex-hooks -- --trust
```

Install the same hooks globally for all Codex projects:

```bash
npm run install:codex-hooks -- --global --trust
```

Open `/hooks` in Codex to review the hooks if trust still needs confirmation. After that, start Deskpet with `npm start` and use Codex in this repository. The running desktop pet will react to Codex's real hook events through the same `.deskpet/state.json` bridge.

Important limitation: Codex's native pet renderer does not support Deskpet's custom `clickMappings`, `dragSequence`, `sleep` state, or idle carousel. Those behaviors are available in the standalone Deskpet runtime.

The native pet skin installer builds an 8x11 WebP spritesheet. It tries to use a local `sharp` install first, then Codex Desktop's bundled `sharp` on macOS. If native skin installation cannot load `sharp`, run `npm install sharp --save-dev` and retry, or use the Deskpet bridge without the native skin.

If you have another copy of Deskpet running, restart the standalone runtime from the project you want to test. `npm run status` prints the running app path and watched state file so you can confirm it is using the expected workspace.

## Packaging

For a VS Code/Cursor extension package:

```bash
npm run package:vscode
```

The VSIX excludes `node_modules` so it does not ship a 500MB Electron runtime. Package distribution should pair the controller extension with either a documented local `npm install` flow, a configured `deskpet.electronPath`, or a future dedicated desktop installer.

For a Codex plugin package:

```text
.codex-plugin/plugin.json
skills/deskpet-codex-bridge/SKILL.md
hooks.json
hooks/deskpet-state.js
scripts/install-codex-hooks.js
scripts/install-codex-pet.js
scripts/install-codex.js
```

The Codex plugin manifest is kept validator-compatible, while `hooks.json` is shipped as the installable hook artifact. Because hook commands and native pet files need machine-local paths, users should run `npm run install:codex` after installing or cloning Deskpet.

Do not publish `.codex/`, `.deskpet/`, generated `.vsix` files, or extracted Codex app bundles. The repository keeps source manifests and install scripts portable; local generated files are rebuilt on each user's machine.

## Interactions

- Single click: show current status and play a small reaction.
- If the pet is sitting, single click plays `wave`.
- If the pet is lying, single click plays `petted`.
- If the pet is in another idle action, single click randomly switches idle action.
- Double click: pin or unpin the status bubble.
- Triple click: sleep.
- Long press: show current status and play lift.
- Drag and release: play `sit_lift_up` or `lie_lift_up`, loop `sway` while moving, then play `put_down` and return to sitting.
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

- [Product Plan](docs/product-plan.md)
- [Technical Architecture](docs/technical-architecture.md)
- [Asset Guide](docs/asset-guide.md)
- [State Contract](docs/state-contract.md)
- [Research Notes](docs/desktop-pet-research.md)

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
