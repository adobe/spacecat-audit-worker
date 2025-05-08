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
import { removeTrailingSlash } from '../../src/metatags/opportunity-utils.js';
import { auditMetaTagsRunner, fetchAndProcessPageObject, opportunityAndSuggestions } from '../../src/metatags/handler.js';

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
          findLatest: sinon.stub(),
        },
        Site: {
          findById: sinon.stub().resolves({ getIsLive: sinon.stub().returns(true) }),
        },
        SiteTopPage: {
          allBySiteId: sinon.stub(),
          allBySiteIdAndSourceAndGeo: sinon.stub(),
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
      const latestConfigStub = sinon.stub().resolves({
        isHandlerEnabledForSite: () => false,
      });
      context = {
        log: logStub,
        s3Client: s3ClientStub,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          GENVAR_ENDPOINT: 'test-genvar-url',
          FIREFALL_IMS_ORG_ID: 'test-org@adobe',
        },
        dataAccess: {
          Configuration: {
            findLatest: latestConfigStub,
          },
          SiteTopPage: dataAccessStub.SiteTopPage,
        },
      };
    });

    it('should process site tags and perform SEO checks', async () => {
      const RUMAPIClientStub = {
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
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const metatagsOppty = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
      };
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      const topPages = [
        { getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') },
        { getURL: 'http://example.com/blog/page3', getTopKeyword: sinon.stub().returns('') },
        { getURL: 'http://example.com/', getTopKeyword: sinon.stub().returns('Home') },
      ];
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.Opportunity = {
        allBySiteIdAndStatus: sinon.stub().returns([metatagsOppty]),
      };
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
            { Key: 'scrapes/site-id/blog/page3/scrape.json' },
            { Key: 'scrapes/site-id/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
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
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page2/scrape.json',
        }))).returns({
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
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page3/scrape.json',
        }))).returns({
          Body: {
            transformToString: () => JSON.stringify({
            }),
          },
          ContentType: 'application/json',
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/scrape.json',
        }))).returns({
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
        });

      const addAuditStub = sinon.stub().resolves({ getId: () => 'audit-id' });
      dataAccessStub.Audit.create = await addAuditStub();
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
        '@adobe/spacecat-shared-data-access': dataAccessStub,
      });
      const auditInstance = auditStub.default;
      await auditInstance.runner('http://example.com', context, site);

      const result = await fetchAndProcessPageObject(s3ClientStub, 'test-bucket', 'scrapes/site-id/blog/page3/scrape.json', 'scrapes/site-id/', logStub);
      expect(logStub.error).to.have.been.calledWith('No Scraped tags found in S3 scrapes/site-id/blog/page3/scrape.json object');
      expect(result).to.be.null;

      expect(addAuditStub.calledWithMatch({
        '/blog/page1': {
          h1: {
            seoImpact: 'High',
            issue: 'Missing H1',
            issueDetails: 'H1 tag is missing',
            seoRecommendation: 'Should be present',
          },
          title: {
            tagContent: 'Test Page',
            seoImpact: 'High',
            issue: 'Duplicate Title',
            issueDetails: '2 pages share same title',
            seoRecommendation: 'Unique across pages',
          },
          description: {
            tagContent: '',
            seoImpact: 'High',
            issue: 'Empty Description',
            issueDetails: 'Description tag is empty',
            seoRecommendation: '140-160 characters long',
          },
        },
        '/blog/page2': {
          description: {
            seoImpact: 'High',
            issue: 'Missing Description',
            issueDetails: 'Description tag is missing',
            seoRecommendation: 'Should be present',
          },
          title: {
            tagContent: 'Test Page',
            seoImpact: 'High',
            issue: 'Duplicate Title',
            issueDetails: '2 pages share same title',
            seoRecommendation: 'Unique across pages',
          },
          h1: {
            tagContent: 'This is a dummy H1 that is intentionally made to be overly lengthy from SEO perspective',
            seoImpact: 'Moderate',
            issue: 'H1 too long',
            issueDetails: '17 chars over limit',
            seoRecommendation: 'Below 70 characters',
          },
        },
        '/': {
          title: {
            tagContent: 'Home Page',
            seoImpact: 'High',
            issue: 'Duplicate Title',
            issueDetails: '2 pages share same title',
            seoRecommendation: 'Unique across pages',
          },
          description: {
            tagContent: 'Home page description',
            seoImpact: 'High',
            issue: 'Duplicate Description',
            issueDetails: '2 pages share same description',
            seoRecommendation: 'Unique across pages',
          },
        },
      }));
      expect(addAuditStub.calledOnce).to.be.true;
      expect(logStub.info.callCount).to.equal(6);
    });

    it('should process site tags and perform SEO checks for pages with invalid H1s', async () => {
      const RUMAPIClientStub = {
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
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
      });
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') },
        { getURL: 'http://example.com/', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      const getTopPagesForSiteStub = [
        { getUrl: () => 'http://example.com/blog/page1' },
        {
          getUrl: () => 'http://example.com/blog/page2',
        },
        {
          getUrl: () => 'http://example.com/',
        },
      ];
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(getTopPagesForSiteStub);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
            { Key: 'scrapes/site-id/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: 'https://example.com/blog/page1/',
              scrapeResult: {
                tags: {
                  title: 'This is an SEO optimal page1 valid title.',
                  description: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
                  h1: [
                    'This is an overly long H1 tag from SEO perspective due to its length exceeding 60 chars',
                    'This is second h1 tag on same page',
                  ],
                },
              },
            }),
          },
          ContentType: 'application/json',
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page2/scrape.json',
        }))).returns({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                tags: {
                  title: 'This is a SEO wise optimised page2 title.',
                  description: 'This is a dummy description that is optimal from SEO perspective for page2. It has the correct length of characters, and is unique across all pages.',
                  h1: [
                    'This is also an overly long H1 tag from SEO perspective due to its length exceeding 60 chars',
                  ],
                },
              },
            }),
          },
          ContentType: 'application/json',
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/scrape.json',
        }))).returns({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                tags: {
                  title: 'This is an SEO optimal page1 valid title.',
                  description: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
                  h1: undefined,
                },
              },
            }),
          },
          ContentType: 'application/json',
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.Audit.create = await addAuditStub();

      const auditInstance = auditStub.default;
      await auditInstance.runner('http://example.com', context, site);
      await fetchAndProcessPageObject(s3ClientStub, 'test-bucket', 'scrapes/site-id/blog/page1/scrape.json', 'scrapes/site-id/', sinon.stub());

      expect(addAuditStub.calledWithMatch({
        '/blog/page1': {
          h1: {
            tagContent: '["This is an overly long H1 tag from SEO perspective due to its length exceeding 60 chars","This is second h1 tag on same page"]',
            seoImpact: 'Moderate',
            issue: 'Multiple H1 on page',
            issueDetails: '2 H1 detected',
            seoRecommendation: '1 H1 on a page',
          },
          title: {
            tagContent: 'This is an SEO optimal page1 valid title.',
            seoImpact: 'High',
            issue: 'Duplicate Title',
            issueDetails: '2 pages share same title',
            seoRecommendation: 'Unique across pages',
          },
          description: {
            tagContent: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
            seoImpact: 'High',
            issue: 'Duplicate Description',
            issueDetails: '2 pages share same description',
            seoRecommendation: 'Unique across pages',
          },
        },
        '/blog/page2': {
          h1: {
            tagContent: 'This is also an overly long H1 tag from SEO perspective due to its length exceeding 60 chars',
            seoImpact: 'Moderate',
            issue: 'H1 too long',
            issueDetails: '22 chars over limit',
            seoRecommendation: 'Below 70 characters',
          },
        },
        '/': {
          h1: {
            seoImpact: 'High',
            issue: 'Missing H1',
            issueDetails: 'H1 tag is missing',
            seoRecommendation: 'Should be present',
          },
          title: {
            tagContent: 'This is an SEO optimal page1 valid title.',
            seoImpact: 'High',
            issue: 'Duplicate Title',
            issueDetails: '2 pages share same title',
            seoRecommendation: 'Unique across pages',
          },
          description: {
            tagContent: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
            seoImpact: 'High',
            issue: 'Duplicate Description',
            issueDetails: '2 pages share same description',
            seoRecommendation: 'Unique across pages',
          },
        },
      }));
      expect(addAuditStub.calledOnce).to.be.true;
      expect(logStub.info.callCount).to.equal(7);
    });

    it('should handle gracefully if S3 object has no rawbody', async () => {
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') }];

      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
          Body: {
            transformToString: () => '',
          },
          ContentType: 'application/json',
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

      auditMetaTagsRunner('http://example.com', { log: sinon.stub(), s3Client: s3ClientStub }, { getId: () => 'site-id' });
      fetchAndProcessPageObject(s3ClientStub, 'test-bucket', 'scrapes/site-id/blog/page1/scrape.json', 'scrapes/site-id/', sinon.stub());

      expect(addAuditStub.calledOnce).to.be.false;
    });

    it('should handle gracefully if S3 tags object is not valid', async () => {
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'page1/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .returns({
          Body: {
            transformToString: () => JSON.stringify({
              scrapeResult: {
                tags: 5,
              },
            }),
          },
          ContentType: 'application/json',
        });

      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const RUMAPIClientStub = {
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
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
      });
      const auditInstance = auditStub.default;
      await auditInstance.runner('http://example.com', context, site);
      expect(logStub.error).to.have.been.calledWith('Failed to extract tags from scraped content for bucket test-bucket and prefix scrapes/site-id/');
    });

    it('should handle gracefully if Rum throws error', async () => {
      const RUMAPIClientStub = {
        createFrom: sinon.stub().returns({
          query: sinon.stub().throws(new Error('RUM not available')),
        }),
      };
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const metatagsOppty = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
      };
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.Opportunity = {
        allBySiteIdAndStatus: sinon.stub().returns([metatagsOppty]),
      };
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
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
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page2/scrape.json',
        }))).returns({
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
        });
      const addAuditStub = sinon.stub().resolves({ getId: () => 'audit-id' });
      dataAccessStub.Audit.create = addAuditStub;
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
      });
      const auditInstance = auditStub.default;
      await auditInstance.runner('http://example.com', context, site);
      expect(addAuditStub.calledWithMatch({
        auditResult: {
          detectedTags: {
            '/blog/page1': {
              h1: {
                seoImpact: 'High',
                issue: 'Missing H1',
                issueDetails: 'H1 tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
                duplicates: [
                  '/blog/page2',
                ],
              },
              description: {
                tagContent: '',
                seoImpact: 'High',
                issue: 'Empty Description',
                issueDetails: 'Description tag is empty',
                seoRecommendation: '140-160 characters long',
              },
            },
            '/blog/page2': {
              description: {
                seoImpact: 'High',
                issue: 'Missing Description',
                issueDetails: 'Description tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
                duplicates: [
                  '/blog/page1',
                ],
              },
              h1: {
                tagContent: 'This is a dummy H1 that is intentionally made to be overly lengthy from SEO perspective',
                seoImpact: 'Moderate',
                issue: 'H1 too long',
                issueDetails: '17 chars over limit',
                seoRecommendation: 'Below 70 characters',
              },
            },
          },
        },
      }));
    });

    it('should skip updating projected traffic if value less than 500', async () => {
      const RUMAPIClientStub = {
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
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const metatagsOppty = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
      };
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.Opportunity = {
        allBySiteIdAndStatus: sinon.stub().returns([metatagsOppty]),
      };
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
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
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page2/scrape.json',
        }))).returns({
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
        });
      const getTopPagesForSiteStub = [
        { getUrl: () => 'http://example.com/blog/page1' },
        {
          getUrl: () => 'http://example.com/blog/page2',
        },
        {
          getUrl: () => 'http://example.com/',
        },
      ];
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(getTopPagesForSiteStub);
      const addAuditStub = sinon.stub().resolves({ getId: () => 'audit-id' });
      dataAccessStub.Audit.create = addAuditStub;
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
      });
      const auditInstance = auditStub.default;
      const response = await auditInstance.runner('http://example.com', context, site);
      expect(response).to.deep.equal({
        auditResult: {
          detectedTags: {
            '/blog/page1': {
              h1: {
                seoImpact: 'High',
                issue: 'Missing H1',
                issueDetails: 'H1 tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
              },
              description: {
                seoImpact: 'High',
                issue: 'Empty Description',
                issueDetails: 'Description tag is empty',
                seoRecommendation: '140-160 characters long',
              },
            },
            '/blog/page2': {
              description: {
                seoImpact: 'High',
                issue: 'Missing Description',
                issueDetails: 'Description tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
              },
              h1: {
                tagContent: 'This is a dummy H1 that is intentionally made to be overly lengthy from SEO perspective',
                seoImpact: 'Moderate',
                issue: 'H1 too long',
                issueDetails: '17 chars over limit',
                seoRecommendation: 'Below 70 characters',
              },
            },
          },
          finalUrl: 'http://example.com',
          fullAuditRef: '',
          sourceS3Folder: 'test-bucket/scrapes/site-id/',
        },
        fullAuditRef: 'http://example.com',
      });
    }).timeout(5000);

    it('should calculate projected traffic for detected tags', async () => {
      const RUMAPIClientStub = {
        createFrom: sinon.stub().returns({
          query: sinon.stub().resolves([
            {
              url: 'http://example.com/blog/page1',
              total: 100,
              earned: 50000,
              owned: 70,
              paid: 10000,
            },
          ]),
        }),
      };
      const mockGetRUMDomainkey = sinon.stub().resolves('mockedDomainKey');
      const metatagsOppty = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
      };
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.Opportunity = {
        allBySiteIdAndStatus: sinon.stub().returns([metatagsOppty]),
      };
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1/scrape.json',
        }))).returns({
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
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page2/scrape.json',
        }))).returns({
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
        });
      const getTopPagesForSiteStub = [
        { getUrl: () => 'http://example.com/blog/page1' },
        {
          getUrl: () => 'http://example.com/blog/page2',
        },
        {
          getUrl: () => 'http://example.com/',
        },
      ];
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);
      dataAccessStub.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(getTopPagesForSiteStub);
      const addAuditStub = sinon.stub().resolves({ getId: () => 'audit-id' });
      dataAccessStub.Audit.create = addAuditStub;
      const mockCalculateCPCValue = sinon.stub().resolves(2);
      const auditStub = await esmock('../../src/metatags/handler.js', {
        '../../src/support/utils.js': { getRUMDomainkey: mockGetRUMDomainkey, calculateCPCValue: mockCalculateCPCValue },
        '@adobe/spacecat-shared-rum-api-client': RUMAPIClientStub,
      });
      const auditInstance = auditStub.default;
      const response = await auditInstance.runner('http://example.com', context, site);
      expect(response).to.deep.equal({
        auditResult: {
          projectedTrafficValue: 2400,
          projectedTrafficLost: 1200,
          detectedTags: {
            '/blog/page1': {
              h1: {
                seoImpact: 'High',
                issue: 'Missing H1',
                issueDetails: 'H1 tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
              },
              description: {
                seoImpact: 'High',
                issue: 'Empty Description',
                issueDetails: 'Description tag is empty',
                seoRecommendation: '140-160 characters long',
              },
            },
            '/blog/page2': {
              description: {
                seoImpact: 'High',
                issue: 'Missing Description',
                issueDetails: 'Description tag is missing',
                seoRecommendation: 'Should be present',
              },
              title: {
                tagContent: 'Test Page',
                seoImpact: 'High',
                issue: 'Duplicate Title',
                issueDetails: '2 pages share same title',
                seoRecommendation: 'Unique across pages',
              },
              h1: {
                tagContent: 'This is a dummy H1 that is intentionally made to be overly lengthy from SEO perspective',
                seoImpact: 'Moderate',
                issue: 'H1 too long',
                issueDetails: '17 chars over limit',
                seoRecommendation: 'Below 70 characters',
              },
            },
          },
          finalUrl: 'http://example.com',
          fullAuditRef: '',
          sourceS3Folder: 'test-bucket/scrapes/site-id/',
        },
        fullAuditRef: 'http://example.com',
      });
    }).timeout(5000);
  });

  describe('opportunities handler method', () => {
    let logStub;
    let dataAccessStub;
    let auditData;
    let auditUrl;
    let opportunity;
    let context;

    beforeEach(() => {
      sinon.restore();
      auditUrl = 'https://example.com';
      opportunity = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns(testData.existingSuggestions),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
        setData: () => {},
        getData: () => {},
      };
      logStub = {
        info: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
      };
      dataAccessStub = {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().resolves([]),
          create: sinon.stub(),
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

  describe('metatagsAutoSuggest', () => {
    let metatagsAutoSuggest;
    let context;
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
        '@adobe/spacecat-shared-gpt-client': { GenvarClient: { createFrom: () => genvarClientStub } },
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
  });
});
