/*
 * Copyright 2024 Adobe. All rights reserved.
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
import { createContextLogger, createAuditLogger } from '../../../src/internal-links/logger-helper.js';

use(sinonChai);

describe('logger-helper', () => {
  let mockLog;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createContextLogger', () => {
    it('should create logger with siteId prefix', () => {
      const log = createContextLogger(mockLog, 'test-site-123');

      log.info('Test message');
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=test-site-123] Test message',
      );
    });

    it('should handle info with additional arguments', () => {
      const log = createContextLogger(mockLog, 'site-456');

      log.info('Message with %s', 'args', { extra: 'data' });
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-456] Message with %s',
        'args',
        { extra: 'data' },
      );
    });

    it('should handle warn messages', () => {
      const log = createContextLogger(mockLog, 'site-789');

      log.warn('Warning message');
      expect(mockLog.warn).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-789] Warning message',
      );
    });

    it('should handle error messages', () => {
      const log = createContextLogger(mockLog, 'site-abc');

      log.error('Error message');
      expect(mockLog.error).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-abc] Error message',
      );
    });

    it('should handle debug messages', () => {
      const log = createContextLogger(mockLog, 'site-def');

      log.debug('Debug message');
      expect(mockLog.debug).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-def] Debug message',
      );
    });
  });

  describe('createAuditLogger', () => {
    it('should create logger with siteId and auditId prefix', () => {
      const log = createAuditLogger(mockLog, 'test-site-123', 'audit-456');

      log.info('Test message');
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=test-site-123] [auditId=audit-456] Test message',
      );
    });

    it('should create logger with only siteId when auditId is null', () => {
      const log = createAuditLogger(mockLog, 'site-789', null);

      log.info('Test message');
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-789] Test message',
      );
    });

    it('should create logger with only siteId when auditId is omitted', () => {
      const log = createAuditLogger(mockLog, 'site-xyz');

      log.info('Test message');
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-xyz] Test message',
      );
    });

    it('should handle warn messages with auditId', () => {
      const log = createAuditLogger(mockLog, 'site-123', 'audit-abc');

      log.warn('Warning message');
      expect(mockLog.warn).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-123] [auditId=audit-abc] Warning message',
      );
    });

    it('should handle error messages with auditId', () => {
      const log = createAuditLogger(mockLog, 'site-456', 'audit-def');

      log.error('Error message');
      expect(mockLog.error).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-456] [auditId=audit-def] Error message',
      );
    });

    it('should handle debug messages with auditId', () => {
      const log = createAuditLogger(mockLog, 'site-789', 'audit-ghi');

      log.debug('Debug message');
      expect(mockLog.debug).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-789] [auditId=audit-ghi] Debug message',
      );
    });

    it('should handle multiple arguments', () => {
      const log = createAuditLogger(mockLog, 'site-multi', 'audit-args');

      log.info('Message with %s and %d', 'string', 42, { extra: 'data' });
      expect(mockLog.info).to.have.been.calledWith(
        '[broken-internal-links] [siteId=site-multi] [auditId=audit-args] Message with %s and %d',
        'string',
        42,
        { extra: 'data' },
      );
    });
  });
});
