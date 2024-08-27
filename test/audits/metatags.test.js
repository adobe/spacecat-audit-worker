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
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  TITLE,
  DESCRIPTION,
  H1,
  HIGH,
  MODERATE,
} from '../../src/metatags/constants.js';
import SeoChecks from '../../src/metatags/seo-checks.js';
import auditMetaTags from '../../src/metatags/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Meta Tags', () => {
  describe('SeoChecks', () => {
    let seoChecks;
    let logMock;
    let keywordsMock;

    beforeEach(() => {
      logMock = {
        warn: () => {
        },
      };
      keywordsMock = {
        'https://example.com': 'example',
      };
      seoChecks = new SeoChecks(logMock, keywordsMock);
    });

    describe('addDetectedTagEntry', () => {
      it('should add a detected tag entry to the detectedTags object', () => {
        seoChecks.addDetectedTagEntry('https://example.com', TITLE, 'Example Title', HIGH, 'SEO opportunity text');

        expect(seoChecks.detectedTags[TITLE]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[TITLE][0]).to.deep.equal({
          pageUrl: 'https://example.com',
          tagName: TITLE,
          tagContent: 'Example Title',
          seoImpact: HIGH,
          seoOpportunityText: 'SEO opportunity text',
        });
      });
    });

    describe('createLengthCheckText', () => {
      it('should create the correct length check message for a tag within the limit', () => {
        const message = SeoChecks.createLengthCheckText(TITLE, 'This should a valid Title, this should a valid title.');

        expect(message).to.equal('The title tag on this page has a length of 53 characters, which is within the recommended length of 40-60 characters.');
      });

      it('should create the correct length check message for a tag below the limit', () => {
        const message = SeoChecks.createLengthCheckText(TITLE, 'Short');

        expect(message).to.equal('The title tag on this page has a length of 5 characters, which is below the recommended length of 40-60 characters.');
      });

      it('should create the correct length check message for a tag above the limit', () => {
        const longTitle = 'L'.repeat(70); // 70 characters long title
        const message = SeoChecks.createLengthCheckText(TITLE, longTitle);

        expect(message).to.equal('The title tag on this page has a length of 70 characters, which is above the recommended length of 40-60 characters.');
      });
    });

    describe('checkForMissingTags', () => {
      it('should detect and log missing tags', () => {
        const pageTags = {};

        seoChecks.checkForMissingTags('https://example.com', pageTags);

        expect(seoChecks.detectedTags[TITLE]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[DESCRIPTION]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[H1]).to.have.lengthOf(1);
      });
    });

    describe('checkForTagsLength', () => {
      it('should detect tags that are too short or too long', () => {
        const pageTags = {
          [TITLE]: 'Short',
          [DESCRIPTION]: 'D'.repeat(200), // too long
          [H1]: ['Valid H1'],
        };

        seoChecks.checkForTagsLength('https://example.com', pageTags);

        expect(seoChecks.detectedTags[TITLE]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[DESCRIPTION]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[H1]).to.have.lengthOf(0);
      });
    });

    describe('checkForH1Count', () => {
      it('should detect multiple H1 tags', () => {
        const pageTags = {
          [H1]: ['First H1', 'Second H1'],
        };

        seoChecks.checkForH1Count('https://example.com', pageTags);

        expect(seoChecks.detectedTags[H1]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[H1][0]).to.deep.equal({
          pageUrl: 'https://example.com',
          tagName: H1,
          tagContent: ['First H1', 'Second H1'],
          seoImpact: MODERATE,
          seoOpportunityText: 'There are 2 H1 tags on this page, which is more than the recommended count of 1.',
        });
      });
    });

    describe('checkForKeywordInclusion', () => {
      it('should detect missing keywords in tags', () => {
        const pageTags = {
          [TITLE]: 'Some other title',
          [DESCRIPTION]: 'Some other description',
          [H1]: ['Some other H1'],
        };

        seoChecks.checkForKeywordInclusion('https://example.com', pageTags);

        expect(seoChecks.detectedTags[TITLE]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[DESCRIPTION]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[H1]).to.have.lengthOf(1);
      });

      it('should log a warning if the keyword is not found for the URL', () => {
        const logSpy = sinon.spy(logMock, 'warn');
        seoChecks.checkForKeywordInclusion('https://unknown.com', {});

        expect(logSpy.calledOnce).to.be.true;
        expect(logSpy.firstCall.args[0]).to.equal('Keyword Inclusion check failed, keyword not found for https://unknown.com');
      });
    });

    describe('checkForUniqueness', () => {
      it('should detect duplicate tags', () => {
        const pageTags1 = {
          [TITLE]: 'Duplicate Title',
        };
        const pageTags2 = {
          [TITLE]: 'Duplicate Title',
        };

        seoChecks.checkForUniqueness('https://page1.com', pageTags1);
        seoChecks.checkForUniqueness('https://page2.com', pageTags2);

        expect(seoChecks.detectedTags[TITLE]).to.have.lengthOf(1);
        expect(seoChecks.detectedTags[TITLE][0]).to.deep.equal({
          pageUrl: 'https://page2.com',
          tagName: TITLE,
          tagContent: 'Duplicate Title',
          seoImpact: HIGH,
          seoOpportunityText: 'The title tag on this page is identical to the one on https://page1.com. It\'s recommended to have unique title tags for each page.',
        });
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
        env: { S3_BUCKET_NAME: 'test-bucket' },
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
            { Key: 'scrapes/site-id/blog/page1.json' },
            { Key: 'scrapes/site-id/blog/page2.json' },
          ],
        });

      s3ClientStub.getObject.withArgs({
        Bucket: 'test-bucket',
        Key: 'scrapes/site-id/blog/page1.json',
      }).returns({
        promise: sinon.stub().resolves({
          Body: {
            rawBody: '<html lang="en"><head><meta name="description" content=""><title>Test Page</title></head><body></body></html>',
          },
        }),
      });
      s3ClientStub.getObject.withArgs({
        Bucket: 'test-bucket',
        Key: 'scrapes/site-id/blog/page2.json',
      }).returns({
        promise: sinon.stub().resolves({
          Body: {
            rawBody: '<html lang="en"><head><title>Test Page</title></head><body><h1>This is a dummy H1 that is overly length from SEO perspective</h1></body></html>',
          },
        }),
      });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(noContent()));
      expect(addAuditStub.calledWithMatch({
        title: [
          {
            pageUrl: '/blog/page1',
            tagName: 'title',
            tagContent: 'Test Page',
            seoImpact: 'Moderate',
            seoOpportunityText: 'The title tag on this page has a length of 9 characters, which is below the recommended length of 40-60 characters.',
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'title',
            tagContent: 'Test Page',
            seoImpact: 'Moderate',
            seoOpportunityText: 'The title tag on this page has a length of 9 characters, which is below the recommended length of 40-60 characters.',
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'title',
            tagContent: 'Test Page',
            seoImpact: 'High',
            seoOpportunityText: "The title tag on this page is identical to the one on /blog/page1. It's recommended to have unique title tags for each page.",
          },
        ],
        description: [
          {
            pageUrl: '/blog/page1',
            tagName: 'description',
            tagContent: '',
            seoImpact: 'Moderate',
            seoOpportunityText: 'The description tag on this page has a length of 0 characters, which is below the recommended length of 140-160 characters.',
          },
          {
            pageUrl: '/blog/page1',
            tagName: 'description',
            tagContent: '',
            seoImpact: 'High',
            seoOpportunityText: "The description tag on this page is missing the page's top keyword 'page'. It's recommended to include the primary keyword in the description tag.",
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'description',
            tagContent: '',
            seoImpact: 'High',
            seoOpportunityText: "The description tag on this page is missing. It's recommended to have a description tag on each page.",
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'description',
            seoImpact: 'High',
            seoOpportunityText: "The description tag on this page is missing the page's top keyword 'test'. It's recommended to include the primary keyword in the description tag.",
          },
        ],
        h1: [
          {
            pageUrl: '/blog/page1',
            tagName: 'h1',
            tagContent: '',
            seoImpact: 'High',
            seoOpportunityText: "The h1 tag on this page is missing. It's recommended to have a h1 tag on each page.",
          },
          {
            pageUrl: '/blog/page1',
            tagName: 'h1',
            seoImpact: 'High',
            seoOpportunityText: "The h1 tag on this page is missing the page's top keyword 'page'. It's recommended to include the primary keyword in the h1 tag.",
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'h1',
            tagContent: 'This is a dummy H1 that is overly length from SEO perspective',
            seoImpact: 'Moderate',
            seoOpportunityText: 'The h1 tag on this page has a length of 61 characters, which is above the recommended length of 60 characters.',
          },
          {
            pageUrl: '/blog/page2',
            tagName: 'h1',
            tagContent: 'This is a dummy H1 that is overly length from SEO perspective',
            seoImpact: 'High',
            seoOpportunityText: "The h1 tag on this page is missing the page's top keyword 'test'. It's recommended to include the primary keyword in the h1 tag.",
          },
        ],
      }));
      expect(addAuditStub.calledOnce).to.be.true;
      expect(logStub.info.calledTwice).to.be.true;
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

      s3ClientStub.getObject.withArgs({
        Bucket: 'test-bucket',
        Key: 'scrapes/site-id/blog/page1.json',
      }).returns({
        promise: sinon.stub().resolves({
          Body: {
          },
        }),
      });
      const addAuditStub = sinon.stub().resolves();
      dataAccessStub.addAudit = addAuditStub;

      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(addAuditStub.calledOnce).to.be.false;
      expect(logStub.error.calledTwice).to.be.true;
    });

    it('should handle gracefully if S3 object is not a html', async () => {
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

      s3ClientStub.getObject.returns({
        promise: sinon.stub().resolves({
          Body: {
            rawBody: 5,
          },
        }),
      });
      const result = await auditMetaTags(message, context);

      expect(JSON.stringify(result)).to.equal(JSON.stringify(notFound('Site tags data not available')));
      expect(logStub.error.calledTwice).to.be.true;
    });
  });
});
