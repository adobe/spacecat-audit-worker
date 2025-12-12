# Exa AI Client

A client for the [Exa AI API](https://docs.exa.ai/) integrated into the spacecat-audit-worker.

## Overview

The Exa AI client provides semantic search capabilities to find similar pages and retrieve content from specific URLs. It's useful for content discovery, research, finding related pages programmatically, and fetching page contents for analysis.

## Installation & Usage

The client is implemented as a temporary measure within this repository until it can be moved to `spacecat-shared` packages.

### Basic Usage

```javascript
import ExaClient from './src/support/exa-client.js';

// Create client from context (recommended)
const exaClient = ExaClient.createFrom(context);

// Or create directly
const exaClient = new ExaClient({
  apiKey: 'your-exa-api-key',
  apiEndpoint: 'https://api.exa.ai', // optional, defaults to https://api.exa.ai
}, log);
```

### Environment Variables

Add to your `.env` or environment configuration:

```bash
EXA_API_KEY=your-exa-api-key-here
EXA_API_ENDPOINT=https://api.exa.ai  # optional
```

## API Methods

### `findSimilar(url, options)`

Find similar links to the provided URL.

**Parameters:**
- `url` (string, required): The reference URL to find similar pages for
- `options` (object, optional):
  - `numResults` (number): Number of results to return (default: 10, max: 100)
  - `text` (boolean): Include full content text (default: false)
  - `highlights` (boolean): Include highlights (default: false)
  - `summary` (boolean): Include AI-generated summary (default: false)
  - `subpages` (number): Number of subpages to crawl (default: 0)
  - `excludeDomains` (string[]): Domains to exclude from results
  - `includeDomains` (string[]): Domains to include in results
  - `startPublishedDate` (string): Filter for content published after date (YYYY-MM-DD)
  - `endPublishedDate` (string): Filter for content published before date (YYYY-MM-DD)
  - `context` (boolean): Return contents as context string for LLM (default: false)

**Returns:** Promise resolving to Exa API response

**Example:**
```javascript
const result = await exaClient.findSimilar('https://example.com/article', {
  numResults: 25,
  text: true,
  summary: true,
  includeDomains: ['example.com', 'related-site.com'],
});

console.log(`Found ${result.results.length} similar pages`);
result.results.forEach(page => {
  console.log(`- ${page.title} (${page.url})`);
  console.log(`  Summary: ${page.summary}`);
});
```

### Convenience Methods

#### `findSimilarWithContent(url, options)`

Alias for `findSimilar` with `text: true`.

```javascript
const result = await exaClient.findSimilarWithContent('https://example.com/page');
// Returns results with full text content
```

#### `findSimilarWithSummary(url, options)`

Alias for `findSimilar` with `summary: true`.

```javascript
const result = await exaClient.findSimilarWithSummary('https://example.com/page');
// Returns results with AI-generated summaries
```

#### `findSimilarWithFullContent(url, options)`

Alias for `findSimilar` with both `text: true` and `summary: true`.

```javascript
const result = await exaClient.findSimilarWithFullContent('https://example.com/page');
// Returns results with both full text and summaries
```

### `getContents(urls, options)`

Get contents for a list of specific URLs directly.

**Parameters:**
- `urls` (string[], required): Array of URLs to fetch content for
- `options` (object, optional):
  - `text` (boolean): Include full content text (default: false)
  - `highlights` (boolean|object): Include highlights or highlights config (default: false)
  - `summary` (boolean): Include AI-generated summary (default: false)
  - `subpages` (number): Number of subpages to crawl (default: 0)
  - `livecrawl` (string): Livecrawl mode - "always", "fallback", "never" (default: "fallback")
  - `context` (boolean|object): Return contents as context string for LLM (default: false)

**Returns:** Promise resolving to Exa API response with contents and status information

**Example:**
```javascript
const result = await exaClient.getContents([
  'https://example.com/page1',
  'https://example.com/page2',
], {
  text: true,
  summary: true,
});

console.log(`Retrieved ${result.results.length} pages`);
result.results.forEach(page => {
  console.log(`- ${page.title} (${page.url})`);
  console.log(`  Text length: ${page.text?.length || 0} chars`);
  console.log(`  Summary: ${page.summary}`);
});

// Check status of each URL
result.statuses.forEach(status => {
  if (status.status === 'error') {
    console.error(`Failed to fetch ${status.id}: ${status.error.tag}`);
  }
});
```

#### `getContentsWithText(urls, options)`

Alias for `getContents` with `text: true`.

```javascript
const result = await exaClient.getContentsWithText([
  'https://example.com/page1',
  'https://example.com/page2',
]);
// Returns results with full text content
```

#### `getContentsWithSummary(urls, options)`

Alias for `getContents` with `summary: true`.

```javascript
const result = await exaClient.getContentsWithSummary([
  'https://example.com/page1',
  'https://example.com/page2',
]);
// Returns results with AI-generated summaries
```

#### `getContentsWithFullContent(urls, options)`

Alias for `getContents` with both `text: true` and `summary: true`.

```javascript
const result = await exaClient.getContentsWithFullContent([
  'https://example.com/page1',
  'https://example.com/page2',
]);
// Returns results with both full text and summaries
```

## Response Format

### Find Similar Response

```javascript
{
  requestId: "unique-request-id",
  results: [
    {
      title: "Page Title",
      url: "https://example.com/similar-page",
      publishedDate: "2024-01-01T00:00:00.000Z",
      author: "Author Name",
      id: "unique-page-id",
      image: "https://example.com/image.jpg",
      favicon: "https://example.com/favicon.ico",
      text: "Full page content...",  // if text: true
      summary: "AI-generated summary...",  // if summary: true
      highlights: ["relevant excerpt..."],  // if highlights: true
      highlightScores: [0.95],
      subpages: [...]  // if subpages > 0
    }
  ],
  context: "Combined context string...",  // if context: true
  costDollars: {
    total: 0.005,
    breakDown: [...]
  }
}
```

### Get Contents Response

```javascript
{
  requestId: "unique-request-id",
  results: [
    {
      title: "Page Title",
      url: "https://example.com/page",
      publishedDate: "2024-01-01T00:00:00.000Z",
      author: "Author Name",
      id: "unique-page-id",
      image: "https://example.com/image.jpg",
      favicon: "https://example.com/favicon.ico",
      text: "Full page content...",  // if text: true
      summary: "AI-generated summary...",  // if summary: true
      highlights: ["relevant excerpt..."],  // if highlights: true
      highlightScores: [0.95],
      subpages: [...]  // if subpages > 0
    }
  ],
  statuses: [  // Status for each requested URL
    {
      id: "https://example.com/page",
      status: "success"
    },
    {
      id: "https://example.com/failed-page",
      status: "error",
      error: {
        tag: "CRAWL_NOT_FOUND",
        httpStatusCode: 404
      }
    }
  ],
  context: "Combined context string...",  // if context: true
  costDollars: {
    total: 0.002,
    breakDown: [...]
  }
}
```

## Use Cases

### Content Discovery
```javascript
// Find similar content for research
const similar = await exaClient.findSimilar('https://blog.example.com/post', {
  numResults: 10,
  summary: true,
});
```

### Competitive Analysis
```javascript
// Find similar pages from specific domains
const competitors = await exaClient.findSimilar('https://oursite.com/product', {
  numResults: 20,
  includeDomains: ['competitor1.com', 'competitor2.com'],
  text: true,
});
```

### LLM Context Building
```javascript
// Get combined context for LLM processing
const context = await exaClient.findSimilar('https://docs.example.com/topic', {
  numResults: 15,
  context: true,  // Returns combined text for RAG applications
});

// Use context.context in your LLM prompt
```

### Recent Content Only
```javascript
// Find similar pages from the last 6 months
const recent = await exaClient.findSimilar('https://example.com/article', {
  startPublishedDate: '2024-06-01',
  endPublishedDate: '2024-12-31',
  summary: true,
});
```

### Direct Content Retrieval
```javascript
// Get content for specific URLs (useful when you already know which pages you want)
const pages = await exaClient.getContentsWithFullContent([
  'https://docs.example.com/page1',
  'https://docs.example.com/page2',
  'https://docs.example.com/page3',
]);

// Check which pages succeeded
const successful = pages.results.filter((_, i) => 
  pages.statuses[i].status === 'success'
);
console.log(`Retrieved ${successful.length} out of ${pages.statuses.length} pages`);
```

### Batch Content Analysis
```javascript
// Get contents for analysis with livecrawl
const contents = await exaClient.getContents([
  'https://example.com/article1',
  'https://example.com/article2',
], {
  text: true,
  summary: true,
  livecrawl: 'always',  // Force fresh crawl
});

// Analyze each page
contents.results.forEach((page, index) => {
  const status = contents.statuses[index];
  if (status.status === 'success') {
    console.log(`Analyzing ${page.title}...`);
    // Run your analysis on page.text and page.summary
  }
});
```

## Error Handling

```javascript
try {
  const result = await exaClient.findSimilar('https://example.com/page');
} catch (error) {
  if (error.message.includes('status code 401')) {
    // API key invalid
  } else if (error.message.includes('status code 429')) {
    // Rate limit exceeded
  } else if (error.message.includes('Invalid URL')) {
    // URL validation failed
  } else {
    // Other error
  }
}

// For getContents, also check individual URL statuses
try {
  const result = await exaClient.getContents(['https://example.com/page']);
  
  result.statuses.forEach(status => {
    if (status.status === 'error') {
      switch (status.error.tag) {
        case 'CRAWL_NOT_FOUND':
          console.error(`Page not found: ${status.id}`);
          break;
        case 'CRAWL_TIMEOUT':
          console.error(`Crawl timeout: ${status.id}`);
          break;
        case 'CRAWL_LIVECRAWL_TIMEOUT':
          console.error(`Live crawl timeout: ${status.id}`);
          break;
        case 'SOURCE_NOT_AVAILABLE':
          console.error(`Source not available: ${status.id}`);
          break;
        default:
          console.error(`Unknown error for ${status.id}: ${status.error.tag}`);
      }
    }
  });
} catch (error) {
  console.error('Failed to get contents:', error);
}
```

## Cost Management

The Exa API charges per request and per page of content retrieved:
- Neural search (1-25 results): $0.005
- Neural search (26-100 results): $0.025
- Content text per page: $0.001
- Highlights per page: $0.001
- Summary per page: $0.001

The response includes cost information:
```javascript
const result = await exaClient.findSimilar(url, options);
console.log(`Cost: $${result.costDollars.total}`);
```

## Testing

Comprehensive tests are available in `/test/support/exa-client.test.js`.

Run tests:
```bash
npm run test:spec -- test/support/exa-client.test.js
```

All 33 tests passing ✅
- 20 tests for Find Similar API
- 13 tests for Get Contents API

## Future Work

- Move to `@adobe/spacecat-shared` packages
- Add caching layer for repeated queries
- Implement rate limiting
- Add retry logic with exponential backoff
- Support for Exa Search API

## References

- [Exa AI Documentation](https://docs.exa.ai/)
- [Find Similar Links API](https://docs.exa.ai/reference/find-similar-links)
- [Get Contents API](https://docs.exa.ai/reference/get-contents)
- [Exa Pricing](https://exa.ai/pricing)

