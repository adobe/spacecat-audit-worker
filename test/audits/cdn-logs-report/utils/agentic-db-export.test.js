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
  let module;

  function createArgs(overrides = {}) {
    return {
      athenaClient: {},
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
      },
      agenticReportConfig: {
        name: 'agentic',
        tableName: 'aggregated_logs_example_consolidated',
      },
      auditContext: {},
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
    module = await esmock('../../../../src/cdn-logs-report/utils/agentic-db-export.js', {
      '../../../../src/cdn-logs-report/agentic-daily-export.js': {
        runDailyAgenticExport: runDailyAgenticExportStub,
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

  it('runs a single daily export for yesterday on a normal (no-date) run', async () => {
    const result = await module.runAgenticDbExports(createArgs());

    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    // No auditContext.date → reference date defaults to now (worker exports yesterday).
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-30T12:00:00.000Z');
    expect(result.dailyAgenticExport).to.deep.equal({
      enabled: true,
      success: true,
      trafficDate: '2026-04-29',
    });
  });

  it('passes a valid date-based reference date through to the daily export', async () => {
    await module.runAgenticDbExports(createArgs({
      auditContext: { date: '2026-04-01T10:00:00.000Z' },
    }));

    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-01T10:00:00.000Z');
  });

  it('logs invalid date input and falls back to the default reference date', async () => {
    const args = createArgs({ auditContext: { date: 'not-a-real-date' } });

    await module.runAgenticDbExports(args);

    expect(args.context.log.error).to.have.been.calledWith(
      'Invalid date in auditContext for site-1: not-a-real-date',
    );
    expect(runDailyAgenticExportStub).to.have.been.calledOnce;
    expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
      .to.equal('2026-04-30T12:00:00.000Z');
  });

  it('captures daily export failures without failing the caller', async () => {
    runDailyAgenticExportStub.rejects(new Error('daily export failed'));
    const args = createArgs();

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

  describe('weekly agentic rollup on empty Sunday export', () => {
    // 2026-04-26 is a Sunday; its ISO week runs Mon 2026-04-20 .. Sun 2026-04-26.
    const SUNDAY = '2026-04-26';
    const WEEK_START = '2026-04-20';
    const WEEK_END = '2026-04-26';

    function withPostgrest(args, rpc) {
      args.context.dataAccess = { services: { postgrestClient: { rpc } } };
      return args;
    }

    it('triggers the weekly rollup RPC when the Sunday export is skipped', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, skipped: true, trafficDate: SUNDAY, rowCount: 0,
      });
      const rpc = sandbox.stub().resolves({ data: [{ rows_inserted: 5 }], error: null });
      const args = withPostgrest(createArgs(), rpc);

      const result = await module.runAgenticDbExports(args);

      expect(rpc).to.have.been.calledOnceWith('wrpc_refresh_agentic_traffic_weekly', {
        p_site_id: 'site-1',
        p_start_date: WEEK_START,
        p_end_date: WEEK_END,
        p_updated_by: 'audit-worker:cdn-logs-report-weekly-refresh',
      });
      expect(result.weeklyAgenticRefresh).to.deep.equal({
        success: true, weekStart: WEEK_START, weekEnd: WEEK_END,
      });
      expect(args.context.log.info).to.have.been.calledWith(
        'Triggered weekly agentic rollup for site-1 (2026-04-20..2026-04-26) after empty Sunday export',
      );
    });

    it('does not trigger the weekly rollup when a non-Sunday export is skipped', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, skipped: true, trafficDate: '2026-04-29', rowCount: 0,
      });
      const rpc = sandbox.stub();
      const args = withPostgrest(createArgs(), rpc);

      const result = await module.runAgenticDbExports(args);

      expect(rpc).to.not.have.been.called;
      expect(result.weeklyAgenticRefresh).to.equal(undefined);
    });

    it('does not trigger the weekly rollup when the Sunday export has data', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, trafficDate: SUNDAY, batchId: 'batch-1',
      });
      const rpc = sandbox.stub();
      const args = withPostgrest(createArgs(), rpc);

      const result = await module.runAgenticDbExports(args);

      expect(rpc).to.not.have.been.called;
      expect(result.weeklyAgenticRefresh).to.equal(undefined);
    });

    it('skips the weekly rollup when the PostgREST client is unavailable', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, skipped: true, trafficDate: SUNDAY, rowCount: 0,
      });
      const args = createArgs();

      const result = await module.runAgenticDbExports(args);

      expect(result.weeklyAgenticRefresh).to.deep.equal({
        success: false, error: 'postgrest-client-unavailable',
      });
      expect(args.context.log.warn).to.have.been.calledWith(
        'Skipping weekly agentic rollup for site-1: PostgREST client unavailable',
      );
    });

    it('records an RPC error without failing the caller', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, skipped: true, trafficDate: SUNDAY, rowCount: 0,
      });
      const rpc = sandbox.stub().resolves({ data: null, error: { message: 'boom' } });
      const args = withPostgrest(createArgs(), rpc);

      const result = await module.runAgenticDbExports(args);

      expect(result.weeklyAgenticRefresh).to.deep.equal({
        success: false, weekStart: WEEK_START, weekEnd: WEEK_END, error: 'boom',
      });
      expect(args.context.log.error).to.have.been.calledWith(
        'Failed weekly agentic rollup for site-1 (2026-04-20..2026-04-26): boom',
      );
    });

    it('catches a thrown RPC error without failing the caller', async () => {
      runDailyAgenticExportStub.resolves({
        enabled: true, success: true, skipped: true, trafficDate: SUNDAY, rowCount: 0,
      });
      const rpc = sandbox.stub().rejects(new Error('network down'));
      const args = withPostgrest(createArgs(), rpc);

      const result = await module.runAgenticDbExports(args);

      expect(result.weeklyAgenticRefresh).to.deep.equal({
        success: false, weekStart: WEEK_START, weekEnd: WEEK_END, error: 'network down',
      });
      expect(args.context.log.error).to.have.been.calledWith(
        'Failed weekly agentic rollup for site-1 (2026-04-20..2026-04-26): network down',
        sinon.match.instanceOf(Error),
      );
    });
  });
});
