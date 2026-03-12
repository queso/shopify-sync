export type ProductStatus = "active" | "draft" | "archived";

export interface Product {
	id: number;
	shopify_product_id: string;
	title: string;
	handle: string;
	status: ProductStatus;
	snapshotted_at: string;
}

export interface InventoryItem {
	id: number;
	shopify_variant_id: string;
	shopify_product_id: string;
	title: string;
	quantity: number;
	snapshotted_at: string;
}

export type ChangeType =
	| "added"
	| "deleted"
	| "title_changed"
	| "status_changed"
	| "low_stock"
	| "out_of_stock";

export interface ChangeLogEntry {
	id: number;
	change_type: ChangeType;
	shopify_product_id: string;
	shopify_variant_id: string | null;
	product_title: string | null;
	variant_title: string | null;
	old_value: string | null;
	new_value: string | null;
	detected_at: string;
}

export interface ShopifyVariant {
	id: string;
	product_id: string;
	title: string;
	inventory_item_id: number;
	inventory_quantity: number;
}

export interface ShopifyLocation {
	id: number;
	name: string;
	active: boolean;
}

export interface ShopifyLocationsResponse {
	locations: ShopifyLocation[];
}

export interface ShopifyProduct {
	id: string;
	title: string;
	handle: string;
	status: ProductStatus;
	variants: ShopifyVariant[];
}

export interface ShopifyInventoryLevel {
	inventory_item_id: number;
	location_id: number;
	available: number;
}

export interface ShopifyProductsResponse {
	products: ShopifyProduct[];
}

export interface ShopifyInventoryLevelsResponse {
	inventory_levels: ShopifyInventoryLevel[];
}
