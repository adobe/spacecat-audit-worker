# Scraper Internals — spacecat-content-scraper

Source: `spacecat-content-scraper/src/handlers/prerender-handler.js`

---

## What the Scraper Does Per URL

```
1. Validates URL — skips .pdf/.jpg/.zip/etc. (non-HTML extensions)
2. Sanitizes URL path → sanitizedImportPath (see regex in CLAUDE.md URL Normalization section)
3. Launches Chromium via Puppeteer with prerender-specific args:
   - Denies all permissions (geolocation, notifications)
   - Blocks images/media/fonts (blockHeavyResources=true in profile)
   - Handles CORS preflight with permissive headers
4. Captures server-side HTML from response.text() (raw HTTP response — what bots see)
5. detectEdgeDeployment() — separate GET request with Tokowaka UA
6. Settle loop: waits for DOM stability + network idle (up to 2 rounds)
7. expandShadowDOM() — inlines shadow DOM content into main DOM
8. Captures client-side HTML via page.content() (after JS execution)
9. Fallback: if page.content() fails, uses earlyClientSideHtml (captured right after DOMContentLoaded)
10. detectBotProtection() — checks for bot-blocking signals in response
11. Stores to S3: server-side.html, client-side.html, server-side-html.md, markdown-diff.md, scrape.json
```

---

## Bot Protection → No scrape.json (Critical for Audit Worker)

When `botProtection.blocked = true`:
- Scraper returns immediately without calling `#store()`
- **No `scrape.json` is written to S3**
- `ScrapeUrl.status` is set to `FAILED` with reason indicating bot-block
- Audit worker's `getScrapeJobStats()` detects this via missing S3 key + `ScrapeUrl` status

---

## Markdown Files — Why They Exist

The scraper uses `@adobe/spacecat-shared-html-analyzer` to produce:
- **`server-side-html.md`**: markdown of the server-side HTML (nav/footer stripped) — clean input for Mystique
- **`markdown-diff.md`**: only the *added* markdown blocks (content in client-side but absent from server-side) — what Mystique actually summarizes

This means Mystique receives pre-processed markdown, not raw HTML. The audit worker references these files via `originalHtmlKey` / `prerenderedHtmlKey` in Suggestion.data, but those point to the `.html` files — the `.md` files are consumed directly by the DRS/Mystique pipeline.

---

## `usedEarlyClientSideHtml` Flag

When the settle loop fails (browser crash, TargetCloseError) and early HTML was available, the scraper:
- Uses the HTML captured right after `domcontentloaded`
- Sets `usedEarlyClientSideHtml: true` in `scrape.json`
- The audit worker reads this flag and stores it in `Suggestion.data` and `status.json pages[]`

This is relevant because early HTML may be less complete than fully-settled HTML — the flag lets the UI show a warning.

---

## Edge Deployment Detection

The scraper makes a separate HTTP GET request using:
```
User-Agent: Mozilla/5.0 ... Tokowaka-AI Tokowaka/1.0 AdobeEdgeOptimize-AI AdobeEdgeOptimize/1.0
```
If any of these response headers are present → `isDeployedAtEdge = true`:
- `x-edgeoptimize-cache`
- `x-edgeoptimize-proxy`
- `x-tokowaka-cache`
- `x-tokowaka-proxy`

`isDeployedAtEdge` in `scrape.json` is a **boolean**. It is forwarded as-is to `status.json pages[].isDeployedAtEdge` by the audit worker. It is **NOT** the same as `Suggestion.data.edgeDeployed`, which is an ms epoch timestamp set exclusively by user deploy action from the UI.

---

## Key Decision Points for Audit Worker Code

| Scraper condition | What audit worker sees | Audit worker action |
|-------------------|------------------------|---------------------|
| Bot-blocked URL | No `scrape.json` at S3 path | Count toward 403 ratio |
| `isDeployedAtEdge: true` in scrape.json | boolean | Forward as-is to `status.json pages[].isDeployedAtEdge`; also triggers `coveredByDomainWide` logic |
| `usedEarlyClientSideHtml: true` | boolean | Forward to Suggestion.data + status.json pages[] |
| `error.statusCode: 403` in scrape.json | object | Count toward 403 ratio for bot-block detection |
| `hasMarkdownDiffFile: false` | boolean | Mystique gets no clean input for this URL |
| `status: 'FAILED'` in scrape.json | string | URL failed scraping; do not mark existing suggestion OUTDATED |
