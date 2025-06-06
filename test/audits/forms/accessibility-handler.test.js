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
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';
import mystiqueDetectedFormAccessibilityHandler, { createAccessibilityOpportunity } from '../../../src/forms-opportunities/oppty-handlers/accessibility-handler.js';
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

  describe('createAccessibilityOpportunity', () => {
    let context;
    const siteId = 'test-site-id';
    const bucketName = 'test-bucket';
    const version = new Date().getTime();

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
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
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
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves({ getId: () => 'test-opportunity-id' }),
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

    it('should not create opportunities when no a11y data is present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      context.s3Client.send.onFirstCall().resolves({ CommonPrefixes: [] });
      await createAccessibilityOpportunity(latestAudit, context);
      expect(context.log.error).to.have.been.calledWith('[Form Opportunity] [Site Id: test-site-id] Failed to get object keys from subfolders: No accessibility data found in bucket test-bucket at prefix forms-accessibility/test-site-id/ for site test-site-id with delimiter /');
    });

    it('should not create opportunities when no content is present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      context.s3Client.send
        .onFirstCall()
        .resolves({ CommonPrefixes: [{ Prefix: `forms-accessibility/${siteId}/${version}/` }] })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `forms-accessibility/${siteId}/${version}/form1.json` },
          ],
          IsTruncated: false,
        })
        .onThirdCall()
        .resolves({
          ContentType: 'application/json',
          Body: {
            transformToString: sandbox.stub().resolves(null),
          },
        });
      await createAccessibilityOpportunity(latestAudit, context);
      expect(context.log.error).to.have.been.calledWith('[Form Opportunity] No files could be processed successfully for site test-site-id');
    });

    it('should not create opportunity if a11yData is empty', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      context.s3Client.send
        .onFirstCall()
        .resolves({
          CommonPrefixes: [
            { Prefix: `forms-accessibility/${siteId}/${version}/` },
          ],
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `forms-accessibility/${siteId}/${version}/form1.json` },
          ],
          IsTruncated: false,
        })
        .onThirdCall()
        .resolves({
          ContentType: 'application/json',
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify({
              finalUrl: 'https://example.com/form1',
              a11yResult: [],
            })),
          },
        });

      await createAccessibilityOpportunity(latestAudit, context);
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] No a11y data found`,
      );
    });

    it('should fail when no a11yIssues are present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      context.s3Client.send
        .onFirstCall()
        .resolves({
          CommonPrefixes: [
            { Prefix: `forms-accessibility/${siteId}/${version}/` },
          ],
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `forms-accessibility/${siteId}/${version}/form1.json` },
          ],
          IsTruncated: false,
        })
        .onThirdCall()
        .resolves({
          ContentType: 'application/json',
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify({
              finalUrl: 'https://example.com/form1',
              a11yResult: [{
                form: 'https://example.com/form1',
                formSource: '#form1',
                a11yIssues: [],
              }],
            })),
          },
        });

      await createAccessibilityOpportunity(latestAudit, context);
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        `[Form Opportunity] [Site Id: ${siteId}] No a11y issues found`,
      );
    });

    it('should create opportunities when a11y issues are present', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      const scrapedData = {
        finalUrl: 'https://example.com/form1',
        a11yResult: [{
          formSource: '#form1',
          a11yIssues: [{
            issue: 'Missing alt text',
            level: 'error',
            successCriterias: ['1.1.1'],
            htmlWithIssues: '<img src="test.jpg">',
            recommendation: 'Add alt text to image',
          }],
        }],
        auditTime: '6987',
        scrapedAt: '1748348057009',
        userAgent: 'mock-user-agent',
      };

      context.s3Client.send
        .onFirstCall()
        .resolves({
          CommonPrefixes: [
            { Prefix: `forms-accessibility/${siteId}/${version}/` },
          ],
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `forms-accessibility/${siteId}/${version}/form1.json` },
          ],
          IsTruncated: false,
        })
        .onThirdCall()
        .resolves({
          ContentType: 'application/json',
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify(scrapedData)),
          },
        });

      await createAccessibilityOpportunity(latestAudit, context);

      expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;
      const createArgs = context.dataAccess.Opportunity.create.getCall(0).args[0];
      expect(createArgs.siteId).to.equal(siteId);
      expect(createArgs.auditId).to.equal('test-audit-id');
      expect(createArgs.type).to.equal(FORM_OPPORTUNITY_TYPES.FORM_A11Y);
      expect(createArgs.origin).to.equal('AUTOMATION');
      expect(createArgs.data.accessibility).to.have.lengthOf(1);
      expect(createArgs.data.accessibility[0].form).to.equal('https://example.com/form1');
      expect(createArgs.data.accessibility[0].formSource).to.equal('#form1');
      expect(createArgs.data.accessibility[0].a11yIssues).to.have.lengthOf(1);

      // Check that success criteria are processed
      const successCriteria = createArgs.data.accessibility[0].a11yIssues[0].successCriterias[0];
      expect(successCriteria.criteriaNumber).to.equal('1.1.1');
      expect(successCriteria.name).to.equal('Non-text Content');
      expect(successCriteria).to.have.property('understandingUrl');

      // Verify SQS message was sent
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const sqsMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sqsMessage.type).to.equal('detect:forms-a11y');
      expect(sqsMessage.siteId).to.equal(siteId);
      expect(sqsMessage.auditId).to.equal('test-audit-id');
      expect(sqsMessage.deliveryType).to.equal('aem');
      expect(sqsMessage.data.opportunityId).to.equal('test-opportunity-id');
    });

    it('should handle errors when processing a11y data', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      // Mock S3 error
      context.s3Client.send.rejects(new Error('S3 error'));

      await createAccessibilityOpportunity(latestAudit, context);

      expect(context.log.error).to.have.been.calledWith('[Form Opportunity] [Site Id: test-site-id] Error creating a11y issues: S3 error');
      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    });

    it('should fail while creating a new opportunity', async () => {
      const latestAudit = {
        siteId,
        auditId: 'test-audit-id',
        getSiteId: () => siteId,
        getAuditId: () => 'test-audit-id',
      };

      const scrapedData = {
        finalUrl: 'https://example.com/form1',
        a11yResult: [{
          formSource: '#form1',
          a11yIssues: [{
            issue: 'Missing alt text',
            level: 'error',
            successCriterias: ['1.1.1'],
            htmlWithIssues: '<img src="test.jpg">',
            recommendation: 'Add alt text to image',
          }],
        }],
      };

      context.s3Client.send
        .onFirstCall()
        .resolves({
          CommonPrefixes: [
            { Prefix: `forms-accessibility/${siteId}/${version}/` },
          ],
        })
        .onSecondCall()
        .resolves({
          Contents: [
            { Key: `forms-accessibility/${siteId}/${version}/form1.json` },
          ],
          IsTruncated: false,
        })
        .onThirdCall()
        .resolves({
          ContentType: 'application/json',
          Body: {
            transformToString: sandbox.stub().resolves(JSON.stringify(scrapedData)),
          },
        });

      context.dataAccess.Opportunity.create = sandbox.stub().rejects(new Error('Network error'));

      await createAccessibilityOpportunity(latestAudit, context);
      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: test-site-id] Failed to create/update a11y opportunity with error: Network error',
      );
    });
  });

  describe('accessibility handle - mystique detected', async () => {
    let context;
    const siteId = 'test-site-id';
    const auditId = 'test-audit-id';
    const opportunityId = 'test-opportunity-id';

    beforeEach(() => {
      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          runtime: { name: 'aws-lambda', region: 'us-east-1' },
          func: { package: 'spacecat-services', version: 'ci', name: 'test' },
          site: {
            getId: sinon.stub().returns(siteId),
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
          },
          dataAccess: {
            Opportunity: {
              findById: sandbox.stub().resolves({
                getId: () => opportunityId,
                save: sandbox.stub().resolves({
                  getId: () => opportunityId,
                }),
                data: {
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
                },
              }),
              create: sandbox.stub().resolves({
                getId: () => opportunityId,
                setUpdatedBy: sandbox.stub(),
                setAuditId: sandbox.stub(),
              }),
            },
          },
        })
        .build();
    });

    it('should process message and send to mystique', async () => {
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
      expect(sqsMessage.type).to.equal('guidance:forms-a11y');
      expect(sqsMessage.siteId).to.equal(siteId);
      expect(sqsMessage.auditId).to.equal(auditId);
      expect(sqsMessage.deliveryType).to.equal('aem');
      expect(sqsMessage.data.opportunityId).to.equal(opportunityId);
      expect(sqsMessage.data.a11y).to.not.exist;
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

      // mock existing opportunity
      context.dataAccess.Opportunity.findById.resolves({
        save: sandbox.stub().resolves({
          getId: () => opportunityId,
        }),
        setUpdatedBy: sandbox.stub(),
        data: {
          accessibility: [{
            form: 'https://example.com/form1',
            formSource: '#form1',
            a11yIssues: [],
          }],
        },
      });

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnce;
      const existingOpportunity = await context.dataAccess.Opportunity.findById
        .getCall(0).returnValue;
      expect(existingOpportunity.data.accessibility).to.have.lengthOf(1);
      expect(existingOpportunity.data.accessibility[0].a11yIssues).to.have.lengthOf(1);
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

      // mock existing opportunity
      context.dataAccess.Opportunity.findById.resolves({
        save: sandbox.stub().resolves({
          getId: () => opportunityId,
        }),
        setUpdatedBy: sandbox.stub(),
        data: {
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
        },
      });

      await mystiqueDetectedFormAccessibilityHandler(message, context);

      expect(context.dataAccess.Opportunity.findById).to.have.been.calledOnce;
      const existingOpportunity = await context.dataAccess.Opportunity.findById
        .getCall(0).returnValue;
      expect(existingOpportunity.data.accessibility).to.have.lengthOf(2);
      expect(existingOpportunity.data.accessibility[0].a11yIssues).to.have.lengthOf(1);
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
});
