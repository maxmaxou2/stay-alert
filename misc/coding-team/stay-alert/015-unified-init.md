# Task 015 — Unified, idempotent `stay-alert init`

## Context

`stay-alert init --claude-code` installs hooks idempotently. `stay-alert init --opencode` only prints the plugin source for the user to copy. We want a single command that installs both, with each side independently idempotent.

The opencode plugin source is currently inlined into the printer in `src/cli/init.ts` by reading `examples/opencode-plugin.ts`. That same content is what we want to write to disk.

Existing user state (relevant):
- `~/.config/opencode/plugins/notify.ts` exists (the user's prior plugin). Our install must not touch it.
- `~/.config/opencode/plugin/` does NOT exist. The directory we install into is `~/.config/opencode/plugins/` (plural, matching the user's existing setup).

## Objective

Make `stay-alert init` install BOTH Claude Code hooks AND the opencode plugin file, idempotently. Flags scope to one side. Keep crash-safe and atomic.

## Scope

### CLI surface (`src/cli/index.ts`)
- `stay-alert init` — install both targets.
- `stay-alert init --claude-code` — install only Claude Code hooks (current behaviour).
- `stay-alert init --opencode` — install only the opencode plugin file (NEW behaviour: actually writes the file; no longer prints to stdout).
- Both flags together is equivalent to neither (install both). Reject any other unknown flags as today.

### Opencode plugin install (new function in `src/cli/init.ts` or a sibling file)
- Target path: `~/.config/opencode/plugins/stay-alert.ts`.
  - Use `os.homedir()` to resolve `~`. Do NOT honour XDG vars for this path — keep it simple, matches user's existing layout.
  - Create parent dirs as needed (`fs.mkdir({ recursive: true })`).
- Source content: the contents of `examples/opencode-plugin.ts` (read at runtime — same file the printer already uses).
- If `stay-alert.ts` does NOT exist at the target: write it atomically (tmp file + rename). Done.
- If `stay-alert.ts` ALREADY exists at the target:
  - Read the current file. If its contents are byte-identical to the source we'd write, it's a no-op — print a "no changes" line and return.
  - Otherwise, back up to `stay-alert.ts.bak` using `COPYFILE_EXCL` (fail if `.bak` exists). On failure (e.g., backup already exists), abort with a clear error pointing the user to delete the `.bak` file. Then atomically write the new content.
- Print a one-line summary: created / updated (with backup path) / unchanged.

### Output changes
- The current `init --opencode` snippet printer goes away entirely. The README (task 016 later) will document where the file lives.
- The `init` command should print a per-target status block, e.g.:
  ```
  Claude Code: hooks already up to date (~/.claude/settings.json)
  opencode:    plugin installed at ~/.config/opencode/plugins/stay-alert.ts
  ```
  Use whatever simple formatting reads cleanly; don't over-engineer.

### Idempotency contract
- Re-running `stay-alert init` after a successful install must be a no-op (no backups created, no file rewrites) when nothing has changed on either side.
- Detection is by content equality, not by hash file or marker.

## Non-goals / Later

- No uninstall command.
- No "upgrade" flow beyond backup-then-overwrite.
- No detection of whether opencode/Claude Code is actually installed on the system.
- Don't touch `notify.ts` or any other plugin file.
- Don't add a global config option for the install path.

## Constraints / Caveats

- The opencode plugin source is `examples/opencode-plugin.ts` shipped inside the package. Resolve its path relative to the running source file (e.g., `import.meta.dir` / `path.join(import.meta.dir, "../../examples/opencode-plugin.ts")`), the same way `init.ts` already does for the snippet printer. Verify this still works when invoked via `bun run src/cli/index.ts` AND via the published package layout (we have no published layout yet — just keep the existing resolution scheme).
- Atomic write pattern: write to `${target}.tmp-${pid}-${random}` then `fs.rename`. Same pattern as the Claude Code init.
- Use `fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL)` for the backup, and surface the error message clearly when it fails.
- Never write secrets, never log file contents.
- Keep the existing tests passing. No new tests required for this task (will be covered in later test pass).

## Acceptance criteria

(Only listing because behaviour is non-obvious for the opencode side.)
- Fresh install: file created at the target path; status line says created.
- Re-run with no changes: zero filesystem writes; status line says unchanged.
- Re-run after the source content changed: `.bak` created; new content written atomically; status line mentions the backup path.
- Re-run after content changed AND `.bak` already exists: command aborts with a clear actionable error and exits non-zero. Neither file is modified.
