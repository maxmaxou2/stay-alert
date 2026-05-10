import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { ensureDir, type Paths } from "./paths.ts";
import type { InProgressTurn } from "./types.ts";

export async function readState(
	paths: Paths,
): Promise<Record<string, InProgressTurn>> {
	let contents: string;

	try {
		contents = await readFile(paths.stateFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return {};
		}

		throw error;
	}

	if (contents === "") {
		return {};
	}

	try {
		return JSON.parse(contents) as Record<string, InProgressTurn>;
	} catch (error) {
		console.warn(
			`stay-alert: skipping malformed state file ${paths.stateFile}: ${errorMessage(error)}`,
		);
		return {};
	}
}

export async function putInProgress(
	paths: Paths,
	turn: InProgressTurn,
): Promise<void> {
	await ensureDir(paths.dataDir);

	const state = await readState(paths);
	state[turn.sessionID] = turn;
	// Concurrent updates are last-write-wins; acceptable per sessionID use case.
	await writeStateAtomically(paths, state);
}

export async function takeInProgress(
	paths: Paths,
	sessionID: string,
): Promise<InProgressTurn | null> {
	await ensureDir(paths.dataDir);

	const state = await readState(paths);
	const turn = state[sessionID] ?? null;

	if (turn === null) {
		return null;
	}

	delete state[sessionID];

	// Concurrent updates are last-write-wins; acceptable per sessionID use case.
	await writeStateAtomically(paths, state);

	return turn;
}

async function writeStateAtomically(
	paths: Paths,
	state: Record<string, InProgressTurn>,
): Promise<void> {
	const temporaryFile = `${paths.stateFile}.tmp.${process.pid}.${randomUUID()}`;

	try {
		await writeFile(temporaryFile, JSON.stringify(state));
		await rename(temporaryFile, paths.stateFile);
	} catch (error) {
		await unlink(temporaryFile).catch(() => {});
		throw error;
	}
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
