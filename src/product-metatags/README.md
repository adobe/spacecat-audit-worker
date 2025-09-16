# Product MetaTags Audit

## Overview

The Product MetaTags Audit extracts product-specific metadata from web pages, focusing on SKU identification and thumbnail image URLs. This audit is designed to help analyze e-commerce and product pages for proper metadata implementation.

## Features

- **Meta Tag Extraction**: Extracts data from HTML meta tags
- **SKU Detection**: Finds product SKU from meta tags
- **Thumbnail Detection**: Locates product images from multiple meta tag sources
- **Robust Error Handling**: Gracefully handles missing data, network errors, and invalid markup

## Data Extraction Strategy

### Meta Tags (Primary Method)
1. Searches for SKU in `<meta name="sku" content="...">` 
2. Searches for images in order of preference:
   - `<meta property="og:image" content="...">`
   - `<meta name="twitter:image" content="...">`
   - `<meta property="product:image" content="...">`
   - `<meta name="thumbnail" content="...">`
   - `<meta property="image" content="...">`

## Output Format

```javascript
{
  success: true,
  sku: "PROD-123" | null,
  thumbnailUrl: "https://example.com/image.jpg" | null,
  extractionMethod: "meta-tags" | "none" | null,
  error?: "Error message if something went wrong"
}
```

## Usage Examples

### Local Testing

```bash
# Start the audit worker
npm start

# Test the audit
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"type": "product-metatags", "siteId": "your-site-id"}'
```

### API Usage

```bash
# Using SpaceCat API
curl -H "x-api-key: YOUR_API_KEY" \
  "https://spacecat.experiencecloud.live/api/ci/sites/SITE_ID/latest-audit/product-metatags"
```

## Supported Meta Tag Formats

The audit extracts data from the following meta tag formats:

### SKU Meta Tag
```html
<meta name="sku" content="PROD-123">
```

### Image Meta Tags (in order of preference)
```html
<!-- Open Graph (highest priority) -->
<meta property="og:image" content="https://example.com/image.jpg">

<!-- Twitter Cards -->
<meta name="twitter:image" content="https://example.com/twitter-image.jpg">

<!-- Product-specific -->
<meta property="product:image" content="https://example.com/product-image.jpg">

<!-- Generic thumbnail -->
<meta name="thumbnail" content="https://example.com/thumb.jpg">

<!-- Generic image -->
<meta property="image" content="https://example.com/generic-image.jpg">
```

## Error Handling

The audit follows the "success: true with null values" pattern for missing data:

- **Network errors**: Returns success=true with error message
- **HTTP errors**: Returns success=true with HTTP status in error
- **Missing data**: Returns success=true with null values
- **No meta tags found**: Returns success=true with extractionMethod="none"

## Performance Considerations

- Uses single HTTP request to fetch page content
- Efficient DOM parsing with JSDOM
- Minimal memory footprint for large pages
- Graceful timeout handling for slow responses
- Proper User-Agent header for compatibility

## Testing

Run the comprehensive test suite:

```bash
npm test -- --grep "Product MetaTags"
```

Tests cover:
- Meta tag extraction (various formats)
- Error conditions (network, HTTP, parsing)
- Edge cases (missing data, invalid URLs)
- Image meta tag priority handling
- URL validation
