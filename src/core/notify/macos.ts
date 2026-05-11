import type { Notifier, NotifyOptions } from "./types.ts";

const NOTIFICATION_GROUP = "stay-alert";
let hasWarnedAboutMissingAlerter = false;

export const macosNotifier: Notifier = {
	name: "macos",
	async isAvailable() {
		return process.platform === "darwin";
	},
	async notify(opts) {
		await notify(opts);
	},
};

async function notify(opts: NotifyOptions): Promise<void> {
	const argv = [
		"alerter",
		"--message",
		opts.message,
		"--title",
		opts.title,
		"--group",
		NOTIFICATION_GROUP,
	];

	if (opts.sound !== undefined) {
		argv.push("--sound", opts.sound);
	}

	if (opts.urgency === "transient") {
		argv.push("--timeout", "5");
	}

	try {
		const proc = Bun.spawn(argv, {
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.unref();
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			warnAboutMissingAlerter();
			return;
		}

		throw error;
	}
}

function warnAboutMissingAlerter(): void {
	if (hasWarnedAboutMissingAlerter) {
		return;
	}

	console.warn(
		"stay-alert: alerter not found; install it with `brew install vjeantet/tap/alerter` for notifications",
	);
	hasWarnedAboutMissingAlerter = true;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
