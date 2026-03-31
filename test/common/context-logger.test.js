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
import {
  createContextLogger,
  createAuditLogger,
  createSiteLogger,
} from '../../src/common/context-logger.js';

describe('Context Logger', () => {
  let sandbox;
  let baseLog;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    baseLog = {
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
    it('should create a context logger with all methods', () => {
      const context = { auditType: 'test', siteId: 'site-123' };
      const log = createContextLogger(baseLog, context);

      expect(log).to.have.property('info');
      expect(log).to.have.property('warn');
      expect(log).to.have.property('error');
      expect(log).to.have.property('debug');
    });

    it('should prefix messages with context', () => {
      const context = { auditType: 'test', siteId: 'site-123' };
      const log = createContextLogger(baseLog, context);

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledOnce;
      expect(baseLog.info).to.have.been.calledWith('[auditType=test] [siteId=site-123] Test message');
    });

    it('should filter out null values from context', () => {
      const context = { auditType: 'test', siteId: 'site-123', auditId: null };
      const log = createContextLogger(baseLog, context);

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledWith('[auditType=test] [siteId=site-123] Test message');
    });

    it('should filter out undefined values from context', () => {
      const context = { auditType: 'test', siteId: undefined, auditId: 'audit-123' };
      const log = createContextLogger(baseLog, context);

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledWith('[auditType=test] [auditId=audit-123] Test message');
    });

    it('should pass additional arguments to base log', () => {
      const context = { auditType: 'test' };
      const log = createContextLogger(baseLog, context);

      log.info('Message with args', { foo: 'bar' }, 123);

      expect(baseLog.info).to.have.been.calledWith('[auditType=test] Message with args', { foo: 'bar' }, 123);
    });

    it('should throw error if log is null', () => {
      expect(() => createContextLogger(null, { auditType: 'test' }))
        .to.throw('Invalid log object: log must be an object with logging methods');
    });

    it('should throw error if log is not an object', () => {
      expect(() => createContextLogger('not-an-object', { auditType: 'test' }))
        .to.throw('Invalid log object: log must be an object with logging methods');
    });

    it('should throw error if log is missing info method', () => {
      const invalidLog = { warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() };
      expect(() => createContextLogger(invalidLog, { auditType: 'test' }))
        .to.throw("Invalid log object: missing required method 'info'");
    });

    it('should throw error if log is missing warn method', () => {
      const invalidLog = { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() };
      expect(() => createContextLogger(invalidLog, { auditType: 'test' }))
        .to.throw("Invalid log object: missing required method 'warn'");
    });

    it('should throw error if log is missing error method', () => {
      const invalidLog = { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() };
      expect(() => createContextLogger(invalidLog, { auditType: 'test' }))
        .to.throw("Invalid log object: missing required method 'error'");
    });

    it('should throw error if log is missing debug method', () => {
      const invalidLog = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() };
      expect(() => createContextLogger(invalidLog, { auditType: 'test' }))
        .to.throw("Invalid log object: missing required method 'debug'");
    });

    it('should throw error if context is null', () => {
      expect(() => createContextLogger(baseLog, null))
        .to.throw('Invalid context: context must be a non-null object');
    });

    it('should throw error if context is not an object', () => {
      expect(() => createContextLogger(baseLog, 'not-an-object'))
        .to.throw('Invalid context: context must be a non-null object');
    });

    it('should throw error if context is an array', () => {
      expect(() => createContextLogger(baseLog, []))
        .to.throw('Invalid context: context must be a non-null object');
    });

    it('should throw error if context is empty object', () => {
      expect(() => createContextLogger(baseLog, {}))
        .to.throw('Invalid context: context must contain at least one non-null value');
    });

    it('should throw error if context has only null values', () => {
      expect(() => createContextLogger(baseLog, { auditType: null, siteId: null }))
        .to.throw('Invalid context: context must contain at least one non-null value');
    });

    it('should work with warn method', () => {
      const log = createContextLogger(baseLog, { auditType: 'test' });
      log.warn('Warning message');

      expect(baseLog.warn).to.have.been.calledOnce;
      expect(baseLog.warn).to.have.been.calledWith('[auditType=test] Warning message');
    });

    it('should work with error method', () => {
      const log = createContextLogger(baseLog, { auditType: 'test' });
      log.error('Error message');

      expect(baseLog.error).to.have.been.calledOnce;
      expect(baseLog.error).to.have.been.calledWith('[auditType=test] Error message');
    });

    it('should work with debug method', () => {
      const log = createContextLogger(baseLog, { auditType: 'test' });
      log.debug('Debug message');

      expect(baseLog.debug).to.have.been.calledOnce;
      expect(baseLog.debug).to.have.been.calledWith('[auditType=test] Debug message');
    });
  });

  describe('createAuditLogger', () => {
    it('should create audit logger without auditId', () => {
      const log = createAuditLogger(baseLog, 'test-audit', 'site-123');

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledWith('[auditType=test-audit] [siteId=site-123] Test message');
    });

    it('should create audit logger with auditId', () => {
      const log = createAuditLogger(baseLog, 'test-audit', 'site-123', 'audit-456');

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledWith('[auditType=test-audit] [siteId=site-123] [auditId=audit-456] Test message');
    });

    it('should throw error if log is invalid', () => {
      expect(() => createAuditLogger(null, 'test-audit', 'site-123'))
        .to.throw('Invalid log object');
    });

    it('should throw error if auditType is empty string', () => {
      expect(() => createAuditLogger(baseLog, '', 'site-123'))
        .to.throw('Invalid auditType: must be a non-empty string');
    });

    it('should throw error if auditType is not a string', () => {
      expect(() => createAuditLogger(baseLog, 123, 'site-123'))
        .to.throw('Invalid auditType: must be a non-empty string');
    });

    it('should throw error if siteId is empty string', () => {
      expect(() => createAuditLogger(baseLog, 'test-audit', ''))
        .to.throw('Invalid siteId: must be a non-empty string');
    });

    it('should throw error if siteId is not a string', () => {
      expect(() => createAuditLogger(baseLog, 'test-audit', 123))
        .to.throw('Invalid siteId: must be a non-empty string');
    });
  });

  describe('createSiteLogger', () => {
    it('should create site logger', () => {
      const log = createSiteLogger(baseLog, 'test-audit', 'site-123');

      log.info('Test message');

      expect(baseLog.info).to.have.been.calledWith('[auditType=test-audit] [siteId=site-123] Test message');
    });

    it('should throw error if log is invalid', () => {
      expect(() => createSiteLogger(null, 'test-audit', 'site-123'))
        .to.throw('Invalid log object');
    });

    it('should throw error if auditType is empty string', () => {
      expect(() => createSiteLogger(baseLog, '', 'site-123'))
        .to.throw('Invalid auditType: must be a non-empty string');
    });

    it('should throw error if siteId is empty string', () => {
      expect(() => createSiteLogger(baseLog, 'test-audit', ''))
        .to.throw('Invalid siteId: must be a non-empty string');
    });
  });
});
