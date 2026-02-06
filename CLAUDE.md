# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm start                  # Start development server with hot reload
npm test                   # Run unit tests (excludes Post-Deploy tests)
npm run test:spec          # Run tests with spec pattern
npm run test:bundle        # Test production bundle
npm run test-postdeploy    # Run post-deployment tests
npm run lint               # Run ESLint
npm run lint:fix           # Auto-fix linting issues
```

### Single Test Execution
```bash
npx mocha test/path/to/specific.test.js              # Run single test file
npx mocha test/path/to/specific.test.js -g "pattern" # Run tests matching pattern
```

### Local Testing with AWS SAM
```bash
./scripts/populate-env.sh  # Fetch secrets from AWS Secrets Manager
source env.sh              # Load environment variables
npm run local-build        # Build SAM template
npm run local-run          # Execute lambda locally
npm run local-watch        # Watch for changes and rebuild
```

### Deployment
```bash
npm run build              # Build production bundle with Helix Deploy
npm run deploy-dev         # Deploy to dev environment
npm run deploy-stage       # Deploy to stage environment
npm run deploy             # Deploy to production
npm run logs               # Tail AWS Lambda logs
```

## Architecture Overview

### Message-Driven Architecture

The audit worker is an AWS Lambda function triggered by SQS messages from the `AUDIT_JOBS_QUEUE`. Each message contains:

```json
{
  "type": "audit-type-name",
  "siteId": "uuid-of-site",
  "auditContext": {
    "slackContext": { /* optional slack notification config */ }
  }
}
```

The worker processes the audit, saves results to DynamoDB, and sends completion messages to the `AUDIT_RESULTS_QUEUE`.

### Entry Point Flow

**File**: `src/index.js`

```javascript
// 1. Register all audit handlers (80+ types)
const HANDLERS = {
  accessibility,
  apex,
  'broken-backlinks': brokenBacklinks,
  cwv,
  sitemap,
  // ... 80+ more audit types
};

// 2. Main execution
async function run(message, context) {
  const { type, siteId, auditContext } = message;

  // Get handler for audit type
  const handler = HANDLERS[type];

  // Fetch site from database
  const { dataAccess } = context;
  const site = await dataAccess.Site.findById(siteId);

  // Execute audit
  return handler(message, context);
}

// 3. Wrap with middleware (logging, data access, SQS, S3, secrets)
export const main = wrap(run)
  .with(dataAccess)
  .with(sqsEventAdapter)
  .with(logWrapper)
  .with(sqs)
  .with(s3Client)
  .with(secrets)
  .with(helixStatus);
```

### Audit Types

**Two Patterns:**

#### 1. Traditional (Runner-based) Audits
Single-function audits that execute in one pass. Best for straightforward checks.

**Example**: `src/apex/handler.js`
```javascript
export async function auditRunner(baseURL, context, site) {
  // Check if www and non-www versions are accessible
  const results = await checkApex(baseURL);

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .build();
```

#### 2. Step-based Audits
Multi-step workflows where each step can be processed by different workers. Steps coordinate via SQS messages.

**Example**: Content analysis audit
```javascript
export default new AuditBuilder()
  // Step 1: Scrape content
  .addStep('scrape', async (context) => {
    const { site, finalUrl } = context;
    return {
      auditResult: { status: 'scraping' },
      fullAuditRef: `s3://bucket/${site.getId()}/content.json`,
      urls: [{ url: finalUrl }],
    };
  }, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)

  // Step 2: Process scraped content
  .addStep('process', async (context) => {
    const { audit } = context;
    const content = await fetchFromS3(audit.getFullAuditRef());
    return { type: 'import', siteId: audit.getSiteId() };
  }, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)

  // Step 3: Analyze results (no destination = final step)
  .addStep('analyze', async (context) => {
    const results = await analyzeContent(context.audit);
    return { status: 'complete', findings: results };
  })
  .build();
```

### The AuditBuilder Pattern

**File**: `src/common/audit-builder.js`

The AuditBuilder uses a fluent API to construct audits with customizable components:

```javascript
new AuditBuilder()
  // 1. Site Provider (default: fetch from database)
  .withSiteProvider(customSiteProvider)

  // 2. URL Resolver (default: follow redirects to finalUrl)
  .withUrlResolver(customUrlResolver)

  // 3. Runner (for traditional audits)
  .withRunner(auditRunner)

  // OR Steps (for step-based audits)
  .addStep('name', stepHandler, DESTINATION)

  // 4. Persister (default: save to DynamoDB)
  .withPersister(customPersister)

  // 5. Message Sender (default: send to audit-results queue)
  .withMessageSender(customMessageSender)

  // 6. Post Processors (generate opportunities/suggestions)
  .withPostProcessors([generateSuggestions, createOpportunities])

  .build();
```

**Default Implementations** (`src/common/base-audit.js`):
- `defaultSiteProvider` - Fetches site from database by siteId
- `defaultUrlResolver` - Follows redirects to get finalUrl
- `defaultPersister` - Saves audit to DynamoDB
- `defaultMessageSender` - Sends result to audit-results SQS queue
- `noopUrlResolver` - Uses baseURL as-is (no redirect following)
- `noopPersister` - Skips persisting (for intermediate steps)

**Execution Flow for Traditional Audits**:
```
1. siteProvider(siteId) → site object
2. isAuditEnabledForSite(type, site) → check configuration
3. urlResolver(site) → finalUrl after redirects
4. runner(finalUrl, context, site) → { auditResult, fullAuditRef }
5. persister(auditData) → save to database
6. messageSender(resultMessage) → send to SQS
7. postProcessors(auditData) → generate opportunities/suggestions
```

**Step-based Audit Context**:
- First step: receives `finalUrl`, returns `auditResult` + `fullAuditRef`
- Intermediate steps: receive `audit` object from previous step
- Final step: no destination, result saved as final audit result
- All steps: have access to `site`, `log`, `dataAccess`, `sqs`, `s3Client`

### Directory Structure

```
src/
├── [audit-name]/
│   ├── handler.js              # Main audit implementation
│   ├── guidance-handler.js     # Optional: AI-generated guidance
│   └── opportunity-data-mapper.js # Optional: Opportunity mapping
├── common/
│   ├── audit-builder.js        # Builder pattern for audits
│   ├── base-audit.js          # Base audit class with defaults
│   ├── runner-audit.js        # Traditional audit implementation
│   ├── step-audit.js          # Step-based audit implementation
│   ├── opportunity.js         # Opportunity creation logic
│   └── audit-utils.js         # Shared utilities
└── utils/
    ├── data-access.js         # Database helpers
    └── [various utils]

test/
├── audits/                    # Audit-specific tests
├── common/                    # Common infrastructure tests
├── fixtures/                  # Test data
└── shared.js                  # MockContextBuilder for tests
```

### Data Access Layer

Uses `@adobe/spacecat-shared-data-access` (external package) for DynamoDB access:

```javascript
const { dataAccess } = context;
const { Site, Audit, Organization, Configuration } = dataAccess;

// Fetch site
const site = await Site.findById(siteId);
const baseURL = site.getBaseURL();

// Check configuration
const config = await Configuration.findLatest();
const isEnabled = config.isHandlerEnabledForSite(auditType, site);

// Save audit
const audit = await Audit.create({
  siteId,
  auditType,
  auditedAt: new Date().toISOString(),
  auditResult: { /* results */ },
  fullAuditRef: 's3://bucket/path',
});
```

**Key Models**:
- `Site` - Websites being audited
- `Audit` - Historical audit results
- `LatestAudit` - Optimized view of most recent audits
- `Organization` - Multi-tenant container for sites
- `Configuration` - Global configuration (feature flags, handler settings)
- `Opportunity` - Issues/recommendations
- `Suggestion` - AI-generated suggestions for opportunities

### Opportunities and Suggestions

**Opportunities** represent issues or recommendations for a site. **Suggestions** are AI-generated fixes for opportunities.

**Creating Opportunities** (in post-processors):

```javascript
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';

export async function opportunityHandler(auditUrl, auditData, context) {
  const { log, dataAccess } = context;

  // Create or update opportunity
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData, // mapper function
    'audit-type'
  );

  // Generate suggestions
  const suggestions = auditData.auditResult.issues.map(issue => ({
    type: 'suggestion-type',
    rank: calculateRank(issue),
    data: { fix: generateFix(issue) },
  }));

  // Sync suggestions to opportunity
  await syncSuggestions(
    opportunity,
    suggestions,
    (suggestion) => `${suggestion.type}-${suggestion.data.fix}`, // unique key
    context
  );

  return auditData;
}

// Opportunity data mapper
export function createOpportunityData(auditData) {
  return {
    title: 'Issue Title',
    description: 'Description of the issue',
    guidance: {
      steps: ['Step 1', 'Step 2'],
    },
    tags: ['seo', 'performance'],
    data: auditData.auditResult,
  };
}
```

### Configuration and Feature Flags

Audits can be enabled/disabled per site via the Configuration model:

```javascript
const { Configuration } = context.dataAccess;
const config = await Configuration.findLatest();

// Check if audit is enabled for site
if (!config.isHandlerEnabledForSite(auditType, site)) {
  log.info(`Audit ${auditType} is disabled for site ${siteId}`);
  return;
}

// Get handler-specific config
const handlerConfig = config.getHandlers()?.[auditType];
```

**Product Entitlements**: Some audits require specific product codes:

```javascript
// In handler configuration
handler.productCodes = ['LLMO_OPTIMIZER'];

// Validates using TierClient before running audit
const hasEntitlement = await checkProductCodeEntitlements(
  handler.productCodes, site, context
);
```

## Creating a New Audit

### Step 1: Create Handler File

```bash
# Create directory
mkdir src/my-audit

# Create handler
touch src/my-audit/handler.js
```

### Step 2: Implement Audit

**For Traditional Audit**:
```javascript
// src/my-audit/handler.js
export async function auditRunner(baseURL, context, site) {
  const { log, dataAccess } = context;

  log.info(`Running my-audit for ${baseURL}`);

  // Your audit logic here
  const results = await performAudit(baseURL);

  return {
    auditResult: {
      success: true,
      score: results.score,
      details: results.details,
    },
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .build();
```

**For Step-based Audit**:
```javascript
import { Audit } from '@adobe/spacecat-shared-data-access';
const { AUDIT_STEP_DESTINATIONS } = Audit;

export default new AuditBuilder()
  .addStep('step1', async (context) => {
    // First step must return auditResult and fullAuditRef
    return {
      auditResult: { status: 'in-progress' },
      fullAuditRef: 's3://bucket/path',
    };
  }, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)

  .addStep('step2', async (context) => {
    // Final step - no destination
    return { status: 'complete' };
  })
  .build();
```

### Step 3: Register Handler

```javascript
// src/index.js
import myAudit from './my-audit/handler.js';

const HANDLERS = {
  // ... existing handlers
  'my-audit': myAudit,
};
```

### Step 4: Add Tests

```javascript
// test/audits/my-audit.test.js
import { expect } from 'chai';
import { MockContextBuilder } from '../shared.js';
import myAuditHandler from '../../src/my-audit/handler.js';

describe('My Audit', () => {
  it('should audit a site', async () => {
    const mockContext = new MockContextBuilder()
      .withSandboxedURL()
      .build();

    const result = await myAuditHandler.run(
      { type: 'my-audit', siteId: 'site-123' },
      mockContext
    );

    expect(result.auditResult.success).to.be.true;
  });
});
```

### Step 5: Test Locally

```bash
# Start dev server
npm start

# Trigger audit
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{ "type": "my-audit", "siteId": "site-uuid" }'

# Check results
npm run test -- test/audits/my-audit.test.js
```

## Common Patterns

### Skip URL Resolution
Use site's baseURL as-is without following redirects:
```javascript
new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .build();
```

### Skip Persisting
Don't save audit to database (useful for intermediate steps):
```javascript
new AuditBuilder()
  .withPersister(noopPersister)
  .withRunner(auditRunner)
  .build();
```

### Skip SQS Notification
Don't send audit results to queue:
```javascript
new AuditBuilder()
  .withRunner(auditRunner)
  .withMessageSender(() => {}) // noop
  .build();
```

### Add Opportunities
Generate opportunities and suggestions from audit results:
```javascript
new AuditBuilder()
  .withRunner(auditRunner)
  .withPostProcessors([generateSuggestions, opportunityHandler])
  .build();
```

### Async Job Pattern
For long-running operations:
```javascript
new AuditBuilder()
  .withRunner(auditRunner)
  .withAsyncJob() // Runs in background, updates audit when complete
  .build();
```

## Testing

### Test Structure
- **Unit tests**: `test/audits/` - Mock all external dependencies
- **Fixtures**: `test/fixtures/` - Test data (sites, audit results)
- **Shared utilities**: `test/shared.js` - MockContextBuilder

### MockContextBuilder
```javascript
const mockContext = new MockContextBuilder()
  .withSandboxedURL() // Sets up nock for HTTP mocking
  .withSite({
    id: 'site-123',
    baseURL: 'https://example.com',
  })
  .withDataAccess({
    Site: {
      findById: stub().resolves(mockSite),
    },
    Audit: {
      create: stub().resolves(mockAudit),
    },
  })
  .build();
```

### Mocking HTTP Calls
```javascript
import nock from 'nock';

nock('https://example.com')
  .get('/')
  .reply(200, '<html>content</html>');
```

### Running Tests
```bash
npm test                      # All tests
npm test -- test/audits/my-audit.test.js  # Single file
npm test -- -g "specific test"            # Pattern match
c8 npm test                   # With coverage
```

## Local Development

### Environment Setup

1. **Get AWS credentials from KLAM** (dev profile only, never production)
2. **Create `.env` file**:
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_SESSION_TOKEN=your-token
DYNAMO_TABLE_NAME_DATA=spacecat-services-data
S3_SCRAPER_BUCKET_NAME=spacecat-scraper-results
```

3. **Fetch secrets**:
```bash
./scripts/populate-env.sh
```

### Running Locally

**Option 1: Direct execution (hot reload)**
```bash
export $(cat .env | xargs)
npm start
```

**Option 2: Test bundled Lambda**
```bash
npm run build
cd dist/spacecat-services
unzip audit-worker@*.zip -d unpacked/
cd ../..
npm run start:unpacked
```

### Triggering Audits

```bash
# Get a siteId
curl -H "x-api-key: YOUR_KEY" \
  "https://spacecat.experiencecloud.live/api/v1/sites?baseURL=https://example.com"

# Trigger audit
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "type": "apex",
    "siteId": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
  }'
```

### Checking Results

```bash
# Via API
curl -H "x-api-key: YOUR_KEY" \
  "https://spacecat.experiencecloud.live/api/v1/sites/{siteId}/latest-audit/apex"

# Check timestamp to verify it's your run
```

## Deployment

### Deploy Commands
```bash
npm run deploy-dev    # Dev environment
npm run deploy-stage  # Stage environment
npm run deploy        # Production (requires approval)
```

### Monitoring
```bash
npm run logs          # Tail Lambda logs
```

## Important Notes

### Site Validation
Some sites require validation before audits can run. Check:
```javascript
const site = await Site.findById(siteId);
if (site.needsValidation() && !site.isValidated()) {
  throw new Error('Site requires validation');
}
```

### Error Handling
Always handle errors gracefully:
```javascript
try {
  const result = await performAudit(url);
  return { auditResult: { success: true, ...result } };
} catch (error) {
  log.error('Audit failed', error);
  return {
    auditResult: {
      success: false,
      error: error.message,
    },
  };
}
```

### Static Files
Static files (prompts, SQL queries, schemas) must be declared in `package.json`:
```json
{
  "hlx": {
    "static": [
      "static/prompts/my-prompt.prompt",
      "src/my-audit/sql"
    ]
  }
}
```

### AWS Layers
Dependencies like Puppeteer and Chromium are in Lambda layers (not bundled):
- `spacecat-chrome-aws-lambda` - Chromium binary
- `spacecat-puppeteer` - Puppeteer packages
- `spacecat-sharp-layer` - Image processing

Do not add these to `package.json` dependencies.
