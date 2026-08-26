import { defineConfig } from 'astro/config';
import cloudflareAccess from 'astro-cloudflare-access';

export default defineConfig({
	integrations: [
		cloudflareAccess({
			teamDomain: 'https://team.example.com',
			issuer: 'https://team.example.com',
			audience: 'consumer-fixture-audience',
		}),
	],
});
