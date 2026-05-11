# Task 017: Makefile for Dev Workflow

## Context

`stay-alert` isn't yet installed on the user's machine. The user wants a Makefile that owns the local install lifecycle (via `bun link`) and aggregates the existing dev quality gates. This is a developer convenience — the canonical install path for end users will still be documented separately.

## Objective

Add a top-level `Makefile` exposing the standard targets to install the CLI globally from this checkout, run hook installation, and run dev quality gates.

## Scope

Create `Makefile` at the repo root with these targets:

- `install`: run `bun link` from the project root. After it succeeds, print `which stay-alert` and a brief next-step hint pointing at `make init`.
- `uninstall`: run `bun unlink`.
- `init`: run `stay-alert init`. (Assumes `install` has run; do not auto-chain — keep targets explicit.)
- `test`: `bun test`
- `lint`: `bunx biome check .`
- `format`: `bunx biome format --write .`
- `typecheck`: `bunx tsc --noEmit`
- `check`: depends on `lint typecheck test` (aggregate; run all three).

Add a `.PHONY` declaration listing every target. Add a default `help` target (also the first target so bare `make` lists what's available) — keep it simple, e.g., a static `@echo` block. Make `help` the default goal.

## Non-goals / Later

- No `clean` target (the user explicitly excluded it; surgical hook removal is non-trivial and can be a future `stay-alert uninstall` subcommand).
- Don't modify `package.json` scripts.
- Don't add CI config.
- Don't auto-chain `install` → `init`; keep explicit.

## Constraints / Caveats

- Use tabs for recipe indentation (Make requires it).
- Keep recipes minimal; no defensive checks (assume `bun` and `bunx` are on PATH — the project already requires Bun).
- `bun link` from a package directory registers the package's bin globally; no separate `bun link <name>` step needed.
