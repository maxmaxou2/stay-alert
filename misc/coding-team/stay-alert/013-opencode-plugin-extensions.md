# 013 — Extend opencode plugin: permission, question, subagent filter

## Context
Dogfooding revealed three gaps versus the user's existing `~/.config/opencode/plugins/notify.ts`:

1. **`session.idle` fires for subagents too**, producing spurious turn-end notifications when a Task tool finishes. The existing plugin filters by checking `session.parentID` and skipping if non-null.
2. **`permission.updated`** — opencode emits this when a tool needs user permission. stay-alert doesn't handle it.
3. **`question.asked`** — opencode emits this when the agent asks the user a multi-choice question. stay-alert doesn't handle it.

Closing these gaps lets stay-alert *replace* the existing plugin entirely instead of co-existing with it.

The matching opencode events (verified via the SDK source the dev consulted in task 012):
- `session.idle` → `properties: { sessionID }`. To check for subagent, call `client.session.get({ path: { id: sessionID } })` and inspect `data.parentID`.
- `permission.updated` → check the SDK source for the exact properties shape.
- `question.asked` → check the SDK source for the exact properties shape.

## Objective
Update `examples/opencode-plugin.ts` so that, after copying it in, the user can remove `~/.config/opencode/plugins/notify.ts` without losing any notification.

## Scope

### 0. Live SDK check (do this BEFORE coding)

Verify the property shapes for the new events. Look at:
- `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/sdk/js/src/gen/types.gen.ts` (the Event union)
- The user's reference plugin: `/Users/maxence/.config/opencode/plugins/notify.ts` for what they extract.

Confirm:
- `session.get` API for fetching session metadata (used for the subagent filter).
- The properties payload shapes for `permission.updated` and `question.asked`.

If the events don't exist with those exact names in the current SDK, STOP and ask before guessing. (The event names may have been renamed; the user's existing plugin may be running against an older opencode.)

### 1. Update `examples/opencode-plugin.ts`

Add three behaviors. Mirror the existing event-handler structure (try/catch, type guards, warn helper).

#### 1a. Subagent filter for `session.idle`
Inside the `isSessionIdleEvent` branch, before calling `endTurn` and `notifyUser`:
```typescript
const session = await client.session.get({ path: { id: event.properties.sessionID } });
if (session.data?.parentID != null) return; // subagent — skip
```
Wrap the `client.session.get` call in its own try/catch; if it fails, fall through and notify anyway (safer to over-notify than under-notify).

Note: this changes the in-progress turn lifecycle — if `chat.message` already started a turn for the subagent's sessionID, we'd be leaving an in-progress turn dangling. Decide:
- **Option A (recommended)**: also skip `chat.message` `startTurn` for subagent sessions. Adds a `client.session.get` call there too.
- **Option B**: let in-progress turns leak for subagent sessions; they'll be reaped when something else updates state.json or never (last-write-wins).

Pick A — it's correct and the cost is one extra API call per user message.

#### 1b. `permission.updated` handler
Add a new event-type branch. Pass through to `notifyUser`:
```typescript
{ title: "opencode", message: "Permission required" }
```
No `endTurn`. Discriminate via a new type guard `isPermissionUpdatedEvent`.

If the SDK payload contains a meaningful name (e.g., tool name, action), include it in the message — but only if it's a single string field that's safe to render. Don't try to format a complex object. If unsure, stick with the static "Permission required" string.

#### 1c. `question.asked` handler
Same shape. Pass through to `notifyUser`:
```typescript
{ title: "opencode", message: "Question waiting" }
```
No `endTurn`. New guard `isQuestionAskedEvent`.

If the payload contains a question text and it's short enough (e.g., < 80 chars), use it directly. Otherwise the static "Question waiting" string.

### 2. Verify

- `bun run typecheck` and `bun run lint` exit 0.
- `bun run src/cli/index.ts init --opencode` shows the updated plugin in its setup block.
- Re-read the printed output and sanity-check that a user copying it gets a self-contained file (no broken imports, no project-internal references).

We can't end-to-end test without a real opencode install — that's the dogfood step the user does after this lands.

Report:
- Files modified.
- SDK URLs consulted and the event property shapes you confirmed.
- Output of `init --opencode` (full text, since the snippet is the deliverable).
- Whether you went with Option A or B for the subagent in-progress turn question, and why if not A.
- Anything you couldn't confirm from the live SDK.

## Non-goals / Later
- No new core API changes — all wiring stays in the plugin file.
- No automated tests.
- No equivalent extension for the Claude Code adapter — the user's existing `PermissionRequest` hook can stay alongside; Claude Code's `Notification` event with `notification_type: permission_prompt` is the eventual replacement and our existing on-notification handler already passes those through.

## Constraints / Caveats
- The plugin file remains a self-contained copy-paste snippet. Don't add any project-internal imports.
- Don't add a dependency on `@opencode-ai/plugin` — keep the inline structural types.
- The structural types you wrote in task 012 (`OpencodeClient`, `OpencodeEvent`, `Plugin`, etc.) need to grow to cover the new operations (specifically: `client.session.get`). Extend them minimally — only the fields actually used.
- Each new event handler has its own try/catch + warn — same policy as before, never throws out of the plugin host.
- Inline subagent filter logic; don't extract a helper function unless it's used by both `chat.message` and the `session.idle` branch (which it is — go ahead and extract `isSubagentSession(client, sessionID)` if it reads cleaner).
