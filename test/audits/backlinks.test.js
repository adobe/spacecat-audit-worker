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
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };
import auditDataSuggestionsMock from '../fixtures/broken-backlinks/auditWithSuggestions.json' with { type: 'json' };
import rumTraffic from '../fixtures/broken-backlinks/all-traffic.json' with { type: 'json' };
import { brokenBacklinksAuditRunner, opportunityAndSuggestions, generateSuggestionData } from '../../src/backlinks/handler.js';
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
  brokenBacklinksOpportunity,
  opportunityData,
  otherOpportunity,
} from '../fixtures/broken-backlinks/opportunity.js';
import {
  brokenBacklinkExistingSuggestions,
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
  const auditUrl = 'https://audit.url';

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
        },
        s3Client: {
          send: sandbox.stub(),
        },
      })
      .build(message);

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

  it('should transform the audit result into an opportunity in the post processor and create a new opportunity', async () => {
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
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    context.dataAccess.Opportunity.create.resolves(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);

    ahrefsMock(site.getBaseURL(), auditDataMock.auditResult);

    await opportunityAndSuggestions(auditUrl, auditDataSuggestionsMock, context, site);

    const kpiDeltas = {
      projectedTrafficLost: sinon.match.number,
      projectedTrafficValue: sinon.match.number,
    };

    expect(context.dataAccess.Opportunity.create)
      .to
      .have
      .been
      .calledOnceWith(opportunityData(auditDataMock.siteId, auditDataMock.id, kpiDeltas));
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnceWith(suggestions);
  });

  it('should transform the audit result into an opportunity in the post processor and add it to an existing opportunity', async () => {
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves(brokenBacklinkExistingSuggestions);
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [brokenBacklinksOpportunity, otherOpportunity],
    );

    ahrefsMock(site.getBaseURL(), auditDataMock.auditResult);

    await opportunityAndSuggestions(auditUrl, auditDataSuggestionsMock, context, site);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(brokenBacklinksOpportunity.setAuditId).to.have.been.calledOnceWith(auditDataMock.id);

    expect(brokenBacklinksOpportunity.save).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledWith(
      suggestions.filter((s) => brokenBacklinkExistingSuggestions[0].data.url_to !== s.data.url_to),
    );
  });

  it('should throw an error if opportunity creation fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.throws('broken-backlinks opportunity-error');
    const errorMessage = 'Sinon-provided broken-backlinks opportunity-error';

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditDataMock.auditResult);

    try {
      await opportunityAndSuggestions(auditUrl, auditDataSuggestionsMock, context, site);
    } catch (e) {
      expect(e.message).to.equal(errorMessage);
    }

    expect(context.log.error).to.have.been.calledWith(`Failed to create new opportunity for siteId site-id and auditId audit-id: ${errorMessage}`);
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
    let auditData;
    let configuration;
    let firefallClient;

    const mockFileResponse = {
      ContentType: 'application/json',
      Body: {
        transformToString: sandbox.stub().resolves(JSON.stringify({
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html lang="en"><body><header><a href="/home">Home</a><a href="/about">About</a></header></body></html>',
            tags: {
              title: 'Page 1 Title',
              description: 'Page 1 Description',
              h1: ['Page 1 H1'],
            },
          },
        })),
      },
    };

    beforeEach(() => {
      auditData = {
        auditResult: {
          success: true,
          brokenBacklinks: [
            { url_to: 'https://example.com/broken1' },
            { url_to: 'https://example.com/broken2' },
          ],
        },
      };
      configuration = {
        isHandlerEnabledForSite: sandbox.stub(),
      };
      context.dataAccess.Configuration.findLatest.resolves(configuration);

      firefallClient = {
        fetchChatCompletion: sandbox.stub(),
      };
      sandbox.stub(FirefallClient, 'createFrom').returns(firefallClient);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns original auditData if audit result is unsuccessful', async () => {
      auditData.auditResult.success = false;

      const result = await generateSuggestionData('https://example.com', auditData, context, site);

      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('Audit failed, skipping suggestions generation');
    });

    it('returns original auditData if auto-suggest is disabled for the site', async () => {
      configuration.isHandlerEnabledForSite.returns(false);

      const result = await generateSuggestionData('https://example.com', auditData, context, site);

      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('Auto-suggest is disabled for site');
    });

    it('processes suggestions for broken backlinks, defaults to base URL if none found', async () => {
      context.s3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'scrapes/site1/scrape.json' },
        ],
        IsTruncated: false,
        NextContinuationToken: 'token',
      });
      context.s3Client.send.resolves(mockFileResponse);
      configuration.isHandlerEnabledForSite.returns(true);
      firefallClient.fetchChatCompletion.resolves({
        choices: [{
          message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
          finish_reason: 'stop',
        }],
      });
      firefallClient.fetchChatCompletion.onCall(3).resolves({
        choices: [{
          message: { content: JSON.stringify({ some_other_property: 'some other value' }) },
          finish_reason: 'length',
        }],
      });

      const result = await generateSuggestionData('https://example.com', auditData, context, site);

      expect(firefallClient.fetchChatCompletion).to.have.been.callCount(4);
      expect(result.auditResult.brokenBacklinks).to.deep.equal([
        {
          url_to: 'https://example.com/broken1',
          urlsSuggested: ['https://fix.com'],
          aiRationale: 'Rationale',
        },
        {
          url_to: 'https://example.com/broken2',
          urlsSuggested: ['https://example.com'],
          aiRationale: 'No suitable suggestions found',
        },
      ]);
      expect(context.log.info).to.have.been.calledWith('Suggestions generation complete.');
    });

    it('generates suggestions in multiple batches if there are more than 300 alternative URLs', async () => {
      context.s3Client.send.onCall(0).resolves({
        Contents: [
          // genereate 301 keys
          ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
        ],
        IsTruncated: false,
        NextContinuationToken: 'token',
      });
      context.s3Client.send.resolves(mockFileResponse);
      configuration.isHandlerEnabledForSite.returns(true);
      firefallClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });

      firefallClient.fetchChatCompletion.onCall(1).resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'length',
        }],
      });

      firefallClient.fetchChatCompletion.onCall(6).resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });

      firefallClient.fetchChatCompletion.onCall(7).resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'length',
        }],
      });

      const result = await generateSuggestionData('https://example.com', auditData, context, site);

      expect(firefallClient.fetchChatCompletion).to.have.been.callCount(8);
      expect(result.auditResult.brokenBacklinks).to.deep.equal([
        {
          url_to: 'https://example.com/broken1',
          urlsSuggested: ['https://fix.com'],
          aiRationale: 'Rationale',
        },
        {
          url_to: 'https://example.com/broken2',
        },
      ]);
      expect(context.log.info).to.have.been.calledWith('Suggestions generation complete.');
    });

    it('handles Firefall client errors gracefully and continues processing, should suggest base URL instead', async () => {
      context.s3Client.send.onCall(0).resolves({
        Contents: [
          // genereate 301 keys
          ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
        ],
        IsTruncated: false,
        NextContinuationToken: 'token',
      });
      context.s3Client.send.resolves(mockFileResponse);
      configuration.isHandlerEnabledForSite.returns(true);
      firefallClient.fetchChatCompletion.onCall(0).rejects(new Error('Firefall error'));
      firefallClient.fetchChatCompletion.onCall(2).rejects(new Error('Firefall error'));
      firefallClient.fetchChatCompletion.onCall(6).resolves({
        choices: [{
          message: {
            content: JSON.stringify({ some_other_property: 'some other value' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });
      firefallClient.fetchChatCompletion.onCall(7).rejects(new Error('Firefall error'));
      firefallClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
            aiRationale: 'Rationale',
          },
          finish_reason: 'stop',
        }],
      });

      const result = await generateSuggestionData('https://example.com', auditData, context, site);

      expect(result.auditResult.brokenBacklinks).to.deep.equal([
        {
          url_to: 'https://example.com/broken1',
          urlsSuggested: ['https://example.com'],
          aiRationale: 'No suitable suggestions found',
        },
        {
          url_to: 'https://example.com/broken2',
        },
      ]);
      expect(context.log.error).to.have.been.calledWith('Batch processing error: Firefall error');
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
      expect(result.projectedTrafficValue).to.equal(534287.974025892);
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

    it('returns early if there is no RUM traffic data', async () => {
      context.s3Client.send.onCall(0).resolves(null);

      const result = await calculateKpiMetrics(auditData, context, site);
      expect(result).to.be.null;
    });
  });
});
