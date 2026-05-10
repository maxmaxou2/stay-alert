# 004 — Focus detection (frontmost app)

## Context
Notification urgency depends on whether the user is currently looking at their terminal. We detect this by asking macOS for the frontmost application name and checking it against a configurable list of terminal app names.

## Objective
A single function that returns whether the user is "looking at their terminal" right now, with a safe default on error.

## Scope

### `src/core/focus.ts`

```typescript
import type { Config } from "./config.ts";

export type FocusResult = {
  focused: boolean;
  appName: string | null;   // null when detection failed
};

export async function isTerminalFocused(config: Config): Promise<FocusResult>;
```

Implementation:

- Spawn `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`. Use `Bun.spawn` (we're already on Bun) with stdout captured. Set a hard 250ms timeout via `AbortController`/`signal`.
- On success, trim the stdout, lowercase it, and case-insensitively compare against `config.focus.terminalApps` (also lowercased). Return `{ focused: <bool>, appName: <trimmed name preserving original casing> }`.
- On any failure (spawn error, non-zero exit, timeout, empty output): return `{ focused: false, appName: null }`. The CALLER (in task 007) decides what `false` + `appName: null` means policy-wise — per spec, the policy is "if focus detection fails, default to sticky." We surface the failure via `appName: null` so the caller can distinguish "definitely not focused" from "couldn't tell".
- Do NOT log spawn failures — they'll be common during sleep/lock and we don't want noisy stderr. Log a single `console.warn` only if osascript itself is missing (`ENOENT` on the spawn).

Also export:

```typescript
// Pure helper, exported for testing and reuse.
export function matchesTerminalApp(name: string, terminalApps: string[]): boolean;
```

## Non-goals / Later
- No caching. Detection is cheap (~5–20 ms). If we ever need it cached, add a TTL later.
- No support for tmux/screen detection. Frontmost-app is enough.
- No System Events permission handling code. macOS will prompt the user the first time osascript queries System Events; document this in the README during phase 5.
- No tests yet (task 014).

## Constraints / Caveats
- **macOS-only.** Don't add a Linux/Windows branch. Future cross-platform support will live in sibling files (`focus-linux.ts`, etc.) selected by a thin dispatcher when we add it.
- Use `Bun.spawn`, not `node:child_process` — Bun's API is cleaner and we're committed to Bun.
- Keep this file small (< 80 lines). It does one thing.
