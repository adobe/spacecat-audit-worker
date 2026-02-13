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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { sendReadabilityToMystique } from '../../../src/readability/shared/async-mystique.js';

use(sinonChai);
use(chaiAsPromised);

describe('async-mystique sendReadabilityToMystique', () => {
  let mockContext;
  let mockSite;
  let mockJobEntity;
  let log;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSite = {
      getDeliveryType: sinon.stub().returns('aem_edge'),
    };

    mockJobEntity = {
      getMetadata: sinon.stub().returns({ payload: {} }),
      setMetadata: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    mockContext = {
      log,
      sqs: {
        sendMessage: sinon.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.example.com/mystique-queue',
      },
      dataAccess: {
        Site: {
          findById: sinon.stub().resolves(mockSite),
        },
        AsyncJob: {
          findById: sinon.stub().resolves(mockJobEntity),
        },
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('opportunity mode (non-preflight)', () => {
    it('should send readability issues in opportunity mode without storing metadata in AsyncJob', async () => {
      const readabilityIssues = [
        {
          textContent: 'This is a test paragraph with complex language.',
          fleschReadingEase: 25,
          pageUrl: 'https://example.com/page1',
          selector: 'p.content',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'audit-456',
        mockContext,
        'opportunity',
      );

      // Should log the opportunity mode message (lines 92-94)
      expect(log.debug).to.have.been.calledWith(
        '[readability-suggest async] Sending 1 readability issues for opportunity audit audit-456',
      );

      // Should NOT interact with AsyncJob for metadata storage
      expect(mockContext.dataAccess.AsyncJob.findById).to.not.have.been.called;

      // Should still send messages to Mystique
      expect(mockContext.sqs.sendMessage).to.have.been.calledOnce;

      // Verify message structure includes opportunity mode fields
      const sentMessage = mockContext.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.mode).to.equal('opportunity');
      expect(sentMessage.data.auditId).to.equal('audit-456');
      expect(sentMessage.data.jobId).to.be.undefined; // jobId should NOT be present in opportunity mode
    });

    it('should send multiple readability issues in opportunity mode', async () => {
      const readabilityIssues = [
        {
          textContent: 'First paragraph.',
          fleschReadingEase: 20,
          pageUrl: 'https://example.com/page1',
          selector: 'p.first',
        },
        {
          textContent: 'Second paragraph.',
          fleschReadingEase: 22,
          pageUrl: 'https://example.com/page2',
          selector: 'p.second',
        },
        {
          textContent: 'Third paragraph.',
          fleschReadingEase: 18,
          pageUrl: 'https://example.com/page3',
          selector: 'p.third',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'audit-789',
        mockContext,
        'opportunity',
      );

      // Should log the correct count
      expect(log.debug).to.have.been.calledWith(
        '[readability-suggest async] Sending 3 readability issues for opportunity audit audit-789',
      );

      // Should send 3 messages
      expect(mockContext.sqs.sendMessage).to.have.been.calledThrice;

      // All messages should be in opportunity mode
      for (let i = 0; i < 3; i += 1) {
        const sentMessage = mockContext.sqs.sendMessage.getCall(i).args[1];
        expect(sentMessage.mode).to.equal('opportunity');
        expect(sentMessage.data.auditId).to.equal('audit-789');
      }
    });
  });

  describe('preflight mode', () => {
    it('should store metadata in AsyncJob for preflight mode', async () => {
      const readabilityIssues = [
        {
          textContent: 'Test paragraph content.',
          fleschReadingEase: 28,
          pageUrl: 'https://example.com/page1',
          selector: 'p.content',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'job-456',
        mockContext,
        'preflight',
      );

      // Should interact with AsyncJob for metadata storage in preflight mode
      expect(mockContext.dataAccess.AsyncJob.findById).to.have.been.calledWith('job-456');
      expect(mockJobEntity.setMetadata).to.have.been.called;
      expect(mockJobEntity.save).to.have.been.called;

      // Verify metadata structure
      const setMetadataCall = mockJobEntity.setMetadata.getCall(0).args[0];
      expect(setMetadataCall.payload.readabilityMetadata).to.exist;
      expect(setMetadataCall.payload.readabilityMetadata.mystiqueResponsesExpected).to.equal(1);
      expect(setMetadataCall.payload.readabilityMetadata.totalReadabilityIssues).to.equal(1);
      expect(setMetadataCall.payload.readabilityMetadata.originalOrderMapping).to.have.lengthOf(1);

      // Verify message has jobId instead of auditId
      const sentMessage = mockContext.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.mode).to.equal('preflight');
      expect(sentMessage.data.jobId).to.equal('job-456');
      expect(sentMessage.data.auditId).to.be.undefined;
    });

    it('should extract selector from elements array for preflight mode', async () => {
      const readabilityIssues = [
        {
          textContent: 'Test paragraph content.',
          fleschReadingEase: 22,
          pageUrl: 'https://example.com/page1',
          elements: [{ selector: 'div.content > p:nth-of-type(2)' }],
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'job-456',
        mockContext,
        'preflight',
      );

      const sentMessage = mockContext.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.selector).to.equal('div.content > p:nth-of-type(2)');
      expect(sentMessage.mode).to.equal('preflight');
      expect(sentMessage.data.jobId).to.equal('job-456');
    });

    it('should fall back to empty string when neither selector nor elements is present', async () => {
      const readabilityIssues = [
        {
          textContent: 'Paragraph without any selector info.',
          fleschReadingEase: 18,
          pageUrl: 'https://example.com/page1',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'job-no-selector',
        mockContext,
        'preflight',
      );

      const sentMessage = mockContext.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.data.selector).to.equal('');
      expect(sentMessage.mode).to.equal('preflight');
    });
  });

  describe('default mode', () => {
    it('should default to preflight mode when mode is not specified', async () => {
      const readabilityIssues = [
        {
          textContent: 'Test paragraph.',
          fleschReadingEase: 25,
          pageUrl: 'https://example.com/page1',
          selector: 'p.test',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'job-default',
        mockContext,
        // mode not specified - should default to 'preflight'
      );

      // Should use preflight mode behavior
      expect(mockContext.dataAccess.AsyncJob.findById).to.have.been.calledWith('job-default');
      expect(mockJobEntity.setMetadata).to.have.been.called;
    });
  });

  describe('error handling', () => {
    it('should throw error when sqs is missing', async () => {
      mockContext.sqs = null;

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          [{ textContent: 'test', fleschReadingEase: 20, pageUrl: 'url', selector: 'p' }],
          'site-123',
          'job-456',
          mockContext,
          'opportunity',
        ),
      ).to.be.rejectedWith('Missing SQS context or queue configuration');

      expect(log.error).to.have.been.calledWith(
        '[readability-suggest async] Missing required context - sqs or queue configuration',
      );
    });

    it('should throw error when queue configuration is missing', async () => {
      mockContext.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          [{ textContent: 'test', fleschReadingEase: 20, pageUrl: 'url', selector: 'p' }],
          'site-123',
          'job-456',
          mockContext,
          'opportunity',
        ),
      ).to.be.rejectedWith('Missing SQS context or queue configuration');
    });

    it('should throw error when some messages fail to send', async () => {
      mockContext.sqs.sendMessage
        .onFirstCall().resolves()
        .onSecondCall().rejects(new Error('SQS error'));

      const readabilityIssues = [
        { textContent: 'First', fleschReadingEase: 20, pageUrl: 'url1', selector: 'p1' },
        { textContent: 'Second', fleschReadingEase: 22, pageUrl: 'url2', selector: 'p2' },
      ];

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          readabilityIssues,
          'site-123',
          'audit-456',
          mockContext,
          'opportunity',
        ),
      ).to.be.rejectedWith('Failed to send 1 out of 2 messages to Mystique');
    });
  });

  describe('message structure', () => {
    it('should construct correct Mystique message for opportunity mode', async () => {
      const readabilityIssues = [
        {
          textContent: 'Complex paragraph needing simplification.',
          fleschReadingEase: 15,
          pageUrl: 'https://example.com/article',
          selector: 'div.content p',
        },
      ];

      await sendReadabilityToMystique(
        'https://example.com',
        readabilityIssues,
        'site-abc',
        'audit-xyz',
        mockContext,
        'opportunity',
      );

      const sentMessage = mockContext.sqs.sendMessage.getCall(0).args[1];

      expect(sentMessage.type).to.equal('guidance:readability');
      expect(sentMessage.siteId).to.equal('site-abc');
      expect(sentMessage.auditId).to.equal('audit-xyz');
      expect(sentMessage.mode).to.equal('opportunity');
      expect(sentMessage.deliveryType).to.equal('aem_edge');
      expect(sentMessage.url).to.equal('https://example.com');
      expect(sentMessage.observation).to.equal('Content readability needs improvement');
      expect(sentMessage.data.original_paragraph).to.equal('Complex paragraph needing simplification.');
      expect(sentMessage.data.current_flesch_score).to.equal(15);
      expect(sentMessage.data.target_flesch_score).to.equal(30);
      expect(sentMessage.data.pageUrl).to.equal('https://example.com/article');
      expect(sentMessage.data.selector).to.equal('div.content p');
      expect(sentMessage.data.issue_id).to.match(/^readability-\d+-0$/);
    });
  });
});

