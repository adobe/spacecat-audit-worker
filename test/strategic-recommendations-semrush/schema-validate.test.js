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
import {
  validateSemrushRows,
  validateCitationRows,
  validatePersonaRows,
} from '../../src/strategic-recommendations-semrush/schema-validate.js';
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

  it('flags a string field exceeding its maxLength', () => {
    const res = validateSemrushRows([goodRow({ strategy: 'x'.repeat(201) })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'strategy' exceeds maxLength 200");
  });

  it('flags an over-long nullable field (competitor_1)', () => {
    const res = validateSemrushRows([goodRow({ competitor_1: 'y'.repeat(201) })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'competitor_1' exceeds maxLength 200");
  });

  it('accepts a string field exactly at its maxLength', () => {
    expect(validateSemrushRows([goodRow({ prompt: 'p'.repeat(600) })]).valid).to.equal(true);
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

const goodCitation = (overrides = {}) => ({
  tag: 'Coverage Gap',
  strategy: 'Own the care topic',
  strategy_reasoning: 'No first-party coverage today.',
  prompt: 'how to clean a modular sofa',
  topic: 'sofa care',
  category: 'Furniture',
  region: 'US',
  intent: 'informational',
  type: 'howto',
  source_url: 'https://lovesac.com/care',
  prompt_reasoning: 'high-intent gap',
  deleted: '',
  ...overrides,
});

describe('validateCitationRows', () => {
  it('accepts a fully valid row', () => {
    expect(validateCitationRows([goodCitation()])).to.deep.equal({ valid: true, errors: [] });
  });

  it('accepts a free-form tag (no enum on the aux sheets)', () => {
    expect(validateCitationRows([goodCitation({ tag: 'Anything Goes' })]).valid).to.equal(true);
  });

  it('accepts EMPTY strategy / strategy_reasoning (leave-it-empty rule)', () => {
    const res = validateCitationRows([goodCitation({ strategy: '', strategy_reasoning: '' })]);
    expect(res.valid).to.equal(true);
  });

  it('accepts null nullable passthrough columns', () => {
    const row = goodCitation({
      topic: null,
      category: null,
      region: null,
      intent: null,
      type: null,
      source_url: null,
      prompt_reasoning: null,
      deleted: null,
    });
    expect(validateCitationRows([row]).valid).to.equal(true);
  });

  it('rejects a non-array input', () => {
    expect(validateCitationRows('nope').valid).to.equal(false);
    expect(validateCitationRows('nope').errors[0]).to.include('not an array');
  });

  it('rejects a non-object row', () => {
    const res = validateCitationRows([7]);
    expect(res.valid).to.equal(false);
    expect(res.errors[0]).to.include('not an object');
  });

  it('flags missing required fields (strategy present-but-empty is OK, missing is not)', () => {
    const res = validateCitationRows([{ tag: 'Coverage Gap', prompt: 'p' }]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("missing required field 'strategy'");
    expect(res.errors.join(' ')).to.include("missing required field 'strategy_reasoning'");
  });

  it('flags an empty prompt (minLength 1 still applies to prompt)', () => {
    const res = validateCitationRows([goodCitation({ prompt: '' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'prompt' must be non-empty");
  });

  it('flags a bad deleted enum value', () => {
    const res = validateCitationRows([goodCitation({ deleted: 'maybe' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("deleted 'maybe' not in enum");
  });

  it('flags a non-string passthrough column', () => {
    const res = validateCitationRows([goodCitation({ topic: 42 })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'topic' must be a string");
  });

  it('flags a source_url exceeding maxLength 2048', () => {
    const res = validateCitationRows([goodCitation({ source_url: `https://x/${'a'.repeat(2048)}` })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'source_url' exceeds maxLength 2048");
  });
});

describe('validatePersonaRows', () => {
  const goodPersona = (overrides = {}) => {
    const { source_url: _, ...rest } = goodCitation(overrides);
    return rest;
  };

  it('accepts a fully valid row (no source_url column)', () => {
    expect(validatePersonaRows([goodPersona()]).valid).to.equal(true);
  });

  it('rejects a non-array input', () => {
    expect(validatePersonaRows(null).valid).to.equal(false);
  });

  it('flags an empty prompt', () => {
    const res = validatePersonaRows([goodPersona({ prompt: '' })]);
    expect(res.valid).to.equal(false);
    expect(res.errors.join(' ')).to.include("'prompt' must be non-empty");
  });

  it('does not impose a source_url bound on personas (source_url is not a persona column)', () => {
    // A stray source_url longer than the citation cap is simply ignored — the
    // persona maxLengths map has no source_url entry, so no error is raised.
    const res = validatePersonaRows([goodPersona({ source_url: 'x'.repeat(5000) })]);
    expect(res.valid).to.equal(true);
  });
});
