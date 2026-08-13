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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Unified Readability Guidance Handler', () => {
  let unifiedHandler;
  let mockPreflightHandler;
  let mockBatchHandler;
  let mockOpportunityHandler;
  let mockContext;
  let asyncJobFindById;
  let log;

  beforeEach(async () => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    // Default: auditId does NOT resolve to an AsyncJob, so a batched response routes to the
    // opportunity handler. Individual tests override this to exercise preflight-batch routing.
    asyncJobFindById = sinon.stub().resolves(null);
    mockContext = { log, dataAccess: { AsyncJob: { findById: asyncJobFindById } } };

    mockPreflightHandler = sinon.stub().resolves({ status: 200, body: 'preflight response' });
    mockBatchHandler = sinon.stub().resolves({ status: 200, body: 'preflight batch response' });
    mockOpportunityHandler = sinon.stub().resolves({ status: 200, body: 'opportunity response' });

    const module = await esmock(
      '../../../src/readability/shared/unified-guidance-handler.js',
      {
        '../../../src/readability/preflight/guidance-handler.js': {
          default: mockPreflightHandler,
        },
        '../../../src/readability/preflight/batch-guidance-handler.js': {
          default: mockBatchHandler,
        },
        '../../../src/readability/opportunities/guidance-handler.js': {
          default: mockOpportunityHandler,
        },
      },
    );

    unifiedHandler = module.default;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('payload-based routing', () => {
    it('should route to opportunity handler when s3ResultsPath is present and auditId is not an AsyncJob', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'readability/batch-results/site-123/audit-456.json' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockBatchHandler).to.not.have.been.called;
      expect(mockPreflightHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Detected s3ResultsPath — routing to opportunity guidance handler');
    });

    it('should route to preflight batch handler when s3ResultsPath is present and auditId is an AsyncJob', async () => {
      asyncJobFindById.resolves({ getId: () => 'job-456' });
      const message = {
        mode: 'preflight',
        siteId: 'site-123',
        auditId: 'job-456',
        data: { s3ResultsPath: 'readability/batch-requests/site-123/job-456.json' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight batch response' });
      expect(mockBatchHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(mockPreflightHandler).to.not.have.been.called;
      expect(asyncJobFindById).to.have.been.calledOnceWith('job-456');
    });

    it('should fall back to opportunity handler when dataAccess.AsyncJob is unavailable', async () => {
      const contextNoDataAccess = { log };
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'some/path.json' },
      };

      const result = await unifiedHandler(message, contextNoDataAccess);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnceWith(message, contextNoDataAccess);
      expect(mockBatchHandler).to.not.have.been.called;
    });

    it('should route to opportunity handler when AsyncJob lookup throws', async () => {
      asyncJobFindById.rejects(new Error('lookup failed'));
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'some/path.json' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnce;
      expect(mockBatchHandler).to.not.have.been.called;
    });

    it('should route to opportunity handler even without mode field when s3ResultsPath is present', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        traceId: 'trace-789',
        data: { s3ResultsPath: 'readability/batch-results/site-123/audit-456.json' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockPreflightHandler).to.not.have.been.called;
    });

    it('should route to opportunity handler when both mode and s3ResultsPath are present', async () => {
      const message = {
        mode: 'opportunity',
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'readability/batch-results/site-123/audit-456.json' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockPreflightHandler).to.not.have.been.called;
    });

    it('should route to preflight handler when mode is "preflight" and no s3ResultsPath', async () => {
      const message = {
        mode: 'preflight',
        siteId: 'site-123',
        data: { improved_paragraph: 'Simplified text.' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(mockBatchHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Routing to preflight guidance handler');
    });

    it('should route to preflight handler when mode is missing and no s3ResultsPath', async () => {
      const message = {
        siteId: 'site-123',
        data: { improved_paragraph: 'Simplified text.' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Processing Mystique response (mode: unknown)');
    });

    it('should route to preflight handler when data is missing entirely', async () => {
      const message = {
        siteId: 'site-123',
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
    });

    it('should route to preflight handler when data is null', async () => {
      const message = {
        siteId: 'site-123',
        data: null,
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
    });
  });

  describe('error handling', () => {
    it('should catch and re-throw errors from preflight handler', async () => {
      const testError = new Error('Preflight handler error');
      mockPreflightHandler.rejects(testError);

      const message = {
        mode: 'preflight',
        siteId: 'site-123',
      };

      await expect(unifiedHandler(message, mockContext)).to.be.rejectedWith('Preflight handler error');
      expect(log.error).to.have.been.calledWith(
        '[unified-readability-guidance] Error processing Mystique response (mode: preflight): Preflight handler error',
        testError,
      );
    });

    it('should catch and re-throw errors from opportunity handler', async () => {
      const testError = new Error('Opportunity handler error');
      mockOpportunityHandler.rejects(testError);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'readability/batch-results/site-123/audit-456.json' },
      };

      await expect(unifiedHandler(message, mockContext)).to.be.rejectedWith('Opportunity handler error');
      expect(log.error).to.have.been.calledWith(
        '[unified-readability-guidance] Error processing Mystique response (mode: unknown): Opportunity handler error',
        testError,
      );
    });

    it('should include mode in error log when mode is provided', async () => {
      const testError = new Error('Handler error');
      mockOpportunityHandler.rejects(testError);

      const message = {
        mode: 'opportunity',
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { s3ResultsPath: 'some/path.json' },
      };

      await expect(unifiedHandler(message, mockContext)).to.be.rejectedWith('Handler error');
      expect(log.error).to.have.been.calledWith(
        '[unified-readability-guidance] Error processing Mystique response (mode: opportunity): Handler error',
        testError,
      );
    });
  });
});
