const REQUIRED = [
	"SHOPIFY_SHOP_DOMAIN",
	"SHOPIFY_ACCESS_TOKEN",
	"RESEND_API_KEY",
	"RESEND_FROM_EMAIL",
	"RESEND_TO_EMAIL",
] as const;

export interface Config {
	SHOPIFY_SHOP_DOMAIN: string;
	SHOPIFY_ACCESS_TOKEN: string;
	RESEND_API_KEY: string;
	RESEND_FROM_EMAIL: string;
	RESEND_TO_EMAIL: string;
	PORT: number;
	POLL_CRON: string;
	DIGEST_CRON: string;
	DATABASE_PATH: string;
}

export function buildConfig(): Readonly<Config> {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(", ")}`,
		);
	}

	const config: Config = {
		SHOPIFY_SHOP_DOMAIN: process.env.SHOPIFY_SHOP_DOMAIN as string,
		SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN as string,
		RESEND_API_KEY: process.env.RESEND_API_KEY as string,
		RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL as string,
		RESEND_TO_EMAIL: process.env.RESEND_TO_EMAIL as string,
		PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
		POLL_CRON: process.env.POLL_CRON ?? "0 */4 * * *",
		DIGEST_CRON: process.env.DIGEST_CRON ?? "0 7 * * *",
		DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/shopify-sync.db",
	};

	return Object.freeze(config);
}
