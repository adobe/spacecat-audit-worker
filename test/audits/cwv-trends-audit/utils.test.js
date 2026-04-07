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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('CWV Trends Audit Runner (utils.js)', () => {
  let sandbox;
  let cwvTrendsRunner;
  let parseEndDate;
  let readTrendDataStub;
  let log;

  function buildUrl(url, deviceType, overrides = {}) {
    return {
      url,
      metrics: [{
        deviceType,
        pageviews: 5000,
        bounceRate: 0.25,
        engagement: 0.75,
        clickRate: 0.60,
        lcp: 2000,
        cls: 0.08,
        inp: 180,
        ...overrides,
      }],
    };
  }

  function buildDays(dates, urls) {
    return dates.map((date) => ({ date, data: urls }));
  }

  function makeDates(count, start = '2025-11-01') {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  }

  function makeSite() {
    return {
      getId: () => 'site-1',
      getConfig: () => ({
        getHandlers: () => ({ 'cwv-trends-audit': {} }),
      }),
    };
  }

  function makeContext() {
    return { s3Client: {}, log, env: { S3_IMPORTER_BUCKET_NAME: 'bucket' } };
  }

  // Helper to get the mobile result (index 0) from the array
  function mobileResult(result) {
    return result.auditResult[0];
  }

  // Helper to get the desktop result (index 1) from the array
  function desktopResult(result) {
    return result.auditResult[1];
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    readTrendDataStub = sandbox.stub();
    log = { info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() };

    const module = await esmock('../../../src/cwv-trends-audit/utils.js', {
      '../../../src/cwv-trends-audit/data-reader.js': {
        readTrendData: readTrendDataStub,
        formatDate: (d) => d.toISOString().split('T')[0],
        subtractDays: (d, n) => { const r = new Date(d); r.setDate(r.getDate() - n); return r; },
      },
    });

    cwvTrendsRunner = module.default;
    parseEndDate = module.parseEndDate;
  });

  afterEach(() => { sandbox.restore(); });

  it('produces audit result as array with both mobile and desktop', async () => {
    const urls = [
      buildUrl('https://ex.com/p1', 'mobile'),
      buildUrl('https://ex.com/p2', 'desktop'),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult).to.be.an('array').with.lengthOf(2);
    expect(mobileResult(result)).to.have.all.keys('metadata', 'trendData', 'summary', 'urlDetails');
    expect(mobileResult(result).metadata.deviceType).to.equal('mobile');
    expect(desktopResult(result).metadata.deviceType).to.equal('desktop');
    expect(mobileResult(result).trendData).to.have.lengthOf(28);
    expect(result).to.have.property('fullAuditRef');
  });

  it('mobile result only contains mobile URLs', async () => {
    const urls = [
      buildUrl('https://ex.com/m', 'mobile'),
      buildUrl('https://ex.com/d', 'desktop'),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(mobileResult(result).urlDetails).to.have.lengthOf(1);
    expect(mobileResult(result).urlDetails[0].url).to.equal('https://ex.com/m');
    expect(desktopResult(result).urlDetails).to.have.lengthOf(1);
    expect(desktopResult(result).urlDetails[0].url).to.equal('https://ex.com/d');
  });

  it('filters URLs below MIN_PAGEVIEWS', async () => {
    const urls = [
      buildUrl('https://ex.com/high', 'mobile', { pageviews: 5000 }),
      buildUrl('https://ex.com/low', 'mobile', { pageviews: 500 }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(mobileResult(result).urlDetails).to.have.lengthOf(1);
    expect(mobileResult(result).urlDetails[0].url).to.equal('https://ex.com/high');
  });

  it('sorts URLs by pageviews descending with sequential IDs', async () => {
    const urls = [
      buildUrl('https://ex.com/low', 'mobile', { pageviews: 2000 }),
      buildUrl('https://ex.com/high', 'mobile', { pageviews: 8000 }),
      buildUrl('https://ex.com/mid', 'mobile', { pageviews: 5000 }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const details = mobileResult(result).urlDetails;

    expect(details[0].url).to.equal('https://ex.com/high');
    expect(details[0].id).to.equal('1');
    expect(details[1].url).to.equal('https://ex.com/mid');
    expect(details[1].id).to.equal('2');
    expect(details[2].url).to.equal('https://ex.com/low');
    expect(details[2].id).to.equal('3');
  });

  it('includes CWV status (good/needsImprovement/poor) per URL in urlDetails', async () => {
    const urls = [
      buildUrl('https://ex.com/good', 'mobile', { pageviews: 5000, lcp: 2000, cls: 0.05, inp: 100 }),
      buildUrl('https://ex.com/ni', 'mobile', { pageviews: 4000, lcp: 3000, cls: 0.15, inp: 300 }),
      buildUrl('https://ex.com/poor', 'mobile', { pageviews: 3000, lcp: 5000, cls: 0.30, inp: 600 }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const details = mobileResult(result).urlDetails;

    expect(details[0].status).to.equal('good');
    expect(details[1].status).to.equal('needsImprovement');
    expect(details[2].status).to.equal('poor');
  });

  it('filters out URLs when all CWV metrics are null', async () => {
    const urls = [
      buildUrl('https://ex.com/no-cwv', 'mobile', {
        pageviews: 5000, lcp: null, cls: null, inp: null,
      }),
      buildUrl('https://ex.com/good', 'mobile', {
        pageviews: 4000, lcp: 2000, cls: 0.05, inp: 100,
      }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    // URL with no CWV data should be filtered out
    expect(mobileResult(result).urlDetails).to.have.lengthOf(1);
    expect(mobileResult(result).urlDetails[0].url).to.equal('https://ex.com/good');
  });

  it('converts bounceRate, engagement, clickRate to percentages', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, bounceRate: 0.253, engagement: 0.785, clickRate: 0.760,
    })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const d = mobileResult(result).urlDetails[0];

    expect(d.bounceRate).to.equal(25.3);
    expect(d.engagement).to.equal(78.5);
    expect(d.clickRate).to.equal(76);
  });

  it('handles null percentage fields', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, bounceRate: null, engagement: null, clickRate: null,
    })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const d = mobileResult(result).urlDetails[0];

    expect(d.bounceRate).to.equal(0);
    expect(d.engagement).to.equal(0);
    expect(d.clickRate).to.equal(0);
  });

  it('handles null non-percentage fields', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, lcp: null, cls: 0.08, inp: 180,
    })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const d = mobileResult(result).urlDetails[0];

    expect(d.lcp).to.equal(0);
    expect(d.lcpChange).to.equal(0);
  });

  it('counts CWV categories per day in trendData', async () => {
    const urls = [
      buildUrl('https://ex.com/good', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 }),
      buildUrl('https://ex.com/poor', 'mobile', { pageviews: 3000, lcp: 5000, cls: 0.30, inp: 600 }),
      buildUrl('https://ex.com/ni', 'mobile', { pageviews: 2000, lcp: 3000, cls: 0.15, inp: 300 }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const t = mobileResult(result).trendData[0];

    expect(t.good).to.equal(1);
    expect(t.needsImprovement).to.equal(1);
    expect(t.poor).to.equal(1);
  });

  it('builds summary with current and previous week comparison', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const { summary } = mobileResult(result);

    expect(summary.good).to.have.all.keys('current', 'previous', 'change', 'percentageChange', 'status');
    expect(summary.good.status).to.equal('good');
    expect(summary.needsImprovement.status).to.equal('needsImprovement');
    expect(summary.poor.status).to.equal('poor');
    expect(summary.totalUrls).to.equal(1);
  });

  it('fails when no S3 data is found', async () => {
    readTrendDataStub.resolves([]);

    try {
      await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
      expect.fail('Should have thrown error');
    } catch (err) {
      expect(err.message).to.include('Insufficient data');
      expect(err.message).to.include('0 days found');
      expect(err.message).to.include('28 required');
    }
  });

  it('excludes URLs that only have undefined device type metrics', async () => {
    const urls = [buildUrl('https://ex.com/p', 'undefined', { pageviews: 5000 })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    // URLs with 'undefined' device type don't match mobile or desktop
    expect(mobileResult(result).urlDetails).to.have.lengthOf(0);
    expect(desktopResult(result).urlDetails).to.have.lengthOf(0);
  });

  it('filters URLs with all null CWV metrics', async () => {
    const urls = [
      buildUrl('https://ex.com/nulls', 'mobile', { lcp: null, cls: null, inp: null }),
      buildUrl('https://ex.com/good', 'mobile', { pageviews: 3000, lcp: 2000, cls: 0.05, inp: 100 }),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    // URL with all null metrics should be filtered out
    expect(mobileResult(result).urlDetails).to.have.lengthOf(1);
    expect(mobileResult(result).urlDetails[0].url).to.equal('https://ex.com/good');
    expect(mobileResult(result).trendData[0].good).to.equal(1);
    expect(mobileResult(result).trendData[0].poor).to.equal(0);
  });

  it('skips invalid URLs', async () => {
    const urls = [
      { url: 'not-a-url', metrics: [{ deviceType: 'mobile', pageviews: 5000, lcp: 2000, cls: 0.08, inp: 180 }] },
      { url: '', metrics: [{ deviceType: 'mobile', pageviews: 5000, lcp: 2000, cls: 0.08, inp: 180 }] },
      { url: null, metrics: [{ deviceType: 'mobile', pageviews: 5000, lcp: 2000, cls: 0.08, inp: 180 }] },
      buildUrl('https://ex.com/valid', 'mobile'),
    ];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(mobileResult(result).urlDetails).to.have.lengthOf(1);
    expect(mobileResult(result).urlDetails[0].url).to.equal('https://ex.com/valid');
    expect(log.warn).to.have.been.calledWith(sinon.match(/invalid URL/i));
  });

  it('computes change as point-to-point (current day vs 7 days before)', async () => {
    const prev = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 4000, lcp: 2000, bounceRate: 0.30, engagement: 0.70, clickRate: 0.50,
      cls: 0.10, inp: 200,
    })];
    const curr = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 6000, lcp: 2500, bounceRate: 0.20, engagement: 0.80, clickRate: 0.60,
      cls: 0.05, inp: 150,
    })];

    const dailyData = [];
    // Days 0-20: previous values
    for (let i = 0; i < 21; i += 1) {
      const d = new Date('2025-11-01'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: prev });
    }
    // Days 21-27: current values
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-22'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: curr });
    }
    readTrendDataStub.resolves(dailyData);

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const detail = mobileResult(result).urlDetails[0];

    // Point-to-point: day 27 (curr) - day 20 (prev)
    expect(detail.pageviewsChange).to.equal(2000);
    expect(detail.lcpChange).to.equal(500);
    expect(detail.bounceRateChange).to.equal(-10);
  });

  it('fails when less than 28 days of data', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(makeDates(20), urls));

    try {
      await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
      expect.fail('Should have thrown error');
    } catch (err) {
      expect(err.message).to.include('Insufficient data');
      expect(err.message).to.include('20 days found');
      expect(err.message).to.include('28 required');
    }
  });

  it('handles percentage change when previous is 0 and current is 0', async () => {
    const urlsDay1 = [buildUrl('https://ex.com/poor', 'mobile', { lcp: 5000, cls: 0.30, inp: 600 })];
    const urlsDay2 = [buildUrl('https://ex.com/poor', 'mobile', { lcp: 5000, cls: 0.30, inp: 600 })];

    const dailyData = [];
    for (let i = 0; i < 21; i += 1) {
      const d = new Date('2025-11-01'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: urlsDay1 });
    }
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-22'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: urlsDay2 });
    }
    readTrendDataStub.resolves(dailyData);

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const { summary } = mobileResult(result);

    expect(summary.good.current).to.equal(0);
    expect(summary.good.previous).to.equal(0);
    expect(summary.good.percentageChange).to.equal(0);
  });

  it('handles percentage change when previous is 0 and current is not 0', async () => {
    const urlsDay1 = [buildUrl('https://ex.com/poor', 'mobile', { lcp: 5000, cls: 0.30, inp: 600 })];
    const urlsDay2 = [buildUrl('https://ex.com/good', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 })];

    const dailyData = [];
    for (let i = 0; i < 21; i += 1) {
      const d = new Date('2025-11-01'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: urlsDay1 });
    }
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-22'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: urlsDay2 });
    }
    readTrendDataStub.resolves(dailyData);

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const { summary } = mobileResult(result);

    expect(summary.good.current).to.equal(1);
    expect(summary.good.previous).to.equal(0);
    expect(summary.good.percentageChange).to.equal(100);
  });

  it('handles summary with less than 8 days of data (uses day 0 as previous)', async () => {
    const urls = [buildUrl('https://ex.com/good', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 })];

    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const { summary } = mobileResult(result);

    // Should compare day 27 to day 20
    expect(summary.good.current).to.equal(1);
    expect(summary.good.previous).to.equal(1);
    expect(summary.good.change).to.equal(0);
  });

  it('uses custom endDate from auditContext when provided', async () => {
    const dates = makeDates(28, '2026-02-28');
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(dates, urls));

    const site = makeSite();
    const context = makeContext();
    const auditContext = { endDate: '2026-03-27' };

    const result = await cwvTrendsRunner('https://ex.com', context, site, auditContext);

    expect(mobileResult(result).metadata.endDate).to.equal('2026-03-27');
    expect(mobileResult(result).metadata.startDate).to.equal('2026-02-28');
  });

  it('uses current date when auditContext.endDate is not provided', async () => {
    const testDate = new Date('2026-03-24');
    const testDateStr = '2026-03-24';
    const dates = makeDates(28, '2026-02-25');
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(dates, urls));

    const site = makeSite();
    const context = makeContext();

    const OriginalDate = global.Date;
    global.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          return testDate;
        }
        return new OriginalDate(...args);
      }
    };
    global.Date.UTC = OriginalDate.UTC;

    try {
      const result = await cwvTrendsRunner('https://ex.com', context, site);

      expect(mobileResult(result).metadata.endDate).to.equal(testDateStr);
      expect(mobileResult(result).metadata.startDate).to.equal('2026-02-25');
    } finally {
      global.Date = OriginalDate;
    }
  });

  it('uses current date when auditContext.endDate is invalid', async () => {
    const testDate = new Date('2026-03-24');
    const testDateStr = '2026-03-24';
    const dates = makeDates(28, '2026-02-25');
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(dates, urls));

    const site = makeSite();
    const context = makeContext();
    const auditContext = { endDate: 'invalid-date' };

    const OriginalDate = global.Date;
    global.Date = class extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          return testDate;
        }
        return new OriginalDate(...args);
      }
    };
    global.Date.UTC = OriginalDate.UTC;

    try {
      const result = await cwvTrendsRunner('https://ex.com', context, site, auditContext);

      expect(mobileResult(result).metadata.endDate).to.equal(testDateStr);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Invalid endDate format "invalid-date"/),
      );
    } finally {
      global.Date = OriginalDate;
    }
  });

  it('parseEndDate handles Date objects that return NaN', () => {
    const now = new Date();

    const originalDateUTC = Date.UTC;
    const dateUTCStub = sandbox.stub(Date, 'UTC').callsFake((year, month, day) => {
      if (year === 9999 && month === 11 && day === 31) {
        return 8640000000000001;
      }
      return originalDateUTC(year, month, day);
    });

    const result = parseEndDate('9999-12-31', log);

    const diffMs = Math.abs(result - now);
    expect(diffMs).to.be.lessThan(5000);
    expect(log.warn).to.have.been.calledWith(
      sinon.match(/Invalid endDate "9999-12-31"/),
    );

    dateUTCStub.restore();
  });

});

describe('CWV Trends Audit Runner (utils.js) - Edge Cases', function () {
  this.timeout(5000);
  let sandbox;
  let cwvTrendsRunner;
  let readTrendDataStub;
  let log;

  before(async () => {
    sandbox = sinon.createSandbox();
    readTrendDataStub = sandbox.stub();
    log = { info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() };

    // Mock with TREND_DAYS = 7 to test the len < 8 branch
    const module = await esmock('../../../src/cwv-trends-audit/utils.js', {
      '../../../src/cwv-trends-audit/constants.js': {
        MIN_PAGEVIEWS: 1000,
        TREND_DAYS: 7,
        S3_BASE_PATH: 'metrics',
        DEFAULT_DEVICE_TYPE: 'mobile',
        DEVICE_TYPES: ['mobile', 'desktop'],
        AUDIT_TYPE: 'cwv-trends-audit',
      },
      '../../../src/cwv-trends-audit/data-reader.js': {
        readTrendData: readTrendDataStub,
        formatDate: (d) => d.toISOString().split('T')[0],
        subtractDays: (d, n) => { const r = new Date(d); r.setDate(r.getDate() - n); return r; },
      },
    });

    cwvTrendsRunner = module.default;
  });

  afterEach(() => {
    readTrendDataStub.reset();
    log.info.resetHistory();
    log.warn.resetHistory();
    log.error.resetHistory();
  });

  after(() => { sandbox.restore(); });

  it('uses day 0 as previous when less than 8 days of trend data', async () => {
    const urls = [{
      url: 'https://ex.com/p1',
      metrics: [{
        deviceType: 'mobile',
        pageviews: 5000,
        bounceRate: 0.25,
        engagement: 0.75,
        clickRate: 0.60,
        lcp: 2000,
        cls: 0.08,
        inp: 180,
      }],
    }];

    // Create exactly 7 days of data
    const dailyData = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-22');
      d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: urls });
    }

    readTrendDataStub.resolves(dailyData);

    const site = {
      getId: () => 'site-1',
      getConfig: () => ({
        getHandlers: () => ({ 'cwv-trends-audit': {} }),
      }),
    };

    const result = await cwvTrendsRunner('https://ex.com', {
      s3Client: {}, log, env: { S3_IMPORTER_BUCKET_NAME: 'bucket' },
    }, site);

    // Mobile result (index 0) — with 7 days (< 8), should compare day 6 (last) to day 0 (first)
    const mobile = result.auditResult[0];
    expect(mobile.summary.good.current).to.equal(1);
    expect(mobile.summary.good.previous).to.equal(1);
    expect(mobile.summary.good.change).to.equal(0);
  });
});
