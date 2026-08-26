import { writeFileSync } from 'node:fs';
import type { AstroIntegration } from 'astro';

export type CloudflareAccessAudience = string | readonly string[];

export interface CloudflareAccessIdentity {
	readonly sub: string;
	readonly email?: string;
}

export interface CloudflareAccessOptions {
	teamDomain: string;
	issuer: string;
	audience: CloudflareAccessAudience;
	devIdentity?: {
		sub: string;
		email?: string;
	};
}

const middlewareRuntime = new URL('./runtime.js', import.meta.url);

function getTeamDomainOrigin(teamDomain: string): string {
	if (typeof teamDomain !== 'string' || teamDomain.trim().length === 0) {
		throw new Error('cloudflareAccess: teamDomain must be a valid HTTPS origin');
	}

	const candidate = teamDomain.trim();
	const withScheme = candidate.includes('://') ? candidate : `https://${candidate}`;
	let origin: URL;

	try {
		origin = new URL(withScheme);
	} catch {
		throw new Error('cloudflareAccess: teamDomain must be a valid HTTPS origin');
	}

	if (
		origin.protocol !== 'https:' ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	) {
		throw new Error('cloudflareAccess: teamDomain must be a valid HTTPS origin');
	}

	return origin.origin;
}

function validateDevIdentity(
	devIdentity: CloudflareAccessOptions['devIdentity'],
): CloudflareAccessIdentity | undefined {
	if (devIdentity === undefined) return undefined;

	if (
		typeof devIdentity !== 'object' ||
		devIdentity === null ||
		Array.isArray(devIdentity) ||
		typeof devIdentity.sub !== 'string' ||
		devIdentity.sub.trim().length === 0
	) {
		throw new Error('cloudflareAccess: devIdentity.sub must be a non-empty string');
	}

	if (devIdentity.email !== undefined && typeof devIdentity.email !== 'string') {
		throw new Error('cloudflareAccess: devIdentity.email must be a string');
	}

	return devIdentity.email === undefined
		? { sub: devIdentity.sub.trim() }
		: { sub: devIdentity.sub.trim(), email: devIdentity.email };
}

function validateOptions(options: CloudflareAccessOptions): CloudflareAccessOptions {
	const issuer = typeof options.issuer === 'string' ? options.issuer.trim() : '';
	if (!issuer) throw new Error('cloudflareAccess: issuer must be non-empty');

	const audience = options.audience;
	const teamDomain = getTeamDomainOrigin(options.teamDomain);
	const devIdentity = validateDevIdentity(options.devIdentity);

	if (typeof audience === 'string') {
		if (!audience.trim()) throw new Error('cloudflareAccess: audience must be non-empty');
		return {
			teamDomain,
			issuer,
			audience: audience.trim(),
			...(devIdentity ? { devIdentity } : {}),
		};
	}

	if (
		!Array.isArray(audience) ||
		audience.length === 0 ||
		audience.some((item) => typeof item !== 'string' || !item.trim())
	) {
		throw new Error('cloudflareAccess: audience must contain non-empty items');
	}

	return {
		teamDomain,
		issuer,
		audience: audience.map((item) => item.trim()),
		...(devIdentity ? { devIdentity } : {}),
	};
}

const injectedLocalsTypes = `declare global {
	namespace App {
		interface Locals {
			cloudflareAccess: {
				readonly sub: string;
				readonly email?: string;
			} | undefined;
		}
	}
}

export {};`;

export function cloudflareAccess(options: CloudflareAccessOptions): AstroIntegration {
	const validatedOptions = validateOptions(options);

	const integration: AstroIntegration = {
		name: 'cloudflare-access',
		hooks: {
			'astro:config:setup': ({ addMiddleware, command, config, createCodegenDir, logger }) => {
				const matchingIntegrations = (config.integrations ?? []).filter(
					(registeredIntegration) => registeredIntegration.name === integration.name,
				);
				if (matchingIntegrations.length > 1) {
					throw new Error(
						'cloudflare-access: duplicate integration detected; remove the extra cloudflareAccess() registration and keep only one.',
					);
				}

				const codegenDir = createCodegenDir();
				const entrypoint = new URL('middleware.mjs', codegenDir);
				const runtimeOptions =
					command === 'dev' && validatedOptions.devIdentity
						? validatedOptions
						: {
								teamDomain: validatedOptions.teamDomain,
								issuer: validatedOptions.issuer,
							audience: validatedOptions.audience,
							};

				if (command === 'dev' && validatedOptions.devIdentity) {
					logger.warn(
						'cloudflare-access: devIdentity is enabled for this Astro development server only; it is never used for builds or production.',
					);
				}

				writeFileSync(
					entrypoint,
					[
						`import { createCloudflareAccessMiddleware } from ${JSON.stringify(middlewareRuntime.href)};`,
						`export const onRequest = createCloudflareAccessMiddleware(${JSON.stringify(runtimeOptions)});`,
					].join('\n'),
				);

				addMiddleware({ entrypoint, order: 'pre' });
			},
			'astro:config:done': ({ injectTypes }) => {
				injectTypes({ filename: 'locals.d.ts', content: injectedLocalsTypes });
			},
		},
	};

	return integration;
}

export default cloudflareAccess;
