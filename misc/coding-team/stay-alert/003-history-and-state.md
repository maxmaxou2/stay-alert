# 003 — History (JSONL) and in-progress state

## Context
Two persistence concerns, both small:
- **Completed turns** → append-only JSONL at `paths.historyFile`. Shared across Claude Code and opencode. Must be safe under concurrent writes from multiple processes (multiple terminal sessions running simultaneously).
- **In-progress turns** → a small JSON map at `paths.stateFile` keyed by `sessionID`. Used to look up `startedAt` (and the rest of the in-progress record) when end-of-turn fires. Also potentially read concurrently from multiple processes.

## Objective
Provide minimal, correct read/write primitives for both stores. No business logic about *when* to write — that lives in `core/index.ts` (task 007).

## Scope

### 1. `src/core/history.ts`

```typescript
import type { Paths } from "./paths.ts";
import type { Turn } from "./types.ts";

export async function appendTurn(paths: Paths, turn: Turn): Promise<void>;
export async function readTurns(paths: Paths, opts?: { limit?: number }): Promise<Turn[]>;
```

`appendTurn`:
- `ensureDir(paths.dataDir)` first.
- Serialize turn as JSON, append a single line ending in `\n`.
- Use `fs.appendFile` from `node:fs/promises` with `flag: "a"` (default) — this opens with `O_APPEND`, which on POSIX guarantees atomic appends for writes ≤ `PIPE_BUF` (4096 bytes on macOS). A serialized `Turn` with a 500-char prompt comfortably fits well under 4 KB.
- If a serialized turn would exceed 4096 bytes (paranoid edge case — extremely long tool-call list), still write it; just document the limitation in a brief code comment. Don't try to lock or chunk.

`readTurns`:
- If file does not exist: return `[]`.
- Read whole file, split on `\n`, drop empty lines, `JSON.parse` each.
- **Skip and `console.warn`** on lines that fail to parse — never throw on a single bad line. We must tolerate partial/torn writes from a crash. Warning format: `"stay-alert: skipping malformed history line N: <error>"`.
- Filter to lines whose parsed object has `id`, `source`, `sessionID`, and `startedAt` — anything missing those is also skipped with a warn. Don't validate every field.
- `opts.limit`, if provided, returns the **last N** turns (by file order).

Don't memo, don't stream, don't paginate. Even at 10k turns this file will be a few MB; a one-shot read is fine. Performance work is explicitly deferred.

Also export a tiny helper for ID generation:

```typescript
export function newTurnId(): string;  // ulid
```

Add `ulid` as a runtime dependency (`bun add ulid`). Tiny, zero-dep, sortable, what we want.

### 2. `src/core/state.ts`

```typescript
import type { Paths } from "./paths.ts";
import type { InProgressTurn } from "./types.ts";

export async function readState(paths: Paths): Promise<Record<string, InProgressTurn>>;
export async function putInProgress(paths: Paths, turn: InProgressTurn): Promise<void>;
export async function takeInProgress(paths: Paths, sessionID: string): Promise<InProgressTurn | null>;
```

`readState`:
- If file missing or empty: return `{}`.
- If file is malformed JSON: log a `console.warn` and return `{}`. State is recoverable — we'd rather lose a few in-progress records than crash. (A torn write under concurrent access could produce malformed JSON.)

`putInProgress`:
- `ensureDir(paths.dataDir)`.
- Read current state, set `state[turn.sessionID] = turn`, write atomically: write to `<stateFile>.tmp.<pid>.<random>` and `fs.rename` over the target. Atomic rename is the standard POSIX trick for "no torn reads".
- Concurrency caveat: two processes racing on `putInProgress` can lose one update (last write wins). For our use case — one in-progress turn per `sessionID`, sessions don't overlap on the same ID — this is acceptable. Document it in a one-line comment.

`takeInProgress`:
- Read state, pop the entry for `sessionID`, write the rest back via the same atomic-rename pattern. Return the popped entry or `null`.
- Same concurrency caveat applies.

If a future task needs stronger guarantees we can layer in a lockfile via `proper-lockfile` or similar; not now.

### 3. Wire dependency

- Add `ulid` to `dependencies`. No new devDependencies.

## Non-goals / Later
- No SQLite. No streaming readers. No file rotation.
- No locking library. No multi-process coordination beyond append-with-O_APPEND and atomic rename.
- No pruning / vacuuming of history.
- No `core/index.ts` glue — that's task 007.
- No tests yet (task 014).

## Constraints / Caveats
- **Paths injected, not resolved internally.** Both modules accept `Paths` so tests / CLI can swap them.
- All I/O via `node:fs/promises`. No `Bun.file` here either.
- Atomic-rename helper: feel free to define a tiny private helper inside `state.ts`, or a shared one if you prefer. Don't pull in a library.
- ULIDs in `newTurnId()` — use the `ulid` package, not a hand-rolled implementation.
- Don't add a JSON-Lines library. `JSON.stringify` + `\n` is exactly enough.
