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
import nock from 'nock';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import mystiqueDetectedFormAccessibilityHandler, { transformAxeViolationsToA11yData } from '../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

describe('Forms Opportunities - Accessibility Handler', () => {
  let sandbox;
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('a11yOpportunityFilter behavior', () => {
    it('should verify the filter logic for Forms Accessibility tag', () => {
      const opportunityWithTag = {
        getTags: () => ['Forms Accessibility', 'Other Tag'],
      };
      const opportunityWithoutTag = {
        getTags: () => ['Other Tag', 'Another Tag'],
      };

      // Test the filter logic that would be used in a11yOpportunityFilter
      const filterLogic = (opportunity) => opportunity.getTags().includes('Forms Accessibility');

      expect(filterLogic(opportunityWithTag)).to.be.true;
      expect(filterLogic(opportunityWithoutTag)).to.be.false;
    });

    it('should test the complete flow with opportunities that need to be updated to IGNORED', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: '<img src="test.jpg">',
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };

      // Mock existing opportunities that have Forms Accessibility tag
      const existingOpportunity = {
        getTags: () => ['Forms Accessibility'],
        setStatus: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      const context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          dataAccess: {
            Opportunity: {
              // Return existing opportunities when queried for NEW status
              allBySiteIdAndStatus: sandbox.stub().callsFake(async (siteId, status) => {
                if (status === 'NEW') {
                  return [existingOpportunity];
                }
                return [];
              }),
              create: sandbox.stub().resolves({
                getId: () => 'new-opportunity-id',
              }),
              findById: sandbox.stub().resolves(null), // No existing opportunity with this ID
            },
            Site: {
              findById: sandbox.stub().resolves({
                getDeliveryType: sinon.stub().returns('aem'),
                getBaseURL: sinon.stub().returns('https://example.com'),
              }),
            },
          },
          sqs: {
            sendMessage: sandbox.stub().resolves(),
          },
          env: {
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          },
          log: {
            info: sinon.stub(),
            error: sinon.stub(),
            debug: sinon.stub(),
          },
        })
        .build();

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      // Verify that allBySiteIdAndStatus was called to find opportunities to update
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith('test-site-id', 'NEW');

      // Verify that the existing opportunity was updated to IGNORED status
      expect(existingOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      expect(existingOpportunity.save).to.have.been.calledOnce;

      // Verify that a new opportunity was created
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
    });
  });

  describe('createAccessibilityOpportunity', () => {
    let context;
    const siteId = 'test-site-id';
    const bucketName = 'test-bucket';

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          runtime: { name: 'aws-lambda', region: 'us-east-1' },
          func: { package: 'spacecat-services', version: 'ci', name: 'test' },
          site: {
            getId: sinon.stub().returns(siteId),
            getBaseURL: sinon.stub().returns('https://example.com'),
            getDeliveryType: sinon.stub().returns('aem'),
          },
          env: {
            S3_SCRAPER_BUCKET_NAME: bucketName,
            S3_IMPORTER_BUCKET_NAME: 'test-importer-bucket',
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
            IMPORT_WORKER_QUEUE_URL: 'test-import-worker-queue',
          },
          s3Client: {
            send: sandbox.stub(),
          },
          sqs: {
            sendMessage: sandbox.stub().resolves(),
          },
          log: {
            info: sinon.stub(),
            error: sinon.stub(),
            debug: sinon.stub(),
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves({
                getId: () => 'test-opportunity-id',
                getData: () => ({
                  form: 'test-form',
                  formsource: 'test-source',
                  a11yIssues: [],
                }),
              }),
              findById: sandbox.stub().resolves(null),
            },
          },
        })
        .build();
    });

    afterEach(() => {
      nock.cleanAll();
      sinon.restore();
      sandbox.restore();
    });

    it('should not create opportunities when aggregation fails', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return failure
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: false,
        message: 'No data found for aggregation',
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity]  No data aggregated for site test-site-id (https://example.com): No data found for aggregation',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should not create opportunity if no a11yData is generated', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success but with only overall data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] No a11y data found to create or update opportunity ',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should not create opportunity if no a11yIssues are present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with data but no violations
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] No a11y issues found to create or update opportunity',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should create opportunities when a11y issues are present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 5,
                critical: { count: 2, items: {} },
                serious: { count: 3, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 1,
                  items: {
                    'color-contrast': {
                      count: 1,
                      description: 'Elements must meet minimum color contrast ratio thresholds',
                      level: 'AA',
                      successCriteriaTags: ['wcag143'],
                      htmlWithIssues: ['<span>(Optional)</span>'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.siteId).to.equal(siteId);
      expect(createArgs.auditId).to.equal('test-audit-id');
      expect(createArgs.type).to.equal(FORM_OPPORTUNITY_TYPES.FORM_A11Y);
      expect(createArgs.origin).to.equal('AUTOMATION');
      expect(createArgs.data.accessibility).to.have.lengthOf(1);
      expect(createArgs.data.accessibility[0].form).to.equal('https://example.com/form1');
      expect(createArgs.data.accessibility[0].formSource).to.equal('contact-form');
      expect(createArgs.data.accessibility[0].a11yIssues).to.have.lengthOf(2);

      // Verify SQS messages were sent - both to importer-worker and mystique
      expect(sendRunImportMessageStub).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

      // Verify importer-worker message parameters
      expect(sendRunImportMessageStub).to.have.been.calledWith(
        context.sqs,
        'test-import-worker-queue',
        'a11y-metrics-aggregator',
        siteId,
        sinon.match({
          scraperBucketName: 'test-bucket',
          importerBucketName: 'test-importer-bucket',
          version: sinon.match.string,
          urlSourceSeparator: '?source=',
          totalChecks: 50,
          options: {},
        }),
      );

      // Verify mystique message parameters
      const sqsMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sqsMessage.type).to.equal('detect:forms-a11y');
      expect(sqsMessage.siteId).to.equal(siteId);
      expect(sqsMessage.auditId).to.equal('test-audit-id');
      expect(sqsMessage.deliveryType).to.equal('aem');
      expect(sqsMessage.data.url).to.equal('https://example.com');
      expect(sqsMessage.data.opportunityId).to.equal('test-opportunity-id');
    });

    it('should handle multiple forms with violations', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with multiple forms
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 4,
                critical: { count: 2, items: {} },
                serious: { count: 2, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 1,
                  items: {
                    'color-contrast': {
                      count: 1,
                      description: 'Elements must meet minimum color contrast ratio thresholds',
                      level: 'AA',
                      successCriteriaTags: ['wcag143'],
                      htmlWithIssues: ['<span>(Optional)</span>'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
              },
            },
            'https://example.com/form2?source=newsletter-form': {
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {
                    'missing-alt': {
                      count: 1,
                      description: 'Images must have alternative text',
                      level: 'A',
                      successCriteriaTags: ['wcag111'],
                      htmlWithIssues: ['<img src="test.jpg">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 1,
                  items: {
                    'target-size': {
                      count: 1,
                      description: 'All touch targets must be 24px large',
                      level: 'AA',
                      successCriteriaTags: ['wcag258'],
                      htmlWithIssues: ['<button class="icon">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.data.accessibility).to.have.lengthOf(2);

      // Check first form
      expect(createArgs.data.accessibility[0].form).to.equal('https://example.com/form1');
      expect(createArgs.data.accessibility[0].formSource).to.equal('contact-form');
      expect(createArgs.data.accessibility[0].a11yIssues).to.have.lengthOf(2);

      // Check second form
      expect(createArgs.data.accessibility[1].form).to.equal('https://example.com/form2');
      expect(createArgs.data.accessibility[1].formSource).to.equal('newsletter-form');
      expect(createArgs.data.accessibility[1].a11yIssues).to.have.lengthOf(2);

      // Verify both importer-worker and mystique messages were sent
      expect(sendRunImportMessageStub).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should handle forms without composite keys (legacy format)', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with legacy format (no separator)
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.data.accessibility).to.have.lengthOf(1);
      expect(createArgs.data.accessibility[0].form).to.equal('https://example.com/form1');
      expect(createArgs.data.accessibility[0].formSource).to.equal(null);
      expect(createArgs.data.accessibility[0].a11yIssues).to.have.lengthOf(1);
    });

    it('should handle errors when processing a11y data', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to throw error
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.rejects(new Error('Aggregation error'));

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.error).to.have.been.calledWith('[Form Opportunity] [Site Id: test-site-id] Error creating a11y issues: Aggregation error');
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should fail while creating a new opportunity', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      context.dataAccess.Opportunity.create = sandbox.stub().rejects(new Error('Network error'));

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);
      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Failed to create/update a11y opportunity with error: Network error',
      );
    });

    it('should continue processing even when updateStatusToIgnored returns failure', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with actual violations
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/page1?source=contact-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    label: {
                      count: 1,
                      description: 'Form elements must have labels',
                      level: 'A',
                      successCriteriaTags: ['wcag131'],
                      htmlWithIssues: ['<input type="text">'],
                      failureSummary: 'Fix any of the following: Form element does not have a label',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock updateStatusToIgnored to return a failure result (not reject)
      const updateStatusToIgnoredStub = sandbox.stub().resolves({
        success: false,
        updatedCount: 0,
        error: 'Failed to update some opportunities',
      });

      // Mock the created opportunity
      const createdOpportunity = {
        getId: () => 'opportunity-123',
      };
      context.dataAccess.Opportunity.create.resolves(createdOpportunity);

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
        '../../../src/accessibility/utils/scrape-utils.js': {
          updateStatusToIgnored: updateStatusToIgnoredStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify updateStatusToIgnored was called
      expect(updateStatusToIgnoredStub).to.have.been.calledOnce;

      // Verify that the opportunity was still created despite updateStatusToIgnored failure
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;

      // Verify that both SQS messages were still sent
      expect(sendRunImportMessageStub).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'test-queue',
        sinon.match({
          type: 'detect:forms-a11y',
          siteId,
          auditId: 'test-audit-id',
        }),
      );

      // Verify success was logged (not error)
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/a11y opportunity created.*and sent to mystique/),
      );

      // Verify no error was logged since the function continues normally
      expect(context.log.error).to.not.have.been.called;
    });

    it('should handle SQS message sending failure gracefully', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      // Mock SQS to fail
      context.sqs.sendMessage = sandbox.stub().rejects(new Error('SQS service unavailable'));

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Error creating a11y issues: SQS service unavailable',
      );
    });

    it('should handle malformed composite keys gracefully', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with malformed composite keys
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=': { // Malformed: missing formSource
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.data.accessibility).to.have.lengthOf(1);

      // Check that malformed key is handled gracefully
      const form1Data = createArgs.data.accessibility.find((a) => a.form === 'https://example.com/form1');
      expect(form1Data.formSource).to.equal(''); // Empty formSource for malformed key
    });

    it('should not create opportunities when no content is present in aggregationResult', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success but with empty current data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            // Only overall data exists, no form-specific analysis
            overall: {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] No a11y data found to create or update opportunity ',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should handle empty violations items gracefully', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with empty violations items
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {}, // Empty items
                },
                serious: {
                  count: 1,
                  items: {}, // Empty items
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] No a11y issues found to create or update opportunity',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should handle missing violations object gracefully', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with missing violations object
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
                critical: { count: 0, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              // Missing violations object
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] No a11y issues found to create or update opportunity',
      );
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should handle mixed data types (forms and regular pages)', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with mixed data types
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
                critical: { count: 2, items: {} },
                serious: { count: 1, items: {} },
              },
            },
            'https://example.com/page1': { // Regular page (no separator)
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'missing-alt': {
                      count: 1,
                      description: 'Images must have alternative text',
                      level: 'A',
                      successCriteriaTags: ['wcag111'],
                      htmlWithIssues: ['<img src="test.jpg">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
            'https://example.com/form1?source=contact-form': { // Form (with separator)
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 1,
                  items: {
                    'color-contrast': {
                      count: 1,
                      description: 'Elements must meet minimum color contrast ratio thresholds',
                      level: 'AA',
                      successCriteriaTags: ['wcag143'],
                      htmlWithIssues: ['<span>(Optional)</span>'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.data.accessibility).to.have.lengthOf(2);

      // Check that both regular pages and forms are processed correctly
      const pageData = createArgs.data.accessibility.find((a) => a.form === 'https://example.com/page1');
      const formData = createArgs.data.accessibility.find((a) => a.form === 'https://example.com/form1');

      expect(pageData.formSource).to.equal(null); // Regular page has no formSource
      expect(formData.formSource).to.equal('contact-form'); // Form has formSource
    });

    it('should successfully create accessibility opportunity with transformed data and send to Mystique', async () => {
      // Arrange - Set up the audit data
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return realistic aggregated data with violations
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
                critical: { count: 2, items: {} },
                serious: { count: 1, items: {} },
              },
            },
            'https://example.com/contact?source=contact-form': {
              violations: {
                total: 2,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following: Element does not have a label',
                    },
                  },
                },
                serious: {
                  count: 1,
                  items: {
                    'color-contrast': {
                      count: 3,
                      description: 'Elements must have sufficient color contrast',
                      level: 'AA',
                      successCriteriaTags: ['wcag143'],
                      htmlWithIssues: ['<button class="submit">Submit</button>'],
                      failureSummary: 'Fix any of the following: Element has insufficient color contrast',
                    },
                  },
                },
              },
            },
            'https://example.com/signup?source=newsletter-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    label: {
                      count: 2,
                      description: 'Form elements must have labels',
                      level: 'A',
                      successCriteriaTags: ['wcag131'],
                      htmlWithIssues: ['<input type="email" name="email">'],
                      failureSummary: 'Fix any of the following: Form element does not have a label',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock the created opportunity
      const createdOpportunity = {
        getId: () => 'opportunity-123',
      };
      context.dataAccess.Opportunity.create.resolves(createdOpportunity);

      // Mock the module to override the imported function
      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      // Act - Execute the function
      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Assert - Verify the aggregation was called correctly
      expect(aggregateAccessibilityDataStub).to.have.been.calledOnce;
      expect(aggregateAccessibilityDataStub).to.have.been.calledWith(
        context.s3Client,
        'test-bucket',
        siteId,
        context.log,
        sinon.match.string, // outputKey
        'forms-opportunities',
        sinon.match.string, // version
      );

      // Assert - Verify opportunity was created with correctly transformed data
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const opportunityData = context.dataAccess.Opportunity.create.getCall(0).args[0];

      expect(opportunityData).to.deep.include({
        siteId,
        auditId: 'test-audit-id',
        type: 'form-accessibility',
        origin: 'AUTOMATION',
        title: 'Form accessibility report',
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/Ebpoflp2gHFNl4w5-9C7dFEBBHHE4gTaRzHaofqSxJMuuQ?e=Ss6mep',
      });

      // Verify the transformed accessibility data
      expect(opportunityData.data.accessibility).to.have.lengthOf(2);

      // Check first form's transformed data
      const contactForm = opportunityData.data.accessibility.find(
        (item) => item.form === 'https://example.com/contact',
      );
      expect(contactForm).to.deep.include({
        form: 'https://example.com/contact',
        formSource: 'contact-form',
      });
      expect(contactForm.a11yIssues).to.have.lengthOf(2);
      expect(contactForm.a11yIssues[0]).to.deep.include({
        issue: 'Select element must have an accessible name',
        level: 'A',
        recommendation: 'Fix any of the following: Element does not have a label',
      });
      expect(contactForm.a11yIssues[0].successCriterias[0]).to.deep.include({
        name: 'Name, Role, Value',
        criteriaNumber: '4.1.2',
      });

      // Check second form's transformed data
      const newsletterForm = opportunityData.data.accessibility.find(
        (item) => item.form === 'https://example.com/signup',
      );
      expect(newsletterForm).to.deep.include({
        form: 'https://example.com/signup',
        formSource: 'newsletter-form',
      });
      expect(newsletterForm.a11yIssues).to.have.lengthOf(1);

      // Assert - Verify message was sent to importer-worker queue
      expect(sendRunImportMessageStub).to.have.been.calledOnce;
      expect(sendRunImportMessageStub).to.have.been.calledWith(
        context.sqs,
        'test-import-worker-queue',
        'a11y-metrics-aggregator',
        siteId,
        sinon.match({
          scraperBucketName: 'test-bucket',
          importerBucketName: 'test-importer-bucket',
          version: sinon.match.string,
          urlSourceSeparator: '?source=',
          totalChecks: 50,
          options: {},
        }),
      );
      // Assert - Verify message was sent to Mystique queue
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'test-queue',
        sinon.match({
          type: 'detect:forms-a11y',
          siteId,
          auditId: 'test-audit-id',
          deliveryType: 'aem',
          data: {
            url: 'https://example.com',
            opportunityId: 'opportunity-123',
            a11y: sinon.match.array,
          },
        }),
      );

      // Verify the Mystique message contains the transformed data
      const mystiqueMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(mystiqueMessage.data.a11y).to.have.lengthOf(2);
      expect(mystiqueMessage.data.a11y[0]).to.deep.include({
        form: 'https://example.com/contact',
        formSource: 'contact-form',
      });

      // Assert - Verify success log message
      expect(context.log.debug).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] a11y opportunity created (if issues found) and sent to mystique',
      );
    });

    it('should handle sendRunImportMessage failure gracefully but prevent mystique message', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'select-name': {
                      count: 1,
                      description: 'Select element must have an accessible name',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<select id="inquiry">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      // Mock sendRunImportMessage to fail
      const sendRunImportMessageStub = sandbox.stub().rejects(new Error('Import worker queue unavailable'));
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify sendRunImportMessage was called and failed
      expect(sendRunImportMessageStub).to.have.been.calledOnce;

      // Verify that failure is handled gracefully and error is logged
      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Error creating a11y issues: Import worker queue unavailable',
      );

      // Verify that opportunity creation happened (it occurs before sendRunImportMessage)
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;

      // Verify that mystique message sending didn't happen due to error
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should verify importer-worker message parameters are correct', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=test-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'button-name': {
                      count: 1,
                      description: 'Buttons must have discernible text',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      htmlWithIssues: ['<button></button>'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify sendRunImportMessage was called with exactly the right parameters
      expect(sendRunImportMessageStub).to.have.been.calledOnce;
      expect(sendRunImportMessageStub).to.have.been.calledWith(
        context.sqs,
        'test-import-worker-queue',
        'a11y-metrics-aggregator',
        'test-site-id',
        sinon.match({
          scraperBucketName: 'test-bucket',
          importerBucketName: 'test-importer-bucket',
          version: sinon.match(/^\d{4}-\d{2}-\d{2}$/), // Should match YYYY-MM-DD format
          urlSourceSeparator: '?source=',
          totalChecks: 50,
          options: sinon.match({}),
        }),
      );

      // Verify the data object structure has all required properties
      const importMessageCall = sendRunImportMessageStub.getCall(0);
      const dataParam = importMessageCall.args[4];
      expect(dataParam).to.have.property('scraperBucketName', 'test-bucket');
      expect(dataParam).to.have.property('importerBucketName', 'test-importer-bucket');
      expect(dataParam).to.have.property('urlSourceSeparator', '?source=');
      expect(dataParam).to.have.property('totalChecks', 50);
      expect(dataParam).to.have.property('options');
      expect(dataParam.options).to.be.an('object');
    });

    it('should send importer-worker message even when mystique message fails', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations data
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { count: 1, items: {} },
                serious: { count: 0, items: {} },
              },
            },
            'https://example.com/form1?source=contact-form': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'image-alt': {
                      count: 1,
                      description: 'Images must have alternative text',
                      level: 'A',
                      successCriteriaTags: ['wcag111'],
                      htmlWithIssues: ['<img src="test.jpg">'],
                      failureSummary: 'Fix any of the following...',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
          },
        },
      });

      const sendRunImportMessageStub = sandbox.stub().resolves();
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sendRunImportMessageStub,
        },
      });

      // Mock SQS to fail for mystique message
      context.sqs.sendMessage = sandbox.stub().rejects(new Error('Mystique queue unavailable'));

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify both opportunity creation and importer-worker message were successful
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(sendRunImportMessageStub).to.have.been.calledOnce;

      // Verify error was logged due to mystique message failure
      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Error creating a11y issues: Mystique queue unavailable',
      );
    });
  });

  describe('accessibility handle - mystique detected', async () => {
    let context;
    const siteId = 'test-site-id';
    const auditId = 'test-audit-id';
    const opportunityId = 'test-opportunity-id';
    let mockOpportunityData;

    beforeEach(() => {
      mockOpportunityData = {
        accessibility: [{
          form: 'https://example.com/form1',
          formSource: '#form1',
          a11yIssues: [{
            issue: 'Missing alt text',
            level: 'error',
            successCriterias: ['1.1.1 Non-text Content'],
            htmlWithIssues: ['<img src="test.jpg">'],
            recommendation: 'Add alt text to image',
          }],
        }],
      };
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          runtime: { name: 'aws-lambda', region: 'us-east-1' },
          func: { package: 'spacecat-services', version: 'ci', name: 'test' },
          site: {
            getId: sinon.stub().returns(siteId),
            getBaseURL: sinon.stub().returns('https://example.com'),
            getDeliveryType: sinon.stub().returns('aem'),
          },
          env: {
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          },
          sqs: {
            sendMessage: sandbox.stub().resolves(),
          },
          log: {
            info: sinon.stub(),
            error: sinon.stub(),
            debug: sinon.stub(),
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              findById: sandbox.stub().resolves({
                getId: () => opportunityId,
                save: sandbox.stub().resolves({
                  getId: () => opportunityId,
                  getData: () => ({
                    accessibility: [{
                      form: 'test-form',
                      formsource: 'test-source',
                      a11yIssues: [],
                    }],
                  }),
                }),
                getData: () => mockOpportunityData,
                setData: (data) => {
                  mockOpportunityData = data;
                },
              }),
              create: sandbox.stub().resolves({
                getId: () => opportunityId,
                setUpdatedBy: sandbox.stub(),
                setAuditId: sandbox.stub(),
              }),
            },
            Site: {
              findById: sandbox.stub().resolves({
                getDeliveryType: sinon.stub().returns('aem'),
                getBaseURL: sinon.stub().returns('https://example.com'),
              }),
            },
          },
        })
        .build();
    });

    it('should process message and send to mystique for quality agent', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: ['<img src="test.jpg">'],
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sqsMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sqsMessage.type).to.equal('detect:form-details');
    });

    it('should process message and send to mystique for guidance', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: ['<img src="test.jpg">'],
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          runtime: { name: 'aws-lambda', region: 'us-east-1' },
          func: { package: 'spacecat-services', version: 'ci', name: 'test' },
          site: {
            getId: sinon.stub().returns(siteId),
            getBaseURL: sinon.stub().returns('https://example.com'),
            getDeliveryType: sinon.stub().returns('aem'),
          },
          env: {
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          },
          sqs: {
            sendMessage: sandbox.stub().resolves(),
          },
          log: {
            info: sinon.stub(),
            debug: sinon.stub(),
            error: sinon.stub(),
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              findById: sandbox.stub().resolves({
                getId: () => opportunityId,
                save: sandbox.stub().resolves({
                  getType: () => 'form-accessibility',
                  getId: () => opportunityId,
                  getData: () => ({
                    accessibility: [{
                      form: 'test-form-2',
                      formDetails: {
                        is_lead_gen: true,
                        industry: 'Insurance',
                        form_type: 'Quote Request Form',
                        form_category: 'B2C',
                        cpl: 230.6,
                      },
                      formsource: 'test-source',
                      a11yIssues: [],
                    }],
                  }),
                }),
                getData: () => mockOpportunityData,
                setData: (data) => {
                  mockOpportunityData = data;
                },
              }),
              create: sandbox.stub().resolves({
                getId: () => opportunityId,
                setUpdatedBy: sandbox.stub(),
                setAuditId: sandbox.stub(),
              }),
            },
            Site: {
              findById: sandbox.stub().resolves({
                getDeliveryType: sinon.stub().returns('aem'),
                getBaseURL: sinon.stub().returns('https://example.com'),
              }),
            },
          },
        })
        .build();

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
    });

    it('should not send message to mystique when no opportunity is found', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId: null,
          a11y: [],
        },
      };

      await mystiqueDetectedFormAccessibilityHandler(message, context);
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] A11y opportunity not detected, skipping guidance',
      );
    });

    it('should append accessibility issue detected by mystique', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: ['<img src="test.jpg">'],
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };
      mockOpportunityData = {
        accessibility: [{
          form: 'https://example.com/form1',
          formSource: '#form1',
          a11yIssues: [],
        }],
      };

      // mock existing opportunity
      context.dataAccess.Opportunity.findById.resolves({
        save: sandbox.stub().resolves({
          getId: () => opportunityId,
          getData: () => ({
            form: 'test-form',
            formsource: 'test-source',
            a11yIssues: [],
          }),
        }),
        setUpdatedBy: sandbox.stub(),
        getData: () => mockOpportunityData,
        setData: (data) => {
          mockOpportunityData = data;
        },
      });

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnce;
      const existingOpportunity = await context.dataAccess.Opportunity.findById
        .getCall(0).returnValue;
      expect(existingOpportunity.getData().accessibility).to.have.lengthOf(1);
      expect(existingOpportunity.getData().accessibility[0].a11yIssues).to.have.lengthOf(1);
      expect(existingOpportunity.save).to.have.been.calledOnce;
    });

    it('should append a11y issues from mystique with empty axe issues', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: ['<img src="test.jpg">'],
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };
      mockOpportunityData = {
        accessibility: [{
          form: 'https://example.com/form2',
          formSource: '#form2',
          a11yIssues: [{
            issue: 'label missing',
            level: 'A',
            successCriterias: ['1.1.1'],
            htmlWithIssues: ['<label>test</label>'],
            recommendation: 'Add label to input',
          }],
        }],
      };
      // mock existing opportunity
      context.dataAccess.Opportunity.findById.resolves({
        save: sandbox.stub().resolves({
          getId: () => opportunityId,
        }),
        setUpdatedBy: sandbox.stub(),
        getData: () => mockOpportunityData,
        setData: (data) => {
          mockOpportunityData = data;
        },
      });

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnce;
      const existingOpportunity = await context.dataAccess.Opportunity.findById
        .getCall(0).returnValue;
      expect(existingOpportunity.getData().accessibility).to.have.lengthOf(2);
      expect(existingOpportunity.getData().accessibility[0].a11yIssues).to.have.lengthOf(1);
      expect(existingOpportunity.save).to.have.been.calledOnce;
    });

    it('should create a new opportunity when no existing opportunity is found', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: '<img src="test.jpg">',
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };
      await mystiqueDetectedFormAccessibilityHandler(message, context);
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.siteId).to.equal(siteId);
      expect(createArgs.auditId).to.equal('test-audit-id');
      expect(createArgs.type).to.equal(FORM_OPPORTUNITY_TYPES.FORM_A11Y);

      // Verify updateStatusToIgnored was called by checking the dataAccess calls
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith(siteId, 'NEW');
    });

    it('should not call updateStatusToIgnored when updating existing opportunity', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: '<img src="test.jpg">',
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      // Verify updateStatusToIgnored was NOT called when updating existing opportunity
      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.not.have.been.called;
      expect(context.dataAccess.Opportunity.findById).to.have.been.calledWith(opportunityId);
    });

    it('should handle errors when processing message', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              issue: 'Missing alt text',
              level: 'error',
              successCriterias: ['1.1.1'],
              htmlWithIssues: '<img src="test.jpg">',
              recommendation: 'Add alt text to image',
            }],
          }],
        },
      };

      context.dataAccess.Opportunity.findById.rejects(new Error('Database error'));

      try {
        await mystiqueDetectedFormAccessibilityHandler(message, context);
      } catch (error) {
        expect(error.message).to.equal(
          '[Form Opportunity] [Site Id: test-site-id] Failed to create/update a11y opportunity with error: Database error',
        );
      }
    });
  });

  describe('transformAxeViolationsToA11yData', () => {
    it('should transform axe-core data with both critical and serious violations', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {
              'select-name': {
                count: 2,
                description: 'Select element must have an accessible name',
                level: 'A',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<select id="inquiry">'],
                failureSummary: 'Fix any of the following...',
              },
            },
          },
          serious: {
            items: {
              'color-contrast': {
                count: 2,
                description: 'Elements must meet minimum color contrast ratio thresholds',
                level: 'AA',
                successCriteriaTags: ['wcag143'],
                htmlWithIssues: ['<span>(Optional)</span>'],
                failureSummary: 'Fix any of the following...',
              },
            },
          },
        },
        url: 'https://www.sunstar.com/contact',
        formSource: 'form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://www.sunstar.com/contact',
        formSource: 'form',
        a11yIssues: [
          {
            issue: 'Select element must have an accessible name',
            level: 'A',
            successCriterias: ['4.1.2 Name, Role, Value'],
            htmlWithIssues: ['<select id="inquiry">'],
            recommendation: 'Fix any of the following...',
          },
          {
            issue: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            successCriterias: ['1.4.3 Contrast (Minimum)'],
            htmlWithIssues: ['<span>(Optional)</span>'],
            recommendation: 'Fix any of the following...',
          },
        ],
      });
    });

    it('should transform axe-core data with only critical violations', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {
              'select-name': {
                count: 1,
                description: 'Select element must have an accessible name',
                level: 'A',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<select id="inquiry">'],
                failureSummary: 'Fix any of the following...',
              },
            },
          },
          serious: {
            items: {},
          },
        },
        url: 'https://example.com/form',
        formSource: 'contact-form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'contact-form',
        a11yIssues: [
          {
            issue: 'Select element must have an accessible name',
            level: 'A',
            successCriterias: ['4.1.2 Name, Role, Value'],
            htmlWithIssues: ['<select id="inquiry">'],
            recommendation: 'Fix any of the following...',
          },
        ],
      });
    });

    it('should transform axe-core data with only serious violations', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {},
          },
          serious: {
            items: {
              'color-contrast': {
                count: 2,
                description: 'Elements must meet minimum color contrast ratio thresholds',
                level: 'AA',
                successCriteriaTags: ['wcag143'],
                htmlWithIssues: ['<span>(Optional)</span>'],
                failureSummary: 'Fix any of the following...',
              },
              'target-size': {
                count: 1,
                description: 'All touch targets must be 24px large',
                level: 'AA',
                successCriteriaTags: ['wcag258'],
                htmlWithIssues: ['<button class="icon">'],
                failureSummary: 'Fix any of the following...',
              },
            },
          },
        },
        url: 'https://example.com/form',
        formSource: 'newsletter-form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'newsletter-form',
        a11yIssues: [
          {
            issue: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            successCriterias: ['1.4.3 Contrast (Minimum)'],
            htmlWithIssues: ['<span>(Optional)</span>'],
            recommendation: 'Fix any of the following...',
          },
          {
            issue: 'All touch targets must be 24px large',
            level: 'AA',
            successCriterias: ['2.5.8 Target Size (Minimum)'],
            htmlWithIssues: ['<button class="icon">'],
            recommendation: 'Fix any of the following...',
          },
        ],
      });
    });

    it('should handle axe-core data with no violations', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {},
          },
          serious: {
            items: {},
          },
        },
        url: 'https://example.com/form',
        formSource: 'empty-form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'empty-form',
        a11yIssues: [],
      });
    });

    it('should handle axe-core data with missing violations object gracefully', () => {
      // Arrange
      const axeData = {
        url: 'https://example.com/form',
        formSource: 'no-violations',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'no-violations',
        a11yIssues: [],
      });
    });

    it('should handle axe-core data with missing critical and serious properties', () => {
      // Arrange
      const axeData = {
        violations: {},
        url: 'https://example.com/form',
        formSource: 'missing-properties',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'missing-properties',
        a11yIssues: [],
      });
    });

    it('should handle axe-core data with missing items arrays', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {},
          serious: {},
        },
        url: 'https://example.com/form',
        formSource: 'missing-items',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://example.com/form',
        formSource: 'missing-items',
        a11yIssues: [],
      });
    });

    it('should handle multiple violations of the same type', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {
              'select-name': {
                count: 2,
                description: 'Select element must have an accessible name',
                level: 'A',
                successCriteriaTags: ['wcag412'],
                htmlWithIssues: ['<select id="inquiry">', '<select id="region">'],
                failureSummary: 'Fix any of the following...',
              },
              'missing-alt': {
                count: 1,
                description: 'Images must have alternative text',
                level: 'A',
                successCriteriaTags: ['wcag111'],
                htmlWithIssues: ['<img src="test.jpg">'],
                failureSummary: 'Fix any of the following...',
              },
            },
          },
          serious: {
            items: {},
          },
        },
        url: 'https://example.com/form',
        formSource: 'multiple-violations',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result.a11yIssues).to.have.lengthOf(2);
      expect(result.a11yIssues[0].issue).to.equal('Select element must have an accessible name');
      expect(result.a11yIssues[1].issue).to.equal('Images must have alternative text');
      expect(result.a11yIssues[0].successCriterias).to.deep.equal(['4.1.2 Name, Role, Value']);
      expect(result.a11yIssues[1].successCriterias).to.deep.equal(['1.1.1 Non-text Content']);
    });

    it('should preserve all violation properties in the transformation', () => {
      // Arrange
      const axeData = {
        violations: {
          critical: {
            items: {
              'test-violation': {
                count: 1,
                description: 'Test violation description',
                level: 'A',
                successCriteriaTags: ['wcag111'],
                htmlWithIssues: ['<test-element>'],
                failureSummary: 'Test failure summary',
                helpUrl: 'https://example.com/help',
                target: ['#test'],
                successCriteriaNumber: '111',
                understandingUrl: 'https://example.com/understanding',
              },
            },
          },
          serious: {
            items: {},
          },
        },
        url: 'https://example.com/form',
        formSource: 'test-form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result.a11yIssues[0]).to.deep.equal({
        issue: 'Test violation description',
        level: 'A',
        successCriterias: ['1.1.1 Non-text Content'],
        htmlWithIssues: ['<test-element>'],
        recommendation: 'Test failure summary',
      });

      // Verify that only the expected properties are included (no extra properties)
      expect(Object.keys(result.a11yIssues[0])).to.have.lengthOf(5);
    });

    it('should handle real sample data from JSON files', () => {
      // Arrange - Using data similar to www_sunstar_com_contact_0.json
      const axeData = {
        violations: {
          total: 5,
          critical: {
            count: 2,
            items: {
              'select-name': {
                count: 2,
                description: 'Select element must have an accessible name',
                level: 'A',
                htmlWithIssues: [
                  '<select id="inquiry" required="required">',
                  '<select id="region" disabled="" required="required"><option selected="" disabled="">Select region close to you</option><option value="Europe">Europe</option><option value="Japan">Japan</option><option value="Asia">Asia</option><option value="Americas">The Americas</option></select>',
                ],
                failureSummary: 'Fix any of the following:\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element\'s default semantics were not overridden with role="none" or role="presentation"',
                successCriteriaTags: ['wcag412'],
              },
            },
          },
          serious: {
            count: 3,
            items: {
              'color-contrast': {
                count: 2,
                description: 'Elements must meet minimum color contrast ratio thresholds',
                level: 'AA',
                htmlWithIssues: [
                  '<span>(Optional)</span>',
                  '<span>(Optional)</span>',
                ],
                failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 2.54 (foreground color: #9ea3a8, background color: #ffffff, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1',
                successCriteriaTags: ['wcag143'],
              },
              'target-size': {
                count: 1,
                description: 'All touch targets must be 24px large, or leave sufficient space',
                level: 'AA',
                htmlWithIssues: [
                  '<button class="icon search-icon" aria-label="Search"></button>',
                ],
                failureSummary: 'Fix any of the following:\n  Target has insufficient size (14px by 14px, should be at least 24px by 24px)\n  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 14px instead of at least 24px.',
                successCriteriaTags: ['wcag258'],
              },
            },
          },
        },
        url: 'https://www.sunstar.com/contact',
        formSource: 'form',
      };

      // Act
      const result = transformAxeViolationsToA11yData(axeData);

      // Assert
      expect(result).to.deep.equal({
        form: 'https://www.sunstar.com/contact',
        formSource: 'form',
        a11yIssues: [
          {
            issue: 'Select element must have an accessible name',
            level: 'A',
            successCriterias: ['4.1.2 Name, Role, Value'],
            htmlWithIssues: [
              '<select id="inquiry" required="required">',
              '<select id="region" disabled="" required="required"><option selected="" disabled="">Select region close to you</option><option value="Europe">Europe</option><option value="Japan">Japan</option><option value="Asia">Asia</option><option value="Americas">The Americas</option></select>',
            ],
            recommendation: 'Fix any of the following:\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element\'s default semantics were not overridden with role="none" or role="presentation"',
          },
          {
            issue: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            successCriterias: ['1.4.3 Contrast (Minimum)'],
            htmlWithIssues: [
              '<span>(Optional)</span>',
              '<span>(Optional)</span>',
            ],
            recommendation: 'Fix any of the following:\n  Element has insufficient color contrast of 2.54 (foreground color: #9ea3a8, background color: #ffffff, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1',
          },
          {
            issue: 'All touch targets must be 24px large, or leave sufficient space',
            level: 'AA',
            successCriterias: ['2.5.8 Target Size (Minimum)'],
            htmlWithIssues: [
              '<button class="icon search-icon" aria-label="Search"></button>',
            ],
            recommendation: 'Fix any of the following:\n  Target has insufficient size (14px by 14px, should be at least 24px by 24px)\n  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 14px instead of at least 24px.',
          },
        ],
      });
    });
  });
});
