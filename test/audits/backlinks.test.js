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
  const topPagesNoPrefix = [
    { getUrl: () => 'https://example.com/page1' },
    { getUrl: () => 'https://example.com/page2' },
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

    // filterByAuditScope returns all items when baseURL has no subpath
    expect(result).to.deep.equal({
      siteId: contextSite.getId(),
      type: 'broken-backlinks',
      urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    });
    expect(context.log.info).to.have.been.calledWith(sinon.match(/Found.*top pages.*within audit scope/));
  });

  it('should filter top pages by audit scope when baseURL has subpath', async () => {
    context.audit.getAuditResult.returns({ success: true });
    const siteWithSubpath = {
      ...contextSite,
      getBaseURL: () => 'https://example.com/uk',
    };
    context.site = siteWithSubpath;

    const topPagesWithSubpaths = [
      { getUrl: () => 'https://example.com/uk/page1' },
      { getUrl: () => 'https://example.com/uk/page2' },
      { getUrl: () => 'https://example.com/fr/page1' }, // Should be filtered out
    ];
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPagesWithSubpaths);

    const result = await submitForScraping(context);

    // Should only include URLs within /uk subpath
    expect(result.urls).to.have.length(2);
    expect(result.urls.map((u) => u.url)).to.include('https://example.com/uk/page1');
    expect(result.urls.map((u) => u.url)).to.include('https://example.com/uk/page2');
    expect(result.urls.map((u) => u.url)).to.not.include('https://example.com/fr/page1');
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

    it('returns { status: complete } if there are no broken backlinks in audit result', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: [],
      });

      const result = await generateSuggestionData(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.info).to.have.been.calledWith(sinon.match(/No broken backlinks found/));
    });

    it('returns { status: complete } if brokenBacklinks is null', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: null,
      });

      const result = await generateSuggestionData(context);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('returns { status: complete } if brokenBacklinks is undefined', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
      });

      const result = await generateSuggestionData(context);

      expect(result).to.deep.equal({ status: 'complete' });
    });

    it('processes suggestions for broken backlinks and send message to mystique', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      // Mock calculateKpiMetrics S3 calls (needed for the function to complete)
      context.s3Client.send.onCall(0).resolves(null); // No RUM traffic data
      context.s3Client.send.onCall(1).resolves(null); // No organic traffic data

      // Mock suggestions with broken link that has root-level URL (no path prefix)
      // This ensures alternatives with any prefix or no prefix will be included
      // IMPORTANT: Match the exact structure from the original test that works
      const suggestionsWithRootUrl = [
        {
          opportunityId: 'test-opportunity-id',
          getId: () => 'test-suggestion-1',
          type: 'REDIRECT_UPDATE',
          rank: 550000,
          getData: () => ({
            url_from: 'https://from.com/from-2',
            url_to: 'https://example.com', // Root-level URL - extractPathPrefix returns ''
          }),
        },
      ];
      // Create new stub like internal links test does - MUST be set before generateSuggestionData is called
      // The stub needs to accept opportunityId and status as parameters
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
        .withArgs('opportunity-id', sinon.match.any)
        .resolves(suggestionsWithRootUrl);

      // Use top pages with any prefix - since broken link has no prefix, all will be included
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sandbox.stub()
        .resolves(topPages);

      const result = await generateSuggestionData(context);

      expect(result.status).to.deep.equal('complete');
      
      // Verify no warnings were called (meaning both brokenLinks and alternativeUrls have items)
      expect(context.log.warn).to.not.have.been.calledWith('No valid broken links to send to Mystique. Skipping message.');
      expect(context.log.warn).to.not.have.been.calledWith('No alternative URLs available. Cannot generate suggestions. Skipping message to Mystique.');
      
      // Verify message was sent with correct structure
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.type).to.equal('guidance:broken-links');
      expect(sentMessage.siteId).to.equal('site-id');
      expect(sentMessage.auditId).to.equal('audit-id');
      expect(sentMessage.deliveryType).to.equal('aem_cs');
      expect(sentMessage.data.opportunityId).to.equal('opportunity-id');
      expect(sentMessage.data.alternativeUrls).to.deep.equal(topPages.map((page) => page.getUrl()));
      expect(sentMessage.data.brokenLinks).to.be.an('array');
      expect(sentMessage.data.brokenLinks.length).to.equal(1);
      expect(sentMessage.data.brokenLinks[0]).to.deep.include({
        urlFrom: 'https://from.com/from-2',
        urlTo: 'https://example.com',
        suggestionId: 'test-suggestion-1',
      });
      
      expect(context.log.debug).to.have.been.calledWith(sinon.match(/Message sent to Mystique/));
    });

    it('should filter alternative URLs by locale when broken links have locales', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      // Mock suggestions with locale-specific broken links
      const suggestionsWithLocale = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/from-1',
            url_to: 'https://example.com/uk/en/old-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(suggestionsWithLocale);

      // Mock top pages with different locales
      const topPagesWithLocales = [
        { getUrl: () => 'https://example.com/uk/en/page1' },
        { getUrl: () => 'https://example.com/uk/en/page2' },
        { getUrl: () => 'https://example.com/fr/page1' }, // Should be filtered out
        { getUrl: () => 'https://example.com/de/page1' }, // Should be filtered out
      ];
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPagesWithLocales);

      const result = await generateSuggestionData(context);

      expect(result.status).to.deep.equal('complete');
      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.alternativeUrls).to.have.length(2);
      expect(sentMessage.data.alternativeUrls).to.include('https://example.com/uk/en/page1');
      expect(sentMessage.data.alternativeUrls).to.include('https://example.com/uk/en/page2');
      expect(sentMessage.data.alternativeUrls).to.not.include('https://example.com/fr/page1');
      expect(sentMessage.data.alternativeUrls).to.not.include('https://example.com/de/page1');
    });

    it('should skip sending message when no valid broken links', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      // Mock suggestions with invalid data (missing fields)
      const invalidSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: '', // Invalid - empty
            url_to: 'https://example.com/page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(invalidSuggestions);

      const result = await generateSuggestionData(context);

      expect(result.status).to.deep.equal('complete');
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith('No valid broken links to send to Mystique. Skipping message.');
    });

    it('should skip sending message when no alternative URLs available', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      // Mock suggestions
      const validSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/from-1',
            url_to: 'https://example.com/uk/en/old-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(validSuggestions);

      // Mock empty top pages (after filtering)
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await generateSuggestionData(context);

      expect(result.status).to.deep.equal('complete');
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith('No alternative URLs available. Cannot generate suggestions. Skipping message to Mystique.');
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

    it('does nothing when fixed suggestion has no url_to', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionNoUrl = {
        getId: () => 'fixed-no-url',
        getData: () => ({}),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionNoUrl,
      ]);

      // Provide full FixEntity but it should not be invoked
      const getFixEntitiesBySuggestionId = sandbox.stub();
      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
        getFixEntitiesBySuggestionId,
      };

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);
      expect(result.status).to.equal('complete');
      expect(getFixEntitiesBySuggestionId).to.not.have.been.called;
    });

    it('skips publishing when fix entity has no getStatus function', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-no-getstatus',
        getData: () => ({ url_to: 'https://foo.com/ok-200-5' }),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
      ]);

      const setStatusStub = sandbox.stub();
      const saveStub = sandbox.stub();
      // No getStatus function provided
      const fixEntity = {
        getId: () => 'fe-no-getstatus',
        setStatus: setStatusStub,
        setUpdatedBy: sandbox.stub(),
        save: saveStub,
      };

      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
        getFixEntitiesBySuggestionId: sandbox.stub().resolves([fixEntity]),
      };

      nock('https://foo.com')
        .get('/ok-200-5')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);
      expect(result.status).to.equal('complete');
      expect(setStatusStub).to.not.have.been.called;
      expect(saveStub).to.not.have.been.called;
    });

    it('skips publishing when PUBLISHED status is missing', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // NEW suggestions for message
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(0).resolves(suggestions);

      const fixedSuggestionOk = {
        getId: () => 'fixed-missing-published',
        getData: () => ({ url_to: 'https://foo.com/ok-200-6' }),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.onCall(1).resolves([
        fixedSuggestionOk,
      ]);

      const setStatusStub = sandbox.stub();
      const saveStub = sandbox.stub();
      const fixEntity = {
        getId: () => 'fe-missing-published',
        getStatus: sandbox.stub().returns('DEPLOYED'),
        setStatus: setStatusStub,
        setUpdatedBy: sandbox.stub(),
        save: saveStub,
      };

      // Missing PUBLISHED in STATUSES
      context.dataAccess.FixEntity = {
        STATUSES: { DEPLOYED: 'DEPLOYED' },
        getFixEntitiesBySuggestionId: sandbox.stub().resolves([fixEntity]),
      };

      nock('https://foo.com')
        .get('/ok-200-6')
        .reply(200);

      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const result = await generateSuggestionData(context);
      expect(result.status).to.equal('complete');
      expect(setStatusStub).to.not.have.been.called;
      expect(saveStub).to.not.have.been.called;
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
