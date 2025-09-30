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
        CLOUDFLARE: 'cloudflare',
        CLOUDFRONT: 'cloudfront',
        FRONTDOOR: 'frontdoor',
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
        env: { AWS_ENV: 'prod' },
      };
    });

    it('uses configured bucket when available', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({
          getLlmoCdnBucketConfig: () => ({ bucketName: 'configured-bucket', orgId: 'test-org-id' }),
        }),
      };

      s3Client.send.resolves(); // HeadBucket succeeds

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.equal('configured-bucket');
    });

    it('uses standardized bucket when available', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      s3Client.send.resolves();

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.match(/^cdn-logs-adobe-(prod|stage)$/);
    });

    it('returns null when no bucket found', async () => {
      const site = {
        getBaseURL: () => 'https://unknown.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      s3Client.send.rejects(new Error('Bucket not found'));

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.be.null;
      expect(context.log.error).to.have.been.calledWith('No CDN bucket found for site: https://unknown.com');
    });

    it('handles standardized bucket lookup failure', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getOrganizationId: () => 'org-id',
        getConfig: () => ({
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      s3Client.send.rejects(new Error('Bucket not found'));

      const bucketName = await resolveCdnBucketName(site, context);

      expect(bucketName).to.be.null;
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Standardized bucket.*not found/));
    });
  });

  describe('buildCdnPaths', () => {
    const timeParts = {
      year: '2025', month: '01', day: '15', hour: '10',
    };

    it('builds standardized Adobe bucket paths with IMS org correctly', () => {
      const paths = buildCdnPaths('cdn-logs-adobe-prod', 'byocdn-fastly', timeParts, 'ims-org-123');

      expect(paths).to.deep.equal({
        rawLocation: 's3://cdn-logs-adobe-prod/ims-org-123/raw/byocdn-fastly/',
        aggregatedOutput: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated/2025/01/15/10/',
        aggregatedReferralOutput: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated-referral/2025/01/15/10/',
        tempLocation: 's3://cdn-logs-adobe-prod/temp/athena-results/',
      });
    });

    it('builds legacy bucket paths with service provider correctly', () => {
      const paths = buildCdnPaths('test-bucket', 'fastly', timeParts);

      expect(paths).to.deep.equal({
        rawLocation: 's3://test-bucket/raw/',
        aggregatedOutput: 's3://test-bucket/aggregated/2025/01/15/10/',
        aggregatedReferralOutput: 's3://test-bucket/aggregated-referral/2025/01/15/10/',
        tempLocation: 's3://test-bucket/temp/athena-results/',
      });
    });
  });

  describe('getBucketInfo', () => {
    let s3Client;

    beforeEach(() => {
      s3Client = { send: sandbox.stub() };
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
  });

  describe('discoverCdnProviders', () => {
    let s3Client;
    const timeParts = {
      year: '2025', month: '01', day: '15', hour: '10',
    };

    beforeEach(() => {
      s3Client = { send: sandbox.stub() };
    });

    it('returns empty array as default', async () => {
      s3Client.send.resolves({ Contents: [] });

      const providers = await discoverCdnProviders(s3Client, 'test-bucket', timeParts);

      expect(providers).to.deep.equal([]);
    });
  });
});
