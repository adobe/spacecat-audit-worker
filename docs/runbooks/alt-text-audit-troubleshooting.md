# Runbook: Alt-Text Audit Troubleshooting

## When to Use

Use this runbook when:
- A Coralogix alert fires on `[AltTextProcessingError]`
- An alt-text audit is stuck or shows an error status
- Mystique responses are missing or incomplete
- You need to understand why an audit didn't produce suggestions

## Prerequisites

- SpaceCat API key (`SPACECAT_API_KEY`)
- Access to Coralogix logs (`spacecat-services-prod`)
- Slack access (for re-triggering audits via bot)

---

## Audit Flow Overview

```
Step 1: processImport          Step 2: processScraping          Step 3: processAltTextWithMystique
[status: preparing]     --->   [status: scraping]        --->   [status: processing]
  |                              |                                 |
  | sends to                     | sends URLs to                   | sends batches to
  | spacecat-import-jobs         | spacecat-scraping-jobs           | spacecat-to-mystique
  |                              |                                 |
  v                              v                                 v
Import worker fetches          Scrape client scrapes            Mystique generates alt-text
top pages from Ahrefs/RUM      page content                    suggestions per batch
                                                                   |
                                                                   | each batch response triggers:
                                                                   v
                                                              Guidance Handler
                                                              [status: success]
                                                              (guidance:missing-alt-text)
```

Each step persists its status to the audit record via `Audit.updateByKeys()`. The full history is in `auditResult.statusHistory`.

---

## Status Reference

| Status | Step | Meaning | Action |
|--------|------|---------|--------|
| `preparing` | Step 1 | Audit initialized, import request sent | Normal -- wait for Step 2 |
| `scraping` | Step 2 | Top pages resolved, scrape request sent | Normal -- wait for Step 3 |
| `processing` | Step 3 | Mystique requests sent, waiting for responses | Normal -- check if Mystique responds |
| `success` | Guidance | Mystique response processed | Audit completed successfully. Check `auditResult.statusHistory` (via the API query in Step 1) -- if a success entry has `empty: true`, Mystique responded but returned no suggestions for that batch. See "success with empty: true" diagnosis below |
| `no_top_pages` | Step 2/3 | No URLs found from Ahrefs, RUM, or site config | Check data sources (see below) |
| `no_scrape_results` | Step 3 | Scrape client returned no results for any URL | Check scrape client health |
| `scraping_failed` | Step 2 | Unexpected error during scraping step | Check logs for root cause |
| `processing_failed` | Step 3 | Unexpected error during Mystique processing | Check Mystique queue and logs |
| `guidance_failed` | Guidance | Failed to process Mystique response | Check opportunity state |

---

## Step 1: Identify the Audit

### Get the latest alt-text audit for a site

```bash
SITE_ID="<site-id>"

curl -s "https://spacecat.experiencecloud.live/api/v1/sites/${SITE_ID}/latest-audit/alt-text" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '{
    id: .id,
    status: .auditResult.status,
    auditedAt: .auditedAt,
    statusHistory: .auditResult.statusHistory
  }'
```

### Find the site by domain

```bash
BASE64_URL=$(echo -n "https://example.com" | base64)
curl -s "https://spacecat.experiencecloud.live/api/v1/sites/by-base-url/${BASE64_URL}" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '.id'
```

### Check if alt-text audit is enabled for the site

Use the Slack bot:
```
/get site-audits <base-url>
```

### Inspect the statusHistory

The `statusHistory` array shows every step the audit went through with timing:

```json
{
  "status": "processing_failed",
  "statusHistory": [
    { "status": "preparing", "startedAt": "...", "completedAt": "...", "stepDurationMs": 0, "queueDurationMs": null },
    { "status": "scraping", "startedAt": "...", "completedAt": "...", "stepDurationMs": 1200, "queueDurationMs": 4500, "urlCount": 20 },
    { "status": "processing_failed", "startedAt": "...", "completedAt": "...", "stepDurationMs": 340, "queueDurationMs": 62000, "error": "Failed to send to Mystique" }
  ]
}
```

Key fields:
- **`stepDurationMs`** -- How long the step handler executed (ms)
- **`queueDurationMs`** -- How long the message waited in queue + external service processing (ms)
- **`error`** -- Error message (only on failure statuses)
- **`urlCount`** -- Number of URLs processed (on `scraping` and `processing` steps)
- **`batchCount`** -- Number of Mystique batches sent (on `processing` step)

---

## Scrape Result Status Reference

When the scrape client finishes processing a URL, it returns a result with a `status` and `reason` field. These appear in the scrape completion messages in Coralogix. Different statuses indicate different root causes:

| Scrape Status | Error Signature | Root Cause | Retryable? |
|---------------|----------------|------------|------------|
| `REDIRECT` | `Redirected to ... from ...` | Server redirects to a different URL; scraper does not follow | No -- fix the site URL (e.g. trailing slash, www vs non-www) |
| `FAILED` | `net::ERR_CONNECTION_TIMED_OUT` | Server is unreachable, not accepting connections | Maybe -- site may be temporarily down |
| `FAILED` | `Navigation timeout of 45000 ms exceeded` | Page connected but too slow to finish loading within 45s | Unlikely -- page is too heavy for the scraper |
| `FAILED` | `net::ERR_CERT_AUTHORITY_INVALID` | SSL certificate is invalid, expired, or self-signed | No -- site has SSL misconfiguration |
| `FAILED` | `Runtime.callFunctionOn timed out` | Page loaded but JS engine became unresponsive (heavy client-side JS) | No -- page JS is too heavy for the scraper |

To see scrape-level results for a specific site, query the scrape completion messages:

```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'Default handler completion message'
  && $d.message ~ '<SITE_ID>'
```

> **Note:** In scrape completion messages, the outer `siteId` field is often set to the `jobId`, not the actual site ID. The real `siteId` is inside `jobMetadata.auditData.siteId`. Use the `auditData.siteId` value when correlating with audit records.

---

## Step 2: Search Coralogix Logs

### Find all alt-text errors

```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'AltTextProcessingError'
```

### Filter by site ID

```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'AltTextProcessingError'
  && $d.message ~ '<SITE_ID>'
```

### Filter by audit ID

```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ '<AUDIT_ID>'
```

### Expected log sequence (healthy audit)

1. `[alt-text]: Processing scraping step for site <siteId>`
2. `[alt-text]: Sending N URLs to scrape client (maxScrapeAge: 24h)`
3. `[alt-text]: Processing alt-text with Mystique for site <siteId>`
4. `[alt-text]: Sending N of M URLs with scrapes to Mystique`
5. `[alt-text]: Sent N pages to Mystique for generating alt-text suggestions`
6. (Per batch) `[alt-text]: Added N new suggestions for M processed pages`
   - OR `[alt-text]: No suggestions to process for siteId: <siteId>` (empty response — still tracked as `success` with `empty: true`)

---

## Step 3: Diagnose by Status

### `success` with `empty: true`

**Meaning:** Mystique responded but sent no suggestions for this batch. The audit is technically successful but produced no actionable results.

**Root causes:**
- All images on the page already have appropriate alt text
- Mystique couldn't extract images from the scraped content
- Mystique response had no `pageUrls` or empty `suggestions` array

**Diagnosis:**
Check the `statusHistory` entries — if ALL success entries have `empty: true`, Mystique found nothing across all batches. If only some are empty, partial results were produced.

**Actions:**
1. Verify the site actually has images without alt text (manual check)
2. Check the scrape content quality — Mystique may not be finding images in the scraped HTML
3. If the site genuinely has no missing alt text, this is expected behavior

### `no_top_pages`

**Root causes:**
- Ahrefs has no data for this site (new site, not indexed)
- RUM fallback returned no traffic data
- Site has no `includedURLs` in config

**Diagnosis:**
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ '<SITE_ID>'
  && $d.message ~ 'alt-text'
  && ($d.message ~ 'No top pages' || $d.message ~ 'No URLs found')
```

**Actions:**
1. Check if the site has Ahrefs data: query `SiteTopPage` for this site
2. Check if the site has RUM data: verify the site is sending RUM beacons
3. If neither data source has URLs, manually provide them via `includedURLs` (see below)

#### Workaround: Manually adding `includedURLs`

When Ahrefs and RUM have no data, you can manually provide URLs for the audit to process by adding them to the site's `config.handlers.alt-text.includedURLs` array.

**Step 1: Find URLs to include**

Use one of these methods:

- **From the site's sitemap:** Check `https://<domain>/sitemap.xml` for a list of page URLs.
- **From Optel Explorer:** Go to `https://aemcs-workspace.adobe.com/customer/generate-optel-domain-key`, enter the site domain, click **Generate**, then click **Optel Explorer**. Copy URLs from the **URL** section.

**Step 2: Get the current site config**

```bash
SITE_ID="<site-id>"

curl -s "https://spacecat.experiencecloud.live/api/v1/sites/${SITE_ID}" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '.config'
```

**Step 3: Update the config with `includedURLs`**

Add the URLs to `config.handlers.alt-text.includedURLs` and PATCH the site:

```bash
curl -s -X PATCH "https://spacecat.experiencecloud.live/api/v1/sites/${SITE_ID}" \
  -H "x-api-key: ${SPACECAT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "handlers": {
        "alt-text": {
          "includedURLs": [
            "https://example.com/page-1",
            "https://example.com/page-2",
            "https://example.com/page-3"
          ]
        }
      }
    }
  }'
```

**Step 4: Re-trigger the audit**

```
run audit audit:alt-text <base-url>
```

The audit will now use the `includedURLs` instead of relying on Ahrefs/RUM data.

### `no_scrape_results`

**Root causes:**
- Scrape client failed to scrape any of the URLs -- check the scrape result `reason` field to distinguish:
  - **Infrastructure issues** (connection timeout, protocol timeout) -- retry may help if the issue is transient
  - **Site issues** (invalid SSL certificate, site permanently down) -- retry will not help
  - **Scraper limitations** (redirect not followed, navigation timeout on heavy pages) -- may need site URL or config changes
- Scrape results expired (older than `SCRAPE_MAX_AGE_HOURS` = 24h)

See the [Scrape Result Status Reference](#scrape-result-status-reference) above for a breakdown of specific failure types and whether they are retryable.

**Diagnosis:**

Check the audit-worker logs for the "Cannot proceed" message:
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ '<SITE_ID>'
  && $d.message ~ 'Cannot proceed'
```

Then check the scrape completion messages to see the per-URL failure reasons:
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'Default handler completion message'
  && $d.message ~ '<SITE_ID>'
```

**Actions:**
1. Check the scrape result statuses and reasons (see reference table) to determine if the failures are retryable
2. Check scrape client health and queue depth
3. Verify the site is accessible (not returning 403/503, valid SSL, not redirecting)
4. If the issue is transient, re-trigger the audit: `run audit audit:alt-text <base-url>`
5. If the issue is persistent (invalid SSL, site down, heavy JS), consider removing the site from alt-text audits or updating its base URL

### `scraping_failed`

**Root causes:**
- Unexpected error in the scraping step (DB error, configuration issue, timeout)

**Diagnosis:**
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'AltTextProcessingError'
  && $d.message ~ 'processScraping failed'
```

**Actions:**
1. Read the error message in the log and in `statusHistory[].error`
2. If transient (timeout, DB connection), re-trigger: `run audit audit:alt-text <base-url>`
3. If persistent, investigate the specific error

### `processing_failed`

**Root causes:**
- Failed to send messages to Mystique queue (SQS issue)
- Failed to create/update opportunity (DB error)
- Configuration error (missing env vars)

**Diagnosis:**
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'AltTextProcessingError'
  && $d.message ~ 'Failed to process with Mystique'
```

**Actions:**
1. Check `spacecat-to-mystique` queue health (message count, DLQ)
2. Check if Mystique service is running
3. Re-trigger: `run audit audit:alt-text <base-url>`

### `guidance_failed`

**Root causes:**
- Failed to fetch opportunities for the site (DB error)
- No opportunity found (main handler didn't create one -- race condition or prior failure)

**Diagnosis:**
```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ 'AltTextProcessingError'
  && $d.message ~ 'guidance'
  && $d.message ~ '<SITE_ID>'
```

**Actions:**
1. Check if the opportunity exists for this site: query opportunities by siteId with status NEW
2. If no opportunity, the main handler (Step 3) may have failed before creating it -- check `processing_failed` logs
3. Re-trigger: `run audit audit:alt-text <base-url>`

### Stuck in `processing` (no `success`)

**Symptom:** Audit shows `processing` status but no `success` entries appear, even after waiting.

**Root causes:**
- Mystique never received the messages (queue issue)
- Mystique processed but response didn't reach the guidance handler (return queue issue)
- Mystique is slow or overloaded

**Diagnosis:**
1. Check `auditResult.statusHistory` -- the `processing` entry has `batchCount` showing how many batches were sent
2. Check the opportunity's `mystiqueResponsesReceived` vs `mystiqueResponsesExpected`
3. Search Coralogix for Mystique responses:
   ```
   source logs
   | filter $d.message ~ 'guidance:missing-alt-text'
     && $d.message ~ '<SITE_ID>'
   ```

**Actions:**
1. Check `spacecat-to-mystique` for stuck/dead-letter messages
2. Check Mystique service health
3. If partial responses arrived, the audit may still have useful suggestions -- check the opportunity
4. Re-trigger: `run audit audit:alt-text <base-url>`

---

## Recovery Actions

### Re-trigger an audit via Slack bot

```
run audit audit:alt-text <base-url>
```

This starts a fresh audit run. The new run will:
- Create a new audit record with fresh `statusHistory`
- Reuse the existing opportunity (if one exists) and update it
- Mark outdated suggestions as OUTDATED

### Check opportunity state

```bash
curl -s "https://spacecat.experiencecloud.live/api/v1/sites/${SITE_ID}/opportunities?status=NEW" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '[.[] | select(.type == "alt-text") | {
    id: .id,
    mystiqueResponsesReceived: .data.mystiqueResponsesReceived,
    mystiqueResponsesExpected: .data.mystiqueResponsesExpected,
    projectedTrafficLost: .data.projectedTrafficLost,
    suggestionsCount: (.suggestions | length)
  }]'
```

---

## Timing Analysis

Use `statusHistory` to identify bottlenecks:

| What to check | How | Normal range |
|---------------|-----|-------------|
| Import step | `statusHistory[0].stepDurationMs` | < 1s |
| Queue wait (import -> scraping) | `statusHistory[1].queueDurationMs` | 1-30s |
| Scraping step | `statusHistory[1].stepDurationMs` | 1-10s |
| Queue wait (scraping -> processing) | `statusHistory[2].queueDurationMs` | 30s-5min (depends on scrape client) |
| Processing step | `statusHistory[2].stepDurationMs` | 1-10s |
| Queue wait (processing -> guidance) | `statusHistory[3].queueDurationMs` | 30s-10min (depends on Mystique) |

If `queueDurationMs` is abnormally high, the bottleneck is the external service (scrape client or Mystique), not the audit worker.

If `stepDurationMs` is abnormally high, the bottleneck is in the audit handler itself (DB queries, API calls).
