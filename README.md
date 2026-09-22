# Deskpet

Deskpet is a desktop companion project for a transparent puppy pet. The first target is a floating desktop pet that can run on its own, then optionally connect to VS Code, Cursor, or Codex-related project state.

The project is currently in the planning and asset-preparation stage. The puppy assets live in `puppy/` as transparent PNG stills and animated WebP files.

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

## Current Repository

```text
deskpet/
  README.md
  docs/
    asset-guide.md
    desktop-pet-research.md
    product-plan.md
    technical-architecture.md
  puppy/
    manifest.json
    pet_01_flowers.png
    pet_01_flowers.webp
    pet_02_cycling.png
    pet_02_cycling.webp
    ...
```

## Planned Runtime Structure

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
    puppy/
      manifest.json
      *.png
      *.webp
```

The initial implementation will likely keep using the existing `puppy/` folder, then move or mirror it into `assets/puppy/` once the Electron app skeleton lands.

## Asset Support

Supported from the start:

- transparent PNG for still poses and fallback frames;
- transparent animated WebP for looping actions;
- later: sprite sheets or PNG frame sequences for frame-accurate interactions.

Current assets are described in [puppy/manifest.json](/Users/bytedance/Desktop/deskpet/puppy/manifest.json). See [docs/asset-guide.md](/Users/bytedance/Desktop/deskpet/docs/asset-guide.md) before adding new actions.

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
   - Send workspace path, Git dirty count, diagnostics count, and current file.

4. Project-aware reactions
   - React to errors by spawning catchable targets.
   - React to successful tests/builds with celebration animations.
   - Add a local `.deskpet/state.json` contract for CLI/Codex-style integrations.

5. Packaging
   - Package as a VS Code-compatible extension.
   - Keep the desktop pet runnable outside the editor.

## Documentation

- [Product Plan](/Users/bytedance/Desktop/deskpet/docs/product-plan.md)
- [Technical Architecture](/Users/bytedance/Desktop/deskpet/docs/technical-architecture.md)
- [Asset Guide](/Users/bytedance/Desktop/deskpet/docs/asset-guide.md)
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
