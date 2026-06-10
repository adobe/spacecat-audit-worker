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

import { expect } from 'chai';
import { mergeSemrushRows } from '../../src/strategic-recommendations-semrush/merge.js';

const baseRow = (overrides = {}) => ({
  tag: 'Hidden Win',
  strategy: 'Defend the lead',
  strategy_reasoning: 'because',
  topic_id: 't-1',
  topic: 'Online Image Editing',
  volume: 1000,
  adobe_mentions: 50,
  category: 'Creative Cloud',
  prompt: 'best free online photo editor?',
  deleted: '',
  ...overrides,
});

describe('mergeSemrushRows', () => {
  it('preserves an existing "ignored" marker by (topic_id, prompt)', () => {
    const existing = [baseRow({ deleted: 'ignored' })];
    const incoming = [baseRow({ deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged).to.have.length(1);
    expect(merged[0].deleted).to.equal('ignored');
  });

  it('preserves an existing "added" marker by (topic_id, prompt)', () => {
    const existing = [baseRow({ deleted: 'added' })];
    const incoming = [baseRow({ deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('added');
  });

  it('adds brand-new rows that have no prior match', () => {
    const existing = [baseRow({ topic_id: 't-1', prompt: 'old prompt', deleted: 'ignored' })];
    const incoming = [
      baseRow({ topic_id: 't-1', prompt: 'old prompt' }),
      baseRow({ topic_id: 't-2', prompt: 'a wholly new prompt', deleted: '' }),
    ];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged).to.have.length(2);
    expect(merged[0].deleted).to.equal('ignored');
    // the new row keeps its active default
    expect(merged[1].deleted).to.equal('');
  });

  it('does NOT inherit deletion when the prompt text is rephrased (best-effort)', () => {
    // Same topic_id, but a regeneration rephrased the prompt — match misses.
    const existing = [baseRow({ topic_id: 't-1', prompt: 'best free online photo editor?', deleted: 'ignored' })];
    const incoming = [baseRow({ topic_id: 't-1', prompt: 'which free online photo editor is best?', deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('');
  });

  it('does NOT inherit deletion across different topic_id even with same prompt', () => {
    const existing = [baseRow({ topic_id: 't-1', prompt: 'same prompt', deleted: 'ignored' })];
    const incoming = [baseRow({ topic_id: 't-2', prompt: 'same prompt', deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('');
  });

  it('ignores empty/null markers on existing rows (nothing to preserve)', () => {
    const existing = [
      baseRow({ topic_id: 't-1', prompt: 'p1', deleted: '' }),
      baseRow({ topic_id: 't-2', prompt: 'p2', deleted: null }),
    ];
    const incoming = [
      baseRow({ topic_id: 't-1', prompt: 'p1', deleted: 'added' }),
      baseRow({ topic_id: 't-2', prompt: 'p2', deleted: 'ignored' }),
    ];

    const merged = mergeSemrushRows(existing, incoming);

    // existing had no marker, so incoming rows keep their own values
    expect(merged[0].deleted).to.equal('added');
    expect(merged[1].deleted).to.equal('ignored');
  });

  it('is a pure function — does not mutate inputs and returns fresh objects', () => {
    const existingRow = baseRow({ deleted: 'ignored' });
    const incomingRow = baseRow({ deleted: '' });
    const existing = [existingRow];
    const incoming = [incomingRow];

    const merged = mergeSemrushRows(existing, incoming);

    expect(incomingRow.deleted).to.equal(''); // input untouched
    expect(merged[0]).to.not.equal(incomingRow); // fresh object
  });

  it('handles non-array / nullish inputs gracefully', () => {
    expect(mergeSemrushRows(null, null)).to.deep.equal([]);
    expect(mergeSemrushRows(undefined, [baseRow()])).to.have.length(1);
    expect(mergeSemrushRows([baseRow({ deleted: 'ignored' })], null)).to.deep.equal([]);
  });

  it('tolerates malformed rows (missing keys / non-objects) without throwing', () => {
    const existing = [null, { deleted: 'ignored' }, baseRow({ deleted: 'ignored' })];
    const incoming = [null, 42, baseRow({ deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0]).to.equal(null);
    expect(merged[1]).to.equal(42);
    expect(merged[2].deleted).to.equal('ignored');
  });

  it('returns a fresh copy for an incoming row that lacks match-key fields', () => {
    const existing = [baseRow({ deleted: 'ignored' })];
    // incoming object row missing topic_id -> matchKey is null, no carry-over
    const incoming = [{ prompt: 'orphan', deleted: '' }];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('');
    expect(merged[0]).to.not.equal(incoming[0]);
  });

  it('skips an existing row that lacks match-key fields when collecting markers', () => {
    const existing = [{ deleted: 'ignored', prompt: 'no-topic-id' }];
    const incoming = [baseRow({ deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('');
  });

  it('first marker wins on duplicate (topic_id, prompt) existing rows', () => {
    const existing = [
      baseRow({ topic_id: 't-1', prompt: 'p', deleted: 'ignored' }),
      baseRow({ topic_id: 't-1', prompt: 'p', deleted: 'added' }),
    ];
    const incoming = [baseRow({ topic_id: 't-1', prompt: 'p', deleted: '' })];

    const merged = mergeSemrushRows(existing, incoming);

    expect(merged[0].deleted).to.equal('ignored');
  });
});
