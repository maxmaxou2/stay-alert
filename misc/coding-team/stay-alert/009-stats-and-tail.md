# 009 — `stats` and `tail` subcommands

## Context
Both commands are read-only views on the JSONL history. `stats` is a one-shot summary; `tail` is a live follower. Bundled because they share a small set of helpers (formatting durations, tail-following a file).

## Objective
Two new subcommands wired into the CLI router:
- `stay-alert stats [--last N] [--source NAME]`
- `stay-alert tail`

## Scope

### 1. `src/cli/stats.ts`

```typescript
export async function runStats(argv: string[]): Promise<void>;
```

Parse args (hand-rolled, no library):
- `--last N` (positive integer) — only consider the last N completed turns from the file (after source filter is applied if both flags are present).
- `--source NAME` — filter to one source (`claude-code` or `opencode`). Validate against the known set; reject other values with a clear error.
- Anything else → throw with a helpful message ("unknown flag: <x>").

Behavior:
1. `const ctx = await createContext();`
2. `const turns = await readTurns(ctx.paths);`
3. Filter to `endedAt !== null && durationMs !== null`. Apply source filter if provided. Apply `--last` (slice from tail) if provided.
4. If empty after filtering: print `"No turns recorded yet."` and return.
5. Else compute and print:
   ```
   stay-alert stats
     turns:      <count>
     by source:  claude-code <n>, opencode <m>     (omit zero entries)
     median:     <formatted>
     p95:        <formatted>
     min / max:  <formatted> / <formatted>
     end reasons: idle <n>, permission <n>, question <n>   (omit zero entries)
   ```
   - Use a small private helper `formatDuration(ms: number): string` that prints `Xms`, `Xs`, or `Xm Ys` depending on magnitude. Round, don't truncate.
   - p95: standard nearest-rank method on the sorted array (`values[Math.ceil(0.95 * n) - 1]`).
   - Use whitespace alignment in the labels (string padding); no table library.

### 2. `src/cli/tail.ts`

```typescript
export async function runTail(): Promise<void>;
```

Behavior:
1. `const ctx = await createContext();`
2. Print a header: `Tailing <ctx.paths.historyFile>. Ctrl-C to stop.`
3. Open the file and seek to its current end (so we don't dump existing history).
4. Watch for appends. **Implementation**: use `Bun.file(historyFile).stream()` is NOT what we want here (that streams the whole file). Use `node:fs.watch(historyFile, { persistent: true })` and on each `change` event, read from the last known offset to `stat.size`, decode UTF-8, split on `\n`, parse each non-empty line as a `Turn`, and pretty-print one line per turn:
   ```
   <ISO startedAt>  [source]  <formatted duration>  reason=<endReason>  prompt="<first 60 chars>…"
   ```
5. Handle the file not existing yet: stat the file; if missing, ensure the dir exists and `appendFile` an empty payload to create it (or just wait — but `fs.watch` errors on a missing file). Simpler: if missing, print `"(no history file yet — waiting for first turn…)"`, then poll every 1s with `fs.stat` until it exists, then start watching.
6. SIGINT: `process.on("SIGINT", () => { console.log(); process.exit(0); });` so Ctrl-C exits cleanly without a stack.
7. Malformed lines: skip silently (history.ts already has its own warn for bulk reads; here we don't want to spam the stream).

### 3. Wire into `src/cli/index.ts`

Add `stats` and `tail` cases. Update help text:
```
Commands:
  test                        Fire one transient + one sticky notification
  stats [--last N] [--source NAME]
                              Summarize history
  tail                        Live view of completed turns
  init                        (coming soon)
```
For `stats`, pass the remaining argv slice (`process.argv.slice(3)`) to `runStats`.

## Non-goals / Later
- No JSON output mode for stats (could come later behind `--json`).
- No interactive UI for tail.
- No filtering on tail.
- No tests.

## Constraints / Caveats
- `fs.watch` on macOS uses kqueue and fires `"change"` events on appends. It can occasionally fire spuriously or miss writes; that's acceptable for v1. Don't add a fallback poller.
- Read between offsets via `fs.open` + `fileHandle.read` (Buffer-based) or `fs.createReadStream(path, { start, end })` and accumulate to a string. Either works; pick the one that keeps the file small.
- Shared formatting helper `formatDuration(ms)` may be duplicated between `stats.ts` and `tail.ts`, OR moved to `src/cli/_format.ts`. Use the shared file approach if it's used in both places — small DRY win and keeps the shape obvious.
- Don't widen the public surface in `src/core/index.ts` for these. Use what's already exported (`readTurns`, `createContext`, etc.).
