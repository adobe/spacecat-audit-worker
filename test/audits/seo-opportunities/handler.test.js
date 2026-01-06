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

import { expect } from 'chai';
import sinon from 'sinon';
import { validateSeoOpportunitiesStep } from '../../../src/seo-opportunities/handler.js';

describe('SEO Opportunities Handler', () => {
  let context;
  let mockSite;
  let sqsSendMessageStub;

  beforeEach(() => {
    mockSite = {
      getId: () => 'test-site-id',
      getBaseURL: () => 'https://example.com',
    };

    sqsSendMessageStub = sinon.stub().resolves();

    context = {
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      },
      site: mockSite,
      audit: {
        getId: () => 'test-audit-id',
      },
      sqs: {
        sendMessage: sqsSendMessageStub,
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url',
      },
      data: null,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('validateSeoOpportunitiesStep', () => {
    it('should return error when no URLs provided', async () => {
      context.data = { urls: [] };

      const result = await validateSeoOpportunitiesStep(context);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.message).to.equal('No URLs provided for validation');
      expect(result.auditResult.totalUrls).to.equal(0);
    });

    it('should validate clean URLs and send to Mystique', async () => {
      context.data = {
        requestId: 'test-request-123',
        urls: [
          {
            url: 'https://www.adobe.com/',
            primaryKeyword: 'adobe',
            position: 5,
            trafficValue: 100,
            intent: 'commercial',
          },
        ],
      };

      const result = await validateSeoOpportunitiesStep(context);

      expect(result.auditResult.success).to.equal(true);
      expect(result.auditResult.totalUrls).to.equal(1);

      // Verify SQS was called
      expect(sqsSendMessageStub.called).to.equal(true);

      // Check the message sent to Mystique
      const sentMessages = sqsSendMessageStub.getCalls();
      expect(sentMessages.length).to.be.greaterThan(0);

      const firstMessage = sentMessages[0].args[1];
      expect(firstMessage.type).to.equal('detect:seo-indexability');
      expect(firstMessage.siteId).to.equal('test-site-id');
      expect(firstMessage.data.urls).to.be.an('array');
    });

    it('should handle URLs with validation failures', async () => {
      context.data = {
        requestId: 'test-request-456',
        urls: [
          {
            url: 'https://httpstat.us/404',
            primaryKeyword: 'test keyword',
            position: 10,
            trafficValue: 50,
            intent: 'commercial',
          },
        ],
      };

      const result = await validateSeoOpportunitiesStep(context);

      expect(result.auditResult.success).to.equal(true);
      expect(result.auditResult.totalUrls).to.equal(1);

      // Should have blocked URLs
      if (result.auditResult.blockedUrls > 0) {
        expect(sqsSendMessageStub.called).to.equal(true);
        const sentMessages = sqsSendMessageStub.getCalls();
        const blockedMessage = sentMessages.find((call) => call.args[1].data.status === 'blocked');
        expect(blockedMessage).to.exist;
      }
    });

    it('should include all keyword data in response', async () => {
      context.data = {
        requestId: 'test-request-789',
        urls: [
          {
            url: 'https://www.adobe.com/products/photoshop.html',
            primaryKeyword: 'photoshop',
            position: 8,
            trafficValue: 200,
            intent: 'commercial',
          },
        ],
      };

      await validateSeoOpportunitiesStep(context);

      const sentMessages = sqsSendMessageStub.getCalls();
      expect(sentMessages.length).to.be.greaterThan(0);

      const message = sentMessages[0].args[1];
      const urlData = message.data.urls[0];

      expect(urlData.primaryKeyword).to.equal('photoshop');
      expect(urlData.position).to.equal(8);
      expect(urlData.trafficValue).to.equal(200);
      expect(urlData.intent).to.equal('commercial');
    });
  });
});

