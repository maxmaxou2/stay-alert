import { access } from "node:fs/promises";
import type { Config } from "./config.ts";
import { resolvePaths } from "./paths.ts";

const FOCUS_TIMEOUT_MS = 250;
const FRONTMOST_APP_SCRIPT =
	'tell application "System Events" to get name of first application process whose frontmost is true';
let hasWarnedAboutMissingOsascript = false;
let frontmostBinCache: string | null | undefined;

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
	const appName = await readFrontmostAppName();

	if (appName === null) {
		return { focused: false, appName: null };
	}

	return {
		focused: matchesTerminalApp(appName, config.focus.terminalApps),
		appName,
	};
}

async function readFrontmostAppName(): Promise<string | null> {
	const bin = await resolveFrontmostBin();

	if (bin !== null) {
		const fromBin = await runFrontmost([bin]);
		if (fromBin !== null) {
			return fromBin;
		}
	}

	return runFrontmost(["osascript", "-e", FRONTMOST_APP_SCRIPT]);
}

async function resolveFrontmostBin(): Promise<string | null> {
	if (frontmostBinCache !== undefined) {
		return frontmostBinCache;
	}

	const bin = resolvePaths().frontmostBin;

	try {
		await access(bin);
		frontmostBinCache = bin;
	} catch {
		frontmostBinCache = null;
	}

	return frontmostBinCache;
}

async function runFrontmost(argv: string[]): Promise<string | null> {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), FOCUS_TIMEOUT_MS);

	try {
		const proc = Bun.spawn(argv, {
			stdout: "pipe",
			stderr: "ignore",
			signal: abortController.signal,
		});

		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		const appName = stdout.trim();

		if (exitCode !== 0 || appName === "") {
			return null;
		}

		return appName;
	} catch (error) {
		if (
			argv[0] === "osascript" &&
			isNodeError(error) &&
			error.code === "ENOENT" &&
			!hasWarnedAboutMissingOsascript
		) {
			console.warn("stay-alert: osascript not found; focus detection disabled");
			hasWarnedAboutMissingOsascript = true;
		}

		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
