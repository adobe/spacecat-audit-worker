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
     │    AUDIT_JOBS_QUEUE      │
     │                          │
     │                          │ 3. Validate indexability
     │                          │    ✓ HTTP status (200 OK?)
     │                          │    ✓ No redirects?
     │                          │    ✓ Self-canonical?
     │                          │    ✓ Not noindexed?
     │                          │    ✓ robots.txt allows?
     │                          │
     │◄─────────────────────────┤
     │ 4a. Clean URLs           │
     │     (via SQS)            │
     │                          │
     │◄─────────────────────────┤
     │ 4b. Blocked URLs         │
     │     (via SQS)            │
     │                          │
     │ 5. Mystique processes:   │
     │    • Clean → Generate    │
     │      H1/meta with AI     │
     │    • Blocked → Notify    │
     │      Tech SEO team       │
     │                          │
     ├─────────────────────────>│
     │ 6. Send guidance back    │
     │    (for clean URLs)      │
     │                          │
     │                          │ 7. Create opportunities
     │                          │    (Store in DynamoDB)
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

**`handler.js`** - Message handler
- Receives URLs from Mystique
- Runs validation
- Sends results back to Mystique

---

## Integration with Mystique

### Step 1: Mystique Sends URLs to SpaceCat

**Queue:** `AUDIT_JOBS_QUEUE`

**Message Format:**
```json
{
  "type": "seo-opportunities",
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

**Required Fields:**
- `type`: Must be `"seo-opportunities"`
- `siteId`: SpaceCat site ID
- `data.urls`: Array of URL objects
  - `url` (required): The page URL to validate
  - `primaryKeyword` (required): Main keyword for this page
  - `position` (required): Current SERP position
  - `trafficValue` (optional): Estimated monthly traffic value
  - `intent` (optional): Keyword intent (e.g., "commercial", "transactional")

**Optional Fields:**
- `data.requestId`: Correlation ID for tracking (recommended)

---

### Step 2: SpaceCat Sends Results Back to Mystique

**Queue:** `QUEUE_SPACECAT_TO_MYSTIQUE`

SpaceCat sends **TWO separate messages** - one for clean URLs, one for blocked URLs.

#### Message 1: Clean URLs (Ready for Optimization)

```json
{
  "type": "detect:seo-indexability",
  "siteId": "abc-123",
  "auditId": "audit-uuid-here",
  "requestId": "seo-oppty-abc-123-1234567890",
  "time": "2025-01-05T10:30:00Z",
  "data": {
    "status": "clean",
    "urls": [
      {
        "url": "https://example.com/cruises",
        "primaryKeyword": "norwegian cruises",
        "position": 12,
        "trafficValue": 150.5,
        "intent": "commercial",
        "checks": {
          "httpStatus": {
            "passed": true,
            "statusCode": 200
          },
          "redirects": {
            "passed": true,
            "redirectCount": 0
          },
          "canonical": {
            "passed": true,
            "isCanonical": true
          },
          "noindex": {
            "passed": true,
            "hasNoindexHeader": false,
            "hasNoindexMeta": false
          },
          "robotsTxt": {
            "passed": true,
            "details": {
              "googlebot": true,
              "general": true
            }
          }
        }
      }
    ]
  }
}
```

**Mystique Action:** Send these URLs to AI agents for H1/meta optimization.

---

#### Message 2: Blocked URLs (Needs Tech SEO Review)

```json
{
  "type": "detect:seo-indexability",
  "siteId": "abc-123",
  "auditId": "audit-uuid-here",
  "requestId": "seo-oppty-abc-123-1234567890",
  "time": "2025-01-05T10:30:00Z",
  "data": {
    "status": "blocked",
    "urls": [
      {
        "url": "https://example.com/old-page",
        "primaryKeyword": "example keyword",
        "position": 8,
        "trafficValue": 200.0,
        "intent": "commercial",
        "blockers": ["redirect-detected", "canonical-mismatch"],
        "checks": {
          "httpStatus": {
            "passed": true,
            "statusCode": 200
          },
          "redirects": {
            "passed": false,
            "redirectCount": 2,
            "finalUrl": "https://example.com/new-page"
          },
          "canonical": {
            "passed": false,
            "isCanonical": false,
            "canonicalUrl": "https://example.com/new-page"
          },
          "noindex": {
            "passed": true,
            "hasNoindexHeader": false,
            "hasNoindexMeta": false
          },
          "robotsTxt": {
            "passed": true,
            "details": {
              "googlebot": true,
              "general": true
            }
          }
        }
      }
    ]
  }
}
```

**Mystique Action:** Route to Tech SEO team (Slack/Jira). Do NOT proceed with optimization.

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

---

## Configuration

### Environment Variables (SpaceCat)
- `AUDIT_JOBS_QUEUE_URL` - Queue for receiving validation requests
- `QUEUE_SPACECAT_TO_MYSTIQUE` - Queue for sending results back

### Environment Variables (Mystique)
- `SPACECAT_AUDIT_JOBS_QUEUE_URL` - Where to send validation requests
- `QUEUE_SPACECAT_TO_MYSTIQUE` - Where to receive results
- `SPACECAT_AWS_ACCESS_KEY_ID` - AWS credentials
- `SPACECAT_AWS_SECRET_ACCESS_KEY` - AWS credentials

---

## Future Enhancements

Potential additions (not currently implemented):
- ✨ Check site-specific canonicalization patterns
- ✨ Detect JavaScript-rendered noindex (requires browser)
- ✨ Check indexation status in Google Search Console
- ✨ Validate structured data presence
- ✨ Check page load speed (Core Web Vitals)

---

## Support

**Questions?** Contact:
- SpaceCat Team: #spacecat-support
- SEO Team: #seo-team
