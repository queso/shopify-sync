# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-03-12

### Added
- SQLite database layer with three append-only tables (`products`, `inventory`, `change_log`) for full timeline reconstruction (#534)
- Shopify Admin API client with product fetching and inventory level queries (#535)
- Diff engine that detects product changes (added, deleted, title_changed) and inventory changes (out_of_stock, low_stock) (#536)
- Email digest formatter with HTML + text rendering via Resend API (#537)
- Poll cron job that fetches products and inventory, performs atomic diffing, and logs changes (#538)
- Daily digest cron job that queries last 24 hours of changes and sends formatted email (#539)
- Hono HTTP server with health check and manual trigger endpoints (`/health`, `/POST /poll`, `/POST /digest`) (#540)
- Environment configuration with validation for Shopify and Resend credentials
- Comprehensive test suite (91 tests) covering database, API client, diff engine, email formatting, and cron jobs
- Linting and formatting via Biome

### Features Implemented

**Polling Service**
- Runs every 4–6 hours (configurable via `POLL_CRON` env var)
- Fetches all products and variants from Shopify Admin API
- Fetches inventory levels by location
- Compares against previous snapshot in SQLite
- Atomically writes diffs to `change_log` table
- Detects: new products, deleted products, title changes, out-of-stock (≤0), low-stock (≤5)

**Daily Digest**
- Runs at 7am local time (configurable via `DIGEST_CRON` env var)
- Queries `change_log` for changes in last 24 hours
- Skips email if no changes detected
- Sends formatted HTML + text email via Resend

**Data Model**
- `products`: Versioned snapshots with shopify_product_id, title, handle, status, snapshotted_at
- `inventory`: Versioned snapshots per variant with quantity tracking
- `change_log`: Diffs with change_type (added, deleted, title_changed, low_stock, out_of_stock), old_value, new_value, detected_at

**Email Format**
- Daily report with sections for new products, deletions, title changes, and stock alerts
- HTML-escaped content to prevent injection
- Text fallback for email clients without HTML support

**Configuration**
- Required: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_TO_EMAIL`
- Optional: `PORT` (default 3000), `DATABASE_PATH`, `POLL_CRON`, `DIGEST_CRON`
- Validation at startup with clear error messages

**HTTP API**
- `GET /health` - returns 200 OK
- `POST /poll` - manually trigger poll job
- `POST /digest` - manually trigger digest job
- All endpoints return JSON with job results

### Tech Stack
- **Runtime**: Bun 1.3.8+ (built-in SQLite driver, cron support)
- **Web Framework**: Hono (lightweight, TypeScript-first)
- **Database**: SQLite via `bun:sqlite` (append-only, no ORM)
- **Email**: Resend API
- **Hosting**: Self-hosted (VPS or local)
- **Testing**: Bun test runner
- **Linting**: Biome
- **Language**: TypeScript

### Testing
- 91 tests covering all core functionality
- Unit tests for database operations, API client, diff detection, email formatting
- Integration tests for cron jobs with mocked dependencies
- All tests passing, linting clean

[1.0.0]: https://github.com/ArcaneLayers/shopify-sync/releases/tag/v1.0.0
