import { Resend } from "resend";
import { buildConfig } from "../config";
import type { ChangeLogEntry } from "../types";

export interface DigestEmail {
	subject: string;
	html: string;
	text: string;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function formatDigestEmail(
	changes: ChangeLogEntry[],
	date: Date = new Date(),
): DigestEmail {
	const added = changes.filter((c) => c.change_type === "added");
	const deleted = changes.filter((c) => c.change_type === "deleted");
	const titleChanged = changes.filter((c) => c.change_type === "title_changed");
	const statusChanged = changes.filter(
		(c) => c.change_type === "status_changed",
	);
	const lowStock = changes.filter((c) => c.change_type === "low_stock");
	const outOfStock = changes.filter((c) => c.change_type === "out_of_stock");

	const dateStr = date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const subject = `ArcaneLayer Daily Report — ${dateStr}`;

	const htmlSections: string[] = [];
	const textSections: string[] = [];

	if (added.length > 0) {
		htmlSections.push(
			`<h2>New Products Added (${added.length})</h2><ul>${added.map((c) => `<li>${escapeHtml(c.product_title ?? c.new_value ?? c.shopify_product_id)}</li>`).join("")}</ul>`,
		);
		textSections.push(
			`NEW PRODUCTS ADDED (${added.length})\n${added.map((c) => `- ${c.product_title ?? c.new_value ?? c.shopify_product_id}`).join("\n")}`,
		);
	}

	if (deleted.length > 0) {
		htmlSections.push(
			`<h2>Deleted Products (${deleted.length})</h2><ul>${deleted.map((c) => `<li>${escapeHtml(c.product_title ?? c.shopify_product_id)}</li>`).join("")}</ul>`,
		);
		textSections.push(
			`DELETED PRODUCTS (${deleted.length})\n${deleted.map((c) => `- ${c.product_title ?? c.shopify_product_id}`).join("\n")}`,
		);
	}

	if (titleChanged.length > 0) {
		htmlSections.push(
			`<h2>Title Changes (${titleChanged.length})</h2><ul>${titleChanged
				.map(
					(c) =>
						`<li>${escapeHtml(c.old_value ?? "")} → ${escapeHtml(c.new_value ?? "")}</li>`,
				)
				.join("")}</ul>`,
		);
		textSections.push(
			`TITLE CHANGES (${titleChanged.length})\n${titleChanged.map((c) => `- ${c.old_value ?? ""} → ${c.new_value ?? ""}`).join("\n")}`,
		);
	}

	if (statusChanged.length > 0) {
		htmlSections.push(
			`<h2>Status Changes (${statusChanged.length})</h2><ul>${statusChanged
				.map(
					(c) =>
						`<li>${escapeHtml(c.product_title ?? c.shopify_product_id)}: ${c.old_value ?? ""} → ${c.new_value ?? ""}</li>`,
				)
				.join("")}</ul>`,
		);
		textSections.push(
			`STATUS CHANGES (${statusChanged.length})\n${statusChanged.map((c) => `- ${c.product_title ?? c.shopify_product_id}: ${c.old_value ?? ""} → ${c.new_value ?? ""}`).join("\n")}`,
		);
	}

	const inventoryItems = [...lowStock, ...outOfStock];
	if (inventoryItems.length > 0) {
		const itemsHtml = inventoryItems
			.map((c) => {
				const label =
					c.change_type === "out_of_stock"
						? "OUT OF STOCK"
						: `${c.new_value ?? "?"} left`;
				const name = escapeHtml(c.product_title ?? c.shopify_product_id);
				const variant = c.variant_title
					? ` — ${escapeHtml(c.variant_title)}`
					: "";
				return `<li>${name}${variant}: ${label}</li>`;
			})
			.join("");
		const itemsText = inventoryItems
			.map((c) => {
				const label =
					c.change_type === "out_of_stock"
						? "OUT OF STOCK"
						: `${c.new_value ?? "?"} left`;
				const name = c.product_title ?? c.shopify_product_id;
				const variant = c.variant_title ? ` — ${c.variant_title}` : "";
				return `- ${name}${variant}: ${label}`;
			})
			.join("\n");

		htmlSections.push(
			`<h2>Inventory Alerts (${inventoryItems.length})</h2><ul>${itemsHtml}</ul>`,
		);
		textSections.push(
			`INVENTORY ALERTS (${inventoryItems.length})\n${itemsText}`,
		);
	}

	const html = `<!DOCTYPE html><html><body><h1>${subject}</h1>${htmlSections.join("\n")}</body></html>`;
	const text = `${subject}\n${"=".repeat(subject.length)}\n\n${textSections.join("\n\n")}`;

	return { subject, html, text };
}

export async function sendDigestEmail(
	changes: ChangeLogEntry[],
	date: Date = new Date(),
): Promise<void> {
	if (changes.length === 0) return;

	const config = buildConfig();
	const { subject, html, text } = formatDigestEmail(changes, date);

	const resend = new Resend(config.RESEND_API_KEY);
	await resend.emails.send({
		from: config.RESEND_FROM_EMAIL,
		to: config.RESEND_TO_EMAIL,
		subject,
		html,
		text,
	});
}
