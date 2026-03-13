import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { buildConfig } from "./config";
import { runDigestJob } from "./cron/digest";
import { runPollJob } from "./cron/poll";
import type { Db } from "./db/index";
import { initDb } from "./db/index";
import {
	fetchAllProducts,
	fetchInventoryLevels,
	fetchLocationId,
} from "./shopify/client";

const shopifyClient = {
	fetchAllProducts,
	fetchLocationId,
	fetchInventoryLevels,
};

// Server state — populated by startServer(), used by route handlers
let db: Db | null = null;
let lastPollAt: string | undefined;
let lastDigestAt: string | undefined;

export const app = new OpenAPIHono();

/** Inject a db instance for testing (avoids calling startServer). */
export function _setDb(testDb: Db | null): void {
	db = testDb;
}

// Job runner overrides — used in tests to avoid mock.module() module pollution.
let _pollRunner: typeof runPollJob = runPollJob;
let _digestRunner: typeof runDigestJob = runDigestJob;

export function _setPollRunner(fn: typeof runPollJob): void {
	_pollRunner = fn;
}
export function _setDigestRunner(fn: typeof runDigestJob): void {
	_digestRunner = fn;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const HealthResponse = z.object({
	status: z.literal("ok"),
	uptime: z.number().describe("Process uptime in seconds"),
	lastPollAt: z
		.string()
		.datetime()
		.optional()
		.describe("ISO timestamp of last successful poll"),
	lastDigestAt: z
		.string()
		.datetime()
		.optional()
		.describe("ISO timestamp of last successful digest"),
});

const PollResponse = z.object({
	productsPolled: z
		.number()
		.int()
		.describe("Number of products fetched from Shopify"),
	changesDetected: z
		.number()
		.int()
		.describe("Number of changes written to the change log"),
	success: z.boolean(),
});

const DigestResponse = z.object({
	changeCount: z
		.number()
		.int()
		.describe("Number of changes included in the digest"),
	emailSent: z.boolean(),
});

const ErrorResponse = z.object({
	error: z.string(),
});

const ServerNotReady = z.object({
	error: z.literal("Server not ready"),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

const healthRoute = createRoute({
	method: "get",
	path: "/health",
	summary: "Health check",
	description:
		"Returns server uptime and timestamps of the last successful poll and digest runs.",
	tags: ["Operations"],
	responses: {
		200: {
			content: { "application/json": { schema: HealthResponse } },
			description: "Server is healthy",
		},
	},
});

const pollRoute = createRoute({
	method: "post",
	path: "/poll",
	summary: "Trigger a poll job",
	description:
		"Fetches all products and inventory from Shopify, diffs against the last snapshot, and writes any changes to the database.",
	tags: ["Operations"],
	responses: {
		200: {
			content: { "application/json": { schema: PollResponse } },
			description: "Poll completed successfully",
		},
		500: {
			content: { "application/json": { schema: ErrorResponse } },
			description: "Poll job failed",
		},
		503: {
			content: { "application/json": { schema: ServerNotReady } },
			description: "Server not ready (database not initialized)",
		},
	},
});

const digestRoute = createRoute({
	method: "post",
	path: "/digest",
	summary: "Trigger a digest email",
	description:
		"Queries the change log for the last 24 hours and sends an email digest via Resend. Skips sending if there are no changes.",
	tags: ["Operations"],
	responses: {
		200: {
			content: { "application/json": { schema: DigestResponse } },
			description: "Digest completed (email sent, or no changes to report)",
		},
		500: {
			content: {
				"application/json": {
					schema: DigestResponse.extend({ error: z.string() }).or(
						ErrorResponse,
					),
				},
			},
			description: "Digest job failed or email send failed",
		},
		503: {
			content: { "application/json": { schema: ServerNotReady } },
			description: "Server not ready (database not initialized)",
		},
	},
});

// ─── Handlers ────────────────────────────────────────────────────────────────

app.openapi(healthRoute, (c) => {
	return c.json({
		status: "ok" as const,
		uptime: process.uptime(),
		...(lastPollAt !== undefined && { lastPollAt }),
		...(lastDigestAt !== undefined && { lastDigestAt }),
	});
});

app.openapi(pollRoute, async (c) => {
	if (!db) return c.json({ error: "Server not ready" as const }, 503);
	try {
		const result = await _pollRunner(db, shopifyClient);
		if (result.success) lastPollAt = new Date().toISOString();
		return c.json(result, 200);
	} catch (error) {
		console.error("POST /poll failed", error);
		return c.json({ error: "Poll job failed" }, 500);
	}
});

app.openapi(digestRoute, async (c) => {
	if (!db) return c.json({ error: "Server not ready" as const }, 503);
	try {
		const result = await _digestRunner(db);
		if (result.emailSent || result.changeCount === 0) {
			lastDigestAt = new Date().toISOString();
			return c.json(result, 200);
		}
		// changeCount > 0 but emailSent: false means the send failed
		return c.json({ ...result, error: "Email send failed" }, 500);
	} catch (error) {
		console.error("POST /digest failed", error);
		return c.json({ error: "Digest job failed" }, 500);
	}
});

// ─── Spec + UI ───────────────────────────────────────────────────────────────

app.doc("/openapi.json", {
	openapi: "3.0.0",
	info: {
		title: "Shopify Sync API",
		version: "1.0.0",
		description:
			"Internal API for the Shopify store monitor service. Exposes manual triggers for the poll and digest cron jobs, plus a health check.",
	},
});

app.get("/docs", swaggerUI({ url: "/openapi.json" }));

// ─── Server bootstrap ────────────────────────────────────────────────────────

export function startServer(): void {
	const config = buildConfig();

	try {
		db = initDb(config.DATABASE_PATH);
	} catch (error) {
		console.error("Fatal: failed to initialize database", error);
		process.exit(1);
	}

	console.log(`shopify-sync starting on port ${config.PORT}`);
	console.log(
		"  scheduling: POST /poll and POST /digest via external cron (e.g. K8s CronJob)",
	);

	Bun.serve({
		port: config.PORT,
		fetch: app.fetch,
	});

	console.log(`shopify-sync listening on http://localhost:${config.PORT}`);
	console.log(`  openapi spec: http://localhost:${config.PORT}/openapi.json`);
	console.log(`  swagger ui:   http://localhost:${config.PORT}/docs`);
}
