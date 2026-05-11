# Task 022: Resolve plugin file real path before `bun link` for opencode

## Context

Task 021 added auto-linking of `stay-alert` into opencode's `node_modules` during init. The link is run in `dirname(dirname(resolveOpencodePluginFile()))`, i.e. `~/.config/opencode/`.

This breaks for users whose opencode config dir (or any ancestor of the plugin file) is a symlink — common with dotfile managers. Real-world example:
- `~/.config/opencode/plugins` is a symlink to `~/dotfiles/opencode/.config/opencode/plugins`.
- The plugin file itself (`stay-alert.ts`) is a regular file written into the symlinked directory, so its real path is `~/dotfiles/opencode/.config/opencode/plugins/stay-alert.ts`.
- opencode loads the plugin via `import("file://~/.config/opencode/plugins/stay-alert.ts")`, but Node-style module resolution for the plugin's `import "stay-alert"` starts at the file's **real path**: `~/dotfiles/opencode/.config/opencode/plugins/`. It walks up looking for `node_modules/stay-alert` and never finds it, because we linked into `~/.config/opencode/node_modules/` (the symlink-following path), not `~/dotfiles/opencode/.config/opencode/node_modules/` (the real path).

Result: opencode logs `Cannot find package 'stay-alert'` and silently disables the plugin.

The existing `resolveSymlink()` helper in `init.ts` only resolves the **leaf** (it checks `lstat(file).isSymbolicLink()`). When a directory ancestor is the symlink, the leaf check returns false and the function returns the unresolved path. So even calling `resolveSymlink(pluginFile)` does not fix this case.

## Objective

Make `bun link stay-alert` run in the directory ancestor of the plugin file's **fully resolved real path**, so module resolution from the plugin works regardless of where dotfile symlinks sit in the chain.

## Scope

In `src/cli/init.ts`:

1. `resolveSymlink()`: change behavior so it always returns the fully resolved real path (call `realpath` unconditionally), not just when the leaf is a symlink. Keep existing fallback for dangling-symlink ENOENT (use `readlink` + manual resolution). Keep existing ENOENT-on-the-path fallback (return original).

   - This is a semantic change to the helper. Re-check callers (`installClaudeCodeHooks` and `installOpencodePlugin`) and confirm the new behavior is correct for them too. It should be — both want to write to the canonical real location of an existing file. If you find a caller that genuinely wants the symlink path preserved, leave that caller alone and add a separate code path.

2. `linkOpencodePackage()`: derive `opencodeConfigDir` from the resolved real path of the plugin file:

   ```ts
   const realPluginFile = await resolveSymlink(resolveOpencodePluginFile());
   const opencodeConfigDir = dirname(dirname(realPluginFile));
   ```

   The rest of the function (idempotent-skip check on `node_modules/stay-alert`, spawn, error handling) stays the same — it just operates on the real config dir instead of the symlinked one.

3. Make sure the success log line shows the real path, since that's where the link actually lives.

## Non-goals / Later

- Don't try to also link into the symlink-following config dir as a "redundant safety net". One link in the right place is correct; two links is just confusing.
- Don't restructure `installOpencodePlugin` beyond what falls out of the helper change.
- Don't add tests; the manual reproduction case (dotfile-symlinked plugin dir) is hard to fixture cleanly and the existing init tests still cover the file-write paths.

## Constraints / Caveats

- `realpath` on a non-existent file throws `ENOENT`. We have to keep the existing "if path doesn't exist at all, return as-is" fallback so `installOpencodePlugin` can still write a brand-new file.
- Dangling-symlink case (symlink target doesn't exist): keep the existing `readlink`-based manual resolve so the writer can still write through.
- The Claude Code hook installer also calls `resolveSymlink()`. With the unconditional-realpath change, if `~/.claude/settings.json` is a symlink, we'll now resolve through it (already current behavior). If `~/.claude` itself is a symlink (with `settings.json` being a regular file inside), behavior changes: previously we wrote to `~/.claude/settings.json` (which goes through the symlink anyway via the OS); now we'll write to the resolved real path directly. Functionally identical for atomic-rename writes. No regression.
