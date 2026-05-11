export type Source = "claude-code" | "opencode";

export type NotifyUrgency = "transient" | "sticky";

export type NotifyOptions = {
	title: string;
	message: string;
	sound?: string;
	urgency: NotifyUrgency;
};
