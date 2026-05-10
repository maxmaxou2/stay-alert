import type { Notifier, NotifyOptions } from "./types.ts";

const SPAWN_TIMEOUT_MS = 1000;
let hasWarnedAboutMissingTerminalNotifier = false;

export const macosNotifier: Notifier = {
	name: "macos",
	async isAvailable() {
		return process.platform === "darwin";
	},
	async notify(opts) {
		if (opts.urgency === "transient") {
			await notifyTransient(opts);
			return;
		}

		await notifySticky(opts);
	},
};

async function notifySticky(opts: NotifyOptions): Promise<void> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), SPAWN_TIMEOUT_MS);
	const argv = [
		"terminal-notifier",
		"-title",
		opts.title,
		"-message",
		opts.message,
	];

	if (opts.sound !== undefined) {
		argv.push("-sound", opts.sound);
	}

	try {
		const proc = Bun.spawn(argv, {
			stdout: "ignore",
			stderr: "ignore",
			signal: abortController.signal,
		});

		const exitCode = await proc.exited;
		if (exitCode === 0) {
			return;
		}
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") {
			throw error;
		}
	} finally {
		clearTimeout(timeout);
	}

	warnAboutMissingTerminalNotifier();
	await notifyTransient(opts);
}

async function notifyTransient(opts: NotifyOptions): Promise<void> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), SPAWN_TIMEOUT_MS);

	try {
		const proc = Bun.spawn(
			[
				"osascript",
				"-e",
				`display notification "${escapeAppleScript(opts.message)}" with title "${escapeAppleScript(opts.title)}"`,
			],
			{
				stdout: "ignore",
				stderr: "ignore",
				signal: abortController.signal,
			},
		);

		await proc.exited;
	} catch {
		// Best-effort notification delivery; ignore timeout and spawn failures.
	} finally {
		clearTimeout(timeout);
	}
}

function warnAboutMissingTerminalNotifier(): void {
	if (hasWarnedAboutMissingTerminalNotifier) {
		return;
	}

	console.warn(
		"stay-alert: terminal-notifier not found; install it with `brew install terminal-notifier` for sticky notifications",
	);
	hasWarnedAboutMissingTerminalNotifier = true;
}

function escapeAppleScript(s: string): string {
	return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
