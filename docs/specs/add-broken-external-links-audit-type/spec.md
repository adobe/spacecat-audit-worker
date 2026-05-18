## Spec: spacecat-audit-worker [TESTING-SDD-PR]

### Problem
There is no audit that checks a site's own pages for outbound links that are broken (4xx/5xx) on external hosts. Users cannot discover which of their pages link out to dead external resources, leading to poor user experience and SEO leakage. The `broken-external-links` audit closes this gap using the same Opportunity/Suggestion model as the existing link audits.

### Implementation Tasks

**Task 1 — Create audit directory**
- Create `src/broken-external-links/` containing:
  - `handler.js`
  - `helpers.js`
  - `opportunity-data-mapper.js`

**Task 2 — `helpers.js`: link extraction and per-domain rate limiter**
- `extractExternalLinks($, siteHostname)` — given a Cheerio-loaded document and the site's hostname, return all unique `href` values where `new URL(href).hostname !== siteHostname` and href starts with `http://` or `https://`.
- `checkExternalLinks(links, log)` — checks each link's HTTP status using `tracingFetch` from `@adobe/spacecat-shared-utils`. Implements a per-domain rate limiter via a `Map<domain, lastRequestMs>`: before each request, compute `elapsed = Date.now() - lastRequestMs[domain]`; if `elapsed < DOMAIN_RATE_LIMIT_MS` (default 1000 ms), `await sleep(DOMAIN_RATE_LIMIT_MS - elapsed)`. Returns an array of `{ url, status }` for all links that returned `status >= 400`.
- Constants: `DOMAIN_RATE_LIMIT_MS = 1000`, `FETCH_TIMEOUT_MS = 5000`, `MAX_PAGES = 100`, `MAX_EXTERNAL_LINKS_PER_PAGE = 50`.

**Task 3 — `opportunity-data-mapper.js`**
```js
export function createOpportunityData() {
  return {
    runbook: 'https://...',  // TBD — create runbook doc
    origin: 'AUTOMATION',
    title: 'Fix broken external links to improve user experience',
    description: 'External links returning 4xx or 5xx errors break user journeys and may signal stale or incorrect content.',
    guidance: {
      steps: [
        'Review each broken external link listed below.',
        'Update or remove links that no longer resolve.',
        'Consider replacing with an archived version (e.g. Wayback Machine) where appropriate.',
      ],
    },
    tags: ['Engagement', 'Traffic acquisition'],
    data: {
      dataSources: ['SITE'],
    },
  };
}
```

**Task 4 — `handler.js`: RunnerAudit**

Use `AuditBuilder.withRunner()` (single-step, no SQS fan-out needed for weekly cycle):

```js
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { extractExternalLinks, checkExternalLinks, MAX_PAGES } from './helpers.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS;

async function brokenExternalLinksRunner(auditUrl, context) {
  const { site, dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(
    site.getId(), 'seo', 'global',
  );
  const pages = topPages.slice(0, MAX_PAGES);

  const siteHostname = new URL(auditUrl).hostname;
  const brokenLinksBySrcPage = [];

  for (const page of pages) {
    const pageUrl = page.getURL();
    let html;
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(pageUrl, { timeout: 8000 });
      if (!response.ok) continue;
      // eslint-disable-next-line no-await-in-loop
      html = await response.text();
    } catch (err) {
      log.warn(`Failed to fetch page ${pageUrl}: ${err.message}`);
      continue;
    }

    const $ = cheerioLoad(html);
    const externalLinks = extractExternalLinks($, siteHostname);
    if (externalLinks.length === 0) continue;

    // eslint-disable-next-line no-await-in-loop
    const broken = await checkExternalLinks(externalLinks, log);
    if (broken.length > 0) {
      brokenLinksBySrcPage.push({ pageUrl, brokenLinks: broken });
    }
  }

  const auditResult = { brokenLinksBySrcPage, totalBrokenLinks: brokenLinksBySrcPage.reduce((acc, p) => acc + p.brokenLinks.length, 0) };

  if (auditResult.totalBrokenLinks > 0) {
    const suggestions = buildSuggestions(brokenLinksBySrcPage);
    await convertToOpportunity(auditUrl, { siteId: site.getId(), ...auditResult }, context, createOpportunityData, AUDIT_TYPE);
    await syncSuggestions(site.getId(), suggestions, context);
  }

  return { auditData: auditResult, fullAuditRef: auditUrl };
}

export default new AuditBuilder()
  .withRunner(brokenExternalLinksRunner)
  .build();
```

The handler builds one Suggestion per unique broken external URL (not per source page), attaching the list of `urlFrom` source pages as data. This mirrors the broken-backlinks suggestion model.

**Task 5 — Register in `src/index.js`**
- Import: `import brokenExternalLinks from './broken-external-links/handler.js';`
- Add to `HANDLERS` map: `'broken-external-links': brokenExternalLinks,`

**Task 6 — Tests in `test/broken-external-links/`**
- `handler.test.js` — mock `SiteTopPage`, `tracingFetch`, `Opportunity`, `Suggestion`; verify happy path (broken links found → opportunity + suggestions created), no-broken-links path (no opportunity created), fetch-error path (page skipped, no throw), empty top-pages path.
- `helpers.test.js` — test `extractExternalLinks` (filters internal, relative, mailto links), `checkExternalLinks` (rate-limit delay applied, 4xx/5xx recorded, 2xx/3xx ignored).
- `opportunity-data-mapper.test.js` — snapshot test on returned object shape.

### Affected Files
- `src/broken-external-links/handler.js` (new)
- `src/broken-external-links/helpers.js` (new)
- `src/broken-external-links/opportunity-data-mapper.js` (new)
- `src/index.js` (import + HANDLERS entry)
- `test/broken-external-links/handler.test.js` (new)
- `test/broken-external-links/helpers.test.js` (new)
- `test/broken-external-links/opportunity-data-mapper.test.js` (new)

### Testing Strategy
- **100% line/branch/statement coverage** is enforced by CI (`c8` with thresholds in `.c8rc`).
- Use `MockContextBuilder` from `test/support/` to construct the full Lambda context.
- Mock `tracingFetch` via `nock` or `sinon.stub` — never make real HTTP calls in unit tests.
- Fixture: a small HTML string with 3 external links (2 broken, 1 ok) is sufficient.
- Rate-limit: use `sinon.useFakeTimers()` + stub `sleep` to verify the delay logic without real wall-clock waits.

### Dependencies on Other Repos
- **spacecat-shared must publish first.** After `Audit.AUDIT_TYPES.BROKEN_EXTERNAL_LINKS` is released, bump `@adobe/spacecat-shared-data-access` in this repo's `package.json` before implementing.

### Notes
- `MAX_PAGES = 100` is a pragmatic upper bound for Lambda timeout safety. Can be made configurable via `site.getConfig().getHandlerConfig('broken-external-links')?.maxPages`.
- No retries on transient 5xx — per issue requirement. A transient 503 is reported as a broken link.
- Skip `mailto:`, `tel:`, `#fragment-only`, and relative links in `extractExternalLinks`.
- The audit intentionally does **not** use ScrapeCat / the SQS scraping pipeline to keep the implementation simple and avoid adding another multi-step async flow for a new audit type. Revisit if site scale demands it.
- `spacecat-api-service` trigger registration is deferred to a future iteration; the audit is exercisable via the scheduled Jobs Dispatcher only until then.
