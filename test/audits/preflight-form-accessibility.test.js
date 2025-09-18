/*
 * Copyright 2025 Adobe. All rights reserved.
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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import esmock from 'esmock';
import { isValidUrls } from '../../src/preflight/utils.js';

use(sinonChai);
use(chaiAsPromised);
describe('Preflight Form Accessibility Audit', () => {
  it('should validate pages sent for auditing', () => {
    const urls = [
      'https://main--example--page.aem.page/page1',
    ];

    const result = isValidUrls(urls);
    expect(result).to.be.true;
  });

  describe('Form Accessibility', () => {
    let context;
    let auditContext;
    let s3Client;
    let sqs;
    let log;

    beforeEach(() => {
      s3Client = {
        send: sinon.stub(),
      };
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
          getDeliveryType: () => 'aem_cs',
        },
        job: {
          getId: () => 'job-123',
          getMetadata: () => ({
            payload: {
              enableAuthentication: true,
            },
          }),
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          CONTENT_SCRAPER_QUEUE_URL: 'https://sqs.test.com/scraper',
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/audit',
          QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.test.com/mystique',
        },
        s3Client,
        sqs,
        log,
        promiseToken: 'test-token',
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
          ['https://example.com/page1', { audits: [{ name: 'form-accessibility', type: 'form-a11y', opportunities: [] }] }],
          ['https://example.com/page2', { audits: [{ name: 'form-accessibility', type: 'form-a11y', opportunities: [] }] }],
        ]),
        auditsResult: [
          { pageUrl: 'https://example.com/page1', audits: [] },
          { pageUrl: 'https://example.com/page2', audits: [] },
        ],
        timeExecutionBreakdown: [],
        checks: ['form-accessibility'],
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('detectFormAccessibility', () => {
      it('should send accessibility detect request successfully', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];

        expect(message).to.deep.include({
          siteId: 'site-123',
          jobId: 'site-123',
          auditId: 'site-123',
          type: 'detect:forms-a11y',
          deliveryType: 'aem_cs',
        });

        expect(message.data.a11y).to.deep.equal([
          { form: 'https://example.com/page1', formSource: 'form' },
          { form: 'https://example.com/page2', formSource: 'form' },
        ]);

        expect(message.options).to.deep.include({
          enableAuthentication: true,
          a11yPreflight: true,
          bucketName: 'test-bucket',
        });

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Sent form accessibility audit request to mystique for 2 URLs',
        );
      });

      it('should handle missing S3 bucket configuration', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = null;

        await detectFormAccessibility(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for form accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle empty preview URLs', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = [];

        await detectFormAccessibility(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle SQS send error', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        const error = new Error('SQS error');
        sqs.sendMessage.rejects(error);

        await expect(detectFormAccessibility(context, auditContext))
          .to.be.rejectedWith('SQS error');

        expect(log.error).to.have.been.calledWith(
          '[preflight-audit] Failed to send form accessibility audit request: SQS error',
        );
      });

      it('should create accessibility audit entries for all pages', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        // Verify accessibility audit entries were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const page2Audit = auditContext.audits.get('https://example.com/page2');

        expect(page1Audit.audits).to.have.lengthOf(2);
        expect(page1Audit.audits[1]).to.deep.equal({
          name: 'form-accessibility',
          type: 'form-a11y',
          opportunities: [],
        });

        expect(page2Audit.audits).to.have.lengthOf(2);
        expect(page2Audit.audits[1]).to.deep.equal({
          name: 'form-accessibility',
          type: 'form-a11y',
          opportunities: [],
        });
      });

      it('should handle missing audit entry for URL', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        // Create audit context with a URL that doesn't have an audit entry
        const auditContextWithMissingEntry = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [] }],
            // page2 is missing from audits map
          ]),
          previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
        };

        await detectFormAccessibility(context, auditContextWithMissingEntry);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No audit entry found for URL: https://example.com/page2',
        );
        expect(sqs.sendMessage).to.have.been.calledOnce;
      });

      it('should log detailed scrape message information', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        expect(log.debug).to.have.been.calledWith(
          sinon.match(/Mystique message being sent:/),
        );
        expect(log.debug).to.have.been.calledWith(
          '[preflight-audit] S3 bucket: test-bucket',
        );
        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Sending to queue: https://sqs.test.com/mystique',
        );
      });

      it('should handle enableAuthentication set to false in job metadata', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        // Override job metadata to set enableAuthentication to false
        context.job.getMetadata = () => ({
          payload: {
            enableAuthentication: false,
          },
        });

        await detectFormAccessibility(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.enableAuthentication).to.be.false;
      });

      it('should handle enableAuthentication not specified in job metadata (defaults to true)', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        // Override job metadata to not specify enableAuthentication
        context.job.getMetadata = () => ({
          payload: {},
        });

        await detectFormAccessibility(context, auditContext);

        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.options.enableAuthentication).to.be.true;
      });

      it('should handle single URL in previewUrls', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = ['https://example.com/single-page'];

        await detectFormAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.data.a11y).to.deep.equal([
          { form: 'https://example.com/single-page', formSource: 'form' },
        ]);
        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Sent form accessibility audit request to mystique for 1 URLs',
        );
      });

      it('should handle large number of URLs', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        const manyUrls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i}`);
        auditContext.previewUrls = manyUrls;

        // Create audit entries for all URLs
        auditContext.audits = new Map(
          manyUrls.map((url) => [url, { audits: [] }]),
        );

        await detectFormAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.data.a11y).to.have.lengthOf(50);
        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Sent form accessibility audit request to mystique for 50 URLs',
        );
      });

      it('should handle URLs with special characters', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = [
          'https://example.com/page with spaces',
          'https://example.com/page-with-query?param=value&other=123',
          'https://example.com/page#fragment',
        ];

        await detectFormAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.have.been.calledOnce;
        const message = sqs.sendMessage.getCall(0).args[1];
        expect(message.data.a11y).to.deep.equal([
          { form: 'https://example.com/page with spaces', formSource: 'form' },
          { form: 'https://example.com/page-with-query?param=value&other=123', formSource: 'form' },
          { form: 'https://example.com/page#fragment', formSource: 'form' },
        ]);
      });

      it('should handle audit context with existing audits', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        // Create audit context with existing audits
        const auditContextWithExisting = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [{ name: 'existing-audit', type: 'test' }] }],
            ['https://example.com/page2', { audits: [] }],
          ]),
        };

        await detectFormAccessibility(context, auditContextWithExisting);

        // Verify that accessibility audit was added to existing audits
        const page1Audit = auditContextWithExisting.audits.get('https://example.com/page1');
        expect(page1Audit.audits).to.have.lengthOf(2);
        expect(page1Audit.audits[1]).to.deep.equal({
          name: 'form-accessibility',
          type: 'form-a11y',
          opportunities: [],
        });

        const page2Audit = auditContextWithExisting.audits.get('https://example.com/page2');
        expect(page2Audit.audits).to.have.lengthOf(1);
        expect(page2Audit.audits[0]).to.deep.equal({
          name: 'form-accessibility',
          type: 'form-a11y',
          opportunities: [],
        });
      });

      it('should handle step parameter in audit context', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.step = 'custom-step';

        await detectFormAccessibility(context, auditContext);

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] site: site-123, job: job-123, step: custom-step. Step 1: Preparing form accessibility scrape',
        );
      });

      it('should handle missing step parameter in audit context', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        delete auditContext.step;

        await detectFormAccessibility(context, auditContext);

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] site: site-123, job: job-123, step: undefined. Step 1: Preparing form accessibility scrape',
        );
      });

      it('should handle empty string S3 bucket name', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = '';

        await detectFormAccessibility(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for form accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle undefined S3 bucket name', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = undefined;

        await detectFormAccessibility(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for form accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should log preview URLs being used', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Using preview URLs for form accessibility audit: [\n  {\n    "form": "https://example.com/page1",\n    "formSource": "form"\n  },\n  {\n    "form": "https://example.com/page2",\n    "formSource": "form"\n  }\n]',
        );
      });

      it('should log force re-scraping message', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Force re-scraping all 2 URLs for form accessibility audit',
        );
      });

      it('should log sending URLs message', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        await detectFormAccessibility(context, auditContext);

        expect(log.info).to.have.been.calledWith(
          '[preflight-audit] Sending 2 URLs to mystique for form accessibility audit',
        );
      });
    });

    describe('form accessibility handler integration', () => {
      it('should skip when no preview URLs provided', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;
        auditContext.previewUrls = [];

        await formAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for form accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as null', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;

        auditContext.previewUrls = null;

        await formAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for form accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as undefined', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;

        auditContext.previewUrls = undefined;

        await formAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for form accessibility audit, skipping',
        );
      });

      it('should handle previewUrls as non-array', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;
        auditContext.previewUrls = 'not-an-array';

        await formAccessibility(context, auditContext);

        expect(sqs.sendMessage).to.not.have.been.called;
        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No URLs to process for form accessibility audit, skipping',
        );
      });

      it('should execute form accessibility workflow when checks is null', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;

        // Set checks to null to trigger the form accessibility workflow
        auditContext.checks = null;

        // Mock successful S3 operations for the entire workflow
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await formAccessibility(context, auditContext);

        // Verify that the workflow was executed
        expect(sqs.sendMessage).to.have.been.called;
        expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      });

      it('should execute form accessibility workflow when checks is undefined', async () => {
        const formAccessibility = (await import('../../src/preflight/form-accessibility.js')).default;

        // Set checks to undefined to trigger the form accessibility workflow
        auditContext.checks = undefined;

        // Mock successful S3 operations for the entire workflow
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await formAccessibility(context, auditContext);

        // Verify that the workflow was executed
        expect(sqs.sendMessage).to.have.been.called;
        expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      });
    });

    describe('processFormAccessibilityOpportunities', () => {
      afterEach(() => {
        sinon.restore();
      });

      it('should handle missing S3 bucket configuration', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        context.env.S3_SCRAPER_BUCKET_NAME = null;

        await processFormAccessibilityOpportunities(context, auditContext);

        expect(log.error).to.have.been.calledWith('Missing S3 bucket configuration for form accessibility audit');
      });

      it('should handle missing form accessibility data for URL', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return null for form accessibility data
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(null),
              },
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No form accessibility data found for https://example.com/page1 at key: form-accessibility-preflight/site-123/example_com_page1.json',
        );
      });

      it('should add timing information to execution breakdown', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock successful S3 operations
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
        expect(auditContext.timeExecutionBreakdown[0]).to.deep.include({
          name: 'form-accessibility-processing',
        });
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('duration');
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('startTime');
        expect(auditContext.timeExecutionBreakdown[0]).to.have.property('endTime');
      });

      it('should process form accessibility violations and create opportunities', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with violations
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  form: 'https://example.com/page1',
                  formSource: 'form',
                  a11yIssues: [
                    {
                      wcagLevel: 'A',
                      severity: 'critical',
                      htmlWithIssues: ['<button><img src="icon.png" alt=""></button>'],
                      failureSummary: 'Buttons must have discernible text',
                      description: 'Ensures buttons have accessible names',
                      type: 'button-name',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        // expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 1,
          failureSummary: 'Buttons must have discernible text',
          description: 'Ensures buttons have accessible names',
          type: 'button-name',
        });
      });

      it('should handle form accessibility violations that do not match opportunity types', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with violations that don't match
        // opportunity types
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'AA',
                      severity: 'critical',
                      htmlWithIssues: ['<div>Unknown issue</div>'],
                      failureSummary: 'Unknown violation',
                      description: 'Unknown violation description',
                      type: 'unknown-violation',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created for all violations
        // (form accessibility processes all a11yIssues)
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'AA',
          severity: 'critical',
          type: 'unknown-violation',
        });
      });

      it('should handle form accessibility violations with missing or undefined fields', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with missing/undefined fields to test fallbacks
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      // Missing wcagLevel field - should fallback to undefined
                      // Missing severity field - should fallback to undefined
                      // Missing htmlWithIssues field - should fallback to undefined
                      // Missing failureSummary field - should fallback to undefined
                      // Missing description field - should fallback to undefined
                      // Missing type field - should fallback to undefined
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with fallback values
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: undefined, // fallback for missing wcagLevel
          severity: undefined, // fallback for missing severity
          occurrences: 0, // fallback for missing htmlWithIssues.length
          htmlWithIssues: undefined, // fallback for missing htmlWithIssues
          failureSummary: undefined, // fallback for missing failureSummary
          description: undefined, // fallback for missing description
          type: undefined, // fallback for missing type
          check: '', // always empty for form accessibility
          understandingUrl: '', // always empty for form accessibility
        });
      });

      it('should handle form accessibility violations with htmlWithIssues arrays', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with htmlWithIssues arrays
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'AA',
                      severity: 'serious',
                      htmlWithIssues: ['<button>First</button>', '<button>Second</button>'],
                      failureSummary: 'Test summary',
                      description: 'Test description',
                      type: 'button-name',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with htmlWithIssues
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'AA',
          severity: 'serious',
          occurrences: 2,
          htmlWithIssues: ['<button>First</button>', '<button>Second</button>'],
          failureSummary: 'Test summary',
          description: 'Test description',
          type: 'button-name',
        });
      });

      it('should handle form accessibility violations with null/undefined html in htmlWithIssues', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'AA',
                      severity: 'moderate',
                      htmlWithIssues: [null, undefined, ''], // Test falsy values for html
                      failureSummary: 'Test summary',
                      description: 'Test description',
                      type: 'button-name',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunity was created with htmlWithIssues as-is
        // (form accessibility doesn't transform them)
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'AA',
          severity: 'moderate',
          occurrences: 3,
          htmlWithIssues: [null, null, ''], // Form accessibility keeps htmlWithIssues as-is (undefined becomes null in JSON)
          failureSummary: 'Test summary',
          description: 'Test description',
          type: 'button-name',
        });
      });

      it('should handle missing form accessibility audit entry for URL', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Create audit context without form accessibility audit entries
        const auditContextWithoutFormAccessibility = {
          ...auditContext,
          audits: new Map([
            ['https://example.com/page1', { audits: [] }], // No form accessibility audit
            ['https://example.com/page2', { audits: [] }],
          ]),
        };

        // Mock S3 to return form accessibility data
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContextWithoutFormAccessibility);

        expect(log.warn).to.have.been.calledWith(
          '[preflight-audit] No accessibility audit found for URL: https://example.com/page1',
        );
      });

      it('should handle form accessibility data with empty a11yIssues', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with empty a11yIssues
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that no opportunities were created
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(0);
      });

      it('should handle form accessibility data with multiple a11yIssues', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with multiple a11yIssues
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'A',
                      severity: 'critical',
                      htmlWithIssues: ['<button><img src="icon.png" alt=""></button>'],
                      failureSummary: 'Buttons must have discernible text',
                      description: 'Ensures buttons have accessible names',
                      type: 'button-name',
                    },
                    {
                      wcagLevel: 'AA',
                      severity: 'moderate',
                      htmlWithIssues: ['<input type="text">'],
                      failureSummary: 'Input must have label',
                      description: 'Ensures inputs have accessible names',
                      type: 'input-label',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created for all a11yIssues
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(2);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 1,
          type: 'button-name',
        });
        expect(formAccessibilityAudit.opportunities[1]).to.deep.include({
          wcagLevel: 'AA',
          severity: 'moderate',
          occurrences: 1,
          type: 'input-label',
        });
      });

      it('should handle form accessibility data with missing htmlWithIssues array', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with missing htmlWithIssues
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'A',
                      severity: 'critical',
                      // Missing htmlWithIssues array
                      failureSummary: 'Buttons must have discernible text',
                      description: 'Ensures buttons have accessible names',
                      type: 'button-name',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created with undefined htmlWithIssues
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 0, // 0 because htmlWithIssues is undefined
          htmlWithIssues: undefined,
          failureSummary: 'Buttons must have discernible text',
          description: 'Ensures buttons have accessible names',
          type: 'button-name',
        });
      });

      it('should handle form accessibility data with multiple htmlWithIssues', async () => {
        const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

        // Mock S3 to return form accessibility data with multiple htmlWithIssues
        s3Client.send.callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [
                    {
                      wcagLevel: 'A',
                      severity: 'critical',
                      htmlWithIssues: ['<button><img src="icon.png" alt=""></button>', '<button></button>'],
                      failureSummary: 'Buttons must have discernible text',
                      description: 'Ensures buttons have accessible names',
                      type: 'button-name',
                    },
                  ],
                })),
              },
              ContentType: 'application/json',
            });
          }
          return Promise.resolve({});
        });

        await processFormAccessibilityOpportunities(context, auditContext);

        // Verify that opportunities were created with proper htmlWithIssues
        const page1Audit = auditContext.audits.get('https://example.com/page1');
        const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');

        expect(formAccessibilityAudit.opportunities).to.have.lengthOf(1);
        expect(formAccessibilityAudit.opportunities[0]).to.deep.include({
          wcagLevel: 'A',
          severity: 'critical',
          occurrences: 2,
          htmlWithIssues: ['<button><img src="icon.png" alt=""></button>', '<button></button>'],
          failureSummary: 'Buttons must have discernible text',
          description: 'Ensures buttons have accessible names',
          type: 'button-name',
        });
      });
    });

    describe('form accessibility handler polling', () => {
      let pollingContext;
      let pollingAuditContext;
      let pollingS3Client;
      let pollingLog;
      let formAccessibility;
      let sandbox;

      beforeEach(async () => {
        sandbox = sinon.createSandbox();
        // Mock the sleep function using esmock
        const formAccessibilityModule = await esmock('../../src/preflight/form-accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
        });
        formAccessibility = formAccessibilityModule.default;
        pollingS3Client = {
          send: sinon.stub(),
        };
        pollingLog = {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
          debug: sinon.stub(),
        };

        pollingContext = {
          site: {
            getId: () => 'site-123',
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_cs',
          },
          job: {
            getId: () => 'job-123',
            getMetadata: () => ({
              payload: {
                enableAuthentication: true,
              },
            }),
          },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
          s3Client: pollingS3Client,
          sqs: {
            sendMessage: sinon.stub().resolves(),
          },
          log: pollingLog,
        };

        pollingAuditContext = {
          previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
          step: 'identify',
          checks: ['form-accessibility'],
          audits: new Map([
            ['https://example.com/page1', { audits: [{ name: 'form-accessibility', type: 'form-a11y', opportunities: [] }] }],
            ['https://example.com/page2', { audits: [{ name: 'form-accessibility', type: 'form-a11y', opportunities: [] }] }],
          ]),
          auditsResult: [
            { pageUrl: 'https://example.com/page1', audits: [] },
            { pageUrl: 'https://example.com/page2', audits: [] },
          ],
          timeExecutionBreakdown: [],
        };
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should skip form accessibility when not in checks', async () => {
        pollingAuditContext.checks = ['other-check']; // Not including form-accessibility

        await formAccessibility(pollingContext, pollingAuditContext);

        expect(pollingS3Client.send).to.not.have.been.called;
        expect(pollingLog.info).to.not.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      });

      it('should execute full form accessibility workflow when checks include form-accessibility', async () => {
        // Mock successful S3 operations for the entire workflow
        pollingS3Client.send.callsFake((command) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return Promise.resolve({
              Contents: [
                { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
                { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
              ],
            });
          }
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.resolve({
              Body: {
                transformToString: sinon.stub().resolves(JSON.stringify({
                  a11yIssues: [],
                })),
              },
            });
          }
          return Promise.resolve({});
        });

        await formAccessibility(pollingContext, pollingAuditContext);

        // Verify that the workflow was executed
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] S3 Bucket: test-bucket');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Site ID: site-123');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Job ID: job-123');
        expect(pollingLog.debug).to.have.been.calledWith('[preflight-audit] Looking for data in path: form-accessibility-preflight/site-123/');
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Expected files: ["example_com_page1.json","example_com_page2.json"]');
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Polling attempt - checking S3 bucket: test-bucket');
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process form accessibility data');
      });

      it('should handle polling with files that do not match expected pattern', async () => {
        let pollCount = 0;
        // Mock the form accessibility module with s3-utils mocked
        const formAccessibilityModule = await esmock('../../src/preflight/form-accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
          '../../src/utils/s3-utils.js': {
            getObjectKeysUsingPrefix: sinon.stub().callsFake(() => {
              pollCount += 1;
              if (pollCount === 1) {
                // First call: Return files that don't match expected patterns
                return Promise.resolve([
                  'form-accessibility-preflight/site-123/wrong_file1.json',
                  'form-accessibility-preflight/site-123/wrong_file2.json',
                  'form-accessibility-preflight/site-123/other_file.json',
                  'form-accessibility-preflight/site-123/', // Directory-like key
                ]);
              } else {
                // Second call: Return proper files to exit the polling loop
                return Promise.resolve([
                  'form-accessibility-preflight/site-123/example_com_page1.json',
                  'form-accessibility-preflight/site-123/example_com_page2.json',
                ]);
              }
            }),
            getObjectFromKey: sinon.stub().resolves({
              a11yIssues: [],
            }),
          },
        });

        const mockedFormAccessibility = formAccessibilityModule.default;

        await mockedFormAccessibility(pollingContext, pollingAuditContext);

        // Verify that it found 0 files due to filtering logic on first attempt
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Found 0 out of 2 expected form accessibility files, continuing to wait...');
        // Verify that it eventually found the files and proceeded
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
      });

      it('should handle polling timeout scenario', async () => {
        let callCount = 0;

        // Stub Date.now to simulate timeout
        const dateNowStub = sandbox.stub(Date, 'now').callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call - start time
            return 1000000;
          } else {
            // Subsequent calls - simulate timeout reached (11 minutes later)
            return 1000000 + (11 * 60 * 1000);
          }
        });

        // Mock the form accessibility module with s3-utils mocked
        const formAccessibilityModule = await esmock('../../src/preflight/form-accessibility.js', {
          '../../src/support/utils.js': {
            sleep: sandbox.stub().resolves(),
          },
          '../../src/utils/s3-utils.js': {
            getObjectKeysUsingPrefix: sinon.stub().resolves([]), // Always return empty array
            getObjectFromKey: sinon.stub().resolves(null),
          },
        });

        const mockedFormAccessibility = formAccessibilityModule.default;

        await mockedFormAccessibility(pollingContext, pollingAuditContext);

        // Verify that timeout message was logged
        expect(pollingLog.info).to.have.been.calledWith('[preflight-audit] Maximum wait time reached, stopping polling');

        // Restore the stub
        dateNowStub.restore();
      });
    });

    describe('detectFormAccessibility edge cases', () => {
      it('should handle empty previewUrls array', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = [];

        await detectFormAccessibility(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle null previewUrls', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = null;

        await detectFormAccessibility(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle undefined previewUrls', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = undefined;

        await detectFormAccessibility(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });

      it('should handle non-array previewUrls', async () => {
        const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

        auditContext.previewUrls = 'not-an-array';

        await detectFormAccessibility(context, auditContext);

        expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to scrape for accessibility audit');
        expect(sqs.sendMessage).to.not.have.been.called;
      });
    });
  });

  describe('form accessibility coverage tests', () => {
    let context;
    let auditContext;
    let s3Client;
    let log;
    let formAccessibility;
    let sandbox;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();

      // Mock the sleep function using esmock
      const formAccessibilityModule = await esmock('../../src/preflight/form-accessibility.js', {
        '../../src/support/utils.js': {
          sleep: sandbox.stub().resolves(),
        },
      });
      formAccessibility = formAccessibilityModule.default;

      log = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      };

      s3Client = {
        send: sinon.stub(),
      };

      context = {
        site: {
          getId: sinon.stub().returns('site-123'),
          getBaseURL: sinon.stub().returns('https://example.com'),
          getDeliveryType: sinon.stub().returns('aem_cs'),
        },
        job: {
          getId: sinon.stub().returns('job-123'),
          getMetadata: sinon.stub().returns({
            payload: { enableAuthentication: true },
          }),
        },
        log,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/queue',
          CONTENT_SCRAPER_QUEUE_URL: 'https://sqs.test.com/scraper-queue',
          QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.test.com/mystique',
        },
        s3Client,
        sqs: {
          sendMessage: sinon.stub().resolves(),
        },
        dataAccess: {
          AsyncJob: {
            update: sinon.stub().resolves(),
          },
        },
      };

      auditContext = {
        previewUrls: ['https://example.com/page1', 'https://example.com/page2'],
        step: 'test-step',
        audits: new Map([
          ['https://example.com/page1', {
            audits: [{
              name: 'form-accessibility',
              type: 'form-a11y',
              opportunities: [],
            }],
          }],
          ['https://example.com/page2', {
            audits: [{
              name: 'form-accessibility',
              type: 'form-a11y',
              opportunities: [],
            }],
          }],
        ]),
        auditsResult: {},
        timeExecutionBreakdown: [],
        checks: ['form-accessibility'],
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should handle error in processFormAccessibilityOpportunities when form accessibility audit is missing', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Create audit context without form accessibility audit entries
      auditContext.audits = new Map([
        ['https://example.com/page1', {
          audits: [],
        }],
      ]);
      auditContext.previewUrls = ['https://example.com/page1'];

      // Mock S3 to return form accessibility data
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                form: 'https://example.com/page1',
                formSource: 'form',
                a11yIssues: [
                  {
                    wcagLevel: 'A',
                    severity: 'critical',
                    htmlWithIssues: ['<button>test</button>'],
                    failureSummary: 'Test summary',
                    description: 'Test description',
                    type: 'button-name',
                  },
                ],
              })),
            },
          });
        }
        return Promise.resolve({});
      });

      // The function should handle missing audit gracefully
      await processFormAccessibilityOpportunities(context, auditContext);

      // Verify that warning was logged for missing audit
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No accessibility audit found for URL: https://example.com/page1');
    });

    it('should handle error in processFormAccessibilityOpportunities and add error opportunity', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Mock S3 to throw an error
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 error'));
        }
        return Promise.resolve({});
      });

      await processFormAccessibilityOpportunities(context, auditContext);

      // Verify that the function handles S3 errors gracefully by logging warnings
      // The getObjectFromKey function returns null when S3 throws an error
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No form accessibility data found for https://example.com/page1 at key: form-accessibility-preflight/site-123/example_com_page1.json');
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No form accessibility data found for https://example.com/page2 at key: form-accessibility-preflight/site-123/example_com_page2.json');
    });

    it('should handle cleanup error in processFormAccessibilityOpportunities', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Mock S3 to succeed for GetObjectCommand but fail for DeleteObjectsCommand
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.reject(new Error('Cleanup failed'));
        }
        return Promise.resolve({});
      });

      await processFormAccessibilityOpportunities(context, auditContext);

      // The cleanup error should be logged
      expect(log.warn).to.have.been.calledWith('[preflight-audit] Failed to clean up form accessibility files: Cleanup failed');
    });

    it('should handle missing form accessibility audit in error handling', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Create audit context where some URLs don't have form accessibility audits
      auditContext.audits = new Map([
        ['https://example.com/page1', {
          audits: [{
            name: 'form-accessibility',
            type: 'form-a11y',
            opportunities: [],
          }],
        }],
        ['https://example.com/page2', {
          audits: [], // No form accessibility audit
        }],
      ]);

      // Mock S3 to throw an error
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 error'));
        }
        return Promise.resolve({});
      });

      // The function should handle missing form accessibility audits gracefully
      await processFormAccessibilityOpportunities(context, auditContext);

      // Verify that the function completed without throwing an error
      // and logged appropriate warnings for missing form accessibility audits
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No form accessibility data found for https://example.com/page1 at key: form-accessibility-preflight/site-123/example_com_page1.json');
      expect(log.warn).to.have.been.calledWith('[preflight-audit] No form accessibility data found for https://example.com/page2 at key: form-accessibility-preflight/site-123/example_com_page2.json');

      // The warning for missing form accessibility audit is only logged
      // when accessibilityData exists
      // but there's no form accessibility audit found. Since we're mocking S3 to return null,
      // this warning won't be logged. The test should verify the actual behavior.
      const missingAuditCalls = log.warn.getCalls().filter((call) => call.args[0] === '[preflight-audit] No accessibility audit found for URL: https://example.com/page2');
      expect(missingAuditCalls).to.have.lengthOf(0);
    });

    it('should handle form accessibility function with no URLs to process', async () => {
      // Test the case where previewUrls is empty
      auditContext.previewUrls = [];

      await formAccessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for form accessibility audit, skipping');
    });

    it('should handle form accessibility function with null previewUrls', async () => {
      // Test the case where previewUrls is null
      auditContext.previewUrls = null;

      await formAccessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for form accessibility audit, skipping');
    });

    it('should handle form accessibility function with non-array previewUrls', async () => {
      // Test the case where previewUrls is not an array
      auditContext.previewUrls = 'not-an-array';

      await formAccessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for form accessibility audit, skipping');
    });

    it('should handle form accessibility function with undefined previewUrls', async () => {
      // Test the case where previewUrls is undefined
      auditContext.previewUrls = undefined;

      await formAccessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for form accessibility audit, skipping');
    });

    it('should handle form accessibility function with empty array previewUrls', async () => {
      // Test the case where previewUrls is an empty array
      auditContext.previewUrls = [];

      await formAccessibility(context, auditContext);

      expect(log.warn).to.have.been.calledWith('[preflight-audit] No URLs to process for form accessibility audit, skipping');
    });

    it('should handle error during form accessibility data processing', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Mock S3 to throw an error during GetObjectCommand
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('S3 processing error'));
        }
        return Promise.resolve({});
      });

      await processFormAccessibilityOpportunities(context, auditContext);

      // Verify that warnings were logged for missing form accessibility data
      expect(log.warn).to.have.been.calledWith(
        '[preflight-audit] No form accessibility data found for https://example.com/page1 at key: form-accessibility-preflight/site-123/example_com_page1.json',
      );
      expect(log.warn).to.have.been.calledWith(
        '[preflight-audit] No form accessibility data found for https://example.com/page2 at key: form-accessibility-preflight/site-123/example_com_page2.json',
      );
    });

    it('should skip form accessibility when checks is provided but does not include form-accessibility', async () => {
      // Set checks to an array that doesn't include 'form-accessibility'
      auditContext.checks = ['other-check', 'another-check'];

      await formAccessibility(context, auditContext);

      // Verify that no form accessibility processing was done
      expect(s3Client.send).to.not.have.been.called;
      expect(log.info).to.not.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
    });

    it('should handle polling loop in form accessibility function', async () => {
      // Mock S3 to return files immediately (simplified test without polling loop)
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        return Promise.resolve({});
      });

      await formAccessibility(context, auditContext);

      // Verify that polling was attempted and succeeded
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Polling attempt - checking S3 bucket: test-bucket');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process form accessibility data');
    });

    it('should call processFormAccessibilityOpportunities after successful polling', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processFormAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });

      await formAccessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.info).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process form accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
    });

    it('should complete form accessibility function with processFormAccessibilityOpportunities call', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processFormAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });

      await formAccessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.info).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process form accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
    });

    it('should execute complete form accessibility workflow', async () => {
      // Mock S3 to return files immediately on first call
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processFormAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });

      // Execute the form accessibility function
      await formAccessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.info).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process form accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
    });

    it('should ensure processFormAccessibilityOpportunities is called', async () => {
      // Mock S3 to return files immediately
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      // Ensure audit entries exist for processFormAccessibilityOpportunities to work with
      auditContext.audits.set('https://example.com/page1', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });
      auditContext.audits.set('https://example.com/page2', {
        audits: [{ name: 'form-accessibility', opportunities: [] }],
      });

      // Execute the form accessibility function
      await formAccessibility(context, auditContext);

      // Verify that the function completed successfully
      expect(log.info).to.have.been.calledWith(
        '[preflight-audit] Polling completed, proceeding to process form accessibility data',
      );

      // Verify that the function completed without throwing an error
      expect(log.debug).to.have.been.calledWith('[preflight-audit] Starting to poll for form accessibility data');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
    });

    it('should have empty urlsToDetect after mapping', async () => {
      const { detectFormAccessibility } = await import('../../src/preflight/form-accessibility.js');

      // Create a scenario where previewUrls exists but map results in empty urlsToScrape
      // This is a rare edge case but needed for coverage
      auditContext.previewUrls = [''];
      // Mock map only on this instance to return an empty array
      auditContext.previewUrls.map = function mockMap() {
        return [];
      };

      try {
        await detectFormAccessibility(context, auditContext);
        expect(log.info).to.have.been.calledWith('[preflight-audit] No URLs to detect for form accessibility audit');
        expect(context.sqs.sendMessage).to.not.have.been.called;
      } finally {
        // No need to restore map since we only mocked the instance
      }
    });

    it('should handle error during individual file processing and add form-accessibility-error opportunity', async () => {
      const { processFormAccessibilityOpportunities } = await import('../../src/preflight/form-accessibility.js');

      // Set up the test context to have the required previewUrls
      auditContext.previewUrls = ['https://example.com/page1'];
      // Create a page result with a find method that throws an error
      const pageResult = {
        audits: [{
          name: 'form-accessibility',
          type: 'form-a11y',
          opportunities: [],
        }],
      };
      // Make the find method throw an error the first time it's called (during processing)
      // but work normally the second time (during error handling)
      let findCallCount = 0;
      const originalFind = pageResult.audits.find;
      pageResult.audits.find = function findMock(predicate) {
        findCallCount += 1;
        if (findCallCount === 1) {
          throw new Error('JSON parsing failed');
        }
        return originalFind.call(this, predicate);
      };

      auditContext.audits.set('https://example.com/page1', pageResult);

      // Mock S3 client to return valid data
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            ContentType: 'application/json',
            Body: {
              transformToString: () => Promise.resolve('{"a11yIssues": []}'),
            },
          });
        }
        return Promise.resolve({});
      });

      await processFormAccessibilityOpportunities(context, auditContext);

      // Verify that the error was logged for the first URL
      expect(log.error).to.have.been.calledWith(
        '[preflight-audit] Error processing accessibility file for https://example.com/page1: JSON parsing failed',
      );

      // Verify that a form-accessibility-error opportunity was added to the audit
      const page1Audit = auditContext.audits.get('https://example.com/page1');
      const formAccessibilityAudit = page1Audit.audits.find((a) => a.name === 'form-accessibility');
      const errorOpportunity = formAccessibilityAudit.opportunities.find((o) => o.type === 'form-accessibility-error');

      expect(errorOpportunity).to.exist;
      expect(errorOpportunity.title).to.equal('Form Accessibility File Processing Error');
      expect(errorOpportunity.description).to.include('Failed to process form accessibility data for https://example.com/page1: JSON parsing failed');
      expect(errorOpportunity.severity).to.equal('error');
    });

    it('should handle error during polling loop and continue polling', async () => {
      let pollCallCount = 0;
      // Mock S3 to throw an error on first polling attempt, then succeed
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          pollCallCount += 1;
          if (pollCallCount === 1) {
            // First polling attempt - throw an error
            return Promise.reject(new Error('S3 ListObjectsV2 failed'));
          }
          // Second polling attempt - return success
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await formAccessibility(context, auditContext);

      // Verify that the polling error was logged
      expect(log.error).to.have.been.calledWith('[preflight-audit] Error polling for form accessibility data: S3 ListObjectsV2 failed');
      // Verify that polling continued and eventually succeeded
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process form accessibility data');
      // Verify that both polling attempts were made
      expect(pollCallCount).to.equal(2);
    });

    it('should handle foundFiles', async () => {
      let pollCallCount = 0;
      // Mock S3 to return null foundFiles first, then success
      s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'ListObjectsV2Command') {
          pollCallCount += 1;
          if (pollCallCount === 1) {
            // First polling attempt - return response with no Contents (foundFiles will be falsy)
            return Promise.resolve({
              // No Contents property - this makes foundFiles undefined/falsy
            });
          }
          // Second polling attempt - return success
          return Promise.resolve({
            Contents: [
              { Key: 'form-accessibility-preflight/site-123/example_com_page1.json', LastModified: new Date() },
              { Key: 'form-accessibility-preflight/site-123/example_com_page2.json', LastModified: new Date() },
            ],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({
                a11yIssues: [],
              })),
            },
          });
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      await formAccessibility(context, auditContext);

      // Verify that the foundCount = foundFiles ? foundFiles.length : 0 branch was hit
      // This should log "Found 0 out of 2 expected..." when foundFiles is falsy
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 0 out of 2 expected form accessibility files, continuing to wait...');
      // Verify that polling continued and eventually succeeded
      expect(log.info).to.have.been.calledWith('[preflight-audit] Found 2 accessibility files out of 2 expected, form accessibility processing complete');
      expect(log.info).to.have.been.calledWith('[preflight-audit] Polling completed, proceeding to process form accessibility data');
      // Verify that both polling attempts were made
      expect(pollCallCount).to.equal(2);
    });
  });
});
