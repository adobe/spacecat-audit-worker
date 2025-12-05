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
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Unified Readability Guidance Handler', () => {
  let unifiedHandler;
  let mockPreflightHandler;
  let mockOpportunityHandler;
  let mockContext;
  let log;

  beforeEach(async () => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockContext = { log };

    mockPreflightHandler = sinon.stub().resolves({ status: 200, body: 'preflight response' });
    mockOpportunityHandler = sinon.stub().resolves({ status: 200, body: 'opportunity response' });

    const module = await esmock(
      '../../../src/readability/shared/unified-guidance-handler.js',
      {
        '../../../src/readability/preflight/guidance-handler.js': {
          default: mockPreflightHandler,
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

  describe('mode routing', () => {
    it('should route to preflight handler when mode is "preflight"', async () => {
      const message = {
        mode: 'preflight',
        siteId: 'site-123',
        data: { test: 'data' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Processing Mystique response with mode: preflight');
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Routing to preflight guidance handler');
    });

    it('should route to opportunity handler when mode is "opportunity"', async () => {
      const message = {
        mode: 'opportunity',
        siteId: 'site-123',
        auditId: 'audit-456',
        data: { test: 'data' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'opportunity response' });
      expect(mockOpportunityHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockPreflightHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Processing Mystique response with mode: opportunity');
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Routing to opportunity guidance handler');
    });

    it('should default to preflight handler when mode is missing', async () => {
      const message = {
        siteId: 'site-123',
        data: { test: 'data' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith('[unified-readability-guidance] Processing Mystique response with mode: preflight');
    });

    it('should default to preflight handler for unknown mode with warning', async () => {
      const message = {
        mode: 'unknown-mode',
        siteId: 'site-123',
        data: { test: 'data' },
      };

      const result = await unifiedHandler(message, mockContext);

      expect(result).to.deep.equal({ status: 200, body: 'preflight response' });
      expect(mockPreflightHandler).to.have.been.calledOnceWith(message, mockContext);
      expect(mockOpportunityHandler).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith("[unified-readability-guidance] Unknown mode: 'unknown-mode', defaulting to preflight for safety");
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
        "[unified-readability-guidance] Error processing Mystique response with mode 'preflight': Preflight handler error",
        testError,
      );
    });

    it('should catch and re-throw errors from opportunity handler', async () => {
      const testError = new Error('Opportunity handler error');
      mockOpportunityHandler.rejects(testError);

      const message = {
        mode: 'opportunity',
        siteId: 'site-123',
        auditId: 'audit-456',
      };

      await expect(unifiedHandler(message, mockContext)).to.be.rejectedWith('Opportunity handler error');
      expect(log.error).to.have.been.calledWith(
        "[unified-readability-guidance] Error processing Mystique response with mode 'opportunity': Opportunity handler error",
        testError,
      );
    });

    it('should catch and re-throw errors for unknown mode fallback', async () => {
      const testError = new Error('Fallback handler error');
      mockPreflightHandler.rejects(testError);

      const message = {
        mode: 'some-invalid-mode',
        siteId: 'site-123',
      };

      await expect(unifiedHandler(message, mockContext)).to.be.rejectedWith('Fallback handler error');
      expect(log.warn).to.have.been.calledWith("[unified-readability-guidance] Unknown mode: 'some-invalid-mode', defaulting to preflight for safety");
      expect(log.error).to.have.been.calledWith(
        "[unified-readability-guidance] Error processing Mystique response with mode 'some-invalid-mode': Fallback handler error",
        testError,
      );
    });
  });
});

