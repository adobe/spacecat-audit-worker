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
import chaiAsPromised from 'chai-as-promised';
import { MockContextBuilder } from '../../shared.js';
import { prepareTrafficAnalysisRequest, sendRequestToMystique } from '../../../src/paid-traffic-analysis/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Paid Traffic Analysis Handler', () => {
  let sandbox;
  let context;
  let site;
  let clock;
  let mockSqs;

  const auditUrl = 'https://example.com';
  const siteId = 'site-123';
  const auditId = 'audit-456';

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getSiteId: sandbox.stub().returns(siteId),
      getDeliveryType: sandbox.stub().returns('aem_edge'),
      getBaseURL: sandbox.stub().returns(auditUrl),
      getPageTypes: sandbox.stub().returns(null),
    };

    mockSqs = {
      sendMessage: sandbox.stub().resolves(),
    };

    const mockSite = {
      getBaseURL: sandbox.stub().resolves('https://example.com'),
      getPageTypes: sandbox.stub().resolves(null),
    };

    const mockDataAccess = {
      Site: {
        findById: sandbox.stub().resolves(mockSite),
      },
    };

    const mockAthenaClient = {
      query: sandbox.stub().resolves([]),
    };

    const mockS3Client = {
      send: sandbox.stub().resolves({
        // Simulate cache files exist, so no warming needed
        ContentLength: 1024,
        LastModified: new Date(),
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        sqs: mockSqs,
        dataAccess: mockDataAccess,
        athenaClient: mockAthenaClient,
        s3Client: mockS3Client,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          RUM_METRICS_DATABASE: 'rum_db',
          RUM_METRICS_COMPACT_TABLE: 'compact_table',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          PAID_DATA_THRESHOLD: 2000,
          MAX_CONCURRENT_REQUESTS: 5,
        },
        siteId,
      })
      .build();

    // Set a fixed date for consistent testing - Tuesday, January 14, 2025
    clock = sinon.useFakeTimers(new Date('2025-01-14T10:00:00Z'));
  });

  afterEach(() => {
    sandbox.restore();
    clock.restore();
  });

  describe('prepareTrafficAnalysisRequest', () => {
    it('should prepare weekly analysis request correctly and warm cache', async () => {
      const result = await prepareTrafficAnalysisRequest(
        auditUrl,
        context,
        site,
        'weekly',
      );

      const expectedAuditResult = {
        year: 2025,
        week: 2, // Last full week (Jan 6-12, 2025)
        temporalCondition: '(year=2025 AND month=1 AND week=2)',
        month: 1,
        siteId,
      };

      expect(result).to.deep.include({
        auditResult: expectedAuditResult,
        fullAuditRef: auditUrl,
      });
      expect(result.auditResult.temporalCondition).to.include('week=2');

      // Verify cache warming checked S3 for existing cache files
      expect(context.s3Client.send).to.have.been.called;
    });

    it('should prepare monthly analysis request correctly and warm cache', async () => {
      const result = await prepareTrafficAnalysisRequest(
        auditUrl,
        context,
        site,
        'monthly',
      );

      const expectedAuditResult = {
        year: 2024, // Last full month is December 2024
        month: 12,
        siteId,
        temporalCondition: '(year=2024 AND month=12)',
      };

      expect(result).to.deep.equal({
        auditResult: expectedAuditResult,
        fullAuditRef: auditUrl,
      });

      // Verify cache warming checked S3 for existing cache files
      expect(context.s3Client.send).to.have.been.called;
    });

    it('should handle cache warming partial success', async () => {
      const result = await prepareTrafficAnalysisRequest(
        auditUrl,
        context,
        site,
        'weekly',
      );

      expect(result).to.have.property('auditResult');
      // Verify cache warming checked S3 for existing cache files
      expect(context.s3Client.send).to.have.been.called;
    });

    it('should warm cache with temporal parameters', async () => {
      const result = await prepareTrafficAnalysisRequest(
        auditUrl,
        context,
        site,
        'weekly',
      );

      expect(result).to.have.property('auditResult');
      // Cache warming should check S3 for existing cache files
      expect(context.s3Client.send).to.have.been.called;
    });
  });

  describe('sendRequestToMystique', () => {
    it('should send weekly message to Mystique correctly', async () => {
      const auditData = {
        id: auditId,
        auditResult: {
          year: 2025,
          week: 2,
          month: 1,
          siteId,
          temporalCondition: '(year=2025 AND month=1 AND week=2)',
        },
      };

      await sendRequestToMystique(auditUrl, auditData, context, site);

      const expectedMessage = {
        type: 'guidance:traffic-analysis',
        siteId,
        url: auditUrl,
        auditId,
        deliveryType: 'aem_edge',
        time: sinon.match.string,
        data: {
          year: 2025,
          month: 1,
          week: 2,
          temporalCondition: '(year=2025 AND month=1 AND week=2)',
        },
      };

      expect(mockSqs.sendMessage).to.have.been.calledOnceWith(
        'test-queue',
        sinon.match(expectedMessage),
      );
    });

    it('should send monthly message to Mystique correctly', async () => {
      const auditData = {
        id: auditId,
        auditResult: {
          year: 2024,
          month: 12,
          siteId,
          temporalCondition: '(year=2024 AND month=12)',
        },
      };

      await sendRequestToMystique(auditUrl, auditData, context, site);

      const expectedMessage = {
        type: 'guidance:traffic-analysis',
        siteId,
        url: auditUrl,
        auditId,
        deliveryType: 'aem_edge',
        time: sinon.match.string,
        data: {
          year: 2024,
          month: 12,
          week: undefined,
          temporalCondition: '(year=2024 AND month=12)',
        },
      };

      expect(mockSqs.sendMessage).to.have.been.calledOnceWith(
        'test-queue',
        sinon.match(expectedMessage),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle SQS errors gracefully', async () => {
      mockSqs.sendMessage.rejects(new Error('SQS Error'));

      const auditData = {
        id: auditId,
        auditResult: {
          year: 2025,
          week: 2,
          month: 1,
          siteId,
          temporalCondition: '(year=2025 AND month=1)',
        },
      };

      await expect(
        sendRequestToMystique(auditUrl, auditData, context, site),
      ).to.be.rejectedWith('SQS Error');
    });
  });
});
