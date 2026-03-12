import { Database } from "bun:sqlite";
import type { ChangeLogEntry, InventoryItem, Product } from "../types";

export interface Db {
	insertProduct(product: Omit<Product, "id">): void;
	insertInventory(item: Omit<InventoryItem, "id">): void;
	insertChangeLog(entry: Omit<ChangeLogEntry, "id">): void;
	getLatestProductSnapshot(shopifyProductId: string): Product | null;
	getLatestInventorySnapshot(shopifyVariantId: string): InventoryItem | null;
	getRecentChanges(since: Date): ChangeLogEntry[];
	getAllLatestProducts(): Product[];
	getAllLatestInventory(): InventoryItem[];
	transaction(fn: () => void): void;
}

export function initDb(path: string): Db {
	const sqlite = new Database(path);

	sqlite.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      handle TEXT NOT NULL,
      status TEXT NOT NULL,
      snapshotted_at TEXT NOT NULL
    )
  `);

	sqlite.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_variant_id TEXT NOT NULL,
      shopify_product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      snapshotted_at TEXT NOT NULL
    )
  `);

	sqlite.run(`
    CREATE TABLE IF NOT EXISTS change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_type TEXT NOT NULL,
      shopify_product_id TEXT NOT NULL,
      shopify_variant_id TEXT,
      product_title TEXT,
      variant_title TEXT,
      old_value TEXT,
      new_value TEXT,
      detected_at TEXT NOT NULL
    )
  `);

	const stmtInsertProduct = sqlite.prepare(
		"INSERT INTO products (shopify_product_id, title, handle, status, snapshotted_at) VALUES (?, ?, ?, ?, ?)",
	);

	const stmtInsertInventory = sqlite.prepare(
		"INSERT INTO inventory (shopify_variant_id, shopify_product_id, title, quantity, snapshotted_at) VALUES (?, ?, ?, ?, ?)",
	);

	const stmtInsertChangeLog = sqlite.prepare(
		"INSERT INTO change_log (change_type, shopify_product_id, shopify_variant_id, product_title, variant_title, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	);

	const stmtGetLatestProduct = sqlite.prepare(
		"SELECT * FROM products WHERE shopify_product_id = ? ORDER BY snapshotted_at DESC LIMIT 1",
	);

	const stmtGetLatestInventory = sqlite.prepare(
		"SELECT * FROM inventory WHERE shopify_variant_id = ? ORDER BY snapshotted_at DESC LIMIT 1",
	);

	const stmtGetRecentChanges = sqlite.prepare(
		"SELECT * FROM change_log WHERE detected_at > ? ORDER BY detected_at ASC",
	);

	const stmtGetAllLatestProducts = sqlite.prepare(`
		SELECT p.* FROM products p
		INNER JOIN (
			SELECT shopify_product_id, MAX(snapshotted_at) as max_at
			FROM products GROUP BY shopify_product_id
		) latest ON p.shopify_product_id = latest.shopify_product_id
			AND p.snapshotted_at = latest.max_at
	`);

	const stmtGetAllLatestInventory = sqlite.prepare(`
		SELECT i.* FROM inventory i
		INNER JOIN (
			SELECT shopify_variant_id, MAX(snapshotted_at) as max_at
			FROM inventory GROUP BY shopify_variant_id
		) latest ON i.shopify_variant_id = latest.shopify_variant_id
			AND i.snapshotted_at = latest.max_at
	`);

	return {
		insertProduct(product) {
			stmtInsertProduct.run(
				product.shopify_product_id,
				product.title,
				product.handle,
				product.status,
				product.snapshotted_at,
			);
		},
		insertInventory(item) {
			stmtInsertInventory.run(
				item.shopify_variant_id,
				item.shopify_product_id,
				item.title,
				item.quantity,
				item.snapshotted_at,
			);
		},
		insertChangeLog(entry) {
			stmtInsertChangeLog.run(
				entry.change_type,
				entry.shopify_product_id,
				entry.shopify_variant_id,
				entry.product_title,
				entry.variant_title,
				entry.old_value,
				entry.new_value,
				entry.detected_at,
			);
		},
		getLatestProductSnapshot(shopifyProductId) {
			return (
				(stmtGetLatestProduct.get(shopifyProductId) as Product | null) ?? null
			);
		},
		getLatestInventorySnapshot(shopifyVariantId) {
			return (
				(stmtGetLatestInventory.get(
					shopifyVariantId,
				) as InventoryItem | null) ?? null
			);
		},
		getRecentChanges(since) {
			return stmtGetRecentChanges.all(since.toISOString()) as ChangeLogEntry[];
		},
		getAllLatestProducts() {
			return stmtGetAllLatestProducts.all() as Product[];
		},
		getAllLatestInventory() {
			return stmtGetAllLatestInventory.all() as InventoryItem[];
		},
		transaction(fn) {
			sqlite.transaction(fn)();
		},
	};
}
