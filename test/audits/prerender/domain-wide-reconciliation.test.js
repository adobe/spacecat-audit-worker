/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  getDomainWideReconciliationCandidates,
  syncCoveredByDomainWide,
} from '../../../src/prerender/domain-wide-reconciliation.js';
import { DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE } from '../../../src/prerender/utils/constants.js';
import {
  buildContext,
  buildDataAccess,
  buildOpportunity,
  buildSuggestion,
} from './behaviour/helpers.js';

use(sinonChai);

const SITE_ID = 'test-site-id';
const DEPLOYED_AT = new Date('2026-08-01T00:00:00.000Z').getTime();

function domainWideSuggestion(sandbox, { status = 'NEW', edgeDeployed = DEPLOYED_AT } = {}) {
  return buildSuggestion(sandbox, {
    id: 'domain-wide-id',
    status,
    data: { isDomainWide: true, ...(edgeDeployed !== undefined && { edgeDeployed }) },
  });
}

function coveredSuggestion(sandbox, { id, url, coveredByDomainWide = 'domain-wide-id' } = {}) {
  return buildSuggestion(sandbox, {
    id,
    data: { url, coveredByDomainWide },
  });
}

function statusWithPages(pages) {
  return { pages };
}

describe('domain-wide-reconciliation', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('getDomainWideReconciliationCandidates', () => {
    it('returns [] when dataAccess has no Opportunity entity at all', async () => {
      const context = buildContext(sandbox, { dataAccess: {} });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the matched opportunity has no getSuggestions function', async () => {
      const opportunity = { getType: () => 'prerender' };
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('treats a missing/undefined siteStatus the same as an empty page list', async () => {
      const url = 'https://example.com/no-status-json';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, undefined);

      expect(result).to.deep.equal([url]);
    });

    it('returns [] when there is no NEW prerender opportunity', async () => {
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the only NEW opportunity is not a prerender opportunity', async () => {
      const opportunity = buildOpportunity(sandbox, { type: 'other-audit-type' });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the opportunity has no domain-wide suggestion', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the domain-wide suggestion has no edgeDeployed set', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox, { edgeDeployed: undefined })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the only domain-wide suggestion with edgeDeployed is OUTDATED', async () => {
      // Bug fix: an OUTDATED domain-wide suggestion that still carries a stale edgeDeployed
      // must not be treated as currently deployed — mirrors the NEW-status guard that
      // getDomainWideSuggestionDeployedAtEdge already enforced pre-merge.
      const outdatedWithEdge = domainWideSuggestion(sandbox, { status: 'OUTDATED' });
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [outdatedWithEdge, coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the domain-wide suggestion has an unparseable edgeDeployed value', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [
          domainWideSuggestion(sandbox, { edgeDeployed: 'not-a-valid-date' }),
          coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' }),
        ],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/unparseable/));
    });

    it('returns [] when no suggestions are coveredByDomainWide', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [
          domainWideSuggestion(sandbox),
          buildSuggestion(sandbox, { id: 's1', data: { url: 'https://example.com/a' } }),
        ],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('excludes domain-wide and path-type suggestions even if coveredByDomainWide is set', async () => {
      const pathSuggestion = buildSuggestion(sandbox, {
        id: 'path-1',
        data: { allowedRegexPatterns: ['/blog/*'], coveredByDomainWide: 'domain-wide-id' },
      });
      const otherDomainWide = buildSuggestion(sandbox, {
        id: 'dw-2',
        data: { isDomainWide: true, coveredByDomainWide: 'domain-wide-id' },
      });
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), pathSuggestion, otherDomainWide],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([]);
    });

    it('includes a covered URL with no status.json entry at all (never scraped)', async () => {
      const url = 'https://example.com/never-scraped';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.deep.equal([url]);
    });

    it('includes a covered URL scraped successfully before the deploy date', async () => {
      const url = 'https://example.com/pre-deploy';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([{
        url,
        scrapingStatus: 'success',
        scrapedAt: new Date(DEPLOYED_AT - 1000).toISOString(),
      }]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([url]);
    });

    it('excludes a covered URL confirmed successfully scraped after the deploy date', async () => {
      const url = 'https://example.com/confirmed';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([{
        url,
        scrapingStatus: 'success',
        scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
      }]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([]);
    });

    it('includes a covered URL whose only post-deploy attempt errored (does not retire it)', async () => {
      const url = 'https://example.com/errored';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([{
        url,
        scrapingStatus: 'error',
        scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
      }]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([url]);
    });

    it('includes a covered URL whose only post-deploy attempt was a bot-blocked/missing "failed" entry', async () => {
      const url = 'https://example.com/bot-blocked';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([{
        url,
        scrapingStatus: 'failed',
        scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
      }]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([url]);
    });

    it('ignores status.json page entries with no url field', async () => {
      const url = 'https://example.com/never-scraped';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([{ scrapingStatus: 'success' }]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([url]);
    });

    it('sorts the backlog ascending by scrapedAt, missing entries first', async () => {
      const urlNew = 'https://example.com/newer';
      const urlOld = 'https://example.com/older';
      const urlMissing = 'https://example.com/missing-entry';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [
          domainWideSuggestion(sandbox),
          coveredSuggestion(sandbox, { id: 's-new', url: urlNew }),
          coveredSuggestion(sandbox, { id: 's-old', url: urlOld }),
          coveredSuggestion(sandbox, { id: 's-missing', url: urlMissing }),
        ],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });
      const siteStatus = statusWithPages([
        { url: urlNew, scrapingStatus: 'error', scrapedAt: new Date(DEPLOYED_AT - 1000).toISOString() },
        { url: urlOld, scrapingStatus: 'error', scrapedAt: new Date(DEPLOYED_AT - 5000).toISOString() },
      ]);

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, siteStatus);

      expect(result).to.deep.equal([urlMissing, urlOld, urlNew]);
    });

    it(`caps the batch at DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE (${DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE})`, async () => {
      const total = DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE + 5;
      const suggestions = Array.from({ length: total }, (_, i) => coveredSuggestion(sandbox, {
        id: `s-${i}`,
        url: `https://example.com/page-${i}`,
      }));
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), ...suggestions],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID, statusWithPages([]));

      expect(result).to.have.length(DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE);
    });
  });

  describe('syncCoveredByDomainWide', () => {
    it('falls back to empty string for baseUrl/siteId when site getBaseURL/getId are missing', async () => {
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox, { site: { getBaseURL: () => '', getId: () => '' } });

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: false }],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([suggestion]);
    });

    it('no-ops when opportunity is null', async () => {
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(null, context, [{ url: 'https://example.com/a', isDeployedAtEdge: false }]);

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when opportunity has no getSuggestions function', async () => {
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide({}, context, [{ url: 'https://example.com/a', isDeployedAtEdge: false }]);

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when dataAccess.Suggestion.saveMany is missing', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox, { dataAccess: { Suggestion: {} } });

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: false }],
      );

      // Should not throw — guard returns before touching getSuggestions at all.
      expect(opportunity.getSuggestions).to.not.have.been.called;
    });

    it('does not save when every successful comparison confirms isDeployedAtEdge: true and there is no domain-wide suggestion', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: true }],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when no suggestion is coveredByDomainWide', async () => {
      const suggestion = buildSuggestion(sandbox, { id: 's1', data: { url: 'https://example.com/a' } });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: false }],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('does not clear domain-wide or path-type suggestions even if their pathname matches', async () => {
      const pathSuggestion = buildSuggestion(sandbox, {
        id: 'path-1',
        data: { allowedRegexPatterns: ['/blog/*'], coveredByDomainWide: 'dw-1', url: 'https://example.com/blog' },
      });
      const dwSuggestion = buildSuggestion(sandbox, {
        id: 'dw-1',
        data: { isDomainWide: true, coveredByDomainWide: 'dw-1', url: 'https://example.com/blog' },
      });
      const opportunity = buildOpportunity(sandbox, { suggestions: [pathSuggestion, dwSuggestion] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/blog', isDeployedAtEdge: false }],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('does not clear a suggestion when only a different query-param sibling was scraped', async () => {
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a?x=1' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a?y=2', isDeployedAtEdge: false }],
      );

      expect(suggestion.setData).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('clears a suggestion confirmed not deployed by its own exact URL result', async () => {
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a?x=1' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a?x=1', isDeployedAtEdge: false }],
      );

      expect(suggestion.setData).to.have.been.calledWith({ url: 'https://example.com/a?x=1' });
      expect(suggestion.setUpdatedBy).to.have.been.calledWith('system');
      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([suggestion]);
    });

    it('does not clear a suggestion when two comparisons normalize to the same key and disagree — the positive confirmation wins', async () => {
      // ?gclid=... is a stripped tracking param, so both normalize to the same key.
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a?gclid=1' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [
          { url: 'https://example.com/a?gclid=1', isDeployedAtEdge: true },
          { url: 'https://example.com/a?gclid=2', isDeployedAtEdge: false },
        ],
      );

      expect(suggestion.setData).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('does not re-cover (redundant write) a NEW per-URL suggestion that is already coveredByDomainWide', async () => {
      const domainWide = domainWideSuggestion(sandbox);
      const alreadyCovered = coveredSuggestion(sandbox, { id: 'url-1', url: 'https://example.com/page1' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [domainWide, alreadyCovered] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/page1', isDeployedAtEdge: true }],
      );

      expect(alreadyCovered.setData).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('clears multiple matching suggestions in a single saveMany call', async () => {
      const s1 = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' });
      const s2 = coveredSuggestion(sandbox, { id: 's2', url: 'https://example.com/b' });
      const stillDeployed = coveredSuggestion(sandbox, { id: 's3', url: 'https://example.com/c' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [s1, s2, stillDeployed] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [
          { url: 'https://example.com/a', isDeployedAtEdge: false },
          { url: 'https://example.com/b', isDeployedAtEdge: false },
          { url: 'https://example.com/c', isDeployedAtEdge: true },
        ],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([s1, s2]);
      expect(stillDeployed.setData).to.not.have.been.called;
    });

    it('logs and swallows an error from saveMany without throwing', async () => {
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);
      context.dataAccess.Suggestion.saveMany.rejects(new Error('db unavailable'));

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: false }],
      );

      expect(context.log.error).to.have.been.called;
    });

    it('covers NEW per-URL and path suggestions when the domain-wide suggestion is deployed', async () => {
      const domainWide = domainWideSuggestion(sandbox);
      const urlSuggestion = buildSuggestion(sandbox, {
        id: 'url-1',
        data: { url: 'https://example.com/page1' },
      });
      const pathSuggestion = buildSuggestion(sandbox, {
        id: 'path-1',
        data: { allowedRegexPatterns: ['/blog/*'] },
      });
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWide, urlSuggestion, pathSuggestion],
      });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/page1', isDeployedAtEdge: true }],
      );

      expect(urlSuggestion.setData).to.have.been.calledWith(sinon.match({ coveredByDomainWide: 'domain-wide-id' }));
      expect(pathSuggestion.setData).to.have.been.calledWith(sinon.match({ coveredByDomainWide: 'domain-wide-id' }));
      expect(urlSuggestion.setUpdatedBy).to.have.been.calledWith('system');
      expect(pathSuggestion.setUpdatedBy).to.have.been.calledWith('system');
      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([urlSuggestion, pathSuggestion]);
      expect(context.log.info).to.have.been.calledWith(sinon.match(/isAllDomainDeployedAtEdge=true/));
    });

    it('does not cover an already edgeDeployed per-URL suggestion or an already-covered path suggestion', async () => {
      const domainWide = domainWideSuggestion(sandbox);
      const alreadyDeployed = buildSuggestion(sandbox, {
        id: 'url-1',
        data: { url: 'https://example.com/page1', edgeDeployed: 111 },
      });
      const alreadyCoveredPath = buildSuggestion(sandbox, {
        id: 'path-1',
        data: { allowedRegexPatterns: ['/blog/*'], coveredByDomainWide: 'dw-old' },
      });
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWide, alreadyDeployed, alreadyCoveredPath],
      });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/page1', isDeployedAtEdge: true }],
      );

      expect(alreadyDeployed.setData).to.not.have.been.called;
      expect(alreadyCoveredPath.setData).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/no NEW suggestions to cover/));
    });

    it('logs "no NEW suggestions to cover" when the domain-wide suggestion is deployed but no other NEW suggestions exist', async () => {
      // The domain-wide suggestion itself is always NEW but never a coverage candidate
      // (no url, and isPathSuggestionData excludes anything with isDomainWide) — so with
      // no other suggestions in the opportunity, toCover is empty.
      const domainWide = domainWideSuggestion(sandbox);
      const opportunity = buildOpportunity(sandbox, { suggestions: [domainWide] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(opportunity, context, []);

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/no NEW suggestions to cover/));
    });

    it('covers and clears in the same run via a single saveMany call', async () => {
      const domainWide = domainWideSuggestion(sandbox);
      const toCover = buildSuggestion(sandbox, {
        id: 'url-1',
        data: { url: 'https://example.com/newly-deployed' },
      });
      const toClear = coveredSuggestion(sandbox, { id: 'url-2', url: 'https://example.com/rolled-back' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [domainWide, toCover, toClear] });
      const context = buildContext(sandbox);

      await syncCoveredByDomainWide(
        opportunity,
        context,
        [
          { url: 'https://example.com/newly-deployed', isDeployedAtEdge: true },
          { url: 'https://example.com/rolled-back', isDeployedAtEdge: false },
        ],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
      const saved = context.dataAccess.Suggestion.saveMany.firstCall.args[0];
      expect(saved).to.include(toCover);
      expect(saved).to.include(toClear);
    });
  });
});
