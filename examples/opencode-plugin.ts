import {
	createContext,
	endTurn,
	notifyUser,
	type PredictionResult,
	startTurn,
} from "stay-alert";

type OpencodeClient = {
	app: {
		log(input: {
			body: {
				service: string;
				level: "warn";
				message: string;
			};
		}): Promise<unknown>;
	};
	session: {
		get(input: {
			path: { id: string };
		}): Promise<{ data?: { parentID?: string } }>;
	};
};

type ChatMessageInput = {
	sessionID: string;
};

// Despite the `output` name, this is the user message being received,
// not an assistant response. `parts` are the user's message parts.
// See @opencode-ai/plugin Hooks["chat.message"].
type ChatMessageOutput = {
	message: { id: string };
	parts: unknown[];
};

type OpencodeEvent = { type: string; properties: unknown };

type PluginInput = {
	client: OpencodeClient;
	// Other fields (project, directory, worktree, $, ...) are available
	// but unused here; opencode passes the full input regardless.
};

type Plugin = (input: PluginInput) => Promise<{
	"chat.message": (
		input: ChatMessageInput,
		output: ChatMessageOutput,
	) => Promise<void>;
	event: (input: { event: OpencodeEvent }) => Promise<void>;
}>;

let ctxPromise: Promise<Awaited<ReturnType<typeof createContext>>> | null =
	null;

function ctx(): Promise<Awaited<ReturnType<typeof createContext>>> {
	ctxPromise ??= createContext();
	return ctxPromise;
}

export const StayAlertPlugin: Plugin = async ({ client }) => {
	const warn = async (message: string, error?: unknown): Promise<void> => {
		const fullMessage = `stay-alert: ${message}${error === undefined ? "" : `: ${errorMessage(error)}`}`;

		try {
			await client.app.log({
				body: {
					service: "stay-alert",
					level: "warn",
					message: fullMessage,
				},
			});
		} catch {
			console.warn(fullMessage);
		}
	};

	return {
		"chat.message": async (input, output) => {
			try {
				if (await isSubagentSession(client, input.sessionID, warn)) {
					return;
				}

				const promptText = output.parts
					.filter(isTextPart)
					.map((part) => part.text)
					.join("\n\n");

				const context = await ctx();
				const prediction = await startTurn(context, {
					source: "opencode",
					sessionID: input.sessionID,
					promptText,
				});
				await notifyUser(context, {
					title: "opencode",
					message: startMessage(prediction),
				});
			} catch (error) {
				await warn("prompt handler failed", error);
			}
		},

		event: async ({ event }) => {
			try {
				if (isSessionIdleEvent(event)) {
					if (
						await isSubagentSession(client, event.properties.sessionID, warn)
					) {
						return;
					}

					const context = await ctx();
					const turn = await endTurn(context, {
						source: "opencode",
						sessionID: event.properties.sessionID,
						endReason: "idle",
					});

					if (turn === null) {
						return;
					}

					await notifyUser(context, {
						title: "opencode",
						message: `Done in ${formatDuration(turn.durationMs ?? 0)}`,
					});
					return;
				}

				if (isPermissionUpdatedEvent(event)) {
					await notifyUser(await ctx(), {
						title: "opencode",
						message: permissionMessage(event),
					});
					return;
				}

				if (isQuestionAskedEvent(event)) {
					if (
						await isSubagentSession(client, event.properties.sessionID, warn)
					) {
						return;
					}

					await notifyUser(await ctx(), {
						title: "opencode",
						message: questionMessage(event),
					});
					return;
				}

				if (isToastEvent(event)) {
					await notifyUser(await ctx(), {
						title: event.properties.title ?? "opencode",
						message: event.properties.message,
					});
				}
			} catch (error) {
				await warn("event handler failed", error);
			}
		},
	};
};

async function isSubagentSession(
	client: OpencodeClient,
	sessionID: string,
	warn: (message: string, error?: unknown) => Promise<void>,
): Promise<boolean> {
	try {
		const session = await client.session.get({ path: { id: sessionID } });
		return session.data?.parentID != null;
	} catch (error) {
		await warn("failed to inspect opencode session", error);
		return false;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1_000) {
		return `${Math.round(ms)}ms`;
	}

	const seconds = Math.round(ms / 1_000);

	if (seconds < 60) {
		return `${seconds}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return `${minutes}m ${remainingSeconds}s`;
}

function startMessage(prediction: PredictionResult): string {
	if (prediction.etaMs === null) return "Started";
	return `Started, ~${formatDuration(prediction.etaMs)} expected`;
}

function isTextPart(value: unknown): value is { type: "text"; text: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "text" &&
		"text" in value &&
		typeof value.text === "string"
	);
}

function isSessionIdleEvent(
	event: OpencodeEvent,
): event is { type: "session.idle"; properties: { sessionID: string } } {
	return (
		event.type === "session.idle" &&
		typeof event.properties === "object" &&
		event.properties !== null &&
		"sessionID" in event.properties &&
		typeof event.properties.sessionID === "string"
	);
}

function isToastEvent(event: OpencodeEvent): event is {
	type: "tui.toast.show";
	properties: { title?: string; message: string };
} {
	return (
		event.type === "tui.toast.show" &&
		typeof event.properties === "object" &&
		event.properties !== null &&
		(!("title" in event.properties) ||
			typeof event.properties.title === "string") &&
		"message" in event.properties &&
		typeof event.properties.message === "string"
	);
}

function isPermissionUpdatedEvent(event: OpencodeEvent): event is {
	type: "permission.updated";
	properties: { title?: unknown };
} {
	return (
		event.type === "permission.updated" &&
		typeof event.properties === "object" &&
		event.properties !== null
	);
}

function isQuestionAskedEvent(event: OpencodeEvent): event is {
	type: "question.asked";
	properties: {
		sessionID: string;
		questions: Array<{ header?: unknown; question?: unknown }>;
	};
} {
	return (
		event.type === "question.asked" &&
		typeof event.properties === "object" &&
		event.properties !== null &&
		"sessionID" in event.properties &&
		typeof event.properties.sessionID === "string" &&
		"questions" in event.properties &&
		Array.isArray(event.properties.questions)
	);
}

function permissionMessage(event: { properties: { title?: unknown } }): string {
	if (
		typeof event.properties.title === "string" &&
		event.properties.title.trim() !== ""
	) {
		return event.properties.title;
	}

	return "Permission required";
}

function questionMessage(event: {
	properties: { questions: Array<{ header?: unknown; question?: unknown }> };
}): string {
	const question = event.properties.questions[0];

	if (question === undefined) {
		return "Question waiting";
	}

	if (typeof question.header === "string" && question.header.trim() !== "") {
		return question.header;
	}

	if (
		typeof question.question === "string" &&
		question.question.trim() !== ""
	) {
		return question.question;
	}

	return "Question waiting";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
