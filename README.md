# shopify-sync

A lightweight background service that monitors an ArcaneLayer Shopify store by polling the Shopify Admin API and sending a daily email digest of changes. No UI. No dashboard. Just a reliable daily email.

## Features

- **Polling Service** - Fetches products and inventory every 4–6 hours, detects changes, writes to SQLite
- **Daily Digest** - Sends formatted email at 7am with summary of changes in last 24 hours
- **Append-Only Database** - Full timeline reconstruction of product and inventory snapshots
- **Change Detection** - Tracks new products, deletions, title changes, and inventory alerts (out-of-stock, low-stock)
- **Email Notifications** - HTML + text emails via Resend API
- **HTTP API** - Health check and manual job triggers for testing/monitoring
- **Cron Scheduling** - Built-in Bun cron with configurable schedules

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.3.8 or later
- Shopify store with admin access
- Shopify Admin API credentials
- Resend account for email delivery

### Installation

```bash
bun install
```

### Configuration

Create a `.env` file in the project root with your credentials:

```bash
# Shopify
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxx

# Resend Email
RESEND_API_KEY=re_xxxxx
RESEND_FROM_EMAIL=noreply@example.com
RESEND_TO_EMAIL=josh@example.com

# Optional
PORT=3000
DATABASE_PATH=./shopify.db
POLL_CRON="0 */6 * * *"       # Every 6 hours (default)
DIGEST_CRON="0 7 * * *"       # 7am local time (default)
```

See `.env.example` for details.

### Running

Start the server:

```bash
bun run index.ts
```

The server will:
1. Initialize SQLite database
2. Register cron jobs (poll and digest)
3. Start HTTP server on configured port (default 3000)

## API Endpoints

### Health Check
```bash
GET /health
```
Returns `200 OK` if server is running.

### Manual Poll
```bash
POST /poll
```
Triggers a poll job immediately. Returns:
```json
{
  "success": true,
  "productsPolled": 42,
  "changesDetected": 5
}
```

### Manual Digest
```bash
POST /digest
```
Triggers a digest job immediately. Returns:
```json
{
  "success": true,
  "changeCount": 5,
  "emailSent": true
}
```

## Architecture

### Data Model

Three append-only SQLite tables enable full timeline reconstruction:

#### products
Versioned snapshots of products at each poll:
- `shopify_product_id` - Shopify's product ID
- `title` - Product title/name
- `handle` - URL slug (useful for SEO correlation)
- `status` - active, draft, or archived
- `snapshotted_at` - Timestamp of this snapshot

#### inventory
Versioned snapshots of inventory per variant:
- `shopify_variant_id` - Shopify's variant ID
- `shopify_product_id` - Parent product ID
- `title` - Variant name (e.g., "Blue / Large")
- `quantity` - Stock level at time of snapshot
- `snapshotted_at` - Timestamp of this snapshot

#### change_log
Diffs detected between consecutive polls:
- `change_type` - one of: `added`, `deleted`, `title_changed`, `low_stock`, `out_of_stock`
- `shopify_product_id` - Product affected
- `old_value` - Previous value (nullable)
- `new_value` - New value (nullable)
- `detected_at` - When the change was detected

### Polling Loop

1. Fetch all products from Shopify Admin API
2. Fetch inventory levels for all variants by location
3. Compare against latest snapshot in SQLite
4. Detect changes:
   - New products: in API response but not in latest snapshot
   - Deleted products: in latest snapshot but not in API response
   - Title changes: title differs from latest snapshot
   - Out-of-stock: quantity ≤ 0
   - Low-stock: quantity ≤ 5
5. Write all changes to `change_log` in a single transaction
6. Write current products and inventory to respective tables

### Daily Digest

1. Query `change_log` for entries in last 24 hours
2. Group by change type (added, deleted, title_changed, low_stock, out_of_stock)
3. Format into HTML email with plain text fallback
4. Send via Resend API

## Development

### Running Tests
```bash
bun test
```

Runs all tests in `src/__tests__/`. Covers:
- Database operations
- Shopify API client
- Diff detection
- Email formatting
- Cron jobs

### Linting and Formatting
```bash
bun run lint        # Check lint + formatting
bun run lint:fix    # Auto-fix lint + formatting
```

## What It Tracks

### Products
- New products added
- Products deleted
- Title changes

### Inventory
- Out of stock (quantity ≤ 0)
- Low stock warning (quantity ≤ 5)

### What It Does NOT Track
- Prices (out of scope for v1)
- Orders or sales
- Real-time alerts (daily digest is sufficient)
- Multi-store support

## Deployment

The service is designed to be self-hosted on a VPS or local Mac. It:
- Uses SQLite (no external database needed)
- Relies on Shopify Admin API (read-only)
- Sends email via Resend (simple HTTP API)
- Uses built-in Bun cron (no external scheduler needed)

## Files

```
src/
├── index.ts           # Hono server entry point with cron registration
├── config.ts          # Environment validation and configuration
├── types.ts           # TypeScript type definitions
├── db/
│   └── index.ts       # SQLite database layer with append-only operations
├── shopify/
│   ├── client.ts      # Shopify Admin API client
│   └── diff-engine.ts # Change detection logic
├── email/
│   └── index.ts       # Email formatting and Resend API client
├── cron/
│   ├── poll.ts        # Polling job (fetch + diff + log)
│   └── digest.ts      # Daily digest job (query + email)
└── __tests__/         # Comprehensive test suite (91 tests)
```

## License

MIT
