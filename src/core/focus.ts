import type { Config } from "./config.ts";

const FOCUS_TIMEOUT_MS = 250;
const FRONTMOST_APP_SCRIPT =
	'tell application "System Events" to get name of first application process whose frontmost is true';
let hasWarnedAboutMissingOsascript = false;

export type FocusResult = {
	focused: boolean;
	appName: string | null;
};

export function matchesTerminalApp(
	name: string,
	terminalApps: string[],
): boolean {
	const normalizedName = name.trim().toLowerCase();

	if (normalizedName === "") {
		return false;
	}

	return terminalApps.some((app) => app.toLowerCase() === normalizedName);
}

export async function isTerminalFocused(config: Config): Promise<FocusResult> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), FOCUS_TIMEOUT_MS);

	try {
		const process = Bun.spawn(["osascript", "-e", FRONTMOST_APP_SCRIPT], {
			stdout: "pipe",
			stderr: "ignore",
			signal: abortController.signal,
		});

		const [stdout, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			process.exited,
		]);
		const appName = stdout.trim();

		if (exitCode !== 0 || appName === "") {
			return { focused: false, appName: null };
		}

		return {
			focused: matchesTerminalApp(appName, config.focus.terminalApps),
			appName,
		};
	} catch (error) {
		if (
			isNodeError(error) &&
			error.code === "ENOENT" &&
			!hasWarnedAboutMissingOsascript
		) {
			console.warn("stay-alert: osascript not found; focus detection disabled");
			hasWarnedAboutMissingOsascript = true;
		}

		return { focused: false, appName: null };
	} finally {
		clearTimeout(timeout);
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
