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
import { auditRunner } from '../../../src/semantic-value-visibility/handler.js';

use(sinonChai);

describe('Semantic Value Visibility Handler', () => {
  let context;
  let sandbox;
  let site;
  let log;
  let sqs;
  let env;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    site = {
      getId: () => 'site-123',
      getDeliveryType: () => 'aem_edge',
    };

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };

    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique-queue',
    };

    context = {
      log,
      sqs,
      env,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('auditRunner', () => {
    it('should send message to Mystique queue', async () => {
      const auditUrl = 'https://example.com';

      const result = await auditRunner(auditUrl, context, site);

      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(sqs.sendMessage).to.have.been.calledWith(
        'spacecat-to-mystique-queue',
        sinon.match({
          type: 'guidance:semantic-value-visibility',
          siteId: 'site-123',
          url: 'https://example.com',
          deliveryType: 'aem_edge',
        }),
      );
      expect(result.auditResult.status).to.equal('sent-to-mystique');
      expect(result.auditResult.siteId).to.equal('site-123');
      expect(result.auditResult.url).to.equal('https://example.com');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should include timestamp in message', async () => {
      const auditUrl = 'https://example.com';

      await auditRunner(auditUrl, context, site);

      const call = sqs.sendMessage.getCall(0);
      const message = call.args[1];

      expect(message.time).to.be.a('string');
      expect(new Date(message.time)).to.be.instanceOf(Date);
    });

    it('should log audit start and completion', async () => {
      const auditUrl = 'https://example.com';

      await auditRunner(auditUrl, context, site);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/Starting audit for siteId: site-123/),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Sending request to Mystique/),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Request sent to Mystique/),
      );
    });
  });
});
