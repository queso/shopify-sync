import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const REQUIRED_VARS = [
	"SHOPIFY_SHOP_DOMAIN",
	"SHOPIFY_ACCESS_TOKEN",
	"RESEND_API_KEY",
	"RESEND_FROM_EMAIL",
	"RESEND_TO_EMAIL",
] as const;

const OPTIONAL_VARS = [
	"PORT",
	"POLL_CRON",
	"DIGEST_CRON",
	"DATABASE_PATH",
] as const;

function setRequiredEnv() {
	process.env.SHOPIFY_SHOP_DOMAIN = "test-store.myshopify.com";
	process.env.SHOPIFY_ACCESS_TOKEN = "shpat_test123";
	process.env.RESEND_API_KEY = "re_test123";
	process.env.RESEND_FROM_EMAIL = "from@example.com";
	process.env.RESEND_TO_EMAIL = "to@example.com";
}

function clearAllConfigEnv() {
	for (const v of [...REQUIRED_VARS, ...OPTIONAL_VARS]) {
		delete process.env[v];
	}
}

// Import the factory function that builds config from current env.
// The module must export a `buildConfig()` function so tests can call it
// fresh each time without relying on module-level singleton state.
import { buildConfig } from "../config";

describe("config module", () => {
	beforeEach(() => {
		clearAllConfigEnv();
	});

	afterEach(() => {
		clearAllConfigEnv();
	});

	it("returns correct config when all required env vars are set", () => {
		setRequiredEnv();
		const config = buildConfig();

		expect(config.SHOPIFY_SHOP_DOMAIN).toBe("test-store.myshopify.com");
		expect(config.SHOPIFY_ACCESS_TOKEN).toBe("shpat_test123");
		expect(config.RESEND_API_KEY).toBe("re_test123");
		expect(config.RESEND_FROM_EMAIL).toBe("from@example.com");
		expect(config.RESEND_TO_EMAIL).toBe("to@example.com");
	});

	it("applies correct defaults for optional vars when not set", () => {
		setRequiredEnv();
		const config = buildConfig();

		expect(config.PORT).toBe(3000);
		expect(config.DATABASE_PATH).toBe("./data/shopify-sync.db");
	});

	it("uses provided values for optional vars when set", () => {
		setRequiredEnv();
		process.env.PORT = "8080";
		process.env.DATABASE_PATH = "/custom/path.db";
		const config = buildConfig();

		expect(config.PORT).toBe(8080);
		expect(config.DATABASE_PATH).toBe("/custom/path.db");
	});

	it("throws error when one required var is missing — error message names the missing var", () => {
		setRequiredEnv();
		delete process.env.SHOPIFY_ACCESS_TOKEN;

		expect(() => buildConfig()).toThrow("SHOPIFY_ACCESS_TOKEN");
	});

	it("throws error when multiple required vars are missing — error message lists ALL of them", () => {
		// Only set one required var, leave the rest missing
		process.env.SHOPIFY_SHOP_DOMAIN = "test-store.myshopify.com";

		let error: Error | null = null;
		try {
			buildConfig();
		} catch (e) {
			error = e as Error;
		}

		expect(error).not.toBeNull();
		expect(error?.message).toContain("SHOPIFY_ACCESS_TOKEN");
		expect(error?.message).toContain("RESEND_API_KEY");
		expect(error?.message).toContain("RESEND_FROM_EMAIL");
		expect(error?.message).toContain("RESEND_TO_EMAIL");
	});

	it("exported config object is frozen", () => {
		setRequiredEnv();
		const config = buildConfig();

		expect(Object.isFrozen(config)).toBe(true);
	});

	it("frozen config cannot be mutated", () => {
		setRequiredEnv();
		const config = buildConfig();

		expect(() => {
			(config as Record<string, unknown>).SHOPIFY_SHOP_DOMAIN = "hacked";
		}).toThrow();
	});
});
