---
name: deskpet-codex-bridge
description: Use when connecting the local Deskpet desktop companion to Codex lifecycle state, checking whether Deskpet is watching Codex, installing project hooks, or explaining the Deskpet state mapping.
---

# Deskpet Codex Bridge

Deskpet is a local desktop companion. It has two Codex integration tracks:

- Codex native pet skin: a lightweight `custom:puppy` avatar installed into Codex's own pet picker.
- Deskpet bridge: lifecycle hooks write `.deskpet/state.json`, and the standalone Electron pet reacts to that state with its full interaction system.

Codex's native pet renderer uses a fixed spritesheet state machine. It can show the puppy skin, but it does not support Deskpet's custom click mappings, sleep mode, idle carousel, or drag lift/drop sequence. Use the bridge plus `npm start` when those full interactions matter.

The default project state file is:

```text
<project>/.deskpet/state.json
```

## State Mapping

- `UserPromptSubmit` or turn start -> `thinking` -> reading-style working animation.
- `PreToolUse` for shell/tool commands -> `running_command` -> cycling working animation.
- `PreToolUse` for edits or patches -> `editing_files` -> cycling working animation.
- `PermissionRequest`, notification, or needed user intervention -> `waiting_approval` -> caterpillar debug animation.
- failed tool or command result -> `error` -> caterpillar debug animation.
- `Stop` -> `completed` -> flowers or firework finish animation.
- `Interrupt` -> `interrupted` -> idle recovery.

## Local Commands

From the Deskpet repository:

```bash
npm run install:codex
npm start
npm run status
npm run event -- thinking "Codex is thinking"
npm run install:codex-hooks -- --trust
npm run install:codex-native-pet
npm run install:codex-bridge -- --trust
```

Use `npm run install:codex-hooks -- --global --trust` only when the user wants the bridge available outside the current project. The generated hook command uses absolute local paths, so it should be regenerated on each user's machine after install.
