import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryHomes: string[] = [];

afterEach(async () => {
	for (const home of temporaryHomes.splice(0)) {
		await rm(home, { force: true, recursive: true });
	}
});

test("Claude Code prompt hook notifies with prediction on turn start", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-prediction-"));
	temporaryHomes.push(home);

	await installAlerterCapture(home);
	await seedHistory(home, 4_500);
	const notification = await runClaudeCodePromptHook(home);

	expect(notification.message).toBe("Started, ~5s expected");
	expect(notification.title).toBe("Claude Code");
});

test("Claude Code prompt hook notifies started when prediction has no ETA", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-prediction-"));
	temporaryHomes.push(home);

	await installAlerterCapture(home);
	const notification = await runClaudeCodePromptHook(home);

	expect(notification.message).toBe("Started");
	expect(notification.title).toBe("Claude Code");
});

async function installAlerterCapture(home: string): Promise<void> {
	const alerterPath = join(home, "alerter");
	const notificationFile = join(home, "notification.json");

	await Bun.write(
		alerterPath,
		`#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";

const title = process.argv[process.argv.indexOf("--title") + 1];
const message = process.argv[process.argv.indexOf("--message") + 1];
await writeFile(${JSON.stringify(notificationFile)}, JSON.stringify({ title, message }));
`,
	);
	await chmod(alerterPath, 0o755);
}

async function seedHistory(home: string, durationMs: number): Promise<void> {
	await mkdir(join(home, "data"), { recursive: true });
	const start = Date.now() - durationMs;
	const turn = {
		id: "history-turn",
		source: "claude-code",
		sessionID: "history-session",
		promptText: "previous prompt",
		startedAt: start,
		endedAt: start + durationMs,
		durationMs,
		endReason: "idle",
		toolCalls: [],
	};
	await Bun.write(
		join(home, "data", "history.jsonl"),
		`${JSON.stringify(turn)}\n`,
	);
}

async function runClaudeCodePromptHook(
	home: string,
): Promise<{ title: string; message: string }> {
	const notificationFile = join(home, "notification.json");
	const proc = Bun.spawn(
		[
			process.execPath,
			"run",
			"src/cli/index.ts",
			"claude-code-hook",
			"on-prompt",
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				PATH: `${home}:${process.env.PATH ?? ""}`,
				STAY_ALERT_HOME: home,
			},
			stderr: "pipe",
			stdin: "pipe",
			stdout: "pipe",
		},
	);

	proc.stdin.write(
		JSON.stringify({ session_id: "session-1", prompt: "new prompt" }),
	);
	proc.stdin.end();

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	if (exitCode !== 0) {
		throw new Error(
			`hook failed with exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}

	try {
		return JSON.parse(await readEventually(notificationFile)) as {
			title: string;
			message: string;
		};
	} catch (error) {
		throw new Error(
			`failed to read notification\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			{ cause: error },
		);
	}
}

async function readEventually(file: string): Promise<string> {
	let lastError: unknown;

	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			return await readFile(file, "utf8");
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	throw lastError;
}
