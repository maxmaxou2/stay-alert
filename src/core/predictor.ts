import type { Config } from "./config.ts";
import { readTurns } from "./history.ts";
import type { Paths } from "./paths.ts";
import type { PredictionResult, Source, Turn } from "./types.ts";

export type PredictInput = {
	promptText: string;
	source: Source;
};

export interface Predictor {
	readonly name: string;
	predict(input: PredictInput): Promise<PredictionResult>;
}

export function createMedianPredictor(paths: Paths, config: Config): Predictor {
	return {
		name: "median",
		async predict(input) {
			const turns = await readTurns(paths);
			const recentTurns = turns
				.filter((turn) => isCompletedTurnFromSource(turn, input.source))
				.slice(-config.predictor.sampleSize);

			if (recentTurns.length === 0) {
				return {
					etaMs: null,
					basis: "no history yet",
					confidence: "low",
				};
			}

			return {
				etaMs: median(recentTurns.map((turn) => turn.durationMs)),
				basis: `median of ${recentTurns.length} recent ${input.source} turns`,
				confidence:
					recentTurns.length >= config.predictor.sampleSize ? "medium" : "low",
			};
		},
	};
}

export function withTimeout(p: Predictor, timeoutMs: number): Predictor {
	let warnedAboutError = false;

	return {
		name: `${p.name}+timeout`,
		async predict(input) {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<PredictionResult>((resolve) => {
				timeoutId = setTimeout(() => {
					resolve({
						etaMs: null,
						basis: "predictor timed out",
						confidence: "low",
					});
				}, timeoutMs);
			});
			const prediction = Promise.resolve()
				.then(() => p.predict(input))
				.catch((error) => {
					if (!warnedAboutError) {
						console.warn(`stay-alert: predictor error: ${errorMessage(error)}`);
						warnedAboutError = true;
					}

					return {
						etaMs: null,
						basis: "predictor error",
						confidence: "low",
					} satisfies PredictionResult;
				});

			try {
				return await Promise.race([prediction, timeout]);
			} finally {
				if (timeoutId !== undefined) {
					clearTimeout(timeoutId);
				}
			}
		},
	};
}

function isCompletedTurnFromSource(
	turn: Turn,
	source: Source,
): turn is Turn & { endedAt: number; durationMs: number } {
	return (
		turn.endedAt !== null && turn.durationMs !== null && turn.source === source
	);
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const midpoint = Math.floor(sorted.length / 2);

	if (sorted.length % 2 === 1) {
		return sorted[midpoint];
	}

	return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
