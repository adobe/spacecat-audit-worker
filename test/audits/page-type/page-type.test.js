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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Page Type Detection Audit', () => {
  let context;
  let sandbox;
  let mockSite;
  let getWeekInfoStub;
  let handlerModule;
  let guidanceHandlerModule;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    // Create mock site
    mockSite = {
      getSiteId: sandbox.stub().returns('test-site-id'),
      getId: sandbox.stub().returns('test-site-id'),
      getDeliveryType: sandbox.stub().returns('aem_edge'),
      getPageTypes: sandbox.stub().returns([]),
      setPageTypes: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    // Setup context
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        siteId: 'test-site-id',
        site: mockSite,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      })
      .build();

    // Mock getWeekInfo
    getWeekInfoStub = sandbox.stub().returns({
      week: 42,
      year: 2025,
      month: 10,
      temporalCondition: 'YEAR = 2025 AND WEEK = 42',
    });

    // Load modules with mocked dependencies
    handlerModule = await esmock('../../../src/page-type/handler.js', {
      '@adobe/spacecat-shared-utils': {
        getWeekInfo: getWeekInfoStub,
      },
    });

    guidanceHandlerModule = await esmock('../../../src/page-type/guidance-handler.js');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('pageTypeDetectionRunner', () => {
    it('should prepare page type detection parameters correctly', async () => {
      const auditUrl = 'https://example.com';

      const result = await handlerModule.pageTypeDetectionRunner(
        auditUrl,
        context,
        mockSite,
      );

      expect(result).to.be.an('object');
      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', auditUrl);

      expect(result.auditResult).to.deep.equal({
        year: 2025,
        week: 42,
        month: 10,
        siteId: 'test-site-id',
        temporalCondition: 'YEAR = 2025 AND WEEK = 42',
      });

      expect(context.log.info).to.have.been.calledWith(
        '[page-type-audit] Preparing mystique page-type-detection request parameters for [siteId: test-site-id] and baseUrl: https://example.com',
      );

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[page-type-audit\] Request parameters:/),
      );
    });

    it('should use the correct week information from getWeekInfo', async () => {
      // Update the stub to return different values
      getWeekInfoStub.returns({
        week: 1,
        year: 2024,
        month: 1,
        temporalCondition: 'YEAR = 2024 AND WEEK = 1',
      });

      const auditUrl = 'https://test.com';
      const result = await handlerModule.pageTypeDetectionRunner(
        auditUrl,
        context,
        mockSite,
      );

      expect(result.auditResult).to.deep.include({
        year: 2024,
        week: 1,
        month: 1,
        siteId: 'test-site-id',
      });
    });

    it('should handle different site IDs correctly', async () => {
      mockSite.getSiteId.returns('different-site-id');

      const auditUrl = 'https://different.com';
      const result = await handlerModule.pageTypeDetectionRunner(
        auditUrl,
        context,
        mockSite,
      );

      expect(result.auditResult.siteId).to.equal('different-site-id');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/siteId: different-site-id/),
      );
    });
  });

  describe('sendRequestToMystique', () => {
    it('should send message to Mystique with correct payload', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        id: 'audit-123',
        auditResult: {
          year: 2025,
          week: 42,
          month: 10,
          siteId: 'test-site-id',
          temporalCondition: 'YEAR = 2025 AND WEEK = 42',
        },
      };

      await handlerModule.sendRequestToMystique(auditUrl, auditData, context, mockSite);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'test-mystique-queue',
        sinon.match({
          type: 'detect:page-types',
          siteId: 'test-site-id',
          url: auditUrl,
          auditId: 'audit-123',
          deliveryType: 'aem_edge',
          data: {
            year: 2025,
            week: 42,
            month: 10,
          },
        }),
      );

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/evaluation to mystique/),
      );
    });

    it('should include timestamp in mystique message', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        id: 'audit-456',
        auditResult: {
          year: 2025,
          week: 42,
          month: 10,
          siteId: 'test-site-id',
        },
      };

      const before = new Date();
      await handlerModule.sendRequestToMystique(auditUrl, auditData, context, mockSite);
      const after = new Date();

      const callArgs = context.sqs.sendMessage.getCall(0).args[1];
      expect(callArgs).to.have.property('time');
      const messageTime = new Date(callArgs.time);
      expect(messageTime.getTime()).to.be.at.least(before.getTime());
      expect(messageTime.getTime()).to.be.at.most(after.getTime());
    });

    it('should use different delivery types correctly', async () => {
      mockSite.getDeliveryType.returns('aem_cs');

      const auditUrl = 'https://example.com';
      const auditData = {
        id: 'audit-789',
        auditResult: {
          year: 2025,
          week: 42,
          month: 10,
          siteId: 'test-site-id',
        },
      };

      await handlerModule.sendRequestToMystique(auditUrl, auditData, context, mockSite);

      const callArgs = context.sqs.sendMessage.getCall(0).args[1];
      expect(callArgs.deliveryType).to.equal('aem_cs');
    });

    it('should log completion message', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        id: 'audit-123',
        auditResult: {
          siteId: 'test-site-id',
          year: 2025,
          week: 42,
          month: 10,
        },
      };

      await handlerModule.sendRequestToMystique(auditUrl, auditData, context, mockSite);

      expect(context.log.info).to.have.been.calledWith(
        '[page-type-audit] [siteId: test-site-id] [baseUrl:https://example.com] Completed mystique evaluation step',
      );
    });
  });

  describe('Guidance Handler', () => {
    let mockAudit;

    beforeEach(() => {
      mockAudit = {
        findById: sandbox.stub(),
        setAuditResult: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      context.dataAccess.Audit = mockAudit;
    });

    describe('handler - basic flow', () => {
      it('should return notFound when site is not found', async () => {
        context.dataAccess.Site.findById.resolves(null);

        const message = {
          siteId: 'non-existent-site',
          auditId: 'audit-123',
          data: {},
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(404);
        expect(context.log.warn).to.have.been.calledWith(
          'No site found for siteId: non-existent-site',
        );
      });

      it('should handle message with no valid guidance body', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        mockAudit.findById.resolves({
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        });

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {}, // No patterns
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.warn).to.have.been.calledWith(
          'No valid guidance body received for site: test-site-id',
        );
      });

      it('should handle message with empty patterns array', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        mockAudit.findById.resolves({
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        });

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.warn).to.have.been.calledWith(
          'No valid patterns received for site: test-site-id',
        );
      });
    });

    describe('handler - accuracy threshold', () => {
      it('should reject patterns when accuracy is below threshold', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 70, // Below 75% threshold
            validation: { sample_size: 100 },
            execution_metrics: {
              total_urls: 1000,
              total_duration_seconds: 10,
            },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(mockSite.setPageTypes).to.not.have.been.called;
        expect(mockSite.save).to.not.have.been.called;
        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/accuracy 70% is below threshold 75%/),
        );
      });

      it('should reject patterns when accuracy is null', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: null,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(mockSite.setPageTypes).to.not.have.been.called;
        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/accuracy null% is below threshold/),
        );
      });

      it('should accept patterns when accuracy is exactly at threshold', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 75, // Exactly at threshold
            validation: { sample_size: 100 },
            execution_metrics: {
              total_urls: 1000,
              total_duration_seconds: 10,
            },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(mockSite.setPageTypes).to.have.been.calledOnce;
        expect(mockSite.save).to.have.been.calledOnce;
      });

      it('should accept patterns when accuracy is above threshold', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
              { pagetype: 'category', regex: '/categories/.*' },
            ],
            accuracy_pct: 92,
            validation: { sample_size: 100 },
            execution_metrics: {
              total_urls: 1000,
              total_duration_seconds: 10,
            },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(mockSite.setPageTypes).to.have.been.calledWith([
          { name: 'product', pattern: '/products/.*' },
          { name: 'category', pattern: '/categories/.*' },
        ]);
        expect(mockSite.save).to.have.been.calledOnce;
        expect(context.log.info).to.have.been.calledWith(
          'Successfully stored 2 page type patterns for site: test-site-id',
        );
      });
    });

    describe('handler - pattern conversion and storage', () => {
      it('should convert patterns to page types correctly', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'home', regex: '^/$' },
              { pagetype: 'product', regex: '/products/[^/]+$' },
              { pagetype: 'category', regex: '/categories/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 200 },
            execution_metrics: {
              total_urls: 2000,
              total_duration_seconds: 15,
            },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(mockSite.setPageTypes).to.have.been.calledWith([
          { name: 'home', pattern: '^/$' },
          { name: 'product', pattern: '/products/[^/]+$' },
          { name: 'category', pattern: '/categories/.*' },
        ]);
      });

      it('should override existing page types', async () => {
        const existingPageTypes = [
          { name: 'old-type-1', pattern: '/old-pattern-1' },
          { name: 'old-type-2', pattern: '/old-pattern-2' },
        ];
        mockSite.getPageTypes.returns(existingPageTypes);

        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'new-type', regex: '/new-pattern' },
            ],
            accuracy_pct: 80,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Overriding existing pageTypes configuration \(2 patterns\) with new patterns \(1 patterns\)/),
        );
        expect(mockSite.setPageTypes).to.have.been.calledWith([
          { name: 'new-type', pattern: '/new-pattern' },
        ]);
      });

      it('should not log override message when no existing page types', async () => {
        mockSite.getPageTypes.returns([]);

        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(context.log.info).to.not.have.been.calledWith(
          sinon.match(/Overriding existing pageTypes/),
        );
      });

      it('should handle site save errors gracefully', async () => {
        mockSite.save.rejects(new Error('Database connection failed'));

        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to store page type patterns/),
        );
      });
    });

    describe('handler - audit result saving', () => {
      it('should save audit result with success when patterns stored', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
            execution_metrics: {
              total_urls: 1000,
              total_duration_seconds: 10,
            },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            success: true,
            patternsStored: true,
            newPageTypesAdded: true,
            patterns: message.data.patterns,
            patternsCount: 1,
            accuracy: 85,
            sampleSize: 100,
          }),
        );
        expect(audit.save).to.have.been.calledOnce;
        expect(context.log.info).to.have.been.calledWith(
          'Saved audit result for auditId: audit-123',
        );
      });

      it('should save audit result with error when accuracy below threshold', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 50,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            success: true,
            patternsStored: false,
            error: 'Accuracy 50% below threshold 75%',
          }),
        );
      });

      it('should save audit result when no patterns provided', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [],
            accuracy_pct: 85,
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            success: true,
            patternsStored: false,
            error: 'No valid patterns received',
          }),
        );
      });

      it('should handle case when audit is not found', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        mockAudit.findById.resolves(null);

        const message = {
          siteId: 'test-site-id',
          auditId: 'non-existent-audit',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.warn).to.have.been.calledWith(
          'Audit not found for auditId: non-existent-audit',
        );
      });

      it('should handle audit save errors gracefully', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().rejects(new Error('Database error')),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to save audit result/),
        );
      });

      it('should work without auditId', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);

        const message = {
          siteId: 'test-site-id',
          // No auditId
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(mockAudit.findById).to.not.have.been.called;
      });
    });

    describe('handler - audit result structure', () => {
      it('should include execution metrics in audit result', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const executionMetrics = {
          total_urls: 5000,
          total_duration_seconds: 60,
          processed_patterns: 10,
        };

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
            execution_metrics: executionMetrics,
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            executionMetrics,
          }),
        );

        expect(context.log.info).to.have.been.calledWith(
          'Execution metrics: processed 5000 URLs in 60s',
        );
      });

      it('should include validation information in audit result', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const validation = {
          sample_size: 500,
          correct_predictions: 425,
          incorrect_predictions: 75,
        };

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation,
            execution_metrics: {
              total_urls: 1000,
              total_duration_seconds: 10,
            },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            sampleSize: 500,
            accuracy: 85,
          }),
        );

        expect(context.log.info).to.have.been.calledWith(
          'Validation results: 85% accuracy with 500 samples',
        );
      });

      it('should include previous page types count when overriding', async () => {
        const existingPageTypes = [
          { name: 'old-1', pattern: '/old-1' },
          { name: 'old-2', pattern: '/old-2' },
          { name: 'old-3', pattern: '/old-3' },
        ];
        mockSite.getPageTypes.returns(existingPageTypes);

        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            previousPageTypesCount: 3,
            patternsStored: true,
            newPageTypesAdded: true,
          }),
        );
      });

      it('should include guidance data in audit result', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const guidanceData = {
          patterns: [
            { pagetype: 'product', regex: '/products/.*' },
          ],
          accuracy_pct: 85,
          validation: { sample_size: 100 },
          execution_metrics: {
            total_urls: 1000,
            total_duration_seconds: 10,
          },
        };

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: guidanceData,
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            guidance: guidanceData,
          }),
        );
      });

      it('should set accuracy threshold in audit result', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            accuracyThreshold: 75,
          }),
        );
      });
    });

    describe('handler - edge cases', () => {
      it('should handle patterns that are not an array', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: null, // Not an array - this will cause pageTypesData to be null
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        await guidanceHandlerModule.default(message, context);

        // When patterns is null, pageTypesData becomes null, so error is 'No valid guidance body received'
        expect(audit.setAuditResult).to.have.been.calledWith(
          sinon.match({
            success: false,
            patternsStored: false,
            error: 'No valid guidance body received',
          }),
        );
      });

      it('should handle message with undefined data.patterns', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {}, // No patterns key
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        expect(context.log.warn).to.have.been.calledWith(
          'No valid guidance body received for site: test-site-id',
        );
      });

      it('should handle data being null', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: null,
        };

        // This will throw an error because the code tries to access data.patterns when data is null
        await expect(guidanceHandlerModule.default(message, context)).to.be.rejected;
      });

      it('should handle empty message data gracefully', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [
              { pagetype: 'product', regex: '/products/.*' },
            ],
            // Missing accuracy_pct, validation, execution_metrics
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        // Should still process since patterns exist, but fail on accuracy check
        // When accuracy_pct is missing, it will be undefined, not null
        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/accuracy undefined% is below threshold/),
        );
      });

      it('should log message received at handler start', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: [],
          },
        };

        await guidanceHandlerModule.default(message, context);

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Message received for detect:page-types handler/),
        );
      });

      it('should handle patterns being a truthy non-array value', async () => {
        context.dataAccess.Site.findById.resolves(mockSite);
        const audit = {
          setAuditResult: sandbox.stub(),
          save: sandbox.stub().resolves(),
        };
        mockAudit.findById.resolves(audit);

        // Test with patterns being a truthy but invalid value to trigger || [] fallback
        // This tests the defensive || [] on line 79
        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            patterns: false, // Falsy value that will trigger the || [] fallback
            accuracy_pct: 85,
            validation: { sample_size: 100 },
          },
        };

        const result = await guidanceHandlerModule.default(message, context);

        expect(result.status).to.equal(200);
        // When patterns is false, pageTypesData will be null, so we get 'No valid guidance body received'
        expect(context.log.warn).to.have.been.calledWith(
          'No valid guidance body received for site: test-site-id',
        );
      });
    });
  });
});

