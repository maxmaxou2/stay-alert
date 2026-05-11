import { createContext, notifyUser } from "../core/index.ts";

type HookEvent = "on-stop" | "on-notification";

export async function runClaudeCodeHook(argv: string[]): Promise<void> {
	const [event, ...extraArgs] = argv;

	if (!isHookEvent(event) || extraArgs.length > 0) {
		throw new Error(
			"usage: stay-alert claude-code-hook <on-stop | on-notification>",
		);
	}

	try {
		const payload = await readPayload();

		if (payload === null) {
			return;
		}

		if (event === "on-stop") {
			await handleOnStop();
			return;
		}

		if (event === "on-notification") {
			await handleOnNotification(payload);
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

async function handleOnStop(): Promise<void> {
	const ctx = await createContext();
	await notifyUser(ctx, { title: "Claude Code", message: "Done" });
}

async function handleOnNotification(
	payload: Record<string, unknown>,
): Promise<void> {
	const rawMessage = payload.message;
	const message =
		typeof rawMessage === "string" && rawMessage.trim() !== ""
			? rawMessage.trim()
			: "Question";

	const ctx = await createContext();
	await notifyUser(ctx, { title: "Claude Code", message });
}

function isHookEvent(value: string | undefined): value is HookEvent {
	return value === "on-stop" || value === "on-notification";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
