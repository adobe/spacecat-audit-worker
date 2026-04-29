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
import {
  normalizeForCompare, changedFields, diffRows, logDiffSummary,
} from '../../../src/llmo-config-db-sync/diff.js';

use(sinonChai);

describe('llmo-config-db-sync/diff', () => {
  describe('normalizeForCompare', () => {
    it('sorts and uppercases regions arrays', () => {
      expect(normalizeForCompare('regions', ['us', 'de'])).to.equal('["DE","US"]');
      expect(normalizeForCompare('regions', ['DE', 'US'])).to.equal('["DE","US"]');
    });

    it('sorts non-region arrays', () => {
      expect(normalizeForCompare('aliases', ['b', 'a'])).to.equal('["a","b"]');
    });

    it('stringifies scalar values', () => {
      expect(normalizeForCompare('name', 'foo')).to.equal('"foo"');
      expect(normalizeForCompare('status', null)).to.equal('null');
    });
  });

  describe('changedFields', () => {
    it('returns empty when rows are equal', () => {
      const fields = ['name', 'status'];
      expect(changedFields({ name: 'A', status: 'active' }, { name: 'A', status: 'active' }, fields)).to.deep.equal([]);
    });

    it('returns changed field names', () => {
      const fields = ['name', 'status'];
      expect(changedFields({ name: 'B', status: 'active' }, { name: 'A', status: 'active' }, fields)).to.deep.equal(['name']);
    });

    it('detects region array order differences as equal (sorted)', () => {
      expect(changedFields({ regions: ['US', 'DE'] }, { regions: ['DE', 'US'] }, ['regions'])).to.deep.equal([]);
    });
  });

  describe('diffRows', () => {
    const keyFn = (r) => r.id;
    const compareFields = ['name'];

    it('marks new rows as toUpsert/dryRunInserts', () => {
      const result = diffRows([{ id: '1', name: 'A' }], new Map(), keyFn, compareFields);
      expect(result.stats).to.deep.equal({ inserted: 1, updated: 0, unchanged: 0 });
      expect(result.toUpsert).to.have.length(1);
      expect(result.dryRunInserts).to.have.length(1);
      expect(result.dryRunUpdates).to.have.length(0);
    });

    it('marks changed rows as toUpsert/dryRunUpdates', () => {
      const existing = new Map([['1', { id: '1', name: 'Old' }]]);
      const result = diffRows([{ id: '1', name: 'New' }], existing, keyFn, compareFields);
      expect(result.stats).to.deep.equal({ inserted: 0, updated: 1, unchanged: 0 });
      expect(result.toUpsert).to.have.length(1);
      expect(result.dryRunUpdates[0]._changedFields).to.deep.equal(['name']);
    });

    it('marks unchanged rows correctly', () => {
      const existing = new Map([['1', { id: '1', name: 'Same' }]]);
      const result = diffRows([{ id: '1', name: 'Same' }], existing, keyFn, compareFields);
      expect(result.stats).to.deep.equal({ inserted: 0, updated: 0, unchanged: 1 });
      expect(result.toUpsert).to.have.length(0);
    });
  });

  describe('logDiffSummary', () => {
    let log;

    beforeEach(() => {
      log = { info: sinon.stub() };
    });

    it('logs summary with no updates', () => {
      logDiffSummary(log, 'test', [{ id: '1' }], []);
      expect(log.info).to.have.been.calledWithMatch(/test: 1 to insert, 0 to update/);
      expect(log.info).to.have.been.calledWithMatch(/INSERT/);
    });

    it('logs update details and changed-field distribution', () => {
      const updateRow = {
        id: '1', name: 'New', _changedFields: ['name'], _existing: { name: 'Old' },
      };
      logDiffSummary(log, 'test', [], [updateRow]);
      expect(log.info).to.have.been.calledWithMatch(/UPDATE/);
      expect(log.info).to.have.been.calledWithMatch(/changed-field distribution/);
    });

    it('limits logged rows to 5 for inserts and updates', () => {
      const inserts = Array.from({ length: 10 }, (_, i) => ({ id: `${i}` }));
      logDiffSummary(log, 'test', inserts, []);
      // Only 5 INSERT lines + summary = 6 calls total
      const insertCalls = log.info.args.filter(([msg]) => msg.includes('INSERT'));
      expect(insertCalls).to.have.length(5);
    });
  });
});
