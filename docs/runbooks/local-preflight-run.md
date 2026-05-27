# Running the Preflight Audit Locally (Full Stack)

This runbook captures everything needed to run the preflight audit locally against a real site with the workspace stack. It documents every pitfall encountered during SITES-44776 development.

## Prerequisites

- Workspace infra running: `cd local && make first-run` (one-time) or `make up && make db-setup`
- LocalStack running (Phase 2 infra): `cd local && make up-full` or `make run-mystique` which auto-starts it
- SAW `.env` sourced: `set -a && source .env && set +a` (see [Environment Variables](#environment-variables))
- `klam login` done (for the `.env` AWS credentials — only needed if `.env` uses real AWS)
- Node 24 (`node --version` should show v24.x)

Check infra is up:
```bash
cd /Users/clotton/repos/mysticat-workspace/local && make status
```

## Quick Run (copy-paste)

```bash
cd /Users/clotton/repos/mysticat-workspace/spacecat-audit-worker

# 1. Seed the S3 scrape data (first time only — see Seeding section)
#    Skip if already seeded from a previous run.

# 2. Reset the async job to IN_PROGRESS (required before every run)
POSTGREST_LOCAL_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoicG9zdGdyZXN0X3dyaXRlciIsImlhdCI6MTUxNjIzOTAyMn0.placeholder'
# Get the real key: grep POSTGREST_API_KEY local/.env (workspace root)
curl -s -X PATCH "http://localhost:3000/async_jobs?id=eq.bbbbbbbb-0000-0000-0000-000000000001" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $POSTGREST_LOCAL_KEY" \
  -d '{"status":"IN_PROGRESS","metadata":{"payload":{"siteId":"9cafd810-8b03-4a91-a171-7e18c6c43afc","urls":["https://uswire.wal-mart.com/"],"step":"identify","enableAuthentication":false}}}'

# 3. Run the audit
set -a && source .env && set +a && \
  VAULT_SECRETS_DISABLED=true \
  DATA_SERVICE_PROVIDER=postgres \
  POSTGREST_URL='http://localhost:3000' \
  AWS_ACCESS_KEY_ID=test \
  AWS_SECRET_ACCESS_KEY=test \
  AWS_SESSION_TOKEN='' \
  AWS_DEFAULT_REGION=us-east-1 \
  AWS_ENDPOINT_URL='http://localhost:4566' \
  AWS_S3_FORCE_PATH_STYLE=true \
  AUDIT_TYPE=preflight \
  JOB_ID=bbbbbbbb-0000-0000-0000-000000000001 \
  node --input-type=module -e "import { main } from './src/index-local.js'; main().catch(console.error);"
```

## How the Preflight Audit Dispatches

Preflight is a `StepAudit` using `AsyncJobRunner`. Unlike other audits that take `siteId` directly, preflight reads:
- `siteId` from `job.getMetadata().payload.siteId`
- `urls` from `job.getMetadata().payload.urls`

`src/index-local.js` is wired for this: set `JOB_ID` env var to trigger AsyncJob mode. Without `JOB_ID`, it falls back to standard `siteId`-based dispatch (for non-preflight audits).

The message body when `JOB_ID` is set:
```json
{
  "type": "preflight",
  "auditContext": {
    "next": "preflight-audit",
    "jobId": "bbbbbbbb-0000-0000-0000-000000000001",
    "type": "preflight"
  }
}
```

## Seeding Test Data

### 1. Create the async_jobs row (one-time)

```bash
POSTGREST_LOCAL_KEY='...'   # from local/.env POSTGREST_API_KEY
curl -s -X POST "http://localhost:3000/async_jobs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $POSTGREST_LOCAL_KEY" \
  -d '{
    "id": "bbbbbbbb-0000-0000-0000-000000000001",
    "type": "preflight",
    "status": "IN_PROGRESS",
    "metadata": {
      "payload": {
        "siteId": "9cafd810-8b03-4a91-a171-7e18c6c43afc",
        "urls": ["https://uswire.wal-mart.com/"],
        "step": "identify",
        "enableAuthentication": false
      }
    }
  }'
```

Important notes about `async_jobs`:
- No `site_id` column — siteId lives in `metadata.payload.siteId`
- `status` must be uppercase: `IN_PROGRESS`, `COMPLETED`, `FAILED`
- The job status is set to `COMPLETED` after each run; **reset it before re-running** (step 2 in Quick Run)

### 2. Upload the global config to LocalStack S3

The `isAuditEnabledForSite` check fetches `config/spacecat/global-config.json` from the bucket named in `S3_CONFIG_BUCKET` env var (default: `spacecat-dev-importer`).

```bash
# Create the bucket (if not already there)
awslocal --endpoint-url=http://localhost:4566 s3 mb s3://spacecat-dev-importer

# Upload the global config
cat > /tmp/global-config.json << 'EOF'
{
  "version": "1.0.0",
  "audits": {
    "preflight": {
      "enabled": true
    }
  },
  "sites": {},
  "organizations": {},
  "productCodes": ["ASO"]
}
EOF

awslocal --endpoint-url=http://localhost:4566 s3 cp /tmp/global-config.json \
  s3://spacecat-dev-importer/config/spacecat/global-config.json
```

**Gotcha**: `productCodes` must use the enum values from the local DB: `ASO`, `LLMO`, or `ACO`. The string `"aem-sites-optimizer"` will cause a Postgres enum validation error.

### 3. Upload a scrape for the target page

The preflight-audit step reads HTML from S3. Key format: `scrapes/{siteId}{pathname}/scrape.json`. For the root path `/`, the key is `scrapes/{siteId}/scrape.json`.

For the Walmart uswire site (`siteId=9cafd810-8b03-4a91-a171-7e18c6c43afc`):

```bash
# Create the scraper bucket
awslocal --endpoint-url=http://localhost:4566 s3 mb s3://spacecat-dev-scraper

# The scrape.json format
cat > /tmp/scrape.json << 'EOF'
{
  "finalUrl": "https://uswire.wal-mart.com/",
  "scrapeResult": {
    "rawBody": "<html>... your HTML here ...</html>"
  }
}
EOF

awslocal --endpoint-url=http://localhost:4566 s3 cp /tmp/scrape.json \
  s3://spacecat-dev-scraper/scrapes/9cafd810-8b03-4a91-a171-7e18c6c43afc/scrape.json
```

To test `excludedElementClasses`, add a CSS class to the links you want filtered in the HTML, then configure it in the site's handler config (see below).

### 4. Configure site handler config (for excludedElementClasses)

To test the `excludedElementClasses` feature, update the site's config in PostgREST:

```bash
# First get the current config
curl -s "http://localhost:3000/sites?id=eq.9cafd810-8b03-4a91-a171-7e18c6c43afc" | jq '.[0].config'

# Update with excludedElementClasses
POSTGREST_LOCAL_KEY='...'
curl -s -X PATCH "http://localhost:3000/sites?id=eq.9cafd810-8b03-4a91-a171-7e18c6c43afc" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $POSTGREST_LOCAL_KEY" \
  -d '{
    "config": {
      "handlers": {
        "preflight": {
          "config": {
            "excludedElementClasses": ["preflight-ignore"]
          }
        }
      }
    }
  }'
```

The audit reads this at: `site.getConfig().getHandlers().preflight.config.excludedElementClasses`.

## Environment Variables

Key env vars for local runs (most come from `.env` in the SAW repo root):

| Variable | Value for local runs | Purpose |
|---|---|---|
| `DATA_SERVICE_PROVIDER` | `postgres` | Use v3 PostgREST layer (not DynamoDB) |
| `POSTGREST_URL` | `http://localhost:3000` | Local PostgREST |
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | Route S3/SQS to LocalStack |
| `AWS_S3_FORCE_PATH_STYLE` | `true` | Required for LocalStack S3 (virtual-hosted style fails) |
| `AWS_ACCESS_KEY_ID` | `test` | LocalStack ignores credentials |
| `AWS_SECRET_ACCESS_KEY` | `test` | LocalStack ignores credentials |
| `AWS_SESSION_TOKEN` | `''` (empty) | Unset any real KLAM token to avoid sending to LocalStack |
| `VAULT_SECRETS_DISABLED` | `true` | Skip Vault secret resolution |
| `AUDIT_TYPE` | `preflight` | Which audit to run |
| `JOB_ID` | `bbbbbbbb-...` | Triggers AsyncJob-based dispatch in `index-local.js` |

## Common Errors and Fixes

### `req.json is not a function`
`sqsEventAdapter` calls `req.json()`. The `request` parameter to `universalMain` must be a proper Fetch API `Request` object, not a plain JS object. `src/index-local.js` already handles this correctly — if you see this error, the `request` construction was changed.

### `ResourceNotFoundException: Cannot do operations on a non-existent table`
You're using v2 (DynamoDB) data access. Set `DATA_SERVICE_PROVIDER=postgres`.

### `getaddrinfo ENOTFOUND spacecat-dev-importer.localhost`
S3 virtual-hosted style URL (`{bucket}.localhost:4566`) resolves as DNS. Set `AWS_S3_FORCE_PATH_STYLE=true` and `AWS_ENDPOINT_URL=http://localhost:4566`.

### `NoSuchBucket: BucketName: 'config'`
LocalStack is parsing `config/spacecat/global-config.json` as bucket=`config`. This happens when virtual-hosted style is used. Fix: `AWS_S3_FORCE_PATH_STYLE=true`.

### `invalid input value for enum entitlement_product_code: "aem-sites-optimizer"`
The global config has wrong `productCodes`. Use `"ASO"` (the DB enum value), not the display name.

### `Fetched 0 keys from S3`
The S3 list/get is routing to the wrong endpoint or bucket format. Verify:
1. `awslocal s3 ls s3://spacecat-dev-scraper/scrapes/` shows the key
2. `AWS_S3_FORCE_PATH_STYLE=true` is set
3. `AWS_ENDPOINT_URL=http://localhost:4566` is set

### `Job not in progress for jobId... Status: COMPLETED`
The job was already marked COMPLETED by a previous run. Reset it with PATCH before re-running (see Quick Run step 2).

### `async_jobs` insert fails with missing column `site_id`
The `async_jobs` table has no `site_id` column — remove it from the INSERT. The siteId goes in `metadata.payload.siteId`.

## The `@adobe/spacecat-shared-data-access` node_modules Patch

The `createS3Service` in `node_modules/@adobe/spacecat-shared-data-access/src/service/index.js` creates an `S3Client` without `forcePathStyle`. When `AWS_ENDPOINT_URL=http://localhost:4566` is set but `forcePathStyle` is missing, it generates virtual-hosted URLs (`{bucket}.localhost:4566`) that fail DNS.

**Manual patch** (needed after every `npm install`):

In `node_modules/@adobe/spacecat-shared-data-access/src/service/index.js`, find `createS3Service` and add:

```js
const options = region ? { region } : {};
if (process.env.AWS_S3_FORCE_PATH_STYLE === 'true') {
  options.forcePathStyle = true;
}
```

This is tracked in SITES-44776 — the fix should be upstreamed to `spacecat-shared` so node_modules patching is no longer needed.

## Verifying the excludedElementClasses Feature

Before running the full audit, you can verify DOM filtering in isolation:

```bash
cd /Users/clotton/repos/mysticat-workspace/spacecat-audit-worker
node scripts/verify-preflight-excluded-classes.js <path-to-html-file> --class preflight-ignore
```

Expected output: `✓ PASS` showing N corp-only links pruned, 0 collateral links removed.

## Relevant Site IDs

| Site | ID | Base URL |
|---|---|---|
| Walmart uswire (test) | `9cafd810-8b03-4a91-a171-7e18c6c43afc` | `https://uswire.wal-mart.com` |

## Architecture Notes

- Preflight uses `StepAudit` + `AsyncJobRunner` with steps: `scrape-pages` → `preflight-audit`
- `src/index-local.js` with `JOB_ID` set dispatches directly to `preflight-audit` (skips scrape step, reads pre-seeded S3 scrapes)
- `links.js` reads `excludedElementClasses` from site config and passes to `runLinksChecks()`
- `links-checks.js` `filterExcludedElements($, excludedElementClasses)` removes DOM subtrees before anchor extraction
- `isAuditEnabledForSite` fetches global config from S3 (`S3_CONFIG_BUCKET`/`config/spacecat/global-config.json`)
