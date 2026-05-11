import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createContext, type Turn } from "../core/index.ts";
import { formatDuration } from "./_format.ts";

export async function runTail(): Promise<void> {
	const ctx = await createContext();
	const historyFile = ctx.paths.historyFile;

	console.log(`Tailing ${historyFile}. Ctrl-C to stop.`);
	process.on("SIGINT", () => {
		console.log();
		process.exit(0);
	});

	let size = await fileSize(historyFile);
	const waitedForFile = size === null;

	if (waitedForFile) {
		console.log("(no history file yet — waiting for first turn…)");
		await waitForFile(historyFile);
		size = 0;
	}

	let offset = waitedForFile ? 0 : (size ?? 0);
	let pending = "";
	let reading = false;
	let watcher: FSWatcher;

	const readAppends = async (): Promise<void> => {
		if (reading) {
			return;
		}

		reading = true;

		try {
			const nextSize = await fileSize(historyFile);

			if (nextSize === null || nextSize <= offset) {
				return;
			}

			const chunk = await readRange(historyFile, offset, nextSize);
			offset = nextSize;
			pending += chunk;

			const lines = pending.split("\n");
			pending = lines.pop() ?? "";

			for (const line of lines) {
				printLine(line);
			}
		} finally {
			reading = false;
			const currentSize = await fileSize(historyFile);
			if (currentSize !== null && currentSize > offset) {
				void readAppends();
			}
		}
	};

	if (waitedForFile) {
		await readAppends();
	}

	watcher = watch(historyFile, { persistent: true }, (eventType) => {
		if (eventType === "change") {
			void readAppends();
		}
	});

	await new Promise<void>((resolve, reject) => {
		watcher.on("close", resolve);
		watcher.on("error", reject);
	});
}

async function waitForFile(path: string): Promise<void> {
	while ((await fileSize(path)) === null) {
		await Bun.sleep(1_000);
	}
}

async function fileSize(path: string): Promise<number | null> {
	try {
		return (await stat(path)).size;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

async function readRange(
	path: string,
	start: number,
	endExclusive: number,
): Promise<string> {
	const length = endExclusive - start;
	const buffer = Buffer.alloc(length);
	const file = await open(path, "r");

	try {
		const { bytesRead } = await file.read(buffer, 0, length, start);
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await file.close();
	}
}

function printLine(line: string): void {
	if (line === "") {
		return;
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(line);
	} catch {
		return;
	}

	if (!isTurn(parsed)) {
		return;
	}

	const duration =
		parsed.durationMs === null ? "unknown" : formatDuration(parsed.durationMs);
	const reason = parsed.endReason ?? "unknown";
	const prompt = truncatePrompt(parsed.promptText);

	console.log(
		`${new Date(parsed.startedAt).toISOString()}  [${parsed.source}]  ${duration}  reason=${reason}  prompt="${prompt}"`,
	);
}

function isTurn(value: unknown): value is Turn {
	return (
		typeof value === "object" &&
		value !== null &&
		"source" in value &&
		"startedAt" in value &&
		"promptText" in value &&
		typeof value.source === "string" &&
		typeof value.startedAt === "number" &&
		typeof value.promptText === "string" &&
		("durationMs" in value
			? typeof value.durationMs === "number" || value.durationMs === null
			: true) &&
		("endReason" in value
			? typeof value.endReason === "string" || value.endReason === null
			: true)
	);
}

function truncatePrompt(prompt: string): string {
	const chars = [...prompt];
	if (chars.length <= 60) {
		return prompt;
	}

	return `${chars.slice(0, 60).join("")}…`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
