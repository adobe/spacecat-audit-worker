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
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };
import rumTraffic from '../fixtures/broken-backlinks/all-traffic.json' with { type: 'json' };
import {
  brokenBacklinksAuditRunner, generateSuggestionData,
  runAuditAndImportTopPages,
  submitForScraping,
  checkIfBacklinkFixedWithSuggestion,
  buildBacklinkFixEntityPayload,
  checkIfBacklinkResolvedOnProduction,
} from '../../src/backlinks/handler.js';
import { FixEntity as FixEntityModel } from '@adobe/spacecat-shared-data-access';
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
      setData: () => { },
      getData: () => { },
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

  it('should handle malformed URL in excludedURLs gracefully', async () => {
    const { brokenBacklinks } = auditDataMock.auditResult;
    // Create site with invalid URL in excludedURLs (http://% will throw in URL constructor)
    const siteWithInvalidExcludedUrl = {
      ...siteWithExcludedUrls,
      getConfig: () => Config({
        handlers: {
          'broken-backlinks': {
            excludedURLs: ['http://%', excludedUrl], // Malformed URL + valid URL
          },
        },
      }),
    };
    const expectedBrokenBacklinks = auditDataMock.auditResult.brokenBacklinks.filter(
      (a) => a.url_to !== excludedUrl,
    );
    context.site = siteWithInvalidExcludedUrl;
    ahrefsMock(siteWithInvalidExcludedUrl.getBaseURL(), { backlinks: brokenBacklinks });

    const result = await runAuditAndImportTopPages(context);
    // Should still filter valid excludedURL even with malformed URL present
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

  it('should throw error when no top pages found in database', async () => {
    context.audit.getAuditResult.returns({ success: true });
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]); // Empty array

    await expect(submitForScraping(context))
      .to.be.rejectedWith(`No top pages found in database for site ${contextSite.getId()}. Ahrefs import required.`);
  });

  it('should throw error when all top pages filtered out by audit scope', async () => {
    context.audit.getAuditResult.returns({ success: true });

    // Mock site with subpath
    const siteWithSubpath = {
      ...contextSite,
      getBaseURL: () => 'https://example.com/blog',
    };
    context.site = siteWithSubpath;

    // Mock top pages that don't match the subpath
    const topPagesOutsideScope = [
      { getUrl: () => 'https://example.com/products' },
      { getUrl: () => 'https://example.com/about' },
    ];
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPagesOutsideScope);

    await expect(submitForScraping(context))
      .to.be.rejectedWith('All 2 top pages filtered out by audit scope. BaseURL: https://example.com/blog requires subpath match but no pages match scope.');
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
      // Create new stub like internal links test does
      // MUST be set before generateSuggestionData is called
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

    it('should filter out unscrape-able file types from alternative URLs', async () => {
      configuration.isHandlerEnabledForSite.returns(true);
      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const suggestionsWithRootUrl = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/from-1',
            url_to: 'https://example.com', // Root-level URL to include all alternatives
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus = sandbox.stub()
        .withArgs('opportunity-id', sinon.match.any)
        .resolves(suggestionsWithRootUrl);

      // Mock top pages including various unscrape-able file types
      const topPagesWithFiles = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/doc.pdf' },
        { getUrl: () => 'https://example.com/data.xlsx' },
        { getUrl: () => 'https://example.com/slides.pptx' },
      ];
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPagesWithFiles);

      const result = await generateSuggestionData(context);

      expect(result.status).to.deep.equal('complete');

      // Verify the filtering log was called
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Filtered out 3 unscrape-able file URLs \(PDFs, Office docs, etc\.\) from alternative URLs before sending to Mystique/),
      );

      // Verify message was sent with only the valid page
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.alternativeUrls).to.deep.equal(['https://example.com/page1']);
      expect(sentMessage.data.alternativeUrls).to.have.lengthOf(1);
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
  });

  describe('generateSuggestionData - Bright Data integration', () => {
    let configuration;
    let mockBrightDataClient;
    let mockedGenerateSuggestionData;
    let savedConfiguration;

    beforeEach(async () => {
      // Save original configuration
      savedConfiguration = context.dataAccess.Configuration;

      configuration = {
        isHandlerEnabledForSite: sinon.stub().returns(true),
      };
      context.dataAccess.Configuration = {
        findLatest: sinon.stub().resolves(configuration),
      };

      // Create mock BrightDataClient instance
      mockBrightDataClient = {
        googleSearchWithFallback: sinon.stub().resolves({
          results: [],
          query: 'site:example.com keywords',
          keywords: 'test keywords',
        }),
      };

      // Use esmock to mock BrightDataClient
      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/support/bright-data-client.js': {
          default: {
            createFrom: sinon.stub().returns(mockBrightDataClient),
          },
        },
      });
      mockedGenerateSuggestionData = mockedHandler.generateSuggestionData;
    });

    afterEach(() => {
      // Restore original configuration
      context.dataAccess.Configuration = savedConfiguration;
      // Clean up env vars
      delete context.env.BRIGHT_DATA_API_KEY;
      delete context.env.BRIGHT_DATA_ZONE;
      delete context.env.BRIGHT_DATA_VALIDATE_URLS;
      delete context.env.BRIGHT_DATA_MAX_RESULTS;
      delete context.env.BRIGHT_DATA_REQUEST_DELAY_MS;
    });

    it('should use Bright Data when API key and zone are configured', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);

      await mockedGenerateSuggestionData(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/Bright Data enabled/));
    });

    it('should update suggestion when Bright Data returns results', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested-page', title: 'Suggested Page' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          url_from: 'https://from.com/page',
          url_to: 'https://example.com/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);

      await mockedGenerateSuggestionData(context);

      expect(mockSuggestion.setData).to.have.been.calledOnce;
      expect(mockSuggestion.save).to.have.been.calledOnce;

      const setDataCall = mockSuggestion.setData.getCall(0).args[0];
      expect(setDataCall.urlsSuggested).to.deep.equal(['https://example.com/suggested-page']);
      expect(setDataCall.aiRationale).to.include('broken page');
    });

    it('should use site base URL when finalUrl is not set', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      // Set finalUrl to null to test the fallback
      context.finalUrl = null;

      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/result', title: 'Result' }],
        query: 'site:example.com keywords',
        keywords: 'keywords',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      const mockOpportunity = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns(brokenBacklinksSuggestions),
        getType: () => 'broken-backlinks',
        setData: () => {},
        getData: () => {},
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          url_from: 'https://from.com/page',
          url_to: 'https://example.com/blog/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves([mockSuggestion]);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);

      await mockedGenerateSuggestionData(context);

      // Should have called googleSearchWithFallback using site.getBaseURL() as fallback
      expect(mockBrightDataClient.googleSearchWithFallback).to.have.been.called;
    });

    it('should skip Bright Data when no API key configured', async () => {
      delete context.env.BRIGHT_DATA_API_KEY;
      delete context.env.BRIGHT_DATA_ZONE;

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);

      await mockedGenerateSuggestionData(context);

      expect(context.log.info).to.not.have.been.calledWith(sinon.match(/Bright Data enabled/));
    });

    it('should fall through to Mystique when Bright Data returns no results', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning empty results
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // Setup opportunity properly for the mocked handler
      const mockOpportunity = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns(brokenBacklinksSuggestions),
        getType: () => 'broken-backlinks',
        setData: () => {},
        getData: () => {},
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      // Use /blog/ prefix to match topPages paths
      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/blog/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await mockedGenerateSuggestionData(context);

      // Should still complete and send to Mystique
      expect(result.status).to.equal('complete');
      expect(context.sqs.sendMessage).to.have.been.called;
    });

    it('should handle Bright Data errors gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data throwing an error
      mockBrightDataClient.googleSearchWithFallback.rejects(new Error('API error'));

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);

      const result = await mockedGenerateSuggestionData(context);

      // Should log warning and continue
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Bright Data failed/), sinon.match.any);
      expect(result.status).to.equal('complete');
    });

    it('should validate URLs when BRIGHT_DATA_VALIDATE_URLS is true', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_VALIDATE_URLS = 'true';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/valid-page', title: 'Valid Page' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      // Mock the URL validation - nock returns 200 for valid URLs (both HEAD and GET)
      nock('https://example.com')
        .head('/valid-page')
        .reply(200);
      nock('https://example.com')
        .get('/valid-page')
        .reply(200);

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });

      // Setup opportunity properly for the mocked handler
      const mockOpportunity = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns(brokenBacklinksSuggestions),
        getType: () => 'broken-backlinks',
        setData: () => {},
        getData: () => {},
        setUpdatedBy: sinon.stub().returnsThis(),
      };
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([mockOpportunity]);

      // Use /blog/ prefix to match topPages paths
      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          url_from: 'https://from.com/page',
          url_to: 'https://example.com/blog/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);

      await mockedGenerateSuggestionData(context);

      // Suggestion should be updated since URL is valid
      expect(mockSuggestion.setData).to.have.been.calledOnce;
    });

    it('should skip suggestion when validated URL returns 404', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_VALIDATE_URLS = 'true';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/broken-suggested', title: 'Broken' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      // Mock URL validation returning 404
      nock('https://example.com')
        .head('/broken-suggested')
        .reply(404);

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          url_from: 'https://from.com/page',
          url_to: 'https://example.com/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);

      await mockedGenerateSuggestionData(context);

      // Suggestion should NOT be updated since URL validation failed
      expect(mockSuggestion.setData).to.not.have.been.called;
    });

    it('should handle missing suggestion gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ link: 'https://example.com/suggested-page', title: 'Suggested' }],
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      // Return null for findById to simulate missing suggestion
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(null);

      await mockedGenerateSuggestionData(context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match(/suggestion not found/));
    });

    it('should process multiple broken links in batches with delay', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_REQUEST_DELAY_MS = '100';

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      // Create multiple suggestions
      const testSuggestions = Array.from({ length: 15 }, (_, i) => ({
        getId: () => `test-suggestion-${i}`,
        getData: () => ({
          url_from: `https://from.com/page${i}`,
          url_to: `https://example.com/broken-page-${i}`,
        }),
      }));
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);

      const startTime = Date.now();
      await mockedGenerateSuggestionData(context);
      const elapsed = Date.now() - startTime;

      // Should have called googleSearchWithFallback for each broken link
      expect(mockBrightDataClient.googleSearchWithFallback.callCount).to.equal(15);

      // With 15 items in batches of 10, there should be 1 delay between batches
      // Elapsed time should be at least ~100ms for the delay
      expect(elapsed).to.be.at.least(90); // Allow some variance
    });

    it('should handle result with no link gracefully', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';

      // Mock Bright Data returning a result without a link
      mockBrightDataClient.googleSearchWithFallback.resolves({
        results: [{ title: 'No Link Result' }], // Missing link property
        query: 'site:example.com broken page',
        keywords: 'broken page',
      });

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const mockSuggestion = {
        getId: () => 'test-suggestion-1',
        getData: () => ({
          url_from: 'https://from.com/page',
          url_to: 'https://example.com/broken-page',
        }),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
      };
      const testSuggestions = [mockSuggestion];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);
      context.dataAccess.Suggestion.findById = sinon.stub().resolves(mockSuggestion);

      await mockedGenerateSuggestionData(context);

      // Should not update suggestion when result has no link
      expect(mockSuggestion.setData).to.not.have.been.called;
    });

    it('should use custom max results from env', async () => {
      context.env.BRIGHT_DATA_API_KEY = 'test-api-key';
      context.env.BRIGHT_DATA_ZONE = 'test-zone';
      context.env.BRIGHT_DATA_MAX_RESULTS = '5';

      context.audit.getAuditResult.returns({
        success: true,
        brokenBacklinks: auditDataMock.auditResult.brokenBacklinks,
      });
      brokenBacklinksOpportunity.getSuggestions.returns([]);
      brokenBacklinksOpportunity.addSuggestions.returns(brokenBacklinksSuggestions);

      const testSuggestions = [
        {
          getId: () => 'test-suggestion-1',
          getData: () => ({
            url_from: 'https://from.com/page',
            url_to: 'https://example.com/broken-page',
          }),
        },
      ];
      context.dataAccess.Suggestion.allByOpportunityIdAndStatus.resolves(testSuggestions);

      await mockedGenerateSuggestionData(context);

      expect(context.log.info).to.have.been.calledWith(sinon.match(/maxResults=5/));
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

  describe('generateSuggestionData - mergeDataFunction', () => {
    it('should preserve urlEdited when isEdited is true', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      // Use dynamic import to get esmock
      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [
          {
            url_from: 'https://example.com/page1',
            url_to: 'https://example.com/broken',
            title: 'Test Page',
            traffic_domain: 1000,
          },
        ],
      };

      const mockAudit = {
        getId: () => 'audit-id',
        getAuditResult: () => mockAuditResult,
      };

      const mockSite = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      const mockContext = {
        site: mockSite,
        audit: mockAudit,
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([]),
          },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);

      expect(mockSyncSuggestions).to.have.been.calledOnce;
      const syncCall = mockSyncSuggestions.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;
      expect(mergeDataFn).to.be.a('function');

      // Test that urlEdited is preserved when isEdited is true
      const existingData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        title: 'Old Title',
        traffic_domain: 500,
        urlEdited: 'https://example.com/user-fixed-url',
        isEdited: true,
      };

      const newData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        title: 'New Title',
        traffic_domain: 1000,
      };

      const result = mergeDataFn(existingData, newData);

      expect(result.urlEdited).to.equal('https://example.com/user-fixed-url');
      expect(result.isEdited).to.equal(true);
      expect(result.title).to.equal('New Title');
      expect(result.traffic_domain).to.equal(1000);
    });

    it('should preserve urlEdited when isEdited is false (AI selection)', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [
          {
            url_from: 'https://example.com/page1',
            url_to: 'https://example.com/broken',
            title: 'Test Page',
            traffic_domain: 1000,
          },
        ],
      };

      const mockAudit = {
        getId: () => 'audit-id',
        getAuditResult: () => mockAuditResult,
      };

      const mockSite = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      const mockContext = {
        site: mockSite,
        audit: mockAudit,
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([]),
          },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);

      const syncCall = mockSyncSuggestions.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test that urlEdited IS preserved when isEdited is false (user selected AI suggestion)
      const existingData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        urlEdited: 'https://example.com/old-edited-url',
        isEdited: false,
      };

      const newData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        title: 'New Title',
      };

      const result = mergeDataFn(existingData, newData);

      // urlEdited should be preserved even when isEdited is false
      expect(result.urlEdited).to.equal('https://example.com/old-edited-url');
      expect(result.isEdited).to.equal(false);
      expect(result.title).to.equal('New Title');
    });

    it('should not preserve urlEdited when urlEdited is undefined', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [
          {
            url_from: 'https://example.com/page1',
            url_to: 'https://example.com/broken',
            title: 'Test Page',
            traffic_domain: 1000,
          },
        ],
      };

      const mockAudit = {
        getId: () => 'audit-id',
        getAuditResult: () => mockAuditResult,
      };

      const mockSite = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
      };

      const mockContext = {
        site: mockSite,
        audit: mockAudit,
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sinon.stub().resolves([]),
          },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);

      const syncCall = mockSyncSuggestions.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test that urlEdited is NOT preserved when it's undefined
      const existingData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        isEdited: true,
        // urlEdited is undefined
      };

      const newData = {
        url_from: 'https://example.com/page1',
        url_to: 'https://example.com/broken',
        title: 'New Title',
      };

      const result = mergeDataFn(existingData, newData);

      expect(result.urlEdited).to.be.undefined;
      expect(result.title).to.equal('New Title');
    });

    it('should handle when isEdited is null and not preserve', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [{
          url_from: 'https://example.com/page1',
          url_to: 'https://example.com/broken',
          title: 'Test',
          traffic_domain: 1000,
        }],
      };

      const mockContext = {
        site: { getId: () => 'site-id', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id', getAuditResult: () => mockAuditResult },
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: { allByOpportunityIdAndStatus: sinon.stub().resolves([]) },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);
      const mergeDataFn = mockSyncSuggestions.getCall(0).args[0].mergeDataFunction;

      const result = mergeDataFn(
        { urlEdited: 'https://example.com/edited-url', isEdited: null },
        { title: 'New Title' },
      );

      expect(result.urlEdited).to.be.undefined;
      expect(result.title).to.equal('New Title');
    });

    it('should handle when urlEdited is null and not preserve', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [{
          url_from: 'https://example.com/page1',
          url_to: 'https://example.com/broken',
          title: 'Test',
          traffic_domain: 1000,
        }],
      };

      const mockContext = {
        site: { getId: () => 'site-id', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id', getAuditResult: () => mockAuditResult },
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: { allByOpportunityIdAndStatus: sinon.stub().resolves([]) },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);
      const mergeDataFn = mockSyncSuggestions.getCall(0).args[0].mergeDataFunction;

      const result = mergeDataFn(
        { urlEdited: null, isEdited: true },
        { title: 'New Title' },
      );

      // Should not preserve null urlEdited
      expect(result.urlEdited).to.be.undefined;
      expect(result.title).to.equal('New Title');
    });

    it('should pass callback wrappers to syncSuggestionsWithPublishDetection', async () => {
      const mockSyncSuggestions = sinon.stub().resolves();
      const mockConvertToOpportunity = sinon.stub().resolves({
        getId: () => 'opportunity-id',
      });

      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../src/utils/data-access.js': {
          syncSuggestionsWithPublishDetection: mockSyncSuggestions,
        },
      });

      const mockAuditResult = {
        success: true,
        brokenBacklinks: [{
          url_from: 'https://example.com/page1',
          url_to: 'https://example.com/broken',
          title: 'Test',
          traffic_domain: 1000,
        }],
      };

      const mockSite = {
        getId: () => 'site-id',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
      };

      const mockContext = {
        site: mockSite,
        audit: { getId: () => 'audit-id', getAuditResult: () => mockAuditResult },
        finalUrl: 'https://example.com',
        log: context.log,
        dataAccess: {
          Configuration: {
            findLatest: sinon.stub().resolves({
              isHandlerEnabledForSite: sinon.stub().returns(true),
            }),
          },
          Suggestion: { allByOpportunityIdAndStatus: sinon.stub().resolves([]) },
          SiteTopPage: {
            allBySiteIdAndSource: sinon.stub().resolves([]),
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        sqs: context.sqs,
        env: context.env,
      };

      await mockedHandler.generateSuggestionData(mockContext);

      const syncCall = mockSyncSuggestions.getCall(0).args[0];

      // Verify callbacks are functions
      expect(syncCall.isIssueFixedWithAISuggestion).to.be.a('function');
      expect(syncCall.buildFixEntityPayload).to.be.a('function');
      expect(syncCall.isIssueResolvedOnProduction).to.be.a('function');

      // Call the wrapper functions to cover the wrapper lines
      const mockSuggestion = {
        getData: () => ({ url_to: 'https://example.com/broken' }),
        getId: () => 'sugg-1',
        getType: () => 'REDIRECT_UPDATE',
      };
      const mockOpp = { getId: () => 'opp-1' };

      // Call isIssueFixedWithAISuggestion wrapper (will return false due to no targets)
      const fixedResult = await syncCall.isIssueFixedWithAISuggestion(mockSuggestion);
      expect(fixedResult).to.be.false;

      // Call buildFixEntityPayload wrapper
      const payload = syncCall.buildFixEntityPayload(mockSuggestion, mockOpp, false);
      expect(payload.opportunityId).to.equal('opp-1');
      expect(payload.changeDetails.system).to.equal('aem_edge');

      // Call isIssueResolvedOnProduction wrapper (will return false due to missing url)
      const resolvedResult = await syncCall.isIssueResolvedOnProduction({
        getData: () => ({}),
      });
      expect(resolvedResult).to.be.false;
    });
  });

  describe('checkIfBacklinkFixedWithSuggestion', () => {
    let mockLog;

    beforeEach(() => {
      mockLog = {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should return false when suggestion has no data', async () => {
      const suggestion = { getData: () => null };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.false;
    });

    it('should return false when url_to is missing', async () => {
      const suggestion = { getData: () => ({ urlsSuggested: ['https://example.com/fix'] }) };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.false;
    });

    it('should return false when no suggested targets', async () => {
      const suggestion = { getData: () => ({ url_to: 'https://example.com/broken' }) };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.false;
    });

    it('should return true when URL redirects to suggested target', async () => {
      nock('https://example.com')
        .get('/broken')
        .reply(301, '', { Location: 'https://example.com/fixed' });
      nock('https://example.com')
        .get('/fixed')
        .reply(200);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/broken',
          urlsSuggested: ['https://example.com/fixed'],
        }),
      };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.true;
    });

    it('should return true when URL redirects to urlEdited', async () => {
      nock('https://example.com')
        .get('/broken')
        .reply(301, '', { Location: 'https://example.com/custom-fix' });
      nock('https://example.com')
        .get('/custom-fix')
        .reply(200);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/broken',
          urlEdited: 'https://example.com/custom-fix',
          urlsSuggested: ['https://example.com/other'],
        }),
      };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.true;
    });

    it('should return false when fetch fails', async () => {
      nock('https://example.com')
        .get('/broken')
        .replyWithError('Network error');

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/broken',
          urlsSuggested: ['https://example.com/fixed'],
        }),
      };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.false;
      expect(mockLog.debug).to.have.been.called;
    });

    it('should return false when URL does not redirect to suggested target', async () => {
      nock('https://example.com')
        .get('/broken')
        .reply(200);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/broken',
          urlsSuggested: ['https://example.com/fixed'],
        }),
      };
      const result = await checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      expect(result).to.be.false;
    });

    it('should use urlTo as fallback when response has no url property', async () => {
      // Use esmock to mock fetch with a response that has no url property
      const esmock = (await import('esmock')).default;
      const mockedHandler = await esmock('../../src/backlinks/handler.js', {
        '@adobe/spacecat-shared-utils': {
          tracingFetch: sinon.stub().resolves({
            ok: true,
            status: 200,
            url: undefined, // No url property - triggers fallback
          }),
          prependSchema: (url) => url,
          stripWWW: (host) => host,
        },
      });

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/broken',
          urlsSuggested: ['https://example.com/broken'], // Target matches urlTo fallback
        }),
      };
      const result = await mockedHandler.checkIfBacklinkFixedWithSuggestion(suggestion, mockLog);
      // Since resp.url is undefined, fallback to urlTo which matches target
      expect(result).to.be.true;
    });
  });

  describe('buildBacklinkFixEntityPayload', () => {
    it('should build payload with PUBLISHED status when not author-only', () => {
      const suggestion = {
        getId: () => 'sugg-1',
        getType: () => 'REDIRECT_UPDATE',
        getData: () => ({
          url_from: 'https://referring.com/page',
          url_to: 'https://example.com/broken',
          urlEdited: 'https://example.com/fixed',
        }),
      };
      const opportunity = { getId: () => 'opp-1' };
      const site = { getDeliveryType: () => 'aem_edge' };

      const result = buildBacklinkFixEntityPayload(suggestion, opportunity, false, site);

      expect(result.opportunityId).to.equal('opp-1');
      expect(result.status).to.equal(FixEntityModel.STATUSES.PUBLISHED);
      expect(result.type).to.equal('REDIRECT_UPDATE');
      expect(result.changeDetails.system).to.equal('aem_edge');
      expect(result.changeDetails.pagePath).to.equal('https://referring.com/page');
      expect(result.changeDetails.oldValue).to.equal('https://example.com/broken');
      expect(result.changeDetails.updatedValue).to.equal('https://example.com/fixed');
      expect(result.suggestions).to.deep.equal(['sugg-1']);
    });

    it('should build payload with DEPLOYED status when author-only', () => {
      const suggestion = {
        getId: () => 'sugg-2',
        getType: () => 'REDIRECT_UPDATE',
        getData: () => ({
          url_from: 'https://referring.com/page',
          url_to: 'https://example.com/broken',
          urlsSuggested: ['https://example.com/ai-fix'],
        }),
      };
      const opportunity = { getId: () => 'opp-2' };
      const site = { getDeliveryType: () => 'aem_cs' };

      const result = buildBacklinkFixEntityPayload(suggestion, opportunity, true, site);

      expect(result.status).to.equal(FixEntityModel.STATUSES.DEPLOYED);
      expect(result.changeDetails.updatedValue).to.equal('https://example.com/ai-fix');
    });

    it('should handle missing data gracefully', () => {
      const suggestion = {
        getId: () => null,
        getType: () => null,
        getData: () => null,
      };
      const opportunity = { getId: () => 'opp-3' };
      const site = { getDeliveryType: () => 'other' };

      const result = buildBacklinkFixEntityPayload(suggestion, opportunity, false, site);

      expect(result.changeDetails.oldValue).to.equal('');
      expect(result.changeDetails.updatedValue).to.equal('');
    });
  });

  describe('checkIfBacklinkResolvedOnProduction', () => {
    let mockLog;

    beforeEach(() => {
      mockLog = {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('should return false when suggestion has no url_to', async () => {
      const suggestion = { getData: () => ({}) };
      const result = await checkIfBacklinkResolvedOnProduction(suggestion, mockLog);
      expect(result).to.be.false;
    });

    it('should return true when URL is no longer broken (returns 200)', async () => {
      nock('https://example.com')
        .get('/was-broken')
        .reply(200);

      const suggestion = { getData: () => ({ url_to: 'https://example.com/was-broken' }) };
      const result = await checkIfBacklinkResolvedOnProduction(suggestion, mockLog);
      expect(result).to.be.true;
    });

    it('should return false when URL is still broken (returns 404)', async () => {
      nock('https://example.com')
        .get('/still-broken')
        .reply(404);

      const suggestion = { getData: () => ({ url_to: 'https://example.com/still-broken' }) };
      const result = await checkIfBacklinkResolvedOnProduction(suggestion, mockLog);
      expect(result).to.be.false;
    });
  });
});
