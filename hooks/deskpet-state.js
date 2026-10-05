#!/usr/bin/env node
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;
    const timeoutMs = Number.parseInt(process.env.DESKPET_HOOK_STDIN_TIMEOUT_MS || "350", 10);
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      try {
        process.stdin.pause();
      } catch {
        // Some hosts provide a non-pausable stdin shim.
      }
      resolve(data);
    };
    const timeout = setTimeout(finish, Number.isFinite(timeoutMs) ? timeoutMs : 350);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
  });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function findWorkspaceRoot(cwd) {
  try {
    const root = childProcess
      .execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
      .trim();
    return root || cwd;
  } catch {
    return cwd;
  }
}

function compactText(value, maxLength = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function eventId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function parseJsonMaybe(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseHookPayload(raw) {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {
      parseError: error.message,
      rawPreview: compactText(raw, 240)
    };
  }
}

function normalizeHookEvent(value) {
  const text = String(value || "").trim();
  const key = text.replace(/[.\-\s]+/g, "_").toLowerCase();
  const aliases = {
    interrupt: "Interrupt",
    permission_request: "PermissionRequest",
    post_tool_use: "PostToolUse",
    pre_tool_use: "PreToolUse",
    notification: "Notification",
    session_start: "SessionStart",
    stop: "Stop",
    subagent_stop: "SubagentStop",
    user_prompt_submit: "UserPromptSubmit"
  };

  return aliases[key] || text;
}

function hookEventName(event) {
  const normalized = normalizeHookEvent(
    firstDefined(
      event.hook_event_name,
      event.hookEventName,
      event.event_name,
      event.eventName,
      event.hook_event,
      event.hookEvent,
      event.type
    )
  );

  const itemType = normalizedToolName(event.item?.type);
  if (normalized === "item_started" && itemType === "command_execution") {
    return "PreToolUse";
  }
  if (normalized === "item_completed" && itemType === "command_execution") {
    return "PostToolUse";
  }
  if (normalized === "turn_started") {
    return "UserPromptSubmit";
  }
  if (normalized === "turn_completed") {
    return "Stop";
  }

  return normalized;
}

function toolName(event) {
  const raw = firstDefined(
    event.tool_name,
    event.toolName,
    event.tool,
    event.name,
    event.function_name,
    event.functionName,
    event.item?.tool_name,
    event.item?.toolName,
    event.item?.name,
    event.item?.type === "command_execution" ? "exec_command" : event.item?.type
  );

  if (raw && typeof raw === "object") {
    return String(firstDefined(raw.name, raw.tool_name, raw.toolName, "")).trim();
  }

  return String(raw || "").trim();
}

function toolInput(event) {
  return parseJsonMaybe(
    firstDefined(
      event.tool_input,
      event.toolInput,
      event.input,
      event.arguments,
      event.args,
      event.params,
      event.tool?.input,
      event.tool?.arguments,
      event.item?.tool_input,
      event.item?.toolInput,
      event.item?.input,
      event.item?.arguments,
      {}
    )
  );
}

function commandFromTool(event) {
  const input = toolInput(event);
  if (typeof input === "string") {
    return input;
  }

  const commandKeys = ["command", "cmd", "shell_command", "shellCommand", "script"];
  for (const key of commandKeys) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }

  const nestedArgs = parseJsonMaybe(input.arguments);
  if (nestedArgs && typeof nestedArgs === "object") {
    for (const key of commandKeys) {
      if (typeof nestedArgs[key] === "string") {
        return nestedArgs[key];
      }
    }
  }

  if (Array.isArray(input.tool_uses)) {
    return input.tool_uses
      .map((toolUse) => {
        const parameters = toolUse.parameters || toolUse.input || {};
        const nestedCommand = commandKeys
          .map((key) => parameters[key])
          .find((value) => typeof value === "string" && value.trim());
        const nestedName = toolUse.recipient_name || toolUse.name || "tool";
        return nestedCommand ? `${nestedName}: ${nestedCommand}` : nestedName;
      })
      .filter(Boolean)
      .join(" | ");
  }

  for (const key of commandKeys) {
    const value = firstDefined(event[key], event.item?.[key]);
    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

function normalizedToolName(name) {
  return String(name || "")
    .trim()
    .split(".")
    .pop()
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isEditTool(name) {
  return new Set(["apply_patch", "edit", "write", "multiedit", "notebookedit"]).has(
    normalizedToolName(name)
  );
}

function isShellTool(name) {
  return new Set(["bash", "shell", "sh", "exec", "exec_command", "unified_exec", "command_execution"]).has(
    normalizedToolName(name)
  );
}

function nestedToolNames(event) {
  const input = toolInput(event);
  if (!input || typeof input !== "object" || !Array.isArray(input.tool_uses)) {
    return [];
  }

  return input.tool_uses.map((toolUse) => toolUse.recipient_name || toolUse.name || "");
}

function isEditEvent(event, name) {
  return isEditTool(name) || nestedToolNames(event).some(isEditTool);
}

function isShellEvent(event, name) {
  return isShellTool(name) || nestedToolNames(event).some(isShellTool);
}

function toolResponse(event) {
  return parseJsonMaybe(
    firstDefined(
      event.tool_response,
      event.toolResponse,
      event.tool_output,
      event.toolOutput,
      event.response,
      event.result,
      event.output,
      event.item,
      {}
    )
  );
}

function findExitCode(value, depth = 0) {
  if (!value || depth > 4) {
    return undefined;
  }

  if (typeof value === "string") {
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      return findExitCode(parsed, depth + 1);
    }

    const match = value.match(/(?:exit[_\s-]*code|process exited with code)\D*(-?\d+)/i);
    return match ? Number(match[1]) : undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  for (const key of ["exit_code", "exitCode", "code", "status"]) {
    if (Number.isInteger(value[key])) {
      return value[key];
    }
  }

  for (const item of Object.values(value)) {
    const found = findExitCode(item, depth + 1);
    if (Number.isInteger(found)) {
      return found;
    }
  }

  return undefined;
}

function hasFailure(value, exitCode, depth = 0) {
  if (Number.isInteger(exitCode) && exitCode !== 0) {
    return true;
  }

  if (!value || depth > 4) {
    return false;
  }

  if (typeof value === "string") {
    const parsed = parseJsonMaybe(value);
    if (parsed !== value) {
      return hasFailure(parsed, exitCode, depth + 1);
    }
    return false;
  }

  if (typeof value !== "object") {
    return false;
  }

  if (value.error || value.is_error === true || value.isError === true) {
    return true;
  }

  const status = String(firstDefined(value.status, value.state, "")).toLowerCase();
  if (["error", "failed", "failure", "timed_out", "timeout"].includes(status)) {
    return true;
  }

  return Object.values(value).some((item) => hasFailure(item, exitCode, depth + 1));
}

function hookFingerprint(event, mapped) {
  return [
    mapped.codexEvent,
    mapped.toolName,
    mapped.command,
    mapped.state,
    Number.isInteger(mapped.exitCode) ? mapped.exitCode : "",
    event.session_id || event.sessionId || "",
    event.turn_id || event.turnId || "",
    event.tool_call_id || event.toolCallId || "",
    event.item?.id || "",
    event.item?.status || ""
  ].join("|");
}

function mapEvent(event) {
  const hookEvent = hookEventName(event);
  const name = toolName(event);
  const rawCommand = commandFromTool(event);
  const shellEvent = isShellEvent(event, name);
  const editEvent = isEditEvent(event, name);
  const command = shellEvent ? compactText(rawCommand) : "";
  const base = {
    codexEvent: hookEvent,
    toolName: name,
    command
  };

  if (hookEvent === "SessionStart") {
    return {
      ...base,
      state: "idle",
      terminalStatus: "idle",
      clearTerminalCommand: true,
      message: "Codex session ready."
    };
  }

  if (hookEvent === "UserPromptSubmit") {
    return {
      ...base,
      state: "thinking",
      taskStatus: "running",
      taskName: "Codex turn",
      activeCount: 1,
      terminalStatus: "idle",
      clearTerminalCommand: true,
      message: "Codex is thinking."
    };
  }

  if (hookEvent === "PermissionRequest") {
    return {
      ...base,
      state: "waiting_approval",
      taskStatus: "running",
      taskName: name ? `Approval: ${name}` : "Approval needed",
      activeCount: 1,
      message: name ? `Codex needs approval for ${name}.` : "Codex needs approval."
    };
  }

  if (hookEvent === "Notification") {
    return {
      ...base,
      state: "waiting_approval",
      taskStatus: "running",
      taskName: name ? `Needs attention: ${name}` : "User attention needed",
      activeCount: 1,
      message: name ? `Codex needs attention for ${name}.` : "Codex needs your attention."
    };
  }

  if (/error|failure|exception/i.test(hookEvent)) {
    return {
      ...base,
      state: "error",
      taskStatus: "failed",
      taskName: name ? `Failed: ${name}` : "Codex task failed",
      activeCount: 0,
      terminalStatus: shellEvent ? "failed" : undefined,
      message: name ? `Codex reported an error from ${name}.` : "Codex reported an error."
    };
  }

  if (hookEvent === "PreToolUse") {
    if (editEvent) {
      return {
        ...base,
        state: "editing_files",
        taskStatus: "running",
        taskName: "Editing files",
        activeCount: 1,
        message: "Codex is editing files."
      };
    }

    if (shellEvent) {
      return {
        ...base,
        state: "running_command",
        taskStatus: "running",
        taskName: "Running command",
        activeCount: 1,
        terminalStatus: "running",
        message: command ? `Running: ${compactText(command, 60)}` : "Codex is running a command."
      };
    }

    return {
      ...base,
      state: "running_command",
      taskStatus: "running",
      taskName: name ? `Using ${name}` : "Codex turn",
      activeCount: 1,
      terminalStatus: "running",
      message: name ? `Codex is using ${name}.` : "Codex is working."
    };
  }

  if (hookEvent === "PostToolUse") {
    const response = toolResponse(event);
    const exitCode = findExitCode(response);
    if (hasFailure(response, exitCode)) {
      return {
        ...base,
        state: "error",
        taskStatus: "failed",
        taskName: shellEvent ? "Command failed" : "Tool failed",
        activeCount: 0,
        terminalStatus: shellEvent ? "failed" : undefined,
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        message: shellEvent
          ? `Command failed${command ? `: ${compactText(command, 60)}` : "."}`
          : `Codex tool failed: ${name || "tool"}.`
      };
    }

    return {
      ...base,
      state: "thinking",
      taskStatus: "running",
      taskName: "Codex turn",
      activeCount: 1,
      terminalStatus: shellEvent ? "completed" : undefined,
      exitCode,
      message: editEvent
        ? "Codex edited files."
        : shellEvent
          ? "Command completed."
          : "Codex is thinking."
    };
  }

  if (hookEvent === "Stop") {
    return {
      ...base,
      state: "completed",
      taskStatus: "completed",
      taskName: "Codex turn",
      activeCount: 0,
      terminalStatus: "completed",
      message: "Codex task completed."
    };
  }

  if (hookEvent === "SubagentStop") {
    return {
      ...base,
      state: "thinking",
      taskStatus: "running",
      taskName: "Codex turn",
      activeCount: 1,
      message: "Codex is thinking."
    };
  }

  if (hookEvent === "Interrupt") {
    return {
      ...base,
      state: "interrupted",
      taskStatus: "idle",
      taskName: "Codex turn",
      activeCount: 0,
      terminalStatus: "idle",
      message: "Codex task interrupted."
    };
  }

  return undefined;
}

function writeDeskpetState(event, mapped) {
  if (!mapped) {
    return;
  }

  const cwd = path.resolve(
    firstDefined(
      event.cwd,
      event.working_directory,
      event.workingDirectory,
      event.workspace_path,
      event.workspacePath,
      event.project_path,
      event.projectPath,
      process.cwd()
    )
  );
  const workspaceRoot = findWorkspaceRoot(cwd);
  const statePath = process.env.DESKPET_STATE_FILE || path.join(workspaceRoot, ".deskpet", "state.json");
  const existing = readJson(statePath, {});
  const timestamp = new Date().toISOString();
  const fingerprint = hookFingerprint(event, mapped);
  const previousTimestamp = Date.parse(existing.codex?.updatedAt || "");
  if (
    existing.codex?.lastHookFingerprint === fingerprint
    && Number.isFinite(previousTimestamp)
    && Date.now() - previousTimestamp < 1000
  ) {
    return;
  }

  const next = {
    ...existing,
    workspacePath: workspaceRoot,
    source: "codex",
    timestamp,
    deskpet: {
      ...(existing.deskpet || {}),
      state: mapped.state
    },
    codex: {
      ...(existing.codex || {}),
      state: mapped.state,
      event: mapped.codexEvent,
      toolName: mapped.toolName || undefined,
      message: mapped.message,
      sessionId: event.session_id || event.sessionId || existing.codex?.sessionId,
      turnId: event.turn_id || event.turnId || existing.codex?.turnId,
      model: event.model || existing.codex?.model,
      lastHookFingerprint: fingerprint,
      updatedAt: timestamp
    },
    activity: {
      ...(existing.activity || {}),
      lastEvent: mapped.codexEvent || mapped.state,
      message: mapped.message,
      eventId: eventId(),
      at: timestamp
    }
  };

  if (mapped.taskStatus) {
    next.task = {
      ...(existing.task || {}),
      status: mapped.taskStatus,
      activeCount: mapped.activeCount || 0,
      name: mapped.taskName,
      lastExitCode: Number.isInteger(mapped.exitCode) ? mapped.exitCode : existing.task?.lastExitCode,
      updatedAt: timestamp
    };
  }

  if (mapped.terminalStatus || mapped.command || mapped.clearTerminalCommand) {
    const terminal = {
      ...(existing.terminal || {}),
      status: mapped.terminalStatus || existing.terminal?.status || "idle",
      updatedAt: timestamp
    };

    if (!mapped.clearTerminalCommand) {
      terminal.command = mapped.command || existing.terminal?.command;
      terminal.exitCode = Number.isInteger(mapped.exitCode)
        ? mapped.exitCode
        : existing.terminal?.exitCode;
    }

    next.terminal = terminal;
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function writeTrace(event, raw) {
  if (!process.env.DESKPET_HOOK_TRACE) {
    return;
  }

  try {
    const cwd = path.resolve(event.cwd || process.cwd());
    const workspaceRoot = findWorkspaceRoot(cwd);
    const statePath = process.env.DESKPET_STATE_FILE || path.join(workspaceRoot, ".deskpet", "state.json");
    const tracePath = path.join(path.dirname(statePath), "hook-trace.jsonl");
    const payload = {
      at: new Date().toISOString(),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      event,
      raw
    };
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Tracing is best effort only.
  }
}

(async () => {
  try {
    const raw = await readStdin();
    const event = parseHookPayload(raw);
    const fallbackEvent = process.env.DESKPET_HOOK_EVENT || process.argv[2];
    if (fallbackEvent && !hookEventName(event)) {
      event.hook_event_name = fallbackEvent;
    }
    writeTrace(event, raw);
    writeDeskpetState(event, mapEvent(event));
  } catch (error) {
    if (process.env.DESKPET_HOOK_DEBUG) {
      process.stderr.write(`deskpet Codex hook failed: ${error.message}\n`);
    }
  }
})();
