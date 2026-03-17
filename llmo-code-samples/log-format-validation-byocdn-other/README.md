# Log Format Validation: BYOCDN-Other

`log-format-validation-byocdn-other` is a starter validation tool for customers using the BYOCDN-Other ingestion method in LLM Optimizer.

## Overview

The BYOCDN-Other provisioning method is a catch-all option for customers who want to provide CDN logs to LLM Optimizer when:

- manual uploads are preferred, for example when an operations team exports logs and uploads them periodically
- ad-hoc automated processes are used, such as one-off scripts, scheduled exports, or serverless jobs
- the customer uses a CDN that is not natively supported by our log forwarding integrations
- the customer does not use a CDN and needs to forward web server logs directly

This method is intended to imitate the continuous-forwarding model: logs are produced and uploaded into the expected S3 location and then processed automatically by LLM Optimizer pipelines.

## Required Log Format

Logs must be uploaded as JSON Lines: one JSON object per line.

Each log line must include these fields exactly as spelled:

| Field Name | Type | Description / Notes                                                                                            | Example |
| --- | --- |----------------------------------------------------------------------------------------------------------------| --- |
| `timestamp` | string | Request timestamp in ISO 8601 UTC format.                                                                      | `"2025-02-01T23:00:05Z"` |
| `host` | string | The web domain that the client requested.                                                                      | `"www.example.com"` |
| `url` | string | Path is required. Query parameters should be included when present. Full URLs are acceptable but not required. | `"/home?utm_source=google"` |
| `request_method` | string | HTTP request method.                                                                                           | `"GET"` |
| `request_user_agent` | string | HTTP `User-Agent` request header.                                                                              | `"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0"` |
| `request_referer` | string | HTTP `Referer` request header. Can be empty.                                                                   | `"https://chatgpt.com"` |
| `response_status` | integer | HTTP response status code.                                                                                     | `200` |
| `response_content_type` | string | HTTP `Content-Type` response header.                                                                           | `"text/html; charset=utf-8"` |
| `time_to_first_byte` | integer | Time from connection creation to first byte received, in milliseconds. Use `0` if unavailable.                 | `42` |

## Example Log Lines

There are three valid lines in [`samples/valid.jsonl`](/Users/constantinpopa/code/spacecat-byocdn-other-validation/llmo-code-samples/log-format-validation-byocdn-other/samples/valid.jsonl):

```json
{"timestamp":"2025-02-01T23:06:14Z","host":"www.example.com","url":"/products/llm-optimizer?utm_source=google","request_method":"GET","request_user_agent":"Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)","response_status":200,"request_referer":"","response_content_type":"text/html; charset=utf-8","time_to_first_byte":198}
{"timestamp":"2025-02-01T23:19:32Z","host":"www.example.com","url":"/services/ai-consulting/overview?entry=nav","request_method":"GET","request_user_agent":"PerplexityBot/1.0 (+https://www.perplexity.ai/perplexitybot)","response_status":200,"request_referer":"","response_content_type":"text/html; charset=utf-8","time_to_first_byte":255}
{"timestamp":"2025-02-01T23:44:05Z","host":"www.example.com","url":"/products/pricing/enterprise?utm_medium=social","request_method":"GET","request_user_agent":"ClaudeBot/1.0 (+https://www.anthropic.com)","response_status":200,"request_referer":"","response_content_type":"application/pdf","time_to_first_byte":312}
```

## Critical Disclaimer

The ingestion and aggregation pipelines are strict about field names and data types.

- Required field names must match exactly, including case and spelling.
- Extra fields are allowed and will be ignored by processing.
- `timestamp` must be a JSON string in ISO 8601 UTC format. UNIX timestamps may not work.
- `response_status` must be an integer.
- `time_to_first_byte` must be an integer in milliseconds.
- `url` must include a path. Query parameters should be included when present. Full URLs are acceptable but not required.
- Strings must be valid JSON strings.
- Malformed JSON or missing or incorrect fields can cause logs to be skipped or fail to parse, which leads to missing data in reports.

The validator in [`validate.py`](/Users/constantinpopa/code/spacecat-byocdn-other-validation/llmo-code-samples/log-format-validation-byocdn-other/validate.py) checks those rules locally before upload.

## Upload Location And Processing Cadence

Upload logs under the appropriate full S3 key or prefix using the format `<IMS_ORG>/raw/byocdn-other/yyyy/mm/dd/`.

Example for logs from February 1, 2025 UTC:

```text
ABC123AdobeOrg/raw/byocdn-other/2025/02/01/
```

Processing behavior:

- Logs uploaded during a given UTC day are processed near the end of that UTC day.
- Logs uploaded into previous days' folders as backfill are detected and processed within 24 hours.

The validator can optionally check that an upload path contains the required full-key structure, for example `ABC123AdobeOrg/raw/byocdn-other/yyyy/mm/dd/`.

## Scenarios

### Scenario 1: Splunk or Elasticsearch to S3

Goal: retrieve logs from an observability platform and deliver them to the designated S3 location.

1. Extract the required fields from Splunk or Elasticsearch events.
2. Transform each event into one JSON object matching the schema above.
3. Write the output as JSON Lines.
4. Upload the resulting file to the designated bucket under `<IMS_ORG>/raw/byocdn-other/yyyy/mm/dd/`.

### Scenario 2: Lambda or Azure Function to S3

Goal: use serverless compute to normalize source logs and deliver them to the designated S3 location.

1. Retrieve logs from the customer source, such as a log store, queue, or blob storage.
2. Map each event to the required schema.
3. Emit JSON Lines output.
4. Upload the file to `<IMS_ORG>/raw/byocdn-other/yyyy/mm/dd/`.

## Usage

Validate a known-good sample:

```bash
python3 validate.py samples/valid.jsonl
```

Validate a known-good sample and verify the upload path structure:

```bash
python3 validate.py samples/valid.jsonl --upload-path "ABC123AdobeOrg/raw/byocdn-other/2025/02/01/logs.jsonl"
```

Validate a sample that contains common errors:

```bash
python3 validate.py samples/invalid.jsonl
```

The invalid sample in [`samples/invalid.jsonl`](/Users/constantinpopa/code/spacecat-byocdn-other-validation/llmo-code-samples/log-format-validation-byocdn-other/samples/invalid.jsonl) demonstrates:

- a non-ISO timestamp
- a `url` without a path
- a string `response_status`
- a negative `time_to_first_byte`
- an extra field that is ignored while other validation errors are still reported
- malformed JSON

Exit codes:

- `0`: all checks passed
- `1`: validation failed
- `2`: input file was missing or not a regular file

## Quick Checklist

- One JSON object per line
- Exact field spelling as specified
- Correct data types
- `time_to_first_byte` is an integer in milliseconds
- `url` includes a path, with query parameters when present
- Upload to `<IMS_ORG>/raw/byocdn-other/yyyy/mm/dd/`
