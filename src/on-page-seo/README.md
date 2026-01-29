# On-Page SEO Testing & Documentation

This folder contains the on-page SEO audit handlers and testing tools for opportunity selection and technical validation.

## Overview

This script processes upstream CSV suggestions from Mystique, applies the same opportunity selection logic used in production (`src/on-page-seo/handler.js`), runs technical checks, and outputs multiple CSV files for analysis.

## Features

- ✅ **SERP Position Filtering**: Selects URLs in positions 4-20 (or 4-30 if needed)
- ✅ **Opportunity Scoring**: Calculates potential traffic gain using CTR-based formula
- ✅ **Technical Validation**: Runs all 5 technical checks (HTTP status, redirects, canonical, noindex, robots.txt)
- ✅ **Multiple Outputs**: Generates 4 CSV files for different analysis needs
- ✅ **Flexible Options**: Configurable via command-line flags

## Files in this Folder

- `handler.js` - Production handler for on-page SEO audits
- `guidance-handler.js` - Processes content recommendations from Mystique
- `opportunity-data-mapper.js` - Calculates opportunity scores and impact
- `test-opportunities.mjs` - Testing script for opportunity selection
- `input/` - Place your test CSV files here
- `output/` - Generated test results go here

## Testing Script Usage

**Recommended:** Place your input CSV files in `input/` folder.

```bash
# Run from project root - basic usage (top 3, check selected only)
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv

# Select top 5 opportunities
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --top 5

# Run technical checks on ALL URLs in the CSV
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --check-all

# You can also use absolute paths
node src/on-page-seo/test-opportunities.mjs /path/to/your/suggestions.csv

# Show help
node src/on-page-seo/test-opportunities.mjs --help
```

## Input CSV Format

The input CSV must have the following columns:

**Required:**
- `url` - The page URL to analyze

**Recommended:**
- `serp_position` (or `serpPosition` or `ranking`) - Current SERP ranking position
- `volume_per_month` (or `searchVolume`) - Monthly search volume for the keyword

**Optional:**
- Any other columns from upstream data (will be preserved in outputs)

### Example Input CSV

```csv
url,serp_position,volume_per_month,page_type,primary_keyword
https://example.com/page1,11,450,Product,dental practice loans
https://example.com/page2,14,7100,Product,debt consolidation
https://example.com/page3,17,2100,Product,business acquisition
```

## Output Files

The script generates up to 4 CSV files in the `src/on-page-seo/output/` directory:

### 1. `{input-name}-filtered-opportunities.csv`

Selected opportunities ranked by opportunity score.

**Additional columns added:**
- `opportunity_score` - Calculated traffic gain potential
- `selected_rank` - Ranking (1, 2, 3, etc.)

**Use this for:** Understanding which URLs were selected and why

### 2. `{input-name}-technical-checks-all.csv`

All URLs with complete technical validation results.

**Technical check columns:**
- `indexable` - Overall pass/fail (1 = clean, 0 = blocked)
- `blockers` - Comma-separated list of blocker types
- `blocker_details` - Human-readable explanation of issues
- `http_status` - HTTP response code (200, 404, etc.)
- `http_passed` - HTTP status check result
- `redirect_count` - Number of redirects in chain
- `redirect_passed` - Redirect check result
- `canonical_url` - Detected canonical URL
- `canonical_passed` - Canonical check result
- `noindex_passed` - Noindex check result
- `robots_txt_passed` - Robots.txt check result

**Use this for:** Complete technical audit of all checked URLs

### 3. `{input-name}-technical-checks-clean.csv`

Only URLs that passed all technical checks (indexable = 1).

**Use this for:** URLs ready for content optimization

### 4. `{input-name}-technical-checks-blocked.csv`

Only URLs with technical issues (indexable = 0).

**Use this for:** URLs requiring technical fixes before content optimization

## Options

### `--top N`

Select top N opportunities by opportunity score (default: 3).

```bash
node test-on-page-seo.mjs suggestions.csv --top 5
```

### `--check-all`

Run technical checks on ALL URLs in the input CSV, not just selected opportunities.

```bash
node test-on-page-seo.mjs suggestions.csv --check-all
```

This is useful for:
- Auditing all URLs in a batch
- Understanding the overall technical health of a site
- Finding technical issues across all suggested URLs

### `--check-selected` (default)

Run technical checks only on the selected top N opportunities.

```bash
node test-on-page-seo.mjs suggestions.csv --check-selected
```

## Opportunity Selection Logic

The script follows the same logic as the production handler:

### Step 1: SERP Position Filtering

**Primary Range (4-20):**
- Position 1-3: ❌ Excluded (already performing well)
- Position 4-20: ✅ Included (low-hanging fruit)
- Position 21+: ❌ Excluded initially

**Fallback Range (4-30):**
If fewer than N opportunities found in positions 4-20, the range softens to 4-30.

### Step 2: Opportunity Scoring

Each URL gets a score based on potential traffic gain:

```javascript
opportunityScore = searchVolume × (targetCTR - currentCTR)
```

**CTR by Position (industry averages):**
- Position 1: 32%
- Position 2: 24%
- Position 3: 18%
- Position 4: 13%
- Position 5: 10%
- Position 6-10: 8% → 3%

**Target Position:** Current position - 3 (aim to improve by ~3 positions)

### Step 3: Ranking & Selection

URLs are sorted by opportunity score (descending) and the top N are selected.

## Technical Checks

The script runs 5 technical validation checks using the same validators as production:

### 1. HTTP Status ✅
- **Pass:** 2xx, 3xx status codes
- **Fail:** 4xx, 5xx status codes

### 2. Redirects 🔗
- **Pass:** No redirects (direct access)
- **Fail:** Any redirect chain (3xx responses)

### 3. Canonical Tag 🎯
- **Pass:** Self-referencing or no canonical
- **Fail:** Canonical points to a different URL

### 4. Noindex 🚫
- **Pass:** No noindex directive
- **Fail:** `<meta name="robots" content="noindex">` or `X-Robots-Tag: noindex` header

### 5. Robots.txt 🤖
- **Pass:** URL is allowed for Googlebot and general crawlers
- **Fail:** URL is disallowed in robots.txt

## Example Workflow

### 1. Get suggestions from upstream (Mystique)

```bash
# Place your CSV file in the input folder
cp ~/Downloads/suggestions.csv src/on-page-seo/input/
```

### 2. Test opportunity selection

```bash
# See which URLs would be selected (run from project root)
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv
```

### 3. Analyze results

```bash
# Check filtered opportunities
cat src/on-page-seo/output/suggestions-filtered-opportunities.csv

# Check all URLs with technical validation
cat src/on-page-seo/output/suggestions-all-urls-with-checks.csv
```

### 4. Iterate on selection criteria

```bash
# Try different topN values
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --top 5
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --top 10
```

### 5. Audit all URLs for technical issues

```bash
# Check all URLs regardless of selection
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --check-all
```

## Common Use Cases

### 🧪 Testing Algorithm Changes

Modify the SERP position ranges or scoring formula in the script, run it, and compare results.

### 📊 Analyzing Blocker Distribution

Use `--check-all` to understand what percentage of URLs have technical issues:

```bash
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/suggestions.csv --check-all

# Count URLs with issues
grep ",NO," src/on-page-seo/output/suggestions-all-urls-with-checks.csv | wc -l
```

### 🔍 Validating Upstream Data Quality

Check if the CSV has the expected columns and data:

```bash
node test-on-page-seo.mjs suggestions.csv
# Watch for warnings about missing columns
```

### 🚀 Pre-deployment Testing

Test the selection logic on real data before deploying to production:

```bash
# Copy production batches to input folder
cp ~/prod-data/*.csv src/on-page-seo/input/

# Test each batch
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/production-batch-1.csv
node src/on-page-seo/test-opportunities.mjs src/on-page-seo/input/production-batch-2.csv
```

## Troubleshooting

### "CSV must have a 'url' column"

Ensure your CSV has a column named exactly `url` (case-sensitive).

### "No opportunities selected based on SERP position criteria"

- Check that `serp_position` values are in the expected range (4-30)
- Verify the column is named correctly (`serp_position`, `serpPosition`, or `ranking`)

### Technical checks timing out

If checking many URLs with `--check-all`, the script runs 10 concurrent requests. This is intentional to avoid overwhelming servers.

### robots.txt cache

The script caches robots.txt by domain for 5 minutes to improve performance when checking multiple URLs on the same domain.

## Development

The testing script reuses production code:

- **Opportunity selection logic:** Based on `handler.js`
- **Opportunity scoring:** Based on `opportunity-data-mapper.js`
- **Technical checks:** Uses `../utils/seo-validators.js`
- **CSV parsing:** Uses `csv-parse/sync` (already in package.json)

## Related Files

- `handler.js` - Production handler for on-page SEO audits
- `guidance-handler.js` - Processes content recommendations
- `opportunity-data-mapper.js` - Opportunity scoring logic
- `test-opportunities.mjs` - Testing script (this file)
- `../utils/seo-validators.js` - Technical validation checks
- `../../validate-csv-urls.mjs` - General-purpose URL validation script

## License

Apache-2.0 (same as parent project)

