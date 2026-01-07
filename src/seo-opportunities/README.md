# SEO Opportunities - Indexability Validation

## What This Does

Validates that URLs are indexable by search engines before sending them for H1/meta optimization. Acts as a **technical gate** to prevent wasting AI resources on pages that can't be indexed.

---

## How It Works

```
┌──────────┐              ┌──────────┐
│ Mystique │              │ SpaceCat │
└────┬─────┘              └────┬─────┘
     │                          │
     │ 1. Detect SEO opps       │
     │    (Ahrefs, pos 4-20)    │
     │                          │
     ├─────────────────────────>│
     │ 2. Send URLs via SQS     │
     │    type: detect:seo-     │
     │         indexability      │
     │    MYSTIQUE_TO_SPACECAT  │
     │                          │
     │                          │ 3. Validate indexability
     │                          │    ✓ HTTP status (200?)
     │                          │    ✓ No redirects?
     │                          │    ✓ Self-canonical?
     │                          │    ✓ Not noindexed?
     │                          │    ✓ robots.txt allows?
     │                          │
     │                          │ 4. Split results
     │                          │          │          
     │                          |    CLEAN   BLOCKED     
     │                          │          │          
     │◄─────────────────────────┴──────────┘          
     │ 5. Send results (SQS)    │                     
     │    type: detect:seo-     │
     │         indexability      │
     │    SPACECAT_TO_MYSTIQUE  │
     │    - cleanUrls           │                     
     │    - blockedUrls (info)  │                     
     │                          │                     
     │ 6. Process               │                     
     │    • Clean → AI optimize │                     
     │    • Blocked → Log only  │                     
     │                          │                     
     ├─────────────────────────>│                     
     │ 7. Send guidance back    │                     
     │    (TBD - future step)   │                     

```

---

## Implementation Details

### Files in This Module

**`validators.js`** - Core validation logic (reusable)
- Checks HTTP status codes
- Checks redirects (using existing `redirect-chains` logic)
- Checks canonical tags (using existing `canonical` logic)
- Checks noindex (meta tag + X-Robots-Tag header)
- Checks robots.txt blocking (using existing `llm-blocked` logic)

**`handler.js`** - Audit handler (dual registration)
- Receives URLs from Mystique (via `detect:seo-indexability` message type)
- Runs validation using `validators.js`
- Sends results back to Mystique via `SPACECAT_TO_MYSTIQUE` queue
- Also registered as `seo-opportunities` for API/scheduled triggers

---

## Integration with Mystique

### Step 1: Mystique Sends URLs to SpaceCat

**Queue:** `MYSTIQUE_TO_SPACECAT` (via existing `SQSClient`)

**Pattern:** Uses the `detect:` prefix pattern, same as `detect:geo-brand-presence`, `detect:form-details`, etc.

**Message Format:**
```json
{
  "type": "detect:seo-indexability",
  "siteId": "abc-123",
  "data": {
    "requestId": "seo-oppty-abc-123-1234567890",
    "urls": [
      {
        "url": "https://example.com/cruises",
        "primaryKeyword": "norwegian cruises",
        "position": 12,
        "trafficValue": 150.5,
        "intent": "commercial"
      },
      {
        "url": "https://example.com/destinations",
        "primaryKeyword": "cruise destinations",
        "position": 8,
        "trafficValue": 200.0,
        "intent": "commercial"
      }
    ]
  }
}
```

**Python Example (Mystique):**
```python
from connectors.sqs_client import SQSClient

sqs_client = SQSClient()

message = {
    "type": "detect:seo-indexability",  # ← Follows detect: pattern
    "siteId": "abc-123",
    "data": {
        "requestId": "seo-oppty-abc-123-1234567890",
        "urls": [...]
    }
}

await sqs_client.send_message(message)  # → MYSTIQUE_TO_SPACECAT
```

**Required Fields:**
- `type`: Must be `"detect:seo-indexability"`
- `siteId`: SpaceCat site ID
- `data.urls`: Array of URL objects
  - `url` (required): The page URL to validate
  - `primaryKeyword` (required): Main keyword for this page
  - `position` (required): Current SERP position
  - `trafficValue` (optional): Estimated monthly traffic value
  - `intent` (optional): Keyword intent (e.g., "commercial", "transactional")

**Optional Fields:**
- `data.requestId`: Correlation ID for tracking (recommended)

**Alternative Method:** The audit can also be triggered via SpaceCat API using `type: "seo-opportunities"` and `AUDIT_JOBS_QUEUE`, but the recommended method for Mystique is using the `detect:` message handler pattern shown above.

---

### Step 2: SpaceCat Sends Results Back to Mystique

**Queue:** `QUEUE_SPACECAT_TO_MYSTIQUE`

SpaceCat sends **BOTH clean and blocked URLs** to Mystique:
- **Clean URLs**: Ready for AI-powered H1/meta optimization
- **Blocked URLs**: Informational only (for tracking/retry logic)

**Note:** Blocked URLs do NOT trigger opportunity creation in SpaceCat. Other audits (`redirect-chains`, `canonical`, etc.) will create opportunities when they run.

#### Message Format

```json
{
  "type": "detect:seo-indexability",
  "siteId": "abc-123",
  "auditId": "audit-uuid-here",
  "requestId": "seo-oppty-abc-123-1234567890",
  "time": "2025-01-05T10:30:00Z",
  "data": {
    "cleanUrls": [
      {
        "url": "https://example.com/cruises",
        "primaryKeyword": "norwegian cruises",
        "position": 12,
        "trafficValue": 150.5,
        "intent": "commercial",
        "checks": {
          "httpStatus": { "passed": true, "statusCode": 200 },
          "redirects": { "passed": true, "redirectCount": 0 },
          "canonical": { "passed": true, "isSelfReferencing": true, "canonicalUrl": null },
          "noindex": { "passed": true, "hasNoindexHeader": false, "hasNoindexMeta": false },
          "robotsTxt": { "passed": true, "details": { "googlebot": true, "general": true, "cached": false } }
        }
      }
    ],
    "blockedUrls": [
      {
        "url": "https://example.com/old-page",
        "primaryKeyword": "example keyword",
        "position": 8,
        "trafficValue": 200.0,
        "intent": "commercial",
        "blockers": ["redirect-chain", "canonical-mismatch"],
        "checks": {
          "httpStatus": { "passed": true, "statusCode": 200 },
          "redirects": { "passed": false, "redirectCount": 2, "redirectChain": "https://example.com/old-page -> https://example.com/temp -> https://example.com/new-page", "finalUrl": "https://example.com/new-page" },
          "canonical": { "passed": false, "isSelfReferencing": false, "canonicalUrl": "https://example.com/new-page" },
          "noindex": { "passed": true, "hasNoindexHeader": false, "hasNoindexMeta": false },
          "robotsTxt": { "passed": true, "details": { "googlebot": true, "general": true, "cached": true } }
        }
      }
    ]
  }
}
```

**Mystique Actions:**
- **Clean URLs**: Send to AI agents for H1/meta optimization
- **Blocked URLs**: Log for tracking, optionally notify team, wait for other audits to fix

---

### Audit Result (Saved to Database)

The audit result is saved to SpaceCat's database for historical tracking and analytics:

```json
{
  "success": true,
  "totalUrls": 10,
  "cleanUrls": 7,
  "blockedUrls": 3,
  "blockerSummary": {
    "redirect-chain": 2,
    "canonical-mismatch": 1
  },
  "timestamp": "2025-01-06T12:00:00Z"
}
```

**Why `blockerSummary` is included:**
- **Analytics**: Track blocker trends over time
- **Monitoring**: Alert on spike in specific blocker types
- **Dashboard**: Visualize blocker distribution
- **Historical**: Compare improvements week-over-week

**Example use case:**
```
Week 1: { "redirect-chain": 50, "noindex": 10 }
Week 2: { "redirect-chain": 20, "noindex": 5 }  ← Improvement!
```

---

## Handler Registration

This audit is registered **twice** in `src/index.js` to support both use cases:

```javascript
const HANDLERS = {
  'seo-opportunities': seoOpportunities,       // For API/scheduled triggers
  'detect:seo-indexability': seoOpportunities, // For Mystique messages ✅
};
```

**When to use each:**
- **`detect:seo-indexability`** ✅ (Recommended): Mystique sends this message type via `MYSTIQUE_TO_SPACECAT` queue using the existing `SQSClient`. Follows the standard `detect:` pattern like `detect:geo-brand-presence`, `detect:form-details`, and `detect:forms-a11y`.
- **`seo-opportunities`**: Use for API triggers or scheduled audits via `AUDIT_JOBS_QUEUE`.

---

### Step 3: Blocked URLs - What Happens?

**Blocked URLs are NOT handled by this audit.** They are sent to Mystique for tracking/information purposes only.

#### Other SpaceCat Audits Will Create Opportunities

Blocked URLs will be caught by regular SpaceCat audits:

| Blocker Type | Handled By | Creates Opportunity |
|--------------|------------|---------------------|
| `redirect-detected` | `redirect-chains` audit | ✅ Yes - "Redirect issues found with /redirects.json" |
| `canonical-mismatch` | `canonical` audit | ✅ Yes - "Canonical URL issues affecting SEO" |
| `noindex` | Manual review | ❌ No audit - Requires manual review (could be intentional) |
| `http-error` | Manual review | ❌ No audit - Requires site-wide error check |
| `robots-txt-blocked` | `llm-blocked` audit (LLM only) | ⚠️ Partial - Only checks LLM crawlers, not Googlebot |

**Why this approach?**
- ✅ No duplicate opportunities
- ✅ Other audits provide site-wide context
- ✅ Existing workflows and runbooks apply
- ✅ Mystique can track and retry when URLs become clean

---

## Blocker Types

When a URL fails validation, the `blockers` array contains one or more of:

| Blocker Type | Reason |
|-------------|--------|
| `http-error` | 4xx or 5xx status code |
| `redirect-detected` | URL has 3xx redirects |
| `canonical-mismatch` | Canonical tag points to different URL |
| `noindex` | Page has noindex tag (meta or header) |
| `robots-txt-blocked` | robots.txt blocks Googlebot or general crawlers |

---

## Validation Logic Details

### 1. HTTP Status Check
- ✅ **Pass:** Status code is 200
- ❌ **Fail:** Status code is 4xx or 5xx

### 2. Redirects Check
- ✅ **Pass:** No redirects (redirect count = 0)
- ❌ **Fail:** Has 3xx redirects

**Note:** We use HEAD request with redirect following to check this efficiently.

### 3. Canonical Tag Check
Checks if the page's canonical URL points to itself.

- ✅ **Pass:** Page is self-canonical (canonical tag = page URL) OR has no canonical tag
- ❌ **Fail:** Canonical tag points to a different URL

**Example:**
```html
<!-- ✅ PASS: Self-canonical -->
<link rel="canonical" href="https://example.com/page" />
<!-- (when checking https://example.com/page) -->

<!-- ❌ FAIL: Points elsewhere -->
<link rel="canonical" href="https://example.com/other-page" />
<!-- (when checking https://example.com/page) -->
```

**Why this matters:** If a page has a canonical tag pointing to a different URL, search engines will index the OTHER URL, not this one. So optimizing H1/meta on this page is pointless.

**Reuses:** `canonical/handler.js` validation logic

### 4. Noindex Check
- ✅ **Pass:** No noindex directives found
- ❌ **Fail:** Has any of:
  - `<meta name="robots" content="noindex">`
  - `<meta name="robots" content="none">` (none = noindex + nofollow)
  - `X-Robots-Tag: noindex` HTTP header
  - `X-Robots-Tag: none` HTTP header

### 5. robots.txt Check
- ✅ **Pass:** Both Googlebot and general crawlers are allowed
- ❌ **Fail:** Either Googlebot OR general crawler is blocked

**Reuses:** `llm-blocked/handler.js` robots.txt parsing logic

**Caching:** robots.txt is cached for 5 minutes per domain to reduce requests

---

## Performance Considerations

- **Concurrent validation:** Up to 10 URLs validated in parallel
- **Efficient requests:** Uses HEAD requests where possible
- **robots.txt caching:** 5-minute TTL per domain
- **Reuses existing logic:** Leverages proven SpaceCat audit functions

---

## Example: Complete Flow

```python
# In Mystique: After detecting SEO opportunities

import boto3
import json

# 1. Prepare URLs with keyword data
opportunities = [
    {
        "url": "https://example.com/cruises",
        "primaryKeyword": "norwegian cruises",
        "position": 12,
        "trafficValue": 150.5,
        "intent": "commercial"
    }
]

# 2. Send to SpaceCat for validation
sqs = boto3.client('sqs')
message = {
    "type": "seo-opportunities",
    "siteId": "abc-123",
    "data": {
        "requestId": f"seo-{int(time.time())}",
        "urls": opportunities
    }
}

sqs.send_message(
    QueueUrl=os.getenv('SPACECAT_AUDIT_JOBS_QUEUE_URL'),
    MessageBody=json.dumps(message)
)

# 3. Wait for results (separate SQS listener)
# - Receives clean URLs → Send to AI agents
# - Receives blocked URLs → Send to Tech SEO team
```

---

## Testing

### Manual Test
```bash
# Send test message to audit queue
aws sqs send-message \
  --queue-url $AUDIT_JOBS_QUEUE_URL \
  --message-body '{
    "type": "seo-opportunities",
    "siteId": "test-site-id",
    "data": {
      "urls": [{
        "url": "https://www.adobe.com/",
        "primaryKeyword": "creative software",
        "position": 5,
        "trafficValue": 100
      }]
    }
  }'

# Check response queue
aws sqs receive-message \
  --queue-url $QUEUE_SPACECAT_TO_MYSTIQUE \
  --max-number-of-messages 10
```

### Unit Tests
```bash
npm run test:spec -- test/audits/seo-opportunities/
```
