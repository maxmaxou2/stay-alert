import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";

export type IconSource = "claude-code" | "opencode";

export function assetsDir(): string {
	return join(import.meta.dir, "..", "..", "assets");
}

export async function resolveIcon(
	config: Config,
	source: IconSource,
): Promise<string | null> {
	const override = configOverride(config, source);
	if (override !== null) {
		return override;
	}

	const shortNames =
		source === "claude-code" ? ["claude-code", "claude"] : ["opencode"];

	const candidates: string[] = [];
	for (const name of shortNames) {
		candidates.push(join(assetsDir(), `${name}.icns`));
		candidates.push(join(assetsDir(), `${name}.png`));
	}

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// keep looking
		}
	}

	return null;
}

function configOverride(config: Config, source: IconSource): string | null {
	const value =
		source === "claude-code"
			? config.notifications.iconClaudeCode
			: config.notifications.iconOpencode;

	if (value === null) {
		return null;
	}

	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}
