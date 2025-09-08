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
import chaiAsPromised from 'chai-as-promised';
import { MockContextBuilder } from '../../shared.js';
import { cdnLogAnalysisRunner } from '../../../src/cdn-analysis/handler.js';

use(sinonChai);
use(chaiAsPromised);

function createS3MockForCdnType(cdnType, options = {}) {
  const {
    orgId = 'test-ims-org-id',
    year = '2025',
    month = '01',
    day = '15',
    hour = '23',
    isLegacy = false,
  } = options;

  const cdnConfigs = {
    fastly: {
      logSample: '{"url": "/test", "timestamp": "2025-01-15T23:00:00Z", "status": 200}',
      keyPath: isLegacy
        ? `raw/${year}/${month}/${day}/${hour}/file1.log`
        : `${orgId}/raw/aem-cs-fastly/${year}/${month}/${day}/${hour}/file1.log`,
      prefix: isLegacy
        ? 'raw/'
        : `${orgId}/raw/aem-cs-fastly/`,
    },
    cloudflare: {
      logSample: '{"ClientRequestURI": "/test", "EdgeStartTimestamp": "2025-01-15T23:00:00Z", "EdgeResponseStatus": 200}',
      keyPath: isLegacy
        ? `raw/${year}/${month}/${day}/file1.log`
        : `${orgId}/raw/byocdn-cloudflare/${year}/${month}/${day}/file1.log`,
      prefix: isLegacy
        ? 'raw/'
        : `${orgId}/raw/byocdn-cloudflare/`,
    },
  };

  const config = cdnConfigs[cdnType];
  if (!config) {
    throw new Error(`Unsupported CDN type: ${cdnType}`);
  }

  return (command) => {
    if (command.constructor.name === 'HeadBucketCommand') {
      return Promise.resolve({});
    }
    if (command.constructor.name === 'ListObjectsV2Command') {
      return Promise.resolve({
        Contents: [{ Key: config.keyPath }],
        CommonPrefixes: [{ Prefix: config.prefix }],
      });
    }
    if (command.constructor.name === 'GetObjectCommand') {
      const mockStream = {
        async* [Symbol.asyncIterator]() {
          yield Buffer.from(`${config.logSample}\n`);
        },
      };
      return Promise.resolve({ Body: mockStream });
    }
    return Promise.resolve({});
  };
}

describe('CDN Analysis Handler', () => {
  let sandbox;
  let context;
  let site;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().returns({
        getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev' }),
      }),
      getOrganizationId: sandbox.stub().returns('test-org-id'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: {
          send: sandbox.stub().callsFake(createS3MockForCdnType('fastly', { hour: '10' })),
        },
        athenaClient: {
          execute: sandbox.stub().resolves(),
        },
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org-id',
            }),
          },
        },
        env: {
          AWS_ENV: 'dev',
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Handler test for cdn analysis', () => {
    it('successfully processes CDN analysis with valid configuration', async () => {
      const result = await cdnLogAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult).to.include.keys('database', 'providers', 'completedAt');
      expect(result.auditResult.database).to.equal('cdn_logs_example_com');
      expect(result.auditResult.providers).to.be.an('array');
    });

    it('returns error when no CDN bucket found', async () => {
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => null,
      });

      context.env = {};

      context.s3Client.send.callsFake(() => {
        const error = new Error('NoSuchBucket');
        error.name = 'NoSuchBucket';
        return Promise.reject(error);
      });

      const result = await cdnLogAnalysisRunner('https://example.com', context, site);

      expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('handles CloudFlare processing based on hour', async () => {
      const auditContext23 = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 23,
      };
      const auditContext22 = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 22,
      };

      context.s3Client.send.callsFake(createS3MockForCdnType('cloudflare'));

      // Test CloudFlare at hour 23 (should process if bucket exists)
      const result23 = await cdnLogAnalysisRunner('https://example.com', context, site, auditContext23);
      expect(result23.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
      expect(result23.auditResult.providers[0]).to.have.property('cdnType', 'cloudflare');

      // Test CloudFlare at hour 22 (should skip CloudFlare if bucket exists)
      const result22 = await cdnLogAnalysisRunner('https://example.com', context, site, auditContext22);
      expect(result22.auditResult.providers).to.be.an('array').with.length(0);
    });

    it('validates and processes auditContext correctly', async () => {
      const validAuditContext = {
        year: 2025,
        month: 1,
        day: 2,
        hour: 3,
      };
      const invalidAuditContext = {
        year: '2025',
        month: 1,
        day: 2,
        hour: 3,
      };

      // Test valid context
      const resultValid = await cdnLogAnalysisRunner('https://example.com', context, site, validAuditContext);
      expect(resultValid.fullAuditRef).to.equal('s3://cdn-logs-adobe-dev/test-ims-org-id/aggregated/2025/01/02/03/');

      // Test invalid context (should fallback to current time)
      const resultInvalid = await cdnLogAnalysisRunner('https://example.com', context, site, invalidAuditContext);
      expect(resultInvalid.fullAuditRef).to.not.equal('s3://cdn-logs-adobe-dev/test-ims-org-id/aggregated/2025/01/02/03/');
    });

    it('handles both orgId and imsOrgId being empty', async () => {
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-test', orgId: '' }),
      });
      site.getOrganizationId.returns(null);

      context.s3Client.send.callsFake(createS3MockForCdnType('fastly', { isLegacy: true }));

      const result = await cdnLogAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult.providers[0]).to.have.property('cdnType', 'fastly');
    });

    it('handles empty getLlmoCdnBucketConfig config', async () => {
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => null,
      });

      const result = await cdnLogAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
    });

    it('fallback handles midnight rollover in UTC (prev day/month/year)', async () => {
      const originalDateNow = Date.now;
      // Now = 2025-01-01T00:05Z -> previous hour = 2024-12-31T23
      Date.now = sandbox.stub().returns(new Date('2025-01-01T00:05:00Z').getTime());

      const result = await cdnLogAnalysisRunner('https://example.com', context, site);

      expect(result.fullAuditRef).to.include('2024/12/31/23');

      Date.now = originalDateNow;
    });

    it('pads provided single-digit month/day/hour in auditContext in output paths', async () => {
      const auditContext = {
        year: 2025, month: 9, day: 7, hour: 4,
      };

      const result = await cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.fullAuditRef).to.include('2025/09/07/04');

      expect(result.auditResult.providers).to.be.an('array');
      if (result.auditResult.providers.length > 0) {
        expect(result.auditResult.providers[0].output).to.include('2025/09/07/04');
        expect(result.auditResult.providers[0].outputReferral).to.include('2025/09/07/04');
      }
    });
  });
});
