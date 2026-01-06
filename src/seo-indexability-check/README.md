# SEO Indexability Validation Library

## What This Is

A **reusable validation library** that checks if URLs are indexable by search engines.

Used by: `seo-opportunities/handler.js`

---

## Validation Functions

### `validateHttpStatus(url, log)`
Checks if page returns 200 OK.

**Returns:**
```javascript
{
  passed: true,      // false if 4xx/5xx
  statusCode: 200,
  blockerType: null  // 'http-error' if failed
}
```

---

### `validateRedirects(url, log)`
Checks if page has 3xx redirects.

**Returns:**
```javascript
{
  passed: true,         // false if redirects found
  redirectCount: 0,
  finalUrl: null,       // set if redirected
  blockerType: null     // 'redirect-detected' if failed
}
```

**Implementation:** Reuses `redirect-chains/handler.js` logic

---

### `validateCanonical(url, log, options)`
Checks if page is self-canonical.

**Returns:**
```javascript
{
  passed: true,           // false if canonical points elsewhere
  isCanonical: true,
  canonicalUrl: null,     // set if not self-canonical
  blockerType: null       // 'canonical-mismatch' if failed
}
```

**Implementation:** Reuses `canonical/handler.js` logic

---

### `validateNoindex(url, log)`
Checks for noindex directives.

**Checks:**
- `<meta name="robots" content="noindex">`
- `<meta name="robots" content="none">`
- `X-Robots-Tag: noindex` header
- `X-Robots-Tag: none` header

**Returns:**
```javascript
{
  passed: true,              // false if noindex found
  hasNoindexHeader: false,
  hasNoindexMeta: false,
  blockerType: null          // 'noindex' if failed
}
```

---

### `validateRobotsTxt(url, log)`
Checks robots.txt blocking.

**Checks:**
- Googlebot allowed?
- General crawler allowed?

**Returns:**
```javascript
{
  passed: true,              // false if blocked
  blockerType: null,         // 'robots-txt-blocked' if failed
  details: {
    googlebot: true,
    general: true,
    cached: false            // true if served from cache
  }
}
```

**Implementation:** Reuses `llm-blocked/handler.js` robots.txt parsing

**Caching:** robots.txt cached for 5 minutes per domain

---

### `validateUrl(url, context)`
Runs all validations for a single URL.

**Returns:**
```javascript
{
  url: "https://example.com/page",
  indexable: true,           // false if any check failed
  checks: {
    httpStatus: {...},
    redirects: {...},
    canonical: {...},
    noindex: {...},
    robotsTxt: {...}
  },
  blockers: []               // Array of blocker types if failed
}
```

---

### `validateUrls(urls, context)`
Validates multiple URLs concurrently (max 10 parallel).

**Input:**
```javascript
[
  { url: "https://example.com/page1", primaryKeyword: "...", ... },
  { url: "https://example.com/page2", primaryKeyword: "...", ... }
]
```

**Output:**
```javascript
[
  {
    url: "https://example.com/page1",
    primaryKeyword: "...",
    indexable: true,
    checks: {...},
    blockers: []
  },
  ...
]
```

**Note:** Returns only successful validations (failures are filtered out)

---

## Usage Example

```javascript
import { validateUrls } from './seo-indexability-check/validators.js';

const urls = [
  {
    url: 'https://example.com/page',
    primaryKeyword: 'example keyword',
    position: 8,
    trafficValue: 150
  }
];

const results = await validateUrls(urls, context);

const cleanUrls = results.filter(r => r.indexable);
const blockedUrls = results.filter(r => !r.indexable);

console.log(`Clean: ${cleanUrls.length}, Blocked: ${blockedUrls.length}`);
```

---

## Dependencies

This library reuses existing SpaceCat audit logic:

| Function | Reuses |
|----------|--------|
| `validateHttpStatus` | `sitemap/common.js` - `fetchWithHeadFallback()` |
| `validateRedirects` | `redirect-chains/handler.js` - `countRedirects()` |
| `validateCanonical` | `canonical/handler.js` - `validateCanonicalTag()` |
| `validateNoindex` | `sitemap/common.js` + HTML parsing |
| `validateRobotsTxt` | `llm-blocked/handler.js` + `robots-parser` library |

---

## Performance

- **Concurrent processing:** Up to 10 URLs validated in parallel
- **Efficient HTTP:** Uses HEAD requests where possible
- **Caching:** robots.txt cached for 5 minutes
- **Error handling:** Individual URL failures don't break batch validation

---

## Testing

```bash
npm run test:spec -- test/audits/seo-indexability-check/validators.test.js
```
