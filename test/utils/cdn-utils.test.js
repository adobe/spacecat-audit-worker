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
import {
  CDN_TYPES,
  extractCustomerDomain,
  generateBucketName,
  resolveCdnBucketName,
  buildCdnPaths,
  getBucketInfo,
  discoverCdnProviders,
} from '../../src/utils/cdn-utils.js';

use(sinonChai);

describe('CDN Utils', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('CDN_TYPES', () => {
    it('exports CDN types correctly', () => {
      expect(CDN_TYPES).to.deep.equal({
        AKAMAI: 'akamai',
        FASTLY: 'fastly',
      });
    });
  });

  describe('extractCustomerDomain', () => {
    it('extracts and sanitizes domain from site', () => {
      const site = { getBaseURL: () => 'https://www.example.com' };
      expect(extractCustomerDomain(site)).to.equal('example_com');
    });

    it('handles non-www domains', () => {
      const site = { getBaseURL: () => 'https://adobe.com' };
      expect(extractCustomerDomain(site)).to.equal('adobe_com');
    });

    it('sanitizes special characters', () => {
      const site = { getBaseURL: () => 'https://test-site.example.com' };
      expect(extractCustomerDomain(site)).to.equal('test_site_example_com');
    });
  });

  describe('generateBucketName', () => {
    it('generates consistent bucket name from org ID', () => {
      const orgId = 'test-org-id';
      const bucketName = generateBucketName(orgId);

      expect(bucketName).to.match(/^cdn-logs-[a-f0-9]{16}$/);
      expect(generateBucketName(orgId)).to.equal(bucketName);
    });
  });

  describe('resolveCdnBucketName', () => {
    let s3Client;
    let dataAccess;
    let context;

    beforeEach(() => {
      s3Client = { send: sandbox.stub() };
      dataAccess = {
        Organization: { findById: sandbox.stub() },
      };
      context = {
        s3Client,
        dataAccess,
        log: { info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() },
      };
    });

    it('uses configured bucket when available', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({
          getCdnLogsConfig: () => ({ bucketName: 'configured-bucket' }),
        }),
      };

      s3Client.send.resolves(); // HeadBucket succeeds

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.equal('configured-bucket');
    });

    it('uses IMS org bucket when available', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({ getCdnLogsConfig: () => null }),
      };
      const organization = { getImsOrgId: () => 'ims-org-id' };

      dataAccess.Organization.findById.resolves(organization);
      s3Client.send.resolves();

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.match(/^cdn-logs-[a-f0-9]{16}$/);
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Using IMS org bucket/));
    });

    it('returns null when no bucket found', async () => {
      const site = {
        getBaseURL: () => 'https://unknown.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({ getCdnLogsConfig: () => null }),
      };

      dataAccess.Organization.findById.resolves(null);

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.be.null;
      expect(context.log.error).to.have.been.calledWith('No CDN bucket found for site: https://unknown.com');
    });

    it('handles IMS org bucket lookup failure', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({ getCdnLogsConfig: () => null }),
      };
      const organization = { getImsOrgId: () => 'ims-org-id' };

      dataAccess.Organization.findById.resolves(organization);
      s3Client.send.rejects(new Error('Bucket not found'));

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.be.null;
      expect(context.log.warn).to.have.been.calledWith(sinon.match(/IMS org bucket lookup failed/));
    });
  });

  describe('buildCdnPaths', () => {
    const timeParts = {
      year: '2025', month: '01', day: '15', hour: '10',
    };

    it('builds new structure paths correctly', () => {
      const paths = buildCdnPaths('test-bucket', 'fastly', timeParts, false);

      expect(paths).to.deep.equal({
        rawLocation: 's3://test-bucket/raw/fastly/',
        aggregatedOutput: 's3://test-bucket/aggregated/2025/01/15/10/',
        tempLocation: 's3://test-bucket/temp/athena-results/',
      });
    });

    it('builds legacy structure paths correctly', () => {
      const paths = buildCdnPaths('test-bucket', 'akamai', timeParts, true);

      expect(paths).to.deep.equal({
        rawLocation: 's3://test-bucket/raw/',
        aggregatedOutput: 's3://test-bucket/aggregated/2025/01/15/10/',
        tempLocation: 's3://test-bucket/temp/athena-results/',
      });
    });
  });

  describe('getBucketInfo', () => {
    let s3Client;

    beforeEach(() => {
      s3Client = { send: sandbox.stub() };
    });

    it('detects new structure with akamai and fastly', async () => {
      s3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: 'raw/akamai/' },
          { Prefix: 'raw/fastly/' },
        ],
      });

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.isLegacy).to.be.false;
      expect(result.providers).to.deep.equal(['akamai', 'fastly']);
    });

    it('detects legacy structure with year folders', async () => {
      s3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: 'raw/2025/' },
          { Prefix: 'raw/2024/' },
        ],
      });

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.isLegacy).to.be.true;
      expect(result.providers).to.deep.equal(['2025', '2024']);
    });

    it('detects legacy structure with cdn folders', async () => {
      s3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: 'raw/cdn/' },
        ],
      });

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.isLegacy).to.be.true;
      expect(result.providers).to.deep.equal(['cdn']);
    });

    it('handles empty response as legacy', async () => {
      s3Client.send.resolves({ CommonPrefixes: [] });

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.isLegacy).to.be.true;
      expect(result.providers).to.deep.equal([]);
    });

    it('handles S3 errors as legacy', async () => {
      s3Client.send.rejects(new Error('S3 error'));

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.isLegacy).to.be.true;
      expect(result.providers).to.deep.equal([]);
    });

    it('filters out empty prefixes', async () => {
      s3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: 'raw/akamai/' },
          { Prefix: 'raw//' },
          { Prefix: 'raw/fastly/' },
        ],
      });

      const result = await getBucketInfo(s3Client, 'test-bucket');

      expect(result.providers).to.deep.equal(['akamai', 'fastly']);
    });
  });

  describe('discoverCdnProviders', () => {
    let s3Client;
    const timeParts = {
      year: '2025', month: '01', day: '15', hour: '10',
    };

    beforeEach(() => {
      s3Client = { send: sandbox.stub() };
    });

    it('returns fastly as default', async () => {
      // Mock the S3 call for determineCdnProvider to return no files
      s3Client.send.resolves({ Contents: [] });

      const providers = await discoverCdnProviders(s3Client, 'test-bucket', timeParts);

      expect(providers).to.deep.equal(['fastly']);
    });
  });
});
