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
import {
  FragmentAnalyzer,
  UNUSED_CONTENT_STATUSES,
} from '../../../src/content-fragment-insights/fragment-analyzer.js';

describe('FragmentAnalyzer', () => {
  let log;
  let analyzer;

  beforeEach(() => {
    log = {
      debug: sinon.spy(),
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
    analyzer = new FragmentAnalyzer(log);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with default threshold', () => {
      const defaultAnalyzer = new FragmentAnalyzer();
      expect(defaultAnalyzer.unusedThresholdMs).to.equal(
        FragmentAnalyzer.DAY_IN_MS * FragmentAnalyzer.UNUSED_CONTENT_THRESHOLD_DAYS,
      );
    });

    it('should initialize with custom threshold', () => {
      const customThreshold = 30;
      const customAnalyzer = new FragmentAnalyzer(log, customThreshold);
      expect(customAnalyzer.unusedThresholdMs).to.equal(
        FragmentAnalyzer.DAY_IN_MS * customThreshold,
      );
    });

    it('should use console as default logger', () => {
      const defaultAnalyzer = new FragmentAnalyzer();
      expect(defaultAnalyzer.log).to.equal(console);
    });
  });

  describe('hasUnusedStatus', () => {
    it('should return true for NEW status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('NEW')).to.be.true;
    });

    it('should return true for DRAFT status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('DRAFT')).to.be.true;
    });

    it('should return true for UNPUBLISHED status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('UNPUBLISHED')).to.be.true;
    });

    it('should return true for MODIFIED status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('MODIFIED')).to.be.true;
    });

    it('should return true for lowercase status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('new')).to.be.true;
      expect(FragmentAnalyzer.hasUnusedStatus('draft')).to.be.true;
    });

    it('should return true for mixed case status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('New')).to.be.true;
      expect(FragmentAnalyzer.hasUnusedStatus('DrAfT')).to.be.true;
    });

    it('should return false for PUBLISHED status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('PUBLISHED')).to.be.false;
    });

    it('should return false for unknown status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('UNKNOWN')).to.be.false;
    });

    it('should return false for null status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus(null)).to.be.false;
    });

    it('should return false for undefined status', () => {
      expect(FragmentAnalyzer.hasUnusedStatus(undefined)).to.be.false;
    });

    it('should return false for empty string', () => {
      expect(FragmentAnalyzer.hasUnusedStatus('')).to.be.false;
    });
  });

  describe('findUnusedFragments', () => {
    it('should return empty array for empty input', () => {
      const result = analyzer.findUnusedFragments([]);
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should return empty array when no fragments provided', () => {
      const result = analyzer.findUnusedFragments();
      expect(result).to.be.an('array').that.is.empty;
    });

    it('should identify unused fragment older than threshold', () => {
      const oldDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.include({
        fragmentPath: '/content/dam/test/fragment1',
        status: 'NEW',
        lastModified: oldDate.toISOString(),
        publishedAt: null,
      });
      expect(result[0].ageInDays).to.be.at.least(99);
    });

    it('should skip fragment with PUBLISHED status', () => {
      const oldDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'PUBLISHED',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.be.empty;
    });

    it('should skip fragment newer than threshold', () => {
      const recentDate = new Date(Date.now() - 10 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: recentDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.be.empty;
    });

    it('should skip fragment without timestamp', () => {
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: null,
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.be.empty;
    });

    it('should skip fragment with invalid timestamp', () => {
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: 'invalid-date',
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.be.empty;
    });

    it('should prefer modifiedAt over createdAt', () => {
      const createdDate = new Date(Date.now() - 200 * FragmentAnalyzer.DAY_IN_MS);
      const modifiedDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'DRAFT',
          createdAt: createdDate.toISOString(),
          modifiedAt: modifiedDate.toISOString(),
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);

      expect(result).to.have.lengthOf(1);
      expect(result[0].lastModified).to.equal(modifiedDate.toISOString());
      expect(result[0].ageInDays).to.be.at.least(99);
    });

    it('should use createdAt when modifiedAt is null', () => {
      const createdDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'DRAFT',
          createdAt: createdDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);

      expect(result).to.have.lengthOf(1);
      expect(result[0].lastModified).to.equal(createdDate.toISOString());
    });

    it('should handle multiple fragments with different statuses', () => {
      const oldDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
        {
          fragmentPath: '/content/dam/test/fragment2',
          status: 'DRAFT',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
        {
          fragmentPath: '/content/dam/test/fragment3',
          status: 'UNPUBLISHED',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
        {
          fragmentPath: '/content/dam/test/fragment4',
          status: 'MODIFIED',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.have.lengthOf(4);
    });

    it('should filter mixed old and new fragments', () => {
      const oldDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const newDate = new Date(Date.now() - 10 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/old',
          status: 'NEW',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
        {
          fragmentPath: '/content/dam/test/new',
          status: 'NEW',
          createdAt: newDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.have.lengthOf(1);
      expect(result[0].fragmentPath).to.equal('/content/dam/test/old');
    });

    it('should include publishedAt in result', () => {
      const oldDate = new Date(Date.now() - 100 * FragmentAnalyzer.DAY_IN_MS);
      const publishedDate = new Date(Date.now() - 150 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'MODIFIED',
          createdAt: oldDate.toISOString(),
          modifiedAt: null,
          publishedAt: publishedDate.toISOString(),
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);

      expect(result).to.have.lengthOf(1);
      expect(result[0].publishedAt).to.equal(publishedDate.toISOString());
    });

    it('should handle fragments at exact threshold boundary', () => {
      const exactThresholdDate = new Date(
        Date.now() - 90 * FragmentAnalyzer.DAY_IN_MS,
      );
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: exactThresholdDate.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);
      expect(result).to.have.lengthOf(1);
    });

    it('should calculate correct age in days', () => {
      const date120DaysAgo = new Date(Date.now() - 120 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: date120DaysAgo.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = analyzer.findUnusedFragments(fragments);

      expect(result).to.have.lengthOf(1);
      expect(result[0].ageInDays).to.be.at.least(119);
      expect(result[0].ageInDays).to.be.at.most(121);
    });

    it('should handle custom threshold values', () => {
      const customAnalyzer = new FragmentAnalyzer(log, 30);
      const date40DaysAgo = new Date(Date.now() - 40 * FragmentAnalyzer.DAY_IN_MS);
      const fragments = [
        {
          fragmentPath: '/content/dam/test/fragment1',
          status: 'NEW',
          createdAt: date40DaysAgo.toISOString(),
          modifiedAt: null,
          publishedAt: null,
        },
      ];

      const result = customAnalyzer.findUnusedFragments(fragments);
      expect(result).to.have.lengthOf(1);
    });
  });

  describe('UNUSED_CONTENT_STATUSES constant', () => {
    it('should export correct status array', () => {
      expect(UNUSED_CONTENT_STATUSES).to.deep.equal([
        'NEW',
        'DRAFT',
        'UNPUBLISHED',
        'MODIFIED',
      ]);
    });
  });

  describe('DAY_IN_MS constant', () => {
    it('should have correct value for day in milliseconds', () => {
      expect(FragmentAnalyzer.DAY_IN_MS).to.equal(24 * 60 * 60 * 1000);
    });
  });

  describe('UNUSED_CONTENT_THRESHOLD_DAYS constant', () => {
    it('should have default threshold of 90 days', () => {
      expect(FragmentAnalyzer.UNUSED_CONTENT_THRESHOLD_DAYS).to.equal(90);
    });
  });
});

