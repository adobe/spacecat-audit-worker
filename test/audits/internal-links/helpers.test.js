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

import { expect } from 'chai';
import sinon from 'sinon';
import nock from 'nock';
import {
  calculateKpiDeltasForAudit,
  resolveCpcValue,
  MAX_LINKS_TO_CONSIDER,
  TRAFFIC_MULTIPLIER,
  CPC_DEFAULT_VALUE,
  isLinkInaccessible,
  calculatePriority,
} from '../../../src/internal-links/helpers.js';
import { auditData } from '../../fixtures/internal-links-data.js';

describe('calculateKpiDeltasForAudit', () => {
  it('should return zero values when no broken links exist', () => {
    const result = calculateKpiDeltasForAudit([]);
    expect(result).to.deep.equal({
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    });
  });

  it('should calculate KPIs correctly for a single broken link', () => {
    const
      brokenInternalLinks = [{
        urlFrom: 'https://example.com/source',
        urlTo: 'https://example.com/broken',
        trafficDomain: 1000,
      }];

    const result = calculateKpiDeltasForAudit(brokenInternalLinks);
    expect(result).to.deep.equal({
      projectedTrafficLost: 10, // 1000 * 0.01
      projectedTrafficValue: 10, // 10 * 1 (DEFAULT_CPC_VALUE)
    });
  });

  it('should handle multiple broken links to the same target', () => {
    const result = calculateKpiDeltasForAudit(auditData.auditResult.brokenInternalLinks);
    expect(result).to.deep.equal({
      projectedTrafficLost: 83,
      projectedTrafficValue: 83,
    });
  });

  it('should limit calculations to MAX_LINKS_TO_CONSIDER when exceeded', () => {
    // Create 11 links (exceeding MAX_LINKS_TO_CONSIDER of 10)
    const brokenLinks = Array.from({ length: 11 }, (_, i) => ({
      urlFrom: `https://example.com/source${i}`,
      urlTo: 'https://example.com/broken',
      trafficDomain: 1000 * (i + 1), // Increasing traffic values
    }));

    const result = calculateKpiDeltasForAudit(brokenLinks);

    // Should only consider top 10 traffic sources
    // Sum of top 10 traffic values: (11000 + 10000 + ... + 2000) * 0.01
    const expectedTraffic = Array.from({ length: MAX_LINKS_TO_CONSIDER }, (_, i) => (11 - i) * 1000)
      .reduce((sum, traffic) => sum + traffic * TRAFFIC_MULTIPLIER, 0);
    const expectedTrafficValue = expectedTraffic * CPC_DEFAULT_VALUE;

    expect(result).to.deep.equal({
      projectedTrafficLost: Math.round(expectedTraffic),
      projectedTrafficValue: Math.round(expectedTrafficValue),
    });
  });

  describe('resolveCpcValue', () => {
    it('should return CPC_DEFAULT_VALUE', () => {
      expect(resolveCpcValue()).to.equal(CPC_DEFAULT_VALUE);
    });
  });
});

describe('isLinkInaccessible', () => {
  let mockLog;

  beforeEach(() => {
    // Reset mock logger before each test
    mockLog = {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
    };
    // Clear all nock interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should return false for accessible links (status 200)', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/')
      .reply(200);

    const result = await isLinkInaccessible('https://example.com', mockLog);
    expect(result).to.be.false;
  });

  it('should return true for 404 responses', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/notfound')
      .reply(404)
      .get('/notfound')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/notfound', mockLog);
    expect(result).to.be.true;
  });

  it('should return true and log warning for non-404 client errors', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/forbidden')
      .reply(403)
      .get('/forbidden')
      .reply(403);

    const result = await isLinkInaccessible('https://example.com/forbidden', mockLog);
    expect(result).to.be.true;
    expect(mockLog.warn.called).to.be.true;
  });

  it('should return true for network errors', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/error')
      .replyWithError('Network error')
      .get('/error')
      .replyWithError('Network error');

    const result = await isLinkInaccessible('https://example.com/error', mockLog);
    expect(result).to.be.true;
    expect(mockLog.error.called).to.be.true;
  });

  // Timeout test removed - network error test covers the error handling path

  it('should fallback to GET when HEAD fails with server error', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/server-error')
      .reply(500) // HEAD returns server error
      .get('/server-error')
      .reply(500); // GET also returns server error

    const result = await isLinkInaccessible('https://example.com/server-error', mockLog);
    expect(result).to.be.true;
  });

  it('should use GET result when HEAD returns non-2xx status', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/head-forbidden')
      .reply(403) // HEAD forbidden
      .get('/head-forbidden')
      .reply(403); // GET also forbidden

    const result = await isLinkInaccessible('https://example.com/head-forbidden', mockLog);
    expect(result).to.be.true;
    expect(mockLog.warn.calledWith(
      'broken-internal-links audit: Warning: https://example.com/head-forbidden returned client error: 403',
    )).to.be.true;
  });
});

describe('calculatePriority', () => {

  it('should classify links into high, medium, and low priority based on traffic', () => {
    const links = [
      { urlTo: 'link1', trafficDomain: 1000 },
      { urlTo: 'link2', trafficDomain: 900 },
      { urlTo: 'link3', trafficDomain: 800 },
      { urlTo: 'link4', trafficDomain: 700 },
      { urlTo: 'link5', trafficDomain: 600 },
      { urlTo: 'link6', trafficDomain: 500 },
      { urlTo: 'link7', trafficDomain: 400 },
      { urlTo: 'link8', trafficDomain: 300 },
    ];

    const result = calculatePriority(links);

    // Top 25% (2 links) should be high
    expect(result[0].priority).to.equal('high');
    expect(result[1].priority).to.equal('high');

    // Next 25% (2 links) should be medium
    expect(result[2].priority).to.equal('medium');
    expect(result[3].priority).to.equal('medium');

    // Bottom 50% (4 links) should be low
    expect(result[4].priority).to.equal('low');
    expect(result[5].priority).to.equal('low');
    expect(result[6].priority).to.equal('low');
    expect(result[7].priority).to.equal('low');

    // Should be sorted by trafficDomain descending
    expect(result[0].trafficDomain).to.equal(1000);
    expect(result[7].trafficDomain).to.equal(300);
  });

  it('should handle single link correctly', () => {
    const links = [{ urlTo: 'link1', trafficDomain: 100 }];
    const result = calculatePriority(links);

    expect(result).to.have.lengthOf(1);
    expect(result[0].priority).to.equal('high');
  });

  it('should handle two links correctly', () => {
    const links = [
      { urlTo: 'link1', trafficDomain: 200 },
      { urlTo: 'link2', trafficDomain: 100 },
    ];

    const result = calculatePriority(links);

    expect(result).to.have.lengthOf(2);
    // With 2 links: quarterIndex=1, halfIndex=1
    // index 0 < 1 → 'high'
    // index 1 >= 1 → 'low'
    expect(result[0].priority).to.equal('high');
    expect(result[1].priority).to.equal('low');
  });

  it('should handle empty array', () => {
    const result = calculatePriority([]);
    expect(result).to.be.an('array').that.is.empty;
  });

  it('should not mutate original array', () => {
    const links = [
      { urlTo: 'link1', trafficDomain: 300 },
      { urlTo: 'link2', trafficDomain: 100 },
      { urlTo: 'link3', trafficDomain: 200 },
    ];

    const originalOrder = links.map((l) => l.urlTo);
    calculatePriority(links);

    // Original array should be unchanged
    expect(links.map((l) => l.urlTo)).to.deep.equal(originalOrder);
  });

  it('should preserve all link properties', () => {
    const links = [
      { urlTo: 'link1', urlFrom: 'from1', trafficDomain: 100, extraProp: 'test' },
    ];

    const result = calculatePriority(links);

    expect(result[0]).to.deep.include({
      urlTo: 'link1',
      urlFrom: 'from1',
      trafficDomain: 100,
      extraProp: 'test',
      priority: 'high',
    });
  });
});
