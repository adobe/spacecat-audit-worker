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
import {
  ok,
  noContent,
  notFound,
  internalServerError,
} from '@adobe/spacecat-shared-http-utils';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  TITLE, DESCRIPTION, H1, SEO_IMPACT, HIGH, MODERATE, ISSUE,
  SEO_RECOMMENDATION, MULTIPLE_H1_ON_PAGE, SHOULD_BE_PRESENT, TAG_LENGTHS, ONE_H1_ON_A_PAGE,
} from '../../src/metatags/constants.js';
import SeoChecks from '../../src/metatags/seo-checks.js';
import auditMetaTags from '../../src/metatags/handler.js';
import syncOpportunityAndSuggestions from '../../src/metatags/opportunityHandler.js';
import testData from '../fixtures/meta-tags-data.js';

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
          [H1]: ['Heading 1', 'Heading 2'], // Multiple H1 tags
        };

        seoChecks.performChecks(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url][TITLE][ISSUE]).to.equal('Empty Title');
        expect(detectedTags[url][H1][ISSUE]).to.equal(MULTIPLE_H1_ON_PAGE);
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
    let message;
    let context;
    let logStub;
    let dataAccessStub;
    let s3ClientStub;

    beforeEach(() => {
      sinon.restore();
      message = { type: 'seo', url: 'site-id' };
      logStub = { info: sinon.stub(), error: sinon.stub(), warn: sinon.stub() };
      dataAccessStub = {
        Audit: {
          create: sinon.stub(),
        },
        Configuration: {
          findLatest: sinon.stub(),
        },
        Site: {
          findById: sinon.stub().resolves({ getIsLive: sinon.stub().returns(true) }),
        },
        SiteTopPage: {
          allBySiteId: sinon.stub(),
        },
      };
      s3ClientStub = {
        send: sinon.stub(),
        getObject: sinon.stub(),
      };

      context = {
        log: logStub,
        dataAccess: dataAccessStub,
        s3Client: s3ClientStub,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };
    });

    it('should return notFound if site is not found', async () => {
      dataAccessStub.Site.findById.resolves(null);

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site not found')));
      expect(logStub.info.calledOnce).to.be.true;
    });

    it('should return ok if site is not live', async () => {
      dataAccessStub.Site.findById.resolves({ getIsLive: sinon.stub().returns(false) });

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(ok()));
      expect(logStub.info.calledTwice).to.be.true;
    });

    it('should return ok if audit type is disabled for site', async () => {
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(false),
      });
      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(ok()));
      expect(logStub.info.calledTwice).to.be.true;
    });

    it('should return notFound if extracted tags are not available', async () => {
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      s3ClientStub.send.returns([]);

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(logStub.error.calledOnce).to.be.true;
    });

    it('should process site tags and perform SEO checks', async () => {
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

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(noContent()));
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
      }));
      expect(addAuditStub.calledOnce).to.be.true;
      expect(logStub.info.callCount).to.equal(6);
    }).timeout(3000);

    it('should process site tags and perform SEO checks for pages with invalid H1s', async () => {
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
                  h1: [],
                },
              },
            }),
          },
          ContentType: 'application/json',
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.Audit.create = addAuditStub;

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(noContent()));
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
            duplicates: [
              '/',
            ],
          },
          description: {
            tagContent: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
            seoImpact: 'High',
            issue: 'Duplicate Description',
            issueDetails: '2 pages share same description',
            seoRecommendation: 'Unique across pages',
            duplicates: [
              '/',
            ],
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
            duplicates: [
              '/blog/page1',
            ],
          },
          description: {
            tagContent: 'This is a dummy description that is optimal from SEO perspective for page1. It has the correct length of characters, and is unique across all pages.',
            seoImpact: 'High',
            issue: 'Duplicate Description',
            issueDetails: '2 pages share same description',
            seoRecommendation: 'Unique across pages',
            duplicates: [
              '/blog/page1',
            ],
          },
        },
      }));
      expect(addAuditStub.calledOnce).to.be.true;
      expect(logStub.info.callCount).to.equal(4);
    });

    it('should handle errors and return internalServerError', async () => {
      dataAccessStub.Site.findById.withArgs('test-site').rejects(new Error('Some error'));
      delete message.url;
      message.siteId = 'test-site';
      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(internalServerError('Internal server error: Some error')));
      expect(logStub.error.calledOnce).to.be.true;
    });

    it('should handle gracefully if S3 object has no rawbody', async () => {
      const site = {
        getIsLive: sinon.stub().returns(true),
        getId: sinon.stub().returns('site-id'),
        getBaseURL: sinon.stub().returns('http://example.com'),
      };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') }];

      dataAccessStub.Site.findById.resolves(site);
      dataAccessStub.Configuration.findLatest.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.SiteTopPage.allBySiteId.resolves(topPages);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page1.json' },
          ],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Key: 'scrapes/site-id/blog/page1.json',
        }))).returns({
          Body: {
            transformToString: () => '',
          },
          ContentType: 'application/json',
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(addAuditStub.calledOnce).to.be.false;
      expect(logStub.error.calledThrice).to.be.true;
    });

    it('should handle gracefully if S3 tags object is not valid', async () => {
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

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: 'test-bucket',
          Prefix: 'scrapes/site-id/',
          MaxKeys: 1000,
        })))
        .resolves({
          Contents: [
            { Key: 'page1.json' },
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
      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(logStub.error.calledTwice).to.be.true;
    });
  });

  describe('opportunities handler method', () => {
    let siteId;
    let auditId;
    let auditData;
    let logStub;
    let dataAccessStub;
    let metatagsOppty;

    beforeEach(() => {
      sinon.restore();
      siteId = 'site-id';
      auditId = 'audit-id';
      logStub = {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      };
      metatagsOppty = {
        getId: () => 'opportunity-id',
        setAuditId: sinon.stub(),
        save: sinon.stub(),
        getSuggestions: sinon.stub().returns([]),
        addSuggestions: sinon.stub().returns({ errorItems: [], createdItems: [1, 2, 3] }),
        getType: () => 'meta-tags',
      };
      dataAccessStub = {
        Opportunity: {
          allBySiteIdAndStatus: sinon.stub().returns([metatagsOppty]),
        },
      };
      auditData = testData.auditData;
    });

    it('should create new opportunity and add suggestions', async () => {
      metatagsOppty.getType = () => 'backlinks';
      dataAccessStub.Opportunity.create = sinon.stub().returns(metatagsOppty);
      await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      expect(dataAccessStub.Opportunity.create).to.be.calledWith(testData.opportunityData);
      expect(metatagsOppty.addSuggestions).to.be.calledWith(testData.expectedSuggestions);
      expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
    });

    it('should use existing opportunity and add suggestions', async () => {
      await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      expect(metatagsOppty.save).to.be.calledOnce;
      expect(metatagsOppty.addSuggestions).to.be.calledWith(testData.expectedSuggestions);
      expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
    });

    it('should throw error if fetching opportunity fails', async () => {
      dataAccessStub.Opportunity.allBySiteIdAndStatus.rejects(new Error('some-error'));
      try {
        await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      } catch (err) {
        expect(err.message).to.equal('Failed to fetch opportunities for siteId site-id: some-error');
      }
      expect(logStub.error).to.be.calledWith('Fetching opportunities for siteId site-id failed with error: some-error');
    });

    it('should throw error if creating opportunity fails', async () => {
      dataAccessStub.Opportunity.allBySiteIdAndStatus.returns([]);
      dataAccessStub.Opportunity.create = sinon.stub().rejects(new Error('some-error'));
      try {
        await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      } catch (err) {
        expect(err.message).to.equal('Failed to create meta-tags opportunity for siteId site-id: some-error');
      }
      expect(logStub.error).to.be.calledWith('Creating meta-tags opportunity for siteId site-id failed with error: some-error');
    });

    it('should sync existing suggestions with new suggestions', async () => {
      metatagsOppty.getSuggestions.returns(testData.existingSuggestions);
      await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      expect(metatagsOppty.save).to.be.calledOnce;
      expect(metatagsOppty.addSuggestions).to.be.calledWith(testData.expectedSyncedSuggestion);
      expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
    });

    it('should throw error if suggestions fail to create', async () => {
      metatagsOppty.getSiteId = () => 'site-id';
      metatagsOppty.addSuggestions = sinon.stub().returns({ errorItems: [{ item: 1, error: 'some-error' }], createdItems: [] });
      try {
        await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      } catch (err) {
        expect(err.message).to.equal('Failed to create suggestions for siteId site-id');
      }
      expect(metatagsOppty.save).to.be.calledOnce;
      expect(metatagsOppty.addSuggestions).to.be.calledWith(testData.expectedSuggestions);
      expect(logStub.error).to.be.calledWith('Suggestions for siteId site-id contains 1 items with errors');
      expect(logStub.error).to.be.calledTwice;
    });

    it('should take rank as -1 if issue is not known', async () => {
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
      await syncOpportunityAndSuggestions(siteId, auditId, auditData, dataAccessStub, logStub);
      expect(metatagsOppty.save).to.be.calledOnce;
      expect(metatagsOppty.addSuggestions).to.be.calledWith(expectedSuggestionModified);
      expect(logStub.info).to.be.calledWith('Successfully synced Opportunity And Suggestions for site: site-id and meta-tags audit type.');
    });
  });
});
