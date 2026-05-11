.PHONY: help setup install uninstall init test lint format typecheck check

SHELL_RC ?= $(HOME)/.zshrc

help:
	@echo "Available targets:"
	@echo "  help       Show this help message"
	@echo "  setup      One-shot: bun link + install Claude Code, opencode, and shell hooks"
	@echo "             Override the shell rc target with: make setup SHELL_RC=/path/to/rc"
	@echo "  install    Link stay-alert globally with bun link"
	@echo "  uninstall  Remove the global bun link"
	@echo "  init       Run stay-alert init (Claude Code + opencode by default)"
	@echo "  test       Run tests"
	@echo "  lint       Run Biome checks"
	@echo "  format     Format files with Biome"
	@echo "  typecheck  Run TypeScript type checking"
	@echo "  check      Run lint, typecheck, and test"

setup:
	bun link
	@which stay-alert
	stay-alert init --claude-code --opencode --shell-rc "$(SHELL_RC)"

install:
	bun link
	which stay-alert
	@echo "Next step: run make init"

uninstall:
	bun unlink

init:
	stay-alert init

test:
	bun test

lint:
	bunx biome check .

format:
	bunx biome format --write .

typecheck:
	bunx tsc --noEmit

check: lint typecheck test
