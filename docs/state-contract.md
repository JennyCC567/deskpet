# State Contract

Deskpet watches a local JSON file:

```text
.deskpet/state.json
```

The file is intentionally small and local. VS Code, Cursor, Codex hooks, terminal wrappers, or project scripts can all update the same contract.

The VS Code/Cursor extension has three bridge modes:

- `vscode`: the extension owns `.deskpet/state.json` and refreshes it from editor APIs.
- `external`: the extension launches Deskpet but an external Codex or Claude Code adapter owns the state file.
- `desktop`: no state file is passed to the desktop app.

When `deskpet.externalStateFile` is set, relative paths resolve from the workspace root.

## Minimal Event

```json
{
  "source": "cli",
  "timestamp": "2026-09-22T12:00:00.000Z",
  "deskpet": {
    "state": "in_progress"
  },
  "activity": {
    "lastEvent": "taskStarted",
    "message": "Working on the current task",
    "eventId": "local-unique-id"
  }
}
```

## Supported States

- `offline`: no project bridge is connected.
- `idle`: bridge is connected, no strong activity.
- `editing`: active file/editing activity.
- `in_progress`: task, debug run, Codex turn, or external job is active.
- `thinking`: model or agent is reasoning.
- `running_command`: shell command or tool command is running.
- `editing_files`: files are being modified.
- `waiting_approval`: user approval is needed.
- `warning`: warnings exist.
- `error`: errors or failed tasks exist.
- `bug_hunt`: explicit special bug/caterpillar interaction state.
- `completed`: task, tests, build, or agent turn completed.
- `interrupted`: task was stopped or cancelled.

## Full Shape

```json
{
  "workspacePath": "/path/to/project",
  "source": "vscode",
  "timestamp": "2026-09-22T12:00:00.000Z",
  "deskpet": {
    "state": "completed"
  },
  "git": {
    "branch": "main",
    "dirtyFiles": 2,
    "stagedFiles": 1,
    "unstagedFiles": 1
  },
  "diagnostics": {
    "errors": 0,
    "warnings": 0,
    "information": 0,
    "hints": 0
  },
  "task": {
    "status": "completed",
    "activeCount": 0,
    "name": "npm: test",
    "lastExitCode": 0,
    "updatedAt": "2026-09-22T12:00:00.000Z"
  },
  "terminal": {
    "status": "idle",
    "command": "npm test",
    "exitCode": 0,
    "updatedAt": "2026-09-22T12:00:00.000Z"
  },
  "debug": {
    "status": "idle",
    "activeCount": 0,
    "name": "Launch Extension",
    "type": "extensionHost"
  },
  "activity": {
    "activeFile": "src/app.ts",
    "lastEvent": "taskCompleted",
    "message": "Task completed: npm: test",
    "eventId": "local-unique-id",
    "at": "2026-09-22T12:00:00.000Z"
  }
}
```

## CLI Usage

```bash
npm run event -- in_progress "Codex is editing files"
npm run event -- running_command "Running npm test"
npm run event -- completed "Task completed" --task "npm test" --exit-code 0
npm run event -- error "Tests failed" --task "npm test" --exit-code 1
npm run event -- bug_hunt "Caterpillar spotted"
```

## Codex Mapping

Keep Codex integration as an adapter that writes this file. Recommended mapping:

- prompt submitted or turn started: `in_progress`;
- model reasoning: `thinking`;
- tool/shell command started: `running_command`;
- file write or patch applied: `editing_files`;
- permission requested: `waiting_approval`;
- explicit bug/target event: `bug_hunt`;
- turn completed: `completed`;
- turn failed or command failed: `error`;
- stop/session end/cancel: `interrupted`.
