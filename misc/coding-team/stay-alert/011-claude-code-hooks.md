# 011 — Claude Code hook subcommands

## Context
Task 010's `init --claude-code` wrote hook entries pointing at three commands that don't exist yet:

- `stay-alert claude-code-hook on-prompt`        ← UserPromptSubmit
- `stay-alert claude-code-hook on-stop`          ← Stop
- `stay-alert claude-code-hook on-notification`  ← Notification

This task implements them. Each is a thin glue layer between Claude Code's stdin JSON payload and the public core API (`startTurn`, `endTurn`, `notifyUser` from `src/core/index.ts`).

The Claude Code hooks contract (per dev's docs check in task 010):
- Hooks receive a JSON payload on **stdin**.
- Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`.
- `UserPromptSubmit` adds `prompt`.
- `Stop` adds `stop_hook_active`, `last_assistant_message`.
- `Notification` adds `message`, optional `title`, `notification_type`.
- Exit `0` = success. Exit `2` = blocking error (don't use). Other non-zero = non-blocking error.

## Objective
Wire the three hook events through `stay-alert`'s core so prompts produce predictions, stops produce notifications, and Claude Code's own notifications get routed through our notifier policy.

## Scope

### 1. Router wiring (`src/cli/index.ts`)

Add a new top-level command `claude-code-hook` that dispatches to a sub-subcommand:

```
stay-alert claude-code-hook <on-prompt | on-stop | on-notification>
```

Unknown sub-subcommand → throw (top-level catch will format). Help text gets one new line:

```
claude-code-hook <event>     Internal: invoked by Claude Code hooks
```

Mark it "Internal:" so users don't think they should call it directly.

### 2. New file: `src/cli/claude-code-hook.ts`

Single entry point:

```typescript
export async function runClaudeCodeHook(argv: string[]): Promise<void>;
```

Argv handling:
- `argv[0]` = `"on-prompt"` | `"on-stop"` | `"on-notification"`. Anything else → throw.
- No flags. No positional args beyond the subcommand.

Read the entire stdin payload, parse as JSON, dispatch. Use `Bun.stdin.text()` for the read. If stdin is empty or not valid JSON, log a warning to stderr and exit 0 (we never want to block Claude Code).

```typescript
const raw = await Bun.stdin.text();
if (raw.trim() === "") { console.warn("stay-alert: empty hook payload"); return; }
let payload: unknown;
try { payload = JSON.parse(raw); }
catch { console.warn("stay-alert: invalid JSON hook payload"); return; }
```

Then narrow `payload` to a `Record<string, unknown>` and pull fields with type guards. Don't introduce a validation library; a few inline `typeof` checks are fine.

### 3. Event handlers (in the same file)

Each handler builds a `Context` via `createContext()` then calls into core. **Wrap every handler in a top-level try/catch that logs to stderr and exits 0.** Hooks must NEVER fail loudly enough to disrupt Claude Code.

#### `on-prompt`
- Required fields: `session_id` (string), `prompt` (string).
- If either is missing/wrong type → warn + return.
- Call `startTurn(ctx, { source: "claude-code", sessionID: session_id, promptText: prompt })`.
- Discard the returned `PredictionResult` for now (v1 doesn't use predictions for proactive notifications — that's a later feature). The point of calling `startTurn` is to record the in-progress turn so `on-stop` can complete it.
- Print nothing to stdout (Claude Code may interpret stdout in some hooks; staying silent is safest).

#### `on-stop`
- Required field: `session_id` (string).
- If missing → warn + return.
- Call `endTurn(ctx, { source: "claude-code", sessionID: session_id, endReason: "idle" })`.
  - `endReason: "idle"` is correct for Stop hook semantics (Claude finished its turn and is waiting for the user).
  - If `endTurn` returns `null` (no matching in-progress turn — e.g., hook fired without a prior on-prompt), warn and continue; do NOT also try to notify.
- If `endTurn` returned a `Turn`, call `notifyUser(ctx, { title, message })`:
  - `title`: `"Claude Code"`
  - `message`: `\`Done in ${formatDuration(turn.durationMs)}\`` — reuse the existing `formatDuration` from `src/cli/_format.ts`.
- Stdout: silent.

#### `on-notification`
- Required field: `message` (string).
- Optional: `title` (string). If absent, default to `"Claude Code"`.
- Just call `notifyUser(ctx, { title, message })` — pass through.
- Note: this means Claude Code's own notifications (e.g., "Claude needs your permission") get routed through *our* focus-aware policy. That's the whole point — a sticky native notification when terminal is unfocused, transient when focused.
- We do NOT touch `endTurn` here. Notifications are independent of turn lifecycle.

### 4. Verify

- `bun run typecheck` and `bun run lint` exit 0.
- Manual smoke for each handler — pipe a synthetic JSON payload on stdin:

  ```bash
  echo '{"session_id":"test-sess-1","prompt":"hello world"}' | bun run src/cli/index.ts claude-code-hook on-prompt
  echo '{"session_id":"test-sess-1"}' | bun run src/cli/index.ts claude-code-hook on-stop
  echo '{"title":"Test","message":"hi from hook"}' | bun run src/cli/index.ts claude-code-hook on-notification
  ```

  Expected:
  - `on-prompt`: silent stdout, an in-progress turn appears in `state.json`.
  - `on-stop`: silent stdout, a new turn appended to history JSONL, a notification fires.
  - `on-notification`: silent stdout, a notification fires.
  - **Use `STAY_ALERT_HOME=/tmp/sa-hook-test`** for these tests so we don't pollute the user's real history.

- Edge cases to verify behave gracefully (warn + exit 0, no throw):
  - empty stdin
  - invalid JSON
  - missing `session_id`
  - on-stop with no prior on-prompt (warn about missing in-progress, no notification fired)

Report the smoke output.

## Non-goals / Later
- No proactive "still working / X seconds remaining" notifications from `on-prompt`'s predicted duration. That's a future feature — for now the predictor result is just discarded.
- No richer end reasons (no `error`, `tool-permission`, etc.). Just `idle`. Claude Code's Stop event doesn't differentiate.
- No `transcript_path` parsing for tool calls. `toolCalls: []` is fine for v1.
- No tests — manual smoke only.
- No changes to `init.ts` — the contract was already locked there.

## Constraints / Caveats
- **Never throw out of a hook handler.** Top-level try/catch in each branch, log to stderr, exit 0. A hook that exits non-zero pollutes Claude Code's UI.
- Hooks may run concurrently across sessions. The state file's last-write-wins concurrency caveat (documented in v1) applies.
- Don't print to stdout from hook handlers. Claude Code's contract for some hook events allows stdout to be interpreted as JSON output that mutates behavior; staying silent avoids surprises.
- `model` field is not in the documented payload, so don't try to extract it.
- Use `Bun.stdin.text()` (not `process.stdin` streams) — simpler and matches our Bun-only stance.
