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
import { auditRunner, sendToMystique } from '../../../src/semantic-value-visibility/handler.js';

use(sinonChai);

describe('Semantic Value Visibility Handler', () => {
  let sandbox;
  let site;
  let context;
  let sqsStub;
  let logStub;

  const auditUrl = 'https://example.com';
  const siteId = 'site-123';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    site = {
      getId: () => siteId,
      getDeliveryType: () => 'aem_edge',
    };

    sqsStub = {
      sendMessage: sandbox.stub().resolves(),
    };

    logStub = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    context = {
      log: logStub,
      sqs: sqsStub,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique-queue',
      },
      audit: {
        getId: () => 'audit-456',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('auditRunner', () => {
    it('should return pending result without sending SQS', async () => {
      const result = await auditRunner(auditUrl, context, site);

      expect(result.auditResult).to.deep.equal({
        siteId,
        url: auditUrl,
        status: 'pending-mystique',
      });
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(sqsStub.sendMessage).not.to.have.been.called;
    });
  });

  describe('sendToMystique', () => {
    it('should send message to Mystique with auditId and data', async () => {
      const auditData = { auditResult: { siteId } };

      const result = await sendToMystique(auditUrl, auditData, context, site);

      expect(result).to.equal(auditData);
      expect(sqsStub.sendMessage).to.have.been.calledOnce;

      const message = sqsStub.sendMessage.getCall(0).args[1];
      expect(message).to.deep.include({
        type: 'guidance:semantic-value-visibility',
        siteId,
        auditId: 'audit-456',
        url: auditUrl,
        deliveryType: 'aem_edge',
      });
      expect(message.data).to.deep.equal({ url: auditUrl });
      expect(message.time).to.be.a('string');
      expect(new Date(message.time)).to.be.instanceOf(Date);
    });

    it('should send to the correct queue', async () => {
      await sendToMystique(auditUrl, {}, context, site);

      expect(sqsStub.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique-queue',
        sinon.match.object,
      );
    });

    it('should log completion', async () => {
      await sendToMystique(auditUrl, {}, context, site);

      expect(logStub.info).to.have.been.calledWith(
        '[semantic-value-visibility] Request sent to Mystique',
      );
    });

    it('should handle missing audit gracefully', async () => {
      context.audit = undefined;

      await sendToMystique(auditUrl, {}, context, site);

      const message = sqsStub.sendMessage.getCall(0).args[1];
      expect(message.auditId).to.be.undefined;
    });
  });
});
