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

import sinon from 'sinon';
import { expect } from 'chai';
import { auditLogWrapper } from '../../src/utils/audit-log-wrapper.js';

const message = {
  siteId: 'test-site-123',
  type: 'cwv',
  url: 'https://www.example.com',
};

const logLevels = [
  'info',
  'error',
  'debug',
  'warn',
  'trace',
  'verbose',
  'silly',
  'fatal',
];

const mockFn = sinon.spy();
let mockContext;

describe('auditLogWrapper tests', () => {
  beforeEach(() => {
    sinon.resetHistory();
    mockContext = {
      log: {
        info: sinon.spy(),
        error: sinon.spy(),
        debug: sinon.spy(),
        warn: sinon.spy(),
        trace: sinon.spy(),
        verbose: sinon.spy(),
        silly: sinon.spy(),
        fatal: sinon.spy(),
      },
    };
  });

  afterEach(() => {
    sinon.resetHistory();
  });

  it('should call the original function with the provided message and context', async () => {
    const wrappedFn = auditLogWrapper(mockFn);

    await wrappedFn(message, mockContext);

    // Verify the original function is called with the correct parameters
    expect(mockFn.calledWith(message, mockContext)).to.be.true;
  });

  it('should handle empty messages without errors', async () => {
    const wrappedFn = auditLogWrapper(mockFn);

    // Test with empty message
    await wrappedFn({}, mockContext);
    expect(mockFn.calledWith({}, mockContext)).to.be.true;
  });

  it('should handle null messages without errors', async () => {
    const wrappedFn = auditLogWrapper(mockFn);

    // Test with null message
    await wrappedFn(null, mockContext);
    expect(mockFn.calledWith(null, mockContext)).to.be.true;
  });

  logLevels.forEach((level) => {
    it(`should add siteId and auditType to ${level} log when both are present`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn(message, mockContext);

      // Log an object to test the wrapper
      mockContext.log[level]({ action: 'test' });

      // Verify that siteId and auditType are added (as JSON string)
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed.siteId).to.equal(message.siteId);
      expect(parsed.auditType).to.equal(message.type);
      expect(parsed.action).to.equal('test');
    });
  });

  logLevels.forEach((level) => {
    it(`should add only siteId to ${level} log when auditType is missing`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      const messageWithoutType = { siteId: 'test-site-456' };
      await wrappedFn(messageWithoutType, mockContext);

      // Log an object to test the wrapper
      mockContext.log[level]({ action: 'test' });

      // Verify that only siteId is added (as JSON string)
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed.siteId).to.equal('test-site-456');
      expect(parsed.auditType).to.be.undefined;
      expect(parsed.action).to.equal('test');
    });
  });

  logLevels.forEach((level) => {
    it(`should add only auditType to ${level} log when siteId is missing`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      const messageWithoutSiteId = { type: 'structured-data' };
      await wrappedFn(messageWithoutSiteId, mockContext);

      // Log an object to test the wrapper
      mockContext.log[level]({ action: 'test' });

      // Verify that only auditType is added (as JSON string)
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed.siteId).to.be.undefined;
      expect(parsed.auditType).to.equal('structured-data');
      expect(parsed.action).to.equal('test');
    });
  });

  logLevels.forEach((level) => {
    it(`should not add siteId or auditType to ${level} log when both are missing`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn({}, mockContext);

      // Log an object to test the wrapper
      mockContext.log[level]({ action: 'test' });

      // Verify that neither siteId nor auditType are added (as JSON string)
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed.siteId).to.be.undefined;
      expect(parsed.auditType).to.be.undefined;
      expect(parsed.action).to.equal('test');
    });
  });

  logLevels.forEach((level) => {
    it(`should not modify non-object arguments in ${level} log`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn(message, mockContext);

      // Log a string (non-object) to test the wrapper
      mockContext.log[level]('test message');

      // Verify that the string is stringified
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.equal('"test message"');
    });
  });

  logLevels.forEach((level) => {
    it(`should stringify Error objects in ${level} log`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn(message, mockContext);

      // Log an Error object
      const error = new Error('test error');
      mockContext.log[level](error);

      // Verify that the Error is stringified (results in empty object {})
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed).to.deep.equal({});
    });
  });

  logLevels.forEach((level) => {
    it(`should stringify Array arguments in ${level} log`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn(message, mockContext);

      // Log an array
      const arrayArg = ['item1', 'item2'];
      mockContext.log[level](arrayArg);

      // Verify that the array is stringified
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed).to.deep.equal(arrayArg);
    });
  });

  it('should set auditLogWrapped flag after wrapping', async () => {
    const wrappedFn = auditLogWrapper(mockFn);

    expect(mockContext.auditLogWrapped).to.be.undefined;

    await wrappedFn(message, mockContext);

    // Verify the flag is set
    expect(mockContext.auditLogWrapped).to.be.true;
  });

  it('should not wrap logs again if auditLogWrapped is already true', async () => {
    const originalLog = { ...mockContext.log };
    mockContext.auditLogWrapped = true;

    const wrappedFn = auditLogWrapper(mockFn);
    await wrappedFn(message, mockContext);

    // Verify that log methods were not wrapped again
    expect(mockContext.log).to.deep.equal(originalLog);
  });

  it('should handle context without log object', async () => {
    const contextWithoutLog = {};
    const wrappedFn = auditLogWrapper(mockFn);

    // Should not throw an error
    await wrappedFn(message, contextWithoutLog);

    expect(mockFn.calledWith(message, contextWithoutLog)).to.be.true;
  });

  it('should preserve original log object structure', async () => {
    const originalLog = mockContext.log;
    const wrappedFn = auditLogWrapper(mockFn);

    await wrappedFn(message, mockContext);

    // Verify that all log levels are still functions
    logLevels.forEach((level) => {
      expect(mockContext.log[level]).to.be.a('function');
    });

    // Verify that the original log object is still accessible
    expect(originalLog.info).to.be.a('function');
  });

  it('should create a new object instead of mutating the parameter', async () => {
    const originalLogSpy = mockContext.log.info;
    const wrappedFn = auditLogWrapper(mockFn);

    await wrappedFn(message, mockContext);

    const logObj = { action: 'test', count: 42 };
    const originalLogObj = { ...logObj };

    mockContext.log.info(logObj);

    // Verify that the original object was not mutated
    expect(logObj).to.deep.equal(originalLogObj);

    // Verify that the logged object has the additional fields (as JSON string)
    const logArgs = originalLogSpy.getCall(0).args[0];
    expect(logArgs).to.be.a('string');
    const parsed = JSON.parse(logArgs);
    expect(parsed.siteId).to.equal(message.siteId);
    expect(parsed.auditType).to.equal(message.type);
    expect(parsed.action).to.equal('test');
    expect(parsed.count).to.equal(42);
  });

  it('should work correctly when used after logWrapper', async () => {
    // Simulate logWrapper having already wrapped the log
    const originalLogSpy = mockContext.log.info;
    mockContext.contextualLog = mockContext.log;

    const wrappedFn = auditLogWrapper(mockFn);
    await wrappedFn(message, mockContext);

    // Log an object
    mockContext.log.info({ action: 'test', jobId: 'job-123' });

    // Verify that auditLogWrapper adds siteId and auditType (as JSON string)
    const logArgs = originalLogSpy.getCall(0).args[0];
    expect(logArgs).to.be.a('string');
    const parsed = JSON.parse(logArgs);
    expect(parsed.siteId).to.equal(message.siteId);
    expect(parsed.auditType).to.equal(message.type);
    expect(parsed.action).to.equal('test');
    expect(parsed.jobId).to.equal('job-123');
  });

  it('should handle log methods that are not functions', async () => {
    mockContext.log.info = 'not a function';
    mockContext.log.error = null;

    const wrappedFn = auditLogWrapper(mockFn);

    // Should not throw an error
    await wrappedFn(message, mockContext);

    expect(mockFn.calledWith(message, mockContext)).to.be.true;
  });

  logLevels.forEach((level) => {
    it(`should preserve existing fields in log object for ${level}`, async () => {
      const originalLogSpy = mockContext.log[level];
      const wrappedFn = auditLogWrapper(mockFn);

      await wrappedFn(message, mockContext);

      // Log an object with existing fields
      mockContext.log[level]({
        message: 'Processing audit',
        duration: 1500,
        status: 'success',
      });

      // Verify that all fields are preserved (as JSON string)
      const logArgs = originalLogSpy.getCall(0).args[0];
      expect(logArgs).to.be.a('string');
      const parsed = JSON.parse(logArgs);
      expect(parsed.siteId).to.equal(message.siteId);
      expect(parsed.auditType).to.equal(message.type);
      expect(parsed.message).to.equal('Processing audit');
      expect(parsed.duration).to.equal(1500);
      expect(parsed.status).to.equal('success');
    });
  });
});
