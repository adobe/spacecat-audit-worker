/*
 * Copyright 2023 Adobe. All rights reserved.
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
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Optimization Report Handler', () => {
  let sandbox;
  let context;
  let optimizationReportCallback;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          REPORT_JOBS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      })
      .build();

    // Import the handler
    const handlerModule = await import('../../src/optimization-report/handler.js');
    optimizationReportCallback = handlerModule.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('optimizationReportCallback', () => {
    it('should successfully forward message to report jobs queue', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'test-site-123',
        data: {
          reportType: 'performance',
          timestamp: '2023-12-01T10:00:00Z',
        },
      };

      // Mock successful SQS send
      context.sqs.sendMessage.resolves();

      await optimizationReportCallback(message, context);

      // Verify SQS message was sent with correct parameters
      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        message,
      );

      // Verify logging
      expect(context.log.info).to.have.been.calledWith(
        'Processing optimization report callback for site: test-site-123',
      );
      expect(context.log.info).to.have.been.calledWith(
        'Successfully sent message to report jobs queue for site: test-site-123',
      );
    });

    it('should handle message with minimal data', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'minimal-site',
      };

      context.sqs.sendMessage.resolves();

      await optimizationReportCallback(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        message,
      );
    });

    it('should handle message with complex nested data', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'complex-site',
        metadata: {
          user: {
            id: 'user-123',
            preferences: {
              theme: 'dark',
              language: 'en',
            },
          },
          report: {
            sections: ['performance', 'accessibility', 'seo'],
            format: 'pdf',
          },
        },
        timestamp: '2023-12-01T10:00:00Z',
      };

      context.sqs.sendMessage.resolves();

      await optimizationReportCallback(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        message,
      );
    });

    it('should throw error when REPORT_JOBS_QUEUE_URL is not set', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'test-site-123',
      };

      // Override context to remove the queue URL
      const contextWithoutQueue = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            // REPORT_JOBS_QUEUE_URL is intentionally missing
          },
        })
        .build();

      await expect(optimizationReportCallback(message, contextWithoutQueue))
        .to.be.rejectedWith('REPORT_JOBS_QUEUE_URL environment variable is not set');

      expect(contextWithoutQueue.sqs.sendMessage).to.not.have.been.called;
      expect(contextWithoutQueue.log.error).to.have.been.calledWith(
        'Failed to send message to report jobs queue for site: test-site-123',
        sinon.match.instanceOf(Error),
      );
    });

    it('should throw error when REPORT_JOBS_QUEUE_URL is empty string', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'test-site-123',
      };

      // Override context with empty queue URL
      const contextWithEmptyQueue = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            REPORT_JOBS_QUEUE_URL: '',
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          },
        })
        .build();

      await expect(optimizationReportCallback(message, contextWithEmptyQueue))
        .to.be.rejectedWith('REPORT_JOBS_QUEUE_URL environment variable is not set');

      expect(contextWithEmptyQueue.sqs.sendMessage).to.not.have.been.called;
    });

    it('should handle SQS sendMessage failure', async () => {
      const message = {
        type: 'optimization-report-callback',
        siteId: 'test-site-123',
      };

      const sqsError = new Error('SQS service unavailable');
      context.sqs.sendMessage.rejects(sqsError);

      await expect(optimizationReportCallback(message, context))
        .to.be.rejectedWith('SQS service unavailable');

      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        message,
      );
      expect(context.log.error).to.have.been.calledWith(
        'Failed to send message to report jobs queue for site: test-site-123',
        sqsError,
      );
    });

    it('should preserve all message properties when forwarding', async () => {
      const originalMessage = {
        type: 'optimization-report-callback',
        siteId: 'test-site-123',
        customField: 'custom-value',
        nestedObject: {
          key1: 'value1',
          key2: 'value2',
        },
        arrayField: [1, 2, 3, 'string'],
        booleanField: true,
        nullField: null,
        undefinedField: undefined,
      };

      context.sqs.sendMessage.resolves();

      await optimizationReportCallback(originalMessage, context);

      // Verify the exact same message object was passed to SQS
      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        originalMessage,
      );
    });

    it('should handle message without siteId', async () => {
      const message = {
        type: 'optimization-report-callback',
        // siteId is intentionally missing
        data: 'some-data',
      };

      context.sqs.sendMessage.resolves();

      await optimizationReportCallback(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
        'https://sqs.us-east-1.amazonaws.com/123456789012/report-jobs-queue',
        message,
      );
      expect(context.log.info).to.have.been.calledWith(
        'Processing optimization report callback for site: undefined',
      );
    });
  });
});
