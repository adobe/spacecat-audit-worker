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
import { MockContextBuilder } from '../shared.js';

import accessibilityAudit from '../../src/accessibility/handler.js';
import * as dataProcessing from '../../src/accessibility/utils/data-processing.js';

use(sinonChai);
use(chaiAsPromised);

describe('Accessibility Audit', () => {
  let context;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('scrapeAccessibilityData step', () => {
    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: sandbox.stub().returns('test-site-id'),
            getBaseURL: sandbox.stub().returns('https://example.com'),
          },
          finalUrl: 'https://example.com',
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
          s3Client: {},
        })
        .build();

      sandbox.stub(dataProcessing, 'getUrlsForAudit').resolves([
        'https://example.com',
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
    });

    it('should return correct audit result for scraping request', async () => {
      const steps = accessibilityAudit.getSteps();
      const scrapeStep = steps.find((step) => step.stepName === 'scrapeAccessibilityData');

      const result = await scrapeStep.stepFunction(context);

      expect(result).to.deep.equal({
        auditResult: {
          status: 'SCRAPING_REQUESTED',
          message: 'Content scraping for accessibility audit initiated.',
        },
        fullAuditRef: 'https://example.com',
        urls: [
          'https://example.com',
          'https://example.com/page1',
          'https://example.com/page2',
        ],
        siteId: 'test-site-id',
        jobId: 'test-site-id',
        processingType: 'accessibility',
      });

      expect(dataProcessing.getUrlsForAudit).to.have.been.calledWith(
        context.s3Client,
        'test-bucket',
        'test-site-id',
        context.log,
      );
    });

    it('should handle missing S3 bucket configuration', async () => {
      context.env.S3_SCRAPER_BUCKET_NAME = undefined;

      const steps = accessibilityAudit.getSteps();
      const scrapeStep = steps.find((step) => step.stepName === 'scrapeAccessibilityData');

      const result = await scrapeStep.stepFunction(context);

      expect(result.auditResult.status).to.equal('SCRAPING_REQUESTED');
      expect(dataProcessing.getUrlsForAudit).to.have.been.called;
    });
  });

  describe('processAccessibilityOpportunities step', () => {
    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          site: {
            getId: sandbox.stub().returns('test-site-id'),
            getBaseURL: sandbox.stub().returns('https://example.com'),
          },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AWS_ENV: 'test',
          },
          s3Client: {},
        })
        .build();
    });

    it('should return error when S3 bucket is not configured', async () => {
      context.env.S3_SCRAPER_BUCKET_NAME = undefined;

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for accessibility audit',
      });
      expect(context.log.error).to.have.been.calledWith('Missing S3 bucket configuration for accessibility audit');
    });

    it('should process accessibility data successfully with opportunities found', async () => {
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 15,
              },
            },
            'https://example.com': {},
            'https://example.com/page1': {},
          },
        },
      };

      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').resolves(mockAggregationResult);
      sandbox.stub(dataProcessing, 'generateReportOpportunities').resolves();

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(result.opportunitiesFound).to.equal(15);
      expect(result.urlsProcessed).to.equal(2);
      expect(result.summary).to.equal('Found 15 accessibility issues across 2 URLs');
      expect(result.fullReportUrl).to.match(/^accessibility\/test-site-id\/\d{4}-\d{2}-\d{2}-final-result\.json$/);

      expect(dataProcessing.aggregateAccessibilityData).to.have.been.calledWith(
        context.s3Client,
        'test-bucket',
        'test-site-id',
        context.log,
        sinon.match.string,
        sinon.match.string,
      );
      expect(dataProcessing.generateReportOpportunities).to.have.been.calledWith(
        context.site,
        context.log,
        mockAggregationResult,
        false,
        context,
      );
    });

    it('should handle case with no opportunities found', async () => {
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
              },
            },
          },
        },
      };

      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').resolves(mockAggregationResult);
      sandbox.stub(dataProcessing, 'generateReportOpportunities').resolves();

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result.status).to.equal('NO_OPPORTUNITIES');
      expect(result.opportunitiesFound).to.equal(0);
      expect(result.summary).to.equal('Found 0 accessibility issues across 0 URLs');
    });

    it('should handle aggregation failure', async () => {
      const mockAggregationResult = {
        success: false,
        message: 'No accessibility data found for site',
      };

      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').resolves(mockAggregationResult);

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No accessibility data found for site',
      });
      expect(context.log.error).to.have.been.calledWith('[A11yAudit] No data aggregated: No accessibility data found for site');
    });

    it('should handle aggregation error', async () => {
      const aggregationError = new Error('S3 connection failed');
      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').rejects(aggregationError);

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'S3 connection failed',
      });
      expect(context.log.error).to.have.been.calledWith('[A11yAudit] Error processing accessibility data: S3 connection failed', aggregationError);
    });

    it('should handle report generation error', async () => {
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 5,
              },
            },
            'https://example.com': {},
          },
        },
      };

      const reportError = new Error('Failed to create opportunities');
      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').resolves(mockAggregationResult);
      sandbox.stub(dataProcessing, 'generateReportOpportunities').rejects(reportError);

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      const result = await processStep.stepFunction(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Failed to create opportunities',
      });
      expect(context.log.error).to.have.been.calledWith('[A11yAudit] Error generating report opportunities: Failed to create opportunities', reportError);
    });

    it('should use production environment setting', async () => {
      context.env.AWS_ENV = 'prod';

      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
              },
            },
          },
        },
      };

      sandbox.stub(dataProcessing, 'aggregateAccessibilityData').resolves(mockAggregationResult);
      sandbox.stub(dataProcessing, 'generateReportOpportunities').resolves();

      const steps = accessibilityAudit.getSteps();
      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');

      await processStep.stepFunction(context);

      expect(dataProcessing.generateReportOpportunities).to.have.been.calledWith(
        context.site,
        context.log,
        mockAggregationResult,
        true, // isProd should be true
        context,
      );
    });
  });

  describe('audit configuration', () => {
    it('should have correct audit structure', () => {
      const steps = accessibilityAudit.getSteps();

      expect(steps).to.have.length(2);

      const scrapeStep = steps.find((step) => step.stepName === 'scrapeAccessibilityData');
      expect(scrapeStep).to.exist;
      expect(scrapeStep.destination).to.equal('CONTENT_SCRAPER');

      const processStep = steps.find((step) => step.stepName === 'processAccessibilityOpportunities');
      expect(processStep).to.exist;
      expect(processStep.destination).to.be.undefined;
    });
  });
});
