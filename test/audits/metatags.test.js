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
  SEO_RECOMMENDATION, SHOULD_BE_PRESENT, MULTIPLE_H1_ON_PAGE, ONE_H1_ON_A_PAGE,
  TAG_LENGTHS,
} from '../../src/metatags/constants.js';
import SeoChecks from '../../src/metatags/seo-checks.js';
import auditMetaTags from '../../src/metatags/handler.js';

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
        const pageTags = { [H1]: ['Heading 1', 'Heading 2'] }; // Simulating multiple H1 tags

        seoChecks.checkForH1Count(url, pageTags);

        expect(seoChecks.getDetectedTags()[url][H1][ISSUE]).to.equal(MULTIPLE_H1_ON_PAGE);
        expect(seoChecks.getDetectedTags()[url][H1][SEO_RECOMMENDATION]).to.equal(ONE_H1_ON_A_PAGE);
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
        getConfiguration: sinon.stub(),
        getTopPagesForSite: sinon.stub(),
        addAudit: sinon.stub(),
        retrieveSiteBySiteId: sinon.stub(),
        getSiteByID: sinon.stub().resolves({ isLive: sinon.stub().returns(true) }),
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
      dataAccessStub.getSiteByID.resolves(null);

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site not found')));
      expect(logStub.info.calledOnce).to.be.true;
    });

    it('should return ok if site is not live', async () => {
      dataAccessStub.getSiteByID.resolves({ isLive: sinon.stub().returns(false) });

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(ok()));
      expect(logStub.info.calledTwice).to.be.true;
    });

    it('should return ok if audit type is disabled for site', async () => {
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(false),
      });
      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(ok()));
      expect(logStub.info.calledTwice).to.be.true;
    });

    it('should return notFound if extracted tags are not available', async () => {
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      s3ClientStub.send.returns([]);

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(logStub.error.calledOnce).to.be.true;
    });

    it('should process site tags and perform SEO checks', async () => {
      const site = { isLive: sinon.stub().returns(true), getId: sinon.stub().returns('site-id') };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.getSiteByID.resolves(site);
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.getTopPagesForSite.resolves(topPages);

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
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

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
      expect(logStub.info.callCount).to.equal(4);
    });

    it('should process site tags and perform SEO checks for pages with invalid H1s', async () => {
      const site = { isLive: sinon.stub().returns(true), getId: sinon.stub().returns('site-id') };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') },
        { getURL: 'http://example.com/', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.getSiteByID.resolves(site);
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.getTopPagesForSite.resolves(topPages);

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
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

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
      dataAccessStub.getSiteByID.rejects(new Error('Some error'));

      const result = await auditMetaTags(message, context);
      expect(JSON.stringify(result)).to.equal(JSON.stringify(internalServerError('Internal server error: Some error')));
      expect(logStub.error.calledOnce).to.be.true;
    });

    it('should handle gracefully if S3 object has no rawbody', async () => {
      const site = { isLive: sinon.stub().returns(true), getId: sinon.stub().returns('site-id') };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') }];

      dataAccessStub.getSiteByID.resolves(site);
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.getTopPagesForSite.resolves(topPages);

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
        });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(addAuditStub.calledOnce).to.be.false;
      expect(logStub.error.calledThrice).to.be.true;
    });

    it('should handle gracefully if S3 tags object is not valid', async () => {
      const site = { isLive: sinon.stub().returns(true), getId: sinon.stub().returns('site-id') };
      const topPages = [{ getURL: 'http://example.com/blog/page1', getTopKeyword: sinon.stub().returns('page') },
        { getURL: 'http://example.com/blog/page2', getTopKeyword: sinon.stub().returns('Test') }];

      dataAccessStub.getSiteByID.resolves(site);
      dataAccessStub.getConfiguration.resolves({
        isHandlerEnabledForSite: sinon.stub().returns(true),
      });
      dataAccessStub.getTopPagesForSite.resolves(topPages);

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
        });
      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(logStub.error.calledTwice).to.be.true;
    });
  });
});
