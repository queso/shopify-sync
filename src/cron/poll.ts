import type { Db } from "../db/index";
import {
	detectInventoryChanges,
	detectProductChanges,
} from "../shopify/diff-engine";
import type {
	InventoryItem,
	Product,
	ShopifyInventoryLevel,
	ShopifyProduct,
} from "../types";

export interface PollJobResult {
	productsPolled: number;
	changesDetected: number;
	success: boolean;
}

export interface ShopifyClientDeps {
	fetchAllProducts(): Promise<ShopifyProduct[]>;
	fetchLocationId(): Promise<number>;
	fetchInventoryLevels(
		inventoryItemIds: number[],
		locationId: number,
	): Promise<ShopifyInventoryLevel[]>;
}

function toDbProduct(
	sp: ShopifyProduct,
): Omit<Product, "id" | "snapshotted_at"> {
	return {
		shopify_product_id: sp.id,
		title: sp.title,
		handle: sp.handle,
		status: sp.status,
	};
}

function toDbInventory(
	level: ShopifyInventoryLevel,
	sp: ShopifyProduct,
): Omit<InventoryItem, "id" | "snapshotted_at"> | null {
	const variant = sp.variants.find(
		(v) => v.inventory_item_id === level.inventory_item_id,
	);
	if (!variant) return null;
	return {
		shopify_variant_id: variant.id,
		shopify_product_id: sp.id,
		title: variant.title,
		quantity: level.available,
	};
}

export async function runPollJob(
	db: Db,
	shopifyClient: ShopifyClientDeps,
): Promise<PollJobResult> {
	console.log(`poll: starting at ${new Date().toISOString()}`);

	let shopifyProducts: ShopifyProduct[];
	try {
		shopifyProducts = await shopifyClient.fetchAllProducts();
	} catch (error) {
		console.error("poll: failed to fetch products", error);
		return { productsPolled: 0, changesDetected: 0, success: false };
	}

	let locationId: number;
	try {
		locationId = await shopifyClient.fetchLocationId();
	} catch (error) {
		console.error("poll: failed to fetch location id", error);
		return {
			productsPolled: shopifyProducts.length,
			changesDetected: 0,
			success: false,
		};
	}

	const inventoryItemIds = shopifyProducts.flatMap((p) =>
		p.variants.map((v) => v.inventory_item_id),
	);

	let inventoryLevels: ShopifyInventoryLevel[];
	try {
		inventoryLevels = await shopifyClient.fetchInventoryLevels(
			inventoryItemIds,
			locationId,
		);
	} catch (error) {
		console.error("poll: failed to fetch inventory levels", error);
		return {
			productsPolled: shopifyProducts.length,
			changesDetected: 0,
			success: false,
		};
	}

	// Map Shopify types → DB types
	const snapshotTime = new Date().toISOString();
	const currentProducts: Product[] = shopifyProducts.map((sp) => ({
		id: 0,
		...toDbProduct(sp),
		snapshotted_at: snapshotTime,
	}));

	if (shopifyProducts.length === 0) {
		console.warn(
			"poll: fetchAllProducts returned empty list — possible API error, skipping write",
		);
	}

	const currentInventory: InventoryItem[] = inventoryLevels
		.map((level) => {
			for (const sp of shopifyProducts) {
				const mapped = toDbInventory(level, sp);
				if (mapped) return { id: 0, ...mapped, snapshotted_at: snapshotTime };
			}
			console.warn(
				`poll: inventory level for item_id=${level.inventory_item_id} matched no variant — skipped`,
			);
			return null;
		})
		.filter((item): item is InventoryItem => item !== null);

	// Read previous snapshots, diff, and write — all inside one transaction to prevent
	// duplicate change_log entries if two poll runs overlap.
	let allChanges: ReturnType<typeof detectProductChanges> = [];
	try {
		db.transaction(() => {
			const previousProducts = db.getAllLatestProducts();
			const previousInventory = db.getAllLatestInventory();

			const productChanges = detectProductChanges(
				currentProducts,
				previousProducts,
			);
			const inventoryChanges = detectInventoryChanges(
				currentInventory,
				previousInventory,
			);
			allChanges = [...productChanges, ...inventoryChanges];

			for (const product of currentProducts) {
				db.insertProduct(product);
			}
			for (const item of currentInventory) {
				db.insertInventory(item);
			}
			for (const change of allChanges) {
				db.insertChangeLog(change);
			}
		});
	} catch (error) {
		console.error("poll: failed to write to database", error);
		return {
			productsPolled: shopifyProducts.length,
			changesDetected: 0,
			success: false,
		};
	}

	console.log(
		`poll: completed at ${new Date().toISOString()} — ${shopifyProducts.length} product(s), ${allChanges.length} change(s)`,
	);

	return {
		productsPolled: shopifyProducts.length,
		changesDetected: allChanges.length,
		success: true,
	};
}
