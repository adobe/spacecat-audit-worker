/*
 * Copyright 2026 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(chaiAsPromised);
use(sinonChai);

describe('agentic daily export', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function createConfiguration(queueUrl = 'https://sqs.us-east-1.amazonaws.com/123/analytics-queue') {
    return {
      getQueues: () => ({
        analytics: queueUrl,
      }),
    };
  }

  it('uploads both CSV artifacts and dispatches the analytics event', async () => {
    const queryBuilder = {
      createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT * FROM daily_agentic'),
    };
    const mapper = {
      mapToAgenticTrafficBundle: sandbox.stub().resolves({
        trafficRows: [{
          traffic_date: '2026-03-31',
          host: 'docs.example.com',
          platform: 'ChatGPT',
          agent_type: 'Chatbots',
          user_agent: 'ChatGPT-User',
          http_status: 200,
          url_path: '/docs/page',
          hits: 12,
          avg_ttfb_ms: 123.45,
          dimensions: { citability_score: 82 },
          metrics: {},
          updated_by: 'audit-worker:agentic-daily-export',
        }],
        classificationRows: [{
          host: 'docs.example.com',
          url_path: '/docs/page',
          region: 'US',
          category_name: 'Docs',
          page_type: 'Documentation',
          content_type: 'html',
          updated_by: 'audit-worker:agentic-daily-export',
        }],
      }),
    };

    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE IF NOT EXISTS test_db'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: queryBuilder,
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': mapper,
      uuid: {
        v4: () => 'batch-123',
      },
    });

    const athenaClient = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([{ raw: true }]),
    };
    const s3Client = {
      send: sandbox.stub().resolves({}),
    };
    const context = {
      env: {
        S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
      },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves(createConfiguration()),
        },
      },
      log: {
        info: sandbox.spy(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
    const site = {
      getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      getOrganizationId: () => 'org-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCdnlogsFilter: () => [],
      }),
    };

    expect(module.isAgenticDailyExportEnabled(site, context)).to.equal(true);

    const result = await module.runDailyAgenticExport({
      athenaClient,
      s3Client,
      s3Config: {
        bucket: 'spacecat-dev-cdn-logs-aggregates-us-east-1',
        databaseName: 'cdn_logs_example',
      },
      site,
      context,
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    });

    expect(queryBuilder.createAgenticDailyReportQuery).to.have.been.calledOnce;
    expect(mapper.mapToAgenticTrafficBundle).to.have.been.calledOnce;
    expect(athenaClient.execute).to.have.been.calledOnce;
    expect(athenaClient.query).to.have.been.calledOnceWith(
      'SELECT * FROM daily_agentic',
      'cdn_logs_example',
      '[Athena Query] agentic_daily_flat_data',
    );
    expect(s3Client.send).to.have.been.calledTwice;
    expect(s3Client.send.firstCall.args[0].input.Bucket).to.equal('spacecat-dev-importer');
    expect(s3Client.send.secondCall.args[0].input.Bucket).to.equal('spacecat-dev-importer');
    expect(s3Client.send.firstCall.args[0].input.Key).to.equal('9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3/agentic-traffic/2026/03/20260401T100000000Z/agentic_traffic.csv');
    expect(s3Client.send.secondCall.args[0].input.Key).to.equal('9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3/agentic-traffic/2026/03/20260401T100000000Z/agentic_url_classifications.csv');
    expect(s3Client.send.firstCall.args[0].input.Body).to.include('traffic_date,host,platform');
    expect(s3Client.send.secondCall.args[0].input.Body).to.include('host,url_path,region');
    expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
      'https://sqs.us-east-1.amazonaws.com/123/analytics-queue',
      sinon.match({
        type: 'batch.completed',
        correlationId: 'batch-123',
        pipeline_id: 'agentic_traffic',
        s3_uri: 's3://spacecat-dev-importer/9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3/agentic-traffic/2026/03/20260401T100000000Z/',
        site_id: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        org_id: 'org-1',
        start_date: '2026-03-31',
        end_date: '2026-03-31',
        row_count: 1,
      }),
    );
    expect(result).to.include({
      enabled: true,
      success: true,
      skipped: false,
      siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      trafficDate: '2026-03-31',
      rowCount: 1,
      classificationCount: 1,
      bundleUri: 's3://spacecat-dev-importer/9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3/agentic-traffic/2026/03/20260401T100000000Z/',
    });
  });

  it('enables daily export only for the temporary allowlisted site ids', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js');

    expect(module.isAgenticDailyExportEnabled({
      getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
    })).to.equal(true);
    expect(module.isAgenticDailyExportEnabled({
      getId: () => '12d54932-e963-4783-aac3-4b1edbc27cde',
    })).to.equal(true);
    expect(module.isAgenticDailyExportEnabled({
      getId: () => 'site-1',
    })).to.equal(false);
    expect(module.isAgenticDailyExportEnabled({
      getId: () => undefined,
    })).to.equal(false);
  });

  it('logs a warning when cleanup after failure also fails', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js');
    const log = {
      warn: sandbox.spy(),
    };

    const s3Client = {
      send: sandbox.stub().rejects(new Error('cleanup failed')),
    };

    await module.testHelpers.cleanupBundleFromS3({
      s3Client,
      bucket: 'bucket',
      uploadedFiles: {
        trafficKey: 'site-1/agentic_traffic.csv',
        classificationsKey: 'site-1/agentic_url_classifications.csv',
      },
      log,
    });

    expect(log.warn).to.have.been.calledOnceWith(
      sinon.match('Failed to clean up agentic export bundle'),
    );
  });

  it('guards against dispatch without a queue URL', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js');

    await expect(module.testHelpers.dispatchAnalyticsEvent({
      context: {
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      queueUrl: '',
      site: {
        getId: () => 'site-1',
      },
      batchId: 'batch-123',
      bundleUri: 's3://bucket/site-1/agentic-traffic/2026/03/20260401T100000000Z/',
      trafficDate: '2026-03-31',
      rowCount: 1,
    })).to.be.rejectedWith('analytics queue is not configured');
  });

  it('requires an importer bucket before running the daily export', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js');

    await expect(module.runDailyAgenticExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([]),
      },
      s3Client: {
        send: sandbox.stub().resolves({}),
      },
      s3Config: {
        bucket: 'cdn-aggregate-bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {},
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(createConfiguration()),
          },
        },
        log: {
          info: sandbox.spy(),
          warn: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    })).to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for agentic daily export');
  });

  it('serializes null and undefined CSV values as empty strings', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js');

    expect(module.testHelpers.escapeCsvValue(null)).to.equal('');
    expect(module.testHelpers.escapeCsvValue(undefined)).to.equal('');
  });

  it('skips upload and dispatch when there are no traffic rows', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT 1'),
        },
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': {
        mapToAgenticTrafficBundle: sandbox.stub().resolves({
          trafficRows: [],
          classificationRows: [],
        }),
      },
      uuid: {
        v4: () => 'batch-123',
      },
    });

    const result = await module.runDailyAgenticExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([]),
      },
      s3Client: {
        send: sandbox.stub().resolves({}),
      },
      s3Config: {
        bucket: 'bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {
          S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(createConfiguration()),
          },
        },
        log: {
          info: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    });

    expect(result).to.deep.include({
      enabled: true,
      success: true,
      skipped: true,
      siteId: 'site-1',
      trafficDate: '2026-03-31',
      rowCount: 0,
      classificationCount: 0,
    });
  });

  it('fails before Athena or S3 work when the analytics queue is missing', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT 1'),
        },
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': {
        mapToAgenticTrafficBundle: sandbox.stub().resolves({
          trafficRows: [],
          classificationRows: [],
        }),
      },
    });

    const athenaClient = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([]),
    };
    const s3Client = {
      send: sandbox.stub().resolves({}),
    };

    await expect(module.runDailyAgenticExport({
      athenaClient,
      s3Client,
      s3Config: {
        bucket: 'bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {
          S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getQueues: () => ({}),
            }),
          },
        },
        log: {
          info: sandbox.spy(),
          warn: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    })).to.be.rejectedWith('analytics queue is not configured');

    expect(athenaClient.execute).to.not.have.been.called;
    expect(athenaClient.query).to.not.have.been.called;
    expect(s3Client.send).to.not.have.been.called;
  });

  it('cleans up uploaded files when analytics dispatch fails', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT 1'),
        },
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': {
        mapToAgenticTrafficBundle: sandbox.stub().resolves({
          trafficRows: [{
            traffic_date: '2026-03-31',
            host: 'docs.example.com',
            platform: 'ChatGPT',
            agent_type: 'Chatbots',
            user_agent: 'ChatGPT-User',
            http_status: 200,
            url_path: '/docs/page',
            hits: 12,
            avg_ttfb_ms: 123.45,
            dimensions: {},
            metrics: {},
            updated_by: 'audit-worker:agentic-daily-export',
          }],
          classificationRows: [{
            host: 'docs.example.com',
            url_path: '/docs/page',
            region: 'US',
            category_name: 'Docs',
            page_type: 'Documentation',
            content_type: 'html',
            updated_by: 'audit-worker:agentic-daily-export',
          }],
        }),
      },
      uuid: {
        v4: () => 'batch-123',
      },
    });

    const s3Client = {
      send: sandbox.stub().resolves({}),
    };

    await expect(module.runDailyAgenticExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([]),
      },
      s3Client,
      s3Config: {
        bucket: 'bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getOrganizationId: () => 'org-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {
          S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(createConfiguration()),
          },
        },
        log: {
          info: sandbox.spy(),
          warn: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().rejects(new Error('SQS unavailable')),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    })).to.be.rejectedWith('SQS unavailable');

    expect(s3Client.send).to.have.callCount(3);
    expect(s3Client.send.lastCall.args[0].constructor.name).to.equal('DeleteObjectsCommand');
  });

  it('cleans up uploaded files when an S3 upload fails', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT 1'),
        },
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': {
        mapToAgenticTrafficBundle: sandbox.stub().resolves({
          trafficRows: [{
            traffic_date: '2026-03-31',
            host: 'docs.example.com',
            platform: 'ChatGPT',
            agent_type: 'Chatbots',
            user_agent: 'ChatGPT-User',
            http_status: 200,
            url_path: '/docs/page',
            hits: 12,
            avg_ttfb_ms: 123.45,
            dimensions: {},
            metrics: {},
            updated_by: 'audit-worker:agentic-daily-export',
          }],
          classificationRows: [{
            host: 'docs.example.com',
            url_path: '/docs/page',
            region: 'US',
            category_name: 'Docs',
            page_type: 'Documentation',
            content_type: 'html',
            updated_by: 'audit-worker:agentic-daily-export',
          }],
        }),
      },
      uuid: {
        v4: () => 'batch-123',
      },
    });

    const s3Client = {
      send: sandbox.stub(),
    };
    s3Client.send.onCall(0).rejects(new Error('S3 upload failed'));
    s3Client.send.onCall(1).resolves({});
    s3Client.send.onCall(2).resolves({});

    await expect(module.runDailyAgenticExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([]),
      },
      s3Client,
      s3Config: {
        bucket: 'bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getOrganizationId: () => 'org-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {
          S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(createConfiguration()),
          },
        },
        log: {
          info: sandbox.spy(),
          warn: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    })).to.be.rejectedWith('S3 upload failed');

    expect(s3Client.send).to.have.callCount(3);
    expect(s3Client.send.lastCall.args[0].constructor.name).to.equal('DeleteObjectsCommand');
  });

  it('propagates Athena database setup failures without touching S3', async () => {
    const module = await esmock('../../../src/cdn-logs-report/agentic-daily-export.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE'),
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createAgenticDailyReportQuery: sandbox.stub().resolves('SELECT 1'),
        },
      },
      '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js': {
        mapToAgenticTrafficBundle: sandbox.stub().resolves({
          trafficRows: [],
          classificationRows: [],
        }),
      },
    });

    const athenaClient = {
      execute: sandbox.stub().rejects(new Error('Athena unavailable')),
      query: sandbox.stub().resolves([]),
    };
    const s3Client = {
      send: sandbox.stub().resolves({}),
    };

    await expect(module.runDailyAgenticExport({
      athenaClient,
      s3Client,
      s3Config: {
        bucket: 'bucket',
        databaseName: 'db',
      },
      site: {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      },
      context: {
        env: {
          S3_IMPORTER_BUCKET_NAME: 'spacecat-dev-importer',
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves(createConfiguration()),
          },
        },
        log: {
          info: sandbox.spy(),
          warn: sandbox.spy(),
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      reportConfig: {
        tableName: 'aggregated_logs_example_consolidated',
      },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    })).to.be.rejectedWith('Athena unavailable');

    expect(athenaClient.query).to.not.have.been.called;
    expect(s3Client.send).to.not.have.been.called;
  });
});
