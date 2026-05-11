import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryHomes: string[] = [];

afterEach(async () => {
	for (const home of temporaryHomes.splice(0)) {
		await rm(home, { force: true, recursive: true });
	}
});

test("opencode init writes plugin and is idempotent", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-init-"));
	temporaryHomes.push(home);

	await runInitInHome(home);

	const target = join(home, ".config", "opencode", "plugins", "stay-alert.ts");
	const source = await readFile("examples/opencode-plugin.ts", "utf8");

	expect(await readFile(target, "utf8")).toBe(source);
	const firstStat = await stat(target);

	await runInitInHome(home);

	expect(await readFile(target, "utf8")).toBe(source);
	expect((await stat(target)).mtimeMs).toBe(firstStat.mtimeMs);
});

async function runInitInHome(home: string): Promise<void> {
	const proc = Bun.spawn(
		[process.execPath, "run", "src/cli/index.ts", "init", "--opencode"],
		{
			cwd: process.cwd(),
			env: { ...process.env, HOME: home },
			stderr: "pipe",
			stdout: "pipe",
		},
	);

	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	if (exitCode !== 0) {
		throw new Error(
			`init failed with exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}
}
