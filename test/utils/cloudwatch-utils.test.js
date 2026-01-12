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
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { queryBotProtectionLogs } from '../../src/utils/cloudwatch-utils.js';

describe('CloudWatch Utils', () => {
  let sendStub;
  let mockContext;

  beforeEach(() => {
    sendStub = sinon.stub(CloudWatchLogsClient.prototype, 'send');
    mockContext = {
      env: {
        AWS_REGION: 'us-east-1',
        CONTENT_SCRAPER_LOG_GROUP: '/aws/lambda/test-scraper',
      },
      log: {
        info: sinon.stub(),
        debug: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('queryBotProtectionLogs', () => {
    it('should successfully parse bot protection events from CloudWatch logs', async () => {
      const mockEvents = [
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper: {"jobId":"job-123","siteId":"site-456","url":"https://example.com","blockerType":"cloudflare","confidence":0.99,"httpStatus":403,"errorCategory":"bot-protection"}',
        },
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper: {"jobId":"job-123","siteId":"site-456","url":"https://example.com/page","blockerType":"akamai","confidence":0.95,"httpStatus":403,"errorCategory":"bot-protection"}',
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.deep.include({
        jobId: 'job-123',
        siteId: 'site-456',
        url: 'https://example.com',
        blockerType: 'cloudflare',
        confidence: 0.99,
        httpStatus: 403,
        errorCategory: 'bot-protection',
      });
      expect(result[1].blockerType).to.equal('akamai');
    });

    it('should return empty array when no events found', async () => {
      sendStub.resolves({
        events: [],
      });

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.debug).to.have.been.calledWith('No bot protection logs found for site site-456');
    });

    it('should return empty array when events is undefined', async () => {
      sendStub.resolves({});

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle parse errors gracefully', async () => {
      const mockEvents = [
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper: {invalid json}',
        },
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper: {"jobId":"job-123","url":"https://example.com"}',
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(1);
      expect(result[0].jobId).to.equal('job-123');
      expect(mockContext.log.warn).to.have.been.called;
    });

    it('should return empty array on CloudWatch query error', async () => {
      sendStub.rejects(new Error('CloudWatch error'));

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.error).to.have.been.calledWith(
        'Failed to query CloudWatch logs for bot protection (site site-456):',
        sinon.match.instanceOf(Error),
      );
    });

    it('should use correct time range for query with 5-minute buffer', async () => {
      const startTime = 1768100153025;
      const beforeCallTime = Date.now();

      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('site-456', mockContext, startTime);

      const afterCallTime = Date.now();

      expect(sendStub).to.have.been.calledOnce;
      const command = sendStub.firstCall.args[0];
      expect(command).to.be.instanceOf(FilterLogEventsCommand);
      // Expect 5-minute buffer applied (5 * 60 * 1000 = 300000ms)
      expect(command.input.startTime).to.equal(startTime - (5 * 60 * 1000));
      expect(command.input.endTime).to.be.at.least(beforeCallTime);
      expect(command.input.endTime).to.be.at.most(afterCallTime);
    });

    it('should use correct log group and filter pattern', async () => {
      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      const command = sendStub.firstCall.args[0];
      expect(command.input.logGroupName).to.equal('/aws/lambda/test-scraper');
      // Text-based filter since logs have prefix: [BOT-BLOCKED] Bot Protection Detection
      expect(command.input.filterPattern).to.equal('"[BOT-BLOCKED]" "site-456"');
      expect(command.input.limit).to.equal(500);
    });

    it('should use default log group when not specified in env', async () => {
      const contextWithoutLogGroup = {
        ...mockContext,
        env: {
          AWS_REGION: 'us-east-1',
        },
      };

      sendStub.resolves({
        events: [],
      });

      await queryBotProtectionLogs('site-456', contextWithoutLogGroup, Date.now() - 3600000);

      const command = sendStub.firstCall.args[0];
      expect(command.input.logGroupName).to.equal('/aws/lambda/spacecat-services--content-scraper');
    });

    it('should filter out events that do not match the expected format', async () => {
      const mockEvents = [
        {
          message: 'Some other log message',
        },
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper: {"jobId":"job-123","url":"https://example.com"}',
        },
        {
          message: 'Another unrelated message',
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(1);
      expect(result[0].jobId).to.equal('job-123');
    });

    it('should handle whitespace variations in log messages', async () => {
      const mockEvents = [
        {
          message: '[BOT-BLOCKED] Bot Protection Detection in Scraper:    {"jobId":"job-123","url":"https://example.com"}',
        },
      ];

      sendStub.resolves({
        events: mockEvents,
      });

      const result = await queryBotProtectionLogs('site-456', mockContext, Date.now() - 3600000);

      expect(result).to.have.lengthOf(1);
      expect(result[0].jobId).to.equal('job-123');
    });

    it('should log debug message about query time range', async () => {
      sendStub.resolves({
        events: [],
      });

      const startTime = Date.now() - 3600000;
      await queryBotProtectionLogs('site-456', mockContext, startTime);

      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Querying bot protection logs from .* to .* \(5min buffer applied\) for site site-456$/),
      );
    });
  });
});
