# Task 021: Auto-link `stay-alert` into opencode's node_modules during init

## Context

The opencode plugin (`examples/opencode-plugin.ts`, installed to `~/.config/opencode/plugins/stay-alert.ts`) does:

```ts
import { createContext, endTurn, notifyUser, type PredictionResult, startTurn } from "stay-alert";
```

For this import to resolve, `stay-alert` must be present in `~/.config/opencode/node_modules/`. `make install` runs `bun link` which only registers the package globally (`~/.bun/install/global/node_modules/stay-alert`). Without an additional `bun link stay-alert` run **inside opencode's config dir**, opencode loads the plugin file, hits the failed import, and silently disables it — no error visible to the user, no notifications fire.

This bit the maintainer on first dogfood. Future installs will hit the same dead-end.

## Objective

Have `stay-alert init` (and therefore `make init`) automatically run `bun link stay-alert` inside opencode's config dir as part of opencode setup, so the plugin's import resolves on first run.

## Scope

Edits in `src/cli/init.ts`, inside `installOpencodePlugin` (or a new helper called from it):

1. After successfully writing the plugin file, ensure the global link exists, then run `bun link stay-alert` inside `~/.config/opencode/`.
2. Detection:
   - opencode config dir = `dirname(resolveOpencodePluginFile())/..` i.e. `~/.config/opencode/`. If it doesn't exist (shouldn't happen — we just wrote into it), bail with a warning.
3. Skip the link step if `~/.config/opencode/node_modules/stay-alert` already exists and points to the global link target (idempotent re-run shouldn't re-link). A cheap check: `lstat` the path; if it's a symlink, assume it's correct. If it's a real directory or a broken link, run the link command anyway.
4. Run `bun link stay-alert` via `Bun.spawn(["bun", "link", "stay-alert"], { cwd: opencodeConfigDir, stdio: ["ignore", "pipe", "pipe"] })`. Await `proc.exited`. On non-zero exit, log a warning with the captured stderr and the manual remediation command — do NOT throw. The plugin file write already succeeded; we don't want to rollback for a link failure.
5. If `bun` is not found (`ENOENT` from spawn), warn with a clear message and a manual remediation hint:
   ```
   opencode:    could not auto-link stay-alert into ~/.config/opencode/
                run manually: cd ~/.config/opencode && bun link stay-alert
   ```
6. On success, log:
   ```
   opencode:    linked stay-alert into ~/.config/opencode/node_modules/
   ```
   (Skip this log line on the idempotent-skip path; just stay quiet.)

## Non-goals / Later

- Don't try to install stay-alert globally if it isn't already linked. The user is expected to have run `make install` (which does `bun link`) first. If `bun link stay-alert` fails because the global link is missing, the warning + remediation hint is enough.
- Don't touch opencode's `package.json`. `bun link` modifies `node_modules/` only.
- Don't change Claude Code init.
- No tests for the new spawn (mocking `Bun.spawn` works but the marginal value is low — the existing init tests cover file-write idempotency, which is the real risk).

## Constraints / Caveats

- Order: write the plugin file FIRST, then attempt the link. If the link fails, the file is still in place and the user can fix it manually.
- Only run on macOS (the package itself is `"os": ["darwin"]`, but `init` doesn't currently gate by platform). Don't add a platform gate here either — keep parity with the rest of init.
- The warning must include both what failed and how to fix it (the `cd ~/.config/opencode && bun link stay-alert` line).
