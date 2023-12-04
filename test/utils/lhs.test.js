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
import {
  extractAuditScores,
  extractTotalBlockingTime,
  extractThirdPartySummary,
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
        bestPractices: 0.6,
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
});
