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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('agentic DB export orchestration', () => {
  let sandbox;
  let clock;
  let runDailyAgenticExportStub;
  let generateReportingPeriodsStub;
  let module;

  function createArgs(overrides = {}) {
    return {
      athenaClient: {},
      s3Client: {},
      s3Config: { databaseName: 'cdn_logs_example' },
      site: {
        getId: () => 'site-1',
      },
      context: {
        log: {
          debug: sandbox.spy(),
          info: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        dataAccess: {
          Configuration: {
            findLatest: sandbox.stub().resolves({
              getQueues: () => ({ audits: 'https://sqs.us-east-1.amazonaws.com/123/audits-queue' }),
            }),
          },
        },
        sqs: {
          sendMessage: sandbox.stub().resolves(),
        },
      },
      agenticReportConfig: {
        name: 'agentic',
        tableName: 'aggregated_logs_example_consolidated',
      },
      auditContext: {},
      agenticReportHasData: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    clock = sinon.useFakeTimers({
      now: new Date('2026-04-30T12:00:00.000Z'),
      toFake: ['Date'],
    });
    runDailyAgenticExportStub = sandbox.stub().resolves({
      enabled: true,
      success: true,
      trafficDate: '2026-04-29',
    });
    generateReportingPeriodsStub = sandbox.stub().returns({
      weeks: [{
        startDate: new Date('2026-03-30T00:00:00.000Z'),
        endDate: new Date('2026-04-05T23:59:59.999Z'),
      }],
      periodIdentifier: 'w14-2026',
    });
    module = await esmock('../../../../src/cdn-logs-report/utils/agentic-db-export.js', {
      '../../../../src/cdn-logs-report/agentic-daily-export.js': {
        runDailyAgenticExport: runDailyAgenticExportStub,
      },
      '../../../../src/cdn-logs-report/utils/report-utils.js': {
        generateReportingPeriods: generateReportingPeriodsStub,
      },
    });
  });

  afterEach(() => {
    clock.restore();
    sandbox.restore();
  });

  it('skips when agentic report config is unavailable', async () => {
    const args = createArgs({ agenticReportConfig: null });

    const result = await module.runAgenticDbExports(args);

    expect(result).to.deep.equal({});
    expect(runDailyAgenticExportStub).to.not.have.been.called;
    expect(args.context.log.debug).to.have.been.calledWith(
      'Skipping agentic DB export for site-1: agentic report config not found',
    );
  });

  it('runs a single daily export for normal non-weekly report runs', async () => {
    const result = await module.runAgenticDbExports(createArgs());

    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-30T12:00:00.000Z');
    expect(result.dailyAgenticExport).to.deep.equal({
      enabled: true,
      success: true,
      trafficDate: '2026-04-29',
    });
  });

  it('captures single daily export failures without failing the caller', async () => {
    runDailyAgenticExportStub.rejects(new Error('daily export failed'));
    const args = createArgs({
      auditContext: { refreshAgenticDailyExport: true },
    });

    const result = await module.runAgenticDbExports(args);

    expect(args.context.log.error).to.have.been.calledWith(
      'Failed daily agentic export for site site-1: daily export failed',
      sinon.match.instanceOf(Error),
    );
    expect(result.dailyAgenticExport).to.deep.equal({
      enabled: true,
      success: false,
      siteId: 'site-1',
      error: 'daily export failed',
    });
  });

  it('passes a valid date-based run reference date through to the daily export', async () => {
    await module.runAgenticDbExports(createArgs({
      auditContext: {
        date: '2026-04-01T10:00:00.000Z',
      },
    }));

    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-01T10:00:00.000Z');
  });

  it('logs invalid date-based run input and falls back to the default daily export date', async () => {
    const args = createArgs({
      auditContext: {
        date: 'not-a-real-date',
      },
    });

    await module.runAgenticDbExports(args);

    expect(args.context.log.error).to.have.been.calledWith(
      'Invalid date in auditContext for site-1: not-a-real-date',
    );
    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-30T12:00:00.000Z');
  });

  it('skips normal weekly report runs without a refresh flag', async () => {
    const result = await module.runAgenticDbExports(createArgs({
      auditContext: { weekOffset: -1 },
    }));

    expect(result).to.deep.equal({});
    expect(runDailyAgenticExportStub).to.not.have.been.called;
  });

  it('treats null weekOffset as a non-weekly daily export run', async () => {
    const args = createArgs({
      auditContext: { weekOffset: null, refreshAgenticDailyExport: true },
    });

    const result = await module.runAgenticDbExports(args);

    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(args.context.dataAccess.Configuration.findLatest).to.not.have.been.called;
    expect(args.context.sqs.sendMessage).to.not.have.been.called;
    expect(result.dailyAgenticExport).to.deep.equal({
      enabled: true,
      success: true,
      trafficDate: '2026-04-29',
    });
  });

  it('skips weekly refreshes when the agentic report has no data', async () => {
    const args = createArgs({
      auditContext: { weekOffset: -1, refreshAgenticDailyExport: true },
      agenticReportHasData: false,
    });

    const result = await module.runAgenticDbExports(args);

    expect(result).to.deep.equal({});
    expect(runDailyAgenticExportStub).to.not.have.been.called;
    expect(args.context.log.info).to.have.been.calledWith(
      'Skipping weekly agentic DB exports for site-1: no agentic report data found',
    );
  });

  it('does not treat categoriesUpdated alone as a DB export trigger', async () => {
    const result = await module.runAgenticDbExports(createArgs({
      auditContext: { weekOffset: -1, categoriesUpdated: true },
    }));

    expect(result).to.deep.equal({});
    expect(runDailyAgenticExportStub).to.not.have.been.called;
  });

  it('queues seven date-based exports for completed weekly DB refreshes and keeps the singular result contract', async () => {
    const args = createArgs({
      auditContext: {
        weekOffset: -1,
        categoriesUpdated: true,
        refreshAgenticDailyExport: true,
      },
    });

    const result = await module.runAgenticDbExports(args);

    expect(runDailyAgenticExportStub).to.not.have.been.called;
    expect(args.context.sqs.sendMessage).to.have.callCount(7);
    expect(args.context.sqs.sendMessage.firstCall).to.have.been.calledWith(
      'https://sqs.us-east-1.amazonaws.com/123/audits-queue',
      {
        type: 'cdn-logs-report',
        siteId: 'site-1',
        auditContext: {
          date: '2026-03-31T00:00:00.000Z',
          refreshAgenticDailyExport: true,
          categoriesUpdated: true,
          sourceWeekOffset: -1,
        },
      },
      null,
      0,
    );
    expect(args.context.sqs.sendMessage.lastCall.args[1].auditContext.date)
      .to.equal('2026-04-06T00:00:00.000Z');
    expect(args.context.sqs.sendMessage.lastCall.args[3]).to.equal(30);
    expect(result.dailyAgenticExports).to.have.length(7);
    expect(result.dailyAgenticExport).to.deep.equal(result.dailyAgenticExports.at(-1));
    expect(args.context.log.info).to.have.been.calledWith(
      'Queueing weekly agentic DB exports for site-1: weekOffset=-1, trigger=refreshAgenticDailyExport, days=7',
    );
  });

  it('runs only completed current-week exports for BYOCDN refreshes', async () => {
    generateReportingPeriodsStub.returns({
      weeks: [{
        startDate: new Date('2026-04-27T00:00:00.000Z'),
        endDate: new Date('2026-05-03T23:59:59.999Z'),
      }],
      periodIdentifier: 'w18-2026',
    });
    const args = createArgs({
      auditContext: {
        weekOffset: 0,
        refreshAgenticDailyExport: true,
        triggeredBy: 'byocdn-other',
      },
    });

    const result = await module.runAgenticDbExports(args);

    expect(runDailyAgenticExportStub).to.not.have.been.called;
    expect(args.context.sqs.sendMessage).to.have.callCount(3);
    expect(args.context.sqs.sendMessage.firstCall.args[1].auditContext).to.deep.equal({
      date: '2026-04-28T00:00:00.000Z',
      refreshAgenticDailyExport: true,
      triggeredBy: 'byocdn-other',
      sourceWeekOffset: 0,
    });
    expect(args.context.sqs.sendMessage.lastCall.args[1].auditContext.date)
      .to.equal('2026-04-30T00:00:00.000Z');
    expect(result.dailyAgenticExports).to.have.length(3);
    expect(args.context.log.info).to.have.been.calledWith(
      'Queueing weekly agentic DB exports for site-1: weekOffset=0, trigger=byocdn-other, days=3',
    );
  });

  it('continues queueing when one date-based export message fails', async () => {
    const args = createArgs({
      auditContext: { weekOffset: -1, refreshAgenticDailyExport: true },
    });
    args.context.sqs.sendMessage.onCall(3).rejects(new Error('queue failed'));

    const result = await module.runAgenticDbExports(args);

    expect(args.context.sqs.sendMessage).to.have.callCount(7);
    expect(result.dailyAgenticExports).to.have.length(7);
    expect(result.dailyAgenticExports[3]).to.include({
      success: false,
      queued: false,
      error: 'queue failed',
    });
    expect(args.context.log.warn).to.have.been.calledWith(
      'Partial agentic DB export queueing failure for site-1: 1/7 days failed',
    );
  });

  it('does not forward invalid triggeredBy values to queued date-based exports', async () => {
    const args = createArgs({
      auditContext: {
        weekOffset: -1,
        refreshAgenticDailyExport: true,
        triggeredBy: 'bad\ntrigger',
      },
    });

    await module.runAgenticDbExports(args);

    expect(args.context.sqs.sendMessage.firstCall.args[1].auditContext).to.deep.equal({
      date: '2026-03-31T00:00:00.000Z',
      refreshAgenticDailyExport: true,
      sourceWeekOffset: -1,
    });
    expect(args.context.log.info).to.have.been.calledWith(
      'Queueing weekly agentic DB exports for site-1: weekOffset=-1, trigger=refreshAgenticDailyExport, days=7',
    );
  });

  it('captures Configuration lookup failures without failing weekly report results', async () => {
    const args = createArgs({
      auditContext: { weekOffset: -1, refreshAgenticDailyExport: true },
    });
    args.context.dataAccess.Configuration.findLatest.rejects(new Error('configuration unavailable'));

    const result = await module.runAgenticDbExports(args);

    expect(args.context.sqs.sendMessage).to.not.have.been.called;
    expect(args.context.log.error).to.have.been.calledWith(
      'Failed to resolve audit queue for site site-1: configuration unavailable',
      sinon.match.instanceOf(Error),
    );
    expect(result).to.deep.equal({
      dailyAgenticExport: {
        enabled: true,
        success: false,
        queued: false,
        siteId: 'site-1',
        error: 'configuration unavailable',
      },
      dailyAgenticExports: [],
    });
  });

  it('captures missing audit queue configuration without throwing', async () => {
    const args = createArgs({
      auditContext: { weekOffset: -1, refreshAgenticDailyExport: true },
    });
    args.context.dataAccess.Configuration.findLatest.resolves({
      getQueues: () => ({}),
    });

    const result = await module.runAgenticDbExports(args);

    expect(args.context.sqs.sendMessage).to.not.have.been.called;
    expect(args.context.log.error).to.have.been.calledWith(
      'Audit queue not configured for site site-1; skipping weekly DB export queueing',
    );
    expect(result).to.deep.equal({
      dailyAgenticExport: {
        enabled: true,
        success: false,
        queued: false,
        siteId: 'site-1',
        error: 'Audit queue not configured',
      },
      dailyAgenticExports: [],
    });
  });

  it('returns an empty weekly result when the reporting period has no week start', async () => {
    generateReportingPeriodsStub.returns({
      weeks: [],
      periodIdentifier: 'w14-2026',
    });
    const args = createArgs({
      auditContext: { weekOffset: -1, refreshAgenticDailyExport: true },
    });

    const result = await module.runAgenticDbExports(args);

    expect(runDailyAgenticExportStub).to.not.have.been.called;
    expect(args.context.dataAccess.Configuration.findLatest).to.not.have.been.called;
    expect(result.dailyAgenticExport).to.equal(null);
    expect(result.dailyAgenticExports).to.deep.equal([]);
  });
});
