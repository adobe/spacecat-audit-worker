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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';

import { AuditBuilder } from '../../src/common/audit-builder.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const { AUDIT_STEP_DESTINATIONS } = AuditModel;

describe('Step-based Audit Tests', () => {
  const sandbox = sinon.createSandbox();
  const mockDate = '2024-03-12T15:24:51.231Z';
  const baseURL = 'https://space.cat';

  let clock;
  let context;
  let site;
  let configuration;
  let audit;

  beforeEach('setup', () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });

    site = {
      getId: () => '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      getBaseURL: () => baseURL,
      getIsLive: () => true,
    };

    configuration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Site.findById.resolves(site);
    context.dataAccess.Configuration.findLatest.resolves(configuration);
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  describe('Step Configuration', () => {
    it('requires destination for non-final steps', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, null)
        .addStep('second', () => {}, null)
        .build()).to.throw('Step first must specify a destination as it is not the last step');
    });

    it('validates destination exists', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, 'invalid-destination')
        .build()).to.throw(/Invalid destination: invalid-destination/);
    });

    it('allows final step without destination', () => {
      expect(() => new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('final', () => {})
        .build()).not.to.throw();
    });

    it('returns null for next step when current step is last', () => {
      const newAudit = new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('last', () => {})
        .build();

      expect(newAudit.getNextStepName('last')).to.be.null;
    });

    it('returns next step name when available', () => {
      const newAudit = new AuditBuilder()
        .addStep('first', () => {}, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('second', () => {}, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
        .addStep('last', () => {})
        .build();

      expect(newAudit.getNextStepName('first')).to.equal('second');
      expect(newAudit.getNextStepName('second')).to.equal('last');
    });
  });

  describe('Step Execution', () => {
    const message = {
      type: 'content-audit',
      siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
      auditContext: {},
    };

    beforeEach(() => {
      // Create a step-based audit
      audit = new AuditBuilder()
        .addStep('prepare', async () => ({
          auditResult: { status: 'preparing' },
          fullAuditRef: 's3://test/123',
          urls: [{ url: baseURL }],
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        }), AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
        .addStep('process', async () => ({
          type: 'content-import',
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        }), AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
        .addStep('analyze', async () => ({
          status: 'complete',
          findings: ['test'],
        }))
        .build();
    });

    it('skips execution when audit is disabled for site', async () => {
      // Configure audit to be disabled
      configuration.isHandlerEnabledForSite.returns(false);

      const result = await audit.run(message, context);

      // Verify audit was skipped
      expect(result.status).to.equal(200);
      expect(context.dataAccess.Audit.create).not.to.have.been.called;
      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(context.log.warn).to.have.been.calledWith('content-audit audits disabled for site 42322ae6-b8b1-4a61-9c88-25205fa65b07, skipping...');
    });

    it('executes first step and creates audit record', async () => {
      nock('https://space.cat')
        .get('/')
        .reply(200, 'Success');
      const createdAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.create.resolves(createdAudit);

      await audit.run(message, context);

      expect(context.dataAccess.Audit.create).to.have.been.calledWith({
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        isLive: true,
        auditedAt: mockDate,
        auditType: 'content-audit',
        auditResult: { status: 'preparing' },
        fullAuditRef: 's3://test/123',
      });

      // Verify message sent to content scraper
      expect(context.sqs.sendMessage).to.have.been.calledWith({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/282898975672/spacecat-scraping-jobs',
        MessageBody: sinon.match.string,
      });

      const sentMessage = JSON.parse(context.sqs.sendMessage.firstCall.args[0].MessageBody);
      expect(sentMessage).to.deep.include({
        payload: {
          urls: [{ url: baseURL }],
          jobId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
          processingType: 'default',
          auditContext: {
            next: 'process',
            auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
            auditType: 'content-audit',
            fullAuditRef: 's3://test/123',
          },
        },
      });
    });

    it('continues execution from specified step', async () => {
      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const continueMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'process',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      await audit.run(continueMessage, context);

      // Verify no new audit record is created
      expect(context.dataAccess.Audit.create).not.to.have.been.called;

      // Verify message sent to import worker
      expect(context.sqs.sendMessage).to.have.been.calledWith({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/282898975672/spacecat-scraping-jobs',
        MessageBody: sinon.match.string,
      });

      const sentMessage = JSON.parse(context.sqs.sendMessage.firstCall.args[0].MessageBody);
      expect(sentMessage).to.deep.include({
        payload: {
          type: 'content-import',
          siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
          auditContext: {
            next: 'analyze',
            auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
            auditType: 'content-audit',
            fullAuditRef: 's3://test/123',
          },
        },
      });
    });

    it('handles final step without sending messages', async () => {
      const existingAudit = {
        getId: () => '109b71f7-2005-454e-8191-8e92e05daac2',
        getAuditType: () => 'content-audit',
        getFullAuditRef: () => 's3://test/123',
      };
      context.dataAccess.Audit.findById.resolves(existingAudit);

      const finalMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'analyze',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      const result = await audit.run(finalMessage, context);
      expect(result.status).to.equal(200);

      // Verify no new messages are sent
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('fails if step not found', async () => {
      const invalidMessage = {
        type: 'content-audit',
        siteId: '42322ae6-b8b1-4a61-9c88-25205fa65b07',
        auditContext: {
          next: 'invalid-step',
          auditId: '109b71f7-2005-454e-8191-8e92e05daac2',
        },
      };

      await expect(audit.run(invalidMessage, context))
        .to.be.rejectedWith('ontent-audit audit failed for site 42322ae6-b8b1-4a61-9c88-25205fa65b07 at step invalid-step. Reason: Step invalid-step not found for audit undefined');
    });

    it('fails when site is not found', async () => {
      context.dataAccess.Site.findById.resolves(null);

      await expect(audit.run(message, context))
        .to.be.rejectedWith('content-audit audit failed for site 42322ae6-b8b1-4a61-9c88-25205fa65b07 at step initial. Reason: Site with id 42322ae6-b8b1-4a61-9c88-25205fa65b07 not found');
    });

    it('fails when step configuration is invalid', async () => {
      // Create an audit with invalid step configuration
      const invalidAudit = new AuditBuilder()
        .addStep('prepare', async () => ({}), null) // Missing destination
        .build();

      await expect(invalidAudit.chainStep(
        { name: 'prepare' }, // Missing destination
        {},
        context,
      )).to.be.rejectedWith('Invalid step configuration: missing destination');
    });

    it('fails when step destination configuration is invalid', async () => {
      // Create a step with invalid destination config
      const step = {
        name: 'test',
        destination: 'non-existent-destination',
      };

      await expect(audit.chainStep(step, {}, context))
        .to.be.rejectedWith('Invalid destination configuration for step test');
    });
  });
});
