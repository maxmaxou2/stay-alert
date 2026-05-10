import { appendFile, readFile } from "node:fs/promises";
import { ulid } from "ulid";
import { ensureDir, type Paths } from "./paths.ts";
import type { Turn } from "./types.ts";

export function newTurnId(): string {
	return ulid();
}

export async function appendTurn(paths: Paths, turn: Turn): Promise<void> {
	await ensureDir(paths.dataDir);

	const line = `${JSON.stringify(turn)}\n`;
	// O_APPEND is atomic for writes up to PIPE_BUF; larger turns are still appended,
	// but POSIX does not guarantee atomicity for that paranoid edge case.
	await appendFile(paths.historyFile, line, { flag: "a" });
}

export async function readTurns(
	paths: Paths,
	opts?: { limit?: number },
): Promise<Turn[]> {
	let contents: string;

	try {
		contents = await readFile(paths.historyFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return [];
		}

		throw error;
	}

	const turns: Turn[] = [];
	const lines = contents.split("\n");

	for (const [index, line] of lines.entries()) {
		if (line === "") {
			continue;
		}

		let parsed: unknown;

		try {
			parsed = JSON.parse(line);
		} catch (error) {
			warnMalformedLine(index + 1, error);
			continue;
		}

		if (!isTurnLike(parsed)) {
			warnMalformedLine(index + 1, "missing required fields");
			continue;
		}

		turns.push(parsed);
	}

	if (opts?.limit === undefined) {
		return turns;
	}

	return turns.slice(-opts.limit);
}

function isTurnLike(value: unknown): value is Turn {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		"source" in value &&
		"sessionID" in value &&
		"startedAt" in value
	);
}

function warnMalformedLine(lineNumber: number, error: unknown): void {
	console.warn(
		`stay-alert: skipping malformed history line ${lineNumber}: ${errorMessage(error)}`,
	);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
