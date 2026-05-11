import { afterEach, expect, test } from "bun:test";
import {
	lstat,
	mkdtemp,
	readFile,
	readlink,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
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

test("shell init writes zshrc block and is idempotent", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-init-"));
	temporaryHomes.push(home);
	const zshrc = join(home, ".zshrc");

	await Bun.write(zshrc, "# user content\nexport FOO=1\n");

	await runShellInitInHome(home);
	const first = await readFile(zshrc, "utf8");
	expect(first).toContain("# user content");
	expect(first).toContain("stay-alert begin");
	expect(first).toContain("stay-alert notify-command");

	await runShellInitInHome(home);
	const second = await readFile(zshrc, "utf8");
	expect(second).toBe(first);
});

test("shell init --shell-rc writes to custom path", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-init-"));
	temporaryHomes.push(home);
	const customRc = join(home, "custom.zsh");

	await writeFile(customRc, "# custom rc\n");

	await runShellInitInHome(home, ["--shell-rc", customRc]);

	const contents = await readFile(customRc, "utf8");
	expect(contents).toContain("# custom rc");
	expect(contents).toContain("stay-alert begin");

	const defaultRc = join(home, ".zshrc");
	await expect(stat(defaultRc)).rejects.toThrow();
});

test("shell init preserves symlink target", async () => {
	const home = await mkdtemp(join(tmpdir(), "stay-alert-init-"));
	temporaryHomes.push(home);
	const realFile = join(home, "real.zshrc");
	const linkFile = join(home, ".zshrc");

	await writeFile(realFile, "# real rc\n");
	await symlink(realFile, linkFile);

	await runShellInitInHome(home, ["--shell-rc", linkFile]);

	expect((await lstat(linkFile)).isSymbolicLink()).toBe(true);
	expect(await readlink(linkFile)).toBe(realFile);

	const realContents = await readFile(realFile, "utf8");
	expect(realContents).toContain("# real rc");
	expect(realContents).toContain("stay-alert begin");
});

async function runShellInitInHome(
	home: string,
	extraArgs: string[] = ["--shell"],
): Promise<void> {
	const proc = Bun.spawn(
		[process.execPath, "run", "src/cli/index.ts", "init", ...extraArgs],
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
			`shell init failed with exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
		);
	}
}

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
