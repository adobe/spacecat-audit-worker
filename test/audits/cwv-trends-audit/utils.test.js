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

  function makeSite(handlerConfig = {}) {
    return {
      getId: () => 'site-1',
      getConfig: () => ({
        getHandlers: () => ({ 'cwv-trends-audit': handlerConfig }),
      }),
    };
  }

  function makeContext() {
    return { s3Client: {}, log, env: { S3_IMPORTER_BUCKET_NAME: 'bucket' } };
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
  });

  afterEach(() => { sandbox.restore(); });

  it('produces audit result with correct structure', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult).to.have.all.keys('metadata', 'trendData', 'summary', 'urlDetails');
    expect(result.auditResult.metadata.deviceType).to.equal('mobile');
    expect(result.auditResult.trendData).to.have.lengthOf(28);
    expect(result).to.have.property('fullAuditRef');
  });

  it('reads device type from site config', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'desktop')];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner(
      'https://ex.com',
      makeContext(),
      makeSite({ deviceType: 'desktop' }),
    );

    expect(result.auditResult.metadata.deviceType).to.equal('desktop');
    expect(result.auditResult.urlDetails).to.have.lengthOf(1);
  });

  it('defaults to mobile when config has no deviceType', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.metadata.deviceType).to.equal('mobile');
  });

  it('defaults to mobile when site has no config', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const site = { getId: () => 'site-1', getConfig: () => null };
    const result = await cwvTrendsRunner('https://ex.com', makeContext(), site);

    expect(result.auditResult.metadata.deviceType).to.equal('mobile');
  });

  it('defaults to mobile when getConfig is undefined', async () => {
    const urls = [buildUrl('https://ex.com/p1', 'mobile')];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const site = { getId: () => 'site-1' };
    const result = await cwvTrendsRunner('https://ex.com', makeContext(), site);

    expect(result.auditResult.metadata.deviceType).to.equal('mobile');
  });

  it('filters URLs by device type', async () => {
    const urls = [
      buildUrl('https://ex.com/m', 'mobile'),
      buildUrl('https://ex.com/d', 'desktop'),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.urlDetails).to.have.lengthOf(1);
    expect(result.auditResult.urlDetails[0].url).to.equal('https://ex.com/m');
  });

  it('filters URLs below MIN_PAGEVIEWS', async () => {
    const urls = [
      buildUrl('https://ex.com/high', 'mobile', { pageviews: 5000 }),
      buildUrl('https://ex.com/low', 'mobile', { pageviews: 500 }),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.urlDetails).to.have.lengthOf(1);
    expect(result.auditResult.urlDetails[0].url).to.equal('https://ex.com/high');
  });

  it('sorts URLs by pageviews descending with sequential IDs', async () => {
    const urls = [
      buildUrl('https://ex.com/low', 'mobile', { pageviews: 2000 }),
      buildUrl('https://ex.com/high', 'mobile', { pageviews: 8000 }),
      buildUrl('https://ex.com/mid', 'mobile', { pageviews: 5000 }),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.urlDetails[0].url).to.equal('https://ex.com/high');
    expect(result.auditResult.urlDetails[0].id).to.equal('1');
    expect(result.auditResult.urlDetails[1].url).to.equal('https://ex.com/mid');
    expect(result.auditResult.urlDetails[1].id).to.equal('2');
    expect(result.auditResult.urlDetails[2].url).to.equal('https://ex.com/low');
    expect(result.auditResult.urlDetails[2].id).to.equal('3');
  });

  it('includes CWV status (good/needsImprovement/poor) per URL in urlDetails', async () => {
    const urls = [
      buildUrl('https://ex.com/good', 'mobile', { pageviews: 5000, lcp: 2000, cls: 0.05, inp: 100 }),
      buildUrl('https://ex.com/ni', 'mobile', { pageviews: 4000, lcp: 3000, cls: 0.15, inp: 300 }),
      buildUrl('https://ex.com/poor', 'mobile', { pageviews: 3000, lcp: 5000, cls: 0.30, inp: 600 }),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const details = result.auditResult.urlDetails;

    expect(details[0].status).to.equal('good');
    expect(details[1].status).to.equal('needsImprovement');
    expect(details[2].status).to.equal('poor');
  });

  it('sets status to null when all CWV metrics are null', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, lcp: null, cls: null, inp: null,
    })];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.urlDetails[0].status).to.be.null;
  });

  it('converts bounceRate, engagement, clickRate to percentages', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, bounceRate: 0.253, engagement: 0.785, clickRate: 0.760,
    })];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const d = result.auditResult.urlDetails[0];

    expect(d.bounceRate).to.equal(25.3);
    expect(d.engagement).to.equal(78.5);
    expect(d.clickRate).to.equal(76);
  });

  it('handles null percentage fields', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 5000, bounceRate: null, engagement: null, clickRate: null,
    })];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const d = result.auditResult.urlDetails[0];

    expect(d.bounceRate).to.be.null;
    expect(d.engagement).to.be.null;
    expect(d.clickRate).to.be.null;
  });

  it('counts CWV categories per day in trendData', async () => {
    const urls = [
      buildUrl('https://ex.com/good', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 }),
      buildUrl('https://ex.com/poor', 'mobile', { pageviews: 3000, lcp: 5000, cls: 0.30, inp: 600 }),
      buildUrl('https://ex.com/ni', 'mobile', { pageviews: 2000, lcp: 3000, cls: 0.15, inp: 300 }),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const t = result.auditResult.trendData[0];

    expect(t.good).to.equal(1);
    expect(t.needsImprovement).to.equal(1);
    expect(t.poor).to.equal(1);
  });

  it('builds summary with current and previous week comparison', async () => {
    const urls = [buildUrl('https://ex.com/p', 'mobile', { lcp: 2000, cls: 0.05, inp: 100 })];
    readTrendDataStub.resolves(buildDays(makeDates(28), urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const { summary } = result.auditResult;

    expect(summary.good).to.have.all.keys('current', 'previous', 'change', 'percentageChange', 'status');
    expect(summary.good.status).to.equal('good');
    expect(summary.needsImprovement.status).to.equal('needsImprovement');
    expect(summary.poor.status).to.equal('poor');
    expect(summary.totalUrls).to.equal(1);
  });

  it('returns empty result when no S3 data', async () => {
    readTrendDataStub.resolves([]);

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.trendData).to.deep.equal([]);
    expect(result.auditResult.urlDetails).to.deep.equal([]);
    expect(result.auditResult.summary.totalUrls).to.equal(0);
    expect(log.warn).to.have.been.calledWith(sinon.match(/No S3 data found/));
  });

  it('skips URLs with undefined device type', async () => {
    const urls = [buildUrl('https://ex.com/p', 'undefined', { pageviews: 5000 })];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const site = {
      getId: () => 'site-1',
      getConfig: () => ({
        getHandlers: () => ({ 'cwv-trends-audit': { deviceType: 'undefined' } }),
      }),
    };
    const result = await cwvTrendsRunner('https://ex.com', makeContext(), site);

    expect(result.auditResult.urlDetails).to.have.lengthOf(0);
    expect(log.warn).to.have.been.calledWith(sinon.match(/undefined device type/));
  });

  it('handles null CWV metrics in categorization', async () => {
    const urls = [
      buildUrl('https://ex.com/nulls', 'mobile', { lcp: null, cls: null, inp: null }),
      buildUrl('https://ex.com/good', 'mobile', { pageviews: 3000, lcp: 2000, cls: 0.05, inp: 100 }),
    ];
    readTrendDataStub.resolves(buildDays(['2025-11-28'], urls));

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());

    expect(result.auditResult.urlDetails).to.have.lengthOf(2);
    expect(result.auditResult.trendData[0].good).to.equal(1);
    expect(result.auditResult.trendData[0].poor).to.equal(0);
  });

  it('computes change as current week avg minus previous week avg', async () => {
    const prev = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 4000, lcp: 2000, bounceRate: 0.30, engagement: 0.70, clickRate: 0.50,
      cls: 0.10, inp: 200,
    })];
    const curr = [buildUrl('https://ex.com/p', 'mobile', {
      pageviews: 6000, lcp: 2500, bounceRate: 0.20, engagement: 0.80, clickRate: 0.60,
      cls: 0.05, inp: 150,
    })];

    const dailyData = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-14'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: prev });
    }
    for (let i = 0; i < 7; i += 1) {
      const d = new Date('2025-11-21'); d.setDate(d.getDate() + i);
      dailyData.push({ date: d.toISOString().split('T')[0], data: curr });
    }
    readTrendDataStub.resolves(dailyData);

    const result = await cwvTrendsRunner('https://ex.com', makeContext(), makeSite());
    const detail = result.auditResult.urlDetails[0];

    expect(detail.pageviewsChange).to.equal(2000);
    expect(detail.lcpChange).to.equal(500);
    expect(detail.bounceRateChange).to.equal(-10);
  });
});
