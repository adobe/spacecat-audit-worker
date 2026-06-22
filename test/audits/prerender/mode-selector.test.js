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

import { expect } from 'chai';
import sinon from 'sinon';
import { isAiOnlyMode, buildUrlScopeForMode } from '../../../src/prerender/mode-selector.js';

describe('mode-selector', () => {
  describe('isAiOnlyMode', () => {
    it('returns true for ai-only', () => {
      expect(isAiOnlyMode('ai-only')).to.equal(true);
    });

    it('returns true for ai-only-current', () => {
      expect(isAiOnlyMode('ai-only-current')).to.equal(true);
    });

    it('returns true for ai-only-missing', () => {
      expect(isAiOnlyMode('ai-only-missing')).to.equal(true);
    });

    it('returns false for null', () => {
      expect(isAiOnlyMode(null)).to.equal(false);
    });

    it('returns false for undefined', () => {
      expect(isAiOnlyMode(undefined)).to.equal(false);
    });

    it('returns false for an arbitrary string', () => {
      expect(isAiOnlyMode('normal')).to.equal(false);
    });

    it('returns false for an empty string', () => {
      expect(isAiOnlyMode('')).to.equal(false);
    });
  });

  describe('buildUrlScopeForMode', () => {
    // Helper factory to create a suggestion mock
    const makeSuggestion = (id, status, data) => ({
      getId: sinon.stub().returns(id),
      getStatus: sinon.stub().returns(status),
      getData: sinon.stub().returns(data),
    });

    describe('MODE_AI_ONLY', () => {
      it('returns empty Set for empty suggestions', () => {
        const result = buildUrlScopeForMode('ai-only', []);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('includes NEW suggestions with valid URLs', () => {
        const suggestions = [
          makeSuggestion('s1', 'NEW', { url: 'https://example.com/page1' }),
          makeSuggestion('s2', 'PENDING_VALIDATION', { url: 'https://example.com/page2' }),
        ];
        const result = buildUrlScopeForMode('ai-only', suggestions);
        expect(result.size).to.equal(2);
        expect(result.has('https://example.com/page1')).to.equal(true);
        expect(result.has('https://example.com/page2')).to.equal(true);
      });

      it('excludes OUTDATED, SKIPPED, and FIXED suggestions', () => {
        const suggestions = [
          makeSuggestion('s-new', 'NEW', { url: 'https://example.com/new' }),
          makeSuggestion('s-outdated', 'OUTDATED', { url: 'https://example.com/outdated' }),
          makeSuggestion('s-skipped', 'SKIPPED', { url: 'https://example.com/skipped' }),
          makeSuggestion('s-fixed', 'FIXED', { url: 'https://example.com/fixed' }),
        ];
        const result = buildUrlScopeForMode('ai-only', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/new')).to.equal(true);
      });

      it('excludes edgeDeployed suggestions', () => {
        const suggestions = [
          makeSuggestion('s-deployed', 'NEW', { url: 'https://example.com/deployed', edgeDeployed: true }),
          makeSuggestion('s-normal', 'NEW', { url: 'https://example.com/normal' }),
        ];
        const result = buildUrlScopeForMode('ai-only', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/normal')).to.equal(true);
      });

      it('excludes isDomainWide, wildcard, and null-URL suggestions', () => {
        const suggestions = [
          makeSuggestion('s-dw', 'NEW', { url: 'https://example.com/dw', isDomainWide: true }),
          makeSuggestion('s-wild', 'NEW', { url: 'https://example.com/*' }),
          makeSuggestion('s-null', 'NEW', { url: null }),
          makeSuggestion('s-ok', 'NEW', { url: 'https://example.com/ok' }),
        ];
        const result = buildUrlScopeForMode('ai-only', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/ok')).to.equal(true);
      });
    });

    describe('MODE_AI_ONLY_CURRENT', () => {
      it('returns only NEW suggestions that are not covered/deployed/pattern-matched', () => {
        const suggestions = [
          makeSuggestion('s-eligible', 'NEW', {
            url: 'https://example.com/eligible',
          }),
          makeSuggestion('s-covered', 'NEW', {
            url: 'https://example.com/covered',
            coveredByDomainWide: true,
          }),
          makeSuggestion('s-deployed', 'NEW', {
            url: 'https://example.com/deployed',
            edgeDeployed: true,
          }),
          makeSuggestion('s-pattern', 'NEW', {
            url: 'https://example.com/pattern',
            coveredByPattern: true,
          }),
          makeSuggestion('s-fixed', 'FIXED', {
            url: 'https://example.com/fixed',
          }),
          makeSuggestion('s-domain-wide', 'NEW', {
            url: 'https://example.com/domain-wide',
            isDomainWide: true,
          }),
          makeSuggestion('s-wildcard', 'NEW', {
            url: 'https://example.com/*',
          }),
          makeSuggestion('s-no-url', 'NEW', {
            url: null,
          }),
        ];

        const result = buildUrlScopeForMode('ai-only-current', suggestions);

        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/eligible')).to.equal(true);
      });

      it('returns empty Set when all suggestions are filtered out', () => {
        const suggestions = [
          makeSuggestion('s-covered', 'NEW', {
            url: 'https://example.com/covered',
            coveredByDomainWide: true,
          }),
        ];

        const result = buildUrlScopeForMode('ai-only-current', suggestions);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('deduplicates URLs when multiple suggestions share the same URL', () => {
        const suggestions = [
          makeSuggestion('s1', 'NEW', { url: 'https://example.com/page' }),
          makeSuggestion('s2', 'NEW', { url: 'https://example.com/page' }),
        ];

        const result = buildUrlScopeForMode('ai-only-current', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/page')).to.equal(true);
      });

      it('returns empty Set when suggestions array is empty', () => {
        const result = buildUrlScopeForMode('ai-only-current', []);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('skips suggestions with null getData()', () => {
        const s = makeSuggestion('s-null', 'NEW', null);
        const result = buildUrlScopeForMode('ai-only-current', [s]);
        expect(result.size).to.equal(0);
      });
    });

    describe('MODE_AI_ONLY_MISSING', () => {
      it('returns NEW and FIXED suggestions without aiSummary', () => {
        const suggestions = [
          makeSuggestion('s-new-no-summary', 'NEW', {
            url: 'https://example.com/new-no-summary',
          }),
          makeSuggestion('s-fixed-no-summary', 'FIXED', {
            url: 'https://example.com/fixed-no-summary',
          }),
          makeSuggestion('s-new-has-summary', 'NEW', {
            url: 'https://example.com/has-summary',
            aiSummary: 'some text',
          }),
          makeSuggestion('s-new-empty-summary', 'NEW', {
            url: 'https://example.com/empty-summary',
            aiSummary: '',
          }),
          makeSuggestion('s-pending', 'PENDING_VALIDATION', {
            url: 'https://example.com/pending',
          }),
          makeSuggestion('s-domain-wide', 'NEW', {
            url: 'https://example.com/domain-wide',
            isDomainWide: true,
          }),
          makeSuggestion('s-wildcard', 'NEW', {
            url: 'https://example.com/*',
          }),
          makeSuggestion('s-no-url', 'NEW', {
            url: null,
          }),
        ];

        const result = buildUrlScopeForMode('ai-only-missing', suggestions);

        expect(result).to.be.instanceOf(Set);
        // s-new-no-summary, s-fixed-no-summary, s-new-empty-summary (empty string is falsy)
        expect(result.size).to.equal(3);
        expect(result.has('https://example.com/new-no-summary')).to.equal(true);
        expect(result.has('https://example.com/fixed-no-summary')).to.equal(true);
        expect(result.has('https://example.com/empty-summary')).to.equal(true);
        expect(result.has('https://example.com/has-summary')).to.equal(false);
        expect(result.has('https://example.com/pending')).to.equal(false);
      });

      it('treats empty string aiSummary as missing', () => {
        const suggestions = [
          makeSuggestion('s1', 'NEW', {
            url: 'https://example.com/page',
            aiSummary: '',
          }),
        ];

        const result = buildUrlScopeForMode('ai-only-missing', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/page')).to.equal(true);
      });

      it('returns empty Set when all suggestions have aiSummary', () => {
        const suggestions = [
          makeSuggestion('s1', 'NEW', {
            url: 'https://example.com/page',
            aiSummary: 'existing summary',
          }),
        ];

        const result = buildUrlScopeForMode('ai-only-missing', suggestions);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('deduplicates URLs', () => {
        const suggestions = [
          makeSuggestion('s1', 'NEW', { url: 'https://example.com/page' }),
          makeSuggestion('s2', 'FIXED', { url: 'https://example.com/page' }),
        ];

        const result = buildUrlScopeForMode('ai-only-missing', suggestions);
        expect(result.size).to.equal(1);
        expect(result.has('https://example.com/page')).to.equal(true);
      });

      it('returns empty Set when suggestions array is empty', () => {
        const result = buildUrlScopeForMode('ai-only-missing', []);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('skips suggestions with null getData()', () => {
        const s = makeSuggestion('s-null', 'NEW', null);
        const result = buildUrlScopeForMode('ai-only-missing', [s]);
        expect(result.size).to.equal(0);
      });
    });

    describe('unknown mode', () => {
      it('returns empty Set for an unrecognised mode string', () => {
        const result = buildUrlScopeForMode('some-other-mode', []);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });

      it('returns empty Set when mode is null', () => {
        const result = buildUrlScopeForMode(null, []);
        expect(result).to.be.instanceOf(Set);
        expect(result.size).to.equal(0);
      });
    });
  });
});
