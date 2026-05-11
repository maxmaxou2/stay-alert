#!/usr/bin/env bun

import pkg from "../../package.json" with { type: "json" };

const helpText = `stay-alert — predict and notify when your AI coding agent needs you

Usage:
  stay-alert <command> [options]

Commands:
  test               Fire one transient + one sticky notification
  init               (coming soon)
  stats              (coming soon)
  tail               (coming soon)

Options:
  --help, -h         Show this help
  --version, -v      Show version

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
