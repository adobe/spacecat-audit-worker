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
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import esmock from 'esmock';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import {
  TITLE,
  DESCRIPTION,
  H1,
  SEO_IMPACT,
  HIGH,
  MODERATE,
  ISSUE,
  SEO_RECOMMENDATION,
  MULTIPLE_H1_ON_PAGE,
  SHOULD_BE_PRESENT,
  TAG_LENGTHS,
  ONE_H1_ON_A_PAGE,
} from '../../src/metatags/constants.js';
import SeoChecks from '../../src/metatags/seo-checks.js';
import testData from '../fixtures/meta-tags-data.js';
import { removeTrailingSlash, getBaseUrl } from '../../src/metatags/opportunity-utils.js';
import {
  importTopPages,
  submitForScraping,
  fetchAndProcessPageObject,
  opportunityAndSuggestions,
} from '../../src/metatags/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Meta Tags', () => {
  describe('SeoChecks', () => {
    let seoChecks;
    let logStub;

    beforeEach(() => {
      logStub = sinon.stub();
      seoChecks = new SeoChecks(logStub);
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('capitalizeFirstLetter', () => {
      it('should capitalize the first letter of a string', () => {
        const result = SeoChecks.capitalizeFirstLetter('title');
        expect(result).to.equal('Title');
      });

      it('should return the original string if it is empty', () => {
        const result = SeoChecks.capitalizeFirstLetter('');
        expect(result).to.equal('');
      });

      it('should return the original string if it is null or undefined', () => {
        const result = SeoChecks.capitalizeFirstLetter(null);
        expect(result).to.be.null;
      });
    });

    describe('checkForMissingTags', () => {
      it('should detect missing tags and add to detectedTags', () => {
        const url = 'https://example.com';
        const pageTags = {}; // Empty object simulating missing tags

        seoChecks.checkForMissingTags(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][TITLE][ISSUE]).to.equal('Missing Title');
        expect(seoChecks.getDetectedTags()[url][TITLE][SEO_RECOMMENDATION])
          .to.equal(SHOULD_BE_PRESENT);
      });
    });

    describe('checkForTagsLength', () => {
      it('should detect empty tag and add to detectedTags with HIGH impact', () => {
        const url = 'https://example.com';
        const pageTags = { [TITLE]: '' };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][TITLE][ISSUE]).to.equal('Empty Title');
        expect(seoChecks.getDetectedTags()[url][TITLE][SEO_IMPACT]).to.equal(HIGH);
      });

      it('should detect too long tag and add to detectedTags with MODERATE impact', () => {
        const url = 'https://example.com';
        const longTitle = 'A'.repeat(TAG_LENGTHS[TITLE].maxLength + 1);
        const pageTags = { [TITLE]: longTitle };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][TITLE][ISSUE]).to.equal('Title too long');
        expect(seoChecks.getDetectedTags()[url][TITLE][SEO_IMPACT]).to.equal(MODERATE);
      });

      it('should detect too short tag and add to detectedTags with MODERATE impact', () => {
        const url = 'https://example.com';
        const shortTitle = 'A'.repeat(TAG_LENGTHS[TITLE].minLength - 1);
        const pageTags = { [TITLE]: shortTitle };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][TITLE][ISSUE]).to.equal('Title too short');
        expect(seoChecks.getDetectedTags()[url][TITLE][SEO_IMPACT]).to.equal(MODERATE);
      });
    });

    // check disabled, to be included in later iterations
    describe('checkForH1Count', () => {
      it('should detect multiple H1 tags on the page', () => {
        const url = 'https://example.com';
        const pageTags = { [H1]: ['Heading 1', 'Heading 2'] };

        seoChecks.checkForH1Count(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][H1][ISSUE]).to.equal(MULTIPLE_H1_ON_PAGE);
        expect(seoChecks.getDetectedTags()[url][H1][SEO_RECOMMENDATION])
          .to.equal(ONE_H1_ON_A_PAGE);
      });

      it('should not detect an issue if there is only one H1 tag', () => {
        const url = 'https://example.com';
        const pageTags = { [H1]: ['Single Heading'] };
        seoChecks.checkForH1Count(url, pageTags);
        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });
    });

    describe('checkForUniqueness', () => {
      it('should detect duplicate tags across pages and add to detectedTags', () => {
        seoChecks.addToAllTags('https://example1.com', TITLE, 'Sample Title');
        seoChecks.addToAllTags('https://example2.com', TITLE, 'Sample Title');

        seoChecks.finalChecks();
        expect(seoChecks.getDetectedTags()['https://example1.com'][TITLE][ISSUE]).to.equal('Duplicate Title');
        expect(seoChecks.getDetectedTags()['https://example2.com'][TITLE][ISSUE]).to.equal('Duplicate Title');
      });
    });

    describe('addToAllTags', () => {
      it('should add tags to allTags object', () => {
        const url = 'https://example.com';
        const tagContent = 'Sample Title';

        seoChecks.addToAllTags(url, TITLE, tagContent);

        expect(seoChecks.allTags[TITLE][tagContent.toLowerCase()].pageUrls).to.include(url);
      });
    });

    describe('performChecks', () => {
      it('should perform all checks and store detected issues', () => {
        const url = 'https://example.com';
        const pageTags = {
          [TITLE]: '', // Empty title
          [DESCRIPTION]: 'A short description.',
          [H1]: ['Heading 1'], // Multiple H1 tags
        };

        seoChecks.performChecks(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url][TITLE][ISSUE]).to.equal('Empty Title');
      });

      it('should return if url is invalid', () => {
        const pageTags = {
          [TITLE]: '', // Empty title
          [DESCRIPTION]: 'A short description.',
          [H1]: ['Heading 1', 'Heading 2'], // Multiple H1 tags
        };

        seoChecks.performChecks(null, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags).to.deep.equal({});
      });

      it('should return if pageTags is invalid', () => {
        const url = 'https://example.com';
        seoChecks.performChecks(url, null);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags).to.deep.equal({});
      });
    });
  });

  describe('handler method', () => {
    let dataAccessStub;
    let s3ClientStub;
    let logStub;
    let context;
    let site;
    let audit;

    beforeEach(() => {
      sinon.restore();
      dataAccessStub = {
        Audit: {
          create: sinon.stub(),
          AUDIT_TYPES: {
            META_TAGS: 'meta-tags',
          },
        },
        Configuration: {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: sinon.stub().returns(true),
          }),
        },
        Site: {
          findById: sinon.stub().resolves({ getIsLive: sinon.stub().returns(true) }),
        },
        SiteTopPage: {
          allBySiteId: sinon.stub(),
          allBySiteIdAndSourceAndGeo: sinon.stub(),
        },
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
          create: sinon.stub(),
        },
      };
      s3ClientStub = {
        send: sinon.stub(),
        getObject: sinon.stub(),
      };
      logStub = {
        info: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
      };
      site = {
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
        getIsLive: sinon.stub().returns(true),
        getConfig: sinon.stub().returns({
          getIncludedURLs: sinon.stub().returns([]),
        }),
      };
      audit = {
        getId: sinon.stub().returns('audit-id'),
      };
      context = {
        log: logStub,
        s3Client: s3ClientStub,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          GENVAR_ENDPOINT: 'test-genvar-url',
          FIREFALL_IMS_ORG_ID: 'test-org@adobe',
          GENVAR_IMS_ORG_ID: 'test-org@adobe',
          imsHost: 'https://ims-host.test',
          clientId: 'test-client-id',
          clientCode: 'test-client-code',
          clientSecret: 'test-client-secret',
        },
        dataAccess: dataAccessStub,
        site,
        finalUrl: 'http://example.com',
        audit,
        opportunity: {
          setUpdatedBy: sinon.stub(),
        },
      };
    });

    describe('importTopPages', () => {
      it('should prepare import step with correct parameters', async () => {
        const result = await importTopPages(context);
        expect(result).to.deep.equal({
          type: 'top-pages',
          siteId: 'site-id',
          auditResult: { status: 'preparing', finalUrl: 'http://example.com' },
          fullAuditRef: 'scrapes/site-id/',
        });
      });
    });

    describe('submitForScraping', () => {
      it('should submit top pages for scraping', async () => {
        const topPages = [
          { getUrl: () => 'http://example.com/page1' },
          { getUrl: () => 'http://example.com/page2' },
        ];
        dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

        const result = await submitForScraping(context);
        expect(result).to.deep.equal({
          urls: [
            { url: 'http://example.com/page1' },
            { url: 'http://example.com/page2' },
          ],
          siteId: 'site-id',
          type: 'meta-tags',
          allowCache: false,
          maxScrapeAge: 0.001,
          options: {
            waitTimeoutForMetaTags: 5000,
          },
        });
      });

      it('should throw error if no top pages found', async () => {
        dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);
        await expect(submitForScraping(context)).to.be.rejectedWith('No URLs found for site neither top pages nor included URLs');
      });

      it('should submit top pages for scraping when getIncludedURLs returns null', async () => {
        const topPages = [
          { getUrl: () => 'http://example.com/page1' },
          { getUrl: () => 'http://example.com/page2' },
        ];
        dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
        const getConfigStub = sinon.stub().returns({
          getIncludedURLs: sinon.stub().returns(null),
        });
        context.site.getConfig = getConfigStub;

        const result = await submitForScraping(context);
        expect(result).to.deep.equal({
          urls: [
            { url: 'http://example.com/page1' },
            { url: 'http://example.com/page2' },
          ],
          siteId: 'site-id',
          type: 'meta-tags',
          allowCache: false,
          maxScrapeAge: 0.001,
          options: {
            waitTimeoutForMetaTags: 5000,
          },
        });
      });
    });

    describe('fetchAndProcessPageObject', () => {
      it('should process valid page object', async () => {
        const mockScrapeResult = {
          finalUrl: 'http://example.com/page1',
          scrapeResult: {
            tags: {
              title: 'Test Page',
              description: 'Test Description',
              h1: ['Test H1'],
            },
          },
        };

        s3ClientStub.send.resolves({
          Body: {
            transformToString: () => JSON.stringify(mockScrapeResult),
          },
          ContentType: 'application/json',
        });

        const result = await fetchAndProcessPageObject(
          s3ClientStub,
          'test-bucket',
          'www.test-site.com/page1',
          'scrapes/site-id/page1/scrape.json',
          logStub,
        );

        expect(result).to.deep.equal({
          '/page1': {
            title: 'Test Page',
            description: 'Test Description',
            h1: ['Test H1'],
            s3key: 'scrapes/site-id/page1/scrape.json',
          },
        });
      });

      it('should handle empty pageUrl by converting it to root path', async () => {
        const mockScrapeResult = {
          finalUrl: '',
          scrapeResult: {
            tags: {
              title: 'Home Page',
              description: 'Home Description',
              h1: ['Home H1'],
            },
          },
        };

        s3ClientStub.send.resolves({
          Body: {
            transformToString: () => JSON.stringify(mockScrapeResult),
          },
          ContentType: 'application/json',
        });

        const result = await fetchAndProcessPageObject(
          s3ClientStub,
          'test-bucket',
          'https://www.test-site.com',
          'scrapes/site-id/scrape.json',
          logStub,
        );

        expect(result).to.deep.equal({
          '/': {
            title: 'Home Page',
            description: 'Home Description',
            h1: ['Home H1'],
            s3key: 'scrapes/site-id/scrape.json',
          },
        });
      });

      it('should handle missing tags', async () => {
        s3ClientStub.send.resolves({
          Body: {
            transformToString: () => JSON.stringify({}),
          },
          ContentType: 'application/json',
        });

        const result = await fetchAndProcessPageObject(
          s3ClientStub,
          'test-bucket',
          'https://www.test-site.com/page1',
          'scrapes/site-id/page1/scrape.json',
          logStub,
        );

        expect(result).to.be.null;
        expect(logStub.error).to.have.been.calledWith(
          'No Scraped tags found in S3 scrapes/site-id/page1/scrape.json object',
        );
      });

      it('should skip pages with scrape result body length less than 300 characters (soft 404s)', async () => {
        const mockScrapeResult = {
          finalUrl: 'http://example.com/404',
          scrapeResult: {
            tags: {
              title: '404 Not Found',
              description: 'Page not found',
              h1: ['404 Error'],
            },
            rawBody: '<html><body><h1>404 Not Found</h1></body></html>', // Less than 300 chars
          },
        };

        s3ClientStub.send.resolves({
          Body: {
            transformToString: () => JSON.stringify(mockScrapeResult),
          },
          ContentType: 'application/json',
        });

        const result = await fetchAndProcessPageObject(
          s3ClientStub,
          'test-bucket',
          'https://www.test-site.com/404',
          'scrapes/site-id/404/scrape.json',
          logStub,
        );

        expect(result).to.be.null;
        expect(logStub.error).to.have.been.calledWith(
          'Scrape result is empty for scrapes/site-id/404/scrape.json',
        );
      });

      it('should process pages with scrape result body length of 300 characters or more', async () => {
        const mockScrapeResult = {
          finalUrl: 'http://example.com/valid-page',
          scrapeResult: {
            tags: {
              title: 'Valid Page Title',
              description: 'This is a valid page with sufficient content length to pass the minimum threshold check',
              h1: ['Valid Page Heading'],
            },
            rawBody: 'A'.repeat(300), // Exactly 300 characters
          },
        };

        s3ClientStub.send.resolves({
          Body: {
            transformToString: () => JSON.stringify(mockScrapeResult),
          },
          ContentType: 'application/json',
        });

        const result = await fetchAndProcessPageObject(
          s3ClientStub,
          'test-bucket',
          'https://www.test-site.com/valid-page',
          'scrapes/site-id/valid-page/scrape.json',
          logStub,
        );

        expect(result).to.deep.equal({
          '/valid-page': {
            title: 'Valid Page Title',
            description: 'This is a valid page with sufficient content length to pass the minimum threshold check',
            h1: ['Valid Page Heading'],
            s3key: 'scrapes/site-id/valid-page/scrape.json',
          },
        });
        expect(logStub.error).to.not.have.been.called;
      });
    });

    describe('opportunities handler method', () => {
      let auditData;
      let auditUrl;
      let opportunity;

      beforeEach(() => {
        sinon.restore();
        auditUrl = 'https://example.com';
        opportunity = {
          getId: () => 'opportunity-id',
          getSiteId: () => 'site-id',
          setAuditId: sinon.stub(),
          save: sinon.stub(),
          getSuggestions: sinon.stub().returns(testData.existingSuggestions),
          addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
          getType: () => 'meta-tags',
          setData: () => {},
          getData: () => {},
          setUpdatedBy: sinon.stub().returnsThis(),
        };
        logStub = {
          info: sinon.stub(),
          debug: sinon.stub(),
          error: sinon.stub(),
          warn: sinon.stub(),
        };
        dataAccessStub = {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
            create: sinon.stub(),
          },
          Site: {
            findById: sinon.stub().resolves({
              getId: () => 'site-id',
              getDeliveryConfig: () => ({}),
            }),
          },
          Suggestion: {
            bulkUpdateStatus: sinon.stub(),
          },
        };
        context = {
          log: logStub,
          dataAccess: dataAccessStub,
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
        };
        auditData = testData.auditData;
      });

      it('should create new opportunity and add suggestions', async () => {
        opportunity.getType = () => 'meta-tags';
        dataAccessStub.Opportunity.create = sinon.stub().returns(opportunity);
        await opportunityAndSuggestions(auditUrl, auditData, context);
        expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.OpportunityData);
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should use existing opportunity and add suggestions', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        await opportunityAndSuggestions(auditUrl, auditData, context);
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should throw error if fetching opportunity fails', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
        try {
          await opportunityAndSuggestions(auditUrl, auditData, context);
        } catch (err) {
          expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
        }
        expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
      });

      it('should throw error if creating opportunity fails', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
        dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));
        try {
          await opportunityAndSuggestions(auditUrl, auditData, context);
        } catch (err) {
          expect(err.message).to.equal('some-error');
        }
        expect(logStub.error).to.be.calledWith('Failed to create new opportunity for siteId site-id and auditId audit-id: some-error');
      });

      it('should sync existing suggestions with new suggestions', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        opportunity.getSuggestions.returns(testData.existingSuggestions);
        await opportunityAndSuggestions(auditUrl, auditData, context);
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should mark existing suggestions OUTDATED if not present in audit data', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        opportunity.getSuggestions.returns(testData.existingSuggestions);
        const auditDataModified = {
          type: 'meta-tags',
          siteId: 'site-id',
          id: 'audit-id',
          auditResult: {
            finalUrl: 'www.test-site.com/',
            detectedTags: {
              '/page1': {
                title: {
                  tagContent: 'Lovesac - 404 Not Found',
                  duplicates: [
                    '/page4',
                    '/page5',
                  ],
                  seoRecommendation: 'Unique across pages',
                  issue: 'Duplicate Title',
                  issueDetails: '3 pages share same title',
                  seoImpact: 'High',
                },
                h1: {
                  seoRecommendation: 'Should be present',
                  issue: 'Missing H1',
                  issueDetails: 'H1 tag is missing',
                  seoImpact: 'High',
                },
              },
              '/page2': {
                title: {
                  seoRecommendation: '40-60 characters long',
                  issue: 'Empty Title',
                  issueDetails: 'Title tag is empty',
                  seoImpact: 'High',
                },
                h1: {
                  tagContent: '["We Can All Win Together","We Say As We Do"]',
                  seoRecommendation: '1 H1 on a page',
                  issue: 'Multiple H1 on page',
                  issueDetails: '2 H1 detected',
                  seoImpact: 'Moderate',
                },
              },
            },
          },
        };
        await opportunityAndSuggestions(auditUrl, auditDataModified, context);
        expect(dataAccessStub.Suggestion.bulkUpdateStatus).to.be.calledWith(testData.existingSuggestions.splice(0, 2), 'OUTDATED');
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should preserve existing AI suggestions and overrides when syncing', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);

        // Setup existing suggestion with AI data and overrides
        const existingSuggestion = {
          getData: () => ({
            url: 'https://example.com/page1',
            tagName: 'title',
            tagContent: 'Original Title',
            issue: 'Title too short',
            seoImpact: 'High',
            aiSuggestion: 'AI Generated Title',
            aiRationale: 'AI explanation for the title',
            toOverride: true,
          }),
          getStatus: () => 'pending',
          remove: sinon.stub(),
          setData: sinon.stub(),
          save: sinon.stub(),
          setUpdatedBy: sinon.stub().returnsThis(),
        };

        opportunity.getSuggestions.returns([existingSuggestion]);

        // Create audit data with different content for same URL
        const modifiedAuditData = {
          siteId: 'site-id',
          auditId: 'audit-id',
          auditResult: {
            finalUrl: 'https://example.com',
            detectedTags: {
              '/page1': {
                title: {
                  tagContent: 'Original Title',
                  issue: 'Title too short',
                  seoImpact: 'High',
                },
              },
            },
          },
        };

        await opportunityAndSuggestions(auditUrl, modifiedAuditData, context);

        // Verify that existing suggestion was updated properly
        expect(opportunity.save).to.be.calledOnce;
        expect(existingSuggestion.setData).to.be.calledOnce;

        const setDataCall = existingSuggestion.setData.getCall(0);
        const updatedData = setDataCall.args[0];

        // Verify the original AI data and override flags were preserved
        expect(updatedData).to.deep.include({
          aiSuggestion: 'AI Generated Title',
          aiRationale: 'AI explanation for the title',
          toOverride: true,
        });

        // Verify the suggestion was saved
        expect(existingSuggestion.save).to.be.calledOnce;
      });

      it('should throw error if suggestions fail to create', async () => {
        sinon.stub(GoogleClient, 'createFrom').resolves({});
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        opportunity.getSiteId = () => 'site-id';
        opportunity.addSuggestions = sinon.stub().returns({ errorItems: [{ item: 1, error: 'some-error' }], createdItems: [] });
        try {
          await opportunityAndSuggestions(auditUrl, auditData, context);
        } catch (err) {
          expect(err.message).to.equal('Failed to create suggestions for siteId site-id');
        }
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.error).to.be.calledWith('Suggestions for siteId site-id contains 1 items with errors');
        expect(logStub.error).to.be.calledTwice;
      });

      it('should take rank as -1 if issue is not known', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        const auditDataModified = {
          ...testData.auditData,
        };
        auditDataModified.auditResult.detectedTags['/page1'].title.issue = 'some random issue';
        const expectedSuggestionModified = [
          ...testData.expectedSuggestions,
        ];
        expectedSuggestionModified[0].data.issue = 'some random issue';
        expectedSuggestionModified[0].data.rank = -1;
        expectedSuggestionModified[0].rank = -1;
        await opportunityAndSuggestions(auditUrl, auditData, context);
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle malformed URLs in audit data', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        const auditDataWithMalformedUrl = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'malformed-url.com/path/', // Malformed URL without protocol
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithMalformedUrl, context);
        expect(opportunity.save).to.be.calledOnce;

        // Verify URL construction falls back to removeTrailingSlash
        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        expect(suggestions[0].data.url).to.equal('malformed-url.com/path/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle URLs with port numbers', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        dataAccessStub.Site.findById = sinon.stub().resolves({
          getId: () => 'site-id',
          getDeliveryConfig: () => ({ useHostnameOnly: true }),
        });
        const auditDataWithPort = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'https://example.com:8080/path/',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithPort, context);
        expect(opportunity.save).to.be.calledOnce;

        // Verify URL construction excludes port number
        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        expect(suggestions[0].data.url).to.equal('https://example.com:8080/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle URLs with query parameters', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        dataAccessStub.Site.findById = sinon.stub().resolves({
          getId: () => 'site-id',
          getDeliveryConfig: () => ({ useHostnameOnly: true }),
        });
        const auditDataWithQuery = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'https://example.com/path/?param=value',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithQuery, context);
        expect(opportunity.save).to.be.calledOnce;

        // Verify URL construction excludes query parameters
        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        expect(suggestions[0].data.url).to.equal('https://example.com/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle case when config.useHostnameOnly is undefined', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        dataAccessStub.Site.findById = sinon.stub().resolves({
          getId: () => 'site-id',
          getDeliveryConfig: () => ({ useHostnameOnly: undefined }),
        });
        const auditDataWithPort = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'http://localhost:8080/path/',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithPort, context);
        expect(opportunity.save).to.be.calledOnce;

        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        // Should preserve full URL path since useHostnameOnly is undefined
        expect(suggestions[0].data.url).to.equal('http://localhost:8080/path/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle case when getSite method returns undefined', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        opportunity.getSite = () => undefined;
        const auditDataWithPort = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'http://localhost:8080/path/',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithPort, context);
        expect(opportunity.save).to.be.calledOnce;

        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        // Should preserve full URL path since getSite returns undefined
        expect(suggestions[0].data.url).to.equal('http://localhost:8080/path/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle case when getSite method returns null', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        opportunity.getSite = () => null;
        const auditDataWithPort = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'http://localhost:8080/path/',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithPort, context);
        expect(opportunity.save).to.be.calledOnce;

        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        // Should preserve full URL path since getSite returns null
        expect(suggestions[0].data.url).to.equal('http://localhost:8080/path/page1');
        expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
      });

      it('should handle error in site configuration', async () => {
        dataAccessStub.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);
        const testError = new Error('Failed to get site');
        dataAccessStub.Site.findById.rejects(testError);
        const auditDataWithPort = {
          ...testData.auditData,
          auditResult: {
            ...testData.auditData.auditResult,
            finalUrl: 'http://localhost:8080/path/',
          },
        };

        await opportunityAndSuggestions(auditUrl, auditDataWithPort, context);
        expect(opportunity.save).to.be.calledOnce;
        expect(logStub.error).to.be.calledWith('Error in meta-tags configuration:', testError);

        const addSuggestionsCall = opportunity.addSuggestions.getCall(0);
        const suggestions = addSuggestionsCall.args[0];
        // Should preserve full URL path since error caused useHostnameOnly to stay false
        expect(suggestions[0].data.url).to.equal('http://localhost:8080/path/page1');
      });
    });

    describe('runAuditAndGenerateSuggestions', () => {
      let RUMAPIClientStub;
      let metatagsOppty;

      beforeEach(() => {
        s3ClientStub = {
          send: sinon.stub(),
          getObject: sinon.stub(),
        };
        logStub = {
          info: sinon.stub(),
          debug: sinon.stub(),
          error: sinon.stub(),
          warn: sinon.stub(),
        };
        dataAccessStub = {
          SiteTopPage: {
            allBySiteId: sinon.stub(),
            allBySiteIdAndSourceAndGeo: sinon.stub(),
          },
          Site: {
            findById: sinon.stub(),
          },
          Configuration: {
            findLatest: sinon.stub(),
          },
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub(),
          },
        };

        RUMAPIClientStub = {
          createFrom: sinon.stub().returns({
            query: sinon.stub().resolves([
              {
                url: 'http://example.com/blog/page1',
                total: 100,
                earned: 20,
                owned: 70,
                paid: 10,
              },
            ]),
          }),
        };

        metatagsOppty = {
          getId: () => 'opportunity-id',
          setAuditId: sinon.stub(),
          save: sinon.stub(),
          getSuggestions: sinon.stub().returns([]),
          addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
          getType: () => 'meta-tags',
          setData: sinon.stub(),
          getData: sinon.stub(),
          setUpdatedBy: sinon.stub().returnsThis(),
        };

        site = {
          getIsLive: sinon.stub().returns(true),
          getId: sinon.stub().returns('site-id'),
          getBaseURL: sinon.stub().returns('http://example.com'),
          getConfig: sinon.stub().returns({
            getIncludedURLs: sinon.stub().returns([]),
            getFetchConfig: sinon.stub().returns({
              overrideBaseURL: null,
            }),
          }),
        };

        audit = {
          getId: sinon.stub().returns('audit-id'),
        };

        dataAccessStub.Site.findById.resolves(site);
        dataAccessStub.Configuration.findLatest.resolves({
          isHandlerEnabledForSite: sinon.stub().returns(true),
        });

        const topPages = [
          { getUrl: () => 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
          { getUrl: () => 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') },
          { getUrl: () => 'http://example.com/blog/page3', getTopKeyword: sinon.stub().returns('') },
          { getUrl: () => 'http://example.com/', getTopKeyword: sinon.stub().returns('Home') },
        ];
        dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
        dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);
        dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([metatagsOppty]);

        // Setup S3 client stubs
        const listObjectsResponse = {
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
            { Key: 'scrapes/site-id/blog/page3/scrape.json' },
            { Key: 'scrapes/site-id/scrape.json' },
          ],
        };

        const page1Response = {
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                tags: {
                  title: 'Test Page',
                  description: '',
                },
              },
            }),
          },
          ContentType: 'application/json',
        };

        const page2Response = {
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                tags: {
                  title: 'Test Page',
                  h1: [
                    'This is a dummy H1 that is intentionally made to be overly lengthy from SEO perspective',
                  ],
                },
              },
            }),
          },
          ContentType: 'application/json',
        };

        const page3Response = {
          Body: {
            transformToString: () => JSON.stringify({
            }),
          },
          ContentType: 'application/json',
        };

        const homePageResponse = {
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: 'http://example.com/site-id/',
              scrapeResult: {
                tags: {
                  title: 'Home Page',
                  description: 'Home page description',
                },
              },
            }),
          },
          ContentType: 'application/json',
        };

        const scrapeResultPaths = new Map([
          ['https://www.test-site.com/blog/page1', 'scrapes/site-id/blog/page1/scrape.json'],
          ['https://www.test-site.com/blog/page2', 'scrapes/site-id/blog/page2/scrape.json'],
          ['https://www.test-site.com/blog/page3', 'scrapes/site-id/blog/page3/scrape.json'],
          ['https://www.test-site.com/', 'scrapes/site-id/scrape.json'],
        ]);

        // Setup S3 client responses
        s3ClientStub.send = sinon.stub();
        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
          .resolves(listObjectsResponse);

        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
            Bucket: 'test-bucket',
            Key: 'scrapes/site-id/blog/page1/scrape.json',
          })))
          .resolves(page1Response);

        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
            Bucket: 'test-bucket',
            Key: 'scrapes/site-id/blog/page2/scrape.json',
          })))
          .resolves(page2Response);

        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
            Bucket: 'test-bucket',
            Key: 'scrapes/site-id/blog/page3/scrape.json',
          })))
          .resolves(page3Response);

        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
            Bucket: 'test-bucket',
            Key: 'scrapes/site-id/scrape.json',
          })))
          .resolves(homePageResponse);

        context = {
          site,
          audit,
          finalUrl: 'http://example.com',
          log: logStub,
          s3Client: s3ClientStub,
          dataAccess: dataAccessStub,
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
          scrapeResultPaths,
        };
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should successfully run audit and generate suggestions', async () => {
        const mockGetRUMDomainkey = sinon.stub()
          .resolves('mockedDomainKey');
        const mockCalculateCPCValue = sinon.stub()
          .resolves(5000);
        const auditStub = await esmock('../../src/metatags/handler.js', {
          '../../src/support/utils.js': {
            getRUMDomainkey: mockGetRUMDomainkey,
            calculateCPCValue: mockCalculateCPCValue,
          },
          '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
          '../../src/common/index.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
          '../../src/metatags/metatags-auto-suggest.js': sinon.stub()
            .resolves({
              '/blog/page1': {
                title: {
                  aiSuggestion: 'AI Suggested Title 1',
                  aiRationale: 'AI Rationale 1',
                },
              },
              '/blog/page2': {
                title: {
                  aiSuggestion: 'AI Suggested Title 2',
                  aiRationale: 'AI Rationale 2',
                },
              },
            }),
        });
        const result = await auditStub.runAuditAndGenerateSuggestions(context);

        expect(result)
          .to
          .deep
          .equal({ status: 'complete' });
        expect(s3ClientStub.send).to.have.been.called;
        expect(metatagsOppty.save).to.have.been.called;
      });

      it('should handle case when no tags are extracted', async () => {
        const mockGetRUMDomainkey = sinon.stub()
          .resolves('mockedDomainKey');
        const mockCalculateCPCValue = sinon.stub()
          .resolves(2);
        const auditStub = await esmock('../../src/metatags/handler.js', {
          '../../src/support/utils.js': {
            getRUMDomainkey: mockGetRUMDomainkey,
            calculateCPCValue: mockCalculateCPCValue,
          },
          '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
          '../../src/common/index.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
          '../../src/metatags/metatags-auto-suggest.js': sinon.stub()
            .resolves({}),
        });

        // Override all S3 responses to have null tags
        s3ClientStub.send
          .withArgs(sinon.match.instanceOf(GetObjectCommand))
          .returns({
            Body: {
              transformToString: () => JSON.stringify({
                scrapeResult: {
                  tags: null,
                },
              }),
            },
            ContentType: 'application/json',
          });

        const result = await auditStub.runAuditAndGenerateSuggestions(context);

        expect(result)
          .to
          .deep
          .equal({ status: 'complete' });
        expect(logStub.error)
          .to
          .have
          .been
          .calledWith('No Scraped tags found in S3 scrapes/site-id/blog/page3/scrape.json object');
        expect(logStub.error)
          .to
          .have
          .been
          .calledWith('Failed to extract tags from scraped content for bucket test-bucket');
      })
        .timeout(10000);

      it('should handle RUM API errors gracefully', async () => {
        const mockGetRUMDomainkey = sinon.stub()
          .resolves('mockedDomainKey');
        const mockCalculateCPCValue = sinon.stub()
          .resolves(2);
        const auditStub = await esmock('../../src/metatags/handler.js', {
          '../../src/support/utils.js': {
            getRUMDomainkey:
            mockGetRUMDomainkey,
            calculateCPCValue: mockCalculateCPCValue,
          },
          '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
          '../../src/common/index.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
          '../../src/metatags/metatags-auto-suggest.js': sinon.stub()
            .resolves({}),
        });
        // Override RUM API response to simulate error
        RUMAPIClientStub.createFrom()
          .query
          .rejects(new Error('RUM API Error'));

        const result = await auditStub.runAuditAndGenerateSuggestions(context);

        expect(result)
          .to
          .deep
          .equal({ status: 'complete' });
        expect(logStub.warn)
          .to
          .have
          .been
          .calledWith('Error while calculating projected traffic for site-id', sinon.match.instanceOf(Error));
      });

      it('should submit top pages for scraping when getIncludedURLs returns null', async () => {
        const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
        const mockCalculateCPCValue = sinon.stub().resolves(2);
        const getConfigStub = sinon.stub().returns({
          getIncludedURLs: sinon.stub().returns(null),
        });
        context.site.getConfig = getConfigStub;
        const auditStub = await esmock('../../src/metatags/handler.js', {
          '../../src/support/utils.js': {
            getRUMDomainkey:
            mockGetRUMDomainkey,
            calculateCPCValue: mockCalculateCPCValue,
          },
          '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
          '../../src/common/index.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
          '../../src/metatags/metatags-auto-suggest.js': sinon.stub().resolves({}),
        });
        const result = await auditStub.runAuditAndGenerateSuggestions(context);
        expect(result).to.deep.equal({ status: 'complete' });
      });
    });

    describe('removeTrailingSlash', () => {
      it('should remove trailing slash from URL', () => {
        const url = 'http://example.com/';
        const result = removeTrailingSlash(url);
        expect(result).to.equal('http://example.com');
      });

      it('should not modify URL without trailing slash', () => {
        const url = 'http://example.com';
        const result = removeTrailingSlash(url);
        expect(result).to.equal(url);
      });

      it('should handle empty string', () => {
        const url = '';
        const result = removeTrailingSlash(url);
        expect(result).to.equal('');
      });
    });

    describe('getBaseUrl', () => {
      it('should extract base URL from valid URL when useHostnameOnly is true', () => {
        const url = 'https://example.com/path/to/page?query=1';
        const result = getBaseUrl(url, true);
        expect(result).to.equal('https://example.com');
      });

      it('should preserve port numbers in URLs when useHostnameOnly is true', () => {
        const url = 'https://example.com:8080/path/';
        const result = getBaseUrl(url, true);
        expect(result).to.equal('https://example.com:8080');
      });

      it('should preserve port numbers for localhost when useHostnameOnly is true', () => {
        const url = 'http://localhost:8080/foo';
        const result = getBaseUrl(url, true);
        expect(result).to.equal('http://localhost:8080');
      });

      it('should preserve full path by default', () => {
        const url = 'http://localhost:8080/foo/bar';
        const result = getBaseUrl(url);
        expect(result).to.equal('http://localhost:8080/foo/bar');
      });

      it('should handle malformed URLs by removing trailing slash when useHostnameOnly is true', () => {
        const url = 'malformed-url.com/path/';
        const result = getBaseUrl(url, true);
        expect(result).to.equal('malformed-url.com/path');
      });

      it('should handle malformed URLs by removing trailing slash', () => {
        const url = 'malformed-url.com/path/';
        const result = getBaseUrl(url);
        expect(result).to.equal('malformed-url.com/path');
      });
    });

    describe('metatagsAutoSuggest', () => {
      let metatagsAutoSuggest;
      let s3Client;
      let dataAccess;
      let log;
      let Configuration;
      let getPresignedUrlStub;
      let genvarClientStub;
      let siteStub;
      let allTags;

      beforeEach(async () => {
        s3Client = {};
        log = {
          info: sinon.stub(),
          error: sinon.stub(),
          warn: sinon.stub(),
          debug: sinon.stub(),
        };
        Configuration = {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: sinon.stub().returns(true),
          }),
        };
        dataAccess = { Configuration };
        genvarClientStub = {
          generateSuggestions: sinon.stub().resolves({
            '/about-us': {
              h1: {
                aiRationale: 'The H1 tag is catchy and broad...',
                aiSuggestion: 'Our Story: Innovating Comfort for Every Home',
              },
            },
            '/add-on-and-refresh': {
              description: {
                aiRationale: 'The description emphasizes the brand\'s core values...',
                aiSuggestion: 'Elevate your home with Lovesac\'s customizable add-ons...',
              },
              h1: {
                aiRationale: 'The H1 tag is catchy and directly addresses the user\'s intent...',
                aiSuggestion: 'Revitalize Your Home with Lovesac Add-Ons',
              },
            },
          }),
        };
        context = {
          s3Client,
          dataAccess,
          log,
          env: {
            GENVARHOST: 'https://genvar.endpoint',
            GENVAR_IMS_ORG_ID: 'test-org-id',
          },
        };
        allTags = {
          detectedTags: {
            '/about-us': { h1: {} },
            '/add-on-and-refresh': { description: {}, h1: {} },
          },
          extractedTags: {
            '/about-us': { s3key: 'about-us-key' },
            '/add-on-and-refresh': { s3key: 'add-on-key' },
          },
          healthyTags: {},
        };

        metatagsAutoSuggest = await esmock('../../src/metatags/metatags-auto-suggest.js', {
          '@adobe/spacecat-shared-gpt-client': {
            GenvarClient: {
              createFrom: () => genvarClientStub,
            },
          },
          '@aws-sdk/s3-request-presigner': { getSignedUrl: getPresignedUrlStub },
        });
        siteStub = {
          getBaseURL: sinon.stub().returns('https://example.com'),
        };
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should handle disabled handler for site', async () => {
        Configuration.findLatest.resolves({
          isHandlerEnabledForSite: sinon.stub().returns(false),
        });
        await metatagsAutoSuggest(allTags, context, siteStub);
        expect(log.info.calledWith('Metatags auto-suggest is disabled for site')).to.be.true;
      });

      it('should handle missing Genvar endpoint', async () => {
        context.env.GENVAR_HOST = '';
        try {
          await metatagsAutoSuggest(allTags, context, siteStub);
        } catch (error) {
          expect(error.message).to.equal('Metatags Auto-suggest failed: Missing Genvar endpoint or genvar ims orgId');
        }
      });

      it('should handle missing genvar ims orgId', async () => {
        context.env.GENVAR_IMS_ORG_ID = '';

        try {
          await metatagsAutoSuggest(allTags, context, siteStub);
        } catch (error) {
          expect(error.message).to.equal('Metatags Auto-suggest failed: Missing Genvar endpoint or genvar ims orgId1');
        }
      });

      it('should generate presigned URLs and call Genvar API', async () => {
        genvarClientStub.generateSuggestions.resolves({
          '/about-us': {
            h1: {
              aiRationale: 'The H1 tag is catchy and broad...',
              aiSuggestion: 'Our Story: Innovating Comfort for Every Home',
            },
          },
          '/add-on-and-refresh': {
            description: {
              aiRationale: 'The description emphasizes the brand\'s core values...',
              aiSuggestion: 'Elevate your home with Lovesac\'s customizable add-ons...',
            },
            h1: {
              aiRationale: 'The H1 tag is catchy and directly addresses the user\'s intent...',
              aiSuggestion: 'Revitalize Your Home with Lovesac Add-Ons',
            },
          },
        });

        const response = await metatagsAutoSuggest(allTags, context, siteStub);

        expect(log.debug.calledWith('Generated presigned URLs')).to.be.true;
        expect(log.info.calledWith('Generated AI suggestions for Meta-tags using Genvar.')).to.be.true;
        expect(response['/about-us'].h1.aiSuggestion).to.equal('Our Story: Innovating Comfort for Every Home');
        expect(response['/add-on-and-refresh'].description.aiSuggestion).to.equal('Elevate your home with Lovesac\'s customizable add-ons...');
        expect(response['/add-on-and-refresh'].h1.aiSuggestion).to.equal('Revitalize Your Home with Lovesac Add-Ons');
      }).timeout(15000);

      it('should log an error and throw if the Genvar API call fails', async () => {
        genvarClientStub.generateSuggestions.throws(new Error('Genvar API failed'));
        let err;
        try {
          await metatagsAutoSuggest(allTags, context, siteStub);
        } catch (error) {
          err = error;
        }
        expect(err.message).to.equal('Genvar API failed');
      });

      it('should log an error and throw if the Genvar API response is invalid', async () => {
        genvarClientStub.generateSuggestions.resolves(5);
        let err;
        try {
          await metatagsAutoSuggest(allTags, context, siteStub);
        } catch (error) {
          err = error;
        }
        expect(err.message).to.equal('Invalid response received from Genvar API: 5');
      });

      it('should handle forceAutoSuggest option set to true', async () => {
        const forceAutoSuggest = true;
        const isHandlerEnabledForSite = sinon.stub().returns(false);
        Configuration.findLatest.resolves({
          isHandlerEnabledForSite,
        });

        await metatagsAutoSuggest(allTags, context, siteStub, {
          forceAutoSuggest,
        });
        expect(isHandlerEnabledForSite).not.to.have.been.called;
        expect(log.info.calledWith('Generated AI suggestions for Meta-tags using Genvar.')).to.be.true;
      });

      it('should handle forceAutoSuggest option set to false', async () => {
        const forceAutoSuggest = false;
        const isHandlerEnabledForSite = sinon.stub().returns(true);
        Configuration.findLatest.resolves({
          isHandlerEnabledForSite,
        });

        await metatagsAutoSuggest(allTags, context, siteStub, {
          forceAutoSuggest,
        });
        expect(isHandlerEnabledForSite).to.have.been.called;
        expect(log.info.calledWith('Generated AI suggestions for Meta-tags using Genvar.')).to.be.true;
      });
    });
  });
});
