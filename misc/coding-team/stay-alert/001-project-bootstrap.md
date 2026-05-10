# 001 — Project bootstrap

## Context
New project. Empty repo at the workspace root. macOS-only v1, Bun + TypeScript strict, MIT, open-source. Full architecture and feature spec lives in the user's original message; this task is **only** the scaffold. Do not implement runtime logic.

## Objective
Lay down a minimal, working Bun+TS project scaffold that subsequent tasks can build on without re-litigating tooling choices.

## Scope (do this now)

1. **Verify package name availability** before writing it into `package.json`:
   - Check npm for `stay-alert` (e.g. `npm view stay-alert` — "404" / "not found" means available).
   - Check `https://github.com/stay-alert` / a quick web search for obvious collisions on GitHub org names is nice-to-have but not blocking.
   - If `stay-alert` is taken on npm, **stop and report back** with the conflict and 2–3 suggested fallbacks (e.g. `stayalert`, `stay-alert-cli`, scoped name pending user's npm scope). Do not invent a scope.

2. **`package.json`**:
   - `"name": "stay-alert"` (or the agreed fallback)
   - `"version": "0.0.0"`
   - `"description"`: one line summarizing the tool
   - `"license": "MIT"`
   - `"type": "module"`
   - `"os": ["darwin"]`
   - `"bin": { "stay-alert": "./src/cli/index.ts" }` (Bun runs TS directly; no build step in v1)
   - `"exports"`:
     - `"."` → `./src/core/index.ts`
     - `"./core"` → `./src/core/index.ts` (so opencode plugins can `import { ... } from "stay-alert/core"`)
   - `"engines": { "bun": ">=1.1.0" }`
   - `"scripts"`: `"test": "bun test"`, `"typecheck": "tsc --noEmit"`, `"lint": "biome check ."`, `"format": "biome format --write ."`
   - `devDependencies`: `typescript`, `@types/bun`, `@biomejs/biome`
   - `dependencies`: leave empty for now. (TOML parser, ulid, etc. land in later tasks.)
   - `"files"`: include `src`, `examples`, `README.md`, `LICENSE`

3. **`tsconfig.json`**: strict, `"module": "ESNext"`, `"target": "ES2022"`, `"moduleResolution": "bundler"`, `"types": ["bun"]`, `"noEmit": true`, `"skipLibCheck": true`, `"verbatimModuleSyntax": true`, `"resolveJsonModule": true`. Include `src` and `test`.

4. **`biome.json`**: minimal config — formatter on, linter on with `recommended`. Don't fight Biome defaults; we can tighten later.

5. **`.gitignore`**: `node_modules/`, `*.log`, `.DS_Store`, `bun.lockb` is **kept** (committed), `dist/` (future-proof).

6. **`LICENSE`**: standard MIT, year 2026, copyright holder `Maxence` (use whatever git config shows for `user.name` if different — but don't commit a real email).

7. **`README.md`**: outline only. Headings + one-line TODO under each. Suggested headings: Overview, Status, Install, Quickstart, Configuration, How predictions work, Notifications on macOS, Claude Code setup, opencode setup, Roadmap, License.

8. **Directory structure**: create empty directories with a `.gitkeep` for any that would otherwise be empty:
   ```
   src/core/notify/
   src/cli/
   src/hooks/
   src/adapters/opencode/
   examples/
   test/
   ```
   Do **not** create source files yet — only the directories. Subsequent tasks create the actual files.

9. **`bun install`** to generate `bun.lockb`.

10. **Sanity check**: `bun run typecheck` should pass (with no source files there's nothing to check, but the command should exit 0). `biome check .` should pass.

## Non-goals / Later
- Any source code under `src/` beyond directory placeholders.
- Any TOML parsing dependency, ulid, terminal-notifier checks.
- Any test files.
- Publishing config (`.npmignore`, GitHub Actions, release scripts).
- Husky / lint-staged / commit hooks.

## Constraints / Caveats
- **No build step.** Bun executes TS directly. Don't add `tsup`/`esbuild`/`tsc` build outputs.
- **`"os": ["darwin"]`** is intentional — non-mac users will get a clear `npm install` warning/error. Don't soften this.
- **Two package exports** (`.` and `./core`) intentionally point at the same file for now; the `./core` export is the public surface for plugins and must remain stable.
- The `bin` entry points at a `.ts` file — Bun handles the shebang via its own loader. If you find this needs a `#!/usr/bin/env bun` shebang in the eventual `src/cli/index.ts`, note it for task 008; don't create the file now.

## Acceptance criteria
- `npm view stay-alert` was actually run; result reported.
- `bun install`, `bun run typecheck`, `bun run lint` all exit 0.
- Repo root contains exactly the scaffolding files listed above and the empty directory tree — nothing more.
