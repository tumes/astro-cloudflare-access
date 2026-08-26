## Install

```sh
npx astro add @tumes/astro-cloudflare-access
```

`astro add` will insert the default integration factory call into the Astro
config, but you must edit that call and supply real Cloudflare Access options.

Manual installation and configuration:

```sh
npm install @tumes/astro-cloudflare-access
```

```js
import { defineConfig } from 'astro/config';
import cloudflareAccess from '@tumes/astro-cloudflare-access';

export default defineConfig({
	integrations: [
		cloudflareAccess({
			teamDomain: 'https://example.cloudflareaccess.com',
			issuer: 'https://example.cloudflareaccess.com',
			audience: 'real-application-audience',
		}),
	],
});
```

## Options

- `teamDomain: string` -- HTTPS Cloudflare Access team origin. A bare hostname
  is accepted and treated as HTTPS.
- `issuer: string` -- expected JWT issuer.
- `audience: string | readonly string[]` -- expected JWT audience, or accepted
  audience values.
- `devIdentity?: { sub: string; email?: string }` -- development-only identity
  used only when Astro runs with the `dev` command.

When `devIdentity` is enabled, the integration emits a clear development-only
warning. It is omitted from build, preview, production, and other non-dev
middleware. It is not a raw JWT, arbitrary claims object, request-header
override, or browser value.

## Runtime and authorization boundary

The middleware verifies Cloudflare Access JWTs from the
`Cf-Access-Jwt-Assertion` header or encoded `CF_Authorization` cookie. It checks
the configured issuer and audience, required `exp` and `iat` claims, and the
team JWKS endpoint over HTTPS. Successful verification exposes only `sub` and
optional `email` through `Astro.locals.cloudflareAccess`.

Missing, malformed, expired, forged, or otherwise invalid assertions leave the
identity undefined. This integration is permissive: it does not reject,
redirect, or authorize requests. Application code must enforce its own
authentication and authorization boundary and return the appropriate 401/403
response when `Astro.locals.cloudflareAccess` is absent or insufficient.

The integration does not automatically expose identity to client JavaScript.
Applications can deliberately render or serialize values from
`Astro.locals.cloudflareAccess`; any such output is public page data and must be
treated accordingly. Astro middleware cannot provide request locals for
prerendered pages or static assets. A Cloudflare Access edge policy may still
independently protect static assets, but that policy does not make request
locals available to those assets.
