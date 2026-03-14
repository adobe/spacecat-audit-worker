/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/* eslint-env mocha */

import { expect } from 'chai';
import sinon from 'sinon';
import { runDbOnlyDailyAgenticExport } from '../../../src/cdn-logs-report/utils/db-only-export-runner.js';

describe('DB-only export runner', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs a single day when date is provided', async () => {
    const runDailyExport = sandbox.stub().callsFake(async (date) => ({
      enabled: true,
      success: true,
      siteId: 'site-1',
      trafficDate: date.toISOString().split('T')[0],
      rowCount: 10,
      delivery: { source: 'db-endpoints' },
    }));

    const result = await runDbOnlyDailyAgenticExport({
      auditContext: { date: '2026-01-11' },
      siteId: 'site-1',
      log,
      runDailyExport,
    });

    sinon.assert.calledOnce(runDailyExport);
    expect(result).to.include({
      mode: 'single',
      success: true,
      fromDate: '2026-01-11',
      toDate: '2026-01-11',
      siteId: 'site-1',
    });
    expect(result.runs).to.have.length(1);
    expect(result.runs[0].trafficDate).to.equal('2026-01-11');
  });

  it('runs all days in an inclusive range', async () => {
    const runDailyExport = sandbox.stub().callsFake(async (date) => ({
      enabled: true,
      success: true,
      siteId: 'site-1',
      trafficDate: date.toISOString().split('T')[0],
      rowCount: 1,
      delivery: { source: 'db-endpoints' },
    }));

    const result = await runDbOnlyDailyAgenticExport({
      auditContext: {
        fromDate: '2026-01-09',
        toDate: '2026-01-11',
      },
      siteId: 'site-1',
      log,
      runDailyExport,
    });

    sinon.assert.callCount(runDailyExport, 3);
    expect(result.mode).to.equal('range');
    expect(result.success).to.equal(true);
    expect(result.runs.map((r) => r.trafficDate)).to.deep.equal([
      '2026-01-09',
      '2026-01-10',
      '2026-01-11',
    ]);
  });

  it('marks the whole run failed when one day fails', async () => {
    const runDailyExport = sandbox.stub()
      .onCall(0).resolves({
        enabled: true,
        success: true,
        siteId: 'site-1',
        trafficDate: '2026-01-09',
        rowCount: 5,
        delivery: { source: 'db-endpoints' },
      })
      .onCall(1).rejects(new Error('downstream failed'))
      .onCall(2).resolves({
        enabled: true,
        success: true,
        siteId: 'site-1',
        trafficDate: '2026-01-11',
        rowCount: 5,
        delivery: { source: 'db-endpoints' },
      });

    const result = await runDbOnlyDailyAgenticExport({
      auditContext: {
        fromDate: '2026-01-09',
        toDate: '2026-01-11',
      },
      siteId: 'site-1',
      log,
      runDailyExport,
    });

    expect(result.success).to.equal(false);
    expect(result.runs).to.have.length(3);
    expect(result.runs[1]).to.include({
      success: false,
      trafficDate: '2026-01-10',
      rowCount: 0,
    });
    expect(result.runs[1].error).to.equal('downstream failed');
    sinon.assert.calledOnce(log.error);
  });

  it('throws on invalid date range', async () => {
    try {
      await runDbOnlyDailyAgenticExport({
        auditContext: {
          fromDate: '2026-01-11',
          toDate: '2026-01-09',
        },
        siteId: 'site-1',
        log,
        runDailyExport: async () => ({}),
      });
      expect.fail('Expected an error for invalid date range');
    } catch (error) {
      expect(error.message).to.equal('Invalid date range: fromDate must be less than or equal to toDate');
    }
  });
});
