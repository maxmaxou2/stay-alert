# 010 — `init` subcommand (Claude Code hooks + opencode snippet)

## Context
The CLI's onboarding moment. Two adapters need to be wired up:
- **Claude Code**: writes a hook configuration so Claude Code calls back into `stay-alert` on `UserPromptSubmit`, `Stop`, and `Notification` events.
- **opencode**: opencode plugins must live inside the user's opencode config directory and be referenced from the user's `opencode.json`. This isn't easy to install programmatically without potentially clobbering user state, so we **print** a copy-paste-ready setup instead of attempting installation.

## Objective
A `stay-alert init` command that:
- With `--claude-code`, installs/updates Claude Code hook configuration.
- With `--opencode`, prints opencode setup instructions and a copy-paste plugin snippet.
- With both flags (or no flags), does both.

## Scope

### 0. Live docs check (do this BEFORE writing any code)

Fetch and read the current Claude Code hooks documentation. As of late 2025 / 2026, hooks are configured under `~/.claude/settings.json` (NOT loose scripts in `~/.claude/hooks/`). The `hooks` block has the rough shape:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": ".*", "hooks": [{ "type": "command", "command": "..." }] }
    ],
    "Stop": [...],
    "Notification": [...]
  }
}
```

Check Anthropic's hooks doc to confirm:
- The exact key names and shape.
- Which event payload fields are passed on stdin (in particular: `session_id`, prompt text, message/notification type).
- The list of allowed hook types and the expected exit-code semantics.

Use the `webfetch` tool. If you can't reach the docs, ask before guessing. Report the exact URL(s) you used and the parts of the doc you relied on.

The actual hook *entry points* (the scripts that Claude Code spawns) are NOT part of this task — they land in task 012. **For this task**, the `init --claude-code` step writes the settings.json `hooks` block to point at *future* commands like `stay-alert claude-code-hook on-prompt`. We're declaring the contract in this task; task 012 fulfills it.

### 1. `src/cli/init.ts`

```typescript
export async function runInit(argv: string[]): Promise<void>;
```

Argv parsing (hand-rolled):
- `--claude-code` → install Claude Code hooks.
- `--opencode` → print opencode setup.
- Both flags or neither → do both, in that order.
- Unknown flag → throw.

#### Claude Code installer

1. Resolve the Claude Code settings file path. Default: `<HOME>/.claude/settings.json`. Allow override via `CLAUDE_CONFIG_DIR` env var if Claude Code documents one (verify via the docs check). Report whichever convention you settle on.
2. If the file doesn't exist, start from `{}`. Otherwise read + JSON-parse it. **If parsing fails**, abort with a clear error mentioning the path — do NOT overwrite a user file we can't understand.
3. Make a backup: copy the file to `<settings>.stay-alert.bak` before writing. If a backup already exists, leave it (we don't want to clobber a real backup from a failed prior run).
4. Build the hook entries. Each entry should call into the eventual subcommand:
   - `UserPromptSubmit` → `stay-alert claude-code-hook on-prompt`
   - `Stop` → `stay-alert claude-code-hook on-stop`
   - `Notification` → `stay-alert claude-code-hook on-notification`
   The exact JSON shape comes from the docs. Use the matcher pattern Claude Code recommends for "all" matchers (commonly `".*"` or `""` — verify).
5. **Idempotent merge**: if a hook for any of the three events already exists with the same `command` value, leave it. Otherwise append a new entry. Do NOT replace the user's other hooks.
6. Atomic write: write to `<settings>.tmp` then `rename` over the target. Same pattern as `state.ts`.
7. Print a confirmation to stdout:
   ```
   ✓ Updated Claude Code settings: <path>
     Backup: <backup path> (only if newly created)
     Configured hooks: UserPromptSubmit, Stop, Notification
     Restart Claude Code for changes to take effect.
   ```

#### opencode printer

Print to stdout a self-contained set of instructions:

```
opencode setup:

1. Locate your opencode config dir (usually ~/.config/opencode).
2. Create a plugin file at <config-dir>/plugin/stay-alert.ts with the
   contents shown below.
3. Restart opencode.

────────── plugin/stay-alert.ts ──────────
<contents of examples/opencode-plugin.ts>
──────────────────────────────────────────
```

`examples/opencode-plugin.ts` doesn't exist yet (lands in task 011). For THIS task, write a placeholder file at `examples/opencode-plugin.ts` with a single TODO comment:

```typescript
// TODO(task-011): real plugin wiring lands in adapters/opencode/plugin.ts.
// This file will be replaced with the copy-paste-ready snippet then.
```

The init command should `await Bun.file(examples/opencode-plugin.ts).text()` and inline its contents into the printed instructions. So even today, with a placeholder, `stay-alert init --opencode` prints something coherent that gets richer once task 011 lands.

### 2. Wire into `src/cli/index.ts`

- Add the `init` case, dispatching to `runInit(process.argv.slice(3))`.
- Update the help text:
  ```
  Commands:
    init [--claude-code] [--opencode]
                                Install hooks / print setup snippets
    test                        Fire one transient + one sticky notification
    stats [--last N] [--source NAME]
                                Summarize history
    tail                        Live view of completed turns
  ```

### 3. Verify

- `bun run src/cli/index.ts init --opencode` should print the opencode block including the placeholder file content.
- `bun run src/cli/index.ts init --claude-code` should write `~/.claude/settings.json` (or wherever the docs say). **Before committing,** run it against a TEMP HOME to avoid actually mutating the developer's own Claude Code config:
  ```
  HOME=/tmp/sa-init-test bun run src/cli/index.ts init --claude-code
  cat /tmp/sa-init-test/.claude/settings.json
  ```
  Report the resulting JSON file contents.
- Run it twice and confirm idempotency (second run doesn't duplicate hooks, doesn't overwrite the original backup).

## Non-goals / Later
- No `init --uninstall` (later, if asked).
- No automatic detection of which agents the user has installed.
- No real hook entry-point scripts (task 012).
- No real opencode plugin (task 011).
- No tests.

## Constraints / Caveats
- **Be paranoid about the user's settings.json.** If you can't parse it, ABORT. If you can, BACKUP before write. Atomic rename to avoid torn files.
- The hook command strings should reference `stay-alert` by *bare name* (assume it's on PATH after `bun install -g`). The CLI is not yet published; that's fine — we're declaring how it *will* be invoked. Once published this just works.
- Don't add new dependencies. Use `node:fs/promises` for everything.
- Don't reach for a JSON-merge library; the merge logic is a few lines.
