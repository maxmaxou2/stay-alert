#!/usr/bin/env bun

import pkg from "../../package.json" with { type: "json" };

const helpText = `stay-alert — predict and notify when your AI coding agent needs you

Usage:
  stay-alert <command> [options]

Commands:
  init [--claude-code] [--opencode]
                              Install hooks / print setup snippets
  test                        Fire one transient + one sticky notification
  stats [--last N] [--source NAME]
                              Summarize history
  tail                        Live view of completed turns
  claude-code-hook <event>     Internal: invoked by Claude Code hooks

Options:
  --help, -h                  Show this help
  --version, -v               Show version

Set STAY_ALERT_DEBUG=1 for verbose error output.`;

async function main(): Promise<void> {
	const [command] = process.argv.slice(2);

	if (command === undefined || command === "--help" || command === "-h") {
		console.log(helpText);
		return;
	}

	if (command === "--version" || command === "-v") {
		console.log(pkg.version);
		return;
	}

	if (command === "test") {
		const { runTest } = await import("./test.ts");
		await runTest();
		return;
	}

	if (command === "init") {
		const { runInit } = await import("./init.ts");
		await runInit(process.argv.slice(3));
		return;
	}

	if (command === "stats") {
		const { runStats } = await import("./stats.ts");
		await runStats(process.argv.slice(3));
		return;
	}

	if (command === "tail") {
		const { runTail } = await import("./tail.ts");
		await runTail();
		return;
	}

	if (command === "claude-code-hook") {
		const { runClaudeCodeHook } = await import("./claude-code-hook.ts");
		await runClaudeCodeHook(process.argv.slice(3));
		return;
	}

	console.error(`unknown command: ${command}`);
	console.error(helpText);
	process.exit(2);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`error: ${message}`);

	if (process.env.STAY_ALERT_DEBUG) {
		console.error(error);
	}

	process.exit(1);
}
