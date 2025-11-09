# Local Preflight Audit Scripts

This directory contains scripts to run the `preflightAudit` function locally for testing and debugging purposes.

## Scripts

### 1. `run-preflight-local.js` - Comprehensive Local Testing

A full-featured script with detailed mock data and comprehensive logging.

**Usage:**
```bash
node scripts/run-preflight-local.js
```

**Features:**
- Complete mock environment setup
- Detailed logging for debugging
- Mock S3 data with realistic HTML content
- Error handling and stack traces

### 2. `run-preflight-simple.js` - Simple Testing Script

A simpler script that's easy to modify for different test scenarios.

**Usage:**
```bash
node scripts/run-preflight-simple.js
```

**Features:**
- Easy configuration via `TEST_CONFIG` object
- Minimal setup for quick testing
- Easy to modify URLs and test scenarios

## Configuration

### Modifying Test URLs

Edit the `TEST_CONFIG.urls` array in `run-preflight-simple.js`:

```javascript
const TEST_CONFIG = {
  urls: [
    'https://main--adobe-screens-brandads--anagarwa.aem.page/',
    'https://main--adobe-screens-brandads--anagarwa.aem.page/test-page'
  ],
  // ... other config
};
```

### Modifying Audit Checks

Edit the `TEST_CONFIG.checks` array:

```javascript
const TEST_CONFIG = {
  checks: ['body-size', 'lorem-ipsum', 'h1-count'],
  // ... other config
};
```

Available checks:
- `body-size` - Check for content length
- `lorem-ipsum` - Check for placeholder text
- `h1-count` - Check for proper H1 tag usage

### Modifying Mock S3 Data

Edit the `createMockS3Data()` function to test different scenarios:

```javascript
const createMockS3Data = () => {
  const mockData = {};
  
  TEST_CONFIG.urls.forEach(url => {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.replace(/\/$/, '');
    const key = `scrapes/${TEST_CONFIG.siteId}${pathname}/scrape.json`;
    
    mockData[key] = {
      finalUrl: url, // Test different finalUrl formats here
      scrapeResult: {
        rawBody: `
          <!DOCTYPE html>
          <html>
          <body>
            <h1>Test Content</h1>
            <p>Your test content here</p>
          </body>
          </html>
        `
      }
    };
  });
  
  return mockData;
};
```

## Debugging the URL Matching Issue

To debug the specific URL matching issue you're experiencing:

1. **Test different finalUrl formats** by modifying the `finalUrl` in the mock S3 data:

```javascript
// Test with trailing slash
finalUrl: 'https://main--adobe-screens-brandads--anagarwa.aem.page/',

// Test without trailing slash
finalUrl: 'https://main--adobe-screens-brandads--anagarwa.aem.page',

// Test with different path formats
finalUrl: 'https://main--adobe-screens-brandads--anagarwa.aem.page/index.html',
```

2. **Check the logs** for:
   - Preview URLs being processed
   - Audits Map keys
   - Scraped object finalUrl values
   - URL matching attempts

3. **Compare URL formats** between:
   - The normalized URLs in the `audits` Map
   - The `finalUrl` values from scraped data

## Environment Setup

Make sure you have the required environment variables set. You can create a `.env` file in the project root:

```bash
# Required for AWS SDK (even for local testing)
AWS_ACCESS_KEY_ID=fake-key-id
AWS_SECRET_ACCESS_KEY=fake-secret
AWS_XRAY_SDK_ENABLED=false
AWS_XRAY_CONTEXT_MISSING=IGNORE_ERROR

# Force HTTP/1.1 for Adobe Fetch
HELIX_FETCH_FORCE_HTTP1=true
```

## Troubleshooting

### Common Issues

1. **Module not found errors**: Make sure you're running from the project root directory
2. **Import errors**: Ensure all dependencies are installed (`npm install`)
3. **Environment errors**: Check that the `.env` file is properly configured

### Debugging Tips

1. **Enable verbose logging**: The scripts already include comprehensive logging
2. **Test one URL at a time**: Modify the `urls` array to test individual URLs
3. **Check S3 key generation**: Verify that the S3 keys match the expected format
4. **Compare URL normalization**: Look at how URLs are being normalized vs. the finalUrl format

## Example Output

When running successfully, you should see output like:

```
🚀 Starting simple preflight audit...

📋 Configuration:
  URLs: ["https://main--adobe-screens-brandads--anagarwa.aem.page/","https://main--adobe-screens-brandads--anagarwa.aem.page/test-page"]
  Checks: ["body-size","lorem-ipsum","h1-count"]
  Step: identify
  Site ID: test-site-id
  Job ID: test-job-id

🔍 Running preflight audit...

[preflight-audit] site: test-site-id, job: test-job-id. Preview URLs: ["https://main--adobe-screens-brandads--anagarwa.aem.page","https://main--adobe-screens-brandads--anagarwa.aem.page/test-page"]
[preflight-audit] site: test-site-id, job: test-job-id. Audits Map keys: ["https://main--adobe-screens-brandads--anagarwa.aem.page","https://main--adobe-screens-brandads--anagarwa.aem.page/test-page"]
[preflight-audit] site: test-site-id, job: test-job-id. Scraped objects count: 2
[preflight-audit] site: test-site-id, job: test-job-id. Scraped object 0: finalUrl = "https://main--adobe-screens-brandads--anagarwa.aem.page/"
[preflight-audit] site: test-site-id, job: test-job-id. Scraped object 1: finalUrl = "https://main--adobe-screens-brandads--anagarwa.aem.page/test-page"

✅ Preflight audit completed successfully!
📊 Check the logs above for detailed results.
```

This will help you identify exactly where the URL matching is failing and what the differences are between the expected and actual URL formats. 