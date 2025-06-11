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
  getRemainingUrls, normalizeUrl, reconstructUrlFromS3Key,
} from '../../../src/accessibility/utils/scrape-utils.js';

use(sinonChai);

describe('Scrape Utils', () => {
  describe('normalizeUrl', () => {
    it('adds a trailing slash to a URL without one', () => {
      const url = 'https://www.example.com/path';
      const expected = 'https://www.example.com/path/';
      expect(normalizeUrl(url)).to.equal(expected);
    });

    it('does not add a trailing slash to a URL that already has one', () => {
      const url = 'https://www.example.com/path/';
      expect(normalizeUrl(url)).to.equal(url);
    });

    it('returns "/" for a null URL', () => {
      expect(normalizeUrl(null)).to.equal('/');
    });

    it('returns "/" for an undefined URL', () => {
      expect(normalizeUrl(undefined)).to.equal('/');
    });

    it('returns "/" for an empty string URL', () => {
      expect(normalizeUrl('')).to.equal('/');
    });

    it('handles root URL correctly', () => {
      expect(normalizeUrl('/')).to.equal('/');
    });

    it('handles a domain without path', () => {
      const url = 'https://www.example.com';
      const expected = 'https://www.example.com/';
      expect(normalizeUrl(url)).to.equal(expected);
    });
  });

  describe('reconstructUrlFromS3Key', () => {
    it('reconstructs a URL from a standard S3 key with www', () => {
      const key = 'audits/2024/www_example_com_path_page.json';
      const expected = 'https://www.example.com/path/page/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('reconstructs a URL from a standard S3 key without www', () => {
      const key = 'audits/2024/example_com_path_page.json';
      const expected = 'https://example.com/path/page/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('reconstructs a URL with only a domain', () => {
      const key = 'www_example_com.json';
      const expected = 'https://www.example.com/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('reconstructs a URL with only a domain and no www', () => {
      const key = 'example_com.json';
      const expected = 'https://example.com/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('returns an empty string for an empty key', () => {
      expect(reconstructUrlFromS3Key('')).to.equal('');
    });

    it('returns an empty string for a key ending in a slash', () => {
      const key = 'some/path/';
      expect(reconstructUrlFromS3Key(key)).to.equal('');
    });

    it('handles a key that is just a filename', () => {
      const key = 'www_example_com.json';
      const expected = 'https://www.example.com/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('handles a key with a subdomain incorrectly due to current logic', () => {
      const key = 'sub_example_com.json';
      const expected = 'https://sub.example/com/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });

    it('handles a key with a multi-part TLD incorrectly', () => {
      const key = 'example_co_uk.json';
      const expected = 'https://example.co/uk/';
      expect(reconstructUrlFromS3Key(key)).to.equal(expected);
    });
  });

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

  describe('getExistingUrlsFromFailedAudits', () => {
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

    it('fetches and reconstructs URLs when failed audits exist', async () => {
      const objectKeys = [
        'audits/www_site1_com_page1.json',
        'audits/www_site1_com_page2.json',
        'audits/malformed_key.json', // Will be filtered
      ];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });

      const { getExistingUrlsFromFailedAudits } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const urls = await getExistingUrlsFromFailedAudits(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(urls).to.deep.equal(['https://www.site1.com/page1/', 'https://www.site1.com/page2/', 'https://malformed.key/']);
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
      const { getExistingUrlsFromFailedAudits } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const urls = await getExistingUrlsFromFailedAudits(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(urls).to.deep.equal([]);
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] No existing URLs from failed audits found.');
    });

    it('returns an empty array and logs error when getObjectKeysFromSubfolders fails', async () => {
      const error = new Error('S3 Error');
      getObjectKeysFromSubfoldersStub.rejects(error);
      const { getExistingUrlsFromFailedAudits } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const urls = await getExistingUrlsFromFailedAudits(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(urls).to.deep.equal([]);
      expect(mockLog.error).to.have.been.calledWith(`[A11yAudit] Error getting existing URLs from failed audits: ${error.message}`);
    });

    it('filters out empty URLs from malformed keys', async () => {
      // Key ending in a slash will produce an empty URL
      const objectKeys = ['audits/www_site1_com_page1.json', 'audits/some_path/'];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });
      const { getExistingUrlsFromFailedAudits } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const urls = await getExistingUrlsFromFailedAudits(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(urls).to.deep.equal(['https://www.site1.com/page1/']);
    });
  });
});
