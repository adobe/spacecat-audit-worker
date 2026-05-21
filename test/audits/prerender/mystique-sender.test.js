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

describe('sendPrerenderGuidanceRequestToMystique', () => {
  let sandbox;
  let sqsSendStub;
  let getS3PathStub;
  let mod;

  before(async () => {
    sandbox = sinon.createSandbox();
    sqsSendStub = sandbox.stub().resolves();
    getS3PathStub = sandbox.stub().callsFake((url, jobId, fileName) => `prerender/scrapes/${jobId}/${url}/${fileName}`);

    mod = await esmock('../../../src/prerender/mystique-sender.js', {
      '@adobe/spacecat-shared-data-access': {
        Suggestion: {
          STATUSES: {
            FIXED: 'FIXED',
            OUTDATED: 'OUTDATED',
            SKIPPED: 'SKIPPED',
          },
        },
      },
      '../../../src/prerender/utils/utils.js': { getS3Path: getS3PathStub },
      '../../../src/prerender/utils/constants.js': { MYSTIQUE_BATCH_SIZE: 5 },
    });
  });

  beforeEach(() => {
    sqsSendStub.reset();
    getS3PathStub.reset();
    getS3PathStub.callsFake((url, jobId, fileName) => `prerender/scrapes/${jobId}/${url}/${fileName}`);
  });

  afterEach(() => {
    sandbox.restore();
    sandbox = sinon.createSandbox();
    sqsSendStub = sandbox.stub().resolves();
  });

  function buildContext(overrides = {}) {
    return {
      log: {
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      sqs: { sendMessage: sqsSendStub },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.us-east-1.amazonaws.com/test/mystique' },
      site: {
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'hlx',
      },
      ...overrides,
    };
  }

  function buildOpportunity(overrides = {}) {
    return {
      getId: sandbox.stub().returns('opp-123'),
      getSuggestions: sandbox.stub().resolves([]),
      ...overrides,
    };
  }

  function buildSuggestion(overrides = {}) {
    const defaults = {
      getId: sandbox.stub().returns('sugg-1'),
      getData: sandbox.stub().returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        scrapeJobId: 'job-abc',
      }),
      getStatus: sandbox.stub().returns('NEW'),
    };
    return { ...defaults, ...overrides };
  }

  describe('guard clauses', () => {
    it('returns 0 and logs warn when sqs is missing', async () => {
      const ctx = buildContext({ sqs: null });
      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        buildOpportunity(),
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured/),
      );
    });

    it('returns 0 and logs warn when QUEUE_SPACECAT_TO_MYSTIQUE is missing', async () => {
      const ctx = buildContext({ env: {} });
      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        buildOpportunity(),
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured/),
      );
    });

    it('returns 0 and logs warn when opportunity is null', async () => {
      const ctx = buildContext();
      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        null,
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available/),
      );
    });

    it('returns 0 and logs warn when opportunity lacks getId method', async () => {
      const ctx = buildContext();
      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        { someOtherProp: true },
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available/),
      );
    });
  });

  describe('preBuiltCandidates path', () => {
    it('uses preBuiltCandidates directly when provided and sends SQS message', async () => {
      const ctx = buildContext();
      const opp = buildOpportunity();
      const candidates = [
        {
          suggestionId: 'sugg-1',
          url: 'https://example.com/page1',
          originalHtmlMarkdownKey: 'prerender/scrapes/job-1/page1/server-side-html.md',
          markdownDiffKey: 'prerender/scrapes/job-1/page1/markdown-diff.md',
        },
      ];

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
        candidates,
      );

      expect(result).to.equal(1);
      expect(opp.getSuggestions).to.not.have.been.called;
      expect(sqsSendStub).to.have.been.calledOnce;
      const [queue, msg] = sqsSendStub.getCall(0).args;
      expect(queue).to.equal('https://sqs.us-east-1.amazonaws.com/test/mystique');
      expect(msg.type).to.equal('guidance:prerender');
      expect(msg.data.suggestions).to.deep.equal(candidates);
    });

    it('caps to MYSTIQUE_BATCH_SIZE (5) when preBuiltCandidates exceeds batch size', async () => {
      const ctx = buildContext();
      const opp = buildOpportunity();
      const candidates = Array.from({ length: 8 }, (_, i) => ({
        suggestionId: `sugg-${i}`,
        url: `https://example.com/page${i}`,
        originalHtmlMarkdownKey: `key-${i}`,
        markdownDiffKey: `diff-${i}`,
      }));

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
        candidates,
      );

      expect(result).to.equal(5);
      const msg = sqsSendStub.getCall(0).args[1];
      expect(msg.data.suggestions).to.have.lengthOf(5);
    });
  });

  describe('ai-only path (no preBuiltCandidates)', () => {
    it('returns 0 when getSuggestions returns empty array', async () => {
      const ctx = buildContext();
      const opp = buildOpportunity({ getSuggestions: sandbox.stub().resolves([]) });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.debug).to.have.been.calledWith(
        sinon.match(/No existing suggestions found/),
      );
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('returns 0 when getSuggestions returns null', async () => {
      const ctx = buildContext();
      const opp = buildOpportunity({ getSuggestions: sandbox.stub().resolves(null) });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('skips suggestions with isDomainWide=true', async () => {
      const ctx = buildContext();
      const domainWideSugg = buildSuggestion({
        getData: sandbox.stub().returns({
          url: 'https://example.com/*',
          isDomainWide: true,
          scrapeJobId: 'job-abc',
        }),
      });
      const validSugg = buildSuggestion({
        getId: sandbox.stub().returns('sugg-2'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page2',
          isDomainWide: false,
          scrapeJobId: 'job-abc',
        }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([domainWideSugg, validSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(1);
      const msg = sqsSendStub.getCall(0).args[1];
      expect(msg.data.suggestions[0].url).to.equal('https://example.com/page2');
    });

    it('skips suggestions without url', async () => {
      const ctx = buildContext();
      const noUrlSugg = buildSuggestion({
        getData: sandbox.stub().returns({ url: null, isDomainWide: false, scrapeJobId: 'job-abc' }),
      });
      const validSugg = buildSuggestion({
        getId: sandbox.stub().returns('sugg-2'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page2',
          isDomainWide: false,
          scrapeJobId: 'job-abc',
        }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([noUrlSugg, validSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(1);
    });

    it('skips suggestions with OUTDATED status', async () => {
      const ctx = buildContext();
      const outdatedSugg = buildSuggestion({
        getStatus: sandbox.stub().returns('OUTDATED'),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([outdatedSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('skips suggestions with SKIPPED status', async () => {
      const ctx = buildContext();
      const skippedSugg = buildSuggestion({
        getStatus: sandbox.stub().returns('SKIPPED'),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([skippedSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('skips suggestions with FIXED status (isDeployedOrFixed)', async () => {
      const ctx = buildContext();
      const fixedSugg = buildSuggestion({
        getStatus: sandbox.stub().returns('FIXED'),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([fixedSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('skips suggestions with edgeDeployed set (isDeployedOrFixed)', async () => {
      const ctx = buildContext();
      const deployedSugg = buildSuggestion({
        getData: sandbox.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
          scrapeJobId: 'job-abc',
          edgeDeployed: true,
        }),
        getStatus: sandbox.stub().returns('NEW'),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([deployedSugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('uses data.scrapeJobId to build S3 keys for a valid suggestion', async () => {
      const ctx = buildContext();
      const sugg = buildSuggestion();
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(1);
      expect(getS3PathStub).to.have.been.calledWith(
        'https://example.com/page1',
        'job-abc',
        'server-side-html.md',
      );
      expect(getS3PathStub).to.have.been.calledWith(
        'https://example.com/page1',
        'job-abc',
        'markdown-diff.md',
      );
    });

    it('derives scrapeJobId from originalHtmlKey when scrapeJobId is absent', async () => {
      const ctx = buildContext();
      const sugg = buildSuggestion({
        getData: sandbox.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
          originalHtmlKey: 'prerender/scrapes/derived-job/page1/server-side.html',
        }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(1);
      expect(ctx.log.debug).to.have.been.calledWith(
        sinon.match(/derived from originalHtmlKey: derived-job/),
      );
      expect(getS3PathStub).to.have.been.calledWith(
        'https://example.com/page1',
        'derived-job',
        'server-side-html.md',
      );
    });

    it('skips suggestion when originalHtmlKey has fewer than 3 segments', async () => {
      const ctx = buildContext();
      const sugg = buildSuggestion({
        getId: sandbox.stub().returns('sugg-short'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
          originalHtmlKey: 'prerender/scrapes',
        }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/skipped: no scrapeJobId and no originalHtmlKey to derive one from/),
      );
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('skips suggestion when both scrapeJobId and originalHtmlKey are absent', async () => {
      const ctx = buildContext();
      const sugg = buildSuggestion({
        getId: sandbox.stub().returns('sugg-no-job'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
        }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/skipped: no scrapeJobId and no originalHtmlKey to derive one from/),
      );
    });

    it('returns 0 and logs info when all suggestions are filtered out', async () => {
      const ctx = buildContext();
      const sugg1 = buildSuggestion({ getStatus: sandbox.stub().returns('OUTDATED') });
      const sugg2 = buildSuggestion({
        getData: sandbox.stub().returns({ url: null, isDomainWide: false }),
      });
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg1, sugg2]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(0);
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/No eligible suggestions to send to Mystique/),
      );
      expect(sqsSendStub).to.not.have.been.called;
    });

    it('sends correct SQS message shape in happy path', async () => {
      const ctx = buildContext();
      const sugg = buildSuggestion();
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(1);
      expect(sqsSendStub).to.have.been.calledOnce;
      const [queue, msg] = sqsSendStub.getCall(0).args;
      expect(queue).to.equal('https://sqs.us-east-1.amazonaws.com/test/mystique');
      expect(msg.type).to.equal('guidance:prerender');
      expect(msg.url).to.equal('https://example.com');
      expect(msg.siteId).to.equal('site-1');
      expect(msg.auditId).to.equal('audit-1');
      expect(msg.deliveryType).to.equal('hlx');
      expect(msg.data.opportunityId).to.equal('opp-123');
      expect(msg.data.batchIndex).to.equal(0);
      expect(msg.data.totalBatches).to.equal(1);
      expect(msg.data.suggestions).to.have.lengthOf(1);
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/Queued guidance:prerender message to Mystique/),
      );
    });

    it('uses unknown deliveryType when site.getDeliveryType is missing', async () => {
      const ctx = buildContext({
        site: { getBaseURL: () => 'https://example.com' },
      });
      const sugg = buildSuggestion();
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves([sugg]),
      });

      await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      const msg = sqsSendStub.getCall(0).args[1];
      expect(msg.deliveryType).to.equal('unknown');
    });

    it('caps to MYSTIQUE_BATCH_SIZE (5) in ai-only path', async () => {
      const ctx = buildContext();
      const suggestions = Array.from({ length: 7 }, (_, i) => buildSuggestion({
        getId: sandbox.stub().returns(`sugg-${i}`),
        getData: sandbox.stub().returns({
          url: `https://example.com/page${i}`,
          isDomainWide: false,
          scrapeJobId: 'job-abc',
        }),
      }));
      const opp = buildOpportunity({
        getSuggestions: sandbox.stub().resolves(suggestions),
      });

      const result = await mod.sendPrerenderGuidanceRequestToMystique(
        'https://example.com',
        { siteId: 'site-1', auditId: 'audit-1' },
        opp,
        ctx,
      );

      expect(result).to.equal(5);
      const msg = sqsSendStub.getCall(0).args[1];
      expect(msg.data.suggestions).to.have.lengthOf(5);
    });
  });
});
