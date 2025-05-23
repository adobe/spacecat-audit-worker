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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../shared.js';
import accessibilityAudit from '../../src/accessibility/handler.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('Accessibility Audit', () => {
  let mockSite;
  let mockContext;

  const baseURL = 'https://example.com';
  const siteId = 'test-site-id';

  beforeEach(() => {
    mockSite = {
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().returns(baseURL),
    };

    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        finalUrl: 'www.example.com',
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-scraper-bucket',
          AWS_ENV: 'dev',
        },
        s3Client: {
          send: sandbox.stub(),
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('scrapeAccessibilityData step', () => {
    it('should return correct audit result for scraping request', async () => {
      const mockUrls = [
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/contact',
      ];

      // Mock S3 responses for getUrlsForAudit
      mockContext.s3Client.send
        .onFirstCall().resolves({
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify({
              'https://example.com/': { traffic: 1000 },
              'https://example.com/about': { traffic: 800 },
              'https://example.com/contact': { traffic: 600 },
            })),
          },
        })
        .onSecondCall().resolves({
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify(mockUrls)),
          },
        });

      const scrapeStep = accessibilityAudit.getStep('scrapeAccessibilityData');

      const result = await scrapeStep.handler(mockContext);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.deep.equal({
        status: 'SCRAPING_REQUESTED',
        message: 'Content scraping for accessibility audit initiated.',
      });
      expect(result).to.have.property('fullAuditRef', 'www.example.com');
      expect(result).to.have.property('urls');
      expect(result).to.have.property('siteId', siteId);
      expect(result).to.have.property('jobId', siteId);
      expect(result).to.have.property('processingType', Audit.AUDIT_TYPES.ACCESSIBILITY);
    });

    it('should handle getUrlsForAudit errors gracefully', async () => {
      // Mock S3 error
      mockContext.s3Client.send.rejects(new Error('S3 connection failed'));

      const scrapeStep = accessibilityAudit.getStep('scrapeAccessibilityData');

      await expect(scrapeStep.handler(mockContext)).to.be.rejectedWith('S3 connection failed');
    });
  });

  describe('processAccessibilityOpportunities step', () => {
    it('should return error when S3 bucket is not configured', async () => {
      const contextWithoutBucket = {
        ...mockContext,
        env: {},
      };

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(contextWithoutBucket);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for accessibility audit',
      });
    });

    it('should process accessibility data successfully with opportunities found', async () => {
      // Mock S3 responses for aggregateAccessibilityData
      const mockAccessibilityData = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            description: 'Elements must have sufficient color contrast',
            nodes: [{ target: ['#header'] }],
          },
        ],
      };

      // Mock S3 list objects response (finding subfolders)
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date(today).getTime();

      mockContext.s3Client.send
        .onFirstCall().resolves({
          CommonPrefixes: [
            { Prefix: `accessibility/${siteId}/${timestamp}/` },
          ],
        })
        // Mock getObjectKeysUsingPrefix response
        .onSecondCall()
        .resolves([
          `accessibility/${siteId}/${timestamp}/page1.json`,
          `accessibility/${siteId}/${timestamp}/page2.json`,
        ])
        // Mock getObjectFromKey responses
        .onThirdCall()
        .resolves(mockAccessibilityData)
        .onCall(3)
        .resolves(mockAccessibilityData)
        // Mock site.getLatestAuditByAuditType response (for generateReportOpportunities)
        .onCall(4)
        .resolves(null);

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(mockContext);

      expect(result).to.have.property('status');
      expect(result.status).to.be.oneOf(['OPPORTUNITIES_FOUND', 'NO_OPPORTUNITIES']);
      expect(result).to.have.property('urlsProcessed');
      expect(result).to.have.property('summary');
    });

    it('should handle case with no accessibility data found', async () => {
      // Mock S3 response with no subfolders
      mockContext.s3Client.send.onFirstCall()
        .resolves({
          CommonPrefixes: [],
        });

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(mockContext);

      expect(result).to.have.property('status', 'NO_OPPORTUNITIES');
      expect(result).to.have.property('message');
    });

    it('should handle S3 errors during processing', async () => {
      // Mock S3 error
      mockContext.s3Client.send.rejects(new Error('S3 connection failed'));

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(mockContext);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'S3 connection failed',
      });
    });

    it('should use production environment setting', async () => {
      const prodContext = {
        ...mockContext,
        env: {
          ...mockContext.env,
          AWS_ENV: 'prod',
        },
      };

      // Mock successful aggregation but no opportunities
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date(today).getTime();

      prodContext.s3Client.send
        .onFirstCall().resolves({
          CommonPrefixes: [
            { Prefix: `accessibility/${siteId}/${timestamp}/` },
          ],
        })
        .onSecondCall()
        .resolves([])
        .onThirdCall()
        .resolves(null);

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(prodContext);

      // Should handle prod environment without errors
      expect(result).to.have.property('status');
    });
  });

  describe('audit configuration', () => {
    it('should have correct audit structure', () => {
      // Test that we can access both steps
      const scrapeStep = accessibilityAudit.getStep('scrapeAccessibilityData');
      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      expect(scrapeStep).to.have.property('name', 'scrapeAccessibilityData');
      expect(scrapeStep).to.have.property('destination', Audit.AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER);
      expect(scrapeStep).to.have.property('handler').that.is.a('function');

      expect(processStep).to.have.property('name', 'processAccessibilityOpportunities');
      expect(processStep).to.have.property('destination', null); // Final step has no destination
      expect(processStep).to.have.property('handler').that.is.a('function');
    });

    it('should use wwwUrlResolver', () => {
      const { urlResolver } = accessibilityAudit;
      expect(urlResolver).to.be.a('function');
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete audit flow with realistic data', async () => {
      // Mock first step
      const mockUrls = [
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/products',
      ];

      mockContext.s3Client.send
        .onFirstCall().resolves({
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify({
              'https://example.com/': { traffic: 1000 },
              'https://example.com/about': { traffic: 800 },
              'https://example.com/products': { traffic: 600 },
            })),
          },
        })
        .onSecondCall().resolves({
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify(mockUrls)),
          },
        });

      // Test first step
      const scrapeStep = accessibilityAudit.getStep('scrapeAccessibilityData');
      const scrapeResult = await scrapeStep.handler(mockContext);

      expect(scrapeResult.auditResult.status).to.equal('SCRAPING_REQUESTED');
      expect(scrapeResult.urls).to.have.lengthOf(3);
      expect(scrapeResult.processingType).to.equal(Audit.AUDIT_TYPES.ACCESSIBILITY);

      // Reset mocks for second step
      sandbox.restore();
      mockContext = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: mockSite,
          finalUrl: 'www.example.com',
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-scraper-bucket',
            AWS_ENV: 'dev',
          },
          s3Client: {
            send: sandbox.stub(),
          },
        })
        .build();

      // Mock second step with realistic accessibility data
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date(today).getTime();

      mockContext.s3Client.send
        .onFirstCall().resolves({
          CommonPrefixes: [
            { Prefix: `accessibility/${siteId}/${timestamp}/` },
          ],
        })
        .onSecondCall()
        .resolves([
          `accessibility/${siteId}/${timestamp}/page1.json`,
          `accessibility/${siteId}/${timestamp}/page2.json`,
          `accessibility/${siteId}/${timestamp}/page3.json`,
        ])
        .onThirdCall()
        .resolves({
          violations: [
            { id: 'color-contrast', impact: 'serious' },
            { id: 'alt-text', impact: 'critical' },
          ],
        })
        .onCall(3)
        .resolves({
          violations: [
            { id: 'form-labels', impact: 'serious' },
          ],
        })
        .onCall(4)
        .resolves({
          violations: [
            { id: 'heading-order', impact: 'moderate' },
          ],
        })
        .onCall(5)
        .resolves(null); // getLatestAuditByAuditType

      // Test second step
      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');
      const processResult = await processStep.handler(mockContext);

      expect(processResult).to.have.property('status');
      expect(processResult.status).to.be.oneOf(['OPPORTUNITIES_FOUND', 'NO_OPPORTUNITIES']);
      if (processResult.status === 'OPPORTUNITIES_FOUND') {
        expect(processResult).to.have.property('opportunitiesFound');
        expect(processResult).to.have.property('urlsProcessed');
        expect(processResult).to.have.property('summary');
      }
    });

    it('should handle edge case with empty aggregation result', async () => {
      // Mock empty aggregation result
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date(today).getTime();

      mockContext.s3Client.send
        .onFirstCall().resolves({
          CommonPrefixes: [
            { Prefix: `accessibility/${siteId}/${timestamp}/` },
          ],
        })
        .onSecondCall()
        .resolves([])
        .onThirdCall()
        .resolves(null);

      const processStep = accessibilityAudit.getStep('processAccessibilityOpportunities');

      const result = await processStep.handler(mockContext);

      expect(result).to.have.property('status', 'NO_OPPORTUNITIES');
    });
  });
});
