import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	readFile,
	readlink,
	realpath,
	rename,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

type InitOptions = {
	claudeCode: boolean;
	opencode: boolean;
};

type JsonObject = Record<string, unknown>;

type HookEvent =
	| "UserPromptSubmit"
	| "Stop"
	| "Notification"
	| "PermissionRequest";

type HookSpec = {
	event: HookEvent;
	matcher?: string;
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
	{
		event: "PermissionRequest",
		matcher: "*",
		command: "stay-alert claude-code-hook on-permission-request",
	},
];

export async function runInit(argv: string[]): Promise<void> {
	const options = parseArgs(argv);

	if (options.claudeCode) {
		await installClaudeCodeHooks();
	}

	if (options.opencode) {
		await installOpencodePlugin();
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
	const resolvedSettingsFile = await resolveSymlink(settingsFile);
	const backupFile = `${resolvedSettingsFile}.stay-alert.bak`;
	const settings = await readSettings(resolvedSettingsFile);
	const changed = mergeHooks(settings);
	let backupCreated = false;

	if (changed) {
		backupCreated = await createBackupIfNeeded(
			resolvedSettingsFile,
			backupFile,
		);
		await writeJsonAtomically(resolvedSettingsFile, settings);
	}

	console.log(
		`Claude Code: ${changed ? "hooks installed" : "hooks already up to date"} (${resolvedSettingsFile})`,
	);
	if (backupCreated) {
		console.log(`             backup: ${backupFile}`);
	}
}

function resolveClaudeCodeSettingsFile(): string {
	return join(homedir(), ".claude", "settings.json");
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
			...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
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

async function installOpencodePlugin(): Promise<void> {
	const targetFile = resolveOpencodePluginFile();
	const resolvedFile = await resolveSymlink(targetFile);
	const backupFile = `${resolvedFile}.bak`;
	const pluginContents = await readOpencodePluginSource();
	const currentContents = await readOptionalFile(resolvedFile);

	if (currentContents === null) {
		await writeTextAtomically(resolvedFile, pluginContents);
		console.log(`opencode:    plugin installed at ${resolvedFile}`);
		return;
	}

	if (currentContents === pluginContents) {
		console.log(`opencode:    plugin already up to date (${resolvedFile})`);
		return;
	}

	await createExclusiveBackup(resolvedFile, backupFile);
	await writeTextAtomically(resolvedFile, pluginContents);
	console.log(`opencode:    plugin updated at ${resolvedFile}`);
	console.log(`             backup: ${backupFile}`);
}

function resolveOpencodePluginFile(): string {
	return join(homedir(), ".config", "opencode", "plugins", "stay-alert.ts");
}

async function readOpencodePluginSource(): Promise<string> {
	const pluginPath = join(
		import.meta.dir,
		"..",
		"..",
		"examples",
		"opencode-plugin.ts",
	);

	return Bun.file(pluginPath).text();
}

async function readOptionalFile(file: string): Promise<string | null> {
	try {
		return await readFile(file, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return null;
		}

		throw error;
	}
}

async function createExclusiveBackup(
	sourceFile: string,
	backupFile: string,
): Promise<void> {
	try {
		await copyFile(sourceFile, backupFile, constants.COPYFILE_EXCL);
	} catch (error) {
		if (isNodeError(error) && error.code === "EEXIST") {
			throw new Error(
				`opencode plugin backup already exists at ${backupFile}; delete it before re-running stay-alert init`,
			);
		}

		throw new Error(
			`failed to back up opencode plugin from ${sourceFile} to ${backupFile}: ${errorMessage(error)}`,
			{ cause: error },
		);
	}
}

async function writeTextAtomically(
	file: string,
	contents: string,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });

	const temporaryFile = `${file}.tmp.${process.pid}.${randomUUID()}`;

	try {
		await writeFile(temporaryFile, contents);
		await rename(temporaryFile, file);
	} catch (error) {
		await Bun.file(temporaryFile)
			.delete()
			.catch(() => {});
		throw error;
	}
}

async function resolveSymlink(file: string): Promise<string> {
	let stats: Awaited<ReturnType<typeof lstat>>;

	try {
		stats = await lstat(file);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return file;
		}

		throw error;
	}

	if (!stats.isSymbolicLink()) {
		return file;
	}

	try {
		return await realpath(file);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			const target = await readlink(file);
			return isAbsolute(target) ? target : resolve(dirname(file), target);
		}

		throw error;
	}
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
