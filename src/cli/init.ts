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
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { resolvePaths } from "../core/paths.ts";

type InitOptions = {
	claudeCode: boolean;
	opencode: boolean;
	shell: boolean;
	shellRc: string | null;
};

const SHELL_BLOCK_BEGIN = "# stay-alert begin (managed — do not edit)";
const SHELL_BLOCK_END = "# stay-alert end";

const SHELL_BLOCK_BODY = `if [[ -n \${ZSH_VERSION-} ]] && command -v stay-alert >/dev/null 2>&1; then
  zmodload zsh/datetime 2>/dev/null
  typeset -g __stay_alert_start=0
  typeset -g __stay_alert_cmd=""
  __stay_alert_preexec() {
    __stay_alert_start=$EPOCHREALTIME
    __stay_alert_cmd=$1
  }
  __stay_alert_precmd() {
    local ec=$?
    [[ -z $__stay_alert_cmd ]] && return
    local dur_ms=$(( (EPOCHREALTIME - __stay_alert_start) * 1000 ))
    stay-alert notify-command --cmd "$__stay_alert_cmd" --exit $ec --duration-ms \${dur_ms%.*} >/dev/null 2>&1 &!
    __stay_alert_cmd=""
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec __stay_alert_preexec
  add-zsh-hook precmd __stay_alert_precmd
fi`;

function buildShellBlock(): string {
	return `${SHELL_BLOCK_BEGIN}\n${SHELL_BLOCK_BODY}\n${SHELL_BLOCK_END}\n`;
}

type JsonObject = Record<string, unknown>;

type HookEvent = "Stop" | "Notification";

type HookSpec = {
	event: HookEvent;
	matcher?: string;
	command: string;
};

const hookSpecs: HookSpec[] = [
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
		await installOpencodePlugin();
	}

	if (options.shell) {
		await installShellHook(options.shellRc ?? defaultShellRc());
	}

	if (options.claudeCode || options.opencode) {
		await buildFrontmostHelper();
		await buildNotifierBundle();
	}
}

async function buildNotifierBundle(): Promise<void> {
	if (process.platform !== "darwin") {
		return;
	}

	const { notifierApp, notifierBin } = resolvePaths();
	const swiftSource = join(
		import.meta.dir,
		"..",
		"..",
		"src",
		"native",
		"notifier.swift",
	);
	const plistSource = join(
		import.meta.dir,
		"..",
		"..",
		"src",
		"native",
		"notifier.plist",
	);

	try {
		await stat(swiftSource);
		await stat(plistSource);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(
				`notifier:    missing source files; skipped (${swiftSource})`,
			);
			return;
		}
		throw error;
	}

	const macOSDir = dirname(notifierBin);
	const infoPlist = join(notifierApp, "Contents", "Info.plist");
	await mkdir(macOSDir, { recursive: true });

	let swiftcExit: number;
	let swiftcStderr: string;
	try {
		const proc = Bun.spawn(["swiftc", "-O", "-o", notifierBin, swiftSource], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		swiftcStderr = await new Response(proc.stderr).text();
		swiftcExit = await proc.exited;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(
				"notifier:    swiftc not found; install Xcode Command Line Tools to enable the notifier",
			);
			return;
		}
		throw error;
	}

	if (swiftcExit !== 0) {
		console.warn(
			`notifier:    failed to compile (exit ${swiftcExit}); banners will not work`,
		);
		if (swiftcStderr.trim().length > 0) {
			console.warn(`             ${swiftcStderr.trim()}`);
		}
		return;
	}

	await copyFile(plistSource, infoPlist);

	const resourcesDir = join(notifierApp, "Contents", "Resources");
	await mkdir(resourcesDir, { recursive: true });
	const assetsRoot = join(import.meta.dir, "..", "..", "assets");
	const targetIcns = join(resourcesDir, "AppIcon.icns");
	const icnsSource = join(assetsRoot, "notifier.icns");
	const pngSource = join(assetsRoot, "notifier.png");

	if (await fileExists(icnsSource)) {
		await copyFile(icnsSource, targetIcns);
	} else if (await fileExists(pngSource)) {
		const converted = await convertPngToIcns(pngSource, targetIcns);
		if (!converted) {
			console.warn(
				"notifier:    could not convert assets/notifier.png to .icns; bundle uses generic icon",
			);
		}
	}

	let codesignExit: number;
	let codesignStderr: string;
	try {
		const proc = Bun.spawn(
			["codesign", "--sign", "-", "--force", notifierApp],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		codesignStderr = await new Response(proc.stderr).text();
		codesignExit = await proc.exited;
	} catch (error) {
		console.warn(
			`notifier:    codesign failed: ${errorMessage(error)}; banners may not appear`,
		);
		return;
	}

	if (codesignExit !== 0) {
		console.warn(
			`notifier:    codesign failed (exit ${codesignExit}); banners may not appear`,
		);
		if (codesignStderr.trim().length > 0) {
			console.warn(`             ${codesignStderr.trim()}`);
		}
		return;
	}

	console.log(`notifier:    bundle built at ${notifierApp}`);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function convertPngToIcns(
	pngPath: string,
	icnsPath: string,
): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			["sips", "-s", "format", "icns", pngPath, "--out", icnsPath],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		return false;
	}
}

async function buildFrontmostHelper(): Promise<void> {
	if (process.platform !== "darwin") {
		return;
	}

	const target = resolvePaths().bundleIdBin;
	const source = join(
		import.meta.dir,
		"..",
		"..",
		"src",
		"native",
		"bundle-id.swift",
	);

	try {
		await stat(source);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(`focus:       missing Swift source at ${source}; skipped`);
			return;
		}
		throw error;
	}

	await mkdir(dirname(target), { recursive: true });

	let exitCode: number;
	let stderr: string;
	try {
		const proc = Bun.spawn(["swiftc", "-O", "-o", target, source], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stderrPromise = new Response(proc.stderr).text();
		exitCode = await proc.exited;
		stderr = await stderrPromise;
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(
				"focus:       swiftc not found; falling back to osascript (install Xcode Command Line Tools to enable the fast helper)",
			);
			return;
		}
		throw error;
	}

	if (exitCode !== 0) {
		console.warn(
			`focus:       failed to compile frontmost helper (exit ${exitCode}); falling back to osascript`,
		);
		if (stderr.trim().length > 0) {
			console.warn(`             ${stderr.trim()}`);
		}
		return;
	}

	console.log(`focus:       compiled helper at ${target}`);
}

function parseArgs(argv: string[]): InitOptions {
	let claudeCode = false;
	let opencode = false;
	let shell = false;
	let shellRc: string | null = null;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];

		if (arg === "--claude-code") {
			claudeCode = true;
			continue;
		}

		if (arg === "--opencode") {
			opencode = true;
			continue;
		}

		if (arg === "--shell") {
			shell = true;
			continue;
		}

		if (arg === "--shell-rc") {
			const value = argv[++i];
			if (value === undefined) {
				throw new Error("--shell-rc requires a path");
			}
			shellRc = value;
			shell = true;
			continue;
		}

		if (arg?.startsWith("--shell-rc=")) {
			shellRc = arg.slice("--shell-rc=".length);
			shell = true;
			continue;
		}

		throw new Error(`unknown flag: ${arg}`);
	}

	if (!claudeCode && !opencode && !shell) {
		return {
			claudeCode: true,
			opencode: true,
			shell: false,
			shellRc: null,
		};
	}

	return { claudeCode, opencode, shell, shellRc };
}

function defaultShellRc(): string {
	return join(homedir(), ".zshrc");
}

async function installShellHook(rcPath: string): Promise<void> {
	const expandedRc = expandUser(rcPath);
	const resolvedRc = await resolveSymlink(expandedRc);
	const existing = await readOptionalFile(resolvedRc);
	const desiredBlock = buildShellBlock();
	const next = mergeShellBlock(existing ?? "", desiredBlock);
	const displayPath =
		resolvedRc === expandedRc ? resolvedRc : `${expandedRc} → ${resolvedRc}`;

	if (existing === next) {
		console.log(`shell:       hook already up to date (${displayPath})`);
		return;
	}

	if (existing !== null) {
		const backupFile = `${resolvedRc}.stay-alert.bak`;
		await createBackupIfNeeded(resolvedRc, backupFile);
		console.log(`shell:       hook updated in ${displayPath}`);
		console.log(`             backup: ${backupFile}`);
	} else {
		console.log(`shell:       hook installed in ${displayPath}`);
	}

	await writeTextAtomically(resolvedRc, next);
	console.log(`             open a new shell or run: source ${expandedRc}`);
}

function expandUser(path: string): string {
	if (path === "~") {
		return homedir();
	}

	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}

	return path;
}

function mergeShellBlock(existing: string, block: string): string {
	const beginIdx = existing.indexOf(SHELL_BLOCK_BEGIN);

	if (beginIdx === -1) {
		const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
		const leadingNewline = existing === "" ? "" : "\n";
		return `${existing}${separator}${leadingNewline}${block}`;
	}

	const endMarkerIdx = existing.indexOf(SHELL_BLOCK_END, beginIdx);

	if (endMarkerIdx === -1) {
		throw new Error(
			`found stay-alert begin marker in ${SHELL_BLOCK_BEGIN} block but no matching end marker — fix the file manually`,
		);
	}

	const endIdx = endMarkerIdx + SHELL_BLOCK_END.length;
	const trailingNewline = existing[endIdx] === "\n" ? 1 : 0;
	const before = existing.slice(0, beginIdx);
	const after = existing.slice(endIdx + trailingNewline);

	return `${before}${block}${after}`;
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
		await linkOpencodePackage();
		return;
	}

	if (currentContents === pluginContents) {
		console.log(`opencode:    plugin already up to date (${resolvedFile})`);
		await linkOpencodePackage();
		return;
	}

	const backedUp = await createExclusiveBackup(resolvedFile, backupFile);
	await writeTextAtomically(resolvedFile, pluginContents);
	console.log(`opencode:    plugin updated at ${resolvedFile}`);
	if (backedUp) {
		console.log(`             backup: ${backupFile}`);
	}
	await linkOpencodePackage();
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

async function linkOpencodePackage(): Promise<void> {
	const realPluginFile = await resolveSymlink(resolveOpencodePluginFile());
	const opencodeConfigDir = dirname(dirname(realPluginFile));
	const opencodePackageDir = join(opencodeConfigDir, "node_modules");
	const linkedPackage = join(opencodePackageDir, "stay-alert");

	try {
		const stats = await lstat(linkedPackage);

		if (stats.isSymbolicLink()) {
			try {
				await stat(linkedPackage);
				return;
			} catch (error) {
				if (!isNodeError(error) || error.code !== "ENOENT") {
					throw error;
				}
			}
		}
	} catch (error) {
		if (!isNodeError(error) || error.code !== "ENOENT") {
			throw error;
		}
	}

	try {
		const stats = await lstat(opencodeConfigDir);

		if (!stats.isDirectory()) {
			console.warn(
				`opencode:    could not auto-link stay-alert into ${opencodeConfigDir}/`,
			);
			console.warn(
				`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
			);
			return;
		}
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(
				`opencode:    could not auto-link stay-alert into ${opencodeConfigDir}/`,
			);
			console.warn(
				`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
			);
			return;
		}

		throw error;
	}

	const proc = Bun.spawn(["bun", "link", "stay-alert"], {
		cwd: opencodeConfigDir,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdoutPromise = new Response(proc.stdout).text();
	const stderrPromise = new Response(proc.stderr).text();
	let exitCode: number;
	let stderr: string;

	try {
		[exitCode, , stderr] = await Promise.all([
			proc.exited,
			stdoutPromise,
			stderrPromise,
		]);
	} catch (error) {
		stderr = await stderrPromise.catch(() => "");
		console.warn(
			`opencode:    could not auto-link stay-alert into ${opencodeConfigDir}/`,
		);
		if (isNodeError(error) && error.code === "ENOENT") {
			console.warn(
				`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
			);
			return;
		}

		if (stderr.trim().length > 0) {
			console.warn(`             ${stderr.trim()}`);
		} else {
			console.warn(`             ${errorMessage(error)}`);
		}
		console.warn(
			`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
		);
		return;
	}

	if (exitCode !== 0) {
		console.warn(
			`opencode:    could not auto-link stay-alert into ${opencodeConfigDir}/`,
		);
		if (exitCode === 127 || /not found/i.test(stderr)) {
			console.warn(
				`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
			);
			return;
		}

		if (stderr.trim().length > 0) {
			console.warn(`             ${stderr.trim()}`);
		}
		console.warn(
			`             run manually: cd ${opencodeConfigDir} && bun link stay-alert`,
		);
		return;
	}

	console.log(`opencode:    linked stay-alert into ${opencodePackageDir}/`);
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
): Promise<boolean> {
	try {
		await copyFile(sourceFile, backupFile, constants.COPYFILE_EXCL);
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === "EEXIST") {
			return false;
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
	try {
		return await realpath(file);
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			try {
				const target = await readlink(file);
				return isAbsolute(target) ? target : resolve(dirname(file), target);
			} catch (readlinkError) {
				if (isNodeError(readlinkError) && readlinkError.code === "ENOENT") {
					return file;
				}

				throw readlinkError;
			}
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
