import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChangeLogEntry } from "../types";

// sendDigestEmail is a real named export — mock.module works for it
const mockSendDigestEmail = mock(async (_changes: ChangeLogEntry[]) => {});

mock.module("../email/index", () => ({
	sendDigestEmail: mockSendDigestEmail,
}));

// ─── Module under test ───────────────────────────────────────────────────────
import { runDigestJob } from "../cron/digest";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TEST_ENV = {
	SHOPIFY_SHOP_DOMAIN: "test-store.myshopify.com",
	SHOPIFY_ACCESS_TOKEN: "shpat_test",
	RESEND_API_KEY: "re_test",
	RESEND_FROM_EMAIL: "from@example.com",
	RESEND_TO_EMAIL: "to@example.com",
};

function makeEntry(
	overrides: Partial<ChangeLogEntry> & {
		change_type: ChangeLogEntry["change_type"];
	},
): ChangeLogEntry {
	return {
		id: 1,
		shopify_product_id: "prod-001",
		shopify_variant_id: null,
		product_title: "Sample Product",
		variant_title: null,
		old_value: null,
		new_value: null,
		detected_at: "2026-03-12T07:00:00.000Z",
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runDigestJob()", () => {
	const mockGetRecentChanges = mock(() => [] as ChangeLogEntry[]);
	const mockDb = { getRecentChanges: mockGetRecentChanges };

	beforeEach(() => {
		for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
		mockGetRecentChanges.mockClear();
		mockSendDigestEmail.mockClear();
	});

	afterEach(() => {
		for (const k of Object.keys(TEST_ENV)) delete process.env[k];
	});

	// ─── Happy path: changes present ─────────────────────────────────────────

	it("should query change_log for entries in the last 24 hours", async () => {
		mockGetRecentChanges.mockImplementation(() => [
			makeEntry({ change_type: "added" }),
		]);

		await runDigestJob(mockDb);

		expect(mockGetRecentChanges).toHaveBeenCalledWith(expect.any(Date));

		// The since date passed to getRecentChanges should be approximately 24h ago
		const calls = mockGetRecentChanges.mock.calls as unknown as [[Date]];
		const sinceArg = calls[0][0];
		const ageMs = Date.now() - sinceArg.getTime();
		const twentyFourHoursMs = 24 * 60 * 60 * 1000;
		// Allow a 5-second tolerance for test execution time
		expect(ageMs).toBeGreaterThan(twentyFourHoursMs - 5_000);
		expect(ageMs).toBeLessThan(twentyFourHoursMs + 5_000);
	});

	it("should call sendDigestEmail with the changes when changes are present", async () => {
		const changes = [
			makeEntry({ change_type: "added", product_title: "New Shoes" }),
			makeEntry({
				change_type: "out_of_stock",
				product_title: "Old Boots",
				id: 2,
			}),
		];
		mockGetRecentChanges.mockImplementation(() => changes);

		await runDigestJob(mockDb);

		expect(mockSendDigestEmail).toHaveBeenCalledTimes(1);
		const passedChanges = mockSendDigestEmail.mock
			.calls[0][0] as ChangeLogEntry[];
		expect(passedChanges).toHaveLength(2);
		expect(passedChanges[0].product_title).toBe("New Shoes");
	});

	it("should return { changeCount, emailSent: true } when changes are found and email is sent", async () => {
		mockGetRecentChanges.mockImplementation(() => [
			makeEntry({ change_type: "deleted" }),
			makeEntry({ change_type: "low_stock", id: 2 }),
		]);

		const result = await runDigestJob(mockDb);

		expect(result.changeCount).toBe(2);
		expect(result.emailSent).toBe(true);
	});

	// ─── Skip path: no changes ────────────────────────────────────────────────

	it("should NOT call sendDigestEmail when no changes are found", async () => {
		mockGetRecentChanges.mockImplementation(() => []);

		await runDigestJob(mockDb);

		expect(mockSendDigestEmail).not.toHaveBeenCalled();
	});

	it("should return { changeCount: 0, emailSent: false } when no changes are found", async () => {
		mockGetRecentChanges.mockImplementation(() => []);

		const result = await runDigestJob(mockDb);

		expect(result.changeCount).toBe(0);
		expect(result.emailSent).toBe(false);
	});

	// ─── Error handling ───────────────────────────────────────────────────────

	it("should not throw when sendDigestEmail rejects — errors are caught internally", async () => {
		mockGetRecentChanges.mockImplementation(() => [
			makeEntry({ change_type: "added" }),
		]);
		mockSendDigestEmail.mockImplementation(async () => {
			throw new Error("Resend API failure");
		});

		// Must not throw — the job catches and logs errors to avoid crashing the process
		await expect(runDigestJob(mockDb)).resolves.toMatchObject({
			emailSent: false,
		});
	});

	it("should return emailSent: false when sendDigestEmail throws", async () => {
		mockGetRecentChanges.mockImplementation(() => [
			makeEntry({ change_type: "added" }),
		]);
		mockSendDigestEmail.mockImplementation(async () => {
			throw new Error("Network error");
		});

		const result = await runDigestJob(mockDb);

		expect(result.emailSent).toBe(false);
		expect(result.changeCount).toBe(1);
	});
});
