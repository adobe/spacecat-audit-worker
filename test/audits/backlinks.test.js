/*
 * Copyright 2024 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };
import rumTraffic from '../fixtures/broken-backlinks/all-traffic.json' with { type: 'json' };
import {
  brokenBacklinksAuditRunner, generateSuggestionData,
  runAuditAndImportTopPages,
  submitForScraping,
} from '../../src/backlinks/handler.js';
import { MockContextBuilder } from '../shared.js';
import {
  brokenBacklinkWithTimeout,
  excludedUrl,
  fixedBacklinks,
  site,
  site2,
  siteWithExcludedUrls,
} from '../fixtures/broken-backlinks/sites.js';
import { ahrefsMock, mockFixedBacklinks } from '../fixtures/broken-backlinks/ahrefs.js';
import {
  brokenBacklinksSuggestions,
  suggestions,
} from '../fixtures/broken-backlinks/suggestion.js';
import { organicTraffic } from '../fixtures/broken-backlinks/organic-traffic.js';
import calculateKpiMetrics from '../../src/backlinks/kpi-metrics.js';

use(sinonChai);
use(chaiAsPromised);

// eslint-disable-next-line func-names
describe('Backlinks Tests', function () {
  this.timeout(10000);
  let message;
  let context;
  const topPages = [
    { getUrl: () => 'https://example.com/blog/page1' },
    { getUrl: () => 'https://example.com/blog/page2' },
  ];
  const auditUrl = 'https://audit.url';
  const audit = {
    getId: () => auditDataMock.id,
    getAuditType: () => 'broken-backlinks',
    getFullAuditRef: () => auditUrl,
    getAuditResult: sinon.stub(),
  };
  const contextSite = {
    getId: () => 'site-id',
    getDeliveryType: () => 'aem_cs',
    getBaseURL: () => 'https://example.com',
  };
  let brokenBacklinksOpportunity;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    message = {
      type: 'broken-backlinks',
      siteId: 'site1',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AHREFS_API_BASE_URL: 'https://ahrefs.com',
          AHREFS_API_KEY: 'ahrefs-api',
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          S3_IMPORTER_BUCKET_NAME: 'test-import-bucket',
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        },
        s3Client: {
          send: sandbox.stub(),
        },
        audit,
        site: contextSite,
        finalUrl: auditUrl,
      })
      .build(message);
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
    };
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([brokenBacklinksOpportunity]);
    context.dataAccess.Suggestion = {
      allByOpportunityIdAndStatus: sandbox.stub().resolves(suggestions),
    };

    brokenBacklinksOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sinon.stub(),
      save: sinon.stub(),
      getSuggestions: sinon.stub().returns([]),
      addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
      getType: () => 'broken-backlinks',
      setData: () => {},
      getData: () => {},
      setUpdatedBy: sinon.stub().returnsThis(),
    };

    nock('https://foo.com')
      .get('/returns-404')
      .reply(404);

    nock('https://foo.com')
      .get('/redirects-throws-error')
      .reply(301, undefined, { location: 'https://www.foo.com/redirects-throws-error' });

    nock('https://www.foo.com')
      .get('/redirects-throws-error')
      .replyWithError('connection refused');

    nock('https://foo.com')
      .get('/returns-429')
      .reply(429);

    nock('https://foo.com')
      .get('/times-out')
      .delay(3010)
      .reply(200);
  });
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should run broken backlinks audit and filter out excluded URLs and include valid backlinks', async () => {
    const { brokenBacklinks } = auditDataMock.auditResult;
    const withoutExcluded = brokenBacklinks.filter((backlink) => backlink.url_to !== excludedUrl);

    ahrefsMock(siteWithExcludedUrls.getBaseURL(), { backlinks: brokenBacklinks });

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, siteWithExcludedUrls);

    expect(auditData.auditResult.brokenBacklinks).to.deep.equal(withoutExcluded);
  });

  it('should run audit and send urls for scraping step', async () => {
    const { brokenBacklinks } = auditDataMock.auditResult;
    const expectedBrokenBacklinks = auditDataMock.auditResult.brokenBacklinks.filter(
      (a) => a.url_to !== excludedUrl,
    );
    context.site = siteWithExcludedUrls;
    ahrefsMock(siteWithExcludedUrls.getBaseURL(), { backlinks: brokenBacklinks });

    const result = await runAuditAndImportTopPages(context);
    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: siteWithExcludedUrls.getId(),
      auditResult: {
        brokenBacklinks: expectedBrokenBacklinks,
        finalUrl: auditUrl,
      },
      fullAuditRef: auditDataMock.fullAuditRef,
    });
  });

  it('should submit urls for scraping step', async () => {
    context.audit.getAuditResult.returns({ success: true });

    const result = await submitForScraping(context);

    expect(result).to.deep.equal({
      siteId: contextSite.getId(),
      type: 'broken-backlinks',
      urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    });
  });

  it('should not submit urls for scraping step when audit was not successful', async () => {
    context.audit.getAuditResult.returns({ success: false });

    try {
      await submitForScraping(context);
    } catch (error) {
      expect(error.message).to.equal('Audit failed, skipping scraping and suggestions generation');
    }
  });

  it('should filter out broken backlinks that return ok (even with redirection)', async () => {
    const allBacklinks = auditDataMock.auditResult.brokenBacklinks
      .concat(fixedBacklinks)
      .concat(brokenBacklinkWithTimeout);

    mockFixedBacklinks(allBacklinks);

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, site2);
    expect(auditData.auditResult.brokenBacklinks)
      .to
      .deep
      .equal(auditDataMock.auditResult.brokenBacklinks.concat(brokenBacklinkWithTimeout));
  });

  it('should handle audit api errors gracefully', async () => {
    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, site);

    expect(auditData).to.deep.equal({
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: 'Broken Backlinks audit for site1 with url https://audit.url failed with error: Ahrefs API request failed with status: 500',
        success: false,
      },
    });
  });

  it('should handle fetch errors gracefully', async () => {
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    const errorMessage = 'Broken Backlinks audit for site1 with url https://audit.url failed with error: Ahrefs API request failed with status: 404';
    nock(site.getBaseURL())
      .get(/.*/)
      .replyWithError('connection refused');
    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(404);

    const auditResult = await brokenBacklinksAuditRunner(auditUrl, context, site);

    expect(context.log.error).to.have.been.calledWith(errorMessage);
    expect(auditResult).to.deep.equal({
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: errorMessage,
        success: false,
      },
    });
  });

  describe('generateSuggestionData', async () => {
    let configuration;

    beforeEach(() => {
      configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
        getHandlers: sandbox.stub().returns({}),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([brokenBacklinksOpportunity]);
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('throws error if audit result is unsuccessful', async () => {
      context.audit.getAuditResult.returns({ success: false });

      try {
        await generateSuggestionData(context);
      } catch (error) {
        expect(error.message).to.equal('Audit failed, skipping suggestions generation');
      }
    });

    it('throws error if auto-suggest is disabled for the site', async () => {
      context.audit.getAuditResult.returns({ success: true });
      configuration.isHandlerEnabledForSite.returns(false);

      try {
        await generateSuggestionData(context);
      } catch (error) {
        expect(error.message).to.equal('Auto-suggest is disabled for site');
      }
    });

    it('processes suggestions for broken backlinks and send message to mystique', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);

      // 4x for headers + 4x for each page
      expect(result.status).to.deep.equal('complete');
      expect(context.sqs.sendMessage).to.have.been.calledWithMatch('test-queue', {
        type: 'guidance:broken-links',
        siteId: 'site-id',
        auditId: 'audit-id',
        deliveryType: 'aem_cs',
        time: sinon.match.any,
        data: {
          opportunityId: 'opportunity-id',
          alternativeUrls: topPages.map((page) => page.getUrl()),
          brokenLinks: [{
            urlFrom: 'https://from.com/from-2',
            urlTo: 'https://foo.com/redirects-throws-error',
            suggestionId: 'test-suggestion-1',
          }],
        },
      });
    });

    it('publishes deployed fix entities for FIXED suggestions whose url_to is no longer broken', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // First call (NEW) used to build mystique message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-1',
        getData: () => ({ url_to: 'https://foo.com/ok-200' }),
      };
      const fixedSuggestionStillBroken = {
        getId: () => 'fixed-2',
        getData: () => ({ url_to: 'https://foo.com/returns-404' }),
      };
      // Second call (FIXED) returns our fixed suggestions
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
        fixedSuggestionStillBroken,
      ]);

      // Mock FixEntity manager and entities
      const saveStub = sandbox.stub().resolves();
      const setStatusStub = sandbox.stub();
      const getStatusDeployed = sandbox.stub().returns('DEPLOYED');
      const fixEntity = {
        getId: () => 'fe-1',
        getStatus: getStatusDeployed,
        setStatus: setStatusStub,
        setUpdatedBy: sandbox.stub(),
        save: saveStub,
      };
      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
        getFixEntitiesBySuggestionId: sandbox.stub().resolves([fixEntity]),
      };

      // nock for OK url and 404 already exists above
      nock('https://foo.com')
        .get('/ok-200')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      await generateSuggestionData(context);

      // Should promote DEPLOYED -> PUBLISHED and save once for the ok URL
      expect(setStatusStub).to.have.been.calledWith('PUBLISHED');
      expect(saveStub).to.have.been.calledOnce;
      // Should have been asked once for fix entities for the OK suggestion
      expect(context.dataAccess.FixEntity.getFixEntitiesBySuggestionId)
        .to.have.been.calledWith('fixed-1');
    });

    it('returns complete even when FixEntity publishing throws', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-err',
        getData: () => ({ url_to: 'https://foo.com/ok-200-2' }),
      };
      // FIXED suggestions
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
      ]);

      // Cause FixEntity retrieval to throw
      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
        getFixEntitiesBySuggestionId: sandbox.stub().rejects(new Error('boom')),
      };

      nock('https://foo.com')
        .get('/ok-200-2')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);
      expect(result.status).to.equal('complete');
    });

    it('does not update fix entity when status is not DEPLOYED', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-already-published',
        getData: () => ({ url_to: 'https://foo.com/ok-200-3' }),
      };
      // FIXED suggestions
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
      ]);

      // Fix entity already published -> should not update
      const setStatusStub = sandbox.stub();
      const saveStub = sandbox.stub();
      const fixEntity = {
        getId: () => 'fe-2',
        getStatus: sandbox.stub().returns('PUBLISHED'),
        setStatus: setStatusStub,
        setUpdatedBy: sandbox.stub(),
        save: saveStub,
      };

      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
        getFixEntitiesBySuggestionId: sandbox.stub().resolves([fixEntity]),
      };

      nock('https://foo.com')
        .get('/ok-200-3')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      await generateSuggestionData(context);

      expect(setStatusStub).to.not.have.been.called;
      expect(saveStub).to.not.have.been.called;
    });

    it('skips publishing if FixEntity.getFixEntitiesBySuggestionId is not a function', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-no-fn',
        getData: () => ({ url_to: 'https://foo.com/ok-200-4' }),
      };
      // FIXED suggestions
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
      ]);

      // Provide FixEntity object without the function
      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      };

      nock('https://foo.com')
        .get('/ok-200-4')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);
      expect(result.status).to.equal('complete');
    });
  });

  describe('calculateKpiMetrics', () => {
    const auditData = {
      auditResult: {
        brokenBacklinks: [
          { traffic_domain: 25000001, urlsSuggested: ['https://foo.com/bar/redirect'] },
          { traffic_domain: 10000001, urlsSuggested: ['https://foo.com/bar/baz/redirect'] },
          { traffic_domain: 10001, urlsSuggested: ['https://foo.com/qux/redirect'] },
          { traffic_domain: 100, urlsSuggested: ['https://foo.com/bar/baz/qux/redirect'] },
        ],
      },
    };

    it('should calculate metrics correctly for a single broken backlink', async () => {
      context.s3Client.send.onCall(0).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(rumTraffic)),
        },
      });

      context.s3Client.send.onCall(1).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(organicTraffic(site))),
        },
      });

      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result.projectedTrafficLost).to.equal(26788.645);
      expect(result.projectedTrafficValue).to.equal(5342.87974025892);
    });

    it('skips URL if no RUM data is available for just individual URLs', async () => {
      delete rumTraffic[0].earned;
      context.s3Client.send.onCall(0).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(rumTraffic)),
        },
      });

      context.s3Client.send.onCall(1).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(organicTraffic(site))),
        },
      });

      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result.projectedTrafficLost).to.equal(14545.045000000002);
    });

    it('should cuse default CPC value if there is wrong organic traffic data', async () => {
      const traffic = organicTraffic(site);
      delete traffic[0].value;
      delete traffic[1].value;

      context.s3Client.send.onCall(0).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(rumTraffic)),
        },
      });

      context.s3Client.send.onCall(1).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(traffic)),
        },
      });
      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result.projectedTrafficLost).to.equal(14545.045000000002);
      expect(result.projectedTrafficValue).to.equal(39126.171050000004);
    });

    it('should return 0 if projectedTrafficValue is NaN', async () => {
      const traffic = organicTraffic(site);
      traffic[0].value = Number.MIN_VALUE;
      traffic[0].cost = Number.MAX_VALUE;

      context.s3Client.send.onCall(0).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(rumTraffic)),
        },
      });
      context.s3Client.send.onCall(1).resolves({
        Body: {
          transformToString: sinon.stub().resolves(JSON.stringify(traffic)),
        },
      });
      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result.projectedTrafficLost).to.equal(14545.045000000002);
      expect(result.projectedTrafficValue).to.equal(0);
    });

    it('returns early if there is no RUM traffic data', async () => {
      context.s3Client.send.onCall(0).resolves(null);

      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result).to.deep.equal({
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
      });
    });
  });
});
