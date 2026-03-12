import { beforeEach, describe, expect, it } from "bun:test";
import type { Db } from "../db/index";

// Import the db module — all functions operate on a Db instance created by initDb()
import { initDb } from "../db/index";
import type { ChangeType } from "../types";

describe("database module", () => {
	let db: Db;

	beforeEach(() => {
		// Use in-memory SQLite for each test — fresh isolated state
		db = initDb(":memory:");
	});

	// ─── Schema ────────────────────────────────────────────────────────────────

	it("creates schema idempotently — calling initDb() twice does not throw", () => {
		expect(() => {
			initDb(":memory:");
			initDb(":memory:");
		}).not.toThrow();
	});

	it("creates all three tables on init", () => {
		// If tables don't exist, these inserts would throw
		expect(() => {
			db.insertProduct({
				shopify_product_id: "1",
				title: "Test",
				handle: "test",
				status: "active",
				snapshotted_at: new Date().toISOString(),
			});
		}).not.toThrow();
	});

	// ─── Products ──────────────────────────────────────────────────────────────

	it("insertProduct() inserts a row and it can be retrieved", () => {
		const now = new Date().toISOString();
		db.insertProduct({
			shopify_product_id: "prod-001",
			title: "My Product",
			handle: "my-product",
			status: "active",
			snapshotted_at: now,
		});

		const row = db.getLatestProductSnapshot("prod-001");
		expect(row).not.toBeNull();
		expect(row?.shopify_product_id).toBe("prod-001");
		expect(row?.title).toBe("My Product");
		expect(row?.handle).toBe("my-product");
		expect(row?.status).toBe("active");
	});

	it("getLatestProductSnapshot() returns the MOST RECENT row when multiple snapshots exist for the same product", () => {
		const t1 = "2024-01-01T00:00:00.000Z";
		const t2 = "2024-01-02T00:00:00.000Z";
		const t3 = "2024-01-03T00:00:00.000Z";

		db.insertProduct({
			shopify_product_id: "prod-001",
			title: "Old Title",
			handle: "my-product",
			status: "active",
			snapshotted_at: t1,
		});
		db.insertProduct({
			shopify_product_id: "prod-001",
			title: "Newer Title",
			handle: "my-product",
			status: "active",
			snapshotted_at: t2,
		});
		db.insertProduct({
			shopify_product_id: "prod-001",
			title: "Latest Title",
			handle: "my-product",
			status: "active",
			snapshotted_at: t3,
		});

		const row = db.getLatestProductSnapshot("prod-001");
		expect(row?.title).toBe("Latest Title");
		expect(row?.snapshotted_at).toBe(t3);
	});

	it("getLatestProductSnapshot() returns the right row for each product — NOT a global MAX", () => {
		const early = "2024-01-01T00:00:00.000Z";
		const late = "2024-01-05T00:00:00.000Z";

		// prod-A has only an early snapshot
		db.insertProduct({
			shopify_product_id: "prod-A",
			title: "Product A",
			handle: "prod-a",
			status: "active",
			snapshotted_at: early,
		});
		// prod-B has a later snapshot
		db.insertProduct({
			shopify_product_id: "prod-B",
			title: "Product B",
			handle: "prod-b",
			status: "draft",
			snapshotted_at: late,
		});

		const rowA = db.getLatestProductSnapshot("prod-A");
		const rowB = db.getLatestProductSnapshot("prod-B");

		expect(rowA?.shopify_product_id).toBe("prod-A");
		expect(rowA?.title).toBe("Product A");

		expect(rowB?.shopify_product_id).toBe("prod-B");
		expect(rowB?.title).toBe("Product B");
	});

	it("getLatestProductSnapshot() returns null for unknown product id", () => {
		const row = db.getLatestProductSnapshot("nonexistent");
		expect(row).toBeNull();
	});

	// ─── Inventory ─────────────────────────────────────────────────────────────

	it("insertInventory() inserts a row and it can be retrieved", () => {
		const now = new Date().toISOString();
		db.insertInventory({
			shopify_variant_id: "var-001",
			shopify_product_id: "prod-001",
			title: "Default Variant",
			quantity: 10,
			snapshotted_at: now,
		});

		const row = db.getLatestInventorySnapshot("var-001");
		expect(row).not.toBeNull();
		expect(row?.shopify_variant_id).toBe("var-001");
		expect(row?.quantity).toBe(10);
		expect(row?.title).toBe("Default Variant");
	});

	it("getLatestInventorySnapshot() returns the most recent row for the same variant", () => {
		const t1 = "2024-01-01T00:00:00.000Z";
		const t2 = "2024-01-02T00:00:00.000Z";

		db.insertInventory({
			shopify_variant_id: "var-001",
			shopify_product_id: "prod-001",
			title: "Variant",
			quantity: 5,
			snapshotted_at: t1,
		});
		db.insertInventory({
			shopify_variant_id: "var-001",
			shopify_product_id: "prod-001",
			title: "Variant",
			quantity: 0,
			snapshotted_at: t2,
		});

		const row = db.getLatestInventorySnapshot("var-001");
		expect(row?.quantity).toBe(0);
		expect(row?.snapshotted_at).toBe(t2);
	});

	it("getLatestInventorySnapshot() returns the right row for each variant — NOT a global MAX", () => {
		const early = "2024-01-01T00:00:00.000Z";
		const late = "2024-01-05T00:00:00.000Z";

		db.insertInventory({
			shopify_variant_id: "var-A",
			shopify_product_id: "prod-001",
			title: "Variant A",
			quantity: 3,
			snapshotted_at: early,
		});
		db.insertInventory({
			shopify_variant_id: "var-B",
			shopify_product_id: "prod-001",
			title: "Variant B",
			quantity: 7,
			snapshotted_at: late,
		});

		const rowA = db.getLatestInventorySnapshot("var-A");
		const rowB = db.getLatestInventorySnapshot("var-B");

		expect(rowA?.shopify_variant_id).toBe("var-A");
		expect(rowA?.quantity).toBe(3);

		expect(rowB?.shopify_variant_id).toBe("var-B");
		expect(rowB?.quantity).toBe(7);
	});

	it("getLatestInventorySnapshot() returns null for unknown variant id", () => {
		const row = db.getLatestInventorySnapshot("nonexistent");
		expect(row).toBeNull();
	});

	// ─── Change Log ────────────────────────────────────────────────────────────

	it("insertChangeLog() with change_type 'added' can be retrieved by getRecentChanges()", () => {
		const past = new Date("2024-01-01T00:00:00.000Z");
		db.insertChangeLog({
			change_type: "added",
			shopify_product_id: "prod-001",
			shopify_variant_id: null,
			product_title: "New Product",
			variant_title: null,
			old_value: null,
			new_value: "New Product",
			detected_at: "2024-01-02T00:00:00.000Z",
		});

		const changes = db.getRecentChanges(past);
		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("added");
		expect(changes[0].product_title).toBe("New Product");
	});

	const changeTypes: ChangeType[] = [
		"added",
		"deleted",
		"title_changed",
		"status_changed",
		"low_stock",
		"out_of_stock",
	];

	it("insertChangeLog() supports all six change types", () => {
		const since = new Date("2024-01-01T00:00:00.000Z");
		const detectedAt = "2024-01-02T00:00:00.000Z";

		for (const change_type of changeTypes) {
			db.insertChangeLog({
				change_type,
				shopify_product_id: "prod-001",
				shopify_variant_id: null,
				product_title: "A Product",
				variant_title: null,
				old_value: "old",
				new_value: "new",
				detected_at: detectedAt,
			});
		}

		const changes = db.getRecentChanges(since);
		expect(changes).toHaveLength(changeTypes.length);

		const returnedTypes = new Set(changes.map((c) => c.change_type));
		for (const t of changeTypes) {
			expect(returnedTypes.has(t)).toBe(true);
		}
	});

	it("getRecentChanges() only returns entries AFTER the since date", () => {
		const before = "2024-01-01T00:00:00.000Z";
		const cutoff = new Date("2024-01-02T00:00:00.000Z");
		const after = "2024-01-03T00:00:00.000Z";

		db.insertChangeLog({
			change_type: "added",
			shopify_product_id: "prod-001",
			shopify_variant_id: null,
			product_title: "Old Entry",
			variant_title: null,
			old_value: null,
			new_value: null,
			detected_at: before,
		});

		db.insertChangeLog({
			change_type: "deleted",
			shopify_product_id: "prod-002",
			shopify_variant_id: null,
			product_title: "New Entry",
			variant_title: null,
			old_value: null,
			new_value: null,
			detected_at: after,
		});

		const changes = db.getRecentChanges(cutoff);
		expect(changes).toHaveLength(1);
		expect(changes[0].product_title).toBe("New Entry");
		expect(changes[0].change_type).toBe("deleted");
	});

	it("getRecentChanges() returns empty array when no entries after since date", () => {
		const future = new Date("2099-01-01T00:00:00.000Z");
		db.insertChangeLog({
			change_type: "added",
			shopify_product_id: "prod-001",
			shopify_variant_id: null,
			product_title: "Product",
			variant_title: null,
			old_value: null,
			new_value: null,
			detected_at: "2024-01-01T00:00:00.000Z",
		});

		const changes = db.getRecentChanges(future);
		expect(changes).toHaveLength(0);
	});
});
