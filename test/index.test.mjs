import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import cloudflareAccess from '../dist/index.js';
import { createCloudflareAccessMiddleware } from '../dist/runtime.js';

const validOptions = {
	teamDomain: 'team.example.com',
	issuer: 'https://team.example.com',
	audience: 'application-audience',
};

test('invalid configuration fails during factory creation', () => {
	assert.throws(
		() => cloudflareAccess({ ...validOptions, teamDomain: 'http://team.example.com' }),
		/cloudflareAccess: teamDomain must be a valid HTTPS origin/,
	);
});

test('devIdentity is generated only for the dev command', async () => {
	const integration = cloudflareAccess({
		...validOptions,
		devIdentity: { sub: 'development-user', email: 'dev@example.com' },
	});
	const setup = integration.hooks['astro:config:setup'];
	assert.ok(setup);

	const generated = {};
	const middleware = {};
	const warnings = [];

	for (const command of ['dev', 'build']) {
		const directory = await mkdtemp(join(tmpdir(), 'astro-cloudflare-access-'));
		const codegenDir = pathToFileURL(`${directory}/`);

		await setup({
			command,
			config: {
				integrations: [{ name: 'cloudflare-access' }],
			},
			createCodegenDir: () => codegenDir,
			addMiddleware(registration) {
				middleware[command] = registration;
			},
			logger: {
				warn(message) {
					warnings.push({ command, message });
				},
			},
		});

		generated[command] = await readFile(join(directory, 'middleware.mjs'), 'utf8');
		assert.equal(middleware[command].entrypoint.href, pathToFileURL(join(directory, 'middleware.mjs')).href);
		assert.equal(middleware[command].order, 'pre');
	}

	assert.match(generated.dev, /"devIdentity":\{"sub":"development-user","email":"dev@example.com"\}/);
	assert.doesNotMatch(generated.build, /devIdentity/);
	assert.deepEqual(warnings, [
		{
			command: 'dev',
			message:
				'cloudflare-access: devIdentity is enabled for this Astro development server only; it is never used for builds or production.',
		},
	]);
});

test('duplicate cloudflare-access integrations fail before setup side effects', async () => {
	const integration = cloudflareAccess(validOptions);
	const setup = integration.hooks['astro:config:setup'];
	assert.ok(setup);

	const directory = await mkdtemp(join(tmpdir(), 'astro-cloudflare-access-'));
	const codegenDir = pathToFileURL(`${directory}/`);
	let codegenCalls = 0;
	let middlewareRegistrations = 0;

	assert.throws(
		() =>
			setup({
				command: 'dev',
				config: {
					integrations: [integration, { name: 'cloudflare-access' }],
				},
				createCodegenDir: () => {
					codegenCalls += 1;
					return codegenDir;
				},
				addMiddleware() {
					middlewareRegistrations += 1;
				},
				logger: {
					warn() {},
				},
			}),
		/cloudflare-access: duplicate integration detected.*keep only one/,
	);

	assert.equal(codegenCalls, 0);
	assert.equal(middlewareRegistrations, 0);
	await assert.rejects(readFile(join(directory, 'middleware.mjs')), { code: 'ENOENT' });
});

test('emitted runtime verifies Cloudflare Access tokens without network access', { concurrency: false }, async () => {
	const [{ privateKey, publicKey }, { privateKey: forgedPrivateKey }] = await Promise.all([
		generateKeyPair('RS256'),
		generateKeyPair('RS256'),
	]);
	const jwk = {
		...(await exportJWK(publicKey)),
		alg: 'RS256',
		kid: 'fixture-key',
		use: 'sig',
	};
	const now = Math.floor(Date.now() / 1000);
	const jwksUrl = 'https://team.example.com/cdn-cgi/access/certs';

	async function createToken(signingKey, {
		audience = validOptions.audience,
		email = 'user@example.com',
		expiresAt = now + 300,
		issuer = validOptions.issuer,
		sub = 'verified-user',
	} = {}) {
		return new SignJWT({ email })
			.setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
			.setIssuer(issuer)
			.setAudience(audience)
			.setSubject(sub)
			.setIssuedAt(now - 10)
			.setExpirationTime(expiresAt)
			.sign(signingKey);
	}

	async function runMiddleware(middleware, headers = {}) {
		const locals = {};
		await middleware(
			{
				locals,
				request: new Request('https://app.example.com/', { headers }),
			},
			async () => new Response('ok'),
		);
		return locals.cloudflareAccess;
	}

	const middleware = createCloudflareAccessMiddleware(validOptions);
	const requestedUrls = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		requestedUrls.push(String(input));
		return new Response(JSON.stringify({ keys: [jwk] }), {
			headers: { 'content-type': 'application/json' },
		});
	};

	try {
		const headerToken = await createToken(privateKey);
		assert.deepEqual(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': headerToken }),
			{ sub: 'verified-user', email: 'user@example.com' },
		);

		const cookieToken = await createToken(privateKey, {
			sub: 'cookie-user',
			email: 'cookie@example.com',
		});
		assert.deepEqual(
			await runMiddleware(middleware, {
				cookie: `CF_Authorization=${encodeURIComponent(cookieToken)}`,
			}),
			{ sub: 'cookie-user', email: 'cookie@example.com' },
		);

		const forgedToken = await createToken(forgedPrivateKey, { sub: 'forged-user' });
		assert.equal(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': forgedToken }),
			undefined,
		);

		const expiredToken = await createToken(privateKey, {
			expiresAt: now - 1,
			sub: 'expired-user',
		});
		assert.equal(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': expiredToken }),
			undefined,
		);

		const wrongIssuerToken = await createToken(privateKey, {
			issuer: 'https://wrong.example.com',
			sub: 'wrong-issuer-user',
		});
		assert.equal(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': wrongIssuerToken }),
			undefined,
		);

		const wrongAudienceToken = await createToken(privateKey, {
			audience: 'wrong-audience',
			sub: 'wrong-audience-user',
		});
		assert.equal(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': wrongAudienceToken }),
			undefined,
		);

		assert.equal(
			await runMiddleware(middleware, { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' }),
			undefined,
		);
		assert.equal(await runMiddleware(middleware), undefined);
		assert.deepEqual(requestedUrls, [jwksUrl]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
