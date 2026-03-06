/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * @file Test suite for the preflight alt-text audit check handler.
 *
 * These tests verify the functionality of the image alt text analysis
 * in the preflight audit system, including:
 *
 * - Detection of images with missing alt attributes
 * - Detection of images with empty alt attributes (decorative)
 * - Detection of low-quality/generic alt text patterns
 * - Detection of images with overly long alt text (>125 chars)
 * - Proper handling of valid alt text (no false positives)
 * - Filtering of invalid images (no src, small data URIs)
 * - Mystique integration for AI suggestions in 'suggest' step
 * - Timing and profiling data collection
 *
 * @see src/preflight/alt-text.js
 */

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import altText from '../../src/preflight/alt-text.js';

use(sinonChai);
use(chaiAsPromised);

describe('Preflight Alt Text Audit', () => {
  let context;
  let auditContext;
  let sqs;
  let log;

  beforeEach(() => {
    sqs = {
      sendMessage: sinon.stub().resolves(),
    };
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    context = {
      site: {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
        getDeliveryType: () => 'aem_edge',
      },
      job: {
        getId: () => 'job-123',
      },
      step: 'identify',
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.test.com/mystique',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      sqs,
      log,
      dataAccess: {
        AsyncJob: {
          findById: sinon.stub().resolves({
            setStatus: sinon.stub(),
            setResultType: sinon.stub(),
            setResult: sinon.stub(),
            setEndedAt: sinon.stub(),
            setError: sinon.stub(),
            save: sinon.stub().resolves(),
          }),
        },
      },
    };

    auditContext = {
      previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
      step: 'identify',
      audits: new Map([
        ['https://example.com/page1', { audits: [] }],
        ['https://example.com/page2', { audits: [] }],
      ]),
      auditsResult: [
        { pageUrl: 'https://example.com/page1', audits: [] },
        { pageUrl: 'https://example.com/page2', audits: [] },
      ],
      scrapedObjects: [],
      timeExecutionBreakdown: [],
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('altText handler', () => {
    it('should create alt-text audit entries for all pages', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: { rawBody: '<html><body><img src="test.jpg" alt="Test image"></body></html>' },
          },
        },
        {
          data: {
            finalUrl: 'https://example.com/page2',
            scrapeResult: { rawBody: '<html><body><p>No images here</p></body></html>' },
          },
        },
      ];

      await altText(context, auditContext);

      // Verify that alt-text audit entries were created
      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const page2Audit = auditContext.audits.get('https://example.com/page2');

      expect(page1Audit.audits).to.have.lengthOf(1);
      expect(page1Audit.audits[0]).to.deep.include({
        name: 'alt-text',
        type: 'accessibility',
      });

      expect(page2Audit.audits).to.have.lengthOf(1);
      expect(page2Audit.audits[0]).to.deep.include({
        name: 'alt-text',
        type: 'accessibility',
      });
    });

    it('should detect images with missing alt attribute', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="missing-alt.jpg"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0]).to.deep.include({
        check: 'missing-alt',
      });
      expect(imageAltAudit.opportunities[0].issue[0]).to.deep.include({
        src: 'missing-alt.jpg',
        issue: 'Image is missing alt attribute',
        seoImpact: 'High',
      });
    });

    it('should detect images with empty alt attribute', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="empty-alt.jpg" alt=""></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0]).to.deep.include({
        check: 'empty-alt',
      });
      expect(imageAltAudit.opportunities[0].issue[0]).to.deep.include({
        src: 'empty-alt.jpg',
        issue: 'Image has empty alt attribute (decorative image?)',
        seoImpact: 'Low',
      });
    });

    it('should detect images with low-quality alt text', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="generic1.jpg" alt="image">
                <img src="generic2.jpg" alt="photo">
                <img src="generic3.jpg" alt="IMG_001">
                <img src="generic4.jpg" alt="screenshot">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0]).to.deep.include({
        check: 'low-quality-alt',
      });
      expect(imageAltAudit.opportunities[0].issue).to.have.lengthOf(4);
    });

    it('should detect images with alt text that is too long', async () => {
      // Create alt text that exceeds 125 characters
      const longAltText = 'This is an extremely long alt text that goes well beyond the recommended 125 character limit for accessibility and SEO best practices and should be shortened';

      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body><img src="long-alt.jpg" alt="${longAltText}"></body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0]).to.deep.include({
        check: 'long-alt',
      });
      expect(imageAltAudit.opportunities[0].issue[0]).to.deep.include({
        src: 'long-alt.jpg',
        seoImpact: 'Low',
      });
      expect(imageAltAudit.opportunities[0].issue[0].issue).to.include('too long');
      expect(imageAltAudit.opportunities[0].issue[0].issue).to.include(`${longAltText.length} characters`);
    });

    it('should not flag images with valid alt text', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="good.jpg" alt="A beautiful sunset over the mountains">
                <img src="product.jpg" alt="Red Nike running shoes size 10">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(0);
    });

    it('should skip images without src attribute', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img alt="No source"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(0);
    });

    it('should skip small data URI images', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(0);
    });

    it('should handle multiple issue types on the same page', async () => {
      const longAltText = 'This is an extremely long alt text that goes well beyond the recommended 125 character limit for accessibility and SEO best practices';

      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="missing.jpg">
                <img src="empty.jpg" alt="">
                <img src="generic.jpg" alt="image">
                <img src="verbose.jpg" alt="${longAltText}">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(4);

      const checks = imageAltAudit.opportunities.map((o) => o.check);
      expect(checks).to.include('missing-alt');
      expect(checks).to.include('empty-alt');
      expect(checks).to.include('low-quality-alt');
      expect(checks).to.include('long-alt');
    });

    it('should add timing information to execution breakdown', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: { rawBody: '<html><body></body></html>' },
          },
        },
      ];

      await altText(context, auditContext);

      expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
      expect(auditContext.timeExecutionBreakdown[0]).to.deep.include({
        name: 'alt-text',
      });
      expect(auditContext.timeExecutionBreakdown[0]).to.have.property('duration');
      expect(auditContext.timeExecutionBreakdown[0]).to.have.property('startTime');
      expect(auditContext.timeExecutionBreakdown[0]).to.have.property('endTime');
    });

    it('should log warning when no audit found for URL', async () => {
      // Set up a URL that doesn't have an audit entry
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/unknown-page',
            scrapeResult: { rawBody: '<html><body><img src="test.jpg"></body></html>' },
          },
        },
      ];

      await altText(context, auditContext);

      expect(log.warn).to.have.been.calledWith(
        '[preflight-alt-text] No audit found for URL: https://example.com/unknown-page',
      );
    });

    it('should log debug message when no image issues found', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="good.jpg" alt="A proper description"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      expect(log.debug).to.have.been.calledWith(
        '[preflight-alt-text] No image issues found for https://example.com/page1',
      );
    });
  });

  describe('suggest step - Mystique integration', () => {
    it('should send images to Mystique for suggestions in suggest step', async () => {
      auditContext.step = 'suggest';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="missing.jpg"></body></html>',
            },
          },
        },
      ];

      const result = await altText(context, auditContext);

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [queueUrl, message] = sqs.sendMessage.getCall(0).args;

      expect(queueUrl).to.equal('https://sqs.test.com/mystique');
      expect(message).to.deep.include({
        type: 'guidance:preflight-alt-text',
        siteId: 'site-123',
        auditId: 'job-123',
        mode: 'preflight',
        deliveryType: 'aem_edge',
        observation: 'Missing or low-quality alt text on images',
      });
      expect(message.data.jobId).to.equal('job-123');
      expect(message.data.url).to.equal('https://example.com/page1');
      expect(message.data.images).to.have.lengthOf(1);
      expect(message.data.images[0]).to.deep.include({
        src: 'missing.jpg',
        issueType: 'missing-alt',
      });
      expect(result.processing).to.be.true;
    });

    it('should send empty-alt images to Mystique for decorative check', async () => {
      auditContext.step = 'suggest';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="decorative.jpg" alt=""></body></html>',
            },
          },
        },
      ];

      const result = await altText(context, auditContext);

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const message = sqs.sendMessage.getCall(0).args[1];
      expect(message.data.images[0]).to.deep.include({
        src: 'decorative.jpg',
        currentAlt: '',
        issueType: 'empty-alt',
      });
      expect(result.processing).to.be.true;
    });

    it('should send long-alt images to Mystique for concise suggestions', async () => {
      const longAltText = 'This is an extremely long alt text that goes well beyond the recommended 125 character limit for accessibility and SEO best practices and needs shortening';

      auditContext.step = 'suggest';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body><img src="verbose.jpg" alt="${longAltText}"></body></html>`,
            },
          },
        },
      ];

      const result = await altText(context, auditContext);

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const message = sqs.sendMessage.getCall(0).args[1];
      expect(message.data.images[0]).to.deep.include({
        src: 'verbose.jpg',
        currentAlt: longAltText,
        issueType: 'long-alt',
      });
      expect(result.processing).to.be.true;
    });

    it('should handle Mystique send error gracefully', async () => {
      sqs.sendMessage.rejects(new Error('SQS error'));

      auditContext.step = 'suggest';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="missing.jpg"></body></html>',
            },
          },
        },
      ];

      const result = await altText(context, auditContext);

      expect(log.error).to.have.been.calledWith(
        '[preflight-alt-text] Failed to send to Mystique: SQS error',
      );
      expect(result.processing).to.be.false;
    });

    it('should not send to Mystique in identify step', async () => {
      auditContext.step = 'identify';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="missing.jpg"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('should send low-quality alt images to Mystique', async () => {
      auditContext.step = 'suggest';
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="generic.jpg" alt="image"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      expect(sqs.sendMessage).to.have.been.calledOnce;
      const message = sqs.sendMessage.getCall(0).args[1];
      expect(message.data.images[0]).to.deep.include({
        src: 'generic.jpg',
        currentAlt: 'image',
        issueType: 'low-quality-alt',
      });
    });
  });

  describe('low-quality alt text patterns', () => {
    it('should flag camera default names as low quality', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="img1.jpg" alt="DSC0001">
                <img src="img2.jpg" alt="IMG_1234">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0].check).to.equal('low-quality-alt');
      expect(imageAltAudit.opportunities[0].issue).to.have.lengthOf(2);
    });

    it('should flag generic terms as low quality', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="img1.jpg" alt="icon">
                <img src="img2.jpg" alt="logo">
                <img src="img3.jpg" alt="banner">
                <img src="img4.jpg" alt="placeholder">
                <img src="img5.jpg" alt="untitled">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0].issue).to.have.lengthOf(5);
    });

    it('should flag very short alt text as low quality', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: '<html><body><img src="img.jpg" alt="test"></body></html>',
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0].check).to.equal('low-quality-alt');
    });

    it('should flag numbered image patterns as low quality', async () => {
      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body>
                <img src="img1.jpg" alt="image 1">
                <img src="img2.jpg" alt="image2">
                <img src="img3.jpg" alt="photo 3">
              </body></html>`,
            },
          },
        },
      ];

      await altText(context, auditContext);

      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const imageAltAudit = page1Audit.audits.find((a) => a.name === 'alt-text');

      expect(imageAltAudit.opportunities).to.have.lengthOf(1);
      expect(imageAltAudit.opportunities[0].issue).to.have.lengthOf(3);
    });
  });
});
