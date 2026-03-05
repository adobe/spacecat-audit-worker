# Runbook: Resubmit DRS Prompt Generation

## When to Use

Use this runbook when AI prompts failed to generate during LLMO onboarding. Common causes:
- DRS job submission failed (env vars missing, API error)
- DRS job completed but SNS notification didn't reach audit-worker
- Audit-worker failed to write prompts to LLMO config
- `llmo-customer-analysis` failed after config write (e.g., Zod validation)

You'll typically be notified via the `#llmo-onboarding` Slack channel when this happens.

## Prerequisites

- DRS prod API key (stored in SSM: `/drs/prod/api_key`)
- SpaceCat API key
- Access to Coralogix logs (spacecat-services-prod)

## Step 1: Identify the Site

From the Slack alert or Coralogix, gather:

| Field | Source |
|-------|--------|
| `SITE_ID` | Slack alert or SpaceCat API |
| `BASE_URL` | Slack alert or SpaceCat API |
| `BRAND_NAME` | SpaceCat API: `site.config.llmo.brand` |
| `IMS_ORG_ID` | SpaceCat API: organization's IMS org |

### Find site by domain

```bash
BASE64_URL=$(echo -n "https://example.com" | base64)
curl -s "https://spacecat.experiencecloud.live/api/v1/sites/by-base-url/${BASE64_URL}" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '{id, baseURL, brand: .config.llmo.brand, orgId: .organizationId}'
```

### Get IMS Org ID

```bash
curl -s "https://spacecat.experiencecloud.live/api/v1/organizations/${ORG_ID}" \
  -H "x-api-key: ${SPACECAT_API_KEY}" | jq '.imsOrgId'
```

## Step 2: Submit DRS Job

```bash
DRS_API_KEY=$(aws ssm get-parameter --name "/drs/prod/api_key" --with-decryption --query "Parameter.Value" --output text)

curl -s -X POST "https://drs.experiencecloud.live/prod/jobs" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${DRS_API_KEY}" \
  -d '{
  "provider_id": "prompt_generation_base_url",
  "source": "onboarding",
  "parameters": {
    "base_url": "https://example.com",
    "brand": "Example Brand",
    "audience": "General consumers interested in Example Brand products and services",
    "region": "US",
    "num_prompts": 50,
    "model": "gpt-5-nano",
    "metadata": {
      "site_id": "<SITE_ID>",
      "imsOrgId": "<IMS_ORG_ID>@AdobeOrg",
      "base_url": "https://example.com",
      "brand": "Example Brand",
      "region": "US"
    }
  }
}'
```

Note the `job_id` from the response.

## Step 3: Monitor Job

```bash
curl -s "https://drs.experiencecloud.live/prod/jobs/${JOB_ID}" \
  -H "x-api-key: ${DRS_API_KEY}" | jq '{status, result_location}'
```

Jobs typically complete in 10-15 minutes.

## Step 4: Verify E2E Flow

After the job completes, the SNS notification triggers the audit-worker which:
1. Downloads the DRS result via presigned URL
2. Writes prompts to the LLMO config as `aiTopics` (with `region` on categories)
3. Triggers `llmo-customer-analysis` audit

### Check in Coralogix

```
source logs
| filter $l.subsystemname == 'spacecat-services-prod'
  && $d.message ~ '<SITE_ID>'
  && $d.message ~ 'DRS prompt'
```

### Expected log sequence

1. `DRS prompt generation completed for site <SITE_ID>`
2. `Wrote N DRS prompts to LLMO config for site <SITE_ID>`
3. `Triggered llmo-customer-analysis for site <SITE_ID>`
4. `llmo-customer-analysis audit for <SITE_ID> completed in X seconds`

## Troubleshooting

### DRS job stays in QUEUED/RUNNING

- Check DRS CloudWatch logs for errors
- Verify `prompt_generation_base_url` provider is healthy in DRS dashboard

### SNS notification not received by audit-worker

- Verify the cross-account SNS subscription is active
- Check if `metadata.site_id` is present in the job — without it, the audit-worker ignores the notification

### llmo-customer-analysis fails with Zod validation

- Categories missing `region` field — audit-worker needs the fix from PR #2057
- Check if audit-worker has been redeployed with the latest code

### Parameter name errors from DRS

- Use `brand` (not `brand_name`) in the parameters
- Use `num_prompts` (not `numPrompts`) — this is the DRS API snake_case format
