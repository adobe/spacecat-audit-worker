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

    const result = await isLinkInaccessible('https://example.com', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should return true for 404 responses', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/notfound')
      .reply(404)
      .get('/notfound')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/notfound', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should return false and log warning for non-404 client errors (only 404 reported as broken)', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/forbidden')
      .reply(403)
      .get('/forbidden')
      .reply(403);

    const result = await isLinkInaccessible('https://example.com/forbidden', mockLog, 'test-site-id');
    expect(result).to.be.false;
    expect(mockLog.warn.calledWith(
      sinon.match(/⚠ WARNING: https:\/\/example\.com\/forbidden returned client error 403/),
    )).to.be.true;
  });

  it('should return true for network errors and log error', async function call() {
    this.timeout(15000);
    nock('https://example.com')
      .head('/network-error')
      .replyWithError(new Error('Network failure'))
      .get('/network-error')
      .replyWithError(new Error('Network failure'));

    const result = await isLinkInaccessible('https://example.com/network-error', mockLog, 'test-site-id');
    expect(result).to.be.true;
    expect(mockLog.error.calledOnce).to.be.true;
  });

  it('should handle error with code property', async function call() {
    this.timeout(15000);
    const codeError = new Error('Connection failed');
    codeError.code = 'ECONNRESET';

    nock('https://example.com')
      .head('/code-err')
      .replyWithError(codeError)
      .get('/code-err')
      .replyWithError(codeError);

    const result = await isLinkInaccessible('https://example.com/code-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle error with type property', async function call() {
    this.timeout(15000);
    const typeError = new Error('System error');
    typeError.type = 'system';

    nock('https://example.com')
      .head('/type-err')
      .replyWithError(typeError)
      .get('/type-err')
      .replyWithError(typeError);

    const result = await isLinkInaccessible('https://example.com/type-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle error with errno property', async function call() {
    this.timeout(15000);
    const errnoError = new Error('Permission issue');
    errnoError.errno = -13;

    nock('https://example.com')
      .head('/errno-err')
      .replyWithError(errnoError)
      .get('/errno-err')
      .replyWithError(errnoError);

    const result = await isLinkInaccessible('https://example.com/errno-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle error with empty message', async function call() {
    this.timeout(15000);
    const emptyMsgError = new Error('');

    nock('https://example.com')
      .head('/empty-msg')
      .replyWithError(emptyMsgError)
      .get('/empty-msg')
      .replyWithError(emptyMsgError);

    const result = await isLinkInaccessible('https://example.com/empty-msg', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle error with all properties for join path', async function call() {
    this.timeout(15000);
    const fullError = new Error('Full error');
    fullError.code = 'CODE1';
    fullError.type = 'TYPE1';
    fullError.errno = 'ERRNO1';

    nock('https://example.com')
      .head('/full-err')
      .replyWithError(fullError)
      .get('/full-err')
      .replyWithError(fullError);

    const result = await isLinkInaccessible('https://example.com/full-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle error with only message for single property path', async function call() {
    this.timeout(15000);
    // Create a minimal error with only message, no code/type/errno
    const simpleError = Object.create(Error.prototype);
    simpleError.message = 'Just message';
    // Explicitly set others to undefined to ensure they're not present
    simpleError.code = undefined;
    simpleError.type = undefined;
    simpleError.errno = undefined;

    nock('https://example.com')
      .head('/simple-err')
      .replyWithError(simpleError)
      .get('/simple-err')
      .replyWithError(simpleError);

    const result = await isLinkInaccessible('https://example.com/simple-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
    // This should log just "Just message" without any colons/joining
  });

  it('should handle error with no properties using Unknown error fallback', async function call() {
    this.timeout(15000);
    // Create an error-like object with no properties at all
    const emptyError = Object.create(Error.prototype);

    nock('https://example.com')
      .head('/empty-err')
      .replyWithError(emptyError)
      .get('/empty-err')
      .replyWithError(emptyError);

    const result = await isLinkInaccessible('https://example.com/empty-err', mockLog, 'test-site-id');
    expect(result).to.be.true;
    // Should use 'Unknown error' as fallback
  });

  it('should treat HEAD timeout as accessible and skip GET request', async function call() {
    this.timeout(15000);
    const timeoutError = new Error('Request timeout after 10000ms');
    timeoutError.code = 'ETIMEDOUT';

    nock('https://example.com')
      .head('/timeout-url')
      .replyWithError(timeoutError);

    const result = await isLinkInaccessible('https://example.com/timeout-url', mockLog, 'test-site-id');
    
    // Should return false (treat as accessible)
    expect(result).to.be.false;
    expect(mockLog.info.calledWith(
      sinon.match(/\[auditType=broken-internal-links\].*\[siteId=test-site-id\].*⏱ TIMEOUT.*HEAD request timed out/),
    )).to.be.true;
  });

  it('should recognize timeout error with lowercase "timeout" in message', async function call() {
    this.timeout(15000);
    const timeoutError = new Error('connection timeout');

    nock('https://example.com')
      .head('/timeout-msg')
      .replyWithError(timeoutError);

    const result = await isLinkInaccessible('https://example.com/timeout-msg', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should recognize timeout error with "ETIMEDOUT" in code', async function call() {
    this.timeout(15000);
    const timeoutError = new Error('Network error');
    timeoutError.code = 'ETIMEDOUT';

    nock('https://example.com')
      .head('/timeout-code')
      .replyWithError(timeoutError);

    const result = await isLinkInaccessible('https://example.com/timeout-code', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should recognize timeout error with "ESOCKETTIMEDOUT" in code', async function call() {
    this.timeout(15000);
    const timeoutError = new Error('Socket error');
    timeoutError.code = 'ESOCKETTIMEDOUT';

    nock('https://example.com')
      .head('/socket-timeout')
      .replyWithError(timeoutError);

    const result = await isLinkInaccessible('https://example.com/socket-timeout', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should recognize timeout error with "timeout" in code field', async function call() {
    this.timeout(15000);
    const timeoutError = new Error('Request failed');
    timeoutError.code = 'REQUEST_TIMEOUT';

    nock('https://example.com')
      .head('/timeout-in-code')
      .replyWithError(timeoutError);

    const result = await isLinkInaccessible('https://example.com/timeout-in-code', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should not treat non-timeout errors as timeout', async function call() {
    this.timeout(15000);
    const networkError = new Error('ECONNREFUSED');
    networkError.code = 'ECONNREFUSED';

    nock('https://example.com')
      .head('/conn-refused')
      .replyWithError(networkError)
      .get('/conn-refused')
      .replyWithError(networkError);

    const result = await isLinkInaccessible('https://example.com/conn-refused', mockLog, 'test-site-id');
    // Should be true (broken) and should have tried GET
    expect(result).to.be.true;
  });

  it('should handle GET timeout after HEAD succeeds with client error', async function call() {
    this.timeout(15000);
    const getTimeoutError = new Error('GET request timeout');
    getTimeoutError.code = 'ETIMEDOUT';

    nock('https://example.com')
      .head('/get-timeout')
      .reply(403) // HEAD returns client error, so will try GET
      .get('/get-timeout')
      .replyWithError(getTimeoutError); // GET times out

    const result = await isLinkInaccessible('https://example.com/get-timeout', mockLog, 'test-site-id');
    
    // Should return false (treat as accessible) when GET times out
    expect(result).to.be.false;
    expect(mockLog.info.calledWith(
      sinon.match(/\[siteId=test-site-id\].*⏱ TIMEOUT.*GET request timed out/),
    )).to.be.true;
  });
});

describe('calculatePriority', () => {
  it('should assign high priority to top 25% of links', () => {
    const links = [
      { urlTo: '/a', trafficDomain: 1000 },
      { urlTo: '/b', trafficDomain: 500 },
      { urlTo: '/c', trafficDomain: 200 },
      { urlTo: '/d', trafficDomain: 100 },
    ];

    const result = calculatePriority(links);

    expect(result[0].priority).to.equal('high');
    expect(result[1].priority).to.equal('medium');
    expect(result[2].priority).to.equal('low');
    expect(result[3].priority).to.equal('low');
  });

  it('should handle empty array', () => {
    const result = calculatePriority([]);
    expect(result).to.be.an('array').that.is.empty;
  });

  it('should handle single link', () => {
    const links = [{ urlTo: '/a', trafficDomain: 100 }];
    const result = calculatePriority(links);
    expect(result[0].priority).to.equal('high');
  });

  it('should handle links with undefined trafficDomain', () => {
    const links = [
      { urlTo: '/a', trafficDomain: 100 },
      { urlTo: '/b' }, // undefined trafficDomain
      { urlTo: '/c', trafficDomain: 0 },
    ];

    const result = calculatePriority(links);
    // Should sort: 100, 0, undefined (treated as 0)
    expect(result[0].urlTo).to.equal('/a');
    expect(result[0].trafficDomain).to.equal(100);
  });

  it('should sort links by trafficDomain in descending order', () => {
    const links = [
      { urlTo: '/low', trafficDomain: 10 },
      { urlTo: '/high', trafficDomain: 1000 },
      { urlTo: '/med', trafficDomain: 500 },
    ];

    const result = calculatePriority(links);
    expect(result[0].trafficDomain).to.equal(1000);
    expect(result[1].trafficDomain).to.equal(500);
    expect(result[2].trafficDomain).to.equal(10);
  });
});

describe('isLinkInaccessible - Asset Handling', () => {
  let mockLog;

  beforeEach(() => {
    mockLog = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should handle static assets (PNG) with Range header', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .get('/image.png')
      .reply(206, 'partial content');

    const result = await isLinkInaccessible('https://example.com/image.png', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should handle static assets (SVG) with Range header', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .get('/icon.svg')
      .reply(200, 'svg content');

    const result = await isLinkInaccessible('https://example.com/icon.svg', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should handle static assets (CSS) with Range header', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .get('/styles.css')
      .reply(200, 'css content');

    const result = await isLinkInaccessible('https://example.com/styles.css', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should handle static assets (JS) with Range header', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .get('/app.js')
      .reply(200, 'js content');

    const result = await isLinkInaccessible('https://example.com/app.js', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should detect broken static assets', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .get('/missing.png')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/missing.png', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle GET error with type field', async function call() {
    this.timeout(6000);
    const error = new Error('Connection refused');
    error.type = 'system';

    nock('https://example.com')
      .head('/error-with-type')
      .replyWithError(new Error('HEAD failed'))
      .get('/error-with-type')
      .replyWithError(error);

    const result = await isLinkInaccessible('https://example.com/error-with-type', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle GET error with errno field', async function call() {
    this.timeout(6000);
    const error = new Error('DNS lookup failed');
    error.errno = -3008;

    nock('https://example.com')
      .head('/error-with-errno')
      .replyWithError(new Error('HEAD failed'))
      .get('/error-with-errno')
      .replyWithError(error);

    const result = await isLinkInaccessible('https://example.com/error-with-errno', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should handle GET success with 3xx redirect status', async function call() {
    this.timeout(6000);
    nock('https://example.com')
      .head('/redirect')
      .reply(301)
      .get('/redirect')
      .reply(301, '', { Location: 'https://example.com/new-page' });

    const result = await isLinkInaccessible('https://example.com/redirect', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should validate URL as-is (trailing slash not stripped)', async function call() {
    this.timeout(6000);
    // URL is validated as it appears on the page (no pre-check normalization)
    nock('https://example.com')
      .head('/page/')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/page/', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should validate URL as-is (URL-encoded space not rewritten)', async function call() {
    this.timeout(6000);
    // URL with %20 is validated as-is so broken canonicals with wrong encoding are caught
    nock('https://example.com')
      .head('/blogs/sage-green-colour-%20combination-for-the-wall.html')
      .reply(404);

    const result = await isLinkInaccessible('https://example.com/blogs/sage-green-colour-%20combination-for-the-wall.html', mockLog, 'test-site-id');
    expect(result).to.be.true;
  });

  it('should validate URL as-is (www preserved)', async function call() {
    this.timeout(6000);
    nock('https://www.example.com')
      .head('/page')
      .reply(200);

    const result = await isLinkInaccessible('https://www.example.com/page', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });

  it('should validate URL as-is (encoding and trailing slash preserved)', async function call() {
    this.timeout(6000);
    // No normalization before check: path with %20 and trailing slash is requested as-is
    nock('https://www.example.com')
      .head('/path/with%20spaces/page.html/')
      .reply(200);

    const result = await isLinkInaccessible('https://www.example.com/path/with%20spaces/page.html/', mockLog, 'test-site-id');
    expect(result).to.be.false;
  });
});
