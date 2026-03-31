# Preflight Audit

The Preflight Audit is a comprehensive, multi-check SEO and accessibility validation system designed to analyze web pages before they go live. It performs various checks including canonical tags, links, metatags, headings, readability, and accessibility issues.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Structure](#structure)
- [How It Works](#how-it-works)
- [Adding a New Check](#adding-a-new-check)
- [Available Checks](#available-checks)
- [Configuration](#configuration)

## Overview

The Preflight Audit is an async job-based audit that:
- Validates multiple URLs in a single batch
- Performs SEO and accessibility checks
- Supports two operation modes: **identify** (detect issues) and **suggest** (provide AI-powered suggestions)
- Scrapes pages and analyzes their content for various SEO/accessibility issues
- Returns structured results with opportunities for improvement

## Architecture

The preflight audit follows a **handler-based architecture**:

```
handler.js (orchestrator)
    ├── Scrapes pages via content scraper
    ├── Executes DOM-based checks (inline)
    └── Delegates to individual check handlers
        ├── canonical.js
        ├── metatags.js
        ├── links.js
        ├── headings.js
        ├── readability.js
        └── accessibility.js
```

### Key Components

1. **handler.js**: Main orchestrator that coordinates all checks
2. **Individual check handlers**: Modular handlers for specific audit types
3. **utils.js**: Shared utilities for validation and result persistence
4. **links-checks.js**: Specialized module for link validation

## Structure

```
src/preflight/
├── handler.js              # Main orchestrator & entry point
├── utils.js                # Shared utilities
├── canonical.js            # Canonical tag validation
├── metatags.js             # Meta tags validation
├── links.js                # Internal/external link checks
├── links-checks.js         # Link validation logic
├── headings.js             # Heading structure validation
├── accessibility.js        # Accessibility checks via content scraper
└── README.md              # This file
```

## How It Works

### Step 1: Job Initialization

The audit receives a job with:
```javascript
{
  urls: ['https://example.com/page1', 'https://example.com/page2'],
  step: 'identify' | 'suggest',  // Operation mode
  enableAuthentication: true      // Whether to use page auth
}
```

### Step 2: Page Scraping

Pages are sent to the content scraper:
- Scraper fetches and caches page HTML
- Results stored in S3 bucket: `scrapes/{siteId}/{path}/scrape.json`
- Authentication tokens are applied if enabled

### Step 3: Check Execution

The handler executes checks in two phases:

#### Phase 1: DOM-Based Checks (Inline)
These checks run directly in the main handler:
- **body-size**: Validates body content length (>100 chars)
- **lorem-ipsum**: Detects placeholder text
- **h1-count**: Ensures exactly one H1 tag per page

#### Phase 2: Handler-Based Checks (Delegated)
Each enabled check handler is invoked sequentially:

1. **canonical** - Validates canonical tag format and presence
2. **metatags** - Checks title, description, OG tags, etc.
3. **links** - Validates internal/external links, checks for broken/insecure links
4. **headings** - Validates heading structure including hierarchy (H1-H6), empty headings, missing H1, H1 length, and multiple H1 issues
5. **readability** - Analyzes content readability
6. **accessibility** - Runs axe-core accessibility checks

### Step 4: Result Aggregation

Results are structured per page:
```javascript
{
  pageUrl: 'https://example.com/page1',
  step: 'identify',
  audits: [
    {
      name: 'canonical',
      type: 'seo',
      opportunities: [
        {
          check: 'missing-canonical',
          issue: 'No canonical tag found',
          seoImpact: 'High',
          seoRecommendation: 'Add a canonical tag',
          aiSuggestion: '...'  // Only in 'suggest' mode
        }
      ]
    }
  ],
  profiling: {
    total: '12.34 seconds',
    startTime: '2025-01-06T10:00:00.000Z',
    endTime: '2025-01-06T10:00:12.340Z',
    breakdown: [...]
  }
}
```

### Step 5: Job Completion

- Results are saved to the async job
- Job status updated to `COMPLETED` or `IN_PROGRESS` (if waiting for AI guidance)
- Intermediate results saved after each check

## Adding a New Check

### Option 1: Add a DOM-Based Check (Simple)

For checks that only need cheerio/DOM parsing:

1. **Define the check constant** in `handler.js`:
```javascript
export const AUDIT_NEW_CHECK = 'new-check';
```

2. **Add to AVAILABLE_CHECKS**:
```javascript
const AVAILABLE_CHECKS = [
  AUDIT_CANONICAL,
  // ... existing checks
  AUDIT_NEW_CHECK,  // Add here
];
```

3. **Implement the check logic** in `handler.js` (around line 200):
```javascript
const newCheckEnabled = enabledChecks.includes(AUDIT_NEW_CHECK);

if (newCheckEnabled) {
  // Initialize audit entry
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ 
      name: AUDIT_NEW_CHECK, 
      type: 'seo', 
      opportunities: [] 
    });
  });

  // Process scraped data
  scrapedObjects.forEach(({ data }) => {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const pageResult = audits.get(stripTrailingSlash(finalUrl));
    const $ = cheerioLoad(rawBody);
    
    const auditsByName = Object.fromEntries(
      pageResult.audits.map((auditEntry) => [auditEntry.name, auditEntry]),
    );

    // Your check logic here
    const issue = checkSomething($);
    if (issue) {
      auditsByName[AUDIT_NEW_CHECK].opportunities.push({
        check: 'specific-issue-type',
        issue: 'Description of the issue',
        seoImpact: 'High|Moderate|Low',
        seoRecommendation: 'How to fix it',
      });
    }
  });
}
```

### Option 2: Add a Handler-Based Check (Complex)

For checks that need external API calls, AI suggestions, or complex logic:

1. **Create a new handler file**: `src/preflight/your-check.js`

```javascript
import { saveIntermediateResults } from './utils.js';

export const PREFLIGHT_YOUR_CHECK = 'your-check';

export default async function yourCheck(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const startTime = Date.now();
  const startTimestamp = new Date().toISOString();

  // Create audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ 
      name: PREFLIGHT_YOUR_CHECK, 
      type: 'seo', 
      opportunities: [] 
    });
  });

  try {
    // Your check logic here
    // Process each URL
    for (const url of previewUrls) {
      const pageResult = audits.get(url);
      const audit = pageResult.audits.find(a => a.name === PREFLIGHT_YOUR_CHECK);
      
      // Detect issues
      const issues = await detectIssues(url, scrapedObjects);
      
      // Add AI suggestions if in 'suggest' mode
      if (step === 'suggest') {
        const suggestions = await generateSuggestions(issues, context);
        issues.forEach(issue => {
          audit.opportunities.push({
            ...issue,
            aiSuggestion: suggestions[issue.check],
          });
        });
      } else {
        issues.forEach(issue => audit.opportunities.push(issue));
      }
    }
  } catch (error) {
    log.error(`[preflight-audit] Your check failed: ${error.message}`);
  }

  const endTime = Date.now();
  const endTimestamp = new Date().toISOString();
  const elapsed = ((endTime - startTime) / 1000).toFixed(2);

  log.debug(`[preflight-audit] Your check completed in ${elapsed} seconds`);

  // Add profiling data
  timeExecutionBreakdown.push({
    name: 'your-check',
    duration: `${elapsed} seconds`,
    startTime: startTimestamp,
    endTime: endTimestamp,
  });

  // Save intermediate results
  await saveIntermediateResults(context, auditsResult, 'your check');
}
```

2. **Import and register** in `handler.js`:

```javascript
// At the top with other imports
import yourCheck from './your-check.js';

// Define constant
export const AUDIT_YOUR_CHECK = 'your-check';

// Add to AVAILABLE_CHECKS
const AVAILABLE_CHECKS = [
  AUDIT_CANONICAL,
  // ... existing checks
  AUDIT_YOUR_CHECK,
];

// Add to PREFLIGHT_HANDLERS
export const PREFLIGHT_HANDLERS = {
  canonical,
  metatags,
  links,
  headings,
  readability,
  accessibility,
  yourCheck,  // Handler name must match the constant (camelCase)
};
```

3. **Enable the check** for your site using the configuration system:
   - The check will be automatically included if `your-check-preflight` audit is enabled for the site

#### Any new check must keep the Preflight UI + API contracts in sync:

1. **Update the MFE types** in the [Preflight MFE repository](https://github.com/OneAdobe/aem-sites-optimizer-preflight-mfe/blob/main/src/types/audits.ts#L18-L28):
   - Add your new audit to the `audits` type definition to maintain the UI contract
   - This ensures consistent human-friendly labels, gates audit-specific rendering, and powers the loading UX before any API response arrives
   ```typescript
   export const audits = [
     'canonical',
     'metatags',
     // ... existing audits
     'your-check',  // Add here
   ] as const;
   ```

2. **Update Preflight API contract** in [spacecat-api-service repository](https://github.com/adobe/spacecat-api-service/tree/main):
   - Add your new check name to the `checks.items.enum` list in [spacecat-api-service/docs/openapi/preflight-api.yaml](https://github.com/adobe/spacecat-api-service/blob/main/docs/openapi/preflight-api.yaml#L36)
   - If you change API request / response structure beyond introducing a new check name, update the relevant schema in [spacecat-api-service/docs/openapi/schemas.yaml](https://github.com/adobe/spacecat-api-service/blob/main/docs/openapi/schemas.yaml)
   - Validate the OpenAPI docs after the change in `spacecat-api-service`:
     - `npm run docs:lint`
     - `npm run docs:build`
     - `npm run docs:serve` (optional, preview docs locally)


### Handler Contract

All handler functions must:
- Accept `(context, auditContext)` parameters
- Create audit entries in the `audits` Map
- Push opportunities to the audit's `opportunities` array
- Track execution time in `timeExecutionBreakdown`
- Save intermediate results using `saveIntermediateResults()`
- Handle errors gracefully with try/catch
- Return void or an object with `{ processing: boolean }` flag

## Available Checks

| Check Name | Type | Description | AI Suggestions |
|------------|------|-------------|----------------|
| `canonical` | SEO | Validates canonical tag presence and format | ❌ |
| `metatags` | SEO | Checks title, description, OG tags | ✅ |
| `links` | SEO | Detects broken internal/external links, insecure links | ✅ (internal only) |
| `headings` | SEO | Validates heading structure including hierarchy, empty headings, missing H1, H1 length, and multiple H1 issues | ✅ |
| `readability` | SEO | Analyzes content readability scores | ✅ |
| `accessibility` | A11Y | Runs axe-core accessibility checks | ❌ |
| `body-size` | SEO | Ensures sufficient content (>100 chars) | ❌ |
| `lorem-ipsum` | SEO | Detects placeholder text | ❌ |
| `h1-count` | SEO | Ensures exactly one H1 per page | ❌ |

## Configuration

### Site-Level Enablement

Checks are enabled per site using the audit configuration system. Each check is registered as:
- `{check-name}-preflight` (e.g., `canonical-preflight`, `links-preflight`)

The handler automatically determines which checks are enabled for a site and stores them in the job metadata.

### Environment Variables

Required environment variables:
- `S3_SCRAPER_BUCKET_NAME`: S3 bucket for scraped content
- `CONTENT_SCRAPER_QUEUE_URL`: SQS queue for content scraper
- `AUDIT_JOBS_QUEUE_URL`: SQS queue for audit jobs (callback for accessibility)

### Operation Modes

**Identify Mode** (`step: 'identify'`)
- Detects issues only
- Fast execution
- No AI suggestions

**Suggest Mode** (`step: 'suggest'`)
- Detects issues
- Generates AI-powered suggestions
- Slower execution due to LLM calls
- Requires healthy examples for brand guidelines

## Special Cases

### Accessibility Check

The accessibility check is unique because it:
1. Sends a separate scraping request to content scraper with `processingType: 'accessibility'`
2. Polls for results in S3 at `accessibility-preflight/{siteId}/{filename}.json`
3. Processes axe-core violations and maps them to opportunity types
4. Cleans up temporary S3 files after processing

### Links Check

The links check:
- Separates internal and external links
- Applies authentication only to internal links
- Falls back from HEAD to GET requests on errors
- Skips links in header/footer elements
- Generates AI suggestions for broken internal links in 'suggest' mode

### Metatags Check

The metatags check:
- Uses `SeoChecks` class to track healthy examples
- Generates brand guidelines from healthy tags
- Provides AI-powered suggestions in 'suggest' mode

## Testing

To test individual checks:
```bash
npm run test:spec -- test/audits/preflight/handler.test.js
```

To test specific check modules:
```bash
npm run test:spec -- test/audits/preflight/links.test.js
npm run test:spec -- test/audits/preflight/canonical.test.js
```

## Running Locally

### Quick Start

To run the preflight audit locally, follow the [How to Run Locally](https://github.com/adobe/spacecat-audit-worker?tab=readme-ov-file#how-to-run-locally) guide in the main repository.

For a more detailed setup with isolated environments for testing, refer to the [Developer Isolated Environments for Testing](https://wiki.corp.adobe.com/display/AEMSites/Developer+Isolated+Environments+for+Testing) wiki page.

### Running a Preflight Audit

Once your local environment is set up:

1. **Start the worker**:
   ```bash
   npm run start:local
   ```

2. **Trigger a preflight audit** via the API or SQS message:
   ```json
   {
     "type": "preflight",
     "url": "https://your-site.com",
     "auditContext": {
       "asyncJobId": "job-123"
     }
   }
   ```

3. **Monitor the async job** for results in your local DynamoDB

### Environment Setup

Ensure you have the following environment variables configured:
- `S3_SCRAPER_BUCKET_NAME`: Your local/dev S3 bucket
- `CONTENT_SCRAPER_QUEUE_URL`: Content scraper SQS queue URL
- `AUDIT_JOBS_QUEUE_URL`: Audit jobs SQS queue URL
- `DYNAMO_TABLE_NAME_ASYNC_JOBS`: DynamoDB table for async jobs
- `DYNAMO_TABLE_NAME_SITES`: DynamoDB table for sites
- `DYNAMO_TABLE_NAME_CONFIGURATIONS`: DynamoDB table for configurations

For a complete list of required environment variables and setup instructions, see the main [README](https://github.com/adobe/spacecat-audit-worker?tab=readme-ov-file).

## Performance Considerations

- **Intermediate Results**: Results are saved after each check to provide progress updates
- **Sequential Execution**: Handlers run sequentially (not in parallel) to manage resource usage
- **Polling**: Accessibility check uses 1-second polling intervals with 10-minute timeout
- **Profiling**: Each check tracks execution time for performance monitoring

## Error Handling

- Each handler has independent error handling
- Errors in one check don't fail the entire audit
- Failed checks log errors and continue to next check
- Job status set to `FAILED` only on catastrophic errors in the main handler

## Resources
- [ASO Preflight module Wiki](https://wiki.corp.adobe.com/display/AEMSites/ASO+Preflight+module)
- [Prerequisites for a site](https://wiki.corp.adobe.com/display/AEMSites/AEM+Sites+Optimizer+%7C+Preflight+Onboarding+Steps)
- [Customer Requests](https://wiki.corp.adobe.com/display/AEMSites/ASO+Preflight+%7C+Customer+Requests)
