# SpaceCat Audit Worker

> SpaceCat Audit Worker for auditing edge delivery sites.

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe-rnd/spacecat-audit-worker.svg)](https://codecov.io/gh/adobe-rnd/spacecat-audit-worker)
[![CircleCI](https://img.shields.io/circleci/project/github/adobe-rnd/spacecat-audit-worker.svg)](https://circleci.com/gh/adobe-rnd/spacecat-audit-worker)
[![GitHub license](https://img.shields.io/github/license/adobe-rnd/spacecat-audit-worker.svg)](https://github.com/adobe-rnd/spacecat-audit-worker/blob/master/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe-rnd/spacecat-audit-worker.svg)](https://github.com/adobe-rnd/spacecat-audit-worker/issues)
[![LGTM Code Quality Grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/adobe-rnd/spacecat-audit-worker.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/adobe-rnd/spacecat-audit-worker)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

```bash
$ npm install @adobe/spacecat-audit-worker
```

## Usage

See the [API documentation](docs/API.md).

## Development

### Build

```bash
$ npm install
```

### Test

```bash
$ npm test
```

### Lint

```bash
$ npm run lint
```

## Message Body Formats

Audit worker consumes the `AUDIT_JOBS_QUEUE` queue, performs the requested audit, then queues the result to `AUDIT_RESULTS_QUEUE` for the interested parties to consume later on.

Expected message body format in `AUDIT_JOBS_QUEUE` is:

```json
{
  "type": "string",
  "url": "string",
  "auditContext": "object"
}
```

Output message body format sent to `AUDIT_RESULTS_QUEUE` is:

```json
{
  "type": "string",
  "url": "string",
  "auditContext": "object",
  "auditResult": "object"
}
```

## Required ENV Variables

Currently, audit worker requires a couple of env variables:

```plaintext
AUDIT_RESULTS_QUEUE_URL=url of the queue to send audit results to
RUM_DOMAIN_KEY=global domain key for the rum api
PAGESPEED_API_BASE_URL = URL of the pagespeed api
DYNAMO_TABLE_NAME_SITES = name of the dynamo table to store site data
DYNAMO_TABLE_NAME_AUDITS = name of the dynamo table to store audit data
DYNAMO_TABLE_NAME_LATEST_AUDITS = name of the dynamo table to store latest audit data
DYNAMO_INDEX_NAME_ALL_SITES = name of the dynamo index to query all sites
DYNAMO_INDEX_NAME_ALL_LATEST_AUDIT_SCORES = name of the dynamo index to query all latest audits by scores
```

## Audit Worker Flow

![SpaceCat (Star Catalogue) - Audit Flow](https://github.com/adobe/spacecat-audit-worker/assets/1171225/78632887-3edf-4aee-b28a-4cecc3c28fc8)


## What is a Spacecat Audit

A Spacecat audit is an operation designed for various purposes, including inspection, data collection, verification, and more, all performed on a given `URL`. Spacecat supports two types of audits:

1. **Traditional (Runner-based) Audits**: Single-function audits that execute their logic in one pass. Best for straightforward checks like uptime monitoring or performance scoring.

2. **Step-based Audits**: Multi-step workflows where each step can be processed by different specialized workers. Ideal for complex scenarios requiring different processing capabilities or coordination between multiple services.

Spacecat audits run periodically: weekly, daily, and even hourly. By default, the results of these audits are automatically stored in DynamoDB and sent to the `audit-results-queue`. The results can then be queried by type via [the Spacecat API](https://opensource.adobe.com/spacecat-api-service/#tag/audit).

## Audit Steps

A Spacecat audit consists of seven steps, six of which are provided by default. The only step that typically changes between different audits is the core runner, which contains the business logic.

1. **Site Provider**: This step reads the message with `siteId` information and retrieves the site object from the database. By default, the `defaultSiteProvider` reads the site object from the Star Catalogue. This step can be overridden.
1. **Org Provider**: This step retrieves the organization information from the Star Catalogue. This step can be overridden.
1. **URL Resolver**: This step calculates which URL to run the audit against. By default, the `defaultUrlResolver` sends an HTTP request to the site's `baseURL` and returns the `finalURL` after following the redirects. This step can be overridden.
1. **Runner**: The core function that contains the audit's business logic. **No default runner is provided**. The runner should return an object with `auditResult`, which holds the audit result, and `fullAuditRef`, a string that holds a reference (often a URL) to the audit.
1. **Persister**: The core function that stores the `auditResult`, `fullAuditRef`, and the audit metadata. By default, the `defaultPersister` stores the information back in the Star Catalogue.
1. **Message Sender**: The core function that sends the audit result to a downstream component via a message (queue, email, HTTP). By default, the `defaultMessageSender` sends the audit result to the `audit-results-queue` in Spacecat.
1. **Post Processors**: A list of post-processing functions that further process the audit result for various reasons. By default, no post processor is provided. These should be added only if needed.

## How to create a new Audit

When implementing a new audit, first decide which type of audit best suits your needs:

- Choose a **Traditional (Runner-based) Audit** when:
  - Your audit logic can execute in a single pass
  - You don't need to coordinate with other specialized workers
  - The processing time fits within Lambda execution limits
  - Example: Checking site uptime, collecting CWV metrics

- Choose a **Step-based Audit** when:
  - Your audit requires multiple specialized processing steps
  - You need to coordinate with other workers (e.g., content scrapers)
  - Processing might exceed Lambda execution limits
  - Example: Content analysis requiring scraping, processing, and analysis steps

### Creating a Traditional Audit

To create a traditional audit, you'll need to create an audit handler function. This function should accept a `url` and a `context` (see [HelixUniversal](https://github.com/adobe/helix-universal/blob/main/src/adapter.d.ts#L120) ) object as parameters, and it should return an `auditResult` along with `fullAuditRef`. Here's an example:

```js
export async function auditRunner(url, context) {

  // your audit logic goes here...

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .build();

```

### Creating a Step-based Audit

For step-based audits, use the `addStep()` method...

### How to customize audit steps

All audits share common components, such as persisting audit results to a database or sending them to SQS for downstream components to consume. These common functionalities are managed by default functions. However, if desired, you can override them as follows:

```js
export async function auditRunner(url, context) {

  // your audit logic goes here...

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

export async function differentUrlResolver(site) {
  // logic to override to default behavior of the audit step

  return 'url';
}

export default new AuditBuilder()
  .withUrlResolver(differentUrlResolver)
  .withRunner(auditRunner)
  .build();

```

### How to prevent audit result to sent to SQS queue

Using a noop messageSender, audit results might not be sent to the audit results SQS queue:

```js
export async function auditRunner(url, context) {

  // your audit logic goes here...

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .withMessageSender(() => {}) // no-op message sender
  .build();

```

### How to add a custom post processor

You can add a post-processing step for your audit using `AuditBuilder`'s `withPostProcessors` function. The list of post-processing functions will be executed sequentially after the audit run.

Post-processor functions take two params: `auditUrl` and `auditData` as following. `auditData` object contains following properties:

```
auditData = {
  siteId: string,
  isLive: boolean,
  auditedAt: string,
  auditType: string,
  auditResult: object,
  fullAuditRef: string,
};
```

Here's the full example:

```js
export async function auditRunner(url, context) {

  // your audit logic goes here...

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

async function postProcessor(auditUrl, auditData, context) {
  // your post-processing logic goes here
  // you can obtain the dataAccess from context
  // { dataAccess } = context;
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .withPostProcessors([ postProcessor ]) // you can submit multiple post processors
  .build();

```

### How to add Opportunities and Suggestions

In the handler, the `opportunityAndSuggestions` function is responsible for converting audit data into an opportunity and synchronizing suggestions.

This function utilizes the `convertToOpportunity` function to create or update an opportunity based on the audit data and type.

The `buildKey` function is used to generate a unique key for each suggestion based on specific properties of the audit data.

It then uses the `syncSuggestions` function to map new suggestions to the opportunity and synchronize them.

```js
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const { log } = context;
  
  // buildKey and SyncSuggestions logic based on the auditType goes here...
)};
```
```js
export default new AuditBuilder()
  .withRunner(auditRunner)
  .withPostProcessors([opportunityAndSuggestions])
  .build();
```


The logic for converting to an opportunity is in `common/opportunity.js`. The function `convertToOpportunity` is used to create a new opportunity or update an existing one based on the audit type. The function takes the audit URL, audit data, context, createOpportunityData, auditType, and props as arguments. It first fetches the opportunities for the site. If the opportunity is not found, it creates a new one. If the opportunity is found, it updates the existing one with the new data. The function returns the opportunity entity.


How to map the opportunity data in the handler's `opportunity-data-mapper.js` file:

```js
export function createOpportunityData(parameters) {
  return {
    runbook: 'runbook',
    origin: 'origin',
    title: 'title',
    description: 'description',
    guidance: {
      steps: [
        'step1',
        'step2',
      ],
    },
    tags: ['tag1'],
    data: {data},
  };
}
```


### How to add auto-suggest to an audit
A new auto-suggest feature can be added as a post processor step to the existing audit.

The `AuditBuilder` is chaining all post processors together and passing the `auditData` object to each post processor.
The `auditData` object can be updated by each post processor and the updated `auditData` object will be passed to the next post processor.
If the `auditData` object is not updated by a post processor, the previous `auditData` object will be used.

The auto-suggest post processor should verify if the site is enabled for suggestions and if the audit was run successfully:

```js
export const generateSuggestionData = async (finalUrl, auditData, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;

  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping suggestions generation');
    return { ...auditData };
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('[audit-name]-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return {...auditData};
  }
}
```

```js
export default new AuditBuilder()
  .withRunner(auditRunner)
  .withPostProcessors([ generateSuggestionData, convertToOpportunity ])
  .build();
```

## Step-Based Audits

Spacecat supports multi-step audit workflows where each step can be processed by different workers. This enables complex audit scenarios that may require different processing capabilities or need to be split across multiple services.

### Creating a Step-Based Audit

Here's an example of how to create a step-based audit:

```js
import { Audit } from '@adobe/spacecat-shared-data-access';

const { AUDIT_STEP_DESTINATIONS } = Audit;

export default new AuditBuilder()
  // First step: Prepare content scraping
  .addStep('prepare', async (context) => {
    const { site, finalUrl, log } = context;
    log.info(`Preparing content scrape for ${site.getBaseURL()}`);
    
    // First step MUST return auditResult and fullAuditRef
    return {
      auditResult: { status: 'preparing' },
      fullAuditRef: `s3://content-bucket/${site.getId()}/raw.json`,
      // Additional data for content scraper
      urls: [{ url: finalUrl }],
      siteId: site.getId(),
    };
  }, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)

  // Second step: Process results
  .addStep('process', async (context) => {
    const { site, audit } = context;
    // Access previous audit data via audit.getFullAuditRef()
    return {
      type: 'content-import',
      siteId: site.getId(),
    };
  }, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)

  // Final step: Analyze results (no destination needed for final step)
  .addStep('analyze', async (context) => {
    const { audit } = context;
    const results = await analyzeContent(audit.getFullAuditRef());
    return {
      status: 'complete',
      findings: results,
    };
  })
  .build();
```

### Step Requirements

1. **First Step**
   - Must return an object containing both `auditResult` and `fullAuditRef`
   - These are used to create the initial audit record
   - Receives `finalUrl` in context (resolved from site's baseURL)
   - No previous audit data available in context

2. **Intermediate Steps**
   - Must specify a destination queue via `AUDIT_STEP_DESTINATIONS`
   - Return data will be formatted according to destination requirements
   - Have access to audit record via `context.audit`
   - Can access previous step data via `audit.getFullAuditRef()`

3. **Final Step**
   - Must not specify a destination
   - Return data will be stored as the final audit result
   - Has access to all previous audit data via `context.audit`

### Step Context

Each step receives a context object containing:
- `site`: The site being audited (with methods like `getBaseURL()`, `getId()`)
- `audit`: The audit record (undefined for first step)
- `finalUrl`: The resolved URL (only in first step)
- Standard context properties (`log`, `dataAccess`, etc.)

### Destinations

The `AUDIT_STEP_DESTINATIONS` enum defines supported destination queues. Each destination has specific payload format requirements:

```js
CONTENT_SCRAPER: {
  // Formats payload for content scraper queue
  payload: {
    urls: Array<{url: string}>,
    jobId: string,
    auditContext: {
      next: string,
      auditId: string,
      auditType: string,
      fullAuditRef: string
    }
  }
}

IMPORT_WORKER: {
  // Formats payload for import worker queue
  payload: {
    type: string,
    siteId: string,
    auditContext: {
      next: string,
      auditId: string,
      auditType: string,
      fullAuditRef: string
    }
  }
}
```

### Error Handling

The step-based audit implementation includes several validations:

1. **Step Configuration**
   - All steps except the last must specify a valid destination
   - Step handlers must be functions
   - First step must return both `auditResult` and `fullAuditRef`

2. **Audit Context**
   - For subsequent steps, audit ID must be valid
   - Audit record must exist in database
   - Audit type must match current audit

3. **Destination Validation**
   - Destinations must be from `AUDIT_STEP_DESTINATIONS`
   - Each destination must have valid queue URL and payload formatting

If any validation fails, the audit will throw an error and stop processing.

### Message Flow Example

Here's how messages flow between workers in a step-based audit:

```js
// 1. Initial trigger message to audit-worker
{
  "type": "content-audit",
  "siteId": "123",
  "auditContext": {}
}

// 2. After first step, audit-worker sends to content-scraper
{
  "urls": [{ "url": "https://example.com" }],
  "jobId": "audit-456",
  "auditContext": {
    "next": "process",
    "auditId": "audit-456",
    "auditType": "content-audit",
    "fullAuditRef": "s3://content-bucket/123/raw.json"
  }
}

// 3. Content-scraper completes, sends to audit-worker
{
  "type": "content-audit",
  "siteId": "123",
  "auditContext": {
    "next": "process",
    "auditId": "audit-456",
    "auditType": "content-audit",
    "fullAuditRef": "s3://content-bucket/123/raw.json"
  }
}

// 4. Audit-worker processes second step, sends to import-worker
{
  "type": "content-import",
  "siteId": "123",
  "auditContext": {
    "next": "analyze",
    "auditId": "audit-456",
    "auditType": "content-audit",
    "fullAuditRef": "s3://content-bucket/123/raw.json"
  }
}

// 5. Import-worker completes, sends to audit-worker
{
  "type": "content-audit",
  "siteId": "123",
  "auditContext": {
    "next": "analyze",
    "auditId": "audit-456",
    "auditType": "content-audit",
    "fullAuditRef": "s3://content-bucket/123/processed.json"
  }
}

// 6. Final step completes, audit-worker sends results
{
  "type": "content-audit",
  "url": "https://example.com",
  "auditContext": {
    "auditId": "audit-456",
    "auditType": "content-audit",
    "fullAuditRef": "s3://content-bucket/123/processed.json"
  },
  "auditResult": {
    "status": "complete",
    "findings": [/*...*/]
  }
}
```

Each message preserves the `auditContext` to maintain the step chain. The `next` field determines which step runs next, while `auditId` and `fullAuditRef` track the audit state across workers.

## Run Audits locally

You can run the audit locally using AWS SAM and Docker.

1. Ensure you have [Docker](https://docs.docker.com/desktop/setup/install/mac-install/), [AWS SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) and [jq](https://jqlang.org/) installed.
2. Login to AWS using [KLAM](https://klam.corp.adobe.com/) and login with your AWS CLI.
3. To provide secrets to the audit, please run `./populate-env.sh` once. It will fetch all secrets from the AWS Secret Manager.
4. To run the audit locally, execute the following commands:
    ```bash
    source env.sh
    npm run local-build
    npm run local-run
    ```
5. Starting point of the execution is `src/index-local.js`. Output of the audit can be found in `output.txt`.

If you need to add additional secrets, make sure to adjust the Lambda `template.yml` accordingly.
