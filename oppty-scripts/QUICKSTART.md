# Opportunity Fix Verification - Quick Start Guide

## What This Does

Checks if OUTDATED suggestions have been fixed via AI and optionally marks them as FIXED.

**NEW:** Use `--fromCsv` to mark suggestions as fixed directly from existing CSV files - saves significant time by skipping the checker step!

## Prerequisites

1. Set environment variables (see `.env.example`)
2. Node.js 24+

## Quick Examples

### Check a single opportunity type

```bash
npm run oppty:check -- --siteId=YOUR-SITE-UUID --type=alt-text
```

### Check and mark as fixed

```bash
npm run oppty:check -- --siteId=YOUR-SITE-UUID --type=alt-text --markFixed
```

### NEW: Mark as fixed from existing CSV (Fast!)

```bash
# Step 1: Generate CSV (first time)
npm run oppty:check -- --siteId=YOUR-SITE-UUID --type=broken-internal-links

# Step 2: Mark as fixed from CSV (much faster!)
npm run oppty:check -- --siteId=YOUR-SITE-UUID --type=broken-internal-links --markFixed --fromCsv=YOUR-SITE-UUID-broken-internal-links-2026-01-29.csv
```

**Benefits of --fromCsv:**
- Skips expensive checker operations (browser automation, scrape fetching)
- Reduces execution time from minutes/hours to seconds
- Ideal for re-running after reviewing CSV results

### Process all types for a site

```bash
./oppty-scripts/example-batch-process.sh YOUR-SITE-UUID
```

### Process all types and mark fixed

```bash
./oppty-scripts/example-batch-process.sh YOUR-SITE-UUID true
```

## Opportunity Types

- `alt-text` - Image alt text suggestions
- `broken-backlinks` - Broken backlink fixes
- `broken-internal-links` - Broken internal link fixes
- `structured-data` - Structured data improvements
- `sitemap` - Sitemap generation
- `meta-tags` - Meta tag improvements

## Output

Results are saved to:
```
oppty-scripts/data/{siteId}-{type}-{date}.csv
```

## Options

- `--siteId=<uuid>` - (Required) Site UUID
- `--type=<type>` - (Required) Opportunity type
- `--status=<status>` - (Optional, default: OUTDATED) Filter by status
- `--markFixed` - (Optional) Mark suggestions as FIXED and create Fix entities
- `--fromCsv=<path>` - (Optional) Read from existing CSV instead of running checkers
- `--debug` - (Optional) Enable debug logging
- `--markFixed` - (Optional) Mark as FIXED and create Fix entities
- `--debug` - (Optional) Enable debug logging

## Full Documentation

See [README.md](./README.md) for complete documentation.
