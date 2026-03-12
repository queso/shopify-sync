import { buildConfig } from "../config";
import type {
	ShopifyInventoryLevel,
	ShopifyInventoryLevelsResponse,
	ShopifyLocationsResponse,
	ShopifyProduct,
	ShopifyProductsResponse,
} from "../types";

const API_VERSION = "2024-01";

function baseUrl(domain: string): string {
	return `https://${domain}/admin/api/${API_VERSION}`;
}

function authHeaders(token: string): Record<string, string> {
	return { "X-Shopify-Access-Token": token };
}

async function checkResponse(res: Response): Promise<void> {
	if (!res.ok) {
		throw new Error(`Shopify API error: ${res.status}`);
	}
}

export async function fetchAllProducts(): Promise<ShopifyProduct[]> {
	const config = buildConfig();
	const products: ShopifyProduct[] = [];
	let url: string | null =
		`${baseUrl(config.SHOPIFY_SHOP_DOMAIN)}/products.json?limit=250`;

	while (url) {
		const res = await fetch(url, {
			headers: authHeaders(config.SHOPIFY_ACCESS_TOKEN),
		});
		await checkResponse(res);

		const body = (await res.json()) as ShopifyProductsResponse;
		products.push(...body.products);

		const linkHeader = res.headers.get("Link");
		url = parseNextLink(linkHeader);
	}

	return products;
}

function parseNextLink(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	const parts = linkHeader.split(",");
	for (const part of parts) {
		const match = part.match(/<([^>]+)>;\s*rel="next"/);
		if (match) return match[1];
	}
	return null;
}

export async function fetchLocationId(): Promise<number> {
	const config = buildConfig();
	const url = `${baseUrl(config.SHOPIFY_SHOP_DOMAIN)}/locations.json`;

	const res = await fetch(url, {
		headers: authHeaders(config.SHOPIFY_ACCESS_TOKEN),
	});
	await checkResponse(res);

	const body = (await res.json()) as ShopifyLocationsResponse;
	if (body.locations.length === 0) {
		throw new Error("No Shopify locations found");
	}
	return body.locations[0].id;
}

export async function fetchInventoryLevels(
	inventoryItemIds: number[],
	locationId: number,
): Promise<ShopifyInventoryLevel[]> {
	const config = buildConfig();
	const results: ShopifyInventoryLevel[] = [];
	const batchSize = 50;

	for (let i = 0; i < inventoryItemIds.length; i += batchSize) {
		const batch = inventoryItemIds.slice(i, i + batchSize);
		const ids = batch.join(",");
		const url = `${baseUrl(config.SHOPIFY_SHOP_DOMAIN)}/inventory_levels.json?inventory_item_ids=${ids}&location_ids=${locationId}&limit=250`;

		let res = await fetch(url, {
			headers: authHeaders(config.SHOPIFY_ACCESS_TOKEN),
		});

		if (res.status === 429) {
			const retryAfter = Number.parseFloat(
				res.headers.get("Retry-After") ?? "1",
			);
			await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
			res = await fetch(url, {
				headers: authHeaders(config.SHOPIFY_ACCESS_TOKEN),
			});
		}

		await checkResponse(res);

		const body = (await res.json()) as ShopifyInventoryLevelsResponse;
		results.push(...body.inventory_levels);
	}

	return results;
}
