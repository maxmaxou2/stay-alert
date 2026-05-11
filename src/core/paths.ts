import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type Paths = {
	configDir: string;
	configFile: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
	const stayAlertHome = env.STAY_ALERT_HOME;

	if (stayAlertHome) {
		return buildPaths(join(stayAlertHome, "config"));
	}

	const home = env.HOME;

	if (!home) {
		throw new Error("HOME must be set to resolve stay-alert paths");
	}

	const configDir = join(
		env.XDG_CONFIG_HOME ?? join(home, ".config"),
		"stay-alert",
	);

	return buildPaths(configDir);
}

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

function buildPaths(configDir: string): Paths {
	return {
		configDir,
		configFile: join(configDir, "config.toml"),
	};
}
