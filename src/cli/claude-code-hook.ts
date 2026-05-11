import type { PredictionResult } from "../core/index.ts";
import {
	createContext,
	endTurn,
	notifyUser,
	startTurn,
} from "../core/index.ts";
import { formatDuration } from "./_format.ts";

type HookEvent =
	| "on-prompt"
	| "on-stop"
	| "on-notification"
	| "on-permission-request";

export async function runClaudeCodeHook(argv: string[]): Promise<void> {
	const [event, ...extraArgs] = argv;

	if (!isHookEvent(event) || extraArgs.length > 0) {
		throw new Error(
			"usage: stay-alert claude-code-hook <on-prompt | on-stop | on-notification | on-permission-request>",
		);
	}

	try {
		const payload = await readPayload();

		if (payload === null) {
			return;
		}

		if (event === "on-prompt") {
			await handleOnPrompt(payload);
			return;
		}

		if (event === "on-stop") {
			await handleOnStop(payload);
			return;
		}

		if (event === "on-notification") {
			await handleOnNotification(payload);
			return;
		}

		if (event === "on-permission-request") {
			await handleOnPermissionRequest(payload);
			return;
		}

		event satisfies never;
	} catch (error) {
		console.warn(`stay-alert: hook handler failed: ${errorMessage(error)}`);
	}
}

async function readPayload(): Promise<Record<string, unknown> | null> {
	const raw = await Bun.stdin.text();

	if (raw.trim() === "") {
		console.warn("stay-alert: empty hook payload");
		return null;
	}

	let payload: unknown;

	try {
		payload = JSON.parse(raw);
	} catch {
		console.warn("stay-alert: invalid JSON hook payload");
		return null;
	}

	if (!isRecord(payload)) {
		console.warn("stay-alert: hook payload must be an object");
		return null;
	}

	return payload;
}

async function handleOnPrompt(payload: Record<string, unknown>): Promise<void> {
	const sessionID = payload.session_id;
	const prompt = payload.prompt;

	if (typeof sessionID !== "string") {
		console.warn("stay-alert: hook payload missing string session_id");
		return;
	}

	if (typeof prompt !== "string") {
		console.warn("stay-alert: hook payload missing string prompt");
		return;
	}

	const ctx = await createContext();
	const prediction = await startTurn(ctx, {
		source: "claude-code",
		sessionID,
		promptText: prompt,
	});
	await notifyUser(ctx, {
		title: "Claude Code",
		message: startMessage(prediction),
	});
}

async function handleOnStop(payload: Record<string, unknown>): Promise<void> {
	const sessionID = payload.session_id;

	if (typeof sessionID !== "string") {
		console.warn("stay-alert: hook payload missing string session_id");
		return;
	}

	const ctx = await createContext();
	const turn = await endTurn(ctx, {
		source: "claude-code",
		sessionID,
		endReason: "idle",
	});

	if (turn === null) {
		return;
	}

	await notifyUser(ctx, {
		title: "Claude Code",
		message: `Done in ${formatDuration(turn.durationMs ?? 0)}`,
	});
}

async function handleOnNotification(
	payload: Record<string, unknown>,
): Promise<void> {
	const message = payload.message;
	const title = payload.title;

	if (typeof message !== "string") {
		console.warn("stay-alert: hook payload missing string message");
		return;
	}

	const ctx = await createContext();
	await notifyUser(ctx, {
		title: typeof title === "string" ? title : "Claude Code",
		message,
	});
}

async function handleOnPermissionRequest(
	payload: Record<string, unknown>,
): Promise<void> {
	const toolName = payload.tool_name;

	if (typeof toolName !== "string") {
		console.warn("stay-alert: hook payload missing string tool_name");
		return;
	}

	const ctx = await createContext();
	await notifyUser(ctx, {
		title: "Claude Code",
		message: `Permission required: ${toolName}`,
	});
}

function isHookEvent(value: string | undefined): value is HookEvent {
	return (
		value === "on-prompt" ||
		value === "on-stop" ||
		value === "on-notification" ||
		value === "on-permission-request"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function startMessage(prediction: PredictionResult): string {
	if (prediction.etaMs === null) return "Started";
	return `Started, ~${formatDuration(prediction.etaMs)} expected`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
