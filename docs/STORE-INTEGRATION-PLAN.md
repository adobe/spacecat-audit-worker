# Store Integration Plan for Analysis Audits

## Overview

This document describes the architecture for integrating URL Store and Guidelines Store with analysis audits (Wikipedia, Reddit, YouTube). The audit worker fetches URLs and guidelines, then Mystique fetches the actual content.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Brand Presence Audit (Onboarding)                       │
│  - Discovers off-site URLs (Wikipedia, Reddit, YouTube)                     │
│  - Saves URLs to URL Store                                                  │
│  - Content is scraped and saved to Content Store                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        spacecat-api-service                                 │
│  REST API layer that provides access to DynamoDB                            │
│  - URL Store endpoints: /sites/{siteId}/url-store/...                       │
│  - Sentiment endpoints: /sites/{siteId}/sentiment/...                       │
│  - Content Store endpoints: /sites/{siteId}/content-store/...               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Analysis Audit (e.g., wikipedia-analysis)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Query URL Store (by siteId + auditType) → Get URLs for this customer    │
│  2. Query Sentiment Config → Get topics + guidelines                        │
│  3. Send URLs + config to Mystique via SQS                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Mystique                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Receive SQS message with URLs, topics, guidelines                       │
│  2. Query Content Store directly → Get scraped content for URLs             │
│     (Content can be large, exceeds SQS 256KB limit)                         │
│  3. Analyze content using topics + guidelines                               │
│  4. Return results via guidance handler                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Current Status (Feb 2026)

### What's Working
- ✅ URL Store integration - fetches Wikipedia URLs by audit type
- ✅ Sentiment Config integration - fetches topics + guidelines
- ✅ SQS message to Mystique with URLs and config
- ✅ All tests passing (34 total)

### Mystique Responsibility
- 📦 Content Store - Mystique fetches content directly (avoids SQS 256KB limit)

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `src/utils/store-client.js` | NEW | HTTP client for spacecat-api-service |
| `src/wikipedia-analysis/handler.js` | MODIFIED | Integrated store fetching + message building |
| `test/utils/store-client.test.js` | NEW | 18 tests for StoreClient |
| `test/audits/wikipedia-analysis/handler.test.js` | MODIFIED | 18 tests for handler |
| `scripts/seed-test-data.sh` | NEW | Helper to populate test data |
| `src/index-local.js` | MODIFIED | Updated for local testing |

## Store Client (`src/utils/store-client.js`)

HTTP client that calls spacecat-api-service REST endpoints.

**Why Local (Not a Shared Package)?**
- All consumers are in the same repo (`spacecat-audit-worker`)
- `wikipedia-analysis`, `reddit-analysis`, `youtube-analysis` all import from `../utils/store-client.js`
- Mystique (Python) fetches content directly - doesn't use this JS client
- No need for npm publish/version management overhead

**Methods:**
```javascript
StoreClient.createFrom(context)           // Factory from Lambda context
client.getUrls(siteId, auditType)         // GET /sites/{siteId}/url-store/by-audit/{auditType}
client.getGuidelines(siteId, auditType)   // GET /sites/{siteId}/sentiment/config?audit={auditType}
```

**Usage in Handlers:**
```javascript
// All handlers in spacecat-audit-worker use:
import StoreClient, { StoreEmptyError, URL_TYPES, GUIDELINE_TYPES } from '../utils/store-client.js';
```

**Environment Variables:**
```bash
SPACECAT_API_BASE_URL=http://localhost:3000  # or https://spacecat.experiencecloud.live
SPACECAT_API_KEY=your-api-key
```

**Constants:**
```javascript
URL_TYPES = { 
  WIKIPEDIA: 'wikipedia-analysis', 
  REDDIT: 'reddit-analysis', 
  YOUTUBE: 'youtube-analysis' 
}

GUIDELINE_TYPES = { 
  WIKIPEDIA_ANALYSIS: 'wikipedia-analysis', 
  REDDIT_ANALYSIS: 'reddit-analysis', 
  YOUTUBE_ANALYSIS: 'youtube-analysis' 
}
```

## Handler Flow (`src/wikipedia-analysis/handler.js`)

```
runWikipediaAnalysisAudit()
├── getWikipediaConfig(site)          → companyName, competitors, industry, brandKeywords
├── fetchStoreData(siteId, context)
│   ├── storeClient.getUrls()         → Wikipedia URLs from URL Store
│   └── storeClient.getGuidelines()   → Topics + Guidelines
└── Return auditResult with all data

sendMystiqueMessagePostProcessor()
├── Build SQS message (URLs + config, no content)
└── sqs.sendMessage('spacecat-to-mystique', message)
```

**SQS Message to Mystique:**
```javascript
{
  type: 'guidance:wikipedia-analysis',
  siteId: 'uuid',
  url: 'https://example.com',
  auditId: 'uuid',
  deliveryType: 'aem_edge',
  time: '2026-02-04T...',
  data: {
    // Site configuration
    companyName: 'Example Corp',
    companyWebsite: 'https://example.com',
    competitors: ['Competitor A', 'Competitor B'],
    competitorRegion: 'US',
    industry: 'Technology',
    brandKeywords: ['example', 'corp'],
    
    // From URL Store (Mystique fetches content for these URLs)
    urls: [
      { url: 'https://en.wikipedia.org/wiki/Example', siteId: '...', audits: [...] }
    ],
    
    // From Sentiment Config
    topics: [
      { topicId: '...', name: 'Product Launch', subPrompts: [...] }
    ],
    guidelines: [
      { guidelineId: '...', name: 'Quality Focus', instruction: '...' }
    ]
  }
}
```

## API Endpoints (spacecat-api-service)

### URL Store
```
GET /sites/{siteId}/url-store/by-audit/{auditType}

Response (paginated):
{
  "items": [
    {
      "siteId": "abc-123",
      "url": "https://en.wikipedia.org/wiki/Company",
      "byCustomer": false,
      "audits": ["wikipedia-analysis"],
      "createdAt": "2025-01-15T10:00:00Z",
      "updatedAt": "2025-01-15T10:00:00Z"
    }
  ],
  "pagination": { "limit": 100, "cursor": "...", "hasMore": true }
}
```

### Sentiment Config
```
GET /sites/{siteId}/sentiment/config?audit={auditType}

Response:
{
  "topics": [
    { "topicId": "...", "name": "...", "subPrompts": [...], "enabled": true }
  ],
  "guidelines": [
    { "guidelineId": "...", "name": "...", "instruction": "...", "audits": ["wikipedia-analysis"] }
  ]
}
```

### Content Store (Called by Mystique)
```
GET /sites/{siteId}/content-store?urls={url1,url2,...}
```
Note: Content Store is called directly by Mystique, not the audit worker,
because content can exceed SQS message size limits (256KB).

## Local Testing

### Prerequisites
1. Run `spacecat-api-service` locally (connects to DynamoDB)
2. Seed test data
3. Set environment variables

### Step 1: Start spacecat-api-service
```bash
cd /Users/atudoran/dev/AEM/LLMO/spacecat-api-service
npm start
# Runs on http://localhost:3000
```

### Step 2: Seed Test Data
```bash
# From spacecat-audit-worker directory
./scripts/seed-test-data.sh <siteId> <apiKey> http://localhost:3000
```

This creates:
- 2 Wikipedia URLs in URL Store with `wikipedia-analysis` audit enabled
- 2 Sentiment Topics
- 2 Sentiment Guidelines linked to `wikipedia-analysis`

### Step 3: Set Environment Variables
```bash
export SPACECAT_API_BASE_URL=http://localhost:3000
export SPACECAT_API_KEY=<your ADMIN_API_KEY from api-service .env>
export QUEUE_SPACECAT_TO_MYSTIQUE=spacecat-to-mystique
export SITE_ID=<your-test-site-id>
export AUDIT_TYPE=wikipedia-analysis
```

### Step 4: Run Locally
```bash
node --experimental-vm-modules src/index-local.js
```

## Running Tests

```bash
# All store integration tests
npm run test:spec -- test/audits/wikipedia-analysis/handler.test.js test/utils/store-client.test.js

# Just handler tests (18 tests)
npm run test:spec -- test/audits/wikipedia-analysis/handler.test.js

# Just store client tests (18 tests)
npm run test:spec -- test/utils/store-client.test.js
```

## What Still Needs to Be Done

### 1. Reddit & YouTube Analysis Handlers
Use `wikipedia-analysis` as a template:
```bash
cp -r src/wikipedia-analysis src/reddit-analysis
# Then update: URL_TYPES.REDDIT, GUIDELINE_TYPES.REDDIT_ANALYSIS, log prefix, message type
```

### 3. Mystique Updates
Mystique needs to:
- Receive SQS message with URLs, topics, and guidelines
- Fetch content from Content Store using the provided URLs
- Use fetched content + topics + guidelines for analysis

### 4. Environment Configuration
Deploy with these env vars:
```
SPACECAT_API_BASE_URL=https://spacecat.experiencecloud.live
SPACECAT_API_KEY=<production-api-key>
QUEUE_SPACECAT_TO_MYSTIQUE=spacecat-to-mystique
```

## Error Handling

| Error | Cause | Behavior |
|-------|-------|----------|
| `StoreEmptyError('urlStore', ...)` | No Wikipedia URLs found for site | Audit fails, no message to Mystique |
| `StoreEmptyError('guidelinesStore', ...)` | No guidelines found for audit type | Audit fails, no message to Mystique |
| API 401/403 | Invalid or missing API key | Audit fails with HTTP error |
| API 404 | Site not found | Audit fails with HTTP error |

## Related Code

- **spacecat-api-service**: REST API providing URL Store and Sentiment endpoints
- **spacecat-shared/data-access**: DynamoDB models for AuditUrl, SentimentTopic, SentimentGuideline
- **Mystique**: AI analysis service that will consume the SQS messages
