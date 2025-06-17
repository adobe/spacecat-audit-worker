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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import {
  isLinkInaccessible,
  resolveCpcValue,
  calculateKpiDeltasForAudit,
  calculatePriority,
} from '../../../src/external-links/helpers.js';

use(sinonChai);

describe('External Links Helpers', () => {
  let log;

  beforeEach(() => {
    log = {
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('isLinkInaccessible', () => {
    it('returns false for accessible links (200 response)', async () => {
      nock('https://example.com')
        .head('/valid')
        .reply(200);

      const result = await isLinkInaccessible('https://example.com/valid', log);
      expect(result).to.be.false;
    });

    it('returns true for 404 responses', async () => {
      nock('https://example.com')
        .head('/not-found')
        .reply(404);

      const result = await isLinkInaccessible('https://example.com/not-found', log);
      expect(result).to.be.true;
      expect(log.warn).to.have.been.calledWith('Client error (404) for URL: https://example.com/not-found');
    });

    it('returns true for other 4xx responses', async () => {
      nock('https://example.com')
        .head('/forbidden')
        .reply(403);

      const result = await isLinkInaccessible('https://example.com/forbidden', log);
      expect(result).to.be.true;
      expect(log.warn).to.have.been.calledWith('Client error (403) for URL: https://example.com/forbidden');
    });

    it('returns true for 5xx responses', async () => {
      nock('https://example.com')
        .head('/server-error')
        .reply(500);

      const result = await isLinkInaccessible('https://example.com/server-error', log);
      expect(result).to.be.true;
      expect(log.error).to.have.been.calledWith('Server error (500) for URL: https://example.com/server-error');
    });

    it('returns true for network errors', async () => {
      nock('https://example.com')
        .head('/network-error')
        .replyWithError('network error');

      const result = await isLinkInaccessible('https://example.com/network-error', log);
      expect(result).to.be.true;
      expect(log.error).to.have.been.calledWith('Error checking URL: https://example.com/network-error');
    });

    it('returns true for timeout errors', async () => {
      nock('https://example.com')
        .head('/timeout')
        .delay(100) // Shorter delay to avoid test timeout
        .replyWithError({ code: 'ETIMEOUT' });

      const result = await isLinkInaccessible('https://example.com/timeout', log);
      expect(result).to.be.true;
      expect(log.error).to.have.been.calledWith('Error checking URL: https://example.com/timeout');
    });
  });

  describe('resolveCpcValue', () => {
    it('returns the default CPC value', () => {
      expect(resolveCpcValue()).to.equal(1.0);
    });
  });

  describe('calculateKpiDeltasForAudit', () => {
    it('calculates KPI deltas for broken external links', () => {
      const brokenLinks = [
        { urlTo: 'https://example.com/1', trafficDomain: 100 },
        { urlTo: 'https://example.com/1', trafficDomain: 200 },
        { urlTo: 'https://example.com/2', trafficDomain: 300 },
      ];

      const result = calculateKpiDeltasForAudit(brokenLinks);
      expect(result).to.deep.equal({
        projectedTrafficLost: 60, // (100 + 200 + 300) * 0.1
        projectedTrafficValue: 60, // 60 * 1.0
      });
    });

    it('limits the number of links considered to MAX_LINKS_TO_CONSIDER', () => {
      const brokenLinks = Array.from({ length: 15 }, (_, i) => ({
        urlTo: `https://example.com/${i}`,
        trafficDomain: 100 * (i + 1),
      }));

      const result = calculateKpiDeltasForAudit(brokenLinks);
      // Should only consider top 10 links by traffic domain
      expect(result.projectedTrafficLost).to.equal(1050); // Sum of top 10 traffic domains * 0.1
      expect(result.projectedTrafficValue).to.equal(1050); // 1050 * 1.0
    });

    it('handles empty array of broken links', () => {
      const result = calculateKpiDeltasForAudit([]);
      expect(result).to.deep.equal({
        projectedTrafficLost: 0,
        projectedTrafficValue: 0,
      });
    });
  });

  describe('calculatePriority', () => {
    it('classifies links into priority categories based on views', () => {
      const links = [
        { url: 'https://example.com/1', views: 1000 },
        { url: 'https://example.com/2', views: 800 },
        { url: 'https://example.com/3', views: 600 },
        { url: 'https://example.com/4', views: 400 },
        { url: 'https://example.com/5', views: 200 },
      ];

      const result = calculatePriority(links);
      expect(result).to.deep.equal([
        { url: 'https://example.com/1', views: 1000, priority: 'high' },
        { url: 'https://example.com/2', views: 800, priority: 'high' },
        { url: 'https://example.com/3', views: 600, priority: 'medium' },
        { url: 'https://example.com/4', views: 400, priority: 'low' },
        { url: 'https://example.com/5', views: 200, priority: 'low' },
      ]);
    });

    it('handles empty array of links', () => {
      const result = calculatePriority([]);
      expect(result).to.deep.equal([]);
    });

    it('handles array with single link', () => {
      const result = calculatePriority([{ url: 'https://example.com/1', views: 1000 }]);
      expect(result).to.deep.equal([
        { url: 'https://example.com/1', views: 1000, priority: 'high' },
      ]);
    });

    it('handles array with two links', () => {
      const result = calculatePriority([
        { url: 'https://example.com/1', views: 1000 },
        { url: 'https://example.com/2', views: 500 },
      ]);
      expect(result).to.deep.equal([
        { url: 'https://example.com/1', views: 1000, priority: 'high' },
        { url: 'https://example.com/2', views: 500, priority: 'low' },
      ]);
    });
  });
});
