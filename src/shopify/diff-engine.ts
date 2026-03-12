import type {
	ChangeLogEntry,
	ChangeType,
	InventoryItem,
	Product,
} from "../types";

const LOW_STOCK_THRESHOLD = 5;
const OUT_OF_STOCK = 0;

function makeEntry(
	change_type: ChangeType,
	shopify_product_id: string,
	fields: Partial<
		Omit<
			ChangeLogEntry,
			"id" | "change_type" | "shopify_product_id" | "detected_at"
		>
	> = {},
): ChangeLogEntry {
	return {
		id: 0,
		change_type,
		shopify_product_id,
		shopify_variant_id: null,
		product_title: null,
		variant_title: null,
		old_value: null,
		new_value: null,
		detected_at: new Date().toISOString(),
		...fields,
	};
}

export function detectProductChanges(
	current: Product[],
	previous: Product[],
): ChangeLogEntry[] {
	// Empty current list signals an API error — do not mark everything as deleted.
	if (current.length === 0) {
		return [];
	}

	const previousById = new Map(previous.map((p) => [p.shopify_product_id, p]));
	const currentById = new Map(current.map((p) => [p.shopify_product_id, p]));

	const changes: ChangeLogEntry[] = [];

	for (const product of current) {
		const prior = previousById.get(product.shopify_product_id);

		if (prior === undefined) {
			changes.push(
				makeEntry("added", product.shopify_product_id, {
					product_title: product.title,
				}),
			);
			continue;
		}

		if (prior.title !== product.title) {
			changes.push(
				makeEntry("title_changed", product.shopify_product_id, {
					product_title: product.title,
					old_value: prior.title,
					new_value: product.title,
				}),
			);
		}

		if (prior.status !== product.status) {
			changes.push(
				makeEntry("status_changed", product.shopify_product_id, {
					product_title: product.title,
					old_value: prior.status,
					new_value: product.status,
				}),
			);
		}
	}

	for (const prior of previous) {
		if (!currentById.has(prior.shopify_product_id)) {
			changes.push(
				makeEntry("deleted", prior.shopify_product_id, {
					product_title: prior.title,
				}),
			);
		}
	}

	return changes;
}

export function detectInventoryChanges(
	current: InventoryItem[],
	previous: InventoryItem[],
): ChangeLogEntry[] {
	// No previous baseline — first run, nothing to compare against.
	if (previous.length === 0) {
		return [];
	}

	const previousByVariantId = new Map(
		previous.map((item) => [item.shopify_variant_id, item]),
	);

	const changes: ChangeLogEntry[] = [];

	for (const item of current) {
		const prior = previousByVariantId.get(item.shopify_variant_id);

		if (prior === undefined) {
			continue;
		}

		const droppedToZero =
			item.quantity <= OUT_OF_STOCK && prior.quantity > OUT_OF_STOCK;
		if (droppedToZero) {
			changes.push(
				makeEntry("out_of_stock", item.shopify_product_id, {
					shopify_variant_id: item.shopify_variant_id,
					variant_title: item.title,
					old_value: String(prior.quantity),
					new_value: String(item.quantity),
				}),
			);
			continue;
		}

		const droppedIntoLowRange =
			item.quantity >= 1 &&
			item.quantity <= LOW_STOCK_THRESHOLD &&
			prior.quantity > LOW_STOCK_THRESHOLD;

		if (droppedIntoLowRange) {
			changes.push(
				makeEntry("low_stock", item.shopify_product_id, {
					shopify_variant_id: item.shopify_variant_id,
					variant_title: item.title,
					old_value: String(prior.quantity),
					new_value: String(item.quantity),
				}),
			);
		}
	}

	return changes;
}
