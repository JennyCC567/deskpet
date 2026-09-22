# Product Plan

## Vision

Deskpet is a lightweight desktop puppy companion for coding sessions. It should feel present on the desktop, not trapped inside an editor panel. The pet can be delightful on its own, but the long-term magic is that it notices the shape of the project you are working on and reacts without being intrusive.

## Product Principles

- Desktop first: the pet should live in a transparent floating window.
- Optional integrations: VS Code, Cursor, Codex, and CLI workflows should enhance the pet, not be required for it to run.
- Local by default: assets and project state should stay on the user's machine.
- Data-driven characters: adding or replacing the puppy should mostly mean adding assets and editing a manifest.
- Small surface area: commands should be simple and predictable.

## Target User Experience

The user opens their editor and starts Deskpet. A small puppy appears near the bottom of the screen. It idles, wanders, naps, and can be dragged around. When the connected project has warnings or errors, the puppy notices and can trigger a catch interaction. When tests pass, code is committed, or the working tree becomes clean, it can celebrate.

The pet should never block coding work. It should be easy to stop, resize, or restart from the editor command palette.

## Animation Model

Deskpet now treats animation as three layers:

- Idle animations: ambient desktop life when no task is active.
- Interaction animations: direct user input such as click, double-click, long press, drag, drop, sleep, and wake.
- Task-coupled animations: project or agent execution state coming from VS Code, Cursor, Codex, or a CLI adapter.

Current puppy mapping:

- Base idle: `sit` and `lie`, with `sit_to_lie` and `lie_to_sit` one-second transitions.
- Ambient idle: `music`, `lying`, `accordion`, `autumn`, with optional enter/exit transitions.
- Interaction: sitting click uses `wave`; lying click uses `petted`; drag uses pose-specific lift, looping `sway`, then `put_down`.
- Task in progress: `cycling`, `reading`, `reading_alt`.
- Task completed: random `flowers` or `firework`.
- Special task state: `bug_hunt` alternates `caterpillar` and `poke_bug`.

Most main WebP actions are finite repeated units: play the optional entry transition, then repeat `animated WebP once -> PNG still hold` 2-5 times, then play the optional exit transition and settle to the correct base pose. Explicit loops are reserved for interaction states that last until direct input ends, such as drag `sway`; the current `bug_hunt` state alternates two non-looping debug animations while the state remains active.

This keeps the product flexible: one task state can randomly choose from several animations, and a new puppy skin can change the mapping without changing the runtime.

## Current Interaction Contract

- Single click: show the status bubble and play a short interaction animation.
- Sitting click: play `wave`.
- Lying click: play `petted`.
- Other idle action click: randomly switch idle action.
- Double click: pin or unpin the status bubble.
- Triple click: enter sleep mode.
- Long press: show the current status bubble and start the pose-specific lift.
- Drag: play `sit_lift_up` or `lie_lift_up`, loop `sway` while moving, and play `put_down` on release.
- Right click: open the pet menu.
- Tray icon: restore the pet after it is hidden.

Right-click menu options currently include hide/show, show bubble, pin bubble, force idle, force task-in-progress, force completed, force bug-hunt, random idle action, sleep/wake, and quit.

## State Machine

Deskpet's logic states are intentionally independent from image names:

- `offline`: desktop-only mode or no project bridge yet.
- `idle`: project bridge is connected but no strong activity is happening.
- `editing`: active editor/file activity.
- `in_progress`: a VS Code task, debug run, Codex turn, or external job is active.
- `thinking`: model/agent reasoning state.
- `running_command`: terminal command, shell execution, or tool command is running.
- `editing_files`: automated or manual file-writing activity.
- `waiting_approval`: agent or tool is blocked on user approval.
- `warning`: workspace diagnostics contain warnings.
- `error`: task failure or workspace diagnostics contain errors.
- `bug_hunt`: an explicit special target/caterpillar state.
- `completed`: recent task/test/agent turn completed.
- `interrupted`: task was stopped or cancelled.

The image mapping lives in `puppy/manifest.json` under `stateMappings`, so the state machine can grow without renaming image files.

## MVP Scope

The first usable version should include:

- transparent always-on-top desktop window;
- puppy rendering from local PNG/WebP assets;
- idle loop;
- random action loop using existing assets;
- dragging and gravity drop;
- start, stop, restart, larger, and smaller commands;
- simple config values for scale, speed, bottom margin, and launch behavior.
- right-click controls and tray recovery;
- project status bubble;
- local CLI event writer for testing and future Codex hooks.

## V1 Integration Scope

After the desktop MVP works, add an editor bridge:

- detect active workspace folder;
- read current file name;
- read diagnostics count from VS Code APIs;
- read Git branch and dirty file count;
- send a compact project state object to the pet runtime;
- let the pet switch actions based on simple rules.

Example reactions:

- diagnostics count > 0: show warning/error status and task-in-progress style animation;
- task started: switch to task-in-progress animation pool;
- task ended with exit code 0: play a completed animation;
- task ended with non-zero exit code: show error state;
- terminal shell command started/ended: show running/completed/error when supported by the editor API;
- long idle time: sleep action.

## Future Interaction Ideas

- Caterpillar or target-catching mini interaction.
- Project health mood.
- Multiple skins selected from manifests.
- Pet picker UI.
- Pet status bubble with short project messages.
- Local event log for debugging reactions.
- Optional CLI command to send events, such as `deskpet event tests-passed`.

## Non-Goals For The First Version

- No cloud backend.
- No account system.
- No complex AI behavior.
- No deep Codex internals dependency.
- No marketplace packaging until the local extension works reliably.

## Milestones

### Milestone 0: Planning

Status: in progress.

- README written.
- Architecture documented.
- Asset guide documented.
- Puppy manifest created.

### Milestone 1: Desktop Pet Skeleton

- Add `package.json`.
- Add Electron app under `pet-app/`.
- Render one puppy WebP in a transparent window.
- Support start/stop from npm scripts.

### Milestone 2: Animation State Machine

- Load `puppy/manifest.json`.
- Add idle/action rotation.
- Add drag/drop interaction.
- Add size config.
- Add manifest-level animation groups.
- Add status bubble.
- Add right-click and tray controls.

### Milestone 3: Editor Bridge

- Add VS Code extension entry.
- Register commands.
- Spawn the Electron pet process.
- Pass workspace state to the pet.
- Listen to tasks, diagnostics, debug sessions, editor activity, and terminal shell execution when available.

### Milestone 4: Project-Aware Pet

- Add diagnostics/Git reactions.
- Add local CLI/Codex state writer.
- Add catchable target entity.
- Add future caterpillar assets to the manifest.
