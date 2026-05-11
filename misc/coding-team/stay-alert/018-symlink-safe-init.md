# Task 018: Symlink-Safe Init

## Context

`stay-alert init` writes both `~/.claude/settings.json` and `~/.config/opencode/plugins/stay-alert.ts` using a tmp-file + `rename()` pattern. If the target path is a symlink (common: users symlink dotfiles from a managed dotfiles repo), `rename()` replaces the symlink with a regular file, breaking the user's setup. A user just hit this with `~/.claude/settings.json`.

We need to follow symlinks: write to (and back up) the resolved real path, preserving the symlink itself.

## Objective

Both `writeJsonAtomically` (Claude Code settings path) and `writeTextAtomically` + `createExclusiveBackup` (opencode plugin path) must operate on the resolved target if the target is a symlink.

## Scope

In `src/cli/init.ts`:

1. Add a helper `resolveSymlink(file: string): Promise<string>` that returns `await realpath(file)` if the file exists and is a symlink, otherwise returns `file` unchanged. Handle ENOENT (target doesn't exist yet) by returning the input path. Handle dangling symlinks (symlink exists, target doesn't) by returning the symlink's link destination via `readlink` so we still write through.
   - Simpler: use `lstat` to check `isSymbolicLink()`; if true, `realpath` (which resolves the chain). If `realpath` fails ENOENT (dangling), use `readlink` to get the link target and resolve it relative to the symlink's directory.

2. In `writeJsonAtomically`: at the top, replace `settingsFile` parameter usage with `const resolvedFile = await resolveSymlink(settingsFile);` then use `resolvedFile` for both the tmp file path and the rename target. Keep `mkdir(dirname(...))` on the resolved path.

3. In `installOpencodePlugin`: resolve the symlink for `targetFile` once at the top. Use the resolved path for `currentContents` read, backup source, and the write target. The `backupFile` should be `${resolvedFile}.bak` so the backup lives next to the real file, not next to the symlink.
   - The `console.log` messages should still reference the resolved path (so the user sees where the file actually lives).

4. `writeTextAtomically` itself doesn't need changes if callers pass the resolved path. Same for `createExclusiveBackup`.

## Non-goals / Later

- Don't add a flag to opt out of symlink resolution. Always follow.
- Don't preserve symlink + write-through atomicity guarantees beyond what `rename` already gives on the resolved path.
- No new tests required (the existing test uses a fresh tmp HOME and won't exercise symlinks; that's fine for v1).

## Constraints / Caveats

- Use `node:fs/promises` `realpath`, `readlink`, `lstat` — already partially imported. Add what's missing.
- Handle the dangling-symlink case gracefully: writing through a symlink whose target is missing should create the target (current `writeFile` + `rename` to the resolved path achieves this).
- Don't follow symlinks for the `.tmp` file path itself — always create the tmp file in the resolved file's directory so `rename` is atomic (same filesystem).
