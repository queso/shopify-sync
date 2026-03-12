import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ChangeLogEntry } from "../types";

// Mock the Resend client before importing the email module
const mockSend = mock(async () => ({
	data: { id: "email-id-123" },
	error: null,
}));

mock.module("resend", () => ({
	Resend: class {
		emails = { send: mockSend };
	},
}));

import { formatDigestEmail, sendDigestEmail } from "../email/index";

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
		detected_at: "2024-03-12T07:00:00.000Z",
		...overrides,
	};
}

describe("email digest formatter", () => {
	beforeEach(() => {
		for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
	});

	afterEach(() => {
		for (const k of Object.keys(TEST_ENV)) delete process.env[k];
	});

	// ─── formatDigestEmail ──────────────────────────────────────────────────────

	it("formatDigestEmail() with only new products renders correct section", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({
				change_type: "added",
				product_title: "Fresh Kicks",
				new_value: "Fresh Kicks",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("Fresh Kicks");
		expect(text).toContain("Fresh Kicks");
		// Should include an "added" / "new" section heading
		expect(html.toLowerCase()).toMatch(/new product|added/);
	});

	it("formatDigestEmail() with only deleted products renders correct section", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({ change_type: "deleted", product_title: "Discontinued Item" }),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("Discontinued Item");
		expect(text).toContain("Discontinued Item");
		expect(html.toLowerCase()).toMatch(/deleted|removed/);
	});

	it("formatDigestEmail() with title changes renders old → new title", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({
				change_type: "title_changed",
				product_title: "New Title",
				old_value: "Old Title",
				new_value: "New Title",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("Old Title");
		expect(html).toContain("New Title");
		expect(text).toContain("Old Title");
		expect(text).toContain("New Title");
	});

	it("formatDigestEmail() with status changes renders 'Product: active → draft'", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({
				change_type: "status_changed",
				product_title: "Status Product",
				old_value: "active",
				new_value: "draft",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("active");
		expect(html).toContain("draft");
		expect(text).toContain("active");
		expect(text).toContain("draft");
		expect(html).toContain("Status Product");
	});

	it("formatDigestEmail() with low_stock shows quantity remaining", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({
				change_type: "low_stock",
				product_title: "Running Low",
				variant_title: "Size M",
				shopify_variant_id: "var-001",
				new_value: "3",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("3");
		expect(text).toContain("3");
		// Should mention "left" quantity
		expect(html.toLowerCase()).toMatch(/left|remaining|low/);
	});

	it("formatDigestEmail() with out_of_stock shows OUT OF STOCK indicator", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({
				change_type: "out_of_stock",
				product_title: "Empty Shelves",
				variant_title: "Size L",
				shopify_variant_id: "var-002",
				new_value: "0",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("Empty Shelves");
		expect(html.toUpperCase()).toContain("OUT OF STOCK");
		expect(text.toUpperCase()).toContain("OUT OF STOCK");
	});

	it("formatDigestEmail() omits sections with zero items", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({ change_type: "added", product_title: "Only Added" }),
		];
		const { html } = formatDigestEmail(changes);

		// No deleted or inventory sections should appear
		expect(html.toLowerCase()).not.toMatch(/deleted product|removed product/);
		expect(html.toUpperCase()).not.toContain("OUT OF STOCK");
	});

	it("formatDigestEmail() with all change types renders all sections", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({ change_type: "added", product_title: "Added Product" }),
			makeEntry({ change_type: "deleted", product_title: "Deleted Product" }),
			makeEntry({
				change_type: "title_changed",
				product_title: "Renamed Product",
				old_value: "Old",
				new_value: "Renamed Product",
			}),
			makeEntry({
				change_type: "status_changed",
				product_title: "Status Product",
				old_value: "active",
				new_value: "draft",
			}),
			makeEntry({
				change_type: "low_stock",
				product_title: "Low Stock Item",
				shopify_variant_id: "var-1",
				new_value: "2",
			}),
			makeEntry({
				change_type: "out_of_stock",
				product_title: "OOS Item",
				shopify_variant_id: "var-2",
				new_value: "0",
			}),
		];
		const { html, text } = formatDigestEmail(changes);

		expect(html).toContain("Added Product");
		expect(html).toContain("Deleted Product");
		expect(html).toContain("Renamed Product");
		expect(html).toContain("Status Product");
		expect(html).toContain("Low Stock Item");
		expect(html).toContain("OOS Item");
		expect(text).toContain("Added Product");
		expect(text).toContain("OOS Item");
	});

	// ─── Subject line ──────────────────────────────────────────────────────────

	it("subject line format: 'ArcaneLayer Daily Report — [Date]'", () => {
		const changes: ChangeLogEntry[] = [
			makeEntry({ change_type: "added", product_title: "A Product" }),
		];
		const { subject } = formatDigestEmail(changes);

		expect(subject).toContain("ArcaneLayer");
		expect(subject).toMatch(/Daily Report/i);
		// Should include a date component (year is a reasonable proxy)
		expect(subject).toMatch(/\d{4}/);
	});

	// ─── sendDigestEmail ────────────────────────────────────────────────────────

	it("sendDigestEmail() returns early without calling Resend when changes list is empty", async () => {
		mockSend.mockClear();

		await sendDigestEmail([]);

		expect(mockSend).not.toHaveBeenCalled();
	});

	it("sendDigestEmail() calls Resend with correct from/to when changes are present", async () => {
		mockSend.mockClear();

		const changes: ChangeLogEntry[] = [
			makeEntry({ change_type: "added", product_title: "A Product" }),
		];

		await sendDigestEmail(changes);

		expect(mockSend).toHaveBeenCalledTimes(1);
		const callArg = mockSend.mock.calls[0][0] as Record<string, unknown>;
		expect(callArg.from).toBe("from@example.com");
		expect(callArg.to).toBe("to@example.com");
	});
});
