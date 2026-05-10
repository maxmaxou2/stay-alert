import { readFile } from "node:fs/promises";
import type { TomlTableWithoutBigInt, TomlValueWithoutBigInt } from "smol-toml";
import { parse } from "smol-toml";
import type { Paths } from "./paths.ts";

export type Config = {
	predictor: {
		sampleSize: number;
		timeoutMs: number;
	};
	focus: {
		terminalApps: string[];
	};
	notifications: {
		transientSound: string | null;
		stickySound: string;
	};
};

export const DEFAULT_CONFIG: Config = {
	predictor: {
		sampleSize: 20,
		timeoutMs: 1000,
	},
	focus: {
		terminalApps: [
			"Ghostty",
			"iTerm2",
			"Terminal",
			"Alacritty",
			"kitty",
			"WezTerm",
		],
	},
	notifications: {
		transientSound: null,
		stickySound: "default",
	},
};

export async function loadConfig(paths: Paths): Promise<Config> {
	let contents: string;

	try {
		contents = await readFile(paths.configFile, "utf8");
	} catch (error) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return DEFAULT_CONFIG;
		}

		throw error;
	}

	let userConfig: TomlTableWithoutBigInt;

	try {
		userConfig = parse(contents, { integersAsBigInt: false });
	} catch (error) {
		throw new Error(
			`Failed to parse ${paths.configFile}: ${errorMessage(error)}`,
			{ cause: error },
		);
	}

	return mergeConfig(userConfig);
}

function mergeConfig(userConfig: TomlTableWithoutBigInt): Config {
	return {
		predictor: mergePredictorConfig(userConfig.predictor),
		focus: mergeFocusConfig(userConfig.focus),
		notifications: mergeNotificationsConfig(userConfig.notifications),
	};
}

function mergePredictorConfig(
	value: TomlValueWithoutBigInt | undefined,
): Config["predictor"] {
	if (value === undefined) {
		return { ...DEFAULT_CONFIG.predictor };
	}

	const table = requireTable("predictor", value);

	return {
		sampleSize: positiveIntegerOrDefault(
			"predictor.sampleSize",
			table.sampleSize,
			DEFAULT_CONFIG.predictor.sampleSize,
		),
		timeoutMs: positiveIntegerOrDefault(
			"predictor.timeoutMs",
			table.timeoutMs,
			DEFAULT_CONFIG.predictor.timeoutMs,
		),
	};
}

function mergeFocusConfig(
	value: TomlValueWithoutBigInt | undefined,
): Config["focus"] {
	if (value === undefined) {
		return { terminalApps: [...DEFAULT_CONFIG.focus.terminalApps] };
	}

	const table = requireTable("focus", value);

	return {
		terminalApps: stringArrayOrDefault(
			"focus.terminalApps",
			table.terminalApps,
			DEFAULT_CONFIG.focus.terminalApps,
		),
	};
}

function mergeNotificationsConfig(
	value: TomlValueWithoutBigInt | undefined,
): Config["notifications"] {
	if (value === undefined) {
		return { ...DEFAULT_CONFIG.notifications };
	}

	const table = requireTable("notifications", value);

	return {
		transientSound: nullableStringOrDefault(
			"notifications.transientSound",
			table.transientSound,
			DEFAULT_CONFIG.notifications.transientSound,
		),
		stickySound: stringOrDefault(
			"notifications.stickySound",
			table.stickySound,
			DEFAULT_CONFIG.notifications.stickySound,
		),
	};
}

function requireTable(
	path: string,
	value: TomlValueWithoutBigInt,
): TomlTableWithoutBigInt {
	if (!isPlainTable(value)) {
		throw new Error(`${path} must be a table`);
	}

	return value;
}

function positiveIntegerOrDefault(
	path: string,
	value: TomlValueWithoutBigInt | undefined,
	fallback: number,
): number {
	if (value === undefined) {
		return fallback;
	}

	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${path} must be a positive integer`);
	}

	return value;
}

function stringArrayOrDefault(
	path: string,
	value: TomlValueWithoutBigInt | undefined,
	fallback: string[],
): string[] {
	if (value === undefined) {
		return [...fallback];
	}

	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		throw new Error(`${path} must be a string array`);
	}

	return value;
}

function nullableStringOrDefault(
	path: string,
	value: TomlValueWithoutBigInt | undefined,
	fallback: string | null,
): string | null {
	if (value === undefined) {
		return fallback;
	}

	if (typeof value !== "string") {
		throw new Error(
			`${path} must be a string (omit the key to restore the default)`,
		);
	}

	return value;
}

function stringOrDefault(
	path: string,
	value: TomlValueWithoutBigInt | undefined,
	fallback: string,
): string {
	if (value === undefined) {
		return fallback;
	}

	if (typeof value !== "string") {
		throw new Error(`${path} must be a string`);
	}

	return value;
}

function isPlainTable(
	value: TomlValueWithoutBigInt,
): value is TomlTableWithoutBigInt {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
