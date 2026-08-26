import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureSource = resolve(packageRoot, 'fixtures/consumer');

function runNpm(args, cwd, options = {}) {
	const npmExecPath = process.env.npm_execpath;
	const command = npmExecPath ? process.execPath : 'npm';
	const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
	const result = spawnSync(command, commandArgs, {
		cwd,
		encoding: 'utf8',
		stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
	});

	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`npm ${args.join(' ')} failed with exit code ${result.status}`);
	}

	return result.stdout ?? '';
}

function parsePackMetadata(output) {
	try {
		return JSON.parse(output);
	} catch {
		const start = output.indexOf('[');
		const end = output.lastIndexOf(']');
		if (start < 0 || end < start) throw new Error('npm pack --json did not return JSON metadata');
		return JSON.parse(output.slice(start, end + 1));
	}
}

const packOutput = runNpm(['pack', '--json'], packageRoot, { capture: true });
const packMetadata = parsePackMetadata(packOutput);
const filename = packMetadata[0]?.filename;

if (typeof filename !== 'string' || filename.length === 0) {
	throw new Error('npm pack --json returned no tarball filename');
}

const tarballPath = resolve(packageRoot, filename);
if (!existsSync(tarballPath)) {
	throw new Error(`npm pack reported missing tarball: ${tarballPath}`);
}

const packedFiles = packMetadata[0]?.files ?? [];
const excludedFiles = packedFiles.filter(({ path }) =>
	path.startsWith('fixtures/') || path.startsWith('scripts/') || path === '.gitignore',
);
if (excludedFiles.length > 0) {
	throw new Error(`package tarball contains excluded files: ${excludedFiles.map(({ path }) => path).join(', ')}`);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'astro-cloudflare-access-consumer-'));
await mkdir(join(fixtureRoot, 'src/pages'), { recursive: true });
for (const relativePath of [
	'package.json',
	'astro.config.mjs',
	'tsconfig.json',
	'src/pages/index.astro',
]) {
	const sourcePath = join(fixtureSource, relativePath);
	const destinationPath = join(fixtureRoot, relativePath);
	await copyFile(sourcePath, destinationPath);
}

console.log(`[fixture] packed tarball: ${tarballPath}`);
console.log(`[fixture] packed files: ${packedFiles.map(({ path }) => path).join(', ')}`);
console.log(`[fixture] isolated consumer: ${fixtureRoot}`);

runNpm(
	['install', tarballPath, '--no-package-lock', '--ignore-scripts', '--no-save'],
		fixtureRoot,
);
runNpm(['run', 'check'], fixtureRoot);
runNpm(['run', 'build'], fixtureRoot);
