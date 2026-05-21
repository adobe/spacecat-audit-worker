/*
 * Copyright 2025 Adobe. All rights reserved.
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
import esmock from 'esmock';

use(sinonChai);

describe('opportunity-syncer', () => {
  let sandbox;
  let convertToOpportunityStub;
  let syncSuggestionsStub;
  let mod;

  before(async () => {
    convertToOpportunityStub = sinon.stub();
    syncSuggestionsStub = sinon.stub();
    mod = await esmock('../../../src/prerender/opportunity-syncer.js', {
      '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
      '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    convertToOpportunityStub.reset();
    syncSuggestionsStub.reset();
    syncSuggestionsStub.resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function buildLog() {
    return {
      info: sinon.stub(),
      debug: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  }

  function buildContext(overrides = {}) {
    const { dataAccess, ...rest } = overrides;
    return {
      log: buildLog(),
      site: {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      },
      dataAccess: {
        Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
        Suggestion: {
          allByOpportunityIdAndStatus: sinon.stub().resolves([]),
          saveMany: sinon.stub().resolves(),
        },
        ...dataAccess,
      },
      ...rest,
    };
  }

  function buildSuggestion(opts = {}) {
    return {
      getId: sinon.stub().returns(opts.id || 'suggestion-id'),
      getStatus: sinon.stub().returns(opts.status || 'NEW'),
      getData: sinon.stub().returns(opts.data || {}),
      setData: sinon.stub(),
    };
  }

  function buildOpportunity(suggestions = []) {
    return {
      getId: sinon.stub().returns('opp-id'),
      getType: sinon.stub().returns('prerender'),
      getSuggestions: sinon.stub().resolves(suggestions),
    };
  }

  function buildAuditData(overrides = {}) {
    const { auditResult, ...rest } = overrides;
    return {
      siteId: 'site-1',
      id: 'audit-id',
      auditId: 'audit-id',
      scrapeJobId: 'job-1',
      scrapedUrlsSet: new Set(['https://example.com/page-1']),
      auditResult: {
        urlsNeedingPrerender: 1,
        results: [{
          url: 'https://example.com/page-1',
          needsPrerender: true,
          contentGainRatio: 2.5,
          wordCountBefore: 100,
          wordCountAfter: 200,
          citabilityScore: 0.8,
        }],
        ...auditResult,
      },
      ...rest,
    };
  }

  // ─── detectWrongEdgeDeployedStatus ────────────────────────────────────────────

  describe('detectWrongEdgeDeployedStatus', () => {
    it('no-ops when no opportunity of PRERENDER type is found', async () => {
      const ctx = buildContext({
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
        },
      });
      await mod.detectWrongEdgeDeployedStatus(ctx.dataAccess, 'site-id', 'https://example.com', ctx.log);
      expect(ctx.log.warn).to.not.have.been.called;
    });

    it('no-ops when non-NEW suggestions all lack edgeDeployed', async () => {
      const opp = buildOpportunity([
        buildSuggestion({ status: 'NEW', data: {} }),
        buildSuggestion({ status: 'OUTDATED', data: {} }),
      ]);
      const ctx = buildContext({
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([opp]) },
        },
      });
      await mod.detectWrongEdgeDeployedStatus(ctx.dataAccess, 'site-id', 'https://example.com', ctx.log);
      expect(ctx.log.warn).to.not.have.been.called;
    });

    it('warns when non-NEW suggestions have edgeDeployed set', async () => {
      const opp = buildOpportunity([
        buildSuggestion({ status: 'FIXED', data: { edgeDeployed: true } }),
      ]);
      const ctx = buildContext({
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([opp]) },
        },
      });
      await mod.detectWrongEdgeDeployedStatus(ctx.dataAccess, 'site-id', 'https://example.com', ctx.log);
      expect(ctx.log.warn).to.have.been.calledOnce;
      expect(ctx.log.warn.firstCall.args[0]).to.match(/nonNewEdgeDeployedCount=1/);
    });

    it('no-ops when allBySiteIdAndStatus resolves null (covers ?? [] fallback)', async () => {
      const ctx = buildContext({
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves(null) },
        },
      });
      await mod.detectWrongEdgeDeployedStatus(ctx.dataAccess, 'site-id', 'https://example.com', ctx.log);
      expect(ctx.log.warn).to.not.have.been.called;
    });

    it('no-ops when getSuggestions resolves null (covers ?? [] fallback)', async () => {
      const opp = buildOpportunity([]);
      opp.getSuggestions = sinon.stub().resolves(null);
      const ctx = buildContext({
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([opp]) },
        },
      });
      await mod.detectWrongEdgeDeployedStatus(ctx.dataAccess, 'site-id', 'https://example.com', ctx.log);
      expect(ctx.log.warn).to.not.have.been.called;
    });
  });

  // ─── markNewSuggestionsAsCovered ─────────────────────────────────────────────

  describe('markNewSuggestionsAsCovered', () => {
    it('no-ops when opportunity is null', async () => {
      const ctx = buildContext();
      await mod.markNewSuggestionsAsCovered(null, ctx, new Set(['/page']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when opportunity has no getSuggestions function', async () => {
      const ctx = buildContext();
      await mod.markNewSuggestionsAsCovered({ getId: () => 'x' }, ctx, new Set(['/page']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when no domain-wide NEW suggestion has edgeDeployed', async () => {
      const opp = buildOpportunity([
        buildSuggestion({ status: 'NEW', data: { isDomainWide: true, edgeDeployed: false } }),
        buildSuggestion({ status: 'NEW', data: { isDomainWide: false, edgeDeployed: true } }),
      ]);
      const ctx = buildContext();
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/page']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });

    it('no-ops when SuggestionDA bulk methods are unavailable', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const ctx = buildContext({ dataAccess: { Suggestion: {} } });
      // should not throw
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/page']));
    });

    it('no-ops and logs when there are no NEW suggestions in DB', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const ctx = buildContext({
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([]),
            saveMany: sinon.stub().resolves(),
          },
        },
      });
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/page']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.info).to.have.been.calledWith(sinon.match(/no NEW suggestions found/));
    });

    it('no-ops when deployedAtEdgePathnames is empty', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const perUrl = buildSuggestion({ status: 'NEW', data: { url: 'https://example.com/page' } });
      const ctx = buildContext({
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([perUrl]),
            saveMany: sinon.stub().resolves(),
          },
        },
      });
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set());
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.info).to.have.been.calledWith(sinon.match(/no NEW suggestions matched deployed/));
    });

    it('no-ops when NEW suggestions exist but none match deployed pathnames', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const perUrl = buildSuggestion({ status: 'NEW', data: { url: 'https://example.com/other' } });
      const ctx = buildContext({
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([perUrl]),
            saveMany: sinon.stub().resolves(),
          },
        },
      });
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/deployed-page']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
      expect(ctx.log.info).to.have.been.calledWith(sinon.match(/no NEW suggestions matched deployed/));
    });

    it('marks matching NEW suggestions as coveredByDomainWide and saves', async () => {
      const domainWide = buildSuggestion({ id: 'dw-99', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const perUrl = buildSuggestion({ status: 'NEW', data: { url: 'https://example.com/deployed' } });
      const ctx = buildContext({
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([perUrl]),
            saveMany: sinon.stub().resolves(),
          },
        },
      });
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/deployed']));
      expect(perUrl.setData).to.have.been.calledWith(sinon.match({ coveredByDomainWide: 'dw-99' }));
      expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
    });

    it('handles null site gracefully — covers || "" fallbacks on lines 86-87 and 132', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const perUrl = buildSuggestion({ status: 'NEW', data: { url: 'https://example.com/deployed' } });
      const saveManyStub = sinon.stub().resolves();
      const ctx = {
        log: buildLog(),
        site: null,
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([perUrl]),
            saveMany: saveManyStub,
          },
        },
      };
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/deployed']));
      expect(saveManyStub).to.have.been.calledOnce;
    });

    it('skips suggestions that already have edgeDeployed set', async () => {
      const domainWide = buildSuggestion({ id: 'dw-1', status: 'NEW', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([domainWide]);
      const alreadyDeployed = buildSuggestion({ status: 'NEW', data: { url: 'https://example.com/deployed', edgeDeployed: true } });
      const ctx = buildContext({
        dataAccess: {
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([alreadyDeployed]),
            saveMany: sinon.stub().resolves(),
          },
        },
      });
      await mod.markNewSuggestionsAsCovered(opp, ctx, new Set(['/deployed']));
      expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    });
  });

  // ─── createScrapeForbiddenOpportunity ─────────────────────────────────────────

  describe('createScrapeForbiddenOpportunity', () => {
    it('calls convertToOpportunity with the audit URL and data', async () => {
      convertToOpportunityStub.resolves({});
      const ctx = buildContext();
      const auditData = {
        siteId: 'site-1',
        id: 'audit-id',
        auditId: 'audit-id',
        auditResult: { scrapeForbidden: true, scrapeForbiddenCount: 3 },
        scrapeJobId: 'job-1',
      };
      await mod.createScrapeForbiddenOpportunity('https://example.com', auditData, ctx, false);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(convertToOpportunityStub.firstCall.args[0]).to.equal('https://example.com');
      expect(convertToOpportunityStub.firstCall.args[1]).to.equal(auditData);
    });
  });

  // ─── processOpportunityAndSuggestions ─────────────────────────────────────────

  describe('processOpportunityAndSuggestions', () => {
    it('creates domain-wide aggregate and returns auditRunCandidates with correct shape', async () => {
      const opp = buildOpportunity([]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      const auditData = buildAuditData({
        auditResult: {
          urlsNeedingPrerender: 2,
          results: [
            {
              url: 'https://example.com/page-1',
              needsPrerender: true,
              contentGainRatio: 2.0,
              wordCountBefore: 100,
              wordCountAfter: 200,
              citabilityScore: 0.8,
            },
            {
              url: 'https://example.com/page-2',
              needsPrerender: true,
              contentGainRatio: 3.0,
              wordCountBefore: 50,
              wordCountAfter: 0,
              // no citabilityScore — covers the ?? null branch
            },
          ],
        },
        scrapedUrlsSet: new Set(['https://example.com/page-1', 'https://example.com/page-2']),
      });

      const result = await mod.processOpportunityAndSuggestions('https://example.com', auditData, ctx, true);

      expect(result.opportunity).to.equal(opp);
      expect(result.auditRunCandidates).to.have.lengthOf(2);
      expect(result.auditRunCandidates[0]).to.deep.include({
        suggestionId: 'https://example.com/page-1',
        url: 'https://example.com/page-1',
      });
      expect(result.auditRunCandidates[0].originalHtmlMarkdownKey).to.include('job-1');
      expect(result.auditRunCandidates[0].markdownDiffKey).to.include('job-1');
      expect(result.auditRunCandidates[0]).to.not.have.property('getId');

      // Domain-wide suggestion was included in the sync call
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const { newData, buildKey, mapNewSuggestion, mergeDataFunction } = syncSuggestionsStub.firstCall.args[0];
      const domainWide = newData.find((s) => s.key === 'domain-wide-aggregate|prerender');
      expect(domainWide, 'domain-wide suggestion must be present').to.not.be.undefined;
      expect(domainWide.data.isDomainWide).to.equal(true);
      expect(domainWide.data.url).to.include('All Domain URLs');
      expect(domainWide.data.wordCountBefore).to.equal(150);
      expect(domainWide.data.wordCountAfter).to.equal(200);
      // contentGainRatio > 0 branch (5.0 total → 5.00)
      expect(domainWide.data.contentGainRatio).to.equal(5);

      // Exercise buildKey both branches
      const perUrlItem = newData.find((s) => !s.key);
      expect(buildKey(perUrlItem)).to.equal('/page-1'); // toPathname branch
      expect(buildKey(domainWide)).to.equal('domain-wide-aggregate|prerender'); // data.key branch

      // Exercise mapNewSuggestion both branches (domain-wide uses suggestion.data, per-URL uses mapSuggestionData)
      const mappedDomainWide = mapNewSuggestion(domainWide);
      expect(mappedDomainWide.data).to.deep.include({ isDomainWide: true });
      const mappedPerUrl = mapNewSuggestion(perUrlItem);
      expect(mappedPerUrl.data).to.have.property('url', 'https://example.com/page-1');
      expect(mappedPerUrl.data.citabilityScore).to.equal(0.8); // defined branch

      // Exercise mapNewSuggestion for suggestion without citabilityScore
      const page2Item = newData.find((s) => s.url === 'https://example.com/page-2');
      const mappedPage2 = mapNewSuggestion(page2Item);
      expect(mappedPage2.data.citabilityScore).to.be.null; // ?? null branch

      // Exercise mergeDataFunction for domain-wide (key set)
      const merged = mergeDataFunction({}, domainWide);
      expect(merged).to.deep.include({ isDomainWide: true });

      // Exercise the scrapedUrlsSet.has closure (covers the inner arrow function)
      const { scrapedUrlsSet: scs } = syncSuggestionsStub.firstCall.args[0];
      expect(scs.has('https://example.com/page-1')).to.equal(true);
      expect(scs.has('https://example.com/not-scraped')).to.equal(false);
    });

    it('skips domain-wide creation when a preservable domain-wide suggestion exists (status=NEW)', async () => {
      const existing = buildSuggestion({ status: 'NEW', data: { isDomainWide: true } });
      const opp = buildOpportunity([existing]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      await mod.processOpportunityAndSuggestions('https://example.com', buildAuditData(), ctx, false);

      const { newData } = syncSuggestionsStub.firstCall.args[0];
      expect(newData.find((s) => s.key === 'domain-wide-aggregate|prerender')).to.be.undefined;
    });

    it('preserves domain-wide suggestion via edgeDeployed when status is non-active', async () => {
      // shouldPreserveDomainWideSuggestion branch 2: status not in ACTIVE_STATUSES but edgeDeployed=true
      const existing = buildSuggestion({ status: 'APPROVED', data: { isDomainWide: true, edgeDeployed: true } });
      const opp = buildOpportunity([existing]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      await mod.processOpportunityAndSuggestions('https://example.com', buildAuditData(), ctx, false);

      const { newData } = syncSuggestionsStub.firstCall.args[0];
      expect(newData.find((s) => s.key === 'domain-wide-aggregate|prerender')).to.be.undefined;
      expect(ctx.log.info).to.have.been.calledWith(sinon.match(/Skipping domain-wide suggestion creation/));
    });

    it('creates fresh domain-wide when existing suggestion is non-active with no edgeDeployed', async () => {
      // shouldPreserveDomainWideSuggestion branch 3: status not in ACTIVE_STATUSES, no edgeDeployed
      const existing = buildSuggestion({ status: 'APPROVED', data: { isDomainWide: true } });
      const opp = buildOpportunity([existing]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      await mod.processOpportunityAndSuggestions('https://example.com', buildAuditData(), ctx, false);

      const { newData } = syncSuggestionsStub.firstCall.args[0];
      expect(newData.find((s) => s.key === 'domain-wide-aggregate|prerender')).to.not.be.undefined;
    });

    it('passes null scrapedUrlsSet to syncSuggestions when rawScrapedUrlsSet is absent', async () => {
      const opp = buildOpportunity([]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      await mod.processOpportunityAndSuggestions('https://example.com', buildAuditData({ scrapedUrlsSet: null }), ctx, false);

      const { scrapedUrlsSet } = syncSuggestionsStub.firstCall.args[0];
      expect(scrapedUrlsSet).to.be.null;
    });

    it('skips malformed URLs in auditRunCandidates without throwing', async () => {
      const opp = buildOpportunity([]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      const auditData = buildAuditData({
        auditResult: {
          urlsNeedingPrerender: 2,
          results: [
            { url: 'not-a-valid-url', needsPrerender: true, contentGainRatio: 2.0, wordCountBefore: 100, wordCountAfter: 200 },
            { url: 'https://example.com/valid', needsPrerender: true, contentGainRatio: 2.0, wordCountBefore: 100, wordCountAfter: 200 },
          ],
        },
      });

      const result = await mod.processOpportunityAndSuggestions('https://example.com', auditData, ctx, false);

      expect(result.auditRunCandidates).to.have.lengthOf(1);
      expect(result.auditRunCandidates[0].url).to.equal('https://example.com/valid');
    });

    it('sets contentGainRatio to 0 in domain-wide aggregate when all suggestions have zero ratio', async () => {
      const opp = buildOpportunity([]);
      convertToOpportunityStub.resolves(opp);

      const ctx = buildContext();
      const auditData = buildAuditData({
        auditResult: {
          urlsNeedingPrerender: 1,
          results: [{
            url: 'https://example.com/page-1',
            needsPrerender: true,
            contentGainRatio: 0,
            wordCountBefore: 0,
            wordCountAfter: 0,
          }],
        },
      });

      await mod.processOpportunityAndSuggestions('https://example.com', auditData, ctx, false);

      const { newData } = syncSuggestionsStub.firstCall.args[0];
      const domainWide = newData.find((s) => s.key === 'domain-wide-aggregate|prerender');
      // totalContentGainRatio = 0 → contentGainRatio: 0 (false branch of > 0 check)
      expect(domainWide.data.contentGainRatio).to.equal(0);
    });
  });
});
