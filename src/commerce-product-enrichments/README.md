# Commerce Product Enrichments Audit

## Overview

The Commerce Product Enrichments audit analyzes commerce/product pages to identify enrichment opportunities. This audit follows the SpaceCat 3-step audit pattern.

## Audit Type

- **Type**: `commerce-product-enrichments`
- **Pattern**: Step-based audit using AuditBuilder

## Architecture

### Step 1: Import Top Pages (`importTopPages`)

Prepares the audit context and returns metadata for the import worker.

- Retrieves site information
- Creates S3 bucket path reference
- Returns audit metadata for processing

### Step 2: Submit for Scraping (`submitForScraping`)

Retrieves top pages and prepares them for content scraping.

- Fetches top pages from Ahrefs data (via `SiteTopPage.allBySiteIdAndSourceAndGeo`)
- Combines with manually included URLs from site configuration
- Filters out PDF files
- Removes duplicates
- Returns URL list for the scraper

### Step 3: Run Audit and Process Results (`runAuditAndProcessResults`)

Processes scraped content and generates audit results.

**Current Implementation**: Initial placeholder that logs all scraped pages and stops. This step will be expanded to include the actual commerce product enrichments logic.

## Data Sources

- **Ahrefs**: Top pages data
- **Site Configuration**: Included URLs
- **Content Scraper**: Page content

## Usage

### Enable Audit for a Site

```bash
# In Slack (stage/dev)
@spacecat-dev audit enable example.com commerce-product-enrichments

# In Slack (production)
@spacecat audit enable example.com commerce-product-enrichments
```

### Run Audit Manually

```bash
# In Slack (stage/dev)
@spacecat-dev run audit commerce-product-enrichments example.com

# In Slack (production)
@spacecat run audit commerce-product-enrichments example.com
```

### Local Testing

```bash
# 1. Update src/index-local.js with:
const messageBody = {
  type: 'commerce-product-enrichments',
  siteId: 'your-site-id'
};

# 2. Run locally
npm run local-build
npm run local-run

# 3. Check output
cat output.txt
```

## Logging

All log messages are prefixed with `[COMMERCE-PRODUCT-ENRICHMENTS]` for easy filtering in Coralogix.

Example search query:
```
"[COMMERCE-PRODUCT-ENRICHMENTS]"
```

## File Structure

```
src/commerce-product-enrichments/
├── handler.js      # Main audit logic with 3-step pattern
├── constants.js    # Audit constants and configuration
└── README.md       # This documentation
```

## Future Enhancements

- Implement commerce-specific page analysis in Step 3
- Add SEO checks for product pages
- Generate opportunities and suggestions
- Calculate projected traffic impact
- Add AI-powered suggestions

## Related

- [Product Metatags Audit](../product-metatags/README.md) - Reference implementation
- [Developer Guide: Creating a New Audit Type](https://wiki.corp.adobe.com/pages/viewpage.action?spaceKey=EntComm&title=Developer+Guide%3A+Creating+a+New+Audit+Type+in+SpaceCat)
 