# Spec: Content AI Content Sources Migration

- Status: Implemented
- Last updated: 2026-09-02

## Problem Statement

The worker used the retired Content AI configuration and index APIs. FAQ readiness listed
pipeline configurations, extracted an index step, checked for a generative step, and searched
that index. This no longer matches the content-sources API, and repeated source discovery on
every audit would add avoidable API traffic.

## Goals

- Use acquisition content sources for listing, creation, and vector search.
- Persist the resolved content source `name` in each Site's Content AI config.
- Treat a persisted name as authoritative and avoid discovery on subsequent runs.
- Preserve base URL and override URL matching, including `www` equivalence.
- Remove runtime dependence on legacy configurations, indexes, UIDs, and generative steps.
- Preserve an existing optional `index` when persisting the new optional `name`.
- Return actionable HTTP errors with RFC 7807 details when available.

## Non-Goals

- Migrating or deleting the optional Content AI config `index` field.
- A live generative-search readiness probe. FAQ readiness does not consume a generated answer,
  so such a probe would add cost and latency without changing audit behavior.
- Hard-coding the deployment-specific Content AI endpoint or bucket.
- Retry behavior for rate limiting or service failures.

## Technical Design

### Source resolution and persistence

`ContentAIClient.resolveContentSourceName(site)` first reads
`site.getConfig().getContentAiConfig().name`. When present, it returns that value without a
Content AI request. A failed search for a persisted name does not trigger rediscovery.

When `name` is absent, the client lists `GET /content-sources/acquisition` with cursor
pagination and matches `acquisitionConfig.baseUrl` against the site's `overrideBaseURL` and
base URL. URL matching ignores host casing, a leading `www.`, and trailing path slashes;
non-URL override values continue to match exactly.

A discovered or newly created name is persisted through:

```js
siteConfig.updateContentAiConfig({ name });
site.setConfig(Config.toDynamoItem(siteConfig));
await site.save();
```

This worker writes only `name` and does not read `index`. The shared data-access mutator merges
the update, so an existing optional `index` remains alongside `name`; either field may be absent.

### Source creation

`createAcquisitionContentSource(site)` resolves an existing source before creating one. A new
source is posted to `POST /content-sources/acquisition` with a site-derived name, description,
base URL, weekly schedule, and `discovery.includePdfs: true`. The server-returned normalized
`name` is persisted.

A `409` is treated as a possible creation race: the client lists once more and persists a
matching source. If no match exists, the original conflict is surfaced.

### Search and FAQ readiness

Search uses `POST /content-sources/search` with:

```js
{
  contentSource: { name, type: 'ACQUISITION' },
  query: { type: 'vector', text, options },
  queryOptions: { pagination: { limit } },
}
```

FAQ readiness resolves the source and performs a one-result vector search using
`qualityConfig: { quality: 'FAST', size: 1 }`. Its status contract is:

```js
{
  contentSourceName: string | null,
  isSearchWorking: boolean,
}
```

The FAQ audit runs only when both values indicate readiness.

## Error Handling

Responses are parsed only after checking `response.ok`. Errors include the HTTP status and the
RFC 7807 `detail` value when available, falling back to `statusText`. A `204` response returns
`null`.

## Alternatives

- **Discover on every audit:** rejected because the source identity is stable and repeated list
  requests add latency and load.
- **Delete `index` while writing `name`:** rejected because `index` remains an optional,
  first-class field for legacy consumers. The shared mutator preserves it independently.
- **Rediscover after a stored-name search failure:** rejected because stale names should surface
  operationally instead of creating repeated discovery traffic.
- **Probe generative search:** rejected because FAQ readiness needs only source search and does
  not consume generated output.

## Rollout Requirements

- Set `CONTENTAI_ENDPOINT` to the active content-sources experimental route in each environment.
- Ensure the Adobe Developer Console project has the AEM Content AI API and `aem.contentai`
  scope enabled.
- Backfill `{ name }` for existing Sites or allow their first FAQ readiness run to discover and
  persist the matching acquisition source.
- Monitor 401/403, 404, 409, 422, 429, and 503 responses separately.

## Success Criteria

- No production code calls `/configurations` or the legacy `/search` endpoint.
- Persisted source names bypass source discovery.
- Missing source names trigger at most one paginated discovery per resolution call.
- Persisting a source name preserves any existing optional index.
- Content sources are matched by acquisition base URL and searched by source name.
- FAQ audits no longer depend on `uid`, index steps, or generative steps.
- Creation is idempotent across normal and conflict-race paths.
- Focused migration tests and repository lint for changed files pass.
