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
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Async Mystique Tests', () => {
  let sendReadabilityToMystique;
  let mockSqs;
  let mockDataAccess;
  let mockSite;
  let mockAsyncJob;
  let existingJob;
  let log;
  let context;

  beforeEach(async () => {
    // Setup mocks
    log = {
      info: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSqs = {
      sendMessage: sinon.stub(),
    };

    mockSite = {
      getId: () => 'test-site-id',
      getDeliveryType: () => 'aem_edge',
    };

    existingJob = {
      getId: () => 'test-job',
      getMetadata: sinon.stub(),
      setMetadata: sinon.stub(),
      save: sinon.stub(),
    };

    mockAsyncJob = {
      findById: sinon.stub(),
    };

    mockDataAccess = {
      Site: {
        findById: sinon.stub().resolves(mockSite),
      },
      AsyncJob: mockAsyncJob,
    };

    context = {
      sqs: mockSqs,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
      },
      log,
      dataAccess: mockDataAccess,
    };

    // Mock the module
    sendReadabilityToMystique = await esmock(
      '../../../src/readability/async-mystique.js',
      {},
      {
        '../../../src/common/constants.js': {
          DATA_SOURCES: { SITE: 'Site', PAGE: 'Page' },
        },
        '../../../src/readability/constants.js': {
          READABILITY_GUIDANCE_TYPE: 'guidance:readability',
          READABILITY_OBSERVATION: 'Content readability needs improvement',
          TARGET_FLESCH_SCORE: 30.0,
        },
      },
    );

    sendReadabilityToMystique = sendReadabilityToMystique.sendReadabilityToMystique;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('sendReadabilityToMystique', () => {
    const sampleReadabilityIssues = [
      {
        textContent: 'This is a complex paragraph that needs improvement for better readability and understanding.',
        fleschReadingEase: 25.5,
        pageUrl: 'https://example.com/page1',
        selector: 'p:nth-child(1)',
      },
      {
        textContent: 'Another difficult passage that requires simplification to enhance comprehension levels.',
        fleschReadingEase: 28.0,
        pageUrl: 'https://example.com/page2',
        selector: 'div.content p:first-child',
      },
    ];

    it('should throw error when SQS context is missing', async () => {
      const invalidContext = {
        ...context,
        sqs: null,
      };

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          invalidContext,
        ),
      ).to.be.rejectedWith('Missing SQS context or queue configuration');

      expect(log.error).to.have.been.calledWithMatch(
        'Missing required context - sqs or queue configuration',
      );
    });

    it('should throw error when queue configuration is missing', async () => {
      const invalidContext = {
        ...context,
        env: {},
      };

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          invalidContext,
        ),
      ).to.be.rejectedWith('Missing SQS context or queue configuration');

      expect(log.error).to.have.been.calledWithMatch(
        'Missing required context - sqs or queue configuration',
      );
    });

    it('should successfully send readability issues when no existing job metadata exists', async () => {
      // Setup: Return existing job with empty metadata
      existingJob.getMetadata.returns({ payload: {} });
      mockAsyncJob.findById.resolves(existingJob);

      // Setup: SQS messages succeed
      mockSqs.sendMessage.resolves({ MessageId: 'msg-123' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify logging
      expect(log.debug).to.have.been.calledWithMatch('Sending 2 readability issues to Mystique');
      expect(log.debug).to.have.been.calledWithMatch('Stored readability metadata in job test-job');
      expect(log.debug).to.have.been.calledWithMatch('Successfully sent 2 messages to Mystique');

      // Verify job metadata update
      expect(mockAsyncJob.findById).to.have.been.calledWith('test-job');
      expect(existingJob.setMetadata).to.have.been.calledOnce;
      expect(existingJob.save).to.have.been.calledOnce;

      // Verify metadata structure
      const metadataCall = existingJob.setMetadata.firstCall.args[0];
      expect(metadataCall.payload.readabilityMetadata).to.deep.include({
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 2,
        totalReadabilityIssues: 2,
      });
      expect(metadataCall.payload.readabilityMetadata.originalOrderMapping).to.have.length(2);

      // Verify SQS messages
      expect(mockSqs.sendMessage).to.have.been.calledTwice;

      const firstMessage = mockSqs.sendMessage.firstCall.args[1];
      expect(firstMessage).to.deep.include({
        type: 'guidance:readability',
        siteId: 'test-site',
        auditId: 'test-job',
        deliveryType: 'aem_edge',
        url: 'https://example.com',
        observation: 'Content readability needs improvement',
      });
      expect(firstMessage.data).to.deep.include({
        jobId: 'test-job',
        original_paragraph: sampleReadabilityIssues[0].textContent,
        target_flesch_score: 30.0,
        current_flesch_score: 25.5,
        pageUrl: 'https://example.com/page1',
        selector: 'p:nth-child(1)',
      });
    });

    it('should update existing job metadata when readability metadata already exists', async () => {
      // Setup: Existing job with readability metadata
      existingJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            processedSuggestionIds: ['existing-id-1'],
            someOtherData: 'preserved',
          },
        },
      });

      mockAsyncJob.findById.resolves(existingJob);
      mockSqs.sendMessage.resolves({ MessageId: 'msg-456' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify job metadata was updated
      expect(log.debug).to.have.been.calledWithMatch(
        'Stored readability metadata in job test-job',
      );

      // Verify existing job metadata was updated with correct data
      expect(existingJob.setMetadata).to.have.been.calledOnce;
      expect(existingJob.save).to.have.been.calledOnce;
      const metadataCall = existingJob.setMetadata.firstCall.args[0];
      expect(metadataCall.payload.readabilityMetadata).to.deep.include({
        mystiqueResponsesReceived: 0, // Reset for new batch
        mystiqueResponsesExpected: 2,
        totalReadabilityIssues: 2,
      });
      expect(metadataCall.payload.readabilityMetadata.lastMystiqueRequest).to.be.a('string');
      expect(metadataCall.payload.readabilityMetadata.originalOrderMapping).to.have.length(2);
    });

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle partial SQS failures and throw error', async () => {
      // Setup: No existing opportunities
      mockOpportunity.allBySiteId.resolves([]);
      const newOpportunity = { getId: () => 'new-opportunity-id' };
      mockOpportunity.create.resolves(newOpportunity);

      // Setup: First message succeeds, second fails
      mockSqs.sendMessage
        .onFirstCall().resolves({ MessageId: 'msg-success' })
        .onSecondCall().rejects(new Error('SQS timeout'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Failed to send 1 out of 2 messages to Mystique');

      // Verify error logging for failed message
      expect(log.error).to.have.been.calledWithMatch('Failed to send SQS message 2:');
      expect(log.error).to.have.been.calledWithMatch('1 messages failed to send to Mystique');
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle complete SQS failures', async () => {
      // Setup: No existing opportunities
      mockOpportunity.allBySiteId.resolves([]);
      const newOpportunity = { getId: () => 'new-opportunity-id' };
      mockOpportunity.create.resolves(newOpportunity);

      // Setup: All messages fail
      mockSqs.sendMessage.rejects(new Error('Queue unavailable'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Failed to send 2 out of 2 messages to Mystique');

      expect(log.error).to.have.been.calledWithMatch('2 messages failed to send to Mystique');
    }); */

    it('should handle partial SQS failures and throw error (covers lines 116-123, 133-135)', async () => {
      // Setup: No existing job metadata
      mockAsyncJob.findById.resolves(existingJob);
      existingJob.getMetadata.returns({});
      existingJob.save.resolves();

      // Setup: First message succeeds, second fails
      mockSqs.sendMessage
        .onFirstCall().resolves({ MessageId: 'msg-success' })
        .onSecondCall().rejects(new Error('SQS timeout'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Failed to send 1 out of 2 messages to Mystique');

      // Verify error logging for failed message (lines 116-123)
      expect(log.error).to.have.been.calledWithMatch('Failed to send SQS message 2:');

      // Verify error logging for overall failure (lines 133-135)
      expect(log.error).to.have.been.calledWithMatch('1 messages failed to send to Mystique');
    });

    it('should handle complete SQS failures (covers lines 116-123, 133-135)', async () => {
      // Setup: No existing job metadata
      mockAsyncJob.findById.resolves(existingJob);
      existingJob.getMetadata.returns({});
      existingJob.save.resolves();

      // Setup: All messages fail
      mockSqs.sendMessage.rejects(new Error('Queue unavailable'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Failed to send 2 out of 2 messages to Mystique');

      // Verify error logging for failed messages (lines 116-123)
      expect(log.error).to.have.been.calledWithMatch('Failed to send SQS message 1:');
      expect(log.error).to.have.been.calledWithMatch('Failed to send SQS message 2:');

      // Verify error logging for overall failure (lines 133-135)
      expect(log.error).to.have.been.calledWithMatch('2 messages failed to send to Mystique');
    });

    it('should handle dataAccess.Site.findById failure', async () => {
      mockDataAccess.Site.findById.rejects(new Error('Database connection failed'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Database connection failed');

      expect(log.error).to.have.been.calledWithMatch(
        'Failed to send readability issues to Mystique: Database connection failed',
      );
    });

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle opportunity creation failure', async () => {
      // Setup: No existing opportunities, but creation fails
      mockOpportunity.allBySiteId.resolves([]);
      mockOpportunity.create.rejects(new Error('Failed to create opportunity in database'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Failed to create opportunity in database');

      expect(log.error).to.have.been.calledWithMatch(
        'Failed to create opportunity: Failed to create opportunity in database',
      );
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle opportunity.allBySiteId failure', async () => {
      mockOpportunity.allBySiteId.rejects(new Error('Database query failed'));

      await expect(
        sendReadabilityToMystique(
          'https://example.com',
          sampleReadabilityIssues,
          'test-site',
          'test-job',
          context,
        ),
      ).to.be.rejectedWith('Database query failed');

      expect(log.error).to.have.been.calledWithMatch(
        'Failed to send readability issues to Mystique: Database query failed',
      );
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should log debug information for each successful message', async () => {
      // Setup: No existing opportunities
      mockOpportunity.allBySiteId.resolves([]);
      const newOpportunity = { getId: () => 'new-opportunity-id' };
      mockOpportunity.create.resolves(newOpportunity);
      mockSqs.sendMessage.resolves({ MessageId: 'msg-123' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify debug logging for each message
      expect(log.debug).to.have.been.calledWithMatch('Sent message 1/2 to Mystique');
      expect(log.debug).to.have.been.calledWithMatch('Sent message 2/2 to Mystique');

      // Check debug call details for first message
      const firstDebugCall = log.debug.getCalls().find(
        (call) => call.args[0].includes('Sent message 1/2'),
      );
      expect(firstDebugCall.args[1]).to.deep.include({
        pageUrl: 'https://example.com/page1',
        textLength: sampleReadabilityIssues[0].textContent.length,
        fleschScore: 25.5,
      });
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle opportunity with empty/null getData()', async () => {
      // Setup: Existing opportunity with minimal getData() - has required subType
      // but other properties are null/undefined
      existingOpportunity.getData.returns({
        subType: 'readability',
        // Other properties are missing/undefined
      });
      mockOpportunity.allBySiteId.resolves([existingOpportunity]);
      mockSqs.sendMessage.resolves({ MessageId: 'msg-456' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify opportunity was updated with default empty object
      const updatedData = existingOpportunity.setData.firstCall.args[0];
      expect(updatedData).to.deep.include({
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 2,
        totalReadabilityIssues: 2,
        processedSuggestionIds: [], // Default empty array
      });
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should handle opportunity where getData() returns null during update', async () => {
      // Setup: Existing opportunity where getData() returns different values on different calls
      // First call (during find): returns object with subType so opportunity is found
      // Second call (during update): returns null, triggering the || {} fallback
      existingOpportunity.getData
        .onFirstCall().returns({ subType: 'readability', existingProp: 'value' })
        .onSecondCall().returns(null); // This triggers the || {} fallback

      mockOpportunity.allBySiteId.resolves([existingOpportunity]);
      mockSqs.sendMessage.resolves({ MessageId: 'msg-456' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify opportunity was updated with default empty object (|| {} was used)
      const updatedData = existingOpportunity.setData.firstCall.args[0];
      expect(updatedData).to.deep.include({
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 2,
        totalReadabilityIssues: 2,
        processedSuggestionIds: [], // Default empty array since existingData was null
      });
      expect(updatedData.lastMystiqueRequest).to.be.a('string');

      // Verify the existing property is NOT preserved since getData() returned null
      expect(updatedData.existingProp).to.be.undefined;
      expect(existingOpportunity.save).to.have.been.calledOnce;
    }); */

    // TODO: Fix this test to work with AsyncJob instead of Opportunity
    /* it('should create unique issue IDs for each readability issue', async () => {
      mockOpportunity.allBySiteId.resolves([]);
      const newOpportunity = { getId: () => 'new-opportunity-id' };
      mockOpportunity.create.resolves(newOpportunity);
      mockSqs.sendMessage.resolves({ MessageId: 'msg-123' });

      await sendReadabilityToMystique(
        'https://example.com',
        sampleReadabilityIssues,
        'test-site',
        'test-job',
        context,
      );

      // Verify each message has unique issue_id
      const firstMessage = mockSqs.sendMessage.firstCall.args[1];
      const secondMessage = mockSqs.sendMessage.secondCall.args[1];

      expect(firstMessage.data.issue_id).to.match(/^readability-\d+-0$/);
      expect(secondMessage.data.issue_id).to.match(/^readability-\d+-1$/);
      expect(firstMessage.data.issue_id).to.not.equal(secondMessage.data.issue_id);
    }); */
  });
});
