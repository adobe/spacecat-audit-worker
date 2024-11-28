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

A Spacecat audit is an operation designed for various purposes, including inspection, data collection, verification, and more, all performed on a given `URL`.

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

To create a new audit, you'll need to create an audit handler function. This function should accept a `url` and a `context` (see [HelixUniversal](https://github.com/adobe/helix-universal/blob/main/src/adapter.d.ts#L120) ) object as parameters, and it should return an `auditResult` along with `fullAuditRef`. Here's an example:

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
```js
import { syncSuggestions } from '../utils/data-access.js';

export async function auditRunner(url, context) {

  // your audit logic goes here...

  return {
    auditResult: results,
    fullAuditRef: baseURL,
  };
}

async function convertToOpportunity(auditUrl, auditData, context) {
  const { dataAccess } = context;
  
  const opportunity = Opportunity.create(opportunityData);

  // this logic changes based on the audit type
  const buildKey = (auditData) => `${auditData.property}|${auditData.anotherProperty}`;

  await syncSuggestions({
    opportunity,
    newData: auditData,
    buildKey,
    mapNewSuggestion: (issue) => ({
      opportunityId: opportunity.getId(),
      type: 'SUGGESTION_TYPE',
      rank: issue.rankMetric,
      // data changes based on the audit type
      data: {
        property: issue.property,
        anotherProperty: issue.anotherProperty
      }
    }),
    log
  }); 
}

export default new AuditBuilder()
  .withRunner(auditRunner)
  .withPostProcessors([ convertToOpportunity ])
  .build();

```
