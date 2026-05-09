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
/* eslint-disable */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

import {
  sendToMystiqueForGeneration,
} from '../../../src/money-pages/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const AUDIT_TYPE = 'money-pages';

const sandbox = sinon.createSandbox();

const baseURL = 'https://example.com';
const site = {
  getBaseURL: () => baseURL,
  getId: () => 'site-id-1',
  getConfig: sinon.stub(),
  getDeliveryType: sinon.stub().returns('aem_edge'),
};

describe('Money pages audit', () => {
  let context;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        site,
        finalUrl: 'www.example.com',
        log: {
          debug: sandbox.stub(),
          info: sandbox.stub(),
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
      })
      .build();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('sendToMystiqueForGeneration', () => {
    let mockSqs;
    let mockAudit;

    beforeEach(() => {
      mockSqs = {
        sendMessage: sandbox.stub().resolves({ MessageId: 'test-message-id' }),
      };

      mockAudit = {
        getId: () => 'audit-id-1',
      };

      context.sqs = mockSqs;
      context.audit = mockAudit;
      context.env = {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url',
      };
    });

    it('should successfully send message to Mystique', async () => {
      const result = await sendToMystiqueForGeneration(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(mockSqs.sendMessage).to.have.been.calledOnce;

      const messageArg = mockSqs.sendMessage.getCall(0).args[1];
      expect(messageArg).to.have.property('type', 'money-pages');
      expect(messageArg).to.have.property('siteId', 'site-id-1');
      expect(messageArg).to.have.property('auditId', 'audit-id-1');
      expect(messageArg).to.not.have.property('deliveryType');
      expect(messageArg.data).to.have.property('site_url', 'www.example.com');
      expect(messageArg.data).to.not.have.property('top_pages');
    });

    it('should throw error when SQS message sending fails', async () => {
      mockSqs.sendMessage.rejects(new Error('SQS error'));

      await expect(sendToMystiqueForGeneration(context))
        .to.be.rejectedWith('SQS error');

      expect(context.log.info).to.not.have.been.called;
      expect(context.log.error).to.have.been.calledWith(
        sinon.match('Failed to send message to Mystique')
      );
    });
  });
});
