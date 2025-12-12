# Exa AI Client

A client for the [Exa AI Find Similar Links API](https://docs.exa.ai/reference/find-similar-links) integrated into the spacecat-audit-worker.

## Overview

The Exa AI client provides semantic search capabilities to find similar pages based on a reference URL. It's useful for content discovery, research, and finding related pages programmatically.

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

## Response Format

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

All 20 tests passing ✅

## Future Work

- Move to `@adobe/spacecat-shared` packages
- Add caching layer for repeated queries
- Implement rate limiting
- Add retry logic with exponential backoff
- Support for Exa Search API (not just Find Similar)

## References

- [Exa AI Documentation](https://docs.exa.ai/)
- [Find Similar Links API](https://docs.exa.ai/reference/find-similar-links)
- [Exa Pricing](https://exa.ai/pricing)

