import { describe, expect, it } from "bun:test";
import {
	detectInventoryChanges,
	detectProductChanges,
} from "../shopify/diff-engine";
import type { InventoryItem, Product } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProduct(overrides: Partial<Product> = {}): Product {
	return {
		id: 0,
		shopify_product_id: "prod-001",
		title: "Test Product",
		handle: "test-product",
		status: "active",
		snapshotted_at: "2024-01-01T00:00:00.000Z",
		...overrides,
	};
}

function makeInventoryItem(
	overrides: Partial<InventoryItem> = {},
): InventoryItem {
	return {
		id: 0,
		shopify_variant_id: "var-001",
		shopify_product_id: "prod-001",
		title: "Default Title",
		quantity: 10,
		snapshotted_at: "2024-01-01T00:00:00.000Z",
		...overrides,
	};
}

// ─── detectProductChanges ─────────────────────────────────────────────────────

describe("detectProductChanges", () => {
	it("should flag a new product as added when it does not exist in the previous snapshot", () => {
		const current = [
			makeProduct({ shopify_product_id: "prod-new", title: "Brand New" }),
		];
		const previous: Product[] = [];

		const changes = detectProductChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("added");
		expect(changes[0].shopify_product_id).toBe("prod-new");
		expect(changes[0].product_title).toBe("Brand New");
	});

	it("should flag a missing product as deleted when it was in the previous snapshot but not in current", () => {
		const previous = [
			makeProduct({ shopify_product_id: "prod-gone", title: "Old Product" }),
			makeProduct({ shopify_product_id: "prod-stay", title: "Still Here" }),
		];
		const current = [
			makeProduct({ shopify_product_id: "prod-stay", title: "Still Here" }),
		];

		const changes = detectProductChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("deleted");
		expect(changes[0].shopify_product_id).toBe("prod-gone");
		expect(changes[0].product_title).toBe("Old Product");
	});

	it("should flag a title change when the same product has a different title", () => {
		const previous = [makeProduct({ title: "Old Title" })];
		const current = [makeProduct({ title: "New Title" })];

		const changes = detectProductChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("title_changed");
		expect(changes[0].old_value).toBe("Old Title");
		expect(changes[0].new_value).toBe("New Title");
	});

	it("should flag a status change with old_value and new_value when product status transitions", () => {
		const previous = [makeProduct({ status: "active" })];
		const current = [makeProduct({ status: "draft" })];

		const changes = detectProductChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("status_changed");
		expect(changes[0].old_value).toBe("active");
		expect(changes[0].new_value).toBe("draft");
		expect(changes[0].shopify_product_id).toBe("prod-001");
	});

	it("should return no changes when current and previous snapshots are identical", () => {
		const product = makeProduct();
		const changes = detectProductChanges([product], [product]);
		expect(changes).toHaveLength(0);
	});

	it("should detect both a title change and a status change as separate entries when both change at once", () => {
		const previous = [makeProduct({ title: "Old Title", status: "active" })];
		const current = [makeProduct({ title: "New Title", status: "archived" })];

		const changes = detectProductChanges(current, previous);

		const types = changes.map((c) => c.change_type);
		expect(types).toContain("title_changed");
		expect(types).toContain("status_changed");
	});

	it("should detect multiple changes across multiple products in the same call", () => {
		const previous = [
			makeProduct({ shopify_product_id: "prod-A", title: "A" }),
			makeProduct({ shopify_product_id: "prod-B", title: "B" }),
		];
		const current = [
			makeProduct({ shopify_product_id: "prod-A", title: "A Updated" }),
			makeProduct({ shopify_product_id: "prod-C", title: "C New" }),
		];

		const changes = detectProductChanges(current, previous);

		const types = changes.map((c) => c.change_type);
		expect(types).toContain("title_changed"); // prod-A title changed
		expect(types).toContain("deleted"); // prod-B gone
		expect(types).toContain("added"); // prod-C new
	});
});

// ─── detectProductChanges — edge cases ────────────────────────────────────────

describe("detectProductChanges — edge cases", () => {
	it("should treat all products as added when previous snapshot is empty (first run)", () => {
		const current = [
			makeProduct({ shopify_product_id: "prod-1", title: "First" }),
			makeProduct({ shopify_product_id: "prod-2", title: "Second" }),
		];

		const changes = detectProductChanges(current, []);

		expect(changes).toHaveLength(2);
		expect(changes.every((c) => c.change_type === "added")).toBe(true);
	});

	it("should NOT mark everything as deleted when current list is empty — empty current is treated as a no-op (likely API error)", () => {
		const previous = [
			makeProduct({ shopify_product_id: "prod-1", title: "Exists" }),
		];

		const changes = detectProductChanges([], previous);

		// Empty current from Shopify likely means an API error — should not delete everything
		expect(changes).toHaveLength(0);
	});
});

// ─── detectInventoryChanges ───────────────────────────────────────────────────

describe("detectInventoryChanges", () => {
	it("should flag a variant as out_of_stock when quantity drops to 0 from a positive number", () => {
		const previous = [makeInventoryItem({ quantity: 3 })];
		const current = [makeInventoryItem({ quantity: 0 })];

		const changes = detectInventoryChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("out_of_stock");
		expect(changes[0].shopify_variant_id).toBe("var-001");
		expect(changes[0].shopify_product_id).toBe("prod-001");
	});

	it("should NOT flag out_of_stock when quantity was already 0 in the previous snapshot", () => {
		const previous = [makeInventoryItem({ quantity: 0 })];
		const current = [makeInventoryItem({ quantity: 0 })];

		const changes = detectInventoryChanges(current, previous);

		expect(changes).toHaveLength(0);
	});

	it("should flag a variant as low_stock when quantity drops into the 1-5 range from above 5", () => {
		const previous = [makeInventoryItem({ quantity: 10 })];
		const current = [makeInventoryItem({ quantity: 4 })];

		const changes = detectInventoryChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("low_stock");
	});

	it("should NOT flag low_stock when quantity was already within 1-5 in the previous snapshot", () => {
		const previous = [makeInventoryItem({ quantity: 3 })];
		const current = [makeInventoryItem({ quantity: 5 })];

		const changes = detectInventoryChanges(current, previous);

		// quantity stayed in the low range — not a new crossing event
		expect(changes).toHaveLength(0);
	});

	it("should flag low_stock at the boundary: quantity drops from 6 to 5", () => {
		const previous = [makeInventoryItem({ quantity: 6 })];
		const current = [makeInventoryItem({ quantity: 5 })];

		const changes = detectInventoryChanges(current, previous);

		expect(changes).toHaveLength(1);
		expect(changes[0].change_type).toBe("low_stock");
	});

	it("should include product_title and variant_title in the returned ChangeLogEntry", () => {
		const previous = [
			makeInventoryItem({
				quantity: 10,
				shopify_product_id: "prod-001",
				title: "Size M",
			}),
		];
		const current = [
			makeInventoryItem({
				quantity: 0,
				shopify_product_id: "prod-001",
				title: "Size M",
			}),
		];

		const changes = detectInventoryChanges(current, previous);

		expect(changes[0].variant_title).toBe("Size M");
		expect(changes[0].shopify_product_id).toBe("prod-001");
	});

	it("should return no changes when inventory levels are unchanged and above thresholds", () => {
		const item = makeInventoryItem({ quantity: 20 });
		const changes = detectInventoryChanges([item], [item]);
		expect(changes).toHaveLength(0);
	});

	it("should return no changes when previous snapshot is empty (first run — no inventory alerts)", () => {
		const current = [
			makeInventoryItem({ shopify_variant_id: "var-001", quantity: 0 }),
			makeInventoryItem({ shopify_variant_id: "var-002", quantity: 3 }),
		];

		const changes = detectInventoryChanges(current, []);

		// On first run there is no previous baseline — nothing to flag
		expect(changes).toHaveLength(0);
	});
});
