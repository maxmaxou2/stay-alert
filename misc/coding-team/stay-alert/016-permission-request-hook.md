# Task 016: PermissionRequest Hook for Claude Code

## Context

Claude Code emits a dedicated `PermissionRequest` event when a permission dialog appears (e.g., for `Bash`, `Edit`, MCP tools). Today `stay-alert` only handles `UserPromptSubmit`, `Stop`, and `Notification` — meaning permission prompts only reach us indirectly via `Notification(permission_prompt)`. Adding a dedicated handler is more explicit and reliable, matching the user's prior config.

The matcher field on `PermissionRequest` is the tool name. Input JSON includes the standard common fields plus `tool_name` and `tool_input`.

## Objective

Wire up a `PermissionRequest` hook end-to-end so `stay-alert init` installs it and the CLI handles it by calling `notifyUser`.

## Scope

1. `src/cli/init.ts` — add a 4th entry to `hookSpecs` for event `"PermissionRequest"` with matcher `"*"` and command `stay-alert claude-code-hook on-permission-request`.

2. `src/cli/claude-code-hook.ts`:
   - Add `"on-permission-request"` to the `HookEvent` union and `isHookEvent` guard.
   - Update the usage string.
   - Add `handleOnPermissionRequest(payload)`:
     - Read `tool_name` from payload (string).
     - If missing/non-string, warn to stderr and return (no notification).
     - Build `createContext()` and call `notifyUser(ctx, { title: "Claude Code", message: \`Permission required: ${toolName}\` })`.

## Non-goals / Later

- Do NOT remove or alter the existing `Notification` handler. Accept that `permission_prompt` notifications and `PermissionRequest` may both fire — fine for v1.
- Do NOT inspect `tool_input` to build richer messages.
- No new tests required.

## Constraints / Caveats

- Same robustness contract as other handlers: never throw, never exit non-zero. The outer try/catch in `runClaudeCodeHook` already covers this; just follow the same pattern as `handleOnNotification`.
- Keep the message format consistent with existing notifications (title `"Claude Code"`).
