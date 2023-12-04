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
