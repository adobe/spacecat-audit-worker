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
  SERVICE_PROVIDER_TYPES,
  extractCustomerDomain,
  resolveCdnBucketName,
  buildCdnPaths,
  getBucketInfo,
  discoverCdnProviders,
  isStandardAdobeCdnBucket,
  shouldRecreateTable,
  buildSiteFilters,
  mapServiceToCdnProvider,
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
        OTHER: 'other',
      });
    });
  });

  describe('mapServiceToCdnProvider', () => {
    it('maps byocdn-other to OTHER cdn type', () => {
      expect(
        mapServiceToCdnProvider(SERVICE_PROVIDER_TYPES.BYOCDN_OTHER),
      ).to.equal(CDN_TYPES.OTHER);
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
        aggregatedLocation: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated/',
        aggregatedReferralLocation: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated-referral/',
        aggregatedOutput: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated/2025/01/15/10/',
        aggregatedReferralOutput: 's3://cdn-logs-adobe-prod/ims-org-123/aggregated-referral/2025/01/15/10/',
        tempLocation: 's3://cdn-logs-adobe-prod/temp/athena-results/',
      });
    });

    it('builds legacy bucket paths with service provider correctly', () => {
      const paths = buildCdnPaths('test-bucket', 'fastly', timeParts);

      expect(paths).to.deep.equal({
        rawLocation: 's3://test-bucket/raw/',
        aggregatedLocation: 's3://test-bucket/aggregated/',
        aggregatedReferralLocation: 's3://test-bucket/aggregated-referral/',
        aggregatedOutput: 's3://test-bucket/aggregated/2025/01/15/10/',
        aggregatedReferralOutput: 's3://test-bucket/aggregated-referral/2025/01/15/10/',
        tempLocation: 's3://test-bucket/temp/athena-results/',
      });
    });
  });

  describe('getBucketInfo', () => {
    let s3Client;
    const bucketName = 'cdn-logs-adobe-prod';
    const pathId = 'ims-org-123';

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

    it('returns modern bucket info when byocdn-other prefix exists', async () => {
      s3Client.send.resolves({
        CommonPrefixes: [{ Prefix: `${pathId}/raw/byocdn-other/` }],
      });

      const result = await getBucketInfo(s3Client, bucketName, pathId);

      expect(result.isLegacy).to.be.false;
      expect(result.providers).to.deep.equal(['byocdn-other']);
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

  describe('isStandardAdobeCdnBucket', () => {
    it('validates bucket names correctly', () => {
      // Should accept valid Adobe environment buckets
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-prod')).to.be.true;
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-dev')).to.be.true;
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-stage')).to.be.true;

      // Should accept valid mixed alphanumeric buckets
      expect(isStandardAdobeCdnBucket('cdn-logs-4ad94d1a5763f6457f000101')).to.be.true;
      expect(isStandardAdobeCdnBucket('cdn-logs-4ad94dfd5763f6457f000101')).to.be.true;

      // Should reject old buckets
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-com')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-test')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-adobe-prod-extra')).to.be.false;

      // Should reject buckets with only letters
      expect(isStandardAdobeCdnBucket('cdn-logs-onlyletters')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-bulk-com')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-amersports')).to.be.false;

      // Should reject buckets with only numbers
      expect(isStandardAdobeCdnBucket('cdn-logs-123456')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-123-456')).to.be.false;

      // Should reject invalid patterns
      expect(isStandardAdobeCdnBucket('logs-test123')).to.be.false;
      expect(isStandardAdobeCdnBucket('')).to.be.false;
      expect(isStandardAdobeCdnBucket('cdn-logs-test@123')).to.be.false;
    });
  });

  describe('shouldRecreateTable', () => {
    let athenaClient;
    let log;
    const database = 'test-database';
    const rawTable = 'test-raw-table';
    const expectedLocation = 's3://test-bucket/raw/';
    const sqlTemplate = "TBLPROPERTIES ('schema_version' = '1')";

    beforeEach(() => {
      athenaClient = { query: sandbox.stub(), execute: sandbox.stub() };
      log = { info: sandbox.stub() };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns true if table does not exist', async () => {
      athenaClient.query.resolves([]);

      const result = await shouldRecreateTable(
        athenaClient,
        database,
        rawTable,
        expectedLocation,
        sqlTemplate,
        log,
      );

      expect(result).to.be.true;
    });

    it('returns true if table exists and location does not match', async () => {
      athenaClient.query.resolves([{ createtab_stmt: `CREATE TABLE ${database}.${rawTable} LOCATION '${expectedLocation}/other' TBLPROPERTIES ('schema_version' = '1')` }]);

      const result = await shouldRecreateTable(
        athenaClient,
        database,
        rawTable,
        expectedLocation,
        sqlTemplate,
        log,
      );

      expect(result).to.be.true;
    });

    it('returns false if table exists and location and schema version match', async () => {
      athenaClient.query.resolves([{ createtab_stmt: `CREATE TABLE ${database}.${rawTable} LOCATION '${expectedLocation}' TBLPROPERTIES ('schema_version' = '1')` }]);

      const result = await shouldRecreateTable(
        athenaClient,
        database,
        rawTable,
        expectedLocation,
        sqlTemplate,
        log,
      );

      expect(result).to.be.false;
    });

    it('returns true if schema version mismatch', async () => {
      athenaClient.query.resolves([{ createtab_stmt: `CREATE TABLE ${database}.${rawTable} LOCATION '${expectedLocation}' TBLPROPERTIES ('schema_version' = '0')` }]);

      const result = await shouldRecreateTable(
        athenaClient,
        database,
        rawTable,
        expectedLocation,
        sqlTemplate,
        log,
      );

      expect(result).to.be.true;
      expect(athenaClient.execute.calledOnce).to.be.true;
    });

    it('returns true if table has no schema version (legacy table)', async () => {
      athenaClient.query.resolves([{ createtab_stmt: `CREATE TABLE ${database}.${rawTable} LOCATION '${expectedLocation}'` }]);

      const result = await shouldRecreateTable(
        athenaClient,
        database,
        rawTable,
        expectedLocation,
        sqlTemplate,
        log,
      );

      expect(result).to.be.true;
      expect(athenaClient.execute.calledOnce).to.be.true;
    });
  });

  describe('buildSiteFilters', () => {
    it('builds include filters correctly', () => {
      const result = buildSiteFilters([
        { key: 'url', value: ['test'], type: 'include' },
      ]);
      expect(result).to.include("REGEXP_LIKE(url, '(?i)(test)')");
    });

    it('builds exclude filters correctly', () => {
      const result = buildSiteFilters([
        { key: 'url', value: ['admin'], type: 'exclude' },
      ]);
      expect(result).to.include("NOT REGEXP_LIKE(url, '(?i)(admin)')");
    });

    it('combines multiple filters with AND', () => {
      const result = buildSiteFilters([
        { key: 'url', value: ['test'], type: 'include' },
        { key: 'url', value: ['admin'], type: 'exclude' },
      ]);
      expect(result).to.include('AND');
    });

    it('falls back to baseURL when filters are empty', () => {
      const mockSite = {
        getBaseURL: () => 'https://adobe.com',
      };

      const result = buildSiteFilters([], mockSite);

      expect(result).to.equal("(REGEXP_LIKE(host, '(?i)^(www.)?adobe.com$') OR REGEXP_LIKE(x_forwarded_host, '(?i)^(www.)?adobe.com$'))");
    });

    it('normalizes www prefix to optional pattern', () => {
      const mockSite = {
        getBaseURL: () => 'https://www.adobe.com',
      };

      const result = buildSiteFilters([], mockSite);

      expect(result).to.equal("(REGEXP_LIKE(host, '(?i)^(www.)?adobe.com$') OR REGEXP_LIKE(x_forwarded_host, '(?i)^(www.)?adobe.com$'))");
    });

    it('keeps subdomain and adds optional www prefix', () => {
      const mockSite = {
        getBaseURL: () => 'https://business.adobe.com',
      };

      const result = buildSiteFilters([], mockSite);

      expect(result).to.equal("(REGEXP_LIKE(host, '(?i)^(www.)?business.adobe.com$') OR REGEXP_LIKE(x_forwarded_host, '(?i)^(www.)?business.adobe.com$'))");
    });
  });
});
