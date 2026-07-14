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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(chaiAsPromised);
use(sinonChai);

describe('Prerender html-comparator', () => {
  let sandbox;
  let analyzeHtmlForPrerender;
  let isFontDetectionLeaf;
  let calculateStatsStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    calculateStatsStub = sandbox.stub().resolves({
      contentIncreaseRatio: 1.5,
      wordCountBefore: 100,
      wordCountAfter: 150,
      citationReadability: 0.8,
      wordDiff: 50,
    });

    ({ analyzeHtmlForPrerender, isFontDetectionLeaf } = await esmock(
      '../../../src/prerender/utils/html-comparator.js',
      {
        '@adobe/spacecat-shared-html-analyzer': { calculateStats: calculateStatsStub },
      },
    ));
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isFontDetectionLeaf', () => {
    it('returns false for empty string', () => {
      expect(isFontDetectionLeaf('')).to.equal(false);
    });

    it('returns false for falsy input', () => {
      expect(isFontDetectionLeaf(null)).to.equal(false);
      expect(isFontDetectionLeaf(undefined)).to.equal(false);
    });

    it('returns true for the bare mmMwWLliI0fiflO test string', () => {
      expect(isFontDetectionLeaf('mmMwWLliI0fiflO')).to.equal(true);
    });

    it('returns true for mmMwWLliI0fiflO with &N suffix variants', () => {
      expect(isFontDetectionLeaf('mmMwWLliI0fiflO&1')).to.equal(true);
      expect(isFontDetectionLeaf('mmMwWLliI0fiflO&2')).to.equal(true);
    });

    it('returns false when mmMwWLliI0fiflO appears mid-text, not at start', () => {
      expect(isFontDetectionLeaf('some text mmMwWLliI0fiflO')).to.equal(false);
    });

    it('returns true for 10+ space-separated "word" tokens', () => {
      expect(isFontDetectionLeaf(Array(10).fill('word').join(' '))).to.equal(true);
      expect(isFontDetectionLeaf(Array(20).fill('word').join(' '))).to.equal(true);
    });

    it('returns false for fewer than 10 "word" tokens', () => {
      expect(isFontDetectionLeaf('word word word')).to.equal(false);
      expect(isFontDetectionLeaf(Array(9).fill('word').join(' '))).to.equal(false);
    });

    it('returns false when tokens include non-"word" words', () => {
      const mixed = `${Array(10).fill('word').join(' ')} door`;
      expect(isFontDetectionLeaf(mixed)).to.equal(false);
    });

    it('returns false for legitimate prose', () => {
      expect(isFontDetectionLeaf('The right word in the right context matters.')).to.equal(false);
    });
  });

  describe('analyzeHtmlForPrerender', () => {
    it('throws when directHtml is missing', async () => {
      await expect(analyzeHtmlForPrerender(null, '<html><body>content</body></html>'))
        .to.be.rejectedWith('Missing HTML content for comparison');
    });

    it('throws when scrapedHtml is missing', async () => {
      await expect(analyzeHtmlForPrerender('<html><body>content</body></html>', null))
        .to.be.rejectedWith('Missing HTML content for comparison');
    });

    it('returns needsPrerender true when ratio meets threshold', async () => {
      const result = await analyzeHtmlForPrerender(
        '<html><body>direct</body></html>',
        '<html><body>scraped</body></html>',
      );
      expect(result.needsPrerender).to.equal(true);
      expect(result.contentGainRatio).to.equal(1.5);
    });

    it('returns needsPrerender false when ratio is below threshold', async () => {
      calculateStatsStub.resolves({ contentIncreaseRatio: 1.1, wordCountBefore: 100, wordCountAfter: 110, citationReadability: 0.9, wordDiff: 10 });
      const result = await analyzeHtmlForPrerender(
        '<html><body>direct</body></html>',
        '<html><body>scraped</body></html>',
      );
      expect(result.needsPrerender).to.equal(false);
    });

    it('strips font-detection noise from scrapedHtml before analysis', async () => {
      const directHtml = '<html><body><p>Real content</p></body></html>';
      const noise = Array(15).fill('word').join(' ');
      const scrapedHtml = `<html><body><p>Real content</p><span>${noise}</span></body></html>`;

      await analyzeHtmlForPrerender(directHtml, scrapedHtml);

      const [, filteredScraped] = calculateStatsStub.firstCall.args;
      expect(filteredScraped).to.not.include(noise);
      expect(filteredScraped).to.include('Real content');
    });

    it('strips mmMwWLliI0fiflO spans from scrapedHtml before analysis', async () => {
      const directHtml = '<html><body><p>Real content</p></body></html>';
      const scrapedHtml = '<html><body><p>Real content</p><span style="white-space:nowrap">mmMwWLliI0fiflO&amp;1</span></body></html>';

      await analyzeHtmlForPrerender(directHtml, scrapedHtml);

      const [, filteredScraped] = calculateStatsStub.firstCall.args;
      expect(filteredScraped).to.not.include('mmMwWLliI0fiflO');
      expect(filteredScraped).to.include('Real content');
    });

    it('does not strip legitimate content from scrapedHtml', async () => {
      const directHtml = '<html><body><p>Content</p></body></html>';
      const scrapedHtml = '<html><body><p>Content</p><p>Use the right word for each context</p></body></html>';

      await analyzeHtmlForPrerender(directHtml, scrapedHtml);

      const [, filteredScraped] = calculateStatsStub.firstCall.args;
      expect(filteredScraped).to.include('Use the right word for each context');
    });
  });
});
