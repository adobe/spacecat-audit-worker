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
import { validateSemrushRows } from '../../src/strategic-recommendations-semrush/schema-validate.js';
import {
  TAG_VALUES, DELETED_VALUES, REQUIRED_FIELDS,
} from '../../src/strategic-recommendations-semrush/schema-derived.js';

const goodRow = (overrides = {}) => ({
  tag: 'Hidden Win',
  strategy: 'Defend the lead',
  strategy_reasoning: 'evidence',
  topic_id: 't-1',
  topic: 'Editing',
  volume: 100,
  adobe_mentions: 5,
  competitor_1: 'Canva',
  competitor_1_mentions: 3,
  category: 'Creative Cloud',
  prompt: 'best editor?',
  deleted: '',
  ...overrides,
});

describe('validateSemrushRows', () => {
  it('exposes the contract enums/required fields from the vendored schema', () => {
    expect(TAG_VALUES).to.include.members(['Hidden Win', 'Coverage Gap', 'Strategic Blindspot']);
    expect(DELETED_VALUES).to.include.members(['ignored', 'added']);
    expect(REQUIRED_FIELDS).to.include.members(['tag', 'strategy', 'topic_id', 'prompt']);
  });

  it('accepts a fully valid row', () => {
    expect(validateSemrushRows([goodRow()])).to.deep.equal({ valid: true, errors: [] });
  });

  it('accepts a row with nullable competitor fields and null deleted', () => {
    const row = goodRow({
      competitor_1: null, competitor_1_mentions: null, deleted: null,
    });
    expect(validateSemrushRows([row]).valid).to.equal(true);
  });

  it('rejects a non-array input', () => {
    expect(validateSemrushRows({}).valid).to.equal(false);
    expect(validateSemrushRows({}).errors[0]).to.include('not an array');
  });

  it('rejects a non-object row', () => {
    const res = validateSemrushRows([42]);
    expect(res.valid).to.equal(false);
    expect(res.errors[0]).to.include('not an object');
  });

  it('flags missing required fields', () => {
    const res = validateSemrushRows([{ tag: 'Hidden Win' }]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("missing required field 'strategy'");
  });

  it('flags a bad tag enum value', () => {
    const res = validateSemrushRows([goodRow({ tag: 'Nope' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("tag 'Nope' not in enum");
  });

  it('flags a bad deleted enum value', () => {
    const res = validateSemrushRows([goodRow({ deleted: 'maybe' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("deleted 'maybe' not in enum");
  });

  it('flags a non-string strategy', () => {
    const res = validateSemrushRows([goodRow({ strategy: 123 })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'strategy' must be a string");
  });

  it('flags an empty required string', () => {
    const res = validateSemrushRows([goodRow({ prompt: '' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'prompt' must be non-empty");
  });

  it('flags a non-integer numeric field', () => {
    const res = validateSemrushRows([goodRow({ volume: 1.5 })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'volume' must be an integer");
  });

  it('flags a negative numeric field', () => {
    const res = validateSemrushRows([goodRow({ adobe_mentions: -1 })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'adobe_mentions' must be >= 0");
  });
});
