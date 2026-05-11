.PHONY: help install uninstall init test lint format typecheck check

help:
	@echo "Available targets:"
	@echo "  help       Show this help message"
	@echo "  install    Link stay-alert globally with bun link"
	@echo "  uninstall  Remove the global bun link"
	@echo "  init       Run stay-alert init"
	@echo "  test       Run tests"
	@echo "  lint       Run Biome checks"
	@echo "  format     Format files with Biome"
	@echo "  typecheck  Run TypeScript type checking"
	@echo "  check      Run lint, typecheck, and test"

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
