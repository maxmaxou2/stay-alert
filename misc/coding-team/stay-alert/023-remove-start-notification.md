# Task 023: Remove start-of-turn prediction notification

## Context

Task 020 added a "Started, ~Xs expected" notification fired at every turn start, using the median predictor. We've decided to retire this surface — it adds notification noise without enough accuracy to be useful, and we don't want to invest in a better predictor right now. The predictor and history infrastructure stay in place for future use; only the notification surface goes away.

## Objective

Remove the start-of-turn notification from both the Claude Code hook and the opencode plugin. Leave turn tracking, history writing, and predictor code untouched.

## Scope

### `src/cli/claude-code-hook.ts`, `handleOnPrompt`
- Remove the `await notifyUser(ctx, { title: "Claude Code", message: startMessage(prediction) })` call.
- Stop capturing the prediction into a variable: `await startTurn(ctx, { ... })` (return value ignored).
- Remove the `startMessage` helper function — it becomes unused.
- Remove the `import type { PredictionResult }` line if it becomes unused.

### `examples/opencode-plugin.ts`, `chat.message` handler
- Same changes: remove the `await notifyUser(context, { ... })` call right after `startTurn`.
- Stop capturing the prediction: `await startTurn(context, { ... })` (return value ignored).
- The `context` variable was introduced to thread between `startTurn` and `notifyUser`; revert to `await ctx()` inline if that's cleaner, or keep `const context = await ctx();` and just call `startTurn(context, ...)` — your judgement.
- Remove the `startMessage` helper.
- Remove the `type PredictionResult` import if unused.

### `test/prediction-notification.test.ts`
- Delete the file. Its sole purpose was verifying the start-of-turn notification message.

## Non-goals / Later

- DO NOT remove `startTurn`'s `PredictionResult` return type or change its signature. The predictor + history code stays as-is; some future task may re-enable a notification.
- DO NOT remove the predictor code in `src/core/predictor.ts` or its history reads. Dormant but present.
- DO NOT change the `Done in Xs` end-of-turn notification — that one stays.
- DO NOT touch `src/cli/test.ts` (the smoke test command).

## Constraints / Caveats

- The opencode plugin file change must also be re-installed into `~/.config/opencode/plugins/stay-alert.ts` for the user to pick it up — but `make init` handles this on user request. Don't try to re-install from this task.
- Re-run `make check` to confirm clean.
