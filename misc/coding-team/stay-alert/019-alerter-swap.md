# Task 019: Switch from terminal-notifier to alerter

## Context

Two issues with the current macOS notifier:

1. We use `osascript` for "transient" focused-state notifications, but on this user's machine osascript notifications are silently dropped (a known macOS issue with notifications from generic AppleScript runners).
2. `terminal-notifier` (used for "sticky" unfocused-state) has no auto-dismiss option, so unfocused notifications pile up indefinitely.

The user has agreed to switch to [alerter](https://github.com/vjeantet/alerter) (`brew install vjeantet/tap/alerter`). Alerter:
- Stays on screen until dismissed by default (true sticky).
- Supports `--timeout NUMBER` for auto-close.
- Supports `--group ID` so each new notification with the same group replaces the prior one.
- Blocks until dismissed/timed-out — we must spawn it detached so the hook process doesn't hang.

New behavior:
- Focused → `--timeout 5` (auto-close after ~5s).
- Unfocused → no timeout (sticky, stays until user dismisses).
- Single group ID `"stay-alert"` for ALL notifications, so each new event replaces any pending one. The user separately handles clearing on terminal refocus via Hammerspoon (out of scope here).

## Objective

Replace `terminal-notifier` and `osascript` (for delivery) with a single `alerter` code path, restoring the focus-aware policy with the new behavior described above.

## Scope

In `src/core/notify/macos.ts`:

1. Replace the entire file's notification logic with a single `notify` function that builds an `alerter` argv:
   - `alerter --message "..." --title "..." --group stay-alert`
   - Append `--sound <sound>` if `opts.sound` is provided.
   - Append `--timeout 5` if `opts.urgency === "transient"`.
2. Spawn detached so the hook process returns immediately:
   - Use `Bun.spawn` with `stdio: ["ignore", "ignore", "ignore"]`.
   - Do NOT `await proc.exited`. Call `proc.unref()` so the parent can exit.
   - Wrap in try/catch; on `ENOENT` (alerter missing), warn once with the install hint (`brew install vjeantet/tap/alerter`) and return — don't throw.
3. `isAvailable()` stays the same (`process.platform === "darwin"`).
4. Remove `notifyTransient`, `notifySticky`, `escapeAppleScript`, the AppleScript code, and the `terminal-notifier` invocation entirely.

`focus.ts` is unchanged — we still detect focus via osascript (different code path; doesn't require notification permissions). `notifyUser` in `src/core/index.ts` is unchanged (still computes urgency from focus and passes it down).

## Non-goals / Later

- Don't make the group ID configurable. Hardcode `"stay-alert"` for v1.
- Don't add a fallback to terminal-notifier or osascript. Alerter only.
- Don't add a separate "remove on focus" code path; user handles via Hammerspoon.
- Don't change the public `Notifier` interface or `NotifyOptions` shape.
- Don't add a CLI flag for timeout duration. Hardcode 5 seconds.

## Constraints / Caveats

- The "warn once" pattern (per-process flag) for missing alerter mirrors the existing `hasWarnedAboutMissingTerminalNotifier` pattern. Keep it.
- Detached spawn: alerter blocks until dismiss, so awaiting `proc.exited` would hang the hook process for the full duration of a sticky alert. `proc.unref()` is essential.
- No need to escape special characters in `--message` / `--title` — `Bun.spawn` passes argv directly without shell interpretation.
- Update the doc comment / message string in any user-facing warning to mention alerter, not terminal-notifier.
