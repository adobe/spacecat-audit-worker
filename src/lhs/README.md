# Audit Worker Handler for Lighthouse Scores (PSI)

## Overview
The Audit Worker Handler automates web page auditing using Lighthouse Scores through the PageSpeed Insights (PSI) API. It's designed for assessing web page performance, accessibility, and SEO for both mobile and desktop views.

## Features
- **Audit Type Support:** Manages both mobile (`lhs-mobile`) and desktop (`lhs-desktop`) audits.
- **Configuration Validation:** Ensures all necessary configuration parameters are properly set.
- **Data Fetching:** Retrieves PSI data for specific URLs as per the audit strategy.
- **Audit Data Generation:** Creates audit data using site information and PSI data.
- **SQS Message Handling:** Constructs and sends messages to an SQS queue with audit results.

## Workflow
1. **Audit Request Handling:** Receives audit requests, including type and URL, from a message queue.
2. **Strategy Determination:** Converts audit type into a PSI strategy (`mobile` or `desktop`).
3. **Site Data Retrieval:**
    - If `url = "ALL"`, retrieves data for all sites to monitor.
    - Otherwise, fetches data for the specified site URL.
4. **PSI Data Fetching:** Obtains PSI data for the site(s) based on the selected strategy.
5. **Audit Data Processing:** Compiles audit data from the site and PSI information.
6. **SQS Message Dispatch:** Sends formatted messages to an SQS queue with audit findings.

## Error Handling
- Error management at various stages of the audit process.
- Logs errors and provides appropriate responses with relevant HTTP status codes.

## Dependencies
- `@adobe/fetch`: For creating URLs and handling responses.
- `@adobe/spacecat-shared-utils`: For utility functions like URL validation.
- `@adobe/spacecat-shared-data-access`: For data access operations.
- `@adobe/helix-shared-secrets`: For managing secrets and environment variables.

## Environment Variables
Provided by the secrets provider, these variables are essential for downstream dependencies:
- `PAGESPEED_API_BASE_URL`: URL of the PageSpeed API.
- `DYNAMO_TABLE_NAME_SITES`: DynamoDB table name for storing site data.
- `DYNAMO_TABLE_NAME_AUDITS`: DynamoDB table name for storing audit data.
- `DYNAMO_TABLE_NAME_LATEST_AUDITS`: DynamoDB table name for storing the latest audit data.
- `DYNAMO_INDEX_NAME_ALL_SITES`: DynamoDB index name for querying all sites.
- `DYNAMO_INDEX_NAME_ALL_LATEST_AUDIT_SCORES`: DynamoDB index name for querying all latest audits by scores.

## Usage
Configure necessary parameters, including the PSI API Base URL and SQS Queue URL. Invoke the handler with a message specifying the audit type and site URL (or "ALL" for all sites). Monitor the process through logs and receive audit results in the designated SQS queue.
