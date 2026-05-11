import { createContext } from "../core/index.ts";
import { notify } from "../core/notify/index.ts";

export async function runTest(): Promise<void> {
	const ctx = await createContext();

	await notify({
		title: "stay-alert",
		message: "Transient: this should banner and auto-dismiss.",
		urgency: "transient",
	});

	await new Promise((resolve) => setTimeout(resolve, 1500));

	await notify({
		title: "stay-alert",
		message: "Sticky: this should persist + ding.",
		sound: ctx.config.notifications.stickySound,
		urgency: "sticky",
	});

	console.log(`Sent two notifications. If you didn't see them:
  1. Open System Settings → Notifications and confirm Script Editor + terminal-notifier are allowed.
  2. If sticky was missing, run: brew install terminal-notifier`);
}
