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

import { createHash } from 'node:crypto';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import {
  detectFromHtml,
  detectExistingContent,
  computeContentHash,
} from '../../../src/summarization/existing-content-detector.js';

use(sinonChai);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

describe('existing-content-detector', () => {
  describe('computeContentHash', () => {
    it('should return a SHA-256 hex string for a non-empty string', () => {
      const hash = computeContentHash('<h1>Hello</h1>');
      expect(hash).to.be.a('string').with.lengthOf(64);
      expect(hash).to.equal(sha256('<h1>Hello</h1>'));
    });

    it('should return the same hash for identical input', () => {
      const html = '<html><body><p>Same content</p></body></html>';
      expect(computeContentHash(html)).to.equal(computeContentHash(html));
    });

    it('should return different hashes for different input', () => {
      expect(computeContentHash('<p>content A</p>')).not.to.equal(computeContentHash('<p>content B</p>'));
    });

    it('should return null for empty string', () => {
      expect(computeContentHash('')).to.be.null;
    });

    it('should return null for null', () => {
      expect(computeContentHash(null)).to.be.null;
    });

    it('should return null for undefined', () => {
      expect(computeContentHash(undefined)).to.be.null;
    });

    it('should return null for non-string input', () => {
      expect(computeContentHash(123)).to.be.null;
      expect(computeContentHash({})).to.be.null;
    });
  });

  describe('detectFromHtml', () => {
    it('should return false for both when HTML has no summary/key-points headings', () => {
      const html = '<html><body><h1>Introduction</h1><h2>Details</h2></body></html>';
      const result = detectFromHtml(html);
      expect(result).to.include({ hasSummary: false, hasKeyPoints: false });
      expect(result.contentHash).to.equal(sha256(html));
    });

    it('should detect summary when heading matches SUMMARY_HEADINGS', () => {
      const html = '<html><body><h1>Summary</h1><p>Content</p></body></html>';
      const result = detectFromHtml(html);
      expect(result).to.include({ hasSummary: true, hasKeyPoints: false });
      expect(result.contentHash).to.equal(sha256(html));
    });

    it('should detect key points when heading matches KEY_POINTS_HEADINGS', () => {
      const html = '<html><body><h2>Key Points</h2><ul><li>Point 1</li></ul></body></html>';
      const result = detectFromHtml(html);
      expect(result).to.include({ hasSummary: false, hasKeyPoints: true });
      expect(result.contentHash).to.equal(sha256(html));
    });

    it('should detect both when page has summary and key points headings', () => {
      const html = '<html><body><h1>Overview</h1><h2>Key Takeaways</h2></body></html>';
      const result = detectFromHtml(html);
      expect(result).to.include({ hasSummary: true, hasKeyPoints: true });
      expect(result.contentHash).to.equal(sha256(html));
    });

    it('should match headings case-insensitively', () => {
      expect(detectFromHtml('<h1>SUMMARY</h1>')).to.include({ hasSummary: true, hasKeyPoints: false });
      expect(detectFromHtml('<h2>Key Takeaways</h2>')).to.include({ hasSummary: false, hasKeyPoints: true });
    });

    it('should match all SUMMARY_HEADINGS variants', () => {
      const variants = ['summary', 'overview', 'tl;dr', 'tldr', 'executive summary', 'abstract'];
      variants.forEach((title) => {
        expect(detectFromHtml(`<h1>${title}</h1>`)).to.have.property('hasSummary', true);
      });
    });

    it('should match all KEY_POINTS_HEADINGS variants', () => {
      const variants = [
        'key points', 'key takeaways', 'main highlights',
        "what you'll learn", 'what you will learn',
        'highlights', 'main points', 'takeaways',
      ];
      variants.forEach((title) => {
        expect(detectFromHtml(`<h2>${title}</h2>`)).to.have.property('hasKeyPoints', true);
      });
    });

    it('should return null contentHash for empty or invalid input', () => {
      expect(detectFromHtml('')).to.deep.equal({ hasSummary: false, hasKeyPoints: false, contentHash: null });
      expect(detectFromHtml(null)).to.deep.equal({ hasSummary: false, hasKeyPoints: false, contentHash: null });
      expect(detectFromHtml(undefined)).to.deep.equal({ hasSummary: false, hasKeyPoints: false, contentHash: null });
    });

    it('should return null contentHash when rawBody is not a string', () => {
      expect(detectFromHtml(123)).to.deep.equal({ hasSummary: false, hasKeyPoints: false, contentHash: null });
      expect(detectFromHtml({})).to.deep.equal({ hasSummary: false, hasKeyPoints: false, contentHash: null });
    });

    it('should return defaults with contentHash when cheerio parse throws', async () => {
      const html = '<h1>Summary</h1>';
      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        cheerio: { load: () => { throw new Error('parse error'); } },
      });
      const result = detector.detectFromHtml(html);
      expect(result).to.include({ hasSummary: false, hasKeyPoints: false });
      expect(result.contentHash).to.equal(sha256(html));
    });

    it('should trim heading text before matching', () => {
      expect(detectFromHtml('<h1>  Summary  </h1>')).to.include({ hasSummary: true, hasKeyPoints: false });
    });
  });

  describe('detectExistingContent', () => {
    let sandbox;
    let log;
    let mockGetObjectFromKey;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      log = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      };
      mockGetObjectFromKey = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should return empty Map when scrapeResultPaths is empty', async () => {
      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      const result = await detector.detectExistingContent({}, 'bucket', new Map(), log);
      expect(result.size).to.equal(0);
      expect(mockGetObjectFromKey).not.to.have.been.called;
    });

    it('should return empty Map when scrapeResultPaths is null', async () => {
      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      const result = await detector.detectExistingContent({}, 'bucket', null, log);
      expect(result.size).to.equal(0);
    });

    it('should detect content and compute contentHash for each URL from S3', async () => {
      const rawBody1 = '<h1>Summary</h1><p>Content</p>';
      const rawBody2 = '<h2>Key Points</h2><ul><li>1</li></ul>';
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'path1/scrape.json'],
        ['https://example.com/page2', 'path2/scrape.json'],
      ]);
      mockGetObjectFromKey
        .onFirstCall().resolves({ scrapeResult: { rawBody: rawBody1 } })
        .onSecondCall().resolves({ scrapeResult: { rawBody: rawBody2 } });

      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      const result = await detector.detectExistingContent(
        { s3: true },
        'test-bucket',
        scrapeResultPaths,
        log,
      );

      expect(result.size).to.equal(2);
      expect(result.get('https://example.com/page1')).to.deep.equal({
        hasSummary: true,
        hasKeyPoints: false,
        contentHash: sha256(rawBody1),
      });
      expect(result.get('https://example.com/page2')).to.deep.equal({
        hasSummary: false,
        hasKeyPoints: true,
        contentHash: sha256(rawBody2),
      });
      expect(mockGetObjectFromKey).to.have.been.calledTwice;
    });

    it('should return null contentHash and false flags when rawBody is missing', async () => {
      const scrapeResultPaths = new Map([['https://example.com/page', 'path/scrape.json']]);
      mockGetObjectFromKey.resolves({ scrapeResult: {} });

      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      const result = await detector.detectExistingContent(
        {},
        'bucket',
        scrapeResultPaths,
        log,
      );

      expect(result.get('https://example.com/page')).to.deep.equal({
        hasSummary: false,
        hasKeyPoints: false,
        contentHash: null,
      });
      expect(log.warn).to.have.been.calledWith('[Summarization] No rawBody for https://example.com/page');
    });

    it('should handle S3 fetch errors gracefully', async () => {
      const scrapeResultPaths = new Map([['https://example.com/page', 'path/scrape.json']]);
      mockGetObjectFromKey.rejects(new Error('S3 error'));

      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      const result = await detector.detectExistingContent(
        {},
        'bucket',
        scrapeResultPaths,
        log,
      );

      expect(result.get('https://example.com/page')).to.deep.equal({
        hasSummary: false,
        hasKeyPoints: false,
        contentHash: null,
      });
      expect(log.error).to.have.been.calledWith('[Summarization] Error detecting content for https://example.com/page: S3 error');
    });

    it('should log excluded count when pages have both summary and key points', async () => {
      const rawBody = '<h1>Overview</h1><h2>Key Takeaways</h2>';
      const scrapeResultPaths = new Map([
        ['https://example.com/full', 'path1/scrape.json'],
      ]);
      mockGetObjectFromKey.resolves({ scrapeResult: { rawBody } });

      const detector = await esmock('../../../src/summarization/existing-content-detector.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: mockGetObjectFromKey },
      });
      await detector.detectExistingContent({}, 'bucket', scrapeResultPaths, log);

      expect(log.info).to.have.been.calledWith(
        '[Summarization] Pre-check: 1 page(s) already have summary and key points, excluded from Mystique',
      );
    });
  });
});
