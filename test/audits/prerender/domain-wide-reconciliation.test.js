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
  reconcileCoveredByDomainWide,
} from '../../../src/prerender/domain-wide-reconciliation.js';
import { DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE } from '../../../src/prerender/utils/constants.js';
import {
  buildContext,
  buildDataAccess,
  buildOpportunity,
  buildS3Client,
  buildSuggestion,
  statusKey,
} from './behaviour/helpers.js';

use(sinonChai);

const SITE_ID = 'test-site-id';
const DEPLOYED_AT = new Date('2026-08-01T00:00:00.000Z').getTime();

function domainWideSuggestion(sandbox, { edgeDeployed = DEPLOYED_AT } = {}) {
  return buildSuggestion(sandbox, {
    id: 'domain-wide-id',
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

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the matched opportunity has no getSuggestions function', async () => {
      const opportunity = { getType: () => 'prerender' };
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('treats a missing status.json (no pages key at all) the same as an empty page list', async () => {
      const url = 'https://example.com/no-status-json';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {}),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([url]);
    });

    it('returns [] when there is no NEW prerender opportunity', async () => {
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the only NEW opportunity is not a prerender opportunity', async () => {
      const opportunity = buildOpportunity(sandbox, { type: 'other-audit-type' });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the opportunity has no domain-wide suggestion', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('returns [] when the domain-wide suggestion has no edgeDeployed set', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox, { edgeDeployed: undefined })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
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

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

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

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('includes a covered URL with no status.json entry at all (never scraped)', async () => {
      const url = 'https://example.com/never-scraped';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, { [statusKey(SITE_ID)]: statusWithPages([]) }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([url]);
    });

    it('includes a covered URL scraped successfully before the deploy date', async () => {
      const url = 'https://example.com/pre-deploy';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([{
            url,
            scrapingStatus: 'success',
            scrapedAt: new Date(DEPLOYED_AT - 1000).toISOString(),
          }]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([url]);
    });

    it('excludes a covered URL confirmed successfully scraped after the deploy date', async () => {
      const url = 'https://example.com/confirmed';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([{
            url,
            scrapingStatus: 'success',
            scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
          }]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([]);
    });

    it('includes a covered URL whose only post-deploy attempt errored (does not retire it)', async () => {
      const url = 'https://example.com/errored';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([{
            url,
            scrapingStatus: 'error',
            scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
          }]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([url]);
    });

    it('includes a covered URL whose only post-deploy attempt was a bot-blocked/missing "failed" entry', async () => {
      const url = 'https://example.com/bot-blocked';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([{
            url,
            scrapingStatus: 'failed',
            scrapedAt: new Date(DEPLOYED_AT + 1000).toISOString(),
          }]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.deep.equal([url]);
    });

    it('ignores status.json page entries with no url field', async () => {
      const url = 'https://example.com/never-scraped';
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [domainWideSuggestion(sandbox), coveredSuggestion(sandbox, { id: 's1', url })],
      });
      const context = buildContext(sandbox, {
        dataAccess: buildDataAccess(sandbox, { opportunities: [opportunity] }),
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([{ scrapingStatus: 'success' }]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

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
        s3Client: buildS3Client(sandbox, {
          [statusKey(SITE_ID)]: statusWithPages([
            { url: urlNew, scrapingStatus: 'error', scrapedAt: new Date(DEPLOYED_AT - 1000).toISOString() },
            { url: urlOld, scrapingStatus: 'error', scrapedAt: new Date(DEPLOYED_AT - 5000).toISOString() },
          ]),
        }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

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
        s3Client: buildS3Client(sandbox, { [statusKey(SITE_ID)]: statusWithPages([]) }),
      });

      const result = await getDomainWideReconciliationCandidates(context, SITE_ID);

      expect(result).to.have.length(DOMAIN_WIDE_RECONCILIATION_BATCH_SIZE);
    });
  });

  describe('reconcileCoveredByDomainWide', () => {
    it('no-ops when opportunity is null', async () => {
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide(null, context, [{ url: 'https://example.com/a', isDeployedAtEdge: false }]);

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when opportunity has no getSuggestions function', async () => {
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide({}, context, [{ url: 'https://example.com/a', isDeployedAtEdge: false }]);

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when every successful comparison confirms isDeployedAtEdge: true', async () => {
      const opportunity = buildOpportunity(sandbox, {
        suggestions: [coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' })],
      });
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: true }],
      );

      expect(opportunity.getSuggestions).to.not.have.been.called;
      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when no suggestion is coveredByDomainWide', async () => {
      const suggestion = buildSuggestion(sandbox, { id: 's1', data: { url: 'https://example.com/a' } });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide(
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

      await reconcileCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/blog', isDeployedAtEdge: false }],
      );

      expect(context.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('clears coveredByDomainWide on a suggestion confirmed not deployed at edge, matching by pathname regardless of query params', async () => {
      const suggestion = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a?x=1' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [suggestion] });
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a?y=2', isDeployedAtEdge: false }],
      );

      expect(suggestion.setData).to.have.been.calledWith({ url: 'https://example.com/a?x=1' });
      expect(suggestion.setUpdatedBy).to.have.been.calledWith('system');
      expect(context.dataAccess.Suggestion.saveMany).to.have.been.calledWith([suggestion]);
    });

    it('clears multiple matching suggestions in a single saveMany call', async () => {
      const s1 = coveredSuggestion(sandbox, { id: 's1', url: 'https://example.com/a' });
      const s2 = coveredSuggestion(sandbox, { id: 's2', url: 'https://example.com/b' });
      const stillDeployed = coveredSuggestion(sandbox, { id: 's3', url: 'https://example.com/c' });
      const opportunity = buildOpportunity(sandbox, { suggestions: [s1, s2, stillDeployed] });
      const context = buildContext(sandbox);

      await reconcileCoveredByDomainWide(
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

      await reconcileCoveredByDomainWide(
        opportunity,
        context,
        [{ url: 'https://example.com/a', isDeployedAtEdge: false }],
      );

      expect(context.log.error).to.have.been.called;
    });
  });
});
