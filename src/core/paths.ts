import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Paths = {
	configDir: string;
	configFile: string;
	dataDir: string;
	bundleIdBin: string;
	notifierApp: string;
	notifierBin: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
	const stayAlertHome = env.STAY_ALERT_HOME;
	const home = env.HOME;

	if (stayAlertHome) {
		return buildPaths(
			join(stayAlertHome, "config"),
			join(stayAlertHome, "data"),
			join(stayAlertHome, "Applications"),
		);
	}

	if (!home) {
		throw new Error("HOME must be set to resolve stay-alert paths");
	}

	const configDir = join(
		env.XDG_CONFIG_HOME ?? join(home, ".config"),
		"stay-alert",
	);
	const dataDir = join(
		env.XDG_DATA_HOME ?? join(home, ".local", "share"),
		"stay-alert",
	);
	const appsDir = join(home, "Applications");

	return buildPaths(configDir, dataDir, appsDir);
}

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

function buildPaths(
	configDir: string,
	dataDir: string,
	appsDir: string,
): Paths {
	const notifierApp = join(appsDir, "StayAlertNotifier.app");
	return {
		configDir,
		configFile: join(configDir, "config.toml"),
		dataDir,
		bundleIdBin: join(dataDir, "bin", "bundle-id"),
		notifierApp,
		notifierBin: join(notifierApp, "Contents", "MacOS", "StayAlertNotifier"),
	};
}
