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

## MVP Scope

The first usable version should include:

- transparent always-on-top desktop window;
- puppy rendering from local PNG/WebP assets;
- idle loop;
- random action loop using existing assets;
- dragging and gravity drop;
- start, stop, restart, larger, and smaller commands;
- simple config values for scale, speed, bottom margin, and launch behavior.

## V1 Integration Scope

After the desktop MVP works, add an editor bridge:

- detect active workspace folder;
- read current file name;
- read diagnostics count from VS Code APIs;
- read Git branch and dirty file count;
- send a compact project state object to the pet runtime;
- let the pet switch actions based on simple rules.

Example reactions:

- diagnostics count > 0: show alert or spawn a catchable target;
- Git dirty count > 0: occasionally inspect or point at a note;
- tests passed: play celebration action;
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

### Milestone 3: Editor Bridge

- Add VS Code extension entry.
- Register commands.
- Spawn the Electron pet process.
- Pass workspace state to the pet.

### Milestone 4: Project-Aware Pet

- Add diagnostics/Git reactions.
- Add catchable target entity.
- Add future caterpillar assets to the manifest.
