export type Source = "claude-code" | "opencode";
export type EndReason = "idle" | "permission" | "question";

export type Turn = {
	id: string;
	source: Source;
	sessionID: string;
	promptText: string;
	startedAt: number;
	endedAt: number | null;
	durationMs: number | null;
	endReason: EndReason | null;
	toolCalls: string[];
	model?: string;
};

export type InProgressTurn = {
	id: string;
	source: Source;
	sessionID: string;
	promptText: string;
	startedAt: number;
	model?: string;
};

export type PredictionResult = {
	etaMs: number | null;
	basis: string;
	confidence: "low" | "medium" | "high";
};

export type NotifyUrgency = "transient" | "sticky";

export type NotifyOptions = {
	title: string;
	message: string;
	sound?: string;
	urgency: NotifyUrgency;
};
