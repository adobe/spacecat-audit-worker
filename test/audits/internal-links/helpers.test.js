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
} from '../../../src/internal-links/helpers.js';
import { auditData } from '../../fixtures/internal-links-data.js';

describe('calculateKpiDeltasForAudit', () => {
  it('should return zero values when no broken links exist', () => {
    const audit = {
      auditResult: {
        brokenInternalLinks: [],
      },
    };

    const result = calculateKpiDeltasForAudit(audit);
    expect(result).to.deep.equal({
      projectedTrafficLost: 0,
      projectedTrafficValue: 0,
    });
  });

  it('should calculate KPIs correctly for a single broken link', () => {
    const audit = {
      auditResult: {
        brokenInternalLinks: [{
          urlFrom: 'https://example.com/source',
          urlTo: 'https://example.com/broken',
          trafficDomain: 1000,
        }],
      },
    };

    const result = calculateKpiDeltasForAudit(audit);
    expect(result).to.deep.equal({
      projectedTrafficLost: 10, // 1000 * 0.01
      projectedTrafficValue: 10, // 10 * 1 (DEFAULT_CPC_VALUE)
    });
  });

  it('should handle multiple broken links to the same target', () => {
    const result = calculateKpiDeltasForAudit(auditData);
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

    const audit = {
      auditResult: { brokenInternalLinks: brokenLinks },
    };

    const result = calculateKpiDeltasForAudit(audit);

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
    };
    // Clear all nock interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    // Ensure all nock interceptors were used
    expect(nock.isDone()).to.be.true;
    nock.cleanAll();
  });

  it('should return false for accessible links (status 200)', async () => {
    nock('https://example.com')
      .get('/')
      .reply(200);

    const result = await isLinkInaccessible('https://example.com', mockLog);
    expect(result).to.be.false;
  });

  it('should return true for 404 responses', async () => {
    nock('https://example.com')
      .get('/notfound')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/notfound', mockLog);
    expect(result).to.be.true;
  });

  it('should return true and log warning for non-404 client errors', async () => {
    nock('https://example.com')
      .get('/forbidden')
      .reply(403);

    const result = await isLinkInaccessible('https://example.com/forbidden', mockLog);
    expect(result).to.be.true;
    expect(mockLog.info.calledWith(
      'broken-internal-links audit: Warning: https://example.com/forbidden returned client error: 403',
    )).to.be.true;
  });

  it('should return true for network errors', async () => {
    nock('https://example.com')
      .get('/error')
      .replyWithError('Network error');

    const result = await isLinkInaccessible('https://example.com/error', mockLog);
    expect(result).to.be.true;
    expect(mockLog.info.calledWith(
      'broken-internal-links audit: Error checking https://example.com/error: Network error',
    )).to.be.true;
  });

  it('should return true for timeout errors', async function call() {
    // Increase the timeout for this specific test
    this.timeout(5000);

    nock('https://example.com')
      .get('/timeout')
      .delay(4000) // Set delay just above the 3000ms timeout in isLinkInaccessible
      .reply(200);

    const result = await isLinkInaccessible('https://example.com/timeout', mockLog);
    expect(result).to.be.true;
    expect(mockLog.info.calledWith(
      'broken-internal-links audit: Error checking https://example.com/timeout: Request timed out after 3000ms',
    )).to.be.true;
  });
});
