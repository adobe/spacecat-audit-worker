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

import { createHash } from 'crypto';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { serializeCsv } from '../../../src/llmo-referral-traffic-daily/handler.js';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const EXPECTED_PARQUET_KEY = 'rum-metrics-compact/data-daily/siteid=site-123/year=2026/month=04/day=29/data.parquet';

// Minimal parquet row fixture representing one LLM referral row
const PARQUET_ROW = {
  path: '/us/page1',
  date: '2026-04-29',
  trf_type: 'earned',
  trf_channel: 'llm',
  trf_platform: 'chatgpt',
  device: 'desktop',
  consent: 'accept',
  pageviews: 100,
  engaged: 1,
};

describe('serializeCsv', () => {
  it('should render null field values as empty string', () => {
    const rows = [{
      traffic_date: '2026-04-29',
      host: 'example.com',
      url_path: '/page',
      trf_platform: null,
      device: 'desktop',
      region: 'GLOBAL',
      pageviews: 1,
      consent: 'true',
      trf_type: 'earned',
      trf_channel: 'llm',
      bounced: 0,
      updated_by: 'spacecat:optel',
    }];
    const csv = serializeCsv(rows);
    expect(csv).to.include('2026-04-29,example.com,/page,,desktop');
  });

  it('should quote CSV values that contain carriage return', () => {
    const rows = [{
      traffic_date: '2026-04-29',
      host: 'example.com',
      url_path: '/page',
      trf_platform: 'platform\rwith\rcr',
      device: 'desktop',
      region: 'GLOBAL',
      pageviews: 1,
      consent: 'true',
      trf_type: 'earned',
      trf_channel: 'llm',
      bounced: 0,
      updated_by: 'spacecat:optel',
    }];
    const csv = serializeCsv(rows);
    expect(csv).to.include('"platform\rwith\rcr"');
  });
});

describe('LLMO Referral Traffic Daily Handler', function () {
  this.timeout(10000);

  let sandbox;
  let context;
  let site;
  let audit;
  let s3ClientStub;
  let sqsSendMessageStub;
  let parquetReadObjectsStub;
  let handlerModule;

  before(() => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    s3ClientStub = { send: sandbox.stub() };
    sqsSendMessageStub = sandbox.stub().resolves();
    parquetReadObjectsStub = sandbox.stub().resolves([PARQUET_ROW]);

    site = {
      getId: sandbox.stub().returns('site-123'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getOrganizationId: sandbox.stub().returns('org-456'),
    };

    audit = {
      getAuditResult: sandbox.stub().returns({
        status: 'import-triggered',
        date: '2026-04-29',
        year: 2026,
        month: 4,
        day: 29,
        parquetKey: EXPECTED_PARQUET_KEY,
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site,
        audit,
        s3Client: s3ClientStub,
        sqs: { sendMessage: sqsSendMessageStub },
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getQueues: () => ({ analytics: 'https://sqs.us-east-1.amazonaws.com/test/analytics.fifo' }),
            }),
          },
        },
      })
      .build();

    handlerModule = await esmock('../../../src/llmo-referral-traffic-daily/handler.js', {
      'hyparquet': { parquetReadObjects: parquetReadObjectsStub },
      '@aws-sdk/client-s3': {
        GetObjectCommand: sinon.stub().callsFake((args) => ({ ...args, _type: 'GetObjectCommand' })),
        PutObjectCommand: sinon.stub().callsFake((args) => ({ ...args, _type: 'PutObjectCommand' })),
        DeleteObjectCommand: sinon.stub().callsFake((args) => ({ ...args, _type: 'DeleteObjectCommand' })),
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ───────────────────────────── Step 1 ─────────────────────────────

  describe('triggerTrafficAnalysisDailyImport', () => {
    it('should use yesterday when auditContext.date is not set', async () => {
      const clock = sandbox.useFakeTimers(new Date('2026-04-30T10:00:00Z'));
      context.auditContext = {};
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisDailyImport(context);

      expect(result.auditResult.date).to.equal('2026-04-29');
      expect(result.auditResult.year).to.equal(2026);
      expect(result.auditResult.month).to.equal(4);
      expect(result.auditResult.day).to.equal(29);
      expect(result.type).to.equal('traffic-analysis-daily');
      expect(result.allowCache).to.equal(false);
      clock.restore();
    });

    it('should use auditContext.date when provided', async () => {
      context.auditContext = { date: '2026-03-15' };
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisDailyImport(context);

      expect(result.auditResult.date).to.equal('2026-03-15');
      expect(result.auditResult.year).to.equal(2026);
      expect(result.auditResult.month).to.equal(3);
      expect(result.auditResult.day).to.equal(15);
      expect(result.auditContext).to.deep.equal({
        date: '2026-03-15', year: 2026, month: 3, day: 15,
      });
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should include siteId and parquetKey in the returned message', async () => {
      context.auditContext = { date: '2026-04-29' };
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisDailyImport(context);
      expect(result.siteId).to.equal('site-123');
      expect(result.auditResult.parquetKey).to.equal(EXPECTED_PARQUET_KEY);
    });

    it('should default auditContext to empty object when absent from context', async () => {
      const clock = sandbox.useFakeTimers(new Date('2026-04-30T00:30:00Z'));
      delete context.auditContext;
      context.finalUrl = 'https://example.com';

      const result = await handlerModule.triggerTrafficAnalysisDailyImport(context);
      expect(result.auditResult.date).to.equal('2026-04-29');
      clock.restore();
    });

    it('should throw on invalid date format', async () => {
      context.auditContext = { date: '2026/04/29' };
      context.finalUrl = 'https://example.com';
      await expect(handlerModule.triggerTrafficAnalysisDailyImport(context))
        .to.be.rejectedWith('Invalid date format: 2026/04/29');
    });
  });

  // ───────────────────────────── Step 2 ─────────────────────────────

  describe('referralTrafficDailyRunner', () => {
    it('should throw if S3_IMPORTER_BUCKET_NAME is not set', async () => {
      context.env = {};
      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided');
    });

    it('should throw if analytics queue is not configured', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        getQueues: () => ({ analytics: '' }),
      });
      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('analytics queue is not configured');
    });

    it('should throw if getQueues returns null', async () => {
      context.dataAccess.Configuration.findLatest.resolves({
        getQueues: () => null,
      });
      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('analytics queue is not configured');
    });

    it('should throw on invalid date format', async () => {
      audit.getAuditResult.returns({
        date: 'not-a-date', year: 2026, month: 4, day: 29,
        parquetKey: EXPECTED_PARQUET_KEY,
      });
      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('Invalid date format: not-a-date');
    });

    it('should return early with rowCount 0 when parquet does not exist (NoSuchKey)', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      noSuchKeyError.name = 'NoSuchKey';
      s3ClientStub.send.rejects(noSuchKeyError);

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.rowCount).to.equal(0);
      expect(result.auditResult.date).to.equal('2026-04-29');
      expect(result.fullAuditRef).to.include('s3://test-bucket');
    });

    it('should rethrow non-NoSuchKey S3 errors', async () => {
      const genericError = new Error('Access Denied');
      genericError.name = 'AccessDenied';
      s3ClientStub.send.rejects(genericError);

      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('Access Denied');
    });

    it('should return early with rowCount 0 when no rows pass the LLM filter', async () => {
      parquetReadObjectsStub.resolves([{
        path: '/page1',
        date: '2026-04-29',
        trf_type: 'paid',
        trf_channel: 'social',
        pageviews: 100,
        engaged: 1,
      }]);

      s3ClientStub.send.resolves({
        Body: {
          transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])),
        },
      });

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.rowCount).to.equal(0);
      expect(sqsSendMessageStub).not.to.have.been.called;
    });

    it('should upload CSV and dispatch analytics event for valid data', async () => {
      parquetReadObjectsStub.resolves([PARQUET_ROW]);

      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.rowCount).to.equal(1);
      expect(result.auditResult.date).to.equal('2026-04-29');
      expect(result.auditResult.csvKey).to.include('rum-metrics-compact/llmo-daily-csvs/siteid=site-123');
      expect(result.auditResult.csvKey).to.include('data.csv');
      expect(result.fullAuditRef).to.include('s3://test-bucket');

      // Verify PutObjectCommand was sent with CSV
      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.ContentType).to.equal('text/csv');
      expect(putCall.Body).to.include('traffic_date,host,url_path');
      expect(putCall.Body).to.include('2026-04-29');

      // Verify analytics SQS message shape and deterministic dedup ID
      expect(sqsSendMessageStub).to.have.been.calledOnce;
      const [queueUrl, msg, groupId,, dedupId] = sqsSendMessageStub.firstCall.args;
      const expectedDedupId = createHash('sha256')
        .update('site-123:2026-04-29:referral_traffic_optel')
        .digest('hex');
      expect(queueUrl).to.include('analytics');
      expect(msg.pipeline_id).to.equal('referral_traffic_optel');
      expect(msg.type).to.equal('batch.completed');
      expect(msg.site_id).to.equal('site-123');
      expect(msg.org_id).to.equal('org-456');
      expect(msg.row_count).to.equal(1);
      expect(msg.start_date).to.equal('2026-04-29');
      expect(msg.end_date).to.equal('2026-04-29');
      expect(msg.correlationId).to.equal(expectedDedupId);
      expect(msg.s3_uri).to.include('rum-metrics-compact/llmo-daily-csvs/siteid=site-123');
      expect(msg.s3_uri).to.include('data.csv');
      expect(groupId).to.equal('referral_traffic_optel:site-123');
      expect(dedupId).to.equal(expectedDedupId);
    });

    it('should omit org_id when getOrganizationId returns falsy', async () => {
      site.getOrganizationId.returns(null);
      parquetReadObjectsStub.resolves([PARQUET_ROW]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.rowCount).to.equal(1);
      const [, msg] = sqsSendMessageStub.firstCall.args;
      expect(msg).not.to.have.property('org_id');
    });

    it('should delete uploaded CSV when SQS dispatch fails', async () => {
      parquetReadObjectsStub.resolves([PARQUET_ROW]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({})  // PUT succeeds
        .onThirdCall().resolves({});  // DELETE cleanup

      sqsSendMessageStub.rejects(new Error('SQS unavailable'));

      await expect(handlerModule.referralTrafficDailyRunner(context))
        .to.be.rejectedWith('SQS unavailable');

      expect(s3ClientStub.send).to.have.been.calledThrice;
      const deleteCall = s3ClientStub.send.thirdCall.args[0];
      expect(deleteCall.Key).to.include('data.csv');
    });

    it('should aggregate pageviews for same group key', async () => {
      parquetReadObjectsStub.resolves([
        { ...PARQUET_ROW, pageviews: 40 },
        { ...PARQUET_ROW, pageviews: 60 },
      ]);

      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.rowCount).to.equal(1);
      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include('100');
    });

    it('should produce two rows for same path with different bounced values', async () => {
      parquetReadObjectsStub.resolves([
        { ...PARQUET_ROW, engaged: 1, pageviews: 70 },  // bounced=0
        { ...PARQUET_ROW, engaged: 0, pageviews: 30 },  // bounced=1
      ]);

      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);
      expect(result.auditResult.rowCount).to.equal(2);
    });

    it('should correctly derive region from path', async () => {
      parquetReadObjectsStub.resolves([{ ...PARQUET_ROW, path: '/de/page1' }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include('DE');
    });

    it('should default region to GLOBAL for unrecognized path', async () => {
      parquetReadObjectsStub.resolves([{ ...PARQUET_ROW, path: '/some/generic/path' }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include('GLOBAL');
    });

    it('should map consent=null to true (consent=true in CSV)', async () => {
      parquetReadObjectsStub.resolves([{ ...PARQUET_ROW, consent: null }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include(',true,');
    });

    it('should map consent=reject to false (consent=false in CSV)', async () => {
      parquetReadObjectsStub.resolves([{ ...PARQUET_ROW, consent: 'reject' }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include(',false,');
    });

    it('should use correct S3 path for CSV with padded month and day', async () => {
      audit.getAuditResult.returns({
        date: '2026-01-05',
        year: 2026,
        month: 1,
        day: 5,
        parquetKey: 'rum-metrics-compact/data-daily/siteid=site-123/year=2026/month=01/day=05/data.parquet',
      });
      parquetReadObjectsStub.resolves([{ ...PARQUET_ROW, date: '2026-01-05' }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);

      expect(result.auditResult.csvKey).to.equal(
        'rum-metrics-compact/llmo-daily-csvs/siteid=site-123/year=2026/month=01/day=05/data.csv',
      );
      expect(result.fullAuditRef).to.equal(
        's3://test-bucket/rum-metrics-compact/llmo-daily-csvs/siteid=site-123/year=2026/month=01/day=05/data.csv',
      );
    });

    it('should set updated_by to spacecat:optel in every CSV row', async () => {
      parquetReadObjectsStub.resolves([PARQUET_ROW]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include('spacecat:optel');
    });

    it('should fall back to empty string for missing row fields', async () => {
      parquetReadObjectsStub.resolves([{
        trf_type: 'earned',
        trf_channel: 'llm',
        engaged: 1,
        // date, path, trf_platform, device, pageviews, consent intentionally absent
      }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      const result = await handlerModule.referralTrafficDailyRunner(context);
      expect(result.auditResult.rowCount).to.equal(1);
    });

    it('should quote CSV values that contain commas or double quotes', async () => {
      parquetReadObjectsStub.resolves([{
        ...PARQUET_ROW,
        trf_platform: 'platform,with,commas',
        device: 'device"with"quotes',
      }]);
      s3ClientStub.send
        .onFirstCall().resolves({
          Body: { transformToByteArray: sandbox.stub().resolves(new Uint8Array([0])) },
        })
        .onSecondCall().resolves({});

      await handlerModule.referralTrafficDailyRunner(context);

      const putCall = s3ClientStub.send.secondCall.args[0];
      expect(putCall.Body).to.include('"platform,with,commas"');
      expect(putCall.Body).to.include('"device""with""quotes"');
    });
  });
});
