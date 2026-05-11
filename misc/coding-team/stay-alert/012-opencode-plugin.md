# 012 — opencode plugin (real)

## Context
Task 010 left `examples/opencode-plugin.ts` as a placeholder TODO. `stay-alert init --opencode` already prints copy-paste setup instructions that inline this file's contents. This task replaces the placeholder with a real working plugin that wires opencode's lifecycle events through `stay-alert`'s core API the same way task 011 did for Claude Code.

The plugin is **distributed as a single TypeScript file** the user copies into their opencode `plugin/` directory. It must therefore:
- Be self-contained except for an import from `stay-alert` (the npm package).
- Use opencode's plugin API exactly as documented.
- Mirror the Claude Code adapter's behavior: `startTurn` on prompt, `endTurn` + `notifyUser` on completion, `notifyUser` pass-through for opencode's own notifications.

## Objective
A working `examples/opencode-plugin.ts` that, when copied into an opencode project's `plugin/` directory, makes opencode emit notifications through stay-alert with focus-aware urgency.

## Scope

### 0. Live docs check (do this BEFORE writing the plugin)

opencode is a young project — its plugin API has been changing. Verify the **current** API by fetching its docs/source. Likely starting points:
- https://opencode.ai/docs/plugins (or the equivalent current path)
- https://github.com/sst/opencode (look in `packages/plugin/`, `packages/sdk/`, or wherever the plugin types live)

Confirm specifically:
- The plugin file shape — default export? named export? plugin factory function? What's its signature?
- The lifecycle event names. We need hooks that fire when:
  - the user submits a prompt (start of an agent turn),
  - the agent finishes responding (end of turn),
  - opencode wants to surface a notification to the user.
- The event payload field names — in particular: session ID, prompt text, message text, title.
- How to register multiple event handlers from a single plugin.
- Whether plugins run in opencode's main process or in a sandbox (matters for whether `await import("stay-alert")` works as expected).

If you can't find authoritative answers for any of these, stop and ask before guessing. Do NOT invent an API shape.

Report:
- The exact URL(s) consulted and (briefly) what each told you.
- The event names / payload shapes you'll target.
- Anything you're uncertain about even after research.

### 1. `examples/opencode-plugin.ts`

Self-contained plugin. Allowed imports: `stay-alert` (our npm package, eventually) and opencode's plugin SDK type imports.

Approximate shape (adapt to whatever the docs actually require):

```typescript
import { createContext, startTurn, endTurn, notifyUser } from "stay-alert";
// ...opencode SDK imports per docs

let ctxPromise: Promise<Awaited<ReturnType<typeof createContext>>> | null = null;
function ctx() { return (ctxPromise ??= createContext()); }

export const StayAlertPlugin = ... // whatever shape opencode requires
```

Mirror the Claude Code adapter's three behaviors:

| opencode event             | stay-alert call                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------- |
| user prompt submitted      | `await startTurn(await ctx(), { source: "opencode", sessionID, promptText })`          |
| agent turn ended           | `await endTurn(...)` then `await notifyUser({title: "opencode", message: "Done in X"})` |
| opencode wants to notify   | `await notifyUser({title: title ?? "opencode", message})` pass-through                  |

Use `formatDuration` — but `_format.ts` is internal to the CLI. **Inline a copy** of `formatDuration` into the plugin file (~10 lines) rather than exporting it from the package. The plugin is a snippet, not a runtime that lives inside our repo; cross-importing internal helpers across that boundary creates fragile coupling.

**Error policy** (same as Claude Code hooks): every event handler wrapped in try/catch that logs to a sensible logger and never throws. opencode hosts the plugin in-process; an uncaught throw could disrupt the user's session.

**Logging**: prefer opencode's logger if its plugin API exposes one; otherwise `console.warn` is fine.

### 2. Update `stats.ts` zero-state behavior — **only if needed**

Quickly confirm `Source` in `src/core/types.ts` already includes `"opencode"`. It does (we set this up in task 002). No change needed; just verify and move on.

### 3. Verify

- `bun run typecheck` and `bun run lint` exit 0. The plugin file is in `examples/` which is included in the tsconfig if you check — confirm it's typechecked. If it isn't currently in `include`, add it (and only `examples/`) so the plugin file gets type coverage.
- `bun run src/cli/index.ts init --opencode` should print the new, real plugin contents in its setup block (no more TODO comment).

We can't end-to-end test the plugin without an actual opencode install; that's the user's job after copying the file.

Report:
- Files modified.
- Output of `bun run src/cli/index.ts init --opencode` (full text — should now show the real plugin code in the snippet block).
- Typecheck + lint output.
- A short summary of which opencode plugin API shape you targeted and why.

## Non-goals / Later
- No automated tests for the plugin (we'd have to mock opencode's plugin host).
- No predictor-driven proactive notifications during long turns. Same as Claude Code adapter — discard the prediction for v1.
- No npm publishing of stay-alert (the plugin's `import "stay-alert"` will only resolve once published; that's documented and expected).
- No bundling of the plugin into a distributable artifact. It's just a copy-paste snippet.

## Constraints / Caveats
- **Verify the opencode API against live docs/source.** Do not assume.
- The plugin is read at runtime by `init.ts` via `Bun.file(path).text()`. Make sure the file is valid standalone TypeScript that an opencode user can copy verbatim — no project-internal imports beyond `stay-alert`.
- The current `examples/opencode-plugin.ts` is a placeholder; replacing its contents is the entire delivery here — no rename, same path.
- Don't add new dependencies to `package.json`. The opencode SDK should be a `type` import only or referenced via inline JSDoc, since this file is a *snippet for the user*, not a build target with its own dependency graph.
