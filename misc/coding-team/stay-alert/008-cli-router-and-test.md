# 008 — CLI router + `test` subcommand

## Context
First user-facing surface. The CLI is a thin layer on top of `core/index.ts`. Per the original spec, ship `test` first so end-to-end notification delivery is verifiable before the rest of the commands land.

## Objective
A working `stay-alert` binary that:
- Parses subcommands and dispatches to handlers.
- Has `test`, `--help`, `--version` working.
- Prints clean, actionable errors at the boundary (formatting `Error.message`, no stack traces unless `STAY_ALERT_DEBUG=1`).

## Scope

### 1. `src/cli/index.ts`

- Shebang line: `#!/usr/bin/env bun`. Bun will execute the TS file directly via the bin entry.
- Use `process.argv.slice(2)` for args. **No CLI framework** (no commander, yargs, oclif). The arg surface is small enough that a hand-rolled router is simpler and faster to start. 6 subcommands max.
- Dispatch:
  - `test` → import + call `runTest()` from `./test.ts`.
  - `--help` / `-h` / no args → print help text (defined inline).
  - `--version` / `-v` → print `package.json` version. Read via `import pkg from "../../package.json" with { type: "json" };` (resolveJsonModule is on).
  - Unknown subcommand → print "unknown command: <name>" + help to stderr, exit 2.
- Wrap the entire dispatch in a top-level `try/catch`:
  - Print `error: ${err.message}` to stderr.
  - If `process.env.STAY_ALERT_DEBUG`: also `console.error(err)` (full stack).
  - Exit 1.
- Help text content:
  ```
  stay-alert — predict and notify when your AI coding agent needs you

  Usage:
    stay-alert <command> [options]

  Commands:
    test               Fire one transient + one sticky notification
    init               (coming soon)
    stats              (coming soon)
    tail               (coming soon)

  Options:
    --help, -h         Show this help
    --version, -v      Show version

  Set STAY_ALERT_DEBUG=1 for verbose error output.
  ```
  Use a single `console.log` with a template string. Don't reach for chalk/picocolors yet.

### 2. `src/cli/test.ts`

```typescript
export async function runTest(): Promise<void>;
```

Exactly what the brief in the original spec says: fire one transient + one sticky notification so the user can verify that:
1. The notifier(s) work.
2. The macOS notification permission has been granted.
3. terminal-notifier is installed (or the fallback warn fires).

Implementation:

1. `const ctx = await createContext();`
2. **Transient**: directly call the macOS dispatcher path with `urgency: "transient"`. Don't go through `notifyUser` here — `notifyUser` chooses urgency from focus, and for `test` we want to force both. Import `notify` from `../core/notify/index.ts`.
   - `await notify({ title: "stay-alert", message: "Transient: this should banner and auto-dismiss.", urgency: "transient" });`
3. Wait ~1.5s so the user sees them as separate events: `await new Promise(r => setTimeout(r, 1500));`
4. **Sticky**: `await notify({ title: "stay-alert", message: "Sticky: this should persist + ding.", sound: ctx.config.notifications.stickySound, urgency: "sticky" });`
5. Print to stdout:
   ```
   Sent two notifications. If you didn't see them:
     1. Open System Settings → Notifications and confirm Script Editor + terminal-notifier are allowed.
     2. If sticky was missing, run: brew install terminal-notifier
   ```
6. Exit normally (let the caller exit).

### 3. Verify the bin works

After implementation:
- `bun run src/cli/index.ts --help` should print the help text.
- `bun run src/cli/index.ts --version` should print the version.
- `bun run src/cli/index.ts test` should fire two notifications.
- `bun run src/cli/index.ts bogus` should exit 2 with an error.
- `bun link` then `which stay-alert && stay-alert --help` should also work (Bun's bin entries work via shebang).

## Non-goals / Later
- No `init`, `stats`, or `tail` yet (tasks 009/010).
- No coloring, no spinners, no progress bars.
- No flags on `test` (e.g. `--transient-only`).
- No tests.

## Constraints / Caveats
- The shebang requires the `src/cli/index.ts` file to be executable when installed via `npm install -g`. npm sets the right mode bits automatically based on the `bin` entry in package.json — no chmod needed.
- The `test` subcommand will write 0 lines to history (it doesn't go through `startTurn`/`endTurn`). That's intentional.
- Don't import anything from `node_modules` unless you really need it. The CLI should be one or two files, not a tree.
- `package.json` import: TypeScript with `resolveJsonModule: true` plus the JSON `with { type: "json" }` import attribute is the modern, ESM-compliant way. If TypeScript complains about the import attribute syntax under our current config, fall back to `await import("../../package.json", { with: { type: "json" } })` inside the `--version` branch.
