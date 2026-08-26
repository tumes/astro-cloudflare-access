# Astro Cloudflare Access

A little middleware integration that injects Cloudflare Access user info into Astro locals to save a little boilerplate for full-stack SSR apps.

## Motivation

I love Astro and Cloudflare, the ergonomics of working in the ecosystem are second to none, but as a reformed Rails developer, I am alergic to much of the boilerplate that comes part and parcel with the modern JS and TS ecosystems. Thus and so, I took a moment to vibe code a little reusable piece of middleware to make spinning up an Access-protected app a little more pleasent.

Cloudflare recently introduced [Protect all Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-all-workers), a great product that included a lovely convenience helper that automatically injects user info into the ctx that comes along with every request. The problem is, this quickly becomes bery awkward because this only works if you want to apply protection to every route in your worker.

"Ah," I can hear you thinking, "why don't you simply use the chain of precendence for Access apps?" to which I say: Wow I can't believe I have developed the ability to hear thoughts, and also, the problem is that you therefore end up having to craft rules to permit all public routes at the hostname level (many of which are implicit, e.g. Astro's inbuilt asset routing) and are therefore very brittle as compared to only actively applying protection to priveledged routes (eg /admin). Protect all Workers does not allow individual route protection, it's all or nothing.

"Oh," I, incredulous at my new powers hear you mentally retort, "but philosophically isn't it totally kosher to have to understand and enumerate all your permitted routes?" Perhaps, however, the helpful context injection is further stymied by any app that uses static assets, which, at that point what's the point, how many SSRed, non-static-asset-bearing apps are you going to be running in production for a full stack app of _any_ complexity?

Anyway, that's why I put this together. I am am embittered greybeard so I _could_ have made it by hand, but the bulk of the code was written by various LLMs piped through Opencode. I hope it saves you a little bit of unpleasant boilerplate the next time you spin up an Astro app on Cloudflare.

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
