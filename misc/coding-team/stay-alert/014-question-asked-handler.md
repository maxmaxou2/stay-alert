# Task 014 — Add `question.asked` handler to opencode plugin

## Context

The user's existing `~/.config/opencode/plugins/notify.ts` handles three events: `session.idle`, `permission.updated`, `question.asked`. Tasks 012 and 013 covered the first two. The `question.asked` handler was incorrectly skipped in task 013 because the architect inspected the wrong SDK source (the upstream `anomalyco/opencode/dev` branch lacks it). The user's locally installed `@opencode-ai/sdk` v2 **does** define `question.asked`, and their existing plugin uses it. We need feature parity before the user dogfoods.

Confirmed shape from `/Users/maxence/.config/opencode/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`:

```ts
type QuestionInfo = {
  question: string;        // full text
  header: string;          // short label (≤30 chars)
  // ...other fields ignored
};
type QuestionRequest = {
  id: string;
  sessionID: string;
  questions: Array<QuestionInfo>;
  tool?: QuestionTool;
};
type EventQuestionAsked = {
  type: "question.asked";
  properties: QuestionRequest;  // i.e. has `sessionID` and `questions`
};
```

## Objective

In `examples/opencode-plugin.ts`, add a `question.asked` event branch that fires a notification when the agent asks the user a structured question.

## Scope

- File: `examples/opencode-plugin.ts` only.
- Add an inline structural type guard `isQuestionAskedEvent(event)` matching the shape above (only what we use: `properties.sessionID: string` and `properties.questions: Array<{ header?: string; question?: string }>`).
- Add the branch in the `event` handler, placed after the `permission.updated` branch and before `tui.toast.show`:
  - Apply the subagent filter (`isSubagentSession(client, event.properties.sessionID, warn)`); if subagent, return.
  - Build the notification message:
    - Take the first question (`event.properties.questions[0]`).
    - Prefer `header` (if non-empty string), else fall back to `question` (if non-empty string), else `"Question waiting"`.
  - Call `notifyUser(await ctx(), { title: "opencode", message })`.
- Keep the existing outer try/catch for crash safety. Do NOT add a redundant inner try/catch (consistency with task 013 cleanup).

## Non-goals / Later

- Don't surface multiple questions in one notification — first one is enough; the user will see the rest in the TUI.
- Don't add a `question.replied` or `question.rejected` handler.
- Don't try to import types from `@opencode-ai/sdk` — keep the plugin self-contained with inline structural types.

## Constraints / Caveats

- The `properties.questions` field is typed as `Array<QuestionInfo>` in the real SDK; treat it defensively (might be empty, items might lack the optional fields).
- The plugin must remain a single self-contained snippet that only imports from `stay-alert`.
