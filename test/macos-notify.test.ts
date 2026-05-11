import { afterEach, expect, test } from "bun:test";

import { macosNotifier } from "../src/core/notify/macos.ts";

const originalSpawn = Bun.spawn;
const originalWarn = console.warn;

afterEach(() => {
	Bun.spawn = originalSpawn;
	console.warn = originalWarn;
});

test("macOS notifier sends transient alerts through detached alerter with timeout", async () => {
	let argv: string[] | undefined;
	let options: { stdio?: string[] } | undefined;
	let didUnref = false;

	Bun.spawn = ((command: string[], spawnOptions: { stdio?: string[] }) => {
		argv = command;
		options = spawnOptions;

		return {
			unref() {
				didUnref = true;
			},
		};
	}) as typeof Bun.spawn;

	await macosNotifier.notify({
		message: "hello",
		sound: "Glass",
		title: "stay-alert",
		urgency: "transient",
	});

	expect(argv).toEqual([
		"alerter",
		"--message",
		"hello",
		"--title",
		"stay-alert",
		"--group",
		"stay-alert",
		"--sound",
		"Glass",
		"--timeout",
		"5",
	]);
	expect(options).toEqual({ stdio: ["ignore", "ignore", "ignore"] });
	expect(didUnref).toBe(true);
});

test("macOS notifier sends sticky alerts through alerter without timeout", async () => {
	let argv: string[] | undefined;

	Bun.spawn = ((command: string[]) => {
		argv = command;

		return {
			unref() {},
		};
	}) as typeof Bun.spawn;

	await macosNotifier.notify({
		message: "world",
		title: "stay-alert",
		urgency: "sticky",
	});

	expect(argv).toEqual([
		"alerter",
		"--message",
		"world",
		"--title",
		"stay-alert",
		"--group",
		"stay-alert",
	]);
});

test("macOS notifier warns once when alerter is missing", async () => {
	const warnings: string[] = [];
	Bun.spawn = (() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	}) as typeof Bun.spawn;
	console.warn = (message?: unknown) => {
		warnings.push(String(message));
	};

	const opts = {
		message: "hello",
		title: "stay-alert",
		urgency: "sticky" as const,
	};

	await macosNotifier.notify(opts);
	await macosNotifier.notify(opts);

	expect(warnings).toEqual([
		"stay-alert: alerter not found; install it with `brew install vjeantet/tap/alerter` for notifications",
	]);
});
