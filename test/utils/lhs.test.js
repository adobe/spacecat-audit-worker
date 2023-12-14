/*
 * Copyright 2023 Adobe. All rights reserved.
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
import nock from 'nock';
import sinon from 'sinon';

import { isIsoDate } from '@adobe/spacecat-shared-utils';

import {
  extractAuditScores,
  extractTotalBlockingTime,
  extractThirdPartySummary,
  getContentLastModified,
} from '../../src/utils/lhs.js';

describe('LHS Data Utils', () => {
  describe('extractAuditScores', () => {
    it('extracts audit scores correctly', () => {
      const categories = {
        performance: { score: 0.8 },
        seo: { score: 0.9 },
        accessibility: { score: 0.7 },
        'best-practices': { score: 0.6 },
      };

      const scores = extractAuditScores(categories);

      expect(scores).to.deep.equal({
        performance: 0.8,
        seo: 0.9,
        accessibility: 0.7,
        'best-practices': 0.6,
      });
    });
  });

  describe('extractTotalBlockingTime', () => {
    it('extracts total blocking time if present', () => {
      const psiAudit = {
        'total-blocking-time': { numericValue: 1234 },
      };

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.equal(1234);
    });

    it('returns null if total blocking time is absent', () => {
      const psiAudit = {};

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.be.null;
    });
  });

  describe('extractThirdPartySummary', () => {
    it('extracts third party summary correctly', () => {
      const psiAudit = {
        'third-party-summary': {
          details: {
            items: [
              {
                entity: 'ExampleEntity',
                blockingTime: 200,
                mainThreadTime: 1000,
                transferSize: 1024,
              },
            ],
          },
        },
      };

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.deep.equal([
        {
          entity: 'ExampleEntity',
          blockingTime: 200,
          mainThreadTime: 1000,
          transferSize: 1024,
        },
      ]);
    });

    it('returns an empty array if third party summary details are absent', () => {
      const psiAudit = {};

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.be.an('array').that.is.empty;
    });
  });

  describe('getContentLastModified', () => {
    const lastModifiedDate = 'Tue, 05 Dec 2023 20:08:48 GMT';
    const expectedDate = new Date(lastModifiedDate).toISOString();
    let logSpy;

    beforeEach(() => {
      logSpy = { error: sinon.spy() };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('returns last modified date on successful fetch', async () => {
      nock('https://www.site1.com')
        .head('/')
        .reply(200, '', { 'last-modified': lastModifiedDate });

      const result = await getContentLastModified('https://www.site1.com', logSpy);

      expect(result).to.equal(expectedDate);
    });

    it('returns current date when last modified date is not present', async () => {
      nock('https://www.site2.com')
        .head('/')
        .reply(200, '', { 'last-modified': null });

      const result = await getContentLastModified('https://www.site2.com', logSpy);

      expect(result).to.not.equal(expectedDate);
    });

    it('returns current date and logs error on fetch failure', async () => {
      nock('https://www.site3.com')
        .head('/')
        .replyWithError('Network error');

      const result = await getContentLastModified('https://www.site3.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });

    it('returns current date and logs error on non-OK response', async () => {
      nock('https://www.site4.com')
        .head('/')
        .reply(404);

      const result = await getContentLastModified('https://www.site4.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });
  });
});
