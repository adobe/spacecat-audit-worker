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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';
import { cdnLogsAnalysisRunner, findRecentUploads } from '../../../src/cdn-analysis/handler.js';
import { computeWeekOffset } from '../../../src/utils/date-utils.js';

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
    other: {
      logSample: '{"url": "/test", "timestamp": "2025-01-15T23:00:00Z", "status": 200}',
      keyPath: `${orgId}/raw/byocdn-other/${year}/${month}/${day}/file1.log`,
      prefix: `${orgId}/raw/byocdn-other/`,
    },
    imperva: {
      logSample: null,
      keyPath: `${orgId}/raw/byocdn-imperva/somefile.log`,
      prefix: `${orgId}/raw/byocdn-imperva/`,
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
      const { Prefix = '' } = command.input || {};
      if (Prefix.includes('aggregated')) {
        return Promise.resolve({ Contents: [] });
      }
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

function createS3MockForServiceProviders(serviceProviders, options = {}) {
  const {
    orgId = 'test-ims-org-id',
    year = '2025',
    month = '06',
    day = '15',
    hour = '10',
  } = options;

  const rawPathSuffixByProvider = {
    'aem-cs-fastly': `${year}/${month}/${day}/${hour}/`,
    'byocdn-fastly': `${year}/${month}/${day}/${hour}/`,
    'byocdn-akamai': `${year}/${month}/${day}/${hour}/`,
    'byocdn-cloudflare': `${year}${month}${day}/`,
    'byocdn-other': `${year}/${month}/${day}/`,
  };

  return (command) => {
    if (command.constructor.name === 'HeadBucketCommand') {
      return Promise.resolve({});
    }
    if (command.constructor.name === 'ListObjectsV2Command') {
      const { Prefix = '' } = command.input || {};
      if (Prefix.includes('aggregated')) {
        return Promise.resolve({ Contents: [] });
      }
      if (Prefix === `${orgId}/raw/`) {
        return Promise.resolve({
          Contents: [],
          CommonPrefixes: serviceProviders.map((provider) => ({ Prefix: `${orgId}/raw/${provider}/` })),
        });
      }
      if (Prefix === `${orgId}_raw_`) {
        return Promise.resolve({ Contents: [], CommonPrefixes: [] });
      }

      const matchedProvider = serviceProviders.find((provider) => Prefix.includes(`/raw/${provider}/`));
      if (matchedProvider && Prefix.endsWith(rawPathSuffixByProvider[matchedProvider])) {
        return Promise.resolve({ Contents: [{ Key: `${Prefix}file1.log` }] });
      }
      return Promise.resolve({ Contents: [], CommonPrefixes: [] });
    }
    return Promise.resolve({});
  };
}

describe('CDN Analysis Handler', () => {
  let sandbox;
  let context;
  let site;
  let mockedHandlers;

  async function loadMockedHandler(configuredCdnProvider) {
    const mockedHandler = await esmock('../../../src/cdn-analysis/handler.js', {
      '../../../src/utils/llmo-config-utils.js': {
        getConfigCdnProvider: sandbox.stub().resolves(configuredCdnProvider),
      },
    });
    mockedHandlers.push(mockedHandler);
    return mockedHandler;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockedHandlers = [];

    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().returns({
        getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev' }),
      }),
      getOrganizationId: sandbox.stub().returns('test-org-id'),
      getId: sandbox.stub().returns('test-site-id'),
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
          query: sandbox.stub().rejects(new Error('Table does not exist')),
        },
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org-id',
            }),
          },
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getQueues: () => ({ audits: 'test-audit-queue' }),
            }),
          },
        },
        env: {
          AWS_ENV: 'dev',
        },
      })
      .build();
  });

  afterEach(async () => {
    await Promise.all(mockedHandlers.map((handler) => esmock.purge(handler)));
    sandbox.restore();
  });

  describe('Handler test for cdn analysis', () => {
    it('successfully processes CDN analysis with valid configuration', async function () {
      const result = await cdnLogsAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult).to.include.keys('database', 'providers', 'completedAt');
      expect(result.auditResult.database).to.equal('cdn_logs_example_com');
      expect(result.auditResult.providers).to.be.an('array');

      const deleteWasCalled = context.s3Client.send.getCalls()
        .some((call) => call.args[0].constructor.name === 'DeleteObjectsCommand');
      expect(deleteWasCalled).to.be.false;
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

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site);

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
      const result23 = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext23);
      expect(result23.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
      expect(result23.auditResult.providers[0]).to.have.property('cdnType', 'cloudflare');

      // Test CloudFlare at hour 22 (should skip CloudFlare if bucket exists)
      const result22 = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext22);
      expect(result22.auditResult.providers).to.be.an('array').with.length(0);
    });

    it('handles Imperva processing: daily-only and flat rawDataPath', async () => {
      const auditContext23 = {
        year: 2025, month: 6, day: 15, hour: 23,
      };
      const auditContext22 = {
        year: 2025, month: 6, day: 15, hour: 22,
      };

      context.s3Client.send.callsFake(createS3MockForCdnType('imperva'));

      // At hour 23: should process imperva and use flat rawLocation as rawDataPath
      const result23 = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext23);
      expect(result23.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
      const impervaResult = result23.auditResult.providers[0];
      expect(impervaResult).to.have.property('cdnType', 'imperva');
      expect(impervaResult).to.have.property('serviceProvider', 'byocdn-imperva');
      // rawDataPath must equal rawLocation exactly (no year/month/day/hour appended)
      expect(impervaResult.rawDataPath).to.equal(impervaResult.rawDataPath.replace(/\d{4}\/\d{2}\/\d{2}/, ''));

      // At hour 22: should skip (daily-only provider)
      const result22 = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext22);
      expect(result22.auditResult.providers).to.be.an('array').with.length(0);
    });

    it('filters discovered service providers to the configured cdnProvider', async () => {
      const mockedHandler = await loadMockedHandler('byocdn-akamai');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake(
        createS3MockForServiceProviders(['aem-cs-fastly', 'byocdn-akamai']),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(1);
      expect(result.auditResult.providers[0]).to.include({
        serviceProvider: 'byocdn-akamai',
        cdnType: 'akamai',
      });
      expect(context.log.info).to.have.been.calledWith(
        'Filtered discovered service providers to configured cdnProvider=byocdn-akamai for siteId=test-site-id, host=example.com',
      );
    });

    it('filters legacy discovered CDN providers using the configured service-provider mapping', async () => {
      const mockedHandler = await loadMockedHandler('byocdn-fastly');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake(
        createS3MockForCdnType('fastly', {
          isLegacy: true,
          year: '2025',
          month: '06',
          day: '15',
          hour: '10',
        }),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(1);
      expect(result.auditResult.providers[0]).to.include({
        serviceProvider: 'fastly',
        cdnType: 'fastly',
      });
      expect(context.log.info).to.have.been.calledWith(
        'Filtered discovered service providers to configured cdnProvider=byocdn-fastly for siteId=test-site-id, host=example.com',
      );
    });

    it('warns and processes no providers when configured cdnProvider is not discovered', async () => {
      const mockedHandler = await loadMockedHandler('byocdn-cloudflare');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake(
        createS3MockForServiceProviders(['aem-cs-fastly', 'byocdn-akamai']),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.log.warn).to.have.been.calledWith(
        'Configured cdnProvider=byocdn-cloudflare was not found among discovered service providers: aem-cs-fastly, byocdn-akamai for siteId=test-site-id, host=example.com',
      );
    });

    it('warns with none when configured cdnProvider is set but discovery finds no providers', async () => {
      const mockedHandler = await loadMockedHandler('byocdn-cloudflare');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('aggregated')) {
            return Promise.resolve({ Contents: [] });
          }
          if (Prefix === 'test-ims-org-id/raw/' || Prefix === 'test-ims-org-id_raw_') {
            return Promise.resolve({ Contents: [], CommonPrefixes: [] });
          }
          return Promise.resolve({ Contents: [], CommonPrefixes: [] });
        }
        return Promise.resolve({});
      });

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.log.warn).to.have.been.calledWith(
        'Configured cdnProvider=byocdn-cloudflare was not found among discovered service providers: none for siteId=test-site-id, host=example.com',
      );
    });

    it('warns on legacy buckets when configured provider mapping does not match discovered CDN type', async () => {
      const mockedHandler = await loadMockedHandler('byocdn-cloudflare');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake(
        createS3MockForCdnType('fastly', {
          isLegacy: true,
          year: '2025',
          month: '06',
          day: '15',
          hour: '10',
        }),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.log.warn).to.have.been.calledWith(
        'Configured cdnProvider=byocdn-cloudflare was not found among discovered service providers: fastly for siteId=test-site-id, host=example.com',
      );
    });

    it('keeps all discovered service providers when config cdnProvider is empty', async () => {
      const mockedHandler = await loadMockedHandler('');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 10,
      };

      context.s3Client.send.callsFake(
        createS3MockForServiceProviders(['aem-cs-fastly', 'byocdn-akamai']),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.providers).to.be.an('array').with.length(2);
      expect(result.auditResult.providers.map((provider) => provider.serviceProvider))
        .to.deep.equal(['aem-cs-fastly', 'byocdn-akamai']);
    });

    it('does not trigger scanAndTriggerOnly when byocdn-other is discovered alongside a different configured provider', async () => {
      const mockedHandler = await loadMockedHandler('aem-cs-fastly');
      const auditContext = {
        year: 2025,
        month: 6,
        day: 15,
        hour: 23,
      };

      context.s3Client.send.callsFake(
        createS3MockForServiceProviders(['byocdn-other', 'aem-cs-fastly'], {
          year: '2025',
          month: '06',
          day: '15',
          hour: '23',
        }),
      );

      const result = await mockedHandler.cdnLogsAnalysisRunner(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult).to.not.have.property('scanAndTriggerOnly');
      expect(result.auditResult.providers).to.be.an('array').with.length(1);
      expect(result.auditResult.providers[0]).to.include({
        serviceProvider: 'aem-cs-fastly',
        cdnType: 'fastly',
      });
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        'Filtered discovered service providers to configured cdnProvider=aem-cs-fastly for siteId=test-site-id, host=example.com',
      );
    });

    it('dispatcher-scheduled byocdn-other run scans and triggers sub-audits', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
      };

      const orgId = 'test-ims-org-id';
      const recentDate = new Date();

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('aggregated')) {
            return Promise.resolve({ Contents: [] });
          }
          if (Prefix.includes('/raw/byocdn-other/')) {
            return Promise.resolve({
              Contents: [
                { Key: `${orgId}/raw/byocdn-other/2025/06/14/file1.log`, LastModified: recentDate },
                { Key: `${orgId}/raw/byocdn-other/2025/06/15/file2.log`, LastModified: recentDate },
              ],
            });
          }
          return Promise.resolve({
            Contents: [{ Key: `${orgId}/raw/byocdn-other/2025/06/15/file1.log` }],
            CommonPrefixes: [{ Prefix: `${orgId}/raw/byocdn-other/` }],
          });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.have.property('scanAndTriggerOnly', true);
      expect(result.auditResult.providers).to.be.an('array').with.length(0);

      expect(context.sqs.sendMessage).to.have.been.calledWith(
        'test-audit-queue',
        sinon.match({
          type: 'cdn-logs-analysis',
          auditContext: sinon.match({
            processFullDay: true,
            forceReprocess: true,
            isSubAudit: true,
          }),
        }),
      );

      // One date-based report per detected day (06/14, 06/15), sent as day + 1,
      // with a staggered delay: base 800 + index * 30, capped at the SQS max (900).
      const reportCalls = context.sqs.sendMessage.getCalls()
        .filter((call) => call.args[1].type === 'cdn-logs-report');
      expect(reportCalls).to.have.length(2);
      expect(reportCalls.map((c) => c.args[1].auditContext.date)).to.deep.equal([
        '2025-06-15T00:00:00.000Z',
        '2025-06-16T00:00:00.000Z',
      ]);
      expect(reportCalls.map((c) => c.args[3])).to.deep.equal([800, 830]);
      reportCalls.forEach((c) => {
        expect(c.args[0]).to.equal('test-audit-queue');
        expect(c.args[2]).to.equal(null);
        expect(c.args[1].auditContext).to.have.all.keys('date');
      });
    });

    it('byocdn-other sub-audit processes logs normally without scanning', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
        processFullDay: true,
        forceReprocess: true,
        isSubAudit: true,
      };

      context.s3Client.send.callsFake(createS3MockForCdnType('other'));

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.not.have.property('scanAndTriggerOnly');
      expect(result.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
      expect(result.auditResult.providers[0]).to.have.property('cdnType', 'other');
      expect(result.auditResult.providers[0].rawDataPath)
        .to.include('/raw/byocdn-other/2025/06/15/');

      expect(context.sqs.sendMessage).to.not.have.been.called;

      const executeCalls = context.athenaClient.execute.getCalls();
      const aggregatedCall = executeCalls.find((call) => call.args[2]?.includes('Insert aggregated data for byocdn-other'));
      const referralCall = executeCalls.find((call) => call.args[2]?.includes('Insert aggregated referral data for byocdn-other'));

      expect(aggregatedCall.args[0]).to.include("NULLIF(trim(response_content_type), '') IS NOT NULL");
      expect(aggregatedCall.args[0]).to.include("NULLIF(trim(response_content_type), '') IS NULL");
      expect(aggregatedCall.args[0]).to.include("NOT REGEXP_LIKE(url_extract_path(COALESCE(url, ''))");
      expect(aggregatedCall.args[0]).to.include("REGEXP_LIKE(url_extract_path(COALESCE(url, '')), '(?i)(\\.htm|\\.pdf|\\.md|robots\\.txt|llms(-full)?\\.txt|sitemap)')");

      expect(referralCall.args[0]).to.include("lower(response_content_type) LIKE 'text/html%'");
      expect(referralCall.args[0]).to.include("NULLIF(trim(response_content_type), '') IS NULL");
      expect(referralCall.args[0]).to.include("NOT REGEXP_LIKE(url_extract_path(COALESCE(url, ''))");
    });

    it('dispatcher-scheduled byocdn-other run with no recent files returns early', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
      };

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('/raw/byocdn-other/')) {
            return Promise.resolve({ Contents: [] });
          }
          return Promise.resolve({
            Contents: [],
            CommonPrefixes: [{ Prefix: 'test-ims-org-id/raw/byocdn-other/' }],
          });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.have.property('scanAndTriggerOnly', true);
      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No recent byocdn-other files found/),
      );
    });

    it('scanning error is non-fatal for byocdn-other dispatcher run', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
      };

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('/raw/byocdn-other/')) {
            return Promise.reject(new Error('S3 access denied'));
          }
          return Promise.resolve({
            Contents: [],
            CommonPrefixes: [{ Prefix: 'test-ims-org-id/raw/byocdn-other/' }],
          });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.have.property('scanAndTriggerOnly', true);
      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to scan\/trigger byocdn-other sub-audits/),
      );
    });

    it('dispatcher-scheduled byocdn-other run at non-23 hour skips scanning', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
      };

      context.s3Client.send.callsFake(createS3MockForCdnType('other'));

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.not.have.property('scanAndTriggerOnly');
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    describe('retryable Athena failures', () => {
      const subAuditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
        processFullDay: true,
        isSubAudit: true,
      };

      beforeEach(() => {
        context.s3Client.send.callsFake(createS3MockForCdnType('other'));
      });

      it('re-enqueues a delayed retry on "exhausted resources" and returns a soft result', async () => {
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('Query exhausted resources at this scale factor'),
        );

        const result = await cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          subAuditContext,
        );

        expect(result.auditResult).to.include({ retryScheduled: true, retryCount: 1 });
        expect(result.auditResult.error).to.include('exhausted resources at this scale factor');

        // Preserves the original auditContext and only adds retryCount.
        expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
          'test-audit-queue',
          sinon.match({
            type: 'cdn-logs-analysis',
            siteId: 'test-site-id',
            auditContext: {
              ...subAuditContext,
              retryCount: 1,
            },
          }),
          null,
          850,
        );
      });

      it('increments retryCount across attempts', async () => {
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('TOO_MANY_REQUESTS: throttling'),
        );

        await cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          { ...subAuditContext, retryCount: 1 },
        );

        expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
          'test-audit-queue',
          sinon.match({ auditContext: sinon.match({ retryCount: 2 }) }),
          null,
          850,
        );
      });

      it('does not retry when the kill switch CDN_ANALYSIS_RETRY_ENABLED=false', async () => {
        context.env.CDN_ANALYSIS_RETRY_ENABLED = 'false';
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('Query exhausted resources at this scale factor'),
        );

        await expect(cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          subAuditContext,
        )).to.be.rejectedWith(/exhausted resources/);

        expect(context.sqs.sendMessage).to.not.have.been.called;
      });

      it('gives up and rethrows once retries are exhausted', async () => {
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('Query exhausted resources at this scale factor'),
        );

        await expect(cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          { ...subAuditContext, retryCount: 2 },
        )).to.be.rejectedWith(/exhausted resources/);

        expect(context.sqs.sendMessage).to.not.have.been.called;
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/giving up for siteId=test-site-id after 2 retries/),
        );
      });

      it('does not retry non-retryable errors', async () => {
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('SYNTAX_ERROR: line 1:8 mismatched input'),
        );

        await expect(cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          subAuditContext,
        )).to.be.rejectedWith(/SYNTAX_ERROR/);

        expect(context.sqs.sendMessage).to.not.have.been.called;
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/giving up for siteId=test-site-id after 0 retries/),
        );
      });

      it('logs the singular "retry" form when giving up after exactly one retry', async () => {
        context.athenaClient.execute = sandbox.stub().rejects(
          new Error('SYNTAX_ERROR: bad query'),
        );

        await expect(cdnLogsAnalysisRunner(
          'https://example.com',
          context,
          site,
          { ...subAuditContext, retryCount: 1 },
        )).to.be.rejectedWith(/SYNTAX_ERROR/);

        expect(context.sqs.sendMessage).to.not.have.been.called;
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/giving up for siteId=test-site-id after 1 retry:/),
        );
      });
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
      const resultValid = await cdnLogsAnalysisRunner('https://example.com', context, site, validAuditContext);
      expect(resultValid.fullAuditRef).to.equal('s3://spacecat-dev-cdn-logs-aggregates-us-east-1/aggregated/test-site-id/2025/01/02/03/');

      // Test invalid context (should fallback to current time)
      const resultInvalid = await cdnLogsAnalysisRunner('https://example.com', context, site, invalidAuditContext);
      expect(resultInvalid.fullAuditRef).to.not.equal('s3://spacecat-dev-cdn-logs-aggregates-us-east-1/aggregated/test-site-id/2025/01/02/03/');
    });

    it('uses site cdn config region for consolidated bucket when provided', async () => {
      context.env.AWS_REGION = 'eu-west-1';
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => ({
          bucketName: 'cdn-logs-adobe-dev',
          region: 'eu-west-1',
        }),
      });

      const auditContext = {
        year: 2025,
        month: 1,
        day: 2,
        hour: 3,
      };

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.fullAuditRef).to.equal('s3://spacecat-dev-cdn-logs-aggregates-eu-west-1/aggregated/test-site-id/2025/01/02/03/');
    });

    it('handles both orgId and imsOrgId being empty', async () => {
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-test', orgId: '' }),
      });
      site.getOrganizationId.returns(null);

      context.s3Client.send.callsFake(createS3MockForCdnType('fastly', { isLegacy: true }));

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult.providers[0]).to.have.property('cdnType', 'fastly');
    });

    it('handles empty getLlmoCdnBucketConfig config', async () => {
      site.getConfig.returns({
        getLlmoCdnBucketConfig: () => null,
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site);
      expect(result.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
    });

    it('fallback handles midnight rollover in UTC (prev day/month/year)', async () => {
      const originalDateNow = Date.now;
      // Now = 2025-01-01T00:05Z -> previous hour = 2024-12-31T23
      Date.now = sandbox.stub().returns(new Date('2025-01-01T00:05:00Z').getTime());

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site);

      expect(result.fullAuditRef).to.include('2024/12/31/23');

      Date.now = originalDateNow;
    });

    it('pads provided single-digit month/day/hour in auditContext in output paths', async () => {
      const auditContext = {
        year: 2025, month: 9, day: 7, hour: 4,
      };

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.fullAuditRef).to.include('2025/09/07/04');

      expect(result.auditResult.providers).to.be.an('array');
      if (result.auditResult.providers.length > 0) {
        expect(result.auditResult.providers[0].output).to.include('2025/09/07/04');
        expect(result.auditResult.providers[0].outputReferral).to.include('2025/09/07/04');
      }
    });

    it('falls back to previous hour when auditContext is not an object', async () => {
      const originalDateNow = Date.now;
      Date.now = sandbox.stub().returns(new Date('2025-01-01T01:05:00Z').getTime());

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, null);

      expect(result.fullAuditRef).to.include('2025/01/01/00');

      Date.now = originalDateNow;
    });

    it('should allow full day to be processed', async () => {
      const auditContext = {
        year: 2025, month: 9, day: 7, hour: 4,
        processFullDay: true,
      };

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.fullAuditRef).to.include('2025/09/07/04');

      expect(result.auditResult.providers).to.be.an('array');
      if (result.auditResult.providers.length > 0) {
        expect(result.auditResult.providers[0].output).to.include('2025/09/07/04');
        expect(result.auditResult.providers[0].outputReferral).to.include('2025/09/07/04');
      }
    });

    it('should skip processing when aggregated data already exists', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
      };

      // Mock S3 to return aggregated data exists
      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          // Return Contents for aggregated paths to simulate existing data
          if (Prefix.includes('aggregated')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}data.parquet` }] });
          }
          return Promise.resolve({ Contents: [] });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.have.property('skipped', true);
      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(result.fullAuditRef).to.equal('https://example.com');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/aggregated data already exists.*Skipping processing/),
      );
    });

    it('should force reprocessing when forceReprocess is true even if aggregated data exists', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
        processFullDay: true,
        forceReprocess: true,
        isSubAudit: true,
      };

      const orgId = 'test-ims-org-id';
      const deleteCallBuckets = [];

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          deleteCallBuckets.push(command.input.Bucket);
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('aggregated')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}data.parquet` }] });
          }
          return Promise.resolve({
            Contents: [{ Key: `${orgId}/raw/byocdn-other/2025/06/15/file1.log` }],
            CommonPrefixes: [{ Prefix: `${orgId}/raw/byocdn-other/` }],
          });
        }
        if (command.constructor.name === 'GetObjectCommand') {
          const mockStream = {
            async* [Symbol.asyncIterator]() {
              yield Buffer.from('{"url": "/test", "timestamp": "2025-06-15T10:00:00Z", "status": 200}\n');
            },
          };
          return Promise.resolve({ Body: mockStream });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult).to.not.have.property('skipped');
      expect(result.auditResult.providers).to.be.an('array').with.length.greaterThan(0);
      expect(result.auditResult.providers[0]).to.have.property('cdnType', 'other');

      expect(deleteCallBuckets).to.have.length(2);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Cleared.*object\(s\) from.*aggregated\//),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Cleared.*object\(s\) from.*aggregated-referral\//),
      );
      expect(result.auditResult.providers[0].rawDataPath)
        .to.include('/raw/byocdn-other/2025/06/15/');
    });

    it('should clear forceReprocess partitions once even when multiple providers are processed', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
        forceReprocess: true,
        isSubAudit: true,
      };

      const orgId = 'test-ims-org-id';
      const deletePrefixes = [];

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          deletePrefixes.push(command.input.Delete.Objects[0].Key);
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix === `${orgId}/raw/`) {
            return Promise.resolve({
              CommonPrefixes: [
                { Prefix: `${orgId}/raw/aem-cs-fastly/` },
                { Prefix: `${orgId}/raw/byocdn-fastly/` },
              ],
            });
          }
          if (Prefix.includes('aggregated')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}data.parquet` }] });
          }
          if (Prefix.includes('/raw/aem-cs-fastly/2025/06/15/10/')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}file1.log` }] });
          }
          if (Prefix.includes('/raw/byocdn-fastly/2025/06/15/10/')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}file2.log` }] });
          }
          return Promise.resolve({ Contents: [] });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult.providers).to.be.an('array').with.length(2);
      expect(deletePrefixes).to.have.length(2);
      expect(deletePrefixes[0]).to.include('aggregated/test-site-id/2025/06/15/10/');
      expect(deletePrefixes[1]).to.include('aggregated-referral/test-site-id/2025/06/15/10/');
    });

    it('should ignore missing consolidated bucket during forceReprocess cleanup', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
        forceReprocess: true,
        isSubAudit: true,
      };

      const orgId = 'test-ims-org-id';
      const noSuchBucketError = new Error('The specified bucket does not exist');
      noSuchBucketError.name = 'NoSuchBucket';
      noSuchBucketError.Code = 'NoSuchBucket';
      const deleteSpy = sandbox.spy();

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          deleteSpy();
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Bucket = '', Prefix = '' } = command.input || {};
          if (Bucket === 'spacecat-dev-cdn-logs-aggregates-us-east-1') {
            return Promise.reject(noSuchBucketError);
          }
          if (Prefix === `${orgId}/raw/`) {
            return Promise.resolve({
              CommonPrefixes: [{ Prefix: `${orgId}/raw/aem-cs-fastly/` }],
            });
          }
          if (Prefix.includes('/raw/aem-cs-fastly/2025/06/15/10/')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}file1.log` }] });
          }
          return Promise.resolve({ Contents: [] });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult.providers).to.be.an('array').with.length(1);
      expect(deleteSpy).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Skipping partition cleanup.*bucket does not exist yet/),
      );
    });

    it('should rebuild and warn when only one aggregate path exists', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
        isSubAudit: true,
      };

      const deletePrefixes = [];

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'DeleteObjectsCommand') {
          deletePrefixes.push(command.input.Delete.Objects[0].Key);
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('aggregated-referral/')) {
            return Promise.resolve({ Contents: [] });
          }
          if (Prefix.includes('aggregated/')) {
            return Promise.resolve({ Contents: [{ Key: `${Prefix}data.parquet` }] });
          }
          return Promise.resolve({
            Contents: [{ Key: 'test-ims-org-id/raw/aem-cs-fastly/2025/06/15/10/file1.log' }],
            CommonPrefixes: [{ Prefix: 'test-ims-org-id/raw/aem-cs-fastly/' }],
          });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult.providers).to.be.an('array').with.length(1);
      expect(deletePrefixes).to.have.length(1);
      expect(deletePrefixes[0]).to.include('aggregated/test-site-id/2025/06/15/10/');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/found partial aggregates.*Rebuilding/),
      );
    });

    it('sends one date-based cdn-logs-report per detected day', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 23,
      };

      const orgId = 'test-ims-org-id';
      const recentDate = new Date();

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          if (Prefix.includes('/raw/byocdn-other/')) {
            return Promise.resolve({
              Contents: [
                { Key: `${orgId}/raw/byocdn-other/2025/06/09/a.log`, LastModified: recentDate },
                { Key: `${orgId}/raw/byocdn-other/2025/06/10/b.log`, LastModified: recentDate },
                { Key: `${orgId}/raw/byocdn-other/2025/06/11/c.log`, LastModified: recentDate },
              ],
            });
          }
          return Promise.resolve({
            Contents: [],
            CommonPrefixes: [{ Prefix: `${orgId}/raw/byocdn-other/` }],
          });
        }
        return Promise.resolve({});
      });

      await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      const analysisCalls = context.sqs.sendMessage.getCalls()
        .filter((c) => c.args[1]?.type === 'cdn-logs-analysis');
      const reportCalls = context.sqs.sendMessage.getCalls()
        .filter((c) => c.args[1]?.type === 'cdn-logs-report');

      expect(analysisCalls).to.have.length(3);
      // No week dedup: one date-based report per detected day (day + 1 reference).
      expect(reportCalls).to.have.length(3);
      expect(reportCalls.map((c) => c.args[1].auditContext.date)).to.have.members([
        '2025-06-10T00:00:00.000Z',
        '2025-06-11T00:00:00.000Z',
        '2025-06-12T00:00:00.000Z',
      ]);
      // Staggered delays: base 800 + index * 30.
      expect(reportCalls.map((c) => c.args[3])).to.deep.equal([800, 830, 860]);
    });

    it('should skip provider when no raw data exists', async () => {
      const auditContext = {
        year: 2025, month: 6, day: 15, hour: 10,
      };

      context.s3Client.send.callsFake((command) => {
        if (command.constructor.name === 'HeadBucketCommand') {
          return Promise.resolve({});
        }
        if (command.constructor.name === 'ListObjectsV2Command') {
          const { Prefix = '' } = command.input || {};
          // Return providers for discovery, but no actual data
          if (Prefix && Prefix.includes('test-ims-org-id/raw/')) {
            return Promise.resolve({
              Contents: [],
              CommonPrefixes: [{ Prefix: 'test-ims-org-id/raw/aem-cs-fastly/' }],
            });
          }
          // No aggregated or raw data
          return Promise.resolve({ Contents: [] });
        }
        return Promise.resolve({});
      });

      const result = await cdnLogsAnalysisRunner('https://example.com', context, site, auditContext);

      expect(result.auditResult.providers).to.be.an('array').with.length(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/no raw logs found/),
      );
    });
  });

  describe('findRecentUploads', () => {
    let sandbox;
    let mockS3Client;
    let mockLog;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockLog = { info: sandbox.spy(), error: sandbox.spy() };
      mockS3Client = { send: sandbox.stub() };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('returns days with files modified in the last 24 hours', async () => {
      const auditDate = new Date();
      const recentDate = new Date(auditDate.getTime() - 3600 * 1000);
      const oldDate = new Date(auditDate.getTime() - 48 * 3600 * 1000);

      mockS3Client.send.resolves({
        Contents: [
          { Key: 'org1/raw/byocdn-other/2025/06/14/a.log', LastModified: recentDate },
          { Key: 'org1/raw/byocdn-other/2025/06/13/old.log', LastModified: oldDate },
          { Key: 'org1/raw/byocdn-other/2025/06/15/b.log', LastModified: recentDate },
        ],
      });

      const result = await findRecentUploads(mockS3Client, 'test-bucket', 'org1', auditDate, mockLog);

      expect(result.size).to.equal(2);
      expect(result.has('2025/06/14')).to.be.true;
      expect(result.has('2025/06/15')).to.be.true;
      expect(result.has('2025/06/13')).to.be.false;
    });

    it('handles pagination via ContinuationToken', async () => {
      const auditDate = new Date();
      const recentDate = new Date(auditDate.getTime() - 3600 * 1000);

      mockS3Client.send.onFirstCall().resolves({
        Contents: [
          { Key: 'org1/raw/byocdn-other/2025/06/14/a.log', LastModified: recentDate },
        ],
        NextContinuationToken: 'page2',
      });
      mockS3Client.send.onSecondCall().resolves({
        Contents: [
          { Key: 'org1/raw/byocdn-other/2025/06/15/b.log', LastModified: recentDate },
        ],
      });

      const result = await findRecentUploads(mockS3Client, 'test-bucket', 'org1', auditDate, mockLog);

      expect(result.size).to.equal(2);
      expect(mockS3Client.send).to.have.been.calledTwice;
    });

    it('returns empty set when no files exist', async () => {
      mockS3Client.send.resolves({ Contents: [] });

      const result = await findRecentUploads(mockS3Client, 'test-bucket', 'org1', new Date(), mockLog);

      expect(result.size).to.equal(0);
    });

    it('handles response with undefined Contents', async () => {
      mockS3Client.send.resolves({});

      const result = await findRecentUploads(mockS3Client, 'test-bucket', 'org1', new Date(), mockLog);

      expect(result.size).to.equal(0);
    });

    it('uses correct prefix when pathId is provided', async () => {
      mockS3Client.send.resolves({ Contents: [] });

      await findRecentUploads(mockS3Client, 'test-bucket', 'my-org', new Date(), mockLog);

      const { input } = mockS3Client.send.firstCall.args[0];
      expect(input.Prefix).to.equal('my-org/raw/byocdn-other/');
    });

    it('uses correct prefix when pathId is absent', async () => {
      mockS3Client.send.resolves({ Contents: [] });

      await findRecentUploads(mockS3Client, 'test-bucket', null, new Date(), mockLog);

      const { input } = mockS3Client.send.firstCall.args[0];
      expect(input.Prefix).to.equal('raw/byocdn-other/');
    });
  });

  describe('computeWeekOffset', () => {
    it('returns 0 for a day in the current week', () => {
      const today = new Date();
      const offset = computeWeekOffset(
        today.getUTCFullYear(),
        today.getUTCMonth() + 1,
        today.getUTCDate(),
      );
      expect(offset).to.equal(0);
    });

    it('returns -1 for a day in the previous week', () => {
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const offset = computeWeekOffset(
        lastWeek.getUTCFullYear(),
        lastWeek.getUTCMonth() + 1,
        lastWeek.getUTCDate(),
      );
      expect(offset).to.equal(-1);
    });
  });
});
