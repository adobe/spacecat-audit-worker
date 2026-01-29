# Opportunity Fix Verification Scripts

This directory contains scripts for verifying and processing AI-fixed suggestions in SpaceCat opportunities.

## Overview

The system allows you to:
1. Fetch suggestions for a specific opportunity type by status
2. Check if suggestions have been fixed via AI
3. Export results to CSV
4. Optionally mark suggestions as FIXED and create Fix entities

## Setup

### Prerequisites

- Node.js >= 24.0.0
- Access to SpaceCat API and DynamoDB tables
- Required environment variables configured

### Environment Variables

Create a `.env` file or export these variables:

```bash
# SpaceCat API (REQUIRED)
SPACECAT_API_KEY=your-ims-key-here

# AWS Configuration (REQUIRED - should be in your AWS credentials)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# DynamoDB Unified Single-Table Design (OPTIONAL - has defaults)
DYNAMO_TABLE_NAME_DATA=spacecat-services-data  # Default: spacecat-services-data

# Optional: Enable debug logging
DEBUG=true
```

**Note:** The scripts now use the unified single-table design pattern. You only need to set `DYNAMO_TABLE_NAME_DATA` if using a different table name than the default.

**Quick Setup:**
If you have `env.sh` in your project root, you can load it and add the missing API key:
```bash
source env.sh
export SPACECAT_API_KEY='your-actual-api-key-here'
```

## Usage

### Basic Command

```bash
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=<type>
```

### Command Line Options

- `--siteId=<uuid>` (Required) - Site UUID
- `--type=<type>` (Required) - Opportunity type:
  - `alt-text`
  - `broken-backlinks`
  - `broken-internal-links`
  - `structured-data`
  - `sitemap`
  - `meta-tags`
- `--status=<status>` (Optional, default: OUTDATED) - Filter suggestions by status:
  - `NEW`
  - `OUTDATED`
  - `FIXED`
  - `ERROR`
  - `SKIPPED`
  - `PENDING_VALIDATION`
- `--markFixed` (Optional, default: false) - Mark suggestions as FIXED and create Fix entities
- `--fromCsv=<path>` (Optional) - Read results from existing CSV file instead of running checkers
  - Path can be absolute or relative to `oppty-scripts/data/`
  - Use with `--markFixed` to mark suggestions as fixed from CSV data
  - **Saves significant time** by skipping the checker step
- `--debug` (Optional) - Enable debug logging
- `--help`, `-h` - Show help message

### Examples

#### 1. Check alt-text suggestions with OUTDATED status (default)

```bash
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=alt-text
```

#### 2. Check and mark fixed broken-backlinks suggestions

```bash
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=broken-backlinks \
  --markFixed
```

#### 3. Check meta-tags with custom status

```bash
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=meta-tags \
  --status=NEW \
  --debug
```

#### 4. Mark suggestions as fixed from existing CSV (Fast method)

```bash
# This skips the checker step entirely and reads from CSV
# Useful when you've already run the checker and have results
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=broken-internal-links \
  --markFixed \
  --fromCsv=14220f09-7bdd-4c91-9adf-adcbe0adf1df-broken-internal-links-2026-01-29.csv
```

**Note:** The `--fromCsv` option significantly reduces execution time because:
- No need to re-run expensive checkers (browser automation, scrape fetching, etc.)
- Directly reads suggestion IDs and opportunity IDs from CSV
- Only performs the marking as fixed operation

#### 5. Process all opportunity types (run separately for each)

```bash
# Alt text
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=alt-text

# Broken backlinks
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=broken-backlinks

# Internal links
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=broken-internal-links

# Structured data
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=structured-data

# Sitemap
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=sitemap

# Meta tags
node oppty-scripts/opportunities/index.js --siteId=<uuid> --type=meta-tags
```

## Output

### CSV Export

Results are exported to `oppty-scripts/data/{siteId}-{opportunityType}-{date}.csv` with columns:
- Suggestion ID
- Opportunity ID
- URL
- Status
- Is Fixed Via AI (YES/NO)
- Reason
- Fix Details (JSON)
- Timestamp

### Console Output

The script provides detailed console output including:
- Configuration summary
- Progress updates for each step
- Results summary with statistics
- Path to exported CSV file

## How It Works

### Standard Flow (Without CSV)

#### 1. Fetch Suggestions

The script uses `@adobe/spacecat-shared-data-access` to:
- Connect to DynamoDB
- Fetch the site by ID
- Get opportunities of the specified type
- Filter suggestions by status

#### 2. Check AI Fixes

Each opportunity type has a dedicated checker that examines suggestion data for AI-generated fixes:

- **alt-text**: Checks for `improvedText`, `aiSuggestion`, `aiRationale`, and `suggestionStatus === 'completed'`
- **broken-backlinks**: Checks for `patchContent` or `aiGuidance` with `isCodeChangeAvailable`
- **broken-internal-links**: Checks for `isCodeChangeAvailable` and `patchContent`
- **structured-data**: Checks for `patchContent`, `structuredData`, or `aiRecommendation`
- **sitemap**: Checks for `sitemapContent` with `autoGenerated` or `aiGenerated` flags
- **meta-tags**: Checks for `improvedText`, `aiSuggestion`, `aiRationale`, or `suggestedValue` with `suggestionStatus === 'completed'`

#### 3. Export to CSV

All results are formatted and exported to a CSV file in the `data/` directory.

#### 4. Mark as Fixed (Optional)

When `--markFixed` is specified:
1. Groups fixed suggestions by opportunity
2. Creates Fix entities via SpaceCat API (`POST /api/v1/sites/{siteId}/opportunities/{opportunityId}/fixes`)
3. Updates suggestion status from OUTDATED → FIXED using `Suggestion.bulkUpdateStatus()`

### Fast Flow (With --fromCsv)

When using `--fromCsv`, the script follows a different, much faster path:

#### 1. Read Results from CSV

- Parses the existing CSV file
- Extracts suggestion IDs, opportunity IDs, and fix status
- Validates required fields are present

#### 2. Initialize Data Access

- Only initializes DynamoDB connection (no fetching)
- Prepares for marking suggestions as fixed

#### 3. Mark as Fixed (If --markFixed specified)

- Same as step 4 in standard flow
- Groups suggestions by opportunity
- Creates Fix entities via API
- Updates suggestion status to FIXED

**Performance Benefits:**
- Skips expensive checker operations (browser automation, API calls, scrape fetching)
- Reduces execution time from minutes/hours to seconds
- Ideal for re-running mark-as-fixed after reviewing CSV results

## File Structure

```
oppty-scripts/
├── client/
│   └── spacecat-client.js          # API client for Fix Entity endpoint
├── common/
│   ├── csv-exporter.js             # CSV export functionality
│   ├── csv-importer.js             # CSV import functionality (NEW)
│   ├── fetch-suggestions.js        # Fetch suggestions from DynamoDB
│   └── logger.js                   # Logging utility
├── opportunities/
│   ├── index.js                    # Main CLI entry point
│   ├── config.js                   # Configuration and constants
│   └── checkers/
│       ├── index.js                # Checker registry
│       ├── alt-text-checker.js
│       ├── backlinks-checker.js
│       ├── internal-links-checker.js
│       ├── meta-tags-checker.js
│       ├── sitemap-checker.js
│       └── structured-data-checker.js
├── data/                           # CSV output directory (gitignored)
├── .gitignore
└── README.md
```

## Error Handling

The script includes comprehensive error handling:
- Validates all command-line arguments
- Checks for required environment variables
- Gracefully handles API errors with retries
- Logs errors with detailed context
- Exits with appropriate status codes

## Development

### Recommended Workflow

For best performance, follow this two-step workflow:

**Step 1: Generate CSV with checker results**
```bash
# Run the checker to analyze suggestions and generate CSV
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=broken-internal-links
```

This will create a CSV file like: `data/123e4567-e89b-12d3-a456-426614174000-broken-internal-links-2026-01-29.csv`

**Step 2: Review CSV and mark as fixed (Fast)**
```bash
# After reviewing the CSV, mark suggestions as fixed without re-running checkers
node oppty-scripts/opportunities/index.js \
  --siteId=123e4567-e89b-12d3-a456-426614174000 \
  --type=broken-internal-links \
  --markFixed \
  --fromCsv=123e4567-e89b-12d3-a456-426614174000-broken-internal-links-2026-01-29.csv
```

**Benefits:**
- Review checker results before committing to marking as fixed
- Re-run mark-as-fixed multiple times if needed (testing, error recovery)
- Save significant time on subsequent runs

### Adding a New Opportunity Type

1. Add the type mapping to `opportunities/config.js`:
   ```javascript
   export const OPPORTUNITY_TYPE_MAPPING = {
     'your-type': 'internal-audit-type',
     // ...
   };
   ```

2. Create a checker in `opportunities/checkers/your-type-checker.js`:
   ```javascript
   export function checkYourTypeFixed(suggestion) {
     const data = suggestion.getData();
     // Check for AI fixes
     return {
       suggestionId: suggestion.getId(),
       opportunityId: suggestion.getOpportunityId(),
       url: data?.url || '',
       status: suggestion.getStatus(),
       isFixedViaAI: /* your logic */,
       reason: /* reason string */,
       fixDetails: /* details object */,
     };
   }
   ```

3. Register the checker in `opportunities/checkers/index.js`:
   ```javascript
   import checkYourTypeFixed from './your-type-checker.js';
   
   export const CHECKERS = {
     'your-type': checkYourTypeFixed,
     // ...
   };
   ```

## Troubleshooting

### "Site not found" error
- Verify the site UUID is correct
- Ensure you have access to the DynamoDB tables

### "No opportunities found" warning
- Check if opportunities exist for the site and type
- Verify the opportunity type spelling

### "Missing required environment variables" error
- Ensure all required environment variables are set
- Check `.env` file or shell environment

### API authentication errors
- Verify `SPACECAT_API_KEY` is valid
- Check API endpoint URL in config

## License

Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
