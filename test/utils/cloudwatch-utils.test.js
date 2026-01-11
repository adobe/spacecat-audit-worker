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
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { queryBotProtectionLogs } from '../../src/utils/cloudwatch-utils.js';

use(sinonChai);

describe('CloudWatch Utils', () => {
  let sandbox;
  let mockContext;
  let sendStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockContext = {
      env: {
        AWS_REGION: 'us-west-2',
        CONTENT_SCRAPER_LOG_GROUP: '/aws/lambda/test-scraper',
      },
      log: {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Stub CloudWatchLogsClient.send
    sendStub = sandbox.stub(CloudWatchLogsClient.prototype, 'send');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('queryBotProtectionLogs', () => {
    it('should return bot protection events when found', async () => {
      const mockEvents = [
        {
          message: 'Bot Protection Detection in Scraper: {"jobId":"job-123","url":"https://example.com","blockerType":"cloudflare","httpStatus":403,"confidence":0.99,"errorCategory":"bot-protection"}',
          timestamp: Date.now(),
        },
        {
          message: 'Bot Protection Detection in Scraper: {"jobId":"job-123","url":"https://example.com/page2","blockerType":"akamai","httpStatus":403,"confidence":0.95,"errorCategory":"bot-protection"}',
          timestamp: Date.now(),
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.deep.include({
        jobId: 'job-123',
        url: 'https://example.com',
        blockerType: 'cloudflare',
        httpStatus: 403,
        confidence: 0.99,
      });
      expect(result[1]).to.deep.include({
        jobId: 'job-123',
        url: 'https://example.com/page2',
        blockerType: 'akamai',
        httpStatus: 403,
        confidence: 0.95,
      });

      expect(mockContext.log.info).to.have.been.calledWith('Found 2 bot protection events in CloudWatch logs');
    });

    it('should return empty array when no events found', async () => {
      sendStub.resolves({
        events: [],
      });

      const result = await queryBotProtectionLogs('job-456', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.debug).to.have.been.calledWith('No bot protection logs found for job job-456');
    });

    it('should return empty array when events is undefined', async () => {
      sendStub.resolves({});

      const result = await queryBotProtectionLogs('job-789', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.debug).to.have.been.calledWith('No bot protection logs found for job job-789');
    });

    it('should handle parse errors gracefully', async () => {
      const mockEvents = [
        {
          message: 'Bot Protection Detection in Scraper: {"jobId":"job-123","url":"https://example.com","blockerType":"cloudflare","httpStatus":403}',
          timestamp: Date.now(),
        },
        {
          message: 'Bot Protection Detection in Scraper: {invalid json}',
          timestamp: Date.now(),
        },
        {
          message: 'Some other log message without the expected format',
          timestamp: Date.now(),
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      // Should only return the successfully parsed event
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.include({
        jobId: 'job-123',
        url: 'https://example.com',
        blockerType: 'cloudflare',
      });

      // Only invalid JSON triggers warning (messages without format return null silently)
      expect(mockContext.log.warn).to.have.been.calledOnce;
      expect(mockContext.log.warn).to.have.been.calledWithMatch(/Failed to parse bot protection log event/);
    });

    it('should filter out null events from parse failures', async () => {
      const mockEvents = [
        {
          message: 'Invalid log format',
          timestamp: Date.now(),
        },
        {
          message: 'Another invalid log',
          timestamp: Date.now(),
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      // Messages without the expected format return null without logging
      expect(mockContext.log.warn).to.not.have.been.called;
    });

    it('should handle CloudWatch query errors gracefully', async () => {
      const error = new Error('CloudWatch query failed');
      sendStub.rejects(error);

      const result = await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.error).to.have.been.calledWith(
        'Failed to query CloudWatch logs for bot protection:',
        error,
      );
    });

    it('should use correct time range for query', async () => {
      const startTime = Date.now() - 7200000; // 2 hours ago
      const beforeCallTime = Date.now();

      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('job-123', mockContext, startTime);

      const afterCallTime = Date.now();

      expect(sendStub).to.have.been.calledOnce;
      const command = sendStub.firstCall.args[0];
      expect(command).to.be.instanceOf(FilterLogEventsCommand);
      expect(command.input.startTime).to.equal(startTime);
      expect(command.input.endTime).to.be.at.least(beforeCallTime);
      expect(command.input.endTime).to.be.at.most(afterCallTime);
    });

    it('should use correct log group and filter pattern', async () => {
      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      const command = sendStub.firstCall.args[0];
      expect(command.input.logGroupName).to.equal('/aws/lambda/test-scraper');
      expect(command.input.filterPattern).to.equal('{ $.jobId = "job-123" && $.errorCategory = "bot-protection" }');
      expect(command.input.limit).to.equal(100);
    });

    it('should use default log group when not configured', async () => {
      const contextWithoutLogGroup = {
        ...mockContext,
        env: {
          AWS_REGION: 'us-west-2',
        },
      };

      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('job-123', contextWithoutLogGroup, Date.now() - 3600000);

      const command = sendStub.firstCall.args[0];
      expect(command.input.logGroupName).to.equal('/aws/lambda/spacecat-services--content-scraper');
    });

    it('should handle events with extra whitespace in message', async () => {
      const mockEvents = [
        {
          message: 'Bot Protection Detection in Scraper:   {"jobId":"job-123","url":"https://example.com","blockerType":"cloudflare","httpStatus":403}',
          timestamp: Date.now(),
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('job-123', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com');
    });

    it('should log debug messages with correct timestamps', async () => {
      const startTime = Date.now() - 3600000;

      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('job-123', mockContext, startTime);

      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Querying bot protection logs from.*to.*/),
      );
    });
  });
});
