# Preflight Audit — API Response Schema

The `result` of a Preflight audit job is an **array of per-page results** — one entry per audited URL. Each entry has `pageUrl`, `step` (`"identify"` | `"suggest"`), and an `audits[]` array. Each audit has `name`, `type` (`"seo"` | `"a11y"` | `"form-a11y"`), and an `opportunities[]` array (empty when the audit found no issues).

## Full example response (one page, `identify` step)

The example below shows **every audit type** in a single response, each populated with representative findings.

```jsonc
[
  {
    "pageUrl": "https://main--example--site.aem.page/products",
    "step": "identify",
    "audits": [
      {
        "name": "body-size",
        "type": "seo",
        "opportunities": [
          {
            "check": "content-length",
            "issue": "Body content length is below 100 characters",
            "seoImpact": "Moderate",
            "seoRecommendation": "Add more meaningful content to the page",
            "elements": [
              { "selector": "body", "textContent": "Coming soon." }
            ]
          }
        ]
      },
      {
        "name": "lorem-ipsum",
        "type": "seo",
        "opportunities": [
          {
            "check": "placeholder-text",
            "issue": "Found Lorem ipsum placeholder text in the page content",
            "seoImpact": "High",
            "seoRecommendation": "Replace placeholder text with meaningful content",
            "elements": [
              { "selector": "body > div.hero > p",     "textContent": "Lorem ipsum dolor sit amet, consectetur..." },
              { "selector": "body > div.footer > span", "textContent": "...sed do eiusmod lorem ipsum tempor." }
            ]
          }
        ]
      },
      {
        "name": "h1-count",
        "type": "seo",
        "opportunities": [
          {
            "check": "multiple-h1",
            "issue": "Found 2 H1 tags",
            "seoImpact": "High",
            "seoRecommendation": "Use exactly one H1 tag per page for better SEO structure",
            "elements": [
              { "selector": "body > h1:nth-of-type(1)", "textContent": "Welcome" },
              { "selector": "body > h1:nth-of-type(2)", "textContent": "Our Products" }
            ]
          }
        ]
      },
      {
        "name": "canonical",
        "type": "seo",
        "opportunities": [
          {
            "check": "canonical-self-referenced",
            "issue": "The canonical URL should point to itself to indicate that it is the preferred version of the content.",
            "seoImpact": "Moderate",
            "seoRecommendation": "Update the canonical URL to point to itself",
            "url": "https://main--example--site.aem.page/products-old",   // current (wrong) canonical href
            "suggestion": "https://main--example--site.aem.page/products", // the fix: the page's own URL
            "elements": [
              { "selector": "head > link[rel=\"canonical\"]" }             // <head> element — not highlightable
            ]
          }
        ]
      },
      {
        "name": "metatags",
        "type": "seo",
        "opportunities": [
          {
            "tagName": "title",                          // metatags are keyed by tagName, not `check`
            "issue": "Title too short",
            "issueDetails": "19 chars below limit",
            "seoImpact": "Moderate",
            "seoRecommendation": "40-60 characters long",
            "tagContent": "Products",                     // current value of the tag
            "elements": [
              { "selector": "head > title" }
            ]
          },
          {
            "tagName": "h1",
            "issue": "Multiple H1 tags found",
            "issueDetails": "Page has 2 H1 tags",
            "seoImpact": "High",
            "seoRecommendation": "Use exactly one H1 tag per page",
            "elements": [
              { "selector": "body > h1:nth-of-type(1)", "textContent": "Welcome" },
              { "selector": "body > h1:nth-of-type(2)", "textContent": "Our Products" }
            ]
          }
        ]
      },
      {
        "name": "links",
        "type": "seo",
        "opportunities": [
          {
            "check": "broken-internal-links",
            "issue": [                                     // NOTE: links wrap findings in an `issue` array
              {
                "url": "https://main--example--site.aem.page/this-page-does-not-exist",
                "issue": "Status 404",
                "seoImpact": "High",
                "seoRecommendation": "Fix or remove broken links to improve user experience and SEO",
                "elements": [                              // one entry per occurrence (each anchor)
                  { "selector": "body > nav > a:nth-of-type(1)",    "textContent": "Learn more" },
                  { "selector": "body > footer > a:nth-of-type(3)", "textContent": "Read the docs" }
                ]
              }
            ]
          },
          {
            "check": "broken-external-links",
            "issue": [
              {
                "url": "https://example.com/removed",
                "issue": "Status 404",
                "seoImpact": "High",
                "seoRecommendation": "Fix or remove broken links to improve user experience",
                "elements": [
                  { "selector": "body > main > a", "textContent": "Partner site" }
                ]
              }
            ]
          },
          {
            "check": "bad-links",
            "issue": [
              {
                "url": "http://example.com/insecure",
                "issue": "Link using HTTP instead of HTTPS",
                "seoImpact": "High",
                "seoRecommendation": "Update all links to use HTTPS protocol",
                "elements": [
                  { "selector": "body > main > a.cta", "textContent": "Download" }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "headings",
        "type": "seo",
        "opportunities": [
          {
            "check": "heading-h1-length",
            "issue": "H1 too long",
            "issueDetails": "Exceeds recommended length",
            "seoImpact": "Moderate",
            "seoRecommendation": "Keep the H1 concise",
            "elements": [
              { "selector": "body > h1", "textContent": "A very long heading that exceeds the recommended maximum length for an H1 element" }
            ]
          },
          {
            "check": "heading-empty",
            "issue": "Empty heading",
            "issueDetails": "Heading element has no text",
            "seoImpact": "Moderate",
            "seoRecommendation": "Add text or remove the empty heading",
            "elements": [
              { "selector": "body > section > h2" }        // empty heading → no textContent
            ]
          }
        ]
      },
      {
        "name": "readability",
        "type": "seo",
        "opportunities": [
          {
            "check": "poor-readability",
            "issue": "Text element is difficult to read: \"The reputation of the city as a cultural nucleus...\"",
            "seoImpact": "Moderate",
            "fleschReadingEase": -10.12,
            "language": "english",
            "elements": [
              { "selector": "body > article > p:nth-of-type(2)", "textContent": "The reputation of the city as a cultural nucleus is bolstered by its extensive network of galleries..." }
            ]
          }
        ]
      },
      {
        "name": "accessibility",
        "type": "a11y",
        "opportunities": [
          {
            "check": "color-contrast",
            "type": "color-contrast",
            "wcagLevel": "AA",
            "wcagRule": "1.4.3 Contrast (Minimum)",
            "severity": "serious",
            "occurrences": 3,
            "description": "Elements must meet minimum color contrast ratio thresholds",
            "understandingUrl": "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html",
            "failureSummary": "Fix any of the following: Element has insufficient color contrast of 2.5:1",
            "htmlWithIssues": [                            // a11y uses its own element structure
              { "target_selector": "body > header > a.logo", "update_from": "<a class=\"logo\" href=\"/\">Home</a>" }
            ]
          }
        ]
      },
      {
        "name": "form-accessibility",
        "type": "form-a11y",
        "opportunities": [
          {
            "check": "label",
            "type": "label",
            "wcagLevel": "A",
            "wcagRule": "4.1.2 Name, Role, Value",
            "severity": "critical",
            "occurrences": 1,
            "description": "Form elements must have labels",
            "understandingUrl": "https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html",
            "failureSummary": "Fix any of the following: Form element does not have an associated label",
            "htmlWithIssues": [
              { "target_selector": "form#newsletter input[type=\"email\"]", "update_from": "<input type=\"email\" name=\"email\">" }
            ]
          }
        ]
      }
    ]
  }
]
```

## Full example response (one page, `suggest` step)

Same envelope and structure as `identify`, plus AI enrichment. **What changes vs `identify`:**

- **metatags** — each opportunity gains `aiSuggestion` + `aiRationale`; tags that received no AI suggestion are dropped.
- **links** (`broken-internal-links` / `broken-external-links`) — each finding gains `aiSuggestion` (a replacement URL) + `aiRationale`. `bad-links` is unchanged.
- **readability** — opportunities are reconstructed from AI output with **no DOM**, so the element is selector-less (`"elements": [ { "textContent": "..." } ]`), and each gains `suggestionStatus`, `suggestionMessage`, `improvedFleschScore`, `readabilityImprovement`, `aiSuggestion` (the improved text), `aiRationale`, `mystiqueProcessingCompleted`. (Excluded rows instead carry `suggestionStatus: "excluded"`, `exclusionReason`, `shouldExclude`.)
- **body-size, lorem-ipsum, h1-count, canonical, headings, accessibility, form-accessibility** — no AI enrichment; identical to `identify`.

```jsonc
[
  {
    "pageUrl": "https://main--example--site.aem.page/products",
    "step": "suggest",
    "audits": [
      {
        "name": "body-size",
        "type": "seo",
        "opportunities": [
          {
            "check": "content-length",
            "issue": "Body content length is below 100 characters",
            "seoImpact": "Moderate",
            "seoRecommendation": "Add more meaningful content to the page",
            "elements": [ { "selector": "body", "textContent": "Coming soon." } ]
          }
        ]
      },
      {
        "name": "lorem-ipsum",
        "type": "seo",
        "opportunities": [
          {
            "check": "placeholder-text",
            "issue": "Found Lorem ipsum placeholder text in the page content",
            "seoImpact": "High",
            "seoRecommendation": "Replace placeholder text with meaningful content",
            "elements": [
              { "selector": "body > div.hero > p",      "textContent": "Lorem ipsum dolor sit amet, consectetur..." },
              { "selector": "body > div.footer > span", "textContent": "...sed do eiusmod lorem ipsum tempor." }
            ]
          }
        ]
      },
      {
        "name": "h1-count",
        "type": "seo",
        "opportunities": [
          {
            "check": "multiple-h1",
            "issue": "Found 2 H1 tags",
            "seoImpact": "High",
            "seoRecommendation": "Use exactly one H1 tag per page for better SEO structure",
            "elements": [
              { "selector": "body > h1:nth-of-type(1)", "textContent": "Welcome" },
              { "selector": "body > h1:nth-of-type(2)", "textContent": "Our Products" }
            ]
          }
        ]
      },
      {
        "name": "canonical",
        "type": "seo",
        "opportunities": [
          {
            "check": "canonical-self-referenced",
            "issue": "The canonical URL should point to itself to indicate that it is the preferred version of the content.",
            "seoImpact": "Moderate",
            "seoRecommendation": "Update the canonical URL to point to itself",
            "url": "https://main--example--site.aem.page/products-old",
            "suggestion": "https://main--example--site.aem.page/products",
            "elements": [ { "selector": "head > link[rel=\"canonical\"]" } ]
          }
        ]
      },
      {
        "name": "metatags",
        "type": "seo",
        "opportunities": [
          {
            "tagName": "title",
            "issue": "Title too short",
            "issueDetails": "19 chars below limit",
            "seoImpact": "Moderate",
            "seoRecommendation": "40-60 characters long",
            "tagContent": "Products",
            "elements": [ { "selector": "head > title" } ],
            "aiSuggestion": "Products | Shop the Full Range — Example",   // added in suggest
            "aiRationale": "Adds brand and intent keywords to reach the 40-60 char range."
          }
        ]
      },
      {
        "name": "links",
        "type": "seo",
        "opportunities": [
          {
            "check": "broken-internal-links",
            "issue": [
              {
                "url": "https://main--example--site.aem.page/this-page-does-not-exist",
                "issue": "Status 404",
                "seoImpact": "High",
                "seoRecommendation": "Fix or remove broken links to improve user experience and SEO",
                "elements": [
                  { "selector": "body > nav > a:nth-of-type(1)",    "textContent": "Learn more" },
                  { "selector": "body > footer > a:nth-of-type(3)", "textContent": "Read the docs" }
                ],
                "aiSuggestion": "https://main--example--site.aem.page/products",   // added in suggest
                "aiRationale": "Closest live page under the same section."
              }
            ]
          },
          {
            "check": "bad-links",
            "issue": [
              {
                "url": "http://example.com/insecure",
                "issue": "Link using HTTP instead of HTTPS",
                "seoImpact": "High",
                "seoRecommendation": "Update all links to use HTTPS protocol",
                "elements": [ { "selector": "body > main > a.cta", "textContent": "Download" } ]
              }
            ]
          }
        ]
      },
      {
        "name": "headings",
        "type": "seo",
        "opportunities": [
          {
            "check": "heading-h1-length",
            "issue": "H1 too long",
            "issueDetails": "Exceeds recommended length",
            "seoImpact": "Moderate",
            "seoRecommendation": "Keep the H1 concise",
            "elements": [
              { "selector": "body > h1", "textContent": "A very long heading that exceeds the recommended maximum length for an H1 element" }
            ]
          }
        ]
      },
      {
        "name": "readability",
        "type": "seo",
        "opportunities": [
          {
            "check": "poor-readability",
            "issue": "Text element is difficult to read: \"The reputation of the city as a cultural nucleus...\"",
            "seoImpact": "Moderate",
            "fleschReadingEase": -10.12,
            "language": "english",
            "elements": [
              { "textContent": "The reputation of the city as a cultural nucleus is bolstered by its extensive network of galleries..." } // no selector — reconstructed without DOM
            ],
            "suggestionStatus": "completed",                     // added in suggest
            "suggestionMessage": "AI-powered readability improvement generated successfully.",
            "improvedFleschScore": 62.4,
            "readabilityImprovement": 72.52,
            "aiSuggestion": "The city is a cultural hub, with many galleries, theaters, and institutions for global visitors.",
            "aiRationale": "Shorter sentences and simpler words raise the Flesch score.",
            "mystiqueProcessingCompleted": "2026-08-06T10:15:30.000Z"
          }
        ]
      },
      {
        "name": "accessibility",
        "type": "a11y",
        "opportunities": [
          {
            "check": "color-contrast",
            "type": "color-contrast",
            "wcagLevel": "AA",
            "wcagRule": "1.4.3 Contrast (Minimum)",
            "severity": "serious",
            "occurrences": 3,
            "description": "Elements must meet minimum color contrast ratio thresholds",
            "understandingUrl": "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html",
            "failureSummary": "Fix any of the following: Element has insufficient color contrast of 2.5:1",
            "htmlWithIssues": [
              { "target_selector": "body > header > a.logo", "update_from": "<a class=\"logo\" href=\"/\">Home</a>" }
            ]
          }
        ]
      },
      {
        "name": "form-accessibility",
        "type": "form-a11y",
        "opportunities": [
          {
            "check": "label",
            "type": "label",
            "wcagLevel": "A",
            "wcagRule": "4.1.2 Name, Role, Value",
            "severity": "critical",
            "occurrences": 1,
            "description": "Form elements must have labels",
            "understandingUrl": "https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html",
            "failureSummary": "Fix any of the following: Form element does not have an associated label",
            "htmlWithIssues": [
              { "target_selector": "form#newsletter input[type=\"email\"]", "update_from": "<input type=\"email\" name=\"email\">" }
            ]
          }
        ]
      }
    ]
  }
]
```

## Field reference

### The `elements[]` contract (the consistency guarantee)

`elements[]` is the single, canonical home for a finding's offending DOM element(s):

```jsonc
"elements": [ { "selector"?: string, "textContent"?: string } ]
```

- `selector` — CSS locator (Universal-Editor-aware when available). **Optional**: absent when no stable locator can be generated.
- `textContent` — the element's visible text. **Optional**: absent when the element has no meaningful text (empty heading, or a link rewritten to an `<img>`).
- Each entry always has **at least one** of the two — this is guaranteed by the producer, which drops any entry that has neither. A consumer never sees an empty `{}` entry.
- **Multiple entries = multiple occurrences** of the same issue (e.g. two `<h1>`s, or one broken URL linked from several places); each can be located/highlighted independently.
- `elements` is **omitted entirely** only when there are zero emittable entries — i.e. **no selector *and* no element text**. This happens when the element is genuinely missing (`missing-h1`, `canonical-tag-missing`) or not present in the scraped body (e.g. a canonical whose `<link>` wasn't captured). Note:
  - **Text but no selector → `elements` is present** as `[{ "textContent": "..." }]` (selector-less entries are kept, never dropped).
  - `elements` and the top-level `url` are **independent** — `elements` can be omitted while `url` still carries the finding's value (e.g. a canonical format issue with no captured `<link>`).
- Some selectors point at `<head>` elements (`<title>`, `<meta>`, `<link rel="canonical">`) — they identify the node but have no rendered box to highlight.

### Finding-level value fields (not element text)

| Field | Meaning |
|-------|---------|
| `url` | Current/offending URL — canonical current href, or a broken/insecure link target. May be present with no `elements`. |
| `suggestion` | Recommended fix value (e.g. the page's own URL for canonical; a textual instruction for headings). |
| `tagContent` | Current value of a meta tag (title/description). |

### Checks per audit

| Audit (`name`) | `type` | Checks |
|----------------|--------|--------|
| body-size | seo | `content-length` |
| lorem-ipsum | seo | `placeholder-text` |
| h1-count | seo | `missing-h1` (no `elements`), `multiple-h1` |
| canonical | seo | `canonical-tag-missing`, `canonical-tag-no-href`, `canonical-tag-empty`, `canonical-tag-multiple`, `canonical-tag-outside-head`, `canonical-self-referenced`, format/status checks (`canonical-url-absolute`, protocol/domain/lowercased, `canonical-url-status-ok`, `canonical-url-no-redirect`, `canonical-url-4xx`, `canonical-url-5xx`) |
| metatags | seo | keyed by `tagName`: `title`, `description`, `h1` |
| links | seo | `broken-internal-links`, `broken-external-links`, `bad-links` (findings nested in an `issue[]` array) |
| headings | seo | `heading-missing-h1` (no `elements`), `heading-multiple-h1`, `heading-h1-length`, `heading-empty` (selector only), `heading-order-invalid` |
| readability | seo | `poor-readability` |
| accessibility | a11y | rule-based; `check`/`type` = WCAG rule / violation id; elements in `htmlWithIssues[]` |
| form-accessibility | form-a11y | as accessibility, scoped to form controls |

### Consistency summary

| Concept | Where it lives |
|---------|----------------|
| An offending element's visible text | `elements[].textContent` (every audit) |
| An offending element's location | `elements[].selector` (optional) |
| A finding's URL value | top-level `url` |
| A meta tag's current value | top-level `tagContent` |
| Accessibility offending elements | `htmlWithIssues[].{target_selector, update_from}` |

Notes:
- `suggestion` (= the page's own URL) is emitted for the canonical checks whose fix is unambiguously "point at this page": `canonical-tag-missing`, `canonical-tag-no-href`, `canonical-tag-empty`, `canonical-self-referenced`, `canonical-tag-multiple`. Format/status checks omit it.
- `canonical.url` is omitted when the tag has no (non-empty) href; `canonical.elements` lists all `<link rel="canonical">` tags for `canonical-tag-multiple`, otherwise the first, and is omitted when the tag isn't in the scraped body.
