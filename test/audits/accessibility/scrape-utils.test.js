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
import esmock from 'esmock';
import sinonChai from 'sinon-chai';
import {
  getRemainingUrls,
  extractUrlsFromSettledResults,
} from '../../../src/accessibility/utils/scrape-utils.js';

use(sinonChai);

describe('Scrape Utils', () => {
  describe('getRemainingUrls', () => {
    it('returns all URLs when there are no existing URLs', () => {
      const urlsToScrape = [{ url: 'https://a.com' }, { url: 'https://b.com' }];
      const existingUrls = [];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(urlsToScrape);
    });

    it('returns an empty array when all URLs already exist', () => {
      const urlsToScrape = [{ url: 'https://a.com' }, { url: 'https://b.com/' }];
      const existingUrls = ['https://a.com/', 'https://b.com'];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal([]);
    });

    it('filters out URLs that exist, considering normalization', () => {
      const urlsToScrape = [
        { url: 'https://a.com' }, // exists
        { url: 'https://b.com/' }, // exists
        { url: 'https://c.com' }, // does not exist
      ];
      const existingUrls = ['https://a.com/', 'https://b.com'];
      const expected = [{ url: 'https://c.com' }];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(expected);
    });

    it('returns an empty array if urlsToScrape is empty', () => {
      const urlsToScrape = [];
      const existingUrls = ['https://a.com/'];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal([]);
    });

    it('handles a mix of URLs with and without trailing slashes', () => {
      const urlsToScrape = [
        { url: 'https://a.com' },
        { url: 'https://b.com/' },
        { url: 'https://c.com' },
      ];
      const existingUrls = ['https://a.com/'];
      const expected = [{ url: 'https://b.com/' }, { url: 'https://c.com' }];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(expected);
    });
  });

  describe('extractUrlsFromSettledResults', () => {
    it('extracts URLs from fulfilled promises', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'fulfilled', value: { data: { url: 'https://b.com/' } } },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/', 'https://b.com/']);
    });

    it('returns an empty array if all promises are rejected', () => {
      const settledResults = [
        { status: 'rejected', reason: 'Error 1' },
        { status: 'rejected', reason: 'Error 2' },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal([]);
    });

    it('filters out rejected promises and extracts from fulfilled ones', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'rejected', reason: 'Error' },
        { status: 'fulfilled', value: { data: { url: 'https://c.com/' } } },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/', 'https://c.com/']);
    });

    it('handles fulfilled promises without a url property gracefully', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'fulfilled', value: { data: {} } },
        { status: 'fulfilled', value: {} },
        { status: 'fulfilled', value: null },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/']);
    });

    it('returns an empty array when given an empty array', () => {
      const settledResults = [];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal([]);
    });
  });

  describe('getExistingUrlsFromFailedAudits', () => {
    let mockS3Client;
    let mockLog;
    let sandbox;
    let getObjectFromKeyStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockS3Client = { send: sandbox.stub() };
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      getObjectFromKeyStub = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
    });

    async function getModuleWithMocks() {
      return esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });
    }

    it('fetches objects and extracts their URLs', async () => {
      const existingObjectKeys = ['key1', 'key2'];
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key1', mockLog)
        .resolves({ url: 'https://a.com/' });
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key2', mockLog)
        .resolves({ url: 'https://b.com/' });

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal(['https://a.com/', 'https://b.com/']);
      expect(getObjectFromKeyStub).to.have.been.calledTwice;
    });

    it('handles a mix of successful and failed object fetches', async () => {
      const existingObjectKeys = ['key1', 'key2', 'key3'];
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key1', mockLog)
        .resolves({ url: 'https://a.com/' });
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key2', mockLog)
        .rejects(new Error('S3 fetch error'));
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key3', mockLog)
        .resolves({ url: 'https://c.com/' });

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal(['https://a.com/', 'https://c.com/']);
      expect(getObjectFromKeyStub).to.have.been.calledThrice;
    });

    it('returns an empty array if all object fetches fail', async () => {
      const existingObjectKeys = ['key1', 'key2'];
      getObjectFromKeyStub.rejects(new Error('S3 fetch error'));

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal([]);
    });

    it('returns an empty array for no object keys', async () => {
      const existingObjectKeys = [];
      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal([]);
      expect(getObjectFromKeyStub).to.not.have.been.called;
    });
  });

  describe('getExistingObjectKeysFromFailedAudits', () => {
    let mockS3Client;
    let mockLog;
    let sandbox;
    let clock;
    let getObjectKeysFromSubfoldersStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockS3Client = { send: sandbox.stub() };
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      // Set a fixed date for deterministic tests
      clock = sinon.useFakeTimers(new Date('2024-07-24T10:00:00.000Z'));
      getObjectKeysFromSubfoldersStub = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
      clock.restore();
    });

    async function getModule(stubs) {
      return esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/accessibility/utils/data-processing.js': stubs,
      });
    }

    it('fetches and returns object keys when failed audits exist', async () => {
      const objectKeys = [
        'audits/www_site1_com_page1.json',
        'audits/www_site1_com_page2.json',
        'audits/malformed_key.json',
      ];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });

      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal(objectKeys);
      expect(getObjectKeysFromSubfoldersStub).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site1',
        '2024-07-24',
        mockLog,
      );
      expect(mockLog.info).to.have.been.calledWith(`[A11yAudit] Found ${objectKeys.length} existing URLs from failed audits.`);
    });

    it('returns an empty array when no failed audits are found', async () => {
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys: [] });
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal([]);
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] No existing URLs from failed audits found.');
    });

    it('returns an empty array and logs error when getObjectKeysFromSubfolders fails', async () => {
      const error = new Error('S3 Error');
      getObjectKeysFromSubfoldersStub.rejects(error);
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal([]);
      expect(mockLog.error).to.have.been.calledWith(`[A11yAudit] Error getting existing URLs from failed audits: ${error.message}`);
    });

    it('returns all keys even if some are malformed', async () => {
      const objectKeys = ['audits/www_site1_com_page1.json', 'audits/some_path/'];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal(objectKeys);
    });
  });
});
