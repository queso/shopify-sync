# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A lightweight background service that monitors an ArcaneLayer Shopify store by polling the Shopify Admin API and sending a daily email digest of changes. No UI. No dashboard. Just a reliable daily email.

See `docs/prd/PRD-001-shopify-monitor.md` for full requirements.

## Commands

```bash
bun test          # run all tests
bun run lint      # check lint + formatting (Biome)
bun run lint:fix  # auto-fix lint + formatting
```

## Tech Stack

- **Runtime**: Bun (built-in SQLite driver, cron support)
- **API**: Hono (lightweight, TypeScript-first)
- **Database**: SQLite via `bun:sqlite` (raw SQL — schema is simple enough that no ORM is needed)
- **Email**: Resend API
- **Hosting**: VPS or local Mac (self-hosted)

## Architecture

Two cron jobs:

**Polling** (every 4–6 hours): Fetches all products and inventory from Shopify Admin API → compares against last snapshot in SQLite → writes diffs to `change_log`.

**Daily Digest** (7am local): Queries `change_log` for last 24 hours → sends formatted email via Resend → skips if nothing to report.

## Data Model

Three append-only SQLite tables (rows are never updated, only inserted):

- **`products`** — versioned snapshot per poll: `shopify_product_id, title, handle, status, snapshotted_at`
- **`inventory`** — versioned snapshot per poll per variant: `shopify_variant_id, shopify_product_id, title, quantity, snapshotted_at`
- **`change_log`** — diffs detected between polls: `change_type` (`added` | `deleted` | `title_changed` | `low_stock` | `out_of_stock`), `shopify_product_id, old_value, new_value, detected_at`

The append-only model enables full timeline reconstruction and SEO correlation (e.g. correlate title changes against organic traffic by date).

## What It Tracks

- Products: added, deleted, title changes
- Inventory: any SKU hitting 0 (out of stock) or ≤5 (low stock warning)

Out of scope for v1: price tracking, order monitoring, real-time alerts, multi-store support, web UI.

## A(i)-Team Integration

This project uses the A(i)-Team plugin for PRD-driven development.

### When to Use A(i)-Team

Use the A(i)-Team workflow when:
- Implementing features from a PRD document
- Working on multi-file changes that benefit from TDD
- Building features that need structured test → implement → review flow

### Commands

- `/ai-team:plan <prd-file>` - Decompose a PRD into tracked work items
- `/ai-team:run` - Execute the mission with parallel agents
- `/ai-team:status` - Check current progress
- `/ai-team:resume` - Resume an interrupted mission

### Workflow

1. Place your PRD in the `prd/` directory
2. Run `/ai-team:plan prd/your-feature.md`
3. Run `/ai-team:run` to execute

The A(i)-Team will:
- Break down the PRD into testable units
- Write tests first (TDD)
- Implement to pass tests
- Review each feature
- Probe for bugs
- Update documentation and commit

**Do NOT** work on PRD features directly without using `/ai-team:plan` first.
