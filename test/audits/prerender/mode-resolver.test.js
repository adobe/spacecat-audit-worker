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
import { resolveMode } from '../../../src/prerender/mode-resolver.js';

// Minimal context builder — resolveMode only reads data and auditContext
const ctx = (data = null, auditContext = {}) => ({ data, auditContext });

describe('resolveMode', () => {
  describe('isAiOnly', () => {
    it('returns isAiOnly=true when data is an object with mode=ai-only', () => {
      const result = resolveMode(ctx({ mode: 'ai-only' }));
      expect(result).to.deep.equal({
        isAiOnly: true, isCsv: false, isSlack: false, isNormal: false,
      });
    });

    it('returns isAiOnly=true when data is a JSON string with mode=ai-only', () => {
      expect(resolveMode(ctx(JSON.stringify({ mode: 'ai-only' }))).isAiOnly).to.be.true;
    });

    it('returns isAiOnly=false when data is malformed JSON', () => {
      expect(resolveMode(ctx('{invalid}')).isAiOnly).to.be.false;
    });

    it('returns isAiOnly=false when data.mode is absent', () => {
      expect(resolveMode(ctx({ scrapeJobId: 'abc' })).isAiOnly).to.be.false;
    });

    it('returns isAiOnly=false when data is null', () => {
      expect(resolveMode(ctx(null)).isAiOnly).to.be.false;
    });

    it('returns isAiOnly=false when data.mode is null in valid JSON', () => {
      expect(resolveMode(ctx(JSON.stringify({ mode: null }))).isAiOnly).to.be.false;
    });
  });

  describe('isCsv', () => {
    it('returns isCsv=true when auditContext.urls is a non-empty array', () => {
      const result = resolveMode(ctx(null, { urls: ['https://example.com/page'] }));
      expect(result).to.deep.equal({
        isAiOnly: false, isCsv: true, isSlack: false, isNormal: false,
      });
    });

    it('returns isCsv=false when auditContext.urls is an empty array', () => {
      expect(resolveMode(ctx(null, { urls: [] })).isCsv).to.be.false;
    });

    it('returns isCsv=false when auditContext.urls is absent', () => {
      expect(resolveMode(ctx(null, {})).isCsv).to.be.false;
    });
  });

  describe('isSlack', () => {
    it('returns isSlack=true when auditContext.slackContext.channelId is set', () => {
      const result = resolveMode(ctx(null, { slackContext: { channelId: 'C123ABC' } }));
      expect(result).to.deep.equal({
        isAiOnly: false, isCsv: false, isSlack: true, isNormal: false,
      });
    });

    it('returns isSlack=false when channelId is an empty string', () => {
      expect(resolveMode(ctx(null, { slackContext: { channelId: '' } })).isSlack).to.be.false;
    });

    it('returns isSlack=false when slackContext has no channelId', () => {
      expect(resolveMode(ctx(null, { slackContext: {} })).isSlack).to.be.false;
    });

    it('returns isSlack=false when slackContext is absent', () => {
      expect(resolveMode(ctx(null, {})).isSlack).to.be.false;
    });
  });

  describe('isNormal', () => {
    it('returns isNormal=true when data is null and auditContext is empty', () => {
      const result = resolveMode(ctx(null, {}));
      expect(result).to.deep.equal({
        isAiOnly: false, isCsv: false, isSlack: false, isNormal: true,
      });
    });

    it('returns isNormal=true when auditContext is null', () => {
      expect(resolveMode({ data: null, auditContext: null }).isNormal).to.be.true;
    });

    it('returns isNormal=true when auditContext is undefined', () => {
      expect(resolveMode({ data: null }).isNormal).to.be.true;
    });
  });

  describe('precedence — exactly one flag is true', () => {
    it('ai-only takes precedence over CSV urls', () => {
      const result = resolveMode(ctx({ mode: 'ai-only' }, { urls: ['https://example.com'] }));
      expect(result.isAiOnly).to.be.true;
      expect(result.isCsv).to.be.false;
    });

    it('ai-only takes precedence over Slack channelId', () => {
      const result = resolveMode(ctx({ mode: 'ai-only' }, { slackContext: { channelId: 'C1' } }));
      expect(result.isAiOnly).to.be.true;
      expect(result.isSlack).to.be.false;
    });

    it('CSV takes precedence over Slack when both are set', () => {
      const result = resolveMode(ctx(null, {
        urls: ['https://example.com'],
        slackContext: { channelId: 'C1' },
      }));
      expect(result.isCsv).to.be.true;
      expect(result.isSlack).to.be.false;
    });

    it('exactly one flag is true for every valid input combination', () => {
      const inputs = [
        ctx({ mode: 'ai-only' }),
        ctx(null, { urls: ['https://example.com'] }),
        ctx(null, { slackContext: { channelId: 'C1' } }),
        ctx(null, {}),
        ctx('{invalid}', { slackContext: { channelId: 'C1' } }),
        ctx(null, null),
      ];
      for (const input of inputs) {
        const result = resolveMode(input);
        const trueCount = [result.isAiOnly, result.isCsv, result.isSlack, result.isNormal]
          .filter(Boolean).length;
        expect(trueCount, `expected exactly one true flag for ${JSON.stringify(input)}`).to.equal(1);
      }
    });
  });
});
