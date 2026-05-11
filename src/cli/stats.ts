import { createContext, readTurns, type Source } from "../core/index.ts";
import { formatDuration } from "./_format.ts";

type StatsOptions = {
	last?: number;
	source?: Source;
};

const sources: Source[] = ["claude-code", "opencode"];
const endReasons = ["idle", "permission", "question"] as const;

export async function runStats(argv: string[]): Promise<void> {
	const opts = parseArgs(argv);
	const ctx = await createContext();
	const turns = await readTurns(ctx.paths);
	let completedTurns = turns.filter(
		(turn) => turn.endedAt !== null && turn.durationMs !== null,
	);

	if (opts.source !== undefined) {
		completedTurns = completedTurns.filter(
			(turn) => turn.source === opts.source,
		);
	}

	if (opts.last !== undefined) {
		completedTurns = completedTurns.slice(-opts.last);
	}

	if (completedTurns.length === 0) {
		console.log("No turns recorded yet.");
		return;
	}

	const durations = completedTurns
		.map((turn) => turn.durationMs)
		.filter((duration): duration is number => duration !== null)
		.sort((a, b) => a - b);
	const sourceCounts = sources
		.map((source) => ({
			source,
			count: completedTurns.filter((turn) => turn.source === source).length,
		}))
		.filter(({ count }) => count > 0)
		.map(({ source, count }) => `${source} ${count}`)
		.join(", ");
	const endReasonCounts = endReasons
		.map((reason) => ({
			reason,
			count: completedTurns.filter((turn) => turn.endReason === reason).length,
		}))
		.filter(({ count }) => count > 0)
		.map(({ reason, count }) => `${reason} ${count}`)
		.join(", ");

	console.log("stay-alert stats");
	console.log(`${label("turns:")}${completedTurns.length}`);
	if (sourceCounts) {
		console.log(`${label("by source:")}${sourceCounts}`);
	}
	console.log(`${label("median:")}${formatDuration(median(durations))}`);
	console.log(`${label("p95:")}${formatDuration(p95(durations))}`);
	console.log(
		`${label("min / max:")}${formatDuration(durations[0] ?? 0)} / ${formatDuration(durations.at(-1) ?? 0)}`,
	);
	if (endReasonCounts) {
		console.log(`${label("end reasons:")}${endReasonCounts}`);
	}
}

function parseArgs(argv: string[]): StatsOptions {
	const opts: StatsOptions = {};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];

		if (arg === "--last") {
			const value = argv[index + 1];

			if (value === undefined || value.startsWith("--")) {
				throw new Error("--last requires a positive integer");
			}

			const parsed = Number(value);

			if (!Number.isInteger(parsed) || parsed <= 0) {
				throw new Error("--last requires a positive integer");
			}

			opts.last = parsed;
			index += 1;
			continue;
		}

		if (arg === "--source") {
			const value = argv[index + 1];

			if (value === undefined || value.startsWith("--")) {
				throw new Error("--source requires one of: claude-code, opencode");
			}

			if (!isSource(value)) {
				throw new Error(
					`unknown source: ${value} (expected one of: claude-code, opencode)`,
				);
			}

			opts.source = value;
			index += 1;
			continue;
		}

		throw new Error(`unknown flag: ${arg}`);
	}

	return opts;
}

function isSource(value: string): value is Source {
	return sources.includes(value as Source);
}

function label(value: string): string {
	return `  ${value.padEnd(14)}`;
}

function median(values: number[]): number {
	const middle = Math.floor(values.length / 2);

	if (values.length % 2 === 1) {
		return values[middle] ?? 0;
	}

	return ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function p95(values: number[]): number {
	return values[Math.ceil(0.95 * values.length) - 1] ?? 0;
}
