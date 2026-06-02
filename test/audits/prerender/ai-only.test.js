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

const SITE_ID = 'site-abc';
const BASE_URL = 'https://example.com';
const OPPORTUNITY_ID = 'opp-xyz';
const SCRAPE_JOB_ID = 'job-123';

/**
 * Build a minimal context for ai-only.js tests.
 * Overrides are shallow-merged into the default context.
 */
function buildContext(sandbox, overrides = {}) {
  const log = {
    debug: sandbox.stub(),
    info: sandbox.stub(),
    warn: sandbox.stub(),
    error: sandbox.stub(),
  };
  const site = {
    getId: sandbox.stub().returns(SITE_ID),
    getBaseURL: sandbox.stub().returns(BASE_URL),
  };
  const opportunity = {
    getId: sandbox.stub().returns(OPPORTUNITY_ID),
    getAuditId: sandbox.stub().returns('audit-111'),
    getSiteId: sandbox.stub().returns(SITE_ID),
    getType: sandbox.stub().returns('prerender'),
    getSuggestions: sandbox.stub().resolves([]),
  };
  const Opportunity = {
    findById: sandbox.stub().resolves(opportunity),
    allBySiteIdAndStatus: sandbox.stub().resolves([opportunity]),
  };
  const dataAccess = { Opportunity };

  return {
    log,
    site,
    dataAccess,
    data: JSON.stringify({ opportunityId: OPPORTUNITY_ID, scrapeJobId: SCRAPE_JOB_ID }),
    ...overrides,
    // Allow overriding nested objects by spreading; callers replace whole sub-objects
  };
}

describe('Prerender ai-only.js', () => {
  const sandbox = sinon.createSandbox();

  let readSiteStatusJsonStub;
  let mystiqueStub;
  let mod;

  before(async () => {
    readSiteStatusJsonStub = sandbox.stub();
    mystiqueStub = sandbox.stub();

    mod = await esmock('../../../src/prerender/ai-only.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_TYPES: { PRERENDER: 'prerender' } },
      },
      '../../../src/prerender/status-writer.js': {
        readSiteStatusJson: readSiteStatusJsonStub,
      },
      '../../../src/prerender/mystique-sender.js': {
        sendPrerenderGuidanceRequestToMystique: mystiqueStub,
      },
      '../../../src/prerender/utils/constants.js': {
        MODE_AI_ONLY: 'ai-only',
      },
    });
  });

  beforeEach(() => {
    sandbox.resetBehavior();
    sandbox.resetHistory();
    // Default: readSiteStatusJson returns an empty object (no scrapeJobId)
    readSiteStatusJsonStub.resolves({});
    // Default: mystique returns 2 suggestions sent
    mystiqueStub.resolves(2);
  });

  afterEach(() => {
    // History is reset in beforeEach; no restore needed between tests
  });

  // ───────────────────────────────────────────────
  // fetchLatestScrapeJobId
  // ───────────────────────────────────────────────
  describe('fetchLatestScrapeJobId', () => {
    it('returns scrapeJobId when present in statusData and logs info', async () => {
      readSiteStatusJsonStub.resolves({ scrapeJobId: SCRAPE_JOB_ID });
      const ctx = buildContext(sandbox);

      const result = await mod.fetchLatestScrapeJobId(SITE_ID, ctx);

      expect(result).to.equal(SCRAPE_JOB_ID);
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/Fetching status\.json for siteId=site-abc/),
      );
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(`Found scrapeJobId: ${SCRAPE_JOB_ID}`),
      );
    });

    it('returns null and logs warn when scrapeJobId absent from statusData', async () => {
      readSiteStatusJsonStub.resolves({ lastUpdated: '2025-01-01' });
      const ctx = buildContext(sandbox);

      const result = await mod.fetchLatestScrapeJobId(SITE_ID, ctx);

      expect(result).to.be.null;
      expect(ctx.log.warn).to.have.been.calledWith(
        sinon.match(/No scrapeJobId found in status\.json/),
      );
    });
  });

  // ───────────────────────────────────────────────
  // handleAiOnlyMode
  // ───────────────────────────────────────────────
  describe('handleAiOnlyMode', () => {
    it('parses data as JSON string and sends to Mystique on happy path', async () => {
      mystiqueStub.resolves(3);
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ opportunityId: OPPORTUNITY_ID, scrapeJobId: SCRAPE_JOB_ID }),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(result.opportunityId).to.equal(OPPORTUNITY_ID);
      expect(result.fullAuditRef).to.equal(`ai-only/${OPPORTUNITY_ID}`);
      expect(result.auditResult.suggestionCount).to.equal(3);
      expect(mystiqueStub).to.have.been.calledOnce;
      // Should NOT have called readSiteStatusJson because scrapeJobId was provided
      expect(readSiteStatusJsonStub).not.to.have.been.called;
    });

    it('accepts data as a plain object (not a string)', async () => {
      const ctx = buildContext(sandbox, {
        data: { opportunityId: OPPORTUNITY_ID, scrapeJobId: SCRAPE_JOB_ID },
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
    });

    it('handles malformed JSON in data gracefully — opportunityId and scrapeJobId stay null', async () => {
      // After parse failure: opportunityId=null => allBySiteIdAndStatus path
      //                       scrapeJobId=null  => fetchLatestScrapeJobId path
      readSiteStatusJsonStub.resolves({ scrapeJobId: SCRAPE_JOB_ID });

      const ctx = buildContext(sandbox, { data: '{bad json' });

      const result = await mod.handleAiOnlyMode(ctx);

      // scrapeJobId fetched from status.json, opportunity found via allBySiteIdAndStatus
      expect(result.status).to.equal('complete');
      expect(readSiteStatusJsonStub).to.have.been.calledOnce;
      expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.called;
    });

    it('fetches scrapeJobId from status.json when not provided in data', async () => {
      readSiteStatusJsonStub.resolves({ scrapeJobId: 'fetched-job' });
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ opportunityId: OPPORTUNITY_ID }),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('complete');
      expect(readSiteStatusJsonStub).to.have.been.calledOnce;
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/scrapeJobId not provided, fetching from status\.json/),
      );
    });

    it('returns failed result when scrapeJobId not in data and not in status.json', async () => {
      readSiteStatusJsonStub.resolves({});
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ opportunityId: OPPORTUNITY_ID }),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/scrapeJobId not found/);
      expect(result.fullAuditRef).to.equal(`ai-only/failed-${SITE_ID}`);
      expect(result.auditResult.error).to.match(/scrapeJobId not found/);
      expect(ctx.log.error).to.have.been.calledWith(sinon.match(/scrapeJobId not found/));
    });

    it('returns failed result when opportunityId provided but Opportunity.findById returns null', async () => {
      const ctx = buildContext(sandbox);
      ctx.dataAccess.Opportunity.findById.resolves(null);

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/Opportunity not found/);
      expect(result.fullAuditRef).to.equal(`ai-only/failed-${SITE_ID}`);
    });

    it('returns failed result when opportunity siteId does not match', async () => {
      const ctx = buildContext(sandbox);
      ctx.dataAccess.Opportunity.findById.resolves({
        getId: sandbox.stub().returns(OPPORTUNITY_ID),
        getAuditId: sandbox.stub().returns('audit-111'),
        getSiteId: sandbox.stub().returns('different-site'),
        getType: sandbox.stub().returns('prerender'),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/does not belong to site/);
      expect(result.fullAuditRef).to.equal(`ai-only/failed-${SITE_ID}`);
    });

    it('calls Opportunity.findById when opportunityId is provided and sends to Mystique', async () => {
      const ctx = buildContext(sandbox);

      await mod.handleAiOnlyMode(ctx);

      expect(ctx.dataAccess.Opportunity.findById).to.have.been.calledWith(OPPORTUNITY_ID);
      expect(mystiqueStub).to.have.been.calledOnce;
    });

    it('uses allBySiteIdAndStatus when opportunityId not provided — finds NEW prerender opportunity', async () => {
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ scrapeJobId: SCRAPE_JOB_ID }),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('complete');
      expect(ctx.dataAccess.Opportunity.allBySiteIdAndStatus)
        .to.have.been.calledWith(SITE_ID, 'NEW');
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/Found latest NEW opportunity/),
      );
      expect(result.auditResult.suggestionCount).to.equal(2);
    });

    it('returns failed result when no NEW prerender opportunity found', async () => {
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ scrapeJobId: SCRAPE_JOB_ID }),
      });
      ctx.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/No NEW prerender opportunity found/);
      expect(result.fullAuditRef).to.equal(`ai-only/failed-${SITE_ID}`);
    });

    it('returns failed result when only non-prerender NEW opportunities exist', async () => {
      const wrongTypeOpportunity = {
        getId: sandbox.stub().returns('opp-other'),
        getAuditId: sandbox.stub().returns('audit-222'),
        getSiteId: sandbox.stub().returns(SITE_ID),
        getType: sandbox.stub().returns('broken-backlinks'),
      };
      const ctx = buildContext(sandbox, {
        data: JSON.stringify({ scrapeJobId: SCRAPE_JOB_ID }),
      });
      ctx.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([wrongTypeOpportunity]);

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/No NEW prerender opportunity found/);
    });

    it('uses fallback auditId when opportunity.getAuditId() returns null', async () => {
      const ctx = buildContext(sandbox);
      ctx.dataAccess.Opportunity.findById.resolves({
        getId: sandbox.stub().returns(OPPORTUNITY_ID),
        getAuditId: sandbox.stub().returns(null),
        getSiteId: sandbox.stub().returns(SITE_ID),
        getType: sandbox.stub().returns('prerender'),
        getSuggestions: sandbox.stub().resolves([]),
      });

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.status).to.equal('complete');
      // Verify the auditId fallback was used in the call to mystique
      const [, auditDataArg] = mystiqueStub.getCall(0).args;
      expect(auditDataArg.auditId).to.equal(`prerender-ai-only-${SITE_ID}`);
    });

    it('logs success and includes suggestionCount in returned auditResult', async () => {
      mystiqueStub.resolves(5);
      const ctx = buildContext(sandbox);

      const result = await mod.handleAiOnlyMode(ctx);

      expect(result.auditResult.message).to.match(/queued successfully for 5 suggestion/);
      expect(result.auditResult.suggestionCount).to.equal(5);
      expect(ctx.log.info).to.have.been.calledWith(
        sinon.match(/Successfully queued AI summary request for 5 suggestion/),
      );
    });
  });
});
