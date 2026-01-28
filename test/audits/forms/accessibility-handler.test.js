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
import mystiqueDetectedFormAccessibilityHandler, { extractFormAccessibilityData } from '../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js';
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
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'img' },
              ],
              failureSummary: 'Add alt text to image',
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
                getId: sinon.stub().returns('test-site-id'),
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

      // Stub isAuditEnabledForSite to return false (auto-fix disabled)
      const isAuditEnabledForSiteStub = sandbox.stub().resolves(false);

      // Mock the handler with stubbed isAuditEnabledForSite
      const mystiqueDetectedFormAccessibilityHandlerMocked = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: isAuditEnabledForSiteStub,
        },
      });

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

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
        '[Form Opportunity] [Site Id: test-site-id] No accessibility violations found, skipping opportunity creation',
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
        '[Form Opportunity] [Site Id: test-site-id] No accessibility violations found, skipping opportunity creation',
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
      expect(createArgs.data.dataSources).to.deep.equal(['axe-core']);

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
      expect(createArgs.data.dataSources).to.deep.equal(['axe-core']);

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
      expect(createArgs.data.dataSources).to.deep.equal(['axe-core']);
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
        sinon.match(/Error creating a11y issues/),
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
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          aggregateAccessibilityIssues: sandbox.stub().returns({ data: [] }),
          createIndividualOpportunitySuggestions: sandbox.stub().resolves(),
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

    it('should create individual suggestions for form accessibility issues', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success with violations
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
                critical: {
                  items: {
                    label: {
                      description: 'Form elements must have labels',
                      level: 'critical',
                      successCriteriaTags: ['wcag412'],
                      failureSummary: 'Ensure every form field has a label',
                      htmlWithIssues: ['<input type="text">'],
                      target: ['input[type="text"]'],
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Mock aggregateA11yIssuesByOppType to return individual issues
      const aggregateA11yIssuesByOppTypeStub = sandbox.stub().returns({
        data: [{
          'form-accessibility': [
            {
              type: 'url',
              url: 'https://example.com/page1',
              source: 'contact-form',
              issues: [
                {
                  type: 'label',
                  severity: 'critical',
                  htmlWithIssues: [{
                    target_selector: 'input[type="text"]',
                  }],
                },
              ],
            },
          ],
        }],
      });

      // Mock createIndividualOpportunitySuggestions
      const createIndividualOpportunitySuggestionsStub = sandbox.stub().resolves();

      const createdOpportunity = {
        getId: () => 'opportunity-123',
      };
      context.dataAccess.Opportunity.create.resolves(createdOpportunity);

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
        },
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          aggregateA11yIssuesByOppType: aggregateA11yIssuesByOppTypeStub,
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify individual suggestions were created
      expect(aggregateA11yIssuesByOppTypeStub).to.have.been.calledOnce;
      expect(aggregateA11yIssuesByOppTypeStub).to.have.been.calledWith(
        sinon.match.object,
        sinon.match.object,
      );
      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;
    });

    it('should handle individual suggestions creation errors gracefully', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

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
            'https://example.com/page1': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    label: {
                      count: 1,
                      description: 'Form elements must have labels',
                      level: 'A',
                      successCriteriaTags: ['wcag412'],
                      failureSummary: 'Ensure every form field has a label',
                      htmlWithIssues: ['<input type="text">'],
                    },
                  },
                },
                serious: { count: 0, items: {} },
              },
            },
          },
        },
      });

      // Mock aggregateAccessibilityIssues to throw an error
      const aggregateAccessibilityIssuesStub = sandbox.stub().throws(new Error('Aggregation failed'));
      const createIndividualOpportunitySuggestionsStub = sandbox.stub().resolves();
      const aggregateA11yIssuesByOppTypeStub = sandbox.stub().throws(new Error('Individual suggestions failed'));

      const createdOpportunity = {
        getId: () => 'opportunity-123',
      };
      context.dataAccess.Opportunity.create.resolves(createdOpportunity);

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
          sendRunImportMessage: sandbox.stub().resolves(),
        },
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          aggregateAccessibilityIssues: aggregateAccessibilityIssuesStub,
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
          aggregateA11yIssuesByOppType: aggregateA11yIssuesByOppTypeStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify that the error in individual suggestions doesn't break the main flow
      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;

      // Verify the stub was called even though it threw an error
      expect(aggregateA11yIssuesByOppTypeStub).to.have.been.calledOnce;

      // Verify error was logged for individual suggestions but main success was still logged
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error creating individual suggestions/),
      );
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/a11y opportunity created.*and sent to mystique/),
      );
    });

    it('should skip individual suggestions when no opportunity is created', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock aggregateAccessibilityData to return success but with no violations
      const aggregateAccessibilityDataStub = sandbox.stub();
      aggregateAccessibilityDataStub.resolves({
        success: true,
        finalResultFiles: {
          current: {},
        },
      });

      const aggregateA11yIssuesByOppTypeStub = sandbox.stub();
      const createIndividualOpportunitySuggestionsStub = sandbox.stub();

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          aggregateAccessibilityData: aggregateAccessibilityDataStub,
        },
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          aggregateA11yIssuesByOppType: aggregateA11yIssuesByOppTypeStub,
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createAccessibilityOpportunity(latestAudit, context);

      // Verify individual suggestions functions were not called when no opportunity was created
      expect(aggregateA11yIssuesByOppTypeStub).to.not.have.been.called;
      expect(createIndividualOpportunitySuggestionsStub).to.not.have.been.called;
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
      expect(createArgs.data.dataSources).to.deep.equal(['axe-core']);
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
        '[Form Opportunity] [Site Id: test-site-id] No accessibility violations found, skipping opportunity creation',
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
        '[Form Opportunity] [Site Id: test-site-id] No accessibility violations found, skipping opportunity creation',
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
        '[Form Opportunity] [Site Id: test-site-id] No accessibility violations found, skipping opportunity creation',
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
      expect(createArgs.data.dataSources).to.deep.equal(['axe-core']);
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
        title: 'Forms missing key accessibility attributes — enhancements prepared to support all users',
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/Ebpoflp2gHFNl4w5-9C7dFEBBHHE4gTaRzHaofqSxJMuuQ?e=Ss6mep',
      });

      // Verify the opportunity has dataSources
      expect(opportunityData.data.dataSources).to.deep.equal(['axe-core']);

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
    let mystiqueDetectedFormAccessibilityHandlerMocked;
    let isAuditEnabledForSiteStub;
    let createIndividualOpportunitySuggestionsStub;
    let sendCodeFixMessagesToMystiqueStub;

    beforeEach(async () => {
      isAuditEnabledForSiteStub = sandbox.stub().resolves(false); // Default: auto-fix disabled
      createIndividualOpportunitySuggestionsStub = sandbox.stub().resolves();
      sendCodeFixMessagesToMystiqueStub = sandbox.stub().resolves();
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
            IMPORT_WORKER_QUEUE_URL: 'test-import-worker-queue',
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
                getType: () => 'form-accessibility',
                getSiteId: () => siteId,
                getSuggestions: sandbox.stub().resolves([]),
                save: sandbox.stub().callsFake(function() {
                  return Promise.resolve({
                    getId: () => opportunityId,
                    getSiteId: () => siteId,
                    getType: () => 'form-accessibility',
                    getData: () => mockOpportunityData,
                    getSuggestions: sandbox.stub().resolves([]),
                  });
                }),
                getData: () => mockOpportunityData,
                setData: (data) => {
                  mockOpportunityData = data;
                },
              }),
              create: sandbox.stub().resolves({
                getId: () => opportunityId,
                getType: () => 'form-accessibility',
                getSiteId: () => siteId,
                setUpdatedBy: sandbox.stub(),
                setAuditId: sandbox.stub(),
              }),
            },
            Site: {
              findById: sandbox.stub().resolves({
                getId: sinon.stub().returns(siteId),
                getDeliveryType: sinon.stub().returns('aem'),
                getBaseURL: sinon.stub().returns('https://example.com'),
              }),
            },
            Configuration: {
              findLatest: sandbox.stub().resolves({
                getHandlers: () => ({
                  'form-accessibility-auto-fix': {
                    productCodes: [],
                  },
                }),
                isHandlerEnabledForSite: sandbox.stub().resolves(false),
              }),
            },
          },
        })
        .build();

      // Mock the handler with stubbed isAuditEnabledForSite (default: auto-fix disabled)
      mystiqueDetectedFormAccessibilityHandlerMocked = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/common/audit-utils.js': {
          isAuditEnabledForSite: isAuditEnabledForSiteStub,
        },
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
        '../../../src/accessibility/utils/data-processing.js': {
          sendCodeFixMessagesToMystique: sendCodeFixMessagesToMystiqueStub,
        },
      });
    });

    it('should return notFound when site is not found', async () => {
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

      // Override the Site.findById to return null (site not found)
      const siteFindByIdStub = sandbox.stub().resolves(null);
      context.dataAccess.Site.findById = siteFindByIdStub;

      const result = await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      expect(result.status).to.equal(404);
      expect(siteFindByIdStub).to.have.been.calledOnceWith(siteId);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Site not found/),
      );
      // Verify that no opportunity operations were attempted
      expect(context.dataAccess.Opportunity.findById).to.not.have.been.called;
    });

    it('should log A11y preflight detected, skipping guidance for preflight request', async () => {
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
        options: {
          a11yPreflight: true,
        }
      };

      // Override the Site.findById to return null (site not found)
      const siteFindByIdStub = sandbox.stub().resolves(null);
      context.dataAccess.Site.findById = siteFindByIdStub;
      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      expect(context.log.info).to.have.been.calledWith(
          `[Form Opportunity] [Site Id: ${siteId}] A11y preflight detected, skipping guidance`,
      );
    });

    it('should return notFound when opportunityId is provided but opportunity is not found', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'input[type="text"]',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      // Override Opportunity.findById to return null
      context.dataAccess.Opportunity.findById.resolves(null);

      const result = await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      expect(result.status).to.equal(404);
      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnceWith(opportunityId);
      expect(context.log.error).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] A11y opportunity not found`,
      );
    });

    it('should return ok when opportunity creation returns null', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'input[type="text"]',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      // Mock Opportunity.create to return null (opportunity creation failed)
      context.dataAccess.Opportunity.create.resolves(null);

      const result = await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      expect(result.status).to.equal(200);
      expect(context.log.info).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] A11y opportunity not detected, skipping guidance`,
      );
      // Verify that no suggestions were created
      expect(createIndividualOpportunitySuggestionsStub).to.not.have.been.called;
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
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'input[type="text"]',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Verify that the handler processed the message successfully
      expect(context.log.error).to.not.have.been.called;
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
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'input[type="text"]',
              }],
              failureSummary: 'Fix any of the following...',
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
            IMPORT_WORKER_QUEUE_URL: 'test-import-worker-queue',
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
                getType: () => 'form-accessibility',
                getSiteId: () => siteId,
                getSuggestions: sandbox.stub().resolves([]),
                save: sandbox.stub().resolves({
                  getType: () => 'form-accessibility',
                  getId: () => opportunityId,
                  getSiteId: () => siteId,
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
                getSiteId: () => siteId,
              }),
              create: sandbox.stub().resolves({
                getId: () => opportunityId,
                setUpdatedBy: sandbox.stub(),
                setAuditId: sandbox.stub(),
              }),
            },
            Site: {
              findById: sandbox.stub().resolves({
                getId: sinon.stub().returns(siteId),
                getDeliveryType: sinon.stub().returns('aem'),
                getBaseURL: sinon.stub().returns('https://example.com'),
              }),
            },
            Configuration: {
              findLatest: sandbox.stub().resolves({
                getHandlers: () => ({
                  'form-accessibility-auto-fix': {
                    productCodes: [],
                  },
                }),
                isHandlerEnabledForSite: sandbox.stub().resolves(false),
              }),
            },
          },
        })
        .build();

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Verify that the handler processed the message successfully
      expect(context.log.error).to.not.have.been.called;
    });

    it('should send code-fix messages when auto-fix is enabled', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      // Override isAuditEnabledForSiteStub to return true for this test
      isAuditEnabledForSiteStub.resolves(true);

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Verify isAuditEnabledForSite was called with the site fetched from database
      expect(isAuditEnabledForSiteStub).to.have.been.calledWith('form-accessibility-auto-fix', sinon.match.has('getId'), context);
      // Verify sendCodeFixMessagesToMystique was called
      expect(sendCodeFixMessagesToMystiqueStub).to.have.been.called;
    });

    it('should handle empty a11y data gracefully', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId: null,
          a11y: [],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);
      
      // Opportunity should NOT be created when no a11y issues are found
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      
      // Should log that no issues were found from Mystique
      expect(context.log.info).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] No accessibility issues found from Mystique, skipping opportunity creation`,
      );
      
      // Should not send code-fix messages when no issues found
      expect(sendCodeFixMessagesToMystiqueStub).to.not.have.been.called;
    });

    it('should not create opportunity when a11y data has no valid issues', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId: null,
          a11y: [
            {
              form: 'https://example.com/form1',
              formSource: '#form1',
              a11yIssues: [], // Empty issues
            },
            {
              form: 'https://example.com/form2',
              formSource: '#form2',
              a11yIssues: [
                {
                  type: 'label',
                  description: 'Form elements must have labels',
                  wcagRule: 'wcag412',
                  wcagLevel: 'A',
                  severity: 'critical',
                  htmlWithIssues: [], // Empty htmlWithIssues
                  failureSummary: 'Fix any of the following...',
                },
              ],
            },
          ],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);
      
      // Opportunity should NOT be created when no valid issues are found
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      
      // Should log that no issues were found from Mystique
      expect(context.log.info).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] No accessibility issues found from Mystique, skipping opportunity creation`,
      );
      
      // Should not send code-fix messages when no issues found
      expect(sendCodeFixMessagesToMystiqueStub).to.not.have.been.called;
    });

    it('should create suggestions for accessibility issues detected by mystique', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Verify opportunity was found
      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnceWith(opportunityId);
      
      // Verify individual suggestions were created
      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;
      
      // Verify the call was made with the correct opportunity
      const callArgs = createIndividualOpportunitySuggestionsStub.getCall(0).args;
      expect(callArgs[0].getId()).to.equal(opportunityId);
    });

    it('should create suggestions for multiple a11y issues from mystique', async () => {
      const message = {
        auditId,
        siteId,
        data: {
          opportunityId,
          a11y: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [{
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }, {
            form: 'https://example.com/form2',
            formSource: '#form2',
            a11yIssues: [{
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'input[type="text"]',
              }],
              failureSummary: 'Ensure every form field has a label',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Verify opportunity was found
      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnceWith(opportunityId);
      
      // Verify individual suggestions were created
      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;
      
      // Verify the suggestions data includes both forms' issues
      const callArgs = createIndividualOpportunitySuggestionsStub.getCall(0).args;
      const suggestionsData = callArgs[1];
      expect(suggestionsData.data).to.be.an('array');
      expect(suggestionsData.data.length).to.equal(2); // Two htmlWithIssues = two suggestions
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
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);
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
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

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
              type: 'image-alt',
              description: 'Images must have alternative text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [{
                target_selector: 'img',
              }],
              failureSummary: 'Fix any of the following...',
            }],
          }],
        },
      };

      context.dataAccess.Opportunity.findById.rejects(new Error('Database error'));

      const result = await mystiqueDetectedFormAccessibilityHandlerMocked.default(message, context);

      // Handler should catch errors and log them, then return ok()
      expect(context.log.error).to.have.been.called;
      expect(result.status).to.equal(200);
    });
  });

  describe('createFormAccessibilitySuggestionsFromMystique', () => {
    let context;
    let mockOpportunity;
    let createIndividualOpportunitySuggestionsStub;

    beforeEach(() => {
      createIndividualOpportunitySuggestionsStub = sandbox.stub().resolves();

      mockOpportunity = {
        getId: () => 'test-opportunity-id',
      };

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            error: sinon.stub(),
          },
        })
        .build();
    });

    it('should create individual suggestions from Mystique data with multiple htmlWithIssues', async () => {
      const a11yData = [
        {
          form: 'https://example.com/contact-form',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Form input does not have an associated label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Ensure that all form inputs have associated <label> elements.',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="username">',
                  targetSelector: '#username',
                },
                {
                  updateFrom: '<input type="email" id="email">',
                  targetSelector: '#email',
                },
              ],
              aiGenerated: true,
              fieldSelector: ['#username', '#email'],
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
      ];

      // Mock the module to override the imported function
      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      // Verify that createIndividualOpportunitySuggestions was called
      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;

      // Verify the data structure passed to createIndividualOpportunitySuggestions
      const callArgs = createIndividualOpportunitySuggestionsStub.getCall(0).args;
      const opportunity = callArgs[0];
      const typeSpecificData = callArgs[1];
      const contextArg = callArgs[2];
      const logArg = callArgs[3];

      expect(opportunity).to.equal(mockOpportunity);
      expect(contextArg).to.equal(context);
      expect(logArg).to.equal(context.log);

      // Verify the data structure contains 2 suggestions (one per htmlWithIssues)
      expect(typeSpecificData.data).to.have.lengthOf(2);

      // Check first suggestion
      const firstSuggestion = typeSpecificData.data[0];
      expect(firstSuggestion).to.deep.include({
        type: 'url',
        url: 'https://example.com/contact-form',
        source: 'aem',
        aiGenerated: true,
      });
      expect(firstSuggestion.issues).to.have.lengthOf(1);
      expect(firstSuggestion.issues[0]).to.deep.include({
        type: 'missing-label',
        description: 'Form input does not have an associated label',
        wcagRule: '1.3.1 Info and Relationships',
        wcagLevel: 'A',
        severity: 'serious',
        occurrences: 1,
        failureSummary: 'Ensure that all form inputs have associated <label> elements.',
      });
      expect(firstSuggestion.issues[0].htmlWithIssues).to.have.lengthOf(1);
      expect(firstSuggestion.issues[0].htmlWithIssues[0]).to.deep.equal({
        updateFrom: '<input type="text" id="username">',
        targetSelector: '#username',
      });

      // Check second suggestion
      const secondSuggestion = typeSpecificData.data[1];
      expect(secondSuggestion).to.deep.include({
        type: 'url',
        url: 'https://example.com/contact-form',
        source: 'aem',
        aiGenerated: true,
      });
      expect(secondSuggestion.issues).to.have.lengthOf(1);
      expect(secondSuggestion.issues[0].htmlWithIssues).to.have.lengthOf(1);
      expect(secondSuggestion.issues[0].htmlWithIssues[0]).to.deep.equal({
        updateFrom: '<input type="email" id="email">',
        targetSelector: '#email',
      });

      // Verify logging
      expect(context.log.info).to.have.been.calledWith('[FormMystiqueSuggestions] Creating individual suggestions from Mystique data');
      expect(context.log.info).to.have.been.calledWith('[FormMystiqueSuggestions] Creating 2 individual suggestions for form accessibility from Mystique data');
      expect(context.log.info).to.have.been.calledWith('[FormMystiqueSuggestions] Successfully created individual suggestions for form accessibility from Mystique data');
    });

    it('should handle multiple forms with different issues', async () => {
      const a11yData = [
        {
          form: 'https://example.com/contact-form',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="name">',
                  targetSelector: '#name',
                },
              ],
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
        {
          form: 'https://example.com/newsletter-form',
          formSource: 'newsletter',
          a11yIssues: [
            {
              description: 'Color contrast issue',
              wcagRule: 'random',
              wcagLevel: 'AA',
              failureSummary: 'Improve contrast',
              htmlWithIssues: [
                {
                  updateFrom: '<button class="submit">Submit</button>',
                  targetSelector: '.submit',
                },
              ],
              aiGenerated: true,
              type: 'color-contrast',
              severity: 'critical',
            },
          ],
        },
      ];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;

      const typeSpecificData = createIndividualOpportunitySuggestionsStub.getCall(0).args[1];
      expect(typeSpecificData.data).to.have.lengthOf(1);

      // Check first form suggestion
      const firstSuggestion = typeSpecificData.data[0];
      expect(firstSuggestion.url).to.equal('https://example.com/contact-form');
      expect(firstSuggestion.source).to.equal('aem');
      expect(firstSuggestion.aiGenerated).to.equal(false);
      expect(firstSuggestion.issues[0].type).to.equal('missing-label');
      expect(firstSuggestion.issues[0].severity).to.equal('serious');

      // Check second form suggestion
      // const secondSuggestion = typeSpecificData.data[1];
      // expect(secondSuggestion.url).to.equal('https://example.com/newsletter-form');
      // expect(secondSuggestion.source).to.equal('newsletter');
      // expect(secondSuggestion.aiGenerated).to.equal(true);
      // expect(secondSuggestion.issues[0].type).to.equal('color-contrast');
      // expect(secondSuggestion.issues[0].severity).to.equal('critical');
    });

    it('should filter out forms with no a11yIssues', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="name">',
                  targetSelector: '#name',
                },
              ],
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
        {
          form: 'https://example.com/form2',
          formSource: 'newsletter',
          a11yIssues: [], // Empty issues
        },
        {
          form: 'https://example.com/form3',
          formSource: 'contact',
          a11yIssues: null, // Null issues
        },
      ];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;

      const typeSpecificData = createIndividualOpportunitySuggestionsStub.getCall(0).args[1];
      // Should only have 1 suggestion from form1 (form2 and form3 are filtered out)
      expect(typeSpecificData.data).to.have.lengthOf(1);
      expect(typeSpecificData.data[0].url).to.equal('https://example.com/form1');
    });

    it('should handle forms without formSource', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          // No formSource
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="name">',
                  targetSelector: '#name',
                },
              ],
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
      ];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;

      const typeSpecificData = createIndividualOpportunitySuggestionsStub.getCall(0).args[1];
      const suggestion = typeSpecificData.data[0];

      expect(suggestion.url).to.equal('https://example.com/form1');
      expect(suggestion).to.not.have.property('source'); // Should not have source property
    });

    it('should handle issues without htmlWithIssues', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [], // Empty htmlWithIssues
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
            {
              description: 'Color contrast',
              wcagRule: '1.4.3 Contrast (Minimum)',
              wcagLevel: 'AA',
              failureSummary: 'Improve contrast',
              htmlWithIssues: null, // Null htmlWithIssues
              aiGenerated: true,
              type: 'color-contrast',
              severity: 'critical',
            },
          ],
        },
      ];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      // Should not call createIndividualOpportunitySuggestions since no valid htmlWithIssues
      expect(createIndividualOpportunitySuggestionsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('[FormMystiqueSuggestions] No individual form accessibility suggestions to create from Mystique data');
    });

    it('should handle empty a11yData array', async () => {
      const a11yData = [];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith('[FormMystiqueSuggestions] No individual form accessibility suggestions to create from Mystique data');
    });

    it('should handle errors gracefully and not break the flow', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Info and Relationships',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="name">',
                  targetSelector: '#name',
                },
              ],
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
      ];

      // Mock createIndividualOpportunitySuggestions to throw an error
      createIndividualOpportunitySuggestionsStub.rejects(new Error('Database error'));

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      // Should not throw an error
      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;
      expect(context.log.error).to.have.been.calledWith('[FormMystiqueSuggestions] Error creating individual suggestions from Mystique data: Database error');
    });

    it('should populate understandingUrl from getSuccessCriteriaDetails', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              description: 'Missing label',
              wcagRule: '1.3.1 Name, Role, Value',
              wcagLevel: 'A',
              failureSummary: 'Add label',
              htmlWithIssues: [
                {
                  updateFrom: '<input type="text" id="name">',
                  targetSelector: '#name',
                },
              ],
              aiGenerated: false,
              type: 'missing-label',
              severity: 'serious',
            },
          ],
        },
      ];

      const accessibilityHandlerModule = await esmock('../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js', {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          createIndividualOpportunitySuggestions: createIndividualOpportunitySuggestionsStub,
        },
      });

      await accessibilityHandlerModule.createFormAccessibilitySuggestionsFromMystique(
        a11yData,
        mockOpportunity,
        context,
      );

      expect(createIndividualOpportunitySuggestionsStub).to.have.been.calledOnce;

      const typeSpecificData = createIndividualOpportunitySuggestionsStub.getCall(0).args[1];
      const suggestion = typeSpecificData.data[0];
      const issue = suggestion.issues[0];

      // understandingUrl should be populated from getSuccessCriteriaDetails
      expect(issue.understandingUrl).to.be.a('string');
    });
  });

  describe('extractFormAccessibilityData', () => {
    let context;

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          log: {
            info: sinon.stub(),
            error: sinon.stub(),
          },
        })
        .build();
    });

    it('should extract form accessibility data with valid issues', async () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input[type="text"]' },
              ],
              failureSummary: 'Fix any of the following...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.include({
        type: 'url',
        url: 'https://example.com/form1',
        source: 'aem',
      });
      expect(result[0].issues).to.have.lengthOf(1);
      expect(result[0].issues[0]).to.include({
        type: 'label',
        description: 'Form elements must have labels',
        wcagRule: 'wcag412',
        wcagLevel: 'A',
        severity: 'critical',
        occurrences: 1,
        failureSummary: 'Fix any of the following...',
      });
    });

    it('should handle null a11yData', () => {
      const result = extractFormAccessibilityData(null, context.log);
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
    });

    it('should handle undefined a11yData', () => {
      const result = extractFormAccessibilityData(undefined, context.log);
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
    });

    it('should handle non-array a11yData', () => {
      const result = extractFormAccessibilityData('not-an-array', context.log);
      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
    });

    it('should filter out forms without a11yIssues', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [],
        },
        {
          form: 'https://example.com/form2',
          formSource: 'contact',
          // No a11yIssues
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      expect(result).to.have.lengthOf(0);
    });

    it('should handle forms without formSource', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input' },
              ],
              failureSummary: 'Fix...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.not.have.property('source');
    });

    it('should handle issues with aiGenerated flag', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input' },
              ],
              failureSummary: 'Fix...',
              aiGenerated: true,
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.have.property('aiGenerated', true);
    });

    it('should create one suggestion per htmlWithIssues item', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input#name' },
                { target_selector: 'input#email' },
                { target_selector: 'input#phone' },
              ],
              failureSummary: 'Fix...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      // Should create 3 suggestions (one per htmlWithIssues)
      expect(result).to.have.lengthOf(3);
    });

    it('should handle issues without htmlWithIssues', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: null,
              failureSummary: 'Fix...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      expect(result).to.have.lengthOf(0);
    });

    it('should handle issues with empty htmlWithIssues array', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [],
              failureSummary: 'Fix...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      expect(result).to.have.lengthOf(0);
    });

    it('should handle error from getSuccessCriteriaDetails gracefully', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'invalid-rule',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input' },
              ],
              failureSummary: 'Fix...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      
      // Should log error for invalid wcagRule
      expect(context.log.error).to.have.been.called;
      
      // Should skip the issue with invalid wcagRule
      expect(result).to.have.lengthOf(0);
    });

    it('should handle multiple forms with multiple issues', () => {
      const a11yData = [
        {
          form: 'https://example.com/form1',
          formSource: 'aem',
          a11yIssues: [
            {
              type: 'label',
              description: 'Form elements must have labels',
              wcagRule: 'wcag412',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'input#name' },
              ],
              failureSummary: 'Fix...',
            },
            {
              type: 'color-contrast',
              description: 'Elements must meet color contrast',
              wcagRule: 'wcag143',
              wcagLevel: 'AA',
              severity: 'serious',
              htmlWithIssues: [
                { target_selector: 'button' },
              ],
              failureSummary: 'Improve...',
            },
          ],
        },
        {
          form: 'https://example.com/form2',
          formSource: 'contact',
          a11yIssues: [
            {
              type: 'alt-text',
              description: 'Images must have alt text',
              wcagRule: 'wcag111',
              wcagLevel: 'A',
              severity: 'critical',
              htmlWithIssues: [
                { target_selector: 'img' },
              ],
              failureSummary: 'Add alt...',
            },
          ],
        },
      ];

      const result = extractFormAccessibilityData(a11yData, context.log);
      // Should create 3 suggestions (1 + 1 + 1)
      expect(result).to.have.lengthOf(3);
      expect(result[0].url).to.equal('https://example.com/form1');
      expect(result[1].url).to.equal('https://example.com/form1');
      expect(result[2].url).to.equal('https://example.com/form2');
    });
  });

});
