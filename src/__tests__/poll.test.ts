import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { runPollJob } from "../cron/poll";
import type { Db } from "../db/index";
import type {
	ChangeLogEntry,
	InventoryItem,
	Product,
	ShopifyInventoryLevel,
	ShopifyProduct,
} from "../types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeShopifyProduct(
	overrides: Partial<ShopifyProduct> = {},
): ShopifyProduct {
	return {
		id: "prod-001",
		title: "Test Product",
		handle: "test-product",
		status: "active",
		variants: [
			{
				id: "var-001",
				product_id: "prod-001",
				title: "Default",
				inventory_item_id: 111,
				inventory_quantity: 10,
			},
		],
		...overrides,
	};
}

function makeInventoryLevel(
	overrides: Partial<ShopifyInventoryLevel> = {},
): ShopifyInventoryLevel {
	return {
		inventory_item_id: 111,
		location_id: 999,
		available: 10,
		...overrides,
	};
}

function makeDbProduct(overrides: Partial<Product> = {}): Product {
	return {
		id: 0,
		shopify_product_id: "prod-001",
		title: "Test Product",
		handle: "test-product",
		status: "active",
		snapshotted_at: "2026-03-12T00:00:00.000Z",
		...overrides,
	};
}

function _makeInventoryItem(
	overrides: Partial<InventoryItem> = {},
): InventoryItem {
	return {
		id: 0,
		shopify_variant_id: "var-001",
		shopify_product_id: "prod-001",
		title: "Default",
		quantity: 10,
		snapshotted_at: "2026-03-12T00:00:00.000Z",
		...overrides,
	};
}

// ─── Mock builders ────────────────────────────────────────────────────────────

function makeDb(overrides: Partial<Db> = {}): Db {
	return {
		insertProduct: mock(() => {}),
		insertInventory: mock(() => {}),
		insertChangeLog: mock(() => {}),
		getLatestProductSnapshot: mock(() => null as Product | null),
		getLatestInventorySnapshot: mock(() => null as InventoryItem | null),
		getRecentChanges: mock(() => [] as ChangeLogEntry[]),
		getAllLatestProducts: mock(() => [] as Product[]),
		getAllLatestInventory: mock(() => [] as InventoryItem[]),
		transaction: mock((fn: () => void) => fn()),
		...overrides,
	} as unknown as Db;
}

function makeShopifyClient(
	overrides: Partial<{
		fetchAllProducts: () => Promise<ShopifyProduct[]>;
		fetchLocationId: () => Promise<number>;
		fetchInventoryLevels: (
			inventoryItemIds: number[],
			locationId: number,
		) => Promise<ShopifyInventoryLevel[]>;
	}> = {},
) {
	return {
		fetchAllProducts: mock(async () => [] as ShopifyProduct[]),
		fetchLocationId: mock(async () => 999),
		fetchInventoryLevels: mock(async () => [] as ShopifyInventoryLevel[]),
		...overrides,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runPollJob()", () => {
	let consoleSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		consoleSpy = spyOn(console, "log").mockImplementation(() => {});
		spyOn(console, "error").mockImplementation(() => {});
	});

	// ─── Happy path ─────────────────────────────────────────────────────────

	describe("happy path", () => {
		it("should call fetchAllProducts on the shopify client", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
				fetchInventoryLevels: mock(async () => [makeInventoryLevel()]),
			});
			const db = makeDb();

			await runPollJob(db, shopifyClient);

			expect(shopifyClient.fetchAllProducts).toHaveBeenCalledTimes(1);
		});

		it("should call fetchLocationId and pass its result to fetchInventoryLevels", async () => {
			const locationId = 12345;
			const product = makeShopifyProduct();
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [product]),
				fetchLocationId: mock(async () => locationId),
				fetchInventoryLevels: mock(async () => [
					makeInventoryLevel({ location_id: locationId }),
				]),
			});
			const db = makeDb();

			await runPollJob(db, shopifyClient);

			expect(shopifyClient.fetchLocationId).toHaveBeenCalledTimes(1);
			const calls = shopifyClient.fetchInventoryLevels.mock
				.calls as unknown as [[number[], number]];
			expect(calls[0][1]).toBe(locationId);
		});

		it("should insert a product snapshot row for each fetched product", async () => {
			const products = [
				makeShopifyProduct({ id: "prod-001", title: "Shoes" }),
				makeShopifyProduct({
					id: "prod-002",
					title: "Boots",
					variants: [
						{
							id: "var-002",
							product_id: "prod-002",
							title: "Default",
							inventory_item_id: 222,
							inventory_quantity: 5,
						},
					],
				}),
			];
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => products),
			});
			const db = makeDb();

			await runPollJob(db, shopifyClient);

			expect(db.insertProduct).toHaveBeenCalledTimes(2);
		});

		it("should insert an inventory snapshot row for each mapped inventory level", async () => {
			const product = makeShopifyProduct({
				variants: [
					{
						id: "var-001",
						product_id: "prod-001",
						title: "S",
						inventory_item_id: 111,
						inventory_quantity: 10,
					},
					{
						id: "var-002",
						product_id: "prod-001",
						title: "M",
						inventory_item_id: 222,
						inventory_quantity: 5,
					},
				],
			});
			const levels = [
				makeInventoryLevel({ inventory_item_id: 111, available: 10 }),
				makeInventoryLevel({ inventory_item_id: 222, available: 5 }),
			];
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [product]),
				fetchInventoryLevels: mock(async () => levels),
			});
			const db = makeDb();

			await runPollJob(db, shopifyClient);

			expect(db.insertInventory).toHaveBeenCalledTimes(2);
		});

		it("should detect deleted products using getAllLatestProducts", async () => {
			// A product was in DB last time but is NOT returned from Shopify now → deleted
			const deletedProduct = makeDbProduct({
				shopify_product_id: "prod-gone",
				title: "Gone",
			});
			const currentProduct = makeShopifyProduct({ id: "prod-still-here" });

			const db = makeDb({
				getAllLatestProducts: mock(() => [
					deletedProduct,
					makeDbProduct({ shopify_product_id: "prod-still-here" }),
				]),
			});
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [currentProduct]),
				fetchInventoryLevels: mock(async () => [makeInventoryLevel()]),
			});

			const result = await runPollJob(db, shopifyClient);

			expect(result.changesDetected).toBeGreaterThanOrEqual(1);
			expect(db.insertChangeLog).toHaveBeenCalled();
		});

		it("should detect title changes", async () => {
			const previousProduct = makeDbProduct({ title: "Old Title" });
			const currentProducts = [makeShopifyProduct({ title: "New Title" })];

			const db = makeDb({
				getAllLatestProducts: mock(() => [previousProduct]),
			});
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => currentProducts),
			});

			await runPollJob(db, shopifyClient);

			expect(db.insertChangeLog).toHaveBeenCalled();
		});

		it("should return productsPolled equal to the number of fetched products", async () => {
			const products = [
				makeShopifyProduct({ id: "prod-001" }),
				makeShopifyProduct({
					id: "prod-002",
					variants: [
						{
							id: "var-002",
							product_id: "prod-002",
							title: "D",
							inventory_item_id: 222,
							inventory_quantity: 5,
						},
					],
				}),
				makeShopifyProduct({
					id: "prod-003",
					variants: [
						{
							id: "var-003",
							product_id: "prod-003",
							title: "D",
							inventory_item_id: 333,
							inventory_quantity: 5,
						},
					],
				}),
			];
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => products),
			});
			const db = makeDb();

			const result = await runPollJob(db, shopifyClient);

			expect(result.productsPolled).toBe(3);
		});

		it("should return success: true and changesDetected: 0 when nothing changed", async () => {
			const product = makeShopifyProduct();
			const dbProduct = makeDbProduct({
				title: "Test Product",
				status: "active",
			});
			const db = makeDb({
				getAllLatestProducts: mock(() => [dbProduct]),
			});
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [product]),
			});

			const result = await runPollJob(db, shopifyClient);

			expect(result.success).toBe(true);
			expect(result.changesDetected).toBe(0);
		});

		it("should wrap all DB writes in a single transaction", async () => {
			const transactionFn = mock((fn: () => void) => fn());
			const db = makeDb({ transaction: transactionFn });
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
				fetchInventoryLevels: mock(async () => [makeInventoryLevel()]),
			});

			await runPollJob(db, shopifyClient);

			expect(transactionFn).toHaveBeenCalledTimes(1);
		});
	});

	// ─── Error handling: Shopify fetch failures ──────────────────────────────

	describe("error handling — Shopify fetch failure", () => {
		it("should not throw when fetchAllProducts rejects", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => {
					throw new Error("Shopify API unreachable");
				}),
			});
			const db = makeDb();

			await expect(runPollJob(db, shopifyClient)).resolves.toBeDefined();
		});

		it("should return success: false when fetchAllProducts throws", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => {
					throw new Error("Rate limited");
				}),
			});
			const db = makeDb();

			const result = await runPollJob(db, shopifyClient);
			expect(result.success).toBe(false);
		});

		it("should not throw when fetchLocationId rejects", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
				fetchLocationId: mock(async () => {
					throw new Error("Location fetch failed");
				}),
			});
			const db = makeDb();

			await expect(runPollJob(db, shopifyClient)).resolves.toBeDefined();
		});

		it("should return success: false when fetchLocationId throws", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
				fetchLocationId: mock(async () => {
					throw new Error("Unauthorized");
				}),
			});
			const db = makeDb();

			const result = await runPollJob(db, shopifyClient);
			expect(result.success).toBe(false);
		});

		it("should return success: false when fetchInventoryLevels throws", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
				fetchInventoryLevels: mock(async () => {
					throw new Error("Inventory API error");
				}),
			});
			const db = makeDb();

			const result = await runPollJob(db, shopifyClient);
			expect(result.success).toBe(false);
		});

		it("should not write to the DB when a Shopify fetch fails", async () => {
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => {
					throw new Error("Network error");
				}),
			});
			const db = makeDb();

			await runPollJob(db, shopifyClient);

			expect(db.insertProduct).not.toHaveBeenCalled();
			expect(db.insertInventory).not.toHaveBeenCalled();
			expect(db.insertChangeLog).not.toHaveBeenCalled();
		});
	});

	// ─── Error handling: DB write failures ──────────────────────────────────

	describe("error handling — DB write failure", () => {
		it("should not throw when the DB transaction throws", async () => {
			const db = makeDb({
				transaction: mock((_fn: () => void) => {
					throw new Error("SQLITE_BUSY");
				}),
			});
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
			});

			await expect(runPollJob(db, shopifyClient)).resolves.toBeDefined();
		});

		it("should return success: false when the DB transaction throws", async () => {
			const db = makeDb({
				transaction: mock((_fn: () => void) => {
					throw new Error("Database locked");
				}),
			});
			const shopifyClient = makeShopifyClient({
				fetchAllProducts: mock(async () => [makeShopifyProduct()]),
			});

			const result = await runPollJob(db, shopifyClient);
			expect(result.success).toBe(false);
		});
	});

	// ─── Logging ────────────────────────────────────────────────────────────

	describe("logging", () => {
		it("should log poll start to stdout", async () => {
			const db = makeDb();
			const shopifyClient = makeShopifyClient();

			await runPollJob(db, shopifyClient);

			expect(consoleSpy).toHaveBeenCalled();
		});

		it("should log poll completion with a timestamp", async () => {
			const db = makeDb();
			const shopifyClient = makeShopifyClient();

			await runPollJob(db, shopifyClient);

			expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
		});
	});
});
