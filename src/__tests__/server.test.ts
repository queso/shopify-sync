import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { runDigestJob } from "../cron/digest";
import { runPollJob } from "../cron/poll";
import { initDb } from "../db/index";
import { _setDb, _setDigestRunner, _setPollRunner, app } from "../index";

// ─── Mock job runners (no mock.module — avoids global module registry pollution) ─

const mockRunPollJob = mock(async () => ({
	success: true,
	productsPolled: 5,
	changesDetected: 0,
}));

const mockRunDigestJob = mock(async () => ({
	emailSent: false,
	changeCount: 0,
}));

// ─── Environment setup ───────────────────────────────────────────────────────

const TEST_ENV = {
	SHOPIFY_SHOP_DOMAIN: "test-store.myshopify.com",
	SHOPIFY_ACCESS_TOKEN: "shpat_test",
	RESEND_API_KEY: "re_test",
	RESEND_FROM_EMAIL: "from@example.com",
	RESEND_TO_EMAIL: "to@example.com",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Hono server (app)", () => {
	beforeEach(() => {
		for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
		_setDb(initDb(":memory:"));
		_setPollRunner(mockRunPollJob as unknown as typeof runPollJob);
		_setDigestRunner(mockRunDigestJob as unknown as typeof runDigestJob);
		mockRunPollJob.mockClear();
		mockRunDigestJob.mockClear();
	});

	afterEach(() => {
		_setDb(null);
		_setPollRunner(runPollJob);
		_setDigestRunner(runDigestJob);
		for (const k of Object.keys(TEST_ENV)) delete process.env[k];
	});

	// ─── GET /health ─────────────────────────────────────────────────────────

	describe("GET /health", () => {
		it("should return 200 with status: ok", async () => {
			const res = await app.request("/health");

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.status).toBe("ok");
		});

		it("should include uptime as a number", async () => {
			const res = await app.request("/health");

			const body = await res.json();
			expect(typeof body.uptime).toBe("number");
			expect(body.uptime).toBeGreaterThanOrEqual(0);
		});

		it("should return JSON content-type", async () => {
			const res = await app.request("/health");

			expect(res.headers.get("content-type")).toContain("application/json");
		});
	});

	// ─── POST /poll ──────────────────────────────────────────────────────────

	describe("POST /poll", () => {
		it("should trigger runPollJob and return 200", async () => {
			const res = await app.request("/poll", { method: "POST" });

			expect(res.status).toBe(200);
			expect(mockRunPollJob).toHaveBeenCalledTimes(1);
		});

		it("should return 500 when runPollJob throws", async () => {
			mockRunPollJob.mockImplementationOnce(async () => {
				throw new Error("Shopify API unreachable");
			});

			const res = await app.request("/poll", { method: "POST" });

			expect(res.status).toBe(500);
		});
	});

	// ─── POST /digest ────────────────────────────────────────────────────────

	describe("POST /digest", () => {
		it("should trigger runDigestJob and return 200", async () => {
			const res = await app.request("/digest", { method: "POST" });

			expect(res.status).toBe(200);
			expect(mockRunDigestJob).toHaveBeenCalledTimes(1);
		});
	});
});
