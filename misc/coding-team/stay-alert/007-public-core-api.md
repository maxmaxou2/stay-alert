# 007 — Public core API (`src/core/index.ts`)

## Context
End of Phase 2. All the core modules exist; this task wires them into a small public surface that Claude Code hooks, the opencode plugin, and the CLI all consume. This is the only file outside `core/` should know about (other than types).

## Objective
A thin, opinionated facade. No new business logic — only orchestration: tying `paths` + `config` + `state` + `history` + `predictor` + `notify` + `focus` together with the right defaults.

## Scope

### `src/core/index.ts`

Public surface:

```typescript
// Re-exports for plugin/hook authors:
export type {
  Source, EndReason, Turn, InProgressTurn, PredictionResult,
  NotifyOptions, NotifyUrgency,
} from "./types.ts";
export type { Config } from "./config.ts";
export type { Paths } from "./paths.ts";
export type { Predictor, PredictInput } from "./predictor.ts";
export type { Notifier } from "./notify/types.ts";

// Functions:
export { resolvePaths } from "./paths.ts";
export { loadConfig, DEFAULT_CONFIG } from "./config.ts";
export { readTurns } from "./history.ts";

// Public orchestrator API (defined in this file):
export type StartTurnInput = {
  source: Source;
  sessionID: string;
  promptText: string;
  model?: string;
};

export type EndTurnInput = {
  source: Source;
  sessionID: string;
  endReason: EndReason;
  toolCalls?: string[];
};

export type Context = {
  paths: Paths;
  config: Config;
  predictor: Predictor;
};

export async function createContext(env?: NodeJS.ProcessEnv): Promise<Context>;

export async function startTurn(ctx: Context, input: StartTurnInput): Promise<PredictionResult>;
export async function endTurn(ctx: Context, input: EndTurnInput): Promise<Turn | null>;
export async function notifyUser(ctx: Context, opts: { title: string; message: string; sound?: string }): Promise<void>;
```

### Behavior

#### `createContext(env?)`

- `const paths = resolvePaths(env);`
- `const config = await loadConfig(paths);`
- `const predictor = withTimeout(createMedianPredictor(paths, config), config.predictor.timeoutMs);`
- Return `{ paths, config, predictor }`.

This is the one place that bakes the predictor pipeline. Callers never construct predictors directly.

#### `startTurn(ctx, input)`

1. `id = newTurnId()`, `startedAt = Date.now()`.
2. `promptText` truncated to first 500 chars (use `[...str].slice(0, 500).join("")` to handle multi-byte characters correctly — but if you'd rather, `str.slice(0, 500)` is acceptable too; document the choice).
3. Build `InProgressTurn`, `await putInProgress(ctx.paths, ...)`.
4. `const prediction = await ctx.predictor.predict({ promptText, source: input.source });`
5. Return `prediction`.

The CLI / plugin will format and notify based on the returned `prediction`. `startTurn` does NOT call `notifyUser` itself — keeping notification policy in the caller lets the test command issue notifications without writing to history.

#### `endTurn(ctx, input)`

1. `await takeInProgress(ctx.paths, input.sessionID)`. If `null` (no record): `console.warn` and return `null`. (Could happen if the user installed the tool mid-session.)
2. Build a `Turn` object combining the in-progress record with `endedAt = Date.now()`, `durationMs = endedAt - startedAt`, `endReason = input.endReason`, `toolCalls = input.toolCalls ?? []`.
3. `await appendTurn(ctx.paths, turn)`.
4. Return the `Turn`.

Same as above — no notification side effects here.

#### `notifyUser(ctx, opts)`

This is where notification *policy* lives.

1. `const focus = await isTerminalFocused(ctx.config);`
2. **Decision rule** (per spec):
   - `focus.appName === null` (detection failed) → urgency `"sticky"`.
   - `focus.focused === true` → urgency `"transient"`.
   - `focus.focused === false` (detection worked, terminal not in front) → urgency `"sticky"`.
3. Sound:
   - `transient` → `ctx.config.notifications.transientSound ?? undefined`.
   - `sticky` → `ctx.config.notifications.stickySound`.
4. Call `notify({ title, message, sound, urgency })`.

Use the dispatcher from `notify/index.ts` (which currently delegates to macOS). Don't import `macosNotifier` directly.

### Code quality

- File length target: **under 150 lines** including imports and re-exports.
- No new dependencies.
- Imports from sibling modules use the already-established `.ts` extension convention.

## Non-goals / Later
- No CLI logic. No hook/plugin glue. No tests.
- No formatting helpers (e.g. "format ETA as ~2min") — that lives with whoever consumes the prediction.
- No event bus, no observers, no logger abstraction.
- No retries on `notify` failure (the dispatcher already throws clearly when no notifier is available).

## Constraints / Caveats
- `createContext` is the only acceptable way for outside code to obtain a `Context`. Don't expose lower-level constructors from `index.ts`.
- The trio `startTurn`/`endTurn`/`notifyUser` is the entire public API for the orchestrator. Don't add convenience methods (`endTurnAndNotify` etc.) — callers compose them.
- Make sure `Context` and the input types are exported as types, not values.
