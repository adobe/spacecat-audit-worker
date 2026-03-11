# Broken Internal Links: Site Config

`broken-internal-links` is configured from one place:

- `config.handlers["broken-internal-links"].config`
- `config.handlers["broken-internal-links"].includedURLs`

## Example

```js
{
  config: {
    handlers: {
      "broken-internal-links": {
        config: {
          aemProgramId: "12345",
          aemEnvironmentId: "67890",

          enableLinkCheckerDetection: true,
          linkCheckerLookbackMinutes: 1440,
          linkCheckerMaxJobDurationMinutes: 60,
          linkCheckerMaxPollAttempts: 10,
          linkCheckerPollIntervalMs: 60000,
          linkCheckerMinTimeNeededMs: 300000,

          maxUrlsToProcess: 100,
          batchSize: 10,
          scrapeFetchDelayMs: 50,
          linkCheckBatchSize: 10,
          linkCheckDelayMs: 300,

          maxBrokenLinksPerSuggestionBatch: 100,
          maxBrokenLinksReported: 500,
          brightDataBatchSize: 10,
          brightDataMaxResults: 10,
          brightDataRequestDelayMs: 500,
          validateBrightDataUrls: false,
          suggestionBatchSize: 100,
          maxConcurrentAiCalls: 5,

          enableJavascript: true,
          pageLoadTimeout: 30000,
          evaluateTimeout: 10000,
          waitUntil: "networkidle2",
          networkIdleTimeout: 2000,
          waitForSelector: "body",
          rejectRedirects: false,
          expandShadowDOM: true,
          scrollToBottom: true,
          maxScrollDurationMs: 30000,
          clickLoadMore: true,
          loadMoreSelector: ".listings-load-more",
          screenshotTypes: [],
          hideConsentBanners: true
        },
        includedURLs: [
          "$PUBLISH_SITE_URL/ca/en/magazine/san-diego-surf.html"
        ]
      }
    }
  }
}
```

## Notes

- `waitUntil` supports: `load`, `domcontentloaded`, `networkidle0`, `networkidle2`.
- For scrolling, runtime options intentionally exposed are:
  - `scrollToBottom`
  - `maxScrollDurationMs` (or alias `scrollMaxDurationMs`)
  - `clickLoadMore`
  - `loadMoreSelector`
- Invalid or missing values fall back to defaults.
- LinkChecker is skipped if `enableLinkCheckerDetection` is false, or if `aemProgramId` / `aemEnvironmentId` are missing.
