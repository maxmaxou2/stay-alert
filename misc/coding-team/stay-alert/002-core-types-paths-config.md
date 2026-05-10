# 002 — Core types, paths, config

## Context
Scaffold from task 001 is in place. This task lands the first real source files: shared TypeScript types, path resolution, and TOML config loading with defaults. No I/O behavior beyond reading the config file. No history, no notifications, no predictor yet.

## Objective
Provide a single source of truth for:
1. The shared data model (`Turn`, `PredictionResult`, etc.).
2. Where files live on disk (XDG + override env var).
3. How to load and merge user config with defaults.

These three modules unblock every later module.

## Scope

### 1. `src/core/types.ts`
Define and export:

```typescript
export type Source = "claude-code" | "opencode";
export type EndReason = "idle" | "permission" | "question";

export type Turn = {
  id: string;                    // ulid
  source: Source;
  sessionID: string;
  promptText: string;            // first 500 chars, trimmed
  startedAt: number;             // unix ms
  endedAt: number | null;
  durationMs: number | null;
  endReason: EndReason | null;
  toolCalls: string[];
  model?: string;
};

// In-progress turn record (lives in state.json, not history.jsonl)
export type InProgressTurn = {
  id: string;
  source: Source;
  sessionID: string;
  promptText: string;
  startedAt: number;
  model?: string;
};

export type PredictionResult = {
  etaMs: number | null;          // null when unknown
  basis: string;                 // human-readable explanation
  confidence: "low" | "medium" | "high";
};

export type NotifyUrgency = "transient" | "sticky";

export type NotifyOptions = {
  title: string;
  message: string;
  sound?: string;                // notifier-defined; e.g. "default" on macOS
  urgency: NotifyUrgency;
};
```

Keep this file pure types — no runtime exports, no enums. Use `export type` everywhere (we have `verbatimModuleSyntax` on).

### 2. `src/core/paths.ts`

Resolve all on-disk locations. Pure functions, no side effects (no `mkdir`).

```typescript
export type Paths = {
  configDir: string;
  configFile: string;     // <configDir>/config.toml
  dataDir: string;
  historyFile: string;    // <dataDir>/history.jsonl
  stateFile: string;      // <dataDir>/state.json
};

export function resolvePaths(env?: NodeJS.ProcessEnv): Paths;
```

Resolution rules (in order):
1. If `STAY_ALERT_HOME` is set: `configDir = $STAY_ALERT_HOME/config`, `dataDir = $STAY_ALERT_HOME/data`.
2. Else: `configDir = $XDG_CONFIG_HOME/stay-alert` (fallback `$HOME/.config/stay-alert`); `dataDir = $XDG_DATA_HOME/stay-alert` (fallback `$HOME/.local/share/stay-alert`).
3. `$HOME` must be present; if missing, throw with a clear message.

Accept an optional `env` arg (defaults to `process.env`) so tests can pass a fake env without monkey-patching `process.env`.

Also export a small helper:

```typescript
export async function ensureDir(dir: string): Promise<void>;
```

Implemented with `node:fs/promises` `mkdir(dir, { recursive: true })`. Used by other modules when they're about to write.

### 3. `src/core/config.ts`

Load TOML config with defaults. Defaults are the source of truth — the user file only overrides.

Default config (define inline as a typed object, not as a TOML string):

```typescript
export type Config = {
  predictor: {
    sampleSize: number;        // default 20
    timeoutMs: number;         // default 1000
  };
  focus: {
    terminalApps: string[];    // default: Ghostty, iTerm2, Terminal, Alacritty, kitty, WezTerm
  };
  notifications: {
    transientSound: string | null;   // default null (no sound)
    stickySound: string;             // default "default"
  };
};

export const DEFAULT_CONFIG: Config = { /* values above */ };

export async function loadConfig(paths: Paths): Promise<Config>;
```

Behavior of `loadConfig`:
- If `paths.configFile` does not exist: return `DEFAULT_CONFIG`. Do NOT create the file.
- If it exists: parse it as TOML, deep-merge over `DEFAULT_CONFIG` (user values win; arrays are replaced wholesale, not merged).
- On parse errors, throw with the file path included in the message.
- Validate types lightly: numbers must be positive, arrays must be string arrays. On invalid value, throw with a path-like indicator (e.g. `"predictor.sampleSize must be a positive integer"`). Don't pull in zod/valibot — hand-rolled `typeof` checks are enough for ~6 fields.

**TOML parser:** add `smol-toml` as a runtime dependency (`bun add smol-toml`). It's small, zero-dep, ESM-native, fast, well-maintained, and handles TOML 1.0. Don't use `@iarna/toml` (CommonJS) or `toml` (unmaintained).

### 4. `examples/config.toml`

Write a commented example file showing every default value, so users can copy it to `~/.config/stay-alert/config.toml` and tweak. Include a one-line comment per section explaining what it does.

### 5. Cleanup

- Remove `"package.json"` from `tsconfig.json`'s `include` array now that we have real source files. Final: `"include": ["src", "test"]`. Verify `bun run typecheck` still exits 0.
- Delete `src/core/.gitkeep` if present (now superseded by the new source files). Leave the other `.gitkeep` files alone.

## Non-goals / Later
- No `src/core/index.ts` yet (lands in task 007 — the public API needs the other modules to exist first).
- No history reading/writing (task 003).
- No state.json reading/writing (task 003).
- No tests yet (task 014). But write the modules so they're trivial to test: pure functions, dependency injection via args.
- No JSON-schema generation, no zod, no class wrappers.

## Constraints / Caveats
- `smol-toml` is a real dep and must be added to `dependencies` (not devDependencies).
- All async I/O via `node:fs/promises`. Don't use `Bun.file` here — keeps these modules trivially portable and easier to test.
- `verbatimModuleSyntax` is on — every type-only import must use `import type`.
- Don't catch-and-swallow errors in `loadConfig`. Let them propagate; the CLI will format them at the boundary.
- `resolvePaths` must NOT touch the filesystem. It only computes paths.
