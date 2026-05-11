import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import { isTerminalFocused } from "./focus.ts";
import { notify } from "./notify/index.ts";
import type { Paths } from "./paths.ts";
import { resolvePaths } from "./paths.ts";
import type { NotifyUrgency } from "./types.ts";

export type { Config } from "./config.ts";
export { DEFAULT_CONFIG, loadConfig } from "./config.ts";
export type { Notifier } from "./notify/types.ts";
export type { Paths } from "./paths.ts";
export { resolvePaths } from "./paths.ts";
export type { NotifyOptions, NotifyUrgency, Source } from "./types.ts";

export type Context = {
	paths: Paths;
	config: Config;
};

export async function createContext(
	env: NodeJS.ProcessEnv = process.env,
): Promise<Context> {
	const paths = resolvePaths(env);
	const config = await loadConfig(paths);

	return { paths, config };
}

export async function notifyUser(
	ctx: Context,
	opts: { title: string; message: string },
): Promise<void> {
	const focus = await isTerminalFocused(ctx.config);
	const urgency: NotifyUrgency =
		focus.appName === null || focus.focused === false ? "sticky" : "transient";
	const sound =
		urgency === "transient"
			? (ctx.config.notifications.transientSound ?? undefined)
			: ctx.config.notifications.stickySound;

	await notify({ title: opts.title, message: opts.message, sound, urgency });
}
