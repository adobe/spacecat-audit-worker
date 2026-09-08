# Summarization Mysticat Observation

**Status:** Implemented in audit-worker; downstream ingestion and projection pending

## Problem

The summarization audit currently sends `guidance:summarization` to Mystique and waits for a
callback containing a presigned result URL. Audit-worker then creates the opportunity and
synchronizes summary and key-point suggestions. Mysticat's blackboard model instead needs a
source observation that identifies the pages to process and lets downstream services own agent
execution and projection.

## Goals

- Publish the pages already selected, scraped, and filtered by audit-worker.
- Include enough information for downstream processing to locate each scrape result.
- Run beside the legacy guidance path for shadow validation.
- Prevent shadow-path failures from failing or retrying the legacy audit flow.
- Bound the message below the SQS 256 KB maximum.

## Non-Goals

- Implement the Mysticat ingestion task, agent, or projector in this repository.
- Change ownership of production summarization opportunities or suggestions.
- Remove `guidance:summarization` or its callback handler.
- Enable the observation path by default.

## Audit-Worker Flow

The existing `send-to-mystique` step remains the controlling path:

1. Verify at least 50% of submitted URLs have scrape results.
2. Remove dynamic pages, pages with existing summary and key points, and unchanged pages.
3. Limit the result to 100 pages and persist the sent URLs and content hashes on the audit.
4. Send the legacy `guidance:summarization` message.
5. When `OBSERVATION_SUMMARIZATION_ENABLED=true`, send the shadow observation.

The observation send is wrapped in its own error boundary. An oversized message or SQS failure is
logged and does not change the successful result of the legacy path.

## Message Contract

The observation uses the existing `QUEUE_SPACECAT_TO_MYSTIQUE` queue:

```json
{
  "type": "observation:summarization",
  "siteId": "site-id-123",
  "auditId": "audit-id-456",
  "baseURL": "https://example.com",
  "deliveryType": "aem",
  "time": "2026-08-21T12:00:00.000Z",
  "data": {
    "pages": [
      {
        "url": "https://example.com/page",
        "scrapeResultPath": "scrapes/site-id-123/page/scrape.json",
        "contentHash": "sha256-value-or-null"
      }
    ],
    "generatePrompts": false
  }
}
```

Constraints:

- `data.pages` contains at most 100 entries.
- Every page has a URL and scraper result path.
- `contentHash` is `null` when scraper content inspection is not configured.
- Serialized observations above 200 KB are skipped.
- The feature flag must equal the string `true` to publish.

## Downstream Work

Before enabling the flag, the Mystique/Mysticat repositories must:

1. Register and validate `observation:summarization`.
2. Read scrape objects using `scrapeResultPath` and the configured scraper bucket.
3. Run the summarization agent for each page.
4. Project one `summarization` opportunity per site scope.
5. Project summary and key-point suggestions with stable, idempotent keys.
6. Preserve edited, deployed, and in-progress suggestions according to the current worker rules.
7. Scope OUTDATED transitions to URLs processed by the observation.

## Rollout

1. Deploy downstream ingestion and projection with contract tests.
2. Enable `OBSERVATION_SUMMARIZATION_ENABLED=true` for shadow sites.
3. Compare selected URLs, generated content, stable keys, and suggestion lifecycle behavior.
4. Add a per-site engine selector before making Mysticat the persistence owner.
5. For blackboard-owned sites, stop the legacy guidance send and worker-owned suggestion sync.
6. Remove the legacy callback only after in-flight messages have drained.

## Alternatives

- **Move URL discovery into Mysticat:** rejected for the migration because audit-worker already owns
  SEO, agentic, included-URL, scrape-availability, and unchanged-content filtering.
- **Replace the legacy path immediately:** rejected because downstream ingestion and projector
  behavior must be validated before persistence ownership changes.
- **Send only URLs:** rejected because explicit scraper paths avoid duplicating scrape-object lookup
  conventions downstream.

## Success Criteria

- Disabled mode sends only the existing guidance message.
- Enabled mode sends one guidance and one observation message.
- Observation failures never fail a successful legacy send.
- The handler and observation branches retain 100% focused test coverage.
- Downstream processing is idempotent before production ownership is transferred.