# 006 — Predictor (interface + median strategy + timeout)

## Context
At prompt-submit time, the tool predicts how long the agent will run before needing the user again. v1 strategy: median duration of recent completed turns from the same source. The interface is the seam where v2 (Haiku-based predictor) plugs in without rewriting callers.

## Objective
Define the `Predictor` interface, ship the median strategy as the v1 default, and provide a small wrapper that enforces a configurable timeout (`config.predictor.timeoutMs`).

## Scope

### `src/core/predictor.ts`

All in one file — small enough not to warrant a folder.

```typescript
import type { Paths } from "./paths.ts";
import type { Config } from "./config.ts";
import type { PredictionResult, Source, Turn } from "./types.ts";

export type PredictInput = {
  promptText: string;
  source: Source;
};

export interface Predictor {
  readonly name: string;
  predict(input: PredictInput): Promise<PredictionResult>;
}

// Factory for the v1 strategy.
export function createMedianPredictor(paths: Paths, config: Config): Predictor;

// Wrapper applying config.predictor.timeoutMs.
export function withTimeout(p: Predictor, timeoutMs: number): Predictor;
```

#### `createMedianPredictor`

- `name = "median"`.
- `predict({ source })` (ignores `promptText` for v0):
  1. `readTurns(paths)` (the entire history; small file, fine).
  2. Filter to entries where `endedAt !== null && durationMs !== null && source === input.source`.
  3. Take the **last `config.predictor.sampleSize`** of those (slice from the tail).
  4. If the slice is empty → return `{ etaMs: null, basis: "no history yet", confidence: "low" }`.
  5. Else compute the median of `durationMs` values. Return:
     ```typescript
     {
       etaMs: median,
       basis: `median of ${slice.length} recent ${input.source} turns`,
       confidence: slice.length >= config.predictor.sampleSize ? "medium" : "low",
     }
     ```
     (We get to "medium" once we have a full sample window; "high" is reserved for a future LLM-based predictor.)

#### `withTimeout(p, timeoutMs)`

- Returns a new `Predictor` whose `name = `${p.name}+timeout``, that races `p.predict(input)` against a `setTimeout` for `timeoutMs`.
- On timeout: resolve to `{ etaMs: null, basis: "predictor timed out", confidence: "low" }`. Do NOT cancel the underlying `predict()` (we don't have a cancellation contract on the interface yet); just stop waiting. This is fine because `predict` only reads files in v1.
- On predictor error: catch and resolve to `{ etaMs: null, basis: "predictor error", confidence: "low" }` — also `console.warn` the underlying error message once. The caller should never see a thrown prediction.
- Use `Promise.race` with a `setTimeout` you `clearTimeout` on the happy path so the timer doesn't keep the process alive.

#### Median helper

Inline, private. Standard "sort, pick middle" implementation. For even-length arrays return the average of the two middle values, rounded to the nearest integer (durations are ms — sub-ms precision is meaningless).

```typescript
function median(values: number[]): number;
```

Don't import a stats library.

## Non-goals / Later
- No LLM predictor (v2).
- No per-prompt features (length, model, tool-call hints) — `promptText` is ignored for now but kept on the interface so v2 can use it without an interface change.
- No moving averages, percentiles, time-decay weighting.
- No tests yet (task 014).
- No public surface in `core/index.ts` yet — that lands in task 007.

## Constraints / Caveats
- `withTimeout` must be safe to compose around any `Predictor`, including ones that throw synchronously inside their async function. Wrap the inner `p.predict()` call in `Promise.resolve().then(() => p.predict(input))` if needed.
- The "warn once on predictor error" should NOT be a global flag — it should warn at most once per `withTimeout` instance (use a closure variable). Otherwise tests sharing process state would suppress legitimate warnings.
- File length target: under 120 lines.
