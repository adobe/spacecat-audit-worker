# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run all tests (with coverage)
npm test

# Run a specific test file
npm run test:spec -- test/audits/forms/handler.test.js

# Run multiple specific test files
npm run test:spec -- test/audits/forms/handler.test.js test/audits/forms/utils.test.js

# Lint
npm run lint
npm run lint:fix

# Build (Helix deploy bundle)
npm run build

# Local SAM invocation
npm run local-build-run
```

Node 24 is required (see `.nvmrc`). The project is pure ESM (`"type": "module"`).

Coverage enforcement is strict: **100% lines, branches, and statements** across all `src/**/*.js` (excluding `src/index-local.js`). Every code path must be tested.

---

## Architecture Overview

This is an **AWS Lambda** function that processes SQS messages to run SEO/performance audits on Adobe customer sites. Each message carries an audit `type` and a `siteId`. The Lambda routes to one of ~100 audit handlers, runs the audit, persists results, and posts to downstream queues.

### Entry Point

`src/index.js` wraps the main handler in a middleware chain:

```
helixStatus → secrets → s3Client → sqs → logWrapper → sqsEventAdapter → dataAccess
```

The `sqsEventAdapter` middleware extracts the audit `type` from the SQS message and dispatches to the matching handler in the `HANDLERS` map.

### Audit Framework (`src/common/`)

All audits are built with `AuditBuilder` (builder pattern). There are three variants:

**`RunnerAudit`** — single-function audits:
```js
export default new AuditBuilder()
  .withRunner(async (auditUrl, context, site) => { /* returns auditData */ })
  .build();
```

**`StepAudit`** — multi-step audits for workflows that span multiple SQS messages (e.g., scrape → analyze → persist):
```js
export default new AuditBuilder()
  .addStep('step-name', handlerFn, 'DESTINATION_QUEUE')
  .addStep('next-step', nextHandlerFn, 'OTHER_QUEUE')
  .build();
```
The step is determined at runtime from `auditContext.next`. Each step can forward to a different SQS queue.

**Execution flow for `RunnerAudit`:**
1. Validate site (`isAuditEnabledForSite`)
2. Resolve URL (`composeAuditURL`)
3. Call runner function → returns `{ auditData, fullAuditRef, ... }`
4. Persist via `Audit.create()`
5. Run post-processors (send SQS results message, optional custom post-processors)

**Overridable providers on AuditBuilder:**
- `withSiteProvider(fn)` — how to fetch the site
- `withOrgProvider(fn)` — how to fetch the org
- `withUrlResolver(fn)` — how to resolve the canonical URL
- `withPersister(fn)` — how to save the audit result
- `withMessageSender(fn)` — how to emit the result message
- `withPostProcessors([fn])` — functions run after persist

### Audit Directory Structure

Each audit lives in `src/[audit-name]/` and typically contains:
- `handler.js` — exports the built audit (the Lambda handler)
- `opportunity-data-mapper.js` — `createOpportunityData(site, auditData, context)`
- `constants.js` — audit-specific constants
- Optionally: `utils.js`, `guidance-handler.js`, `kpi-metrics.js`

### Opportunities & Suggestions Pattern

Audits persist structured findings as `Opportunity` + `Suggestion` records in the DB:

1. **`convertToOpportunity`** (`src/common/opportunity.js`) — finds or creates an `Opportunity` record for the site/audit type, checks for Google connection, updates data sources.
2. **`syncSuggestions`** (`src/utils/data-access.js`) — diffs current audit findings against stored suggestions; adds new ones, removes resolved ones.
3. **`syncSuggestionsWithPublishDetection`** — extends `syncSuggestions` with fix-regression detection: detects when a previously fixed suggestion has regressed.

### Support Clients (`src/support/`)

| File | Purpose |
|------|---------|
| `sqs.js` | SQS send/receive (injected as middleware) |
| `s3-client.js` | S3 get/put/list |
| `athena-client.js` | Athena query execution |
| `bright-data-client.js` | Bright Data web scraping |
| `psi-client.js` | Google PageSpeed Insights API |

---

## Testing Patterns

Tests use **Mocha + Chai + Sinon + nock + esmock**.

### MockContextBuilder

`test/shared.js` exports `MockContextBuilder` — a fluent builder that creates the full mock Lambda context:

```js
const context = new MockContextBuilder()
  .withSandbox(sandbox)
  .withOverrides({ /* partial overrides */ })
  .build();
```

The built context includes stubs for `log`, `dataAccess` (Site, Audit, Opportunity, Suggestion, Configuration, AsyncJob), `sqs`, `env`, and `site`.

### Typical Test File Shape

```js
/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('[Audit] Tests', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();
  let context;

  beforeEach(() => {
    context = new MockContextBuilder().withSandbox(sandbox).withOverrides({...}).build();
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });
});
```

### Fixtures

`test/fixtures/[audit-name]/` holds JSON files used as mock API responses or sample audit data. Mirror the `src/` audit directory structure.

### ESM Module Mocking

Use `esmock` when you need to mock ES module imports within a source file under test:

```js
import esmock from 'esmock';
const { auditRunner } = await esmock('../../src/myaudit/handler.js', {
  '../../src/support/psi-client.js': { getPSIData: sandbox.stub().resolves({...}) }
});
```

---

## Documentation Requirements

**Significant new functionality** must be developed spec-first. Add a spec to `/docs/specs/`
following the template at
`https://github.com/solaris007/ai-first-guidelines/blob/main/docs/03-templates/spec-proposal.md`. The spec covers problem statement, goals, technical design, alternatives, and success criteria.

**Technical or architectural decisions with long-term impact** (non-obvious behavior choices, trade-offs) must be
recorded as
ADRs in `/docs/decisions/` numbered sequentially (001, 002, ...), following the template at `https://github.com/solaris007/ai-first-guidelines/blob/main/docs/03-templates/decision-record.md`. Use status values: `Proposed / Accepted / Deprecated / Superseded`.

**Keeping docs in sync**
* When implementation changes, update README in the same PR.
* When a decision is superseded, update its status field and link to the new ADR.
* Specs should reflect the implemented state once work is complete.

## Adding a New Audit

1. Create `src/[audit-name]/handler.js` with `AuditBuilder` and register it in `src/index.js` under `HANDLERS`.
2. For RunnerAudit: the runner receives `(auditUrl, context, site, auditContext)` and returns `{ auditData, fullAuditRef }`.
3. For StepAudit: define steps with `.addStep(name, handler, destinationQueue)`.
4. Add `test/audits/[audit-name].test.js` (or a sub-directory for complex audits).
5. Add fixtures to `test/fixtures/[audit-name]/`.
6. Ensure 100% coverage on all new source files.
