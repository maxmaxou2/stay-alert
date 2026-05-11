# Task 020: Prediction Notification on Turn Start

## Context

`startTurn` already returns a `PredictionResult { etaMs, basis, confidence }`, but no caller uses it. The user wants a notification when a turn starts so they have an upfront expectation of duration.

## Objective

Send a notification on every turn start, for both Claude Code and opencode.

## Scope

### `src/cli/claude-code-hook.ts`
In `handleOnPrompt`:
- After `await startTurn(...)`, capture the returned `PredictionResult`.
- Call `notifyUser(ctx, { title: "Claude Code", message: startMessage(prediction) })`.

### `examples/opencode-plugin.ts`
In the `chat.message` handler:
- After `await startTurn(...)`, capture the returned `PredictionResult`.
- Call `notifyUser(context, { title: "opencode", message: startMessage(prediction) })`.
- Need to thread the context through (currently `await ctx()` is called once); refactor minimally.

### Shared message helper
In Claude Code hook: build a tiny local helper:
```ts
function startMessage(prediction: PredictionResult): string {
  if (prediction.etaMs === null) return "Started";
  return `Started, ~${formatDuration(prediction.etaMs)} expected`;
}
```
For the opencode plugin: inline the same logic (the plugin file is self-contained — no imports from `src/`). Use the existing inlined `formatDuration`. Inline a structural type for the prediction result instead of importing it (the plugin only imports from `stay-alert`'s public surface; `PredictionResult` is exported, so importing it IS allowed and cleaner — use the import).

## Non-goals / Later

- No threshold gating (always notify, even for short predictions).
- No prediction-vs-actual overrun notification.
- Don't change `PredictionResult` shape or `startTurn`'s contract.
- Don't change the "Done in Xs" end-of-turn notification.

## Constraints / Caveats

- When `etaMs === null` (no history yet), send a simple "Started" rather than something like "Started, ~unknown expected".
- Keep message format consistent across both sources.
- Same robustness contract: a failure in the notify call must not break turn tracking. The existing try/catch around the handlers covers this, but make sure the notify is awaited inside the try block (it already is, by virtue of being in the same handler body).
- `notifyUser` is awaited but the underlying `alerter` spawn is detached, so this won't add user-visible latency.
