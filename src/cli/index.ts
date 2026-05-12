#!/usr/bin/env bun

import pkg from "../../package.json" with { type: "json" };

const helpText = `stay-alert — notify when your AI coding agent or long-running command needs you

Usage:
  stay-alert <command> [options]

Commands:
  init [--claude-code] [--opencode] [--shell] [--shell-rc PATH]
                              Install Claude Code hooks / opencode plugin / shell hook
                              --shell-rc PATH overrides the default ~/.zshrc target
  grant-terminal-notifications
                              Trigger this terminal's macOS notification permission prompt
                              (run once per terminal app you use)
  test                        Fire one transient + one sticky notification
  claude-code-hook <event>    Internal: invoked by Claude Code hooks
  notify-command --cmd C --exit N --duration-ms N
                              Internal: invoked by the shell hook on each command

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

	if (command === "claude-code-hook") {
		const { runClaudeCodeHook } = await import("./claude-code-hook.ts");
		await runClaudeCodeHook(process.argv.slice(3));
		return;
	}

	if (command === "grant-terminal-notifications") {
		const { runGrantTerminalNotifications } = await import(
			"./grant-terminal-notifications.ts"
		);
		await runGrantTerminalNotifications();
		return;
	}

	if (command === "notify-command") {
		const { runNotifyCommand } = await import("./notify-command.ts");
		await runNotifyCommand(process.argv.slice(3));
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
