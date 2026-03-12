# PRD-001: Shopify Store Monitor

## Problem

ArcaneLayer's store is managed by a small team. Products get added, titles get changed, and occasionally things get deleted — sometimes accidentally. Right now there's no visibility into any of that until something breaks or goes missing. We lost products recently and didn't catch it until it was too late.

Inventory is the other gap. When a SKU hits zero, we're dead in the water on that listing. There's no proactive signal — you find out when a customer complains or a sale falls through.

The goal is to have eyes on the store without having to manually check it.

## What We're Building

A lightweight background service that polls the Shopify Admin API several times a day, tracks changes over time, and delivers a daily digest email summarizing everything that changed.

No dashboard. No UI. Just a reliable daily email that tells you what happened to your store in the last 24 hours.

## Who It's For

Josh — to stay aware of what the product listing person is doing and catch anything that goes wrong before it becomes a problem.

## What It Tracks

**Products**
- New products added
- Products deleted
- Title changes (name of listing changed)

**Inventory**
- Any SKU that drops to 0 (out of stock)
- Any SKU that drops to 5 or below (low stock warning)

## How It Works

### Polling
Runs every 4–6 hours via cron. Each run:
1. Fetches all products and inventory levels from Shopify Admin API
2. Compares against the previous snapshot stored in SQLite
3. Records any diffs (additions, deletions, title changes, inventory changes) to a change log table

### Daily Digest
Runs once per day (7am local time). Pulls all changes logged in the last 24 hours and sends a formatted email summary.

The email is skipped if there's nothing to report.

### Email Format

```
ArcaneLayer Daily Report — [Date]

🆕 New Products (n)
  - [Product Name]

🗑️ Deleted (n)
  - [Product Name]

📝 Title Changes (n)
  - "[Old Title]" → "[New Title]"

⚠️ Low Stock (n)
  - [Product] ([Variant]) — n left
  - [Product] ([Variant]) — OUT OF STOCK
```

## What It Does Not Do

- No real-time alerts (daily digest is enough for this use case)
- No price tracking (not a current pain point)
- No order monitoring
- No web UI or dashboard
- No multi-store support

These are not ruled out forever, just out of scope for v1.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun | Fast, built-in SQLite driver, simple cron |
| API | Hono | Lightweight, TypeScript-first, fun to work with |
| Database | SQLite via `bun:sqlite` | No infra, easy backup, fits the data volume; raw SQL is sufficient for this schema |
| Email | Resend | Simple API, reliable delivery, free tier is sufficient |
| Hosting | VPS or local Mac | Self-hosted, no cloud dependencies |

## Data Model

### products (versioned, append-only)
Every poll inserts new rows rather than overwriting. This gives a complete timeline of what every product looked like at any point in time — title, handle (URL slug), status, and when it was recorded.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | primary key |
| shopify_product_id | text | Shopify's ID |
| title | text | listing title at time of snapshot |
| handle | text | URL slug — key for SEO correlation |
| status | text | active, draft, archived |
| snapshotted_at | datetime | when this version was recorded |

Because rows are never updated, you can reconstruct a full timeline for any product:
```sql
SELECT title, snapshotted_at
FROM products
WHERE shopify_product_id = '123'
ORDER BY snapshotted_at ASC
```
This makes it possible to correlate title changes against organic Google traffic by date — e.g., "title changed on 3/1, impressions on this handle increased 40% by 3/15."

### inventory (versioned, append-only)
Same approach as products. Every poll inserts a new row per variant, preserving full stock level history.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | primary key |
| shopify_variant_id | text | Shopify's variant ID |
| shopify_product_id | text | parent product |
| title | text | variant name (e.g. "Blue / Large") |
| quantity | integer | stock level at time of snapshot |
| snapshotted_at | datetime | when this version was recorded |

### change_log (append-only)
Used by the daily digest. Records diffs detected between polls — does not replace the versioned tables, just makes querying recent changes fast.

| Column | Type | Notes |
|--------|------|-------|
| id | integer | primary key |
| change_type | text | added, deleted, title_changed, low_stock, out_of_stock |
| shopify_product_id | text | |
| old_value | text | previous value (nullable) |
| new_value | text | new value (nullable) |
| detected_at | datetime | when the diff was detected |

## Success Criteria

- Deletions are caught within one polling cycle (≤6 hours)
- Daily email arrives by 7am with accurate change summary
- No false positives (spurious diffs from API noise)
- Runs unattended — no manual intervention needed day-to-day

## Out of Scope / Future Considerations

- Slack/SMS alerting for critical events (out of stock)
- Price change tracking
- Historical trend charts
- Automated restock suggestions
