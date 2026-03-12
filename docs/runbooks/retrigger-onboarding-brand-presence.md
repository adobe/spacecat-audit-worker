# Retrigger Onboarding Brand Presence

## Problem

Sites onboarded before the DRS `process_job.py` fix did not get brand presence data collection triggered during onboarding. The `triggerBrandDetection` call in `llmo-customer-analysis` was broken because:

1. The DRS `/sites/{siteId}/brand-detection` endpoint requires a `batch_id` (ADR-007), but the audit-worker called it with an empty body
2. The `configVersion` was not passed from `drs-prompt-generation` to `llmo-customer-analysis`, causing the handler to skip config comparison entirely

## Prerequisites

- DRS `process_job.py` change deployed (adds `_trigger_onboarding_brand_presence` post-processing)
- AWS CLI configured for spacecat prod (us-east-1)
- DRS API credentials:
  - `DRS_API_URL`: `https://drs.experiencecloud.live/prod`
  - `DRS_API_KEY`: stored in Vault at `prod/audit-worker` under `DRS_API_KEY`, or in AWS SM at `/helix-deploy/spacecat-services/audit-worker/latest`

## How It Works

Re-submitting a `prompt_generation_base_url` job with `source: "onboarding"` triggers the full onboarding flow:

1. DRS generates prompts (GPT-4o) → stores in S3
2. **NEW**: DRS submits BrightData brand presence jobs across AI platforms (chatgpt_free, perplexity, gemini, copilot, aimode)
3. DRS sends SNS notification with `brand_presence_batch_id` in metadata
4. Audit worker writes prompts to LLMO config → triggers `llmo-customer-analysis` with `configVersion`
5. `llmo-customer-analysis` compares config → enables audits → brand presence data already in flight

## Per-Site Retrigger

You need three values per site from SpaceCat:

| Field | Source |
|-------|--------|
| `base_url` | `site.getBaseURL()` |
| `brand` | `site.getConfig().getLlmoBrand()` |
| `imsOrgId` | `Organization.findById(site.getOrganizationId()).getImsOrgId()` |

```bash
DRS_API_URL="https://drs.experiencecloud.live/prod"
DRS_API_KEY="<from vault or SM>"

SITE_ID="2018c2e8-6936-4841-8f7a-8d3e38949305"
BASE_URL="https://www.simplicityfunerals.com.au"
BRAND="Simplicity Funerals"
IMS_ORG_ID="XXXXXXXX@AdobeOrg"

curl -X POST "${DRS_API_URL}/jobs" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${DRS_API_KEY}" \
  -d "$(cat <<EOF
{
  "provider_id": "prompt_generation_base_url",
  "source": "onboarding",
  "parameters": {
    "base_url": "${BASE_URL}",
    "brand": "${BRAND}",
    "audience": "General consumers interested in ${BRAND} products and services",
    "region": "US",
    "num_prompts": 50,
    "model": "gpt-5-nano",
    "metadata": {
      "site_id": "${SITE_ID}",
      "imsOrgId": "${IMS_ORG_ID}",
      "base_url": "${BASE_URL}",
      "brand": "${BRAND}",
      "region": "US"
    }
  }
}
EOF
)"
```

The response returns a `job_id` you can use to monitor progress.

## Monitoring

### Check DRS job status

```bash
JOB_ID="<job_id from response>"
curl -s "${DRS_API_URL}/jobs/${JOB_ID}" \
  -H "x-api-key: ${DRS_API_KEY}" | python3 -m json.tool
```

### Check audit-worker logs for the site

```bash
aws logs filter-log-events \
  --region us-east-1 \
  --log-group-name "/aws/lambda/spacecat-services--audit-worker" \
  --start-time $(python3 -c "import time; print(int((time.time() - 600) * 1000))") \
  --filter-pattern "\"${SITE_ID}\" \"llmo-customer-analysis\"" \
  --limit 20 \
  --query "events[*].message" \
  --output text
```

### Verify brand presence jobs were created

Check for the tracking file in S3:

```bash
aws s3 ls s3://drs-results-prod/bp/tracking/ --recursive | grep "onboarding"
```

## Bulk Retrigger

For multiple sites, query SpaceCat for all sites with `llmo-customer-analysis` enabled, extract `baseUrl`, `brand`, and `imsOrgId`, then loop:

```bash
#!/bin/bash
set -euo pipefail

DRS_API_URL="https://drs.experiencecloud.live/prod"
DRS_API_KEY="<from vault or SM>"

# CSV format: siteId,baseUrl,brand,imsOrgId
SITES_FILE="sites-to-retrigger.csv"

while IFS=, read -r SITE_ID BASE_URL BRAND IMS_ORG_ID; do
  echo "Retriggering: ${SITE_ID} (${BRAND})"

  RESPONSE=$(curl -s -X POST "${DRS_API_URL}/jobs" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${DRS_API_KEY}" \
    -d "$(cat <<EOF
{
  "provider_id": "prompt_generation_base_url",
  "source": "onboarding",
  "parameters": {
    "base_url": "${BASE_URL}",
    "brand": "${BRAND}",
    "audience": "General consumers interested in ${BRAND} products and services",
    "region": "US",
    "num_prompts": 50,
    "model": "gpt-5-nano",
    "metadata": {
      "site_id": "${SITE_ID}",
      "imsOrgId": "${IMS_ORG_ID}",
      "base_url": "${BASE_URL}",
      "brand": "${BRAND}",
      "region": "US"
    }
  }
}
EOF
  )")

  JOB_ID=$(echo "${RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id','FAILED'))")
  echo "  -> job_id: ${JOB_ID}"

  sleep 2  # Rate limit courtesy
done < "${SITES_FILE}"
```

## Cost Considerations

Each retrigger incurs:
- ~$0.01-0.05 for GPT prompt generation (50 prompts)
- BrightData costs per platform x country (5 platforms x N countries)
- Runs within existing Lambda/Fargate infrastructure
