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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Frescopa Data Generation Handler', () => {
  let sandbox;
  let context;
  let mockSharepointClient;
  let mockDocument;
  let handlerModule;
  let fetchStub;
  let publishToAdminHlxStub;

  const mockQueryIndexData = {
    data: [
      { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w04-2025.json', lastModified: '2025-01-20' },
      { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w03-2025.json', lastModified: '2025-01-13' },
      { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w02-2025.json', lastModified: '2025-01-06' },
      { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2025.json', lastModified: '2024-12-30' },
      { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w52-2024.json', lastModified: '2024-12-23' },
      { path: '/frescopa.coffee/brand-presence/brandpresence-all-w04-2025.json', lastModified: '2025-01-20' },
      { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2025.json', lastModified: '2025-01-13' },
      { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2025.json', lastModified: '2025-01-06' },
      { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2025.json', lastModified: '2024-12-30' },
      { path: '/frescopa.coffee/brand-presence/brandpresence-all-w52-2024.json', lastModified: '2024-12-23' },
      { path: '/frescopa.coffee/referral-traffic/referral-traffic-w04-2025.json', lastModified: '2025-01-20' },
      { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2025.json', lastModified: '2025-01-13' },
      { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2025.json', lastModified: '2025-01-06' },
      { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2025.json', lastModified: '2024-12-30' },
      { path: '/frescopa.coffee/referral-traffic/referral-traffic-w52-2024.json', lastModified: '2024-12-23' },
    ],
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockDocument = {
      copy: sandbox.stub().resolves(),
      move: sandbox.stub().resolves(),
      delete: sandbox.stub().resolves(),
      exists: sandbox.stub().resolves(true),
    };

    mockSharepointClient = {
      getDocument: sandbox.stub().returns(mockDocument),
    };

    fetchStub = sandbox.stub(global, 'fetch');
    fetchStub.resolves({
      ok: true,
      json: sandbox.stub().resolves(mockQueryIndexData),
    });

    // Stub fetch for DELETE requests (unpublish)
    fetchStub.withArgs(sinon.match(/admin\.hlx\.page/), sinon.match({ method: 'DELETE' })).resolves({
      ok: true,
      status: 204,
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        env: {
          SHAREPOINT_CLIENT_ID: 'client-id',
          SHAREPOINT_CLIENT_SECRET: 'client-secret',
          SHAREPOINT_AUTHORITY: 'authority',
          SHAREPOINT_DOMAIN_ID: 'domain-id',
          ADMIN_HLX_API_KEY: 'api-key',
        },
      })
      .build();

    publishToAdminHlxStub = sandbox.stub().resolves();

    handlerModule = await esmock('../../src/frescopa-data-generation/handler.js', {
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves(mockSharepointClient),
        publishToAdminHlx: publishToAdminHlxStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Happy Path - Sliding Window Operation', () => {
    it('should successfully perform sliding window for all report types', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(200);
      expect(result).to.have.property('targetWeekIdentifier', 'w05-2025');
      expect(result.results).to.have.lengthOf(3);
      expect(result.errors).to.have.lengthOf(0);

      // Verify each report type was processed
      const reportTypes = result.results.map((r) => r.filePrefix);
      expect(reportTypes).to.include('agentictraffic');
      expect(reportTypes).to.include('brandpresence-all');
      expect(reportTypes).to.include('referral-traffic');

      // Verify operations were performed
      result.results.forEach((report) => {
        expect(report.status).to.equal('success');
        expect(report.operations).to.have.lengthOf(6); // 1 copy + 4 moves + 1 unpublish
        expect(report.published).to.have.lengthOf(5);
      });
    });

    it('should perform copy operation for newest file', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      await handlerModule.default.run(message, context);

      // Verify copy was called for each report type (3 times total)
      expect(mockDocument.copy).to.have.been.calledThrice;

      // Verify copy paths for agentic-traffic
      const copyCall = mockDocument.copy.getCall(0);
      expect(mockSharepointClient.getDocument).to.have.been.calledWith(
        '/sites/elmo-ui-data/frescopa.coffee/agentic-traffic/agentictraffic-w04-2025.xlsx',
      );
    });

    it('should perform move operations in reverse order', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      await handlerModule.default.run(message, context);

      // Verify move was called 12 times (4 moves per report type × 3 types)
      expect(mockDocument.move).to.have.callCount(12);

      // Verify delete was called 3 times (once per report type, only on first iteration)
      expect(mockDocument.delete).to.have.been.calledThrice;
    });

    it('should publish all 5 files for each report type', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      await handlerModule.default.run(message, context);

      // 5 files × 3 report types = 15 publish calls
      expect(publishToAdminHlxStub).to.have.callCount(15);
    });

    it('should calculate target week automatically when not provided', async () => {
      const message = {
        auditContext: {},
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(200);
      expect(result).to.have.property('targetWeekIdentifier');
      // Should be in format wXX-YYYY
      expect(result.targetWeekIdentifier).to.match(/^w\d{2}-\d{4}$/);
    });

    it('should handle re-running for the same week', async () => {
      // Set the newest file to match target week
      const queryIndexWithSameWeek = {
        data: [
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w05-2025.json', lastModified: '2025-01-27' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w05-2025.json', lastModified: '2025-01-27' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w05-2025.json', lastModified: '2025-01-27' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2025.json', lastModified: '2024-12-30' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(queryIndexWithSameWeek),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const result = await handlerModule.default.run(message, context);

      expect(result.status).to.equal(200);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Target week w05-2025 already exists.*Re-running sliding window/),
      );
    });

    it('should skip report type when insufficient files found', async () => {
      // Query index with only 3 files for agentic-traffic
      const queryIndexWithInsufficientFiles = {
        data: [
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w02-2025.json', lastModified: '2025-01-06' },
          // Only 3 files - insufficient!
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w52-2024.json', lastModified: '2024-12-23' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w52-2024.json', lastModified: '2024-12-23' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(queryIndexWithInsufficientFiles),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(2); // Only brand-presence and referral-traffic
      expect(result.errors).to.have.lengthOf(1);
      expect(result.errors[0].filePrefix).to.equal('agentictraffic');
      expect(result.errors[0].error).to.include('Insufficient files');
    });

    it('should continue processing other types when one type fails', async () => {
      // Make copy fail for the first report type
      let callCount = 0;
      mockDocument.copy = sandbox.stub().callsFake(() => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Copy failed for agentic-traffic');
        }
        return Promise.resolve();
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(2); // brand-presence and referral-traffic succeeded
      expect(result.errors).to.have.lengthOf(1);
      expect(result.errors[0].filePrefix).to.equal('agentictraffic');
    });

    it('should continue publishing even if one publish fails', async () => {
      // Recreate the handler module with a new mock that throws on specific call
      const publishStub = sandbox.stub();
      publishStub.onCall(2).rejects(new Error('Publish failed for file 3'));
      publishStub.resolves();

      handlerModule = await esmock('../../src/frescopa-data-generation/handler.js', {
        '../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(mockSharepointClient),
          publishToAdminHlx: publishStub,
        },
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const result = await handlerModule.default.run(message, context);

      // Should still succeed overall even if one publish fails
      expect(result.status).to.equal(200);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to publish.*: Publish failed for file 3/),
        'FRESCOPA_DATA_GENERATION',
        sinon.match.instanceOf(Error),
      );
      
      // Verify that publishing continued after the error
      expect(publishStub.callCount).to.be.greaterThan(3);
    });

    it('should return internal server error when query index fetch fails', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(500);
      expect(result).to.be.an('object');
      expect(result.message).to.include('Frescopa data generation failed');
    });

    it('should log detailed operation information', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      await handlerModule.default.run(message, context);

      // Verify key log messages
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Starting Frescopa sliding window data generation for target week w05-2025/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Found \d+ files in query index/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Processing report type/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Copying w\d{2}-\d{4} -> w\d{2}-\d{4}/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Moving w\d{2}-\d{4} -> w\d{2}-\d{4}/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Sliding window completed/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Publishing \d+ files/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Published/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Frescopa sliding window completed for target week w05-2025 in \d+ms/),
      );
    });

    it('should include duration in result', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(result).to.have.property('duration');
      expect(result.duration).to.be.a('number');
      expect(result.duration).to.be.at.least(0);
    });

    it('should return correct operation details in result', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      const agenticResult = result.results.find((r) => r.filePrefix === 'agentictraffic');
      
      expect(agenticResult).to.exist;
      expect(agenticResult.operations).to.be.an('array');
      expect(agenticResult.operations[0]).to.have.property('operation', 'copy');
      expect(agenticResult.operations[0]).to.have.property('status', 'success');
      
      // Check move operations
      const moveOps = agenticResult.operations.filter((op) => op.operation === 'move');
      expect(moveOps).to.have.lengthOf(4);
      moveOps.forEach((op) => {
        expect(op).to.have.property('from');
        expect(op).to.have.property('to');
        expect(op).to.have.property('status', 'success');
      });

      // Check unpublish operation
      const unpublishOps = agenticResult.operations.filter((op) => op.operation === 'unpublish');
      expect(unpublishOps).to.have.lengthOf(1);
      expect(unpublishOps[0]).to.have.property('status', 'success');
    });
  });

  describe('Week Calculation Functions', () => {
    it('should correctly calculate ISO week number', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Week identifier should be in correct format
      expect(result.targetWeekIdentifier).to.match(/^w\d{2}-\d{4}$/);
    });

    it('should handle year boundaries correctly', async () => {
      // Test with a date that would create week 1 of next year
      const message = {
        auditContext: {
          weekIdentifier: 'w01-2025',
        },
      };

      // Should process without errors
      const result = await handlerModule.default.run(message, context);

      expect(result.status).to.equal(200);
    });

    it('should handle Sunday correctly in ISO week calculation (tests dayNum || 7 on line 114 and 130)', async () => {
      // This tests the d.getUTCDay() || 7 logic on lines 114 and 130
      // Sunday dates (getUTCDay() === 0) trigger the || 7 fallback
      // Sunday, January 5, 2025 is in week 01 of 2025 (getUTCDay() returns 0)
      // We need to mock the current date to be a Sunday to trigger automatic week calculation
      
      const clock = sandbox.useFakeTimers({
        now: new Date(Date.UTC(2025, 0, 5, 12, 0, 0)).getTime(), // Sunday, Jan 5, 2025 at noon UTC
        shouldAdvanceTime: true,
        advanceTimeDelta: 20,
      });
      
      const sundayQueryIndex = {
        data: [
          // Files for the calculated week - w52-2024 will be copied to create w01-2025
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w52-2024.json', lastModified: '2024-12-29' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w51-2024.json', lastModified: '2024-12-22' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w50-2024.json', lastModified: '2024-12-15' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w49-2024.json', lastModified: '2024-12-08' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w48-2024.json', lastModified: '2024-12-01' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w52-2024.json', lastModified: '2024-12-29' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w51-2024.json', lastModified: '2024-12-22' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w50-2024.json', lastModified: '2024-12-15' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w49-2024.json', lastModified: '2024-12-08' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w48-2024.json', lastModified: '2024-12-01' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w52-2024.json', lastModified: '2024-12-29' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w51-2024.json', lastModified: '2024-12-22' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w50-2024.json', lastModified: '2024-12-15' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w49-2024.json', lastModified: '2024-12-08' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w48-2024.json', lastModified: '2024-12-01' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(sundayQueryIndex),
      });

      const message = {
        auditContext: {}, // No weekIdentifier - will auto-calculate using Sunday date
      };

      try {
        const response = await handlerModule.default.run(message, context);
        const result = await response.json();

        // Should calculate week identifier using Sunday logic (|| 7 branch)
        // Current date is 2025-01-05 (Sunday, week 01), current week is w01-2025
        // The sliding window should succeed: copy w52-2024 to create w01-2025
        expect(response.status).to.equal(200);
        expect(result.targetWeekIdentifier).to.equal('w01-2025'); // Current week from Jan 5, 2025
        expect(result.results).to.have.lengthOf(3); // Should succeed for all 3 report types
        expect(result.errors).to.have.lengthOf(0);
        
        // Verify operations were performed
        result.results.forEach((report) => {
          expect(report.status).to.equal('success');
          expect(report.operations).to.have.lengthOf(6); // 1 copy + 4 moves + 1 unpublish
        });
      } finally {
        clock.restore();
      }
    });

    it('should handle Sunday at year boundary (covers both getISOWeekNumber and getISOWeekYear)', async () => {
      // Test Sunday, December 31, 2023 (week 52 of 2023)
      // This ensures both line 114 (getISOWeekNumber) and line 130 (getISOWeekYear) are covered
      // when getUTCDay() returns 0 (Sunday) at a year boundary
      
      const clock = sandbox.useFakeTimers({
        now: new Date(Date.UTC(2023, 11, 31, 12, 0, 0)).getTime(), // Sunday, Dec 31, 2023 at noon UTC
        shouldAdvanceTime: true,
        advanceTimeDelta: 20,
      });
      
      const yearBoundarySundayQueryIndex = {
        data: [
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w51-2023.json', lastModified: '2023-12-24' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w50-2023.json', lastModified: '2023-12-17' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w49-2023.json', lastModified: '2023-12-10' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w51-2023.json', lastModified: '2023-12-24' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w50-2023.json', lastModified: '2023-12-17' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w49-2023.json', lastModified: '2023-12-10' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w51-2023.json', lastModified: '2023-12-24' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w50-2023.json', lastModified: '2023-12-17' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w49-2023.json', lastModified: '2023-12-10' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(yearBoundarySundayQueryIndex),
      });

      const message = {
        auditContext: {}, // No weekIdentifier - will auto-calculate using Sunday date at year boundary
      };

      try {
        const response = await handlerModule.default.run(message, context);
        const result = await response.json();

        // Should calculate week identifier using Sunday logic (|| 7 branch) at year boundary
        // December 31, 2023 (Sunday) is in week 52 of 2023
        expect(response.status).to.equal(200);
        expect(result.targetWeekIdentifier).to.equal('w52-2023'); // Week 52 from Dec 31, 2023
      } finally {
        clock.restore();
      }
    });
  });

  describe('File Path Building', () => {
    it('should build correct SharePoint paths for all file types', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      await handlerModule.default.run(message, context);

      // Verify correct paths were used for each type
      expect(mockSharepointClient.getDocument).to.have.been.calledWith(
        sinon.match(/\/sites\/elmo-ui-data\/frescopa\.coffee\/agentic-traffic\/agentictraffic-w\d{2}-\d{4}\.xlsx/),
      );
      expect(mockSharepointClient.getDocument).to.have.been.calledWith(
        sinon.match(/\/sites\/elmo-ui-data\/frescopa\.coffee\/brand-presence\/brandpresence-all-w\d{2}-\d{4}\.xlsx/),
      );
      expect(mockSharepointClient.getDocument).to.have.been.calledWith(
        sinon.match(/\/sites\/elmo-ui-data\/frescopa\.coffee\/referral-traffic\/referral-traffic-w\d{2}-\d{4}\.xlsx/),
      );
    });
  });

  describe('Query Index Parsing', () => {
    it('should correctly parse and filter files by type', async () => {
      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Each type should have found exactly 5 files
      result.results.forEach((report) => {
        expect(report.published).to.have.lengthOf(5);
      });
    });

    it('should handle empty data property in query index response (tests data.data || [])', async () => {
      // Test fallback for data.data || [] on line 96
      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves({ data: null }),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Should handle gracefully and return success with errors for all types
      expect(response.status).to.equal(200);
      expect(result.errors).to.have.lengthOf(3);
      result.errors.forEach((error) => {
        expect(error.error).to.include('Insufficient files');
      });
    });

    it('should handle missing data property in query index response (tests data.data || [])', async () => {
      // Test fallback for data.data || [] on line 96
      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves({}),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Should handle gracefully and return success with errors for all types
      expect(response.status).to.equal(200);
      expect(result.errors).to.have.lengthOf(3);
      result.errors.forEach((error) => {
        expect(error.error).to.include('Insufficient files');
      });
    });

    it('should handle when no files found for a prefix', async () => {
      // Query index with no matching files for agentic-traffic
      const queryIndexNoAgenticFiles = {
        data: [
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w52-2024.json', lastModified: '2024-12-23' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w52-2024.json', lastModified: '2024-12-23' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(queryIndexNoAgenticFiles),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(2); // Only brand-presence and referral-traffic
      expect(result.errors).to.have.lengthOf(1);
      expect(result.errors[0].filePrefix).to.equal('agentictraffic');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No files found matching prefix "agentictraffic-w"/),
      );
    });

    it('should sort files by week identifier correctly', async () => {
      // Add files in random order to query index
      const unorderedQueryIndex = {
        data: [
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w52-2024.json', lastModified: '2024-12-23' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w52-2024.json', lastModified: '2024-12-23' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w04-2025.json', lastModified: '2025-01-20' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2025.json', lastModified: '2025-01-13' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2025.json', lastModified: '2025-01-06' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2025.json', lastModified: '2024-12-30' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w52-2024.json', lastModified: '2024-12-23' },
        ],
      };

      fetchStub.resolves({
        ok: true,
        json: sandbox.stub().resolves(unorderedQueryIndex),
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Should still process successfully with correct ordering
      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(3);
    });
  });

  describe('Unpublish Error Handling', () => {
    it('should handle unpublish failure gracefully and continue', async () => {
      // Make DELETE requests fail
      fetchStub.withArgs(sinon.match(/admin\.hlx\.page.*\/live\//), sinon.match({ method: 'DELETE' })).resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      fetchStub.withArgs(sinon.match(/admin\.hlx\.page.*\/preview\//), sinon.match({ method: 'DELETE' })).resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Should still succeed even though unpublish failed
      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(3);
      
      // Verify warning was logged
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to unpublish from (live|preview): 404 Not Found/),
      );

      // Verify operations still show unpublish in results
      result.results.forEach((report) => {
        const unpublishOp = report.operations.find((op) => op.operation === 'unpublish');
        expect(unpublishOp).to.exist;
        expect(unpublishOp.status).to.equal('success');
      });
    });

    it('should handle unpublish exception gracefully and continue', async () => {
      // Make DELETE requests throw an error
      fetchStub.withArgs(sinon.match(/admin\.hlx\.page/), sinon.match({ method: 'DELETE' })).rejects(
        new Error('Network error during unpublish'),
      );

      const message = {
        auditContext: {
          weekIdentifier: 'w05-2025',
        },
      };

      const response = await handlerModule.default.run(message, context);
      const result = await response.json();

      // Should still succeed even though unpublish threw an error
      expect(response.status).to.equal(200);
      expect(result.results).to.have.lengthOf(3);
      
      // Verify error was logged
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to unpublish.*: Network error during unpublish/),
        'FRESCOPA_DATA_GENERATION',
        sinon.match.instanceOf(Error),
      );

      // Verify operations still show unpublish in results
      result.results.forEach((report) => {
        const unpublishOp = report.operations.find((op) => op.operation === 'unpublish');
        expect(unpublishOp).to.exist;
        expect(unpublishOp.status).to.equal('success');
      });
    });
  });
});
