# 005 — Notify subsystem (interface, dispatcher, macOS impl)

## Context
Notifications are the user-visible output of this tool. Two flavors:
- **Transient**: short banner, auto-dismisses, no sound. macOS impl: `osascript -e 'display notification ...'`.
- **Sticky**: persists in Notification Center until dismissed, plays sound. macOS impl: `terminal-notifier`.

The decision of *which* to use lives in `core/index.ts` (task 007), based on focus detection. This task only provides the mechanism.

## Objective
A minimal pluggable notifier system. v1 registers exactly one notifier (macOS); the interface exists so adding Linux/Windows in the future is mechanical.

## Scope

### 1. `src/core/notify/types.ts`

```typescript
import type { NotifyOptions } from "../types.ts";

export type { NotifyOptions };

export interface Notifier {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  notify(opts: NotifyOptions): Promise<void>;
}
```

That's the entire file. Re-export `NotifyOptions` from `core/types.ts` for ergonomic imports inside `notify/`.

### 2. `src/core/notify/macos.ts`

Implement the macOS notifier. Do NOT export a class — export a single object literal (or a factory if state is needed; here it isn't).

```typescript
export const macosNotifier: Notifier = {
  name: "macos",
  async isAvailable() { /* ... */ },
  async notify(opts) { /* ... */ },
};
```

Behavior:

- `isAvailable()`: returns `process.platform === "darwin"`. Don't probe for `terminal-notifier` here — that's a per-call concern handled below.

- `notify(opts)`:
  - **Transient path (`opts.urgency === "transient"`)**: spawn
    `osascript -e 'display notification "<message>" with title "<title>"'`.
    AppleScript escaping: backslash-escape `"` and `\` in both `title` and `message`. Use a small private helper `escapeAppleScript(s: string): string`. Hard timeout 1000ms. Ignore non-zero exit (Notification Center may legitimately fail when it's busy).
  - **Sticky path (`opts.urgency === "sticky"`)**: try `terminal-notifier -title <title> -message <message> [-sound <sound>]`. Pass title/message as separate argv elements (no shell escaping needed). If `terminal-notifier` is not installed (ENOENT on spawn, or non-zero exit code), fall back to the transient osascript path with a one-time `console.warn` instructing the user how to install (`brew install terminal-notifier`).
  - Sound: only the sticky path uses `opts.sound`. Transient ignores it (osascript notifications can't play arbitrary sounds reliably across macOS versions; we leave this to a later task if needed).

- All spawns via `Bun.spawn`. Reuse the `Bun.spawn` + AbortController pattern from `focus.ts`.

- The "missing terminal-notifier" warning must use the same once-per-process throttle pattern as the osascript ENOENT warn in `focus.ts`. Don't spam stderr.

### 3. `src/core/notify/index.ts` (dispatcher)

```typescript
import type { NotifyOptions } from "../types.ts";
import type { Notifier } from "./types.ts";
import { macosNotifier } from "./macos.ts";

export const notifiers: Notifier[] = [macosNotifier];

export async function notify(opts: NotifyOptions): Promise<void>;
```

- Iterate `notifiers` in order; pick the first whose `isAvailable()` resolves true; call its `notify(opts)`.
- If none are available: throw `Error("stay-alert: no available notifier for this platform")`. The CLI will format this nicely later.
- Keep the `notifiers` array exported so future code (or tests) can register/inspect notifiers; don't add a `register` function.

### 4. Helper: AppleScript escaping

Inline the helper in `macos.ts`. Two characters need escaping for AppleScript double-quoted strings: `\` → `\\` and `"` → `\"`. Newlines pass through fine (AppleScript treats `\n` literally inside the string and Notification Center accepts multi-line). Don't try to handle other characters — keep it minimal.

## Non-goals / Later
- No support for action buttons, reply boxes, or notification sounds beyond `default`.
- No notification grouping / coalescing.
- No fallback to `say`, `afplay`, or other audio.
- No Linux/Windows notifiers (separate files in a future task).
- No tests yet.

## Constraints / Caveats
- **Don't bundle terminal-notifier.** It's a heavy native binary; require the user to install via Homebrew. Fallback is the transient osascript path so the tool is still useful.
- **Don't add the `node-notifier` package** — it's bigger, less reliable on modern macOS, and bundles a bunch of binaries.
- File sizes: `macos.ts` should be under ~100 lines. Each function does one thing.
- The dispatcher MUST be the only thing the rest of the codebase imports from `notify/`. Don't re-export `macosNotifier` from `notify/index.ts` — that would let callers bypass `isAvailable()`.
