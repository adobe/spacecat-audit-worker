# 007 — Lookup Service: Topic Dimension (audit-worker embeds)

- **Status:** Proposed
- **Date:** 2026-09-16
- **Jira:** LLMO-7445
- **Related:** ADR [006](006-lookup-service-write-foundation.md) (the write-side foundation this
  extends) · `src/common/lookup-index.js` · `src/common/lookup-index-utils.js` ·
  `src/common/offsite-lookup-index.js` · `src/common/offsite-snapshot.js`

## Context

ADR 006 built the Lookup Service write-side **foundation** and reserved the Topic and Claim
dimensions as *additive* (`indexOpportunityByTopic`, …). This ADR adds the **topic** dimension: a
customer looking at a topic can discover the opportunities semantically related to it, via a
pgvector nearest-neighbour search (`opportunity_semantic_embedding`, an HNSW index on
`vector(1536)`; the ANN read + storage helpers ship in `@adobe/spacecat-shared-data-access`). Offsite
(`cited-analysis`, `reddit-analysis`, `youtube-analysis`) is the first consumer.

Unlike the URL dimension, the match key is **derived, not intrinsic**: a URL is already in the
opportunity payload, but a topic's match key is the **embedding vector** of its title. So the one
decision this dimension forces, that the URL dimension never had to, is *where the embedding
happens*.

## Decision

1. **The audit-worker embeds the topic titles itself — the same repo that owns the indexing.** The
   extractor (`getTitles`, per opportunity type) returns the raw topic rows already present in the
   opportunity payload (`insights.<bucket>.topics[]` — cited=`content`, youtube=`content`+`comments`,
   reddit=`combined`), and `indexOpportunityByTopic` embeds them with the shared model
   (`azure/text-embedding-3-small`, native **1536** dims — no Matryoshka truncation) into the index.
   This keeps the topic dimension **self-contained exactly as the URL dimension is** (the opportunity
   owner's persist path calls one `indexOpportunityBy*` function; the foundation does the rest) and
   uses **one embedding client** — `AzureEmbeddingClient` (`spacecat-shared-gpt-client`) — shared with
   the api-service read path, so the opportunity vectors and the query vectors are guaranteed to share
   one embedding space. *Alternative rejected:* having Mystique embed at guidance time and pass the
   vectors in the BO JSON. It split the derivation across two repos and two embedding clients for no
   benefit, given the titles are already in the payload the audit-worker persists.

2. **The embedding client is injected into the foundation, not imported by it.** `indexOpportunityByTopic`
   takes an `embeddingClient` (an `EmbeddingProvider`); the offsite integration constructs it via
   `AzureEmbeddingClient.createFrom(context)` and passes it in. The foundation stays testable and free
   of a hard embedding-client dependency; a missing/misconfigured embedding deployment is a **degraded**
   outcome (logged, best-effort), never a throw — consistent with ADR 006's `{ error }`-not-throw
   contract. The result contract mirrors 006 exactly: `{ opportunityId, submittedEntry, syncedIndexResult }`
   on success (`submittedEntry.topicCount` is the post-hygiene count), `{ error }` with a `REASON` on
   failure. Topic hygiene (`sanitizeTopics`) lives in the foundation's leaf helper alongside
   `sanitizeUrls` (ADR 006 Decision 9): it drops non-string/empty/oversized titles, de-dupes on the
   normalized title the writer hashes on, and caps per entity. The genuine-empty-vs-nothing-survived
   distinction (Decision 9) carries over: a genuinely empty topic list clears the opportunity's topic
   vectors (full-replace self-heal); a non-empty list that hygiene empties is `NO_INDEXABLE_TOPICS`.

3. **The sync-outcome event is per-dimension: `audit_funneling_index_topic_synced`** (ADR 006
   Decision 7 explicitly left the topic event schema to this point in time). It is added as its own
   funneling sub-phase with its own `audit_funneling_start`/`_end` boundary rather than refactoring the
   merged URL path into one combined phase — additive and low-risk. A follow-up could consolidate to a
   single boundary pair per Decision 7's ideal.

4. **Topic vectors ARE copied to a superseded-run snapshot** (`copyOffsiteOpportunityTopicVectors` in
   `prepareSupersededRunSnapshot`), re-pointing the evergreen's rows to the new snapshot id via
   `copyEntityVectors` (copy, not re-embed — the content is identical) while the evergreen still holds
   them, before its refresh full-replaces them. **This deliberately diverges from the URL dimension**,
   which does not copy to snapshots (ADR 006 Decision 8: forward-only, read side filters live status).
   The divergence is intentional: it makes a restored-to-visible snapshot immediately topic-resolvable.
   Best-effort; a failed copy only means that snapshot is not topic-matchable until re-indexed.

## Consequences

- The audit persist path now makes a best-effort embedding call per offsite opportunity refresh
  (one batched `createEmbeddings` per opportunity). It never fails the persist.
- **New runtime config:** the audit-worker Lambda needs the `AzureEmbeddingClient` env
  (`AZURE_EMBEDDING_DEPLOYMENT` = `text-embedding-3-small`, with endpoint/key/api-version falling back
  to the existing `AZURE_OPENAI_*`) — the same values the api-service read path uses. A missing
  deployment degrades the topic sync only; the audit and the URL index are unaffected.
- Forward-only, self-healing (as ADR 006): a topic miss means "not indexed yet." Deletes cascade via
  the FK; the snapshot copy is the one place the topic index intentionally preserves history.
- The shared embedding model is a cross-repo contract (audit-worker write + api-service read). A model
  change is a coordinated re-embed of the opportunity index.
- Claim is still additive on the same shape (`indexOpportunityByClaim`), unchanged by this ADR.
