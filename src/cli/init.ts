import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type InitOptions = {
	claudeCode: boolean;
	opencode: boolean;
};

type JsonObject = Record<string, unknown>;

type HookEvent = "UserPromptSubmit" | "Stop" | "Notification";

type HookSpec = {
	event: HookEvent;
	command: string;
};

const hookSpecs: HookSpec[] = [
	{
		event: "UserPromptSubmit",
		command: "stay-alert claude-code-hook on-prompt",
	},
	{
		event: "Stop",
		command: "stay-alert claude-code-hook on-stop",
	},
	{
		event: "Notification",
		command: "stay-alert claude-code-hook on-notification",
	},
];

export async function runInit(argv: string[]): Promise<void> {
	const options = parseArgs(argv);

	if (options.claudeCode) {
		await installClaudeCodeHooks();
	}

	if (options.opencode) {
		await printOpencodeSetup();
	}
}

function parseArgs(argv: string[]): InitOptions {
	let claudeCode = false;
	let opencode = false;

	for (const arg of argv) {
		if (arg === "--claude-code") {
			claudeCode = true;
			continue;
		}

		if (arg === "--opencode") {
			opencode = true;
			continue;
		}

		throw new Error(`unknown flag: ${arg}`);
	}

	if (!claudeCode && !opencode) {
		return { claudeCode: true, opencode: true };
	}

	return { claudeCode, opencode };
}

async function installClaudeCodeHooks(): Promise<void> {
	const settingsFile = resolveClaudeCodeSettingsFile();
	const backupFile = `${settingsFile}.stay-alert.bak`;
	const settings = await readSettings(settingsFile);
	const changed = mergeHooks(settings);
	let backupCreated = false;

	if (changed) {
		backupCreated = await createBackupIfNeeded(settingsFile, backupFile);
		await writeJsonAtomically(settingsFile, settings);
	}

	console.log(`✓ Updated Claude Code settings: ${settingsFile}`);
	if (backupCreated) {
		console.log(`  Backup: ${backupFile}`);
	}
	console.log("  Configured hooks: UserPromptSubmit, Stop, Notification");
	console.log("  Restart Claude Code for changes to take effect.");
}

function resolveClaudeCodeSettingsFile(): string {
	const home = process.env.HOME;

	if (!home) {
		throw new Error("HOME must be set to resolve Claude Code settings path");
	}

	return join(home, ".claude", "settings.json");
}

async function readSettings(settingsFile: string): Promise<JsonObject> {
	let contents: string;

	try {
		contents = await readFile(settingsFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return {};
		}

		throw error;
	}

	try {
		const parsed = JSON.parse(contents) as unknown;

		if (!isJsonObject(parsed)) {
			throw new Error("expected a JSON object");
		}

		return parsed;
	} catch (error) {
		throw new Error(
			`failed to parse Claude Code settings at ${settingsFile}: ${errorMessage(error)}`,
		);
	}
}

async function createBackupIfNeeded(
	settingsFile: string,
	backupFile: string,
): Promise<boolean> {
	try {
		await copyFile(settingsFile, backupFile, 1);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return false;
		}

		if (isNodeError(error) && error.code === "EEXIST") {
			return false;
		}

		throw error;
	}
}

function mergeHooks(settings: JsonObject): boolean {
	let changed = false;

	if (settings.hooks === undefined) {
		settings.hooks = {};
		changed = true;
	}

	if (!isJsonObject(settings.hooks)) {
		throw new Error("Claude Code settings hooks field must be a JSON object");
	}

	const hooks = settings.hooks;

	for (const spec of hookSpecs) {
		if (hooks[spec.event] === undefined) {
			hooks[spec.event] = [];
			changed = true;
		}

		if (!Array.isArray(hooks[spec.event])) {
			throw new Error(
				`Claude Code settings hooks.${spec.event} field must be an array`,
			);
		}

		const eventHooks = hooks[spec.event] as unknown[];

		if (hasCommandHook(eventHooks, spec.command)) {
			continue;
		}

		eventHooks.push({
			hooks: [{ type: "command", command: spec.command }],
		});
		changed = true;
	}

	return changed;
}

function hasCommandHook(eventHooks: unknown[], command: string): boolean {
	return eventHooks.some((group) => {
		if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
			return false;
		}

		return group.hooks.some(
			(handler) =>
				isJsonObject(handler) &&
				handler.type === "command" &&
				handler.command === command,
		);
	});
}

async function writeJsonAtomically(
	settingsFile: string,
	settings: JsonObject,
): Promise<void> {
	await mkdir(dirname(settingsFile), { recursive: true });

	const temporaryFile = `${settingsFile}.tmp.${process.pid}.${randomUUID()}`;

	try {
		await writeFile(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`);
		await rename(temporaryFile, settingsFile);
	} catch (error) {
		await Bun.file(temporaryFile)
			.delete()
			.catch(() => {});
		throw error;
	}
}

async function printOpencodeSetup(): Promise<void> {
	const pluginPath = join(
		import.meta.dir,
		"..",
		"..",
		"examples",
		"opencode-plugin.ts",
	);
	const pluginContents = await Bun.file(pluginPath).text();

	console.log(`opencode setup:

1. Locate your opencode config dir (usually ~/.config/opencode).
2. Create a plugin file at <config-dir>/plugin/stay-alert.ts with the
   contents shown below.
3. Restart opencode.

────────── plugin/stay-alert.ts ──────────
${pluginContents.trimEnd()}
──────────────────────────────────────────`);
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
