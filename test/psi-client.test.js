/*
 * Copyright 2021 Adobe. All rights reserved.
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

import nock from 'nock';
import assert from 'assert';
import PSIClient from '../src/psi-client.js';

describe('PSIClient', () => {
  let client;
  const config = {
    apiKey: 'test-api-key',
    baseUrl: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
  };

  beforeEach(() => {
    client = PSIClient(config);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getPSIApiUrl', () => {
    it('should build a correct PSI API URL', () => {
      const apiUrl = client.getPSIApiUrl('example.com');
      const expectedUrl = `${config.baseUrl}?url=https%3A%2F%2Fexample.com&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
      assert.strictEqual(apiUrl, expectedUrl);
    });

    it('should use mobile strategy by default', () => {
      const apiUrl = client.getPSIApiUrl('example.com');
      const expectedUrl = `${config.baseUrl}?url=https%3A%2F%2Fexample.com&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
      assert.strictEqual(apiUrl, expectedUrl);
    });

    it('should use mobile strategy when specified', () => {
      const apiUrl = client.getPSIApiUrl('example.com', 'mobile');
      const expectedUrl = `${config.baseUrl}?url=https%3A%2F%2Fexample.com&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
      assert.strictEqual(apiUrl, expectedUrl);
    });

    it('should use desktop strategy when specified', () => {
      const apiUrl = client.getPSIApiUrl('example.com', 'desktop');
      const expectedUrl = `${config.baseUrl}?url=https%3A%2F%2Fexample.com&key=${config.apiKey}&strategy=desktop&category=performance&category=accessibility&category=best-practices&category=seo`;
      assert.strictEqual(apiUrl, expectedUrl);
    });

    it('should default to mobile strategy for invalid strategy', () => {
      const apiUrl = client.getPSIApiUrl('example.com', 'invalid-strategy');
      const expectedUrl = `${config.baseUrl}?url=https%3A%2F%2Fexample.com&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;
      assert.strictEqual(apiUrl, expectedUrl);
    });

    // Input edge cases for getPSIApiUrl
    it('should handle empty domain input gracefully', () => {
      const apiUrl = client.getPSIApiUrl('');
      assert.strictEqual(apiUrl, `${config.baseUrl}?url=https%3A%2F%2F&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`);
    });

    it('should encode special characters in domain', () => {
      const apiUrl = client.getPSIApiUrl('example.com/some path');
      assert.strictEqual(apiUrl, `${config.baseUrl}?url=https%3A%2F%2Fexample.com%2Fsome+path&key=${config.apiKey}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`);
    });
  });

  describe('runAudit', () => {
    afterEach(() => {
      nock.cleanAll();
    });

    it('should run  and desktop strategy audit', async () => {
      const mockResponse = { data: 'some mobile data' };
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2FsomeUrl&key=test-api-key&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo')
        .reply(200, mockResponse);
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2FsomeUrl&key=test-api-key&strategy=desktop&category=performance&category=accessibility&category=best-practices&category=seo')
        .reply(200, mockResponse);

      const audit = await client.runAudit('someUrl');

      // Ensure the response structure is correct
      assert.deepStrictEqual(audit.result.mobile, {
        audits: {
          'third-party-summary': undefined,
          'total-blocking-time': undefined,
        },
        categories: undefined,
        configSettings: undefined,
        environment: undefined,
        fetchTime: undefined,
        finalDisplayedUrl: undefined,
        finalUrl: undefined,
        lighthouseVersion: undefined,
        mainDocumentUrl: undefined,
        requestedUrl: undefined,
        runWarnings: undefined,
        timing: undefined,
        userAgent: undefined,
      });
      assert.deepStrictEqual(audit.result.desktop, {
        audits: {
          'third-party-summary': undefined,
          'total-blocking-time': undefined,
        },
        categories: undefined,
        configSettings: undefined,
        environment: undefined,
        fetchTime: undefined,
        finalDisplayedUrl: undefined,
        finalUrl: undefined,
        lighthouseVersion: undefined,
        mainDocumentUrl: undefined,
        requestedUrl: undefined,
        runWarnings: undefined,
        timing: undefined,
        userAgent: undefined,
      });
    });

    it('should throw an error if the audit fails', async () => {
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2FsomeUrl&key=test-api-key&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo')
        .replyWithError('Failed to fetch PSI');

      try {
        await client.runAudit('someUrl');
        assert.fail('Expected runAudit to throw an error');
      } catch (error) {
        assert.strictEqual(error.message, 'Failed to fetch PSI');
      }
    });
  });

  describe('performPSICheck', () => {
    const expectedResult = {
      audits: {
        'third-party-summary': undefined,
        'total-blocking-time': undefined,
      },
      categories: undefined,
      configSettings: undefined,
      environment: undefined,
      fetchTime: undefined,
      finalDisplayedUrl: undefined,
      finalUrl: undefined,
      lighthouseVersion: undefined,
      mainDocumentUrl: undefined,
      requestedUrl: undefined,
      runWarnings: undefined,
      timing: undefined,
      userAgent: undefined,
    };

    it('should perform a PSI check and process data', async () => {
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com&key=test-api-key&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo')
        .reply(200, { data: {} });
      const data = await client.performPSICheck('example.com');
      assert.deepEqual(data, expectedResult);
    });
    it('should handle empty domain input gracefully', async () => {
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2F&key=test-api-key&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo')
        .reply(200, { data: {} });
      const data = await client.performPSICheck('');
      assert.deepEqual(data, expectedResult);
    });

    it('should handle domain with special characters', async () => {
      nock('https://www.googleapis.com')
        .get('/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com/some%20path&key=test-api-key&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo')
        .reply(200, { data: {} });
      const data = await client.performPSICheck('example.com/some path');
      assert.deepEqual(data, expectedResult);
    });
  });

  describe('processAuditData', () => {
    it('should replace dots with underscores in keys', () => {
      const inputData = {
        'key.with.dot': 'value',
        'another.key.with.dot': {
          'nested.key': 'nestedValue',
        },
      };
      const processedData = client.processAuditData(inputData);
      assert.deepEqual(processedData, {
        key_with_dot: 'value',
        another_key_with_dot: {
          nested_key: 'nestedValue',
        },
      });
    });

    // Input edge cases for processAuditData
    it('should handle empty object input gracefully', () => {
      const processedData = client.processAuditData({});
      assert.deepEqual(processedData, {});
    });

    it('should handle null input gracefully', () => {
      const processedData = client.processAuditData(null);
      assert.strictEqual(processedData, null);
    });

    it('should leave keys without dots unchanged', () => {
      const inputData = {
        keyWithoutDot: 'value',
        anotherKey: {
          nestedKey: 'nestedValue',
        },
      };
      const processedData = client.processAuditData(inputData);
      assert.deepEqual(processedData, inputData);
    });
  });

  describe('formatURL', () => {
    it('should replace http:// prefix with https://', () => {
      const formattedUrl = client.formatURL('http://example.com');
      assert.strictEqual(formattedUrl, 'https://example.com');
    });
    it('should add https:// prefix to a URL without http/https prefix', () => {
      const formattedUrl = client.formatURL('example.com');
      assert.strictEqual(formattedUrl, 'https://example.com');
    });
  });
});
