import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import { isTerminalFocused } from "./focus.ts";
import { appendTurn, newTurnId } from "./history.ts";
import { notify } from "./notify/index.ts";
import type { Paths } from "./paths.ts";
import { resolvePaths } from "./paths.ts";
import type { Predictor } from "./predictor.ts";
import { createMedianPredictor, withTimeout } from "./predictor.ts";
import { putInProgress, takeInProgress } from "./state.ts";
import type {
	EndReason,
	InProgressTurn,
	NotifyUrgency,
	PredictionResult,
	Source,
	Turn,
} from "./types.ts";

export type { Config } from "./config.ts";
export { DEFAULT_CONFIG, loadConfig } from "./config.ts";
export { readTurns } from "./history.ts";
export type { Notifier } from "./notify/types.ts";
export type { Paths } from "./paths.ts";
export { resolvePaths } from "./paths.ts";
export type { PredictInput, Predictor } from "./predictor.ts";
export type {
	EndReason,
	InProgressTurn,
	NotifyOptions,
	NotifyUrgency,
	PredictionResult,
	Source,
	Turn,
} from "./types.ts";

export type StartTurnInput = {
	source: Source;
	sessionID: string;
	promptText: string;
	model?: string;
};

export type EndTurnInput = {
	source: Source;
	sessionID: string;
	endReason: EndReason;
	toolCalls?: string[];
};

export type Context = {
	paths: Paths;
	config: Config;
	predictor: Predictor;
};

export async function createContext(
	env: NodeJS.ProcessEnv = process.env,
): Promise<Context> {
	const paths = resolvePaths(env);
	const config = await loadConfig(paths);
	const predictor = withTimeout(
		createMedianPredictor(paths, config),
		config.predictor.timeoutMs,
	);

	return { paths, config, predictor };
}

export async function startTurn(
	ctx: Context,
	input: StartTurnInput,
): Promise<PredictionResult> {
	const promptText = [...input.promptText].slice(0, 500).join("");
	const turn: InProgressTurn = {
		id: newTurnId(),
		source: input.source,
		sessionID: input.sessionID,
		promptText,
		startedAt: Date.now(),
		...(input.model === undefined ? {} : { model: input.model }),
	};

	await putInProgress(ctx.paths, turn);

	return ctx.predictor.predict({ promptText, source: input.source });
}

export async function endTurn(
	ctx: Context,
	input: EndTurnInput,
): Promise<Turn | null> {
	const inProgress = await takeInProgress(ctx.paths, input.sessionID);

	if (inProgress === null) {
		console.warn(
			`stay-alert: no in-progress turn for ${input.source} session ${input.sessionID}`,
		);
		return null;
	}

	const endedAt = Date.now();
	const turn: Turn = {
		...inProgress,
		endedAt,
		durationMs: endedAt - inProgress.startedAt,
		endReason: input.endReason,
		toolCalls: input.toolCalls ?? [],
	};

	await appendTurn(ctx.paths, turn);

	return turn;
}

export async function notifyUser(
	ctx: Context,
	opts: { title: string; message: string },
): Promise<void> {
	const focus = await isTerminalFocused(ctx.config);
	const urgency: NotifyUrgency =
		focus.appName === null || focus.focused === false ? "sticky" : "transient";
	const sound =
		urgency === "transient"
			? (ctx.config.notifications.transientSound ?? undefined)
			: ctx.config.notifications.stickySound;

	await notify({ title: opts.title, message: opts.message, sound, urgency });
}
