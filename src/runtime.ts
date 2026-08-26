import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { MiddlewareHandler } from 'astro';

import type { CloudflareAccessIdentity, CloudflareAccessOptions } from './index.js';

const ACCESS_ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';
const ACCESS_COOKIE = 'CF_Authorization';

function getAccessToken(request: Request): string | undefined {
	const assertion = request.headers.get(ACCESS_ASSERTION_HEADER)?.trim();
	if (assertion) return assertion;

	const cookieHeader = request.headers.get('cookie');
	if (!cookieHeader) return undefined;

	for (const cookie of cookieHeader.split(';')) {
		const separator = cookie.indexOf('=');
		if (separator < 0 || cookie.slice(0, separator).trim() !== ACCESS_COOKIE) continue;

		const value = cookie.slice(separator + 1).trim();
		if (!value) return undefined;

		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}

	return undefined;
}

function getJwksUrl(teamDomain: string): URL {
	const domain = teamDomain.includes('://') ? teamDomain : `https://${teamDomain}`;
	let origin: URL;

	try {
		origin = new URL(domain);
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

	return new URL('/cdn-cgi/access/certs', origin);
}

function toIdentity(payload: JWTPayload): CloudflareAccessIdentity | undefined {
	if (typeof payload.sub !== 'string' || payload.sub.length === 0) return undefined;

	const identity: CloudflareAccessIdentity = { sub: payload.sub };
	if (typeof payload.email === 'string') {
		return { ...identity, email: payload.email };
	}

	return identity;
}

export function createCloudflareAccessMiddleware(
	options: CloudflareAccessOptions,
): MiddlewareHandler {
	const audience =
		typeof options.audience === 'string' ? options.audience : [...options.audience];
	const jwks = createRemoteJWKSet(getJwksUrl(options.teamDomain));

	return async (context, next) => {
		const locals = context.locals as App.Locals & {
			cloudflareAccess: CloudflareAccessIdentity | undefined;
		};
		locals.cloudflareAccess = undefined;

		if (options.devIdentity) {
			locals.cloudflareAccess = options.devIdentity;
			return next();
		}

		const token = getAccessToken(context.request);

		if (token) {
			try {
				const { payload } = await jwtVerify(token, jwks, {
					audience,
					issuer: options.issuer,
					requiredClaims: ['exp', 'iat'],
				});

				locals.cloudflareAccess = toIdentity(payload);
			} catch {
				// Access is permissive here. Applications decide whether to require a user.
			}
		}

		return next();
	};
}
