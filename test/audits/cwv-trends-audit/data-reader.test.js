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

describe('CWV Trends Data Reader', () => {
  let sandbox;
  let getObjectFromKeyStub;
  let readTrendData;
  let formatDate;
  let subtractDays;
  let log;

  const sampleData = [
    { url: 'https://example.com/p1', metrics: [{ deviceType: 'mobile', pageviews: 5000 }] },
  ];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    getObjectFromKeyStub = sandbox.stub();
    log = { info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() };

    const module = await esmock('../../../src/cwv-trends-audit/data-reader.js', {
      '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
    });

    ({ readTrendData, formatDate, subtractDays } = module);
  });

  afterEach(() => { sandbox.restore(); });

  describe('formatDate', () => {
    it('formats a date as YYYY-MM-DD', () => {
      expect(formatDate(new Date('2025-11-15T00:00:00Z'))).to.equal('2025-11-15');
    });
  });

  describe('subtractDays', () => {
    it('subtracts days without mutating original', () => {
      const date = new Date('2025-11-15T00:00:00Z');
      const result = subtractDays(date, 7);
      expect(formatDate(result)).to.equal('2025-11-08');
      expect(formatDate(date)).to.equal('2025-11-15');
    });
  });

  describe('readTrendData', () => {
    it('reads data for the specified number of days', async () => {
      getObjectFromKeyStub.resolves(sampleData);
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 3, log);
      expect(result).to.have.lengthOf(3);
      expect(getObjectFromKeyStub).to.have.callCount(3);
    });

    it('returns results in chronological order', async () => {
      getObjectFromKeyStub.resolves(sampleData);
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 3, log);
      expect(result[0].date).to.equal('2025-11-26');
      expect(result[2].date).to.equal('2025-11-28');
    });

    it('skips dates with missing data', async () => {
      getObjectFromKeyStub.onFirstCall().resolves(sampleData).onSecondCall().resolves(null)
        .onThirdCall().resolves(sampleData);
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 3, log);
      expect(result).to.have.lengthOf(2);
      expect(log.warn).to.have.been.called;
    });

    it('handles JSON string response from S3', async () => {
      getObjectFromKeyStub.resolves(JSON.stringify(sampleData));
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(1);
      expect(result[0].data).to.deep.equal(sampleData);
    });

    it('skips invalid JSON strings', async () => {
      getObjectFromKeyStub.resolves('not-json');
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(0);
    });

    it('skips non-array responses', async () => {
      getObjectFromKeyStub.resolves({ notAnArray: true });
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(0);
    });

    it('returns empty array when all dates are missing', async () => {
      getObjectFromKeyStub.resolves(null);
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 3, log);
      expect(result).to.have.lengthOf(0);
    });

    it('handles getObjectFromKey rejecting', async () => {
      getObjectFromKeyStub.rejects(new Error('boom'));
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 2, log);
      expect(result).to.have.lengthOf(0);
      expect(log.warn).to.have.been.calledTwice;
    });

    it('constructs correct S3 keys', async () => {
      getObjectFromKeyStub.resolves(sampleData);
      await readTrendData('s3', 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(getObjectFromKeyStub).to.have.been.calledWith(
        's3', 'bucket',
        'metrics/cwv-trends/cwv-trends-daily-2025-11-28.json',
        log,
      );
    });

    it('rejects JSON data exceeding size limit', async () => {
      // Create a large JSON array (>15 MB)
      // Each entry with metrics is ~150 bytes, so 120,000 entries = ~18 MB
      const largeData = Array(120000).fill({
        url: 'https://example.com/page-with-a-longer-path-to-increase-size',
        metrics: [{
          deviceType: 'mobile', pageviews: 5000, lcp: 2000, cls: 0.08, inp: 180,
          bounceRate: 0.25, engagement: 0.75, clickRate: 0.60,
        }],
      });
      getObjectFromKeyStub.resolves(JSON.stringify(largeData));
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(0);
      expect(log.warn).to.have.been.calledWith(sinon.match(/exceeds size limit/));
    });

    it('accepts JSON data within size limit', async () => {
      // Create normal-sized data (~10 KB)
      const normalData = Array(10).fill(sampleData[0]);
      getObjectFromKeyStub.resolves(JSON.stringify(normalData));
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(1);
    });

    it('rejects already-parsed object exceeding size limit', async () => {
      // Create a large JSON array as already-parsed object (>15 MB)
      const largeData = Array(120000).fill({
        url: 'https://example.com/page-with-a-longer-path-to-increase-size',
        metrics: [{
          deviceType: 'mobile', pageviews: 5000, lcp: 2000, cls: 0.08, inp: 180,
          bounceRate: 0.25, engagement: 0.75, clickRate: 0.60,
        }],
      });
      // Pass already-parsed object (not string)
      getObjectFromKeyStub.resolves(largeData);
      const result = await readTrendData({}, 'bucket', new Date('2025-11-28T00:00:00Z'), 1, log);
      expect(result).to.have.lengthOf(0);
      expect(log.warn).to.have.been.calledWith(sinon.match(/exceeds size limit/));
    });
  });
});
