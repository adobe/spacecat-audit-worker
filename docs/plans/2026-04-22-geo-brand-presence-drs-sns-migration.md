# Geo Brand Presence — DRS SNS Migration (Cross-Repo Plan)

**Date:** 2026-04-22  
**Status:** In Progress  
**Author:** ilagno@adobe.com

## Overview

Migrates geo-brand-presence refresh from Mystique SQS → direct DRS triggering via
S3 upload + SNS publish (`provider_id="external_spacecat"`). Removes all deprecated
Mystique-based handlers and the HTTP `POST /brand-presence/analyze` endpoint.

**Repositories involved:**
1. `adobe-rnd/llmo-data-retrieval-service` (DRS backend) — PR A
2. `adobe/spacecat-shared` — `packages/spacecat-shared-drs-client` — PR B
3. `adobe/spacecat-infrastructure` (IAM / Lambda role) — PR C
4. `adobe/spacecat-audit-worker` (this repo) — PR D

**Rollout order:** A, B, C can be developed in parallel. PR D depends on B published + C deployed.

---

## Integration Pattern: S3 Upload + SNS Publish

SpaceCat uploads the Excel sheet directly to DRS's S3 bucket, then publishes to the DRS SNS topic.
DRS `fargate_trigger.py` already has `"external_spacecat"` in its filter allowlist.

```
SpaceCat refresh handler
  → read Excel from SharePoint
  → drsClient.uploadExcelToDrs(siteId, jobId, buffer)
      → s3://drs-bucket/external/spacecat/{siteId}/{jobId}/source.xlsx
  → drsClient.publishBrandPresenceAnalyze(siteId, params)
      → SNS publish: { event_type: "JOB_COMPLETED", provider_id: "external_spacecat",
          result_location: "s3://...", metadata: { site_id, week, year, run_frequency,
          web_search_provider, config_version } }
  → DRS fargate_trigger.py (subscribed via "external_spacecat" filter)
      → job_id not in DynamoDB → _create_synthetic_job() inline
      → launch Fargate task
  → Fargate reads s3:// path (existing ExternalPromptLoader, no changes needed)
  → brand analysis → distribution
```

---

## Repo 1: adobe-rnd/llmo-data-retrieval-service (PR A)

### What needs to happen

**1. Handle direct SpaceCat SNS in the Fargate trigger**

The Fargate trigger handler must be extended to process `provider_id="external_spacecat"` SNS
messages that arrive without a pre-existing DynamoDB job. When such a message is received and
no job record is found, a synthetic job must be created inline from the SNS notification metadata
(site_id, week, year, run_frequency, web_search_provider, config_version, result_location).

Note: the synthetic-job creation logic currently lives in `spacecat_resolver.py`, not in
`fargate_trigger.py`. It must be **ported** into the Fargate trigger handler as part of this PR —
it cannot simply be called from its current location.

The notification model also needs to accept the new optional metadata fields
(brand, ims_org_id, web_search_provider, config_version, run_frequency) that SpaceCat will
include in the SNS message.

**2. Remove the `POST /brand-presence/analyze` HTTP endpoint**

Since the integration path is now S3 + SNS, the HTTP Lambda that previously accepted Excel
uploads from SpaceCat is redundant and should be deleted. This includes the Lambda handler,
its resolver, the CDK resources wiring it up, and its tests.

Caution: `excel_ingestion.py` (or equivalent Excel-parsing service) cannot be fully deleted —
`parse_excel_to_rows` (or similar) is imported by the Fargate prompt loader. Only remove
functions that are exclusively used by the deleted HTTP endpoint; leave anything used by
Fargate in place.

**3. Grant cross-account S3 write access**

The DRS brand-presence S3 bucket policy must allow SpaceCat's Lambda execution role to
`s3:PutObject` under the `external/spacecat/*` prefix.

**4. Update the design document**

`docs/design/reanalyze-brand-presence.md` should be updated to describe the new Path B
(Direct S3 + SNS), document removal of the HTTP endpoint, and note the new metadata fields
carried in the SNS notification.

---

## Repo 2: adobe/spacecat-shared — packages/spacecat-shared-drs-client (PR B)

**Current version:** 1.4.2  
**Target version:** 1.5.0 (minor — new methods)

### New env vars consumed

- `DRS_S3_BUCKET` — DRS brand-presence S3 bucket name
- `DRS_SNS_TOPIC_ARN` — DRS notification SNS topic ARN

### `isConfigured()` extension

```js
isConfigured() {
  return !!(this.env.DRS_API_URL && this.env.DRS_API_KEY)
    || !!(this.env.DRS_SNS_TOPIC_ARN && this.env.DRS_S3_BUCKET);
}
```

### New method: `uploadExcelToDrs(siteId, jobId, buffer)`

```js
async uploadExcelToDrs(siteId, jobId, buffer) {
  const key = `external/spacecat/${siteId}/${jobId}/source.xlsx`;
  await this._s3Client.send(new PutObjectCommand({
    Bucket: this.env.DRS_S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  return `s3://${this.env.DRS_S3_BUCKET}/${key}`;
}
```

### New method: `publishBrandPresenceAnalyze(siteId, params)`

```js
async publishBrandPresenceAnalyze(siteId, {
  resultLocation, webSearchProvider, configVersion,
  week, year, runFrequency, brand, imsOrgId,
}) {
  const jobId = `spacecat-${randomUUID()}`;
  const message = {
    event_type: 'JOB_COMPLETED',
    job_id: jobId,
    provider_id: 'external_spacecat',
    result_location: resultLocation,
    reanalysis: true,
    week,
    year,
    metadata: {
      site_id: siteId,
      brand,
      ims_org_id: imsOrgId,
      web_search_provider: webSearchProvider,
      config_version: configVersion,
      ...(runFrequency && { run_frequency: runFrequency }),
    },
  };
  await this._snsClient.send(new PublishCommand({
    TopicArn: this.env.DRS_SNS_TOPIC_ARN,
    Message: JSON.stringify(message),
    MessageAttributes: {
      event_type: { DataType: 'String', StringValue: 'JOB_COMPLETED' },
      provider_id: { DataType: 'String', StringValue: 'external_spacecat' },
    },
  }));
  return jobId;
}
```

### Constructor updates

Instantiate `S3Client` and `SNSClient` from AWS SDK v3 when
`DRS_S3_BUCKET` / `DRS_SNS_TOPIC_ARN` are present.

### Tests

- `uploadExcelToDrs` — S3 PutObject called with correct bucket/key/body; returns `s3://` URI
- `publishBrandPresenceAnalyze` — SNS PublishCommand called with correct TopicArn,
  MessageAttributes, and message body fields
- Missing env vars → `isConfigured()` returns false

---

## Repo 3: adobe/spacecat-infrastructure (PR C)

### SpaceCat Lambda execution role — new policy statements

```hcl
# S3: write Excel to DRS bucket
resource "aws_iam_role_policy" "spacecat_drs_s3_write" {
  role = aws_iam_role.spacecat_lambda_exec.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "arn:aws:s3:::${var.drs_s3_bucket}/external/spacecat/*"
    }]
  })
}

# SNS: publish to DRS notification topic
resource "aws_iam_role_policy" "spacecat_drs_sns_publish" {
  role = aws_iam_role.spacecat_lambda_exec.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = var.drs_sns_topic_arn
    }]
  })
}
```

### New variables

- `drs_s3_bucket` — DRS brand-presence bucket name (output from DRS CDK stack)
- `drs_sns_topic_arn` — DRS notification topic ARN (exported as `{project}-notification-topic-arn`)

### Lambda environment variables (add to SpaceCat Lambda)

- `DRS_S3_BUCKET`
- `DRS_SNS_TOPIC_ARN`

---

## Repo 4: adobe/spacecat-audit-worker (PR D — this repo)

### Files deleted

| File | Reason |
|------|--------|
| `src/geo-brand-presence/handler.js` | Deprecated cadence trigger |
| `src/geo-brand-presence/detect-geo-brand-presence-handler.js` | Deprecated Mystique callback |
| `src/geo-brand-presence/categorization-response-handler.js` | Deprecated Mystique categorization callback |
| `src/geo-brand-presence-daily/handler.js` | Deprecated daily cadence trigger |
| `src/geo-brand-presence-daily/detect-geo-brand-presence-handler.js` | Deprecated daily Mystique callback |
| `test/audits/geo-brand-presence.test.js` | Tests for deleted handler.js |
| `test/audits/geo-brand-presence-daily.test.js` | Tests for deleted daily handlers |

### Files created

| File | Description |
|------|-------------|
| `src/geo-brand-presence-daily/geo-brand-presence-refresh-handler.js` | Daily DRS refresh (`runFrequency: 'daily'`) |
| `test/audits/geo-brand-presence-daily/geo-brand-presence-refresh-handler.test.js` | 100% coverage |
| `docs/plans/2026-04-22-geo-brand-presence-drs-sns-migration.md` | This file |

### Files modified

| File | Change |
|------|--------|
| `src/geo-brand-presence/geo-brand-presence-refresh-handler.js` | Removed Mystique fallback; DRS not configured → `internalServerError`; swapped to `uploadExcelToDrs` + `publishBrandPresenceAnalyze` |
| `src/llmo-customer-analysis/handler.js` | Restored `triggerGeoBrandPresenceRefresh()`; `hasBrandPresenceChanges` → `drsClient.triggerBrandDetection()`; `needsBrandPresenceRefresh` → SQS `geo-brand-presence-trigger-refresh` |
| `src/index.js` | Removed 27+ deprecated HANDLERS entries; added `refresh:geo-brand-presence-daily` |
| `test/audits/geo-brand-presence-refresh.test.js` | Removed Mystique suite; updated to assert `uploadExcelToDrs` + `publishBrandPresenceAnalyze`; added DRS-not-configured test |
| `test/audits/llmo-customer-analysis.test.js` | Updated brand presence change tests; added `triggerBrandDetection` and `triggerGeoBrandPresenceRefresh` tests |

---

## End-to-End Validation Plan

### Prerequisites

| Item | Value |
|------|-------|
| DRS ephemeral stack | deployed with PR A changes |
| SpaceCat staging | deployed with PR C (infra) + PR D changes |
| Test site | `enable_brand_presence=true`, SharePoint Excel sheets, `brandPresenceCadence: 'daily'` or `'weekly'` |
| Env vars | `DRS_S3_BUCKET`, `DRS_SNS_TOPIC_ARN` set on SpaceCat Lambda |

### Flow A — Config Change Triggers Refresh (via `llmo-customer-analysis`)

1. Send `llmo-customer-analysis` SQS message; update site LLMO config to change `brands` or `competitors`
2. **Checkpoint A1 — SpaceCat CloudWatch:**
   - `[ ]` `"Triggering geo-brand-presence-trigger-refresh for site: <siteId>"` logged
   - `[ ]` `"Successfully triggered geo-brand-presence-trigger-refresh"` logged
3. `geo-brand-presence-trigger-refresh` picked up by `refreshGeoBrandPresenceSheetsHandler`
4. **Checkpoint A2 — SpaceCat CloudWatch:**
   - `[ ]` SharePoint query-index fetched; N sheets found
   - `[ ]` `"Uploading sheet <name> to DRS S3"` logged
   - `[ ]` S3 key at `external/spacecat/<siteId>/<jobId>/source.xlsx`
   - `[ ]` SNS published with `provider_id="external_spacecat"`
5. **Checkpoint A2 — DRS S3:**
   ```bash
   aws s3 ls s3://<drs-bucket>/external/spacecat/<siteId>/ --recursive
   ```
6. **Checkpoint A3 — DRS CloudWatch (fargate_trigger):**
   - `[ ]` `"Job <jobId> not found in DynamoDB; creating synthetic job"` logged
   - `[ ]` `"Launching Fargate task for site <siteId>"` logged
7. **Checkpoint A4 — Fargate logs:**
   - `[ ]` `"Loaded N prompts from Excel"` logged
   - `[ ]` `"Brand analysis complete"` logged
8. **Checkpoint A5 — SharePoint:**
   - `[ ]` Excel distribution file updated with analysis results

### Flow B — Direct Refresh Trigger

Send `geo-brand-presence-trigger-refresh` directly; run checkpoints A2–A5.

### Flow C — Daily Cadence

Same as Flow B for a site with `brandPresenceCadence: 'daily'`. Fargate logs must show `run_frequency=daily`.

### Negative Tests

| Scenario | Expected behaviour |
|----------|-------------------|
| `DRS_SNS_TOPIC_ARN` not set | Handler returns `internalServerError`; logged as error |
| SharePoint fetch fails for one sheet | Sheet marked failed; other sheets continue |
| No sheets match last-4-weeks filter | Handler throws; no SNS published |
| `hasBrandPresenceChanges` with DRS not configured | Warning logged; no throw; `needsBrandPresenceRefresh` still runs |

### Observability Checklist

- `[ ]` No `QUEUE_SPACECAT_TO_MYSTIQUE` messages in CloudWatch after migration
- `[ ]` DRS DynamoDB contains synthetic jobs with `provider_id=external_spacecat`
- `[ ]` DRS Fargate task count increases during refresh window
- `[ ]` DRS S3 bucket has `external/spacecat/` objects

---

## Verification (spacecat-audit-worker)

```bash
npm run test:spec -- test/audits/llmo-customer-analysis.test.js \
  test/audits/geo-brand-presence-refresh.test.js \
  test/audits/geo-brand-presence-daily/geo-brand-presence-refresh-handler.test.js
npm test
npm run lint
```
