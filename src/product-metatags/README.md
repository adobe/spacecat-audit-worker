# Product MetaTags Audit

## Overview

The Product MetaTags Audit is a comprehensive **step-based audit** that analyzes product-specific metadata across all pages of a website. It focuses on pages that contain product meta tags (SKU or image meta tags) and performs detailed SEO analysis to identify optimization opportunities.

## Key Features

- **Product Page Detection**: Automatically identifies and processes only pages with product-specific meta tags
- **Comprehensive Meta Tag Analysis**: Analyzes title, description, H1, SKU, and image meta tags
- **Multi-Step Workflow**: Uses SpaceCat's step-based audit framework for scalable processing
- **Traffic Impact Calculation**: Estimates potential traffic impact of meta tag issues
- **Opportunity Generation**: Creates actionable suggestions with product context
- **Suggestion Synchronization**: Manages suggestion lifecycle and updates

## Architecture

This audit follows the **step-based audit pattern** with three main steps:

### Step 1: Import Top Pages
- Imports top-performing pages from analytics data.
- Prepares S3 bucket structure for content scraping
- **Destination**: `IMPORT_WORKER`

### Step 2: Submit for Scraping
- Combines top pages with manually included URLs
- Submits URLs for content scraping to extract meta tags
- **Destination**: `CONTENT_SCRAPER`

### Step 3: Run Audit and Generate Suggestions
- Processes scraped content from S3
- **Filters pages**: Only processes pages with SKU or image meta tags
- Performs comprehensive SEO analysis
- Generates opportunities and suggestions
- **Final step**: No destination (stores results)

## Product Page Filtering

The audit implements intelligent filtering to focus only on product pages:

### Filtering Criteria
Pages are processed **only if** they contain:
- **SKU meta tag**: `<meta name="sku" content="...">`
- **OR any image meta tag**:
  - `<meta property="og:image" content="...">`
  - `<meta name="twitter:image" content="...">`
  - `<meta property="product:image" content="...">`
  - `<meta name="image" content="...">`

### Benefits
- **Focused Analysis**: Concentrates resources on actual product pages
- **Reduced Noise**: Eliminates irrelevant non-product pages from analysis
- **Better Performance**: Processes only relevant pages, improving audit speed
- **Accurate Opportunities**: Creates suggestions only for product-related issues

## Meta Tag Analysis

### Standard SEO Tags
- **Title**: Length validation, uniqueness, presence
- **Description**: Length validation, uniqueness, presence  
- **H1**: Count validation, length validation, uniqueness

### Product-Specific Tags
- **SKU**: Extracted and forwarded to suggestions
- **Image**: Extracted and forwarded to suggestions (priority: og:image → twitter:image → product:image → image)

## Suggestion Data Structure

Each suggestion includes:
```javascript
{
  // Standard meta tag issue data
  tagName: 'title',
  issue: 'Missing Title',
  url: 'https://example.com/product',
  rank: 1,
  
  // Product-specific data forwarded to suggestions
  productTags: {
    sku: 'PROD-123',
    image: 'https://example.com/image.jpg'
  }
}
```

## Traffic Impact Calculation

- **RUM Integration**: Uses Real User Monitoring data for traffic analysis
- **Organic Traffic Focus**: Calculates impact on organic search traffic
- **CPC Valuation**: Estimates monetary value using cost-per-click data
- **Impact Multipliers**:
  - Missing tags: 1% traffic impact
  - Other issues: 0.5% traffic impact

## Usage Examples

### Local Testing with SAM

```bash
# 1. Set up environment
source env.sh
npm run local-build

# 2. Update src/index-local.js
const messageBody = {
  type: 'product-metatags',
  siteId: 'your-site-id'
};

# 3. Run the audit
npm run local-run
```

### API Usage

```bash
# Get latest audit results
curl -H "x-api-key: YOUR_API_KEY" \
  "https://spacecat.experiencecloud.live/api/ci/sites/SITE_ID/latest-audit/product-metatags"
```

### Slack Commands

```bash
# Enable audit for a site
@spacecat-dev audit enable example.com product-metatags

# Run audit manually
@spacecat-dev run audit product-metatags example.com
```

## Configuration

### Site Configuration
Sites can configure included URLs for product page analysis:

```javascript
// Site configuration
{
  audits: {
    'product-metatags': {
      includedURLs: [
        'https://example.com/products/special-product',
        'https://example.com/catalog/featured-item'
      ]
    }
  }
}
```

### Environment Variables
Required environment variables:
- `S3_SCRAPER_BUCKET_NAME`: S3 bucket for scraped content
- AWS credentials for DynamoDB and S3 access
- RUM API credentials for traffic analysis

## Output Format

```javascript
{
  status: 'complete',
  detectedTags: {
    '/product-page': {
      title: {
        issue: 'Missing Title',
        seoImpact: 'High',
        seoRecommendation: 'Should be present'
      },
      productTags: {
        sku: 'PROD-123',
        image: 'https://example.com/image.jpg'
      }
    }
  },
  sourceS3Folder: 's3://bucket/scrapes/site-id/',
  projectedTrafficLost: 1250,
  projectedTrafficValue: 875
}
```

## Error Handling

- **No Product Pages**: Skips processing if no pages have product tags
- **Missing Top Pages**: Throws error if no URLs available for scraping
- **S3 Errors**: Gracefully handles missing or invalid scraped content
- **RUM Errors**: Continues without traffic impact calculation if RUM unavailable

## Testing

Run the comprehensive test suite:

```bash
npm test -- --grep "Product MetaTags"
```

Tests cover:
- Product page detection and filtering
- Meta tag extraction and validation
- SEO issue detection and ranking
- Step-based workflow functionality
- Error conditions and edge cases

## Differences from Standard MetaTags Audit

1. **Opportunity Type**: Creates `product-metatags` opportunities (not `meta-tags`)
2. **Page Filtering**: Only processes pages with SKU or image meta tags
3. **Product Context**: Forwards SKU and image data to each suggestion
4. **Suggestion Type**: Uses `PRODUCT_METADATA_UPDATE` instead of `METADATA_UPDATE`
5. **Enhanced Ranking**: Includes SKU and image in issue ranking system