import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	fetchAllProducts,
	fetchInventoryLevels,
	fetchLocationId,
} from "../shopify/client";
import type {
	ShopifyInventoryLevelsResponse,
	ShopifyLocationsResponse,
	ShopifyProduct,
	ShopifyProductsResponse,
} from "../types";

const TEST_ENV = {
	SHOPIFY_SHOP_DOMAIN: "test-store.myshopify.com",
	SHOPIFY_ACCESS_TOKEN: "shpat_test123",
	RESEND_API_KEY: "re_test",
	RESEND_FROM_EMAIL: "from@example.com",
	RESEND_TO_EMAIL: "to@example.com",
};

const BASE_URL = "https://test-store.myshopify.com/admin/api/2024-01";
const AUTH_HEADER = "shpat_test123";

function makeProductsResponse(
	products: ShopifyProduct[],
	nextLink?: string,
): Response {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (nextLink) {
		headers.Link = `<${nextLink}>; rel="next"`;
	}
	return new Response(
		JSON.stringify({ products } satisfies ShopifyProductsResponse),
		{
			status: 200,
			headers,
		},
	);
}

function makeLocationsResponse(): Response {
	const body: ShopifyLocationsResponse = {
		locations: [
			{ id: 12345, name: "Primary", active: true },
			{ id: 99999, name: "Secondary", active: true },
		],
	};
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function makeInventoryResponse(
	items: {
		inventory_item_id: number;
		location_id: number;
		available: number;
	}[],
): Response {
	const body: ShopifyInventoryLevelsResponse = { inventory_levels: items };
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

const sampleProduct: ShopifyProduct = {
	id: "prod-1",
	title: "Test Product",
	handle: "test-product",
	status: "active",
	variants: [
		{
			id: "var-1",
			product_id: "prod-1",
			title: "Default",
			inventory_item_id: 111,
			inventory_quantity: 5,
		},
	],
};

describe("Shopify API client", () => {
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		originalFetch = global.fetch;
		for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
	});

	afterEach(() => {
		global.fetch = originalFetch;
		for (const k of Object.keys(TEST_ENV)) delete process.env[k];
	});

	// ─── fetchAllProducts ───────────────────────────────────────────────────────

	it("fetchAllProducts() makes request to correct URL with auth header", async () => {
		const calls: { url: string; headers: Record<string, string> }[] = [];

		global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			calls.push({
				url,
				headers: (init?.headers ?? {}) as Record<string, string>,
			});
			return makeProductsResponse([sampleProduct]);
		};

		const products = await fetchAllProducts();

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain("/products.json");
		expect(calls[0].url).toContain("test-store.myshopify.com");
		expect(calls[0].headers["X-Shopify-Access-Token"]).toBe(AUTH_HEADER);
		expect(products).toHaveLength(1);
		expect(products[0].id).toBe("prod-1");
	});

	it("fetchAllProducts() follows pagination via Link headers", async () => {
		const page2Url = `${BASE_URL}/products.json?page_info=abc123&limit=250`;
		let callCount = 0;

		global.fetch = async (input: RequestInfo | URL) => {
			const _url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			callCount++;
			if (callCount === 1) {
				// First page — return one product with a next link
				return makeProductsResponse([sampleProduct], page2Url);
			}
			// Second page — return another product, no next link
			const product2: ShopifyProduct = {
				...sampleProduct,
				id: "prod-2",
				title: "Product 2",
			};
			return makeProductsResponse([product2]);
		};

		const products = await fetchAllProducts();

		expect(callCount).toBe(2);
		expect(products).toHaveLength(2);
		expect(products.map((p) => p.id)).toContain("prod-1");
		expect(products.map((p) => p.id)).toContain("prod-2");
	});

	it("fetchAllProducts() returns empty array when no products", async () => {
		global.fetch = async () => makeProductsResponse([]);
		const products = await fetchAllProducts();
		expect(products).toHaveLength(0);
	});

	// ─── fetchLocationId ────────────────────────────────────────────────────────

	it("fetchLocationId() calls /locations.json and returns the first location's id", async () => {
		let calledUrl = "";
		global.fetch = async (input: RequestInfo | URL) => {
			calledUrl =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			return makeLocationsResponse();
		};

		const locationId = await fetchLocationId();

		expect(calledUrl).toContain("/locations.json");
		expect(locationId).toBe(12345);
	});

	// ─── fetchInventoryLevels ───────────────────────────────────────────────────

	it("fetchInventoryLevels() batches inventory_item_ids in groups of 50", async () => {
		const ids = Array.from({ length: 120 }, (_, i) => i + 1);
		const batchUrls: string[] = [];

		global.fetch = async (input: RequestInfo | URL) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			batchUrls.push(url);
			return makeInventoryResponse([]);
		};

		await fetchInventoryLevels(ids, 99999);

		// 120 ids in groups of 50 → 3 requests
		expect(batchUrls).toHaveLength(3);
		for (const url of batchUrls) {
			expect(url).toContain("/inventory_levels.json");
			expect(url).toContain("location_ids=99999");
		}
	});

	it("fetchInventoryLevels() returns combined results across batches", async () => {
		const ids = [111, 222, 333];

		global.fetch = async () =>
			makeInventoryResponse([
				{ inventory_item_id: 111, location_id: 99999, available: 5 },
				{ inventory_item_id: 222, location_id: 99999, available: 0 },
				{ inventory_item_id: 333, location_id: 99999, available: 12 },
			]);

		const levels = await fetchInventoryLevels(ids, 99999);

		expect(levels).toHaveLength(3);
		expect(levels.find((l) => l.inventory_item_id === 111)?.available).toBe(5);
	});

	it("fetchInventoryLevels() handles HTTP 429 by reading Retry-After header and retrying", async () => {
		let callCount = 0;

		global.fetch = async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("Too Many Requests", {
					status: 429,
					headers: { "Retry-After": "0" }, // 0 seconds so test doesn't actually wait
				});
			}
			return makeInventoryResponse([
				{ inventory_item_id: 1, location_id: 99999, available: 3 },
			]);
		};

		const levels = await fetchInventoryLevels([1], 99999);

		expect(callCount).toBe(2);
		expect(levels).toHaveLength(1);
	});

	// ─── HTTP error handling ────────────────────────────────────────────────────

	it("HTTP errors from fetchAllProducts() throw with status code in message", async () => {
		global.fetch = async () => new Response("Unauthorized", { status: 401 });

		await expect(fetchAllProducts()).rejects.toThrow("401");
	});

	it("HTTP errors from fetchLocationId() throw with status code in message", async () => {
		global.fetch = async () => new Response("Not Found", { status: 404 });

		await expect(fetchLocationId()).rejects.toThrow("404");
	});

	it("HTTP errors from fetchInventoryLevels() throw with status code in message", async () => {
		global.fetch = async () => new Response("Server Error", { status: 500 });

		await expect(fetchInventoryLevels([1], 99999)).rejects.toThrow("500");
	});
});
