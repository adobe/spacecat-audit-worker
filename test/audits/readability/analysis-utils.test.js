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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('analyzePageReadability', () => {
  let analyzePageReadability;
  let analyzePageContent;
  let mockGetObjectFromKey;
  let log;
  let s3Client;

  beforeEach(async () => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    s3Client = {};

    mockGetObjectFromKey = sinon.stub();

    const analysisUtils = await esmock(
      '../../../src/readability/shared/analysis-utils.js',
      {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: mockGetObjectFromKey,
        },
      },
    );

    analyzePageReadability = analysisUtils.analyzePageReadability;
    analyzePageContent = analysisUtils.analyzePageContent;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('empty scrapeResultPaths handling', () => {
    it('should return failure when scrapeResultPaths is undefined', async () => {
      const result = await analyzePageReadability(s3Client, 'test-bucket', undefined, log);

      expect(result).to.deep.equal({
        success: false,
        message: 'No scraped content found for readability analysis',
        readabilityIssues: [],
        urlsProcessed: 0,
      });
    });

    it('should return failure when scrapeResultPaths is null', async () => {
      const result = await analyzePageReadability(s3Client, 'test-bucket', null, log);

      expect(result).to.deep.equal({
        success: false,
        message: 'No scraped content found for readability analysis',
        readabilityIssues: [],
        urlsProcessed: 0,
      });
    });

    it('should return failure when scrapeResultPaths is empty', async () => {
      const result = await analyzePageReadability(s3Client, 'test-bucket', new Map(), log);

      expect(result).to.deep.equal({
        success: false,
        message: 'No scraped content found for readability analysis',
        readabilityIssues: [],
        urlsProcessed: 0,
      });
    });
  });

  describe('processing scraped pages', () => {
    it('should warn and skip when rawBody is missing in scraped data', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {},
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(log.warn).to.have.been.calledWith(
        '[ReadabilityAnalysis] No rawBody found in scraped data for URL: https://example.com/page1',
      );
      expect(result.urlsProcessed).to.equal(0);
    });

    it('should warn and skip when scrapeResult is missing', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(log.warn).to.have.been.calledWith(
        '[ReadabilityAnalysis] No rawBody found in scraped data for URL: https://example.com/page1',
      );
      expect(result.urlsProcessed).to.equal(0);
    });

    it('should handle errors when processing scraped data fails', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      mockGetObjectFromKey.rejects(new Error('S3 connection failed'));

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(log.error).to.have.been.calledWith(
        '[ReadabilityAnalysis] Error processing scraped data for URL https://example.com/page1: S3 connection failed',
      );
      expect(result.urlsProcessed).to.equal(0);
      expect(result.readabilityIssues).to.deep.equal([]);
    });

    it('should process valid scraped data and use finalUrl when available', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/original', 'scraped/page1.json'],
      ]);

      // HTML with content that has good readability (won't be flagged)
      const htmlContent = '<html><body><p>Short text here</p></body></html>';

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/redirected',
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(log.info).to.have.been.calledWith(
        '[ReadabilityAnalysis] Found 1 scraped objects for analysis',
      );
      expect(result.success).to.equal(false); // No issues found (good readability)
      expect(result.message).to.equal('No readability issues found');
    });

    it('should use original URL when finalUrl is not available', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page', 'scraped/page.json'],
      ]);

      const htmlContent = '<html><body><p>Short text</p></body></html>';

      mockGetObjectFromKey.resolves({
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(result).to.have.property('urlsProcessed');
      expect(result).to.have.property('readabilityIssues');
    });

    it('should process multiple pages in parallel', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
        ['https://example.com/page2', 'scraped/page2.json'],
        ['https://example.com/page3', 'scraped/page3.json'],
      ]);

      const htmlContent = '<html><body><p>Short simple text</p></body></html>';

      mockGetObjectFromKey.resolves({
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(mockGetObjectFromKey.callCount).to.equal(3);
      expect(log.info).to.have.been.calledWith(
        '[ReadabilityAnalysis] Found 3 scraped objects for analysis',
      );
    });

    it('should handle mixed success and failure when processing pages', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/success', 'scraped/success.json'],
        ['https://example.com/failure', 'scraped/failure.json'],
      ]);

      const htmlContent = '<html><body><p>Short text</p></body></html>';

      mockGetObjectFromKey
        .onFirstCall()
        .resolves({
          finalUrl: 'https://example.com/success',
          scrapeResult: { rawBody: htmlContent },
          scrapedAt: '2025-01-01T00:00:00Z',
        })
        .onSecondCall()
        .rejects(new Error('Network error'));

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(log.error).to.have.been.calledWith(
        '[ReadabilityAnalysis] Error processing scraped data for URL https://example.com/failure: Network error',
      );
      expect(result).to.have.property('readabilityIssues');
    });
  });

  describe('readability issues detection', () => {
    it('should detect and return pages with poor readability', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page', 'scraped/page.json'],
      ]);

      // Complex, hard-to-read English text that should trigger poor readability score
      const hardToReadText = `
        The epistemological ramifications of the aforementioned poststructuralist 
        conceptualizations necessitate a comprehensive reevaluation of the 
        phenomenological underpinnings that have heretofore characterized the 
        methodological frameworks employed in the operationalization of said 
        theoretical constructs within the interdisciplinary discourse.
      `;
      const htmlContent = `<html><body><p>${hardToReadText}</p></body></html>`;

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page',
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(result.readabilityIssues.length).to.be.greaterThan(0);
      expect(result.success).to.equal(true);
    });

    it('should limit results to top 50 issues', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page', 'scraped/page.json'],
      ]);

      // Create HTML with many paragraphs of hard-to-read text
      const hardToReadText = `The epistemological ramifications of the poststructuralist 
        conceptualizations necessitate comprehensive reevaluation of phenomenological 
        underpinnings characterizing methodological frameworks employed operationalization.`;

      const paragraphs = Array(60).fill(`<p>${hardToReadText}</p>`).join('');
      const htmlContent = `<html><body>${paragraphs}</body></html>`;

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page',
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      expect(result.readabilityIssues.length).to.be.at.most(50);
    });

    it('should sort issues by rank in descending order', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page', 'scraped/page.json'],
      ]);

      const hardToReadText1 = `The epistemological ramifications of poststructuralist conceptualizations 
        necessitate comprehensive reevaluation of phenomenological underpinnings.`;
      const hardToReadText2 = `Interdisciplinary methodological frameworks employed in operationalization 
        of theoretical constructs require systematic analysis of paradigmatic shifts.`;

      const htmlContent = `<html><body>
        <p>${hardToReadText1}</p>
        <p>${hardToReadText2}</p>
      </body></html>`;

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page',
        scrapeResult: { rawBody: htmlContent },
        scrapedAt: '2025-01-01T00:00:00Z',
      });

      const result = await analyzePageReadability(s3Client, 'test-bucket', scrapeResultPaths, log);

      if (result.readabilityIssues.length > 1) {
        for (let i = 0; i < result.readabilityIssues.length - 1; i += 1) {
          expect(result.readabilityIssues[i].rank).to.be.at.least(
            result.readabilityIssues[i + 1].rank,
          );
        }
      }
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors and return failure result', async () => {
      // Create a map-like object that throws on entries()
      const faultyMap = {
        size: 1,
        entries: () => {
          throw new Error('Unexpected map iteration error');
        },
      };

      const result = await analyzePageReadability(s3Client, 'test-bucket', faultyMap, log);

      expect(log.error).to.have.been.calledWith(
        '[ReadabilityAnalysis] Error analyzing readability: Unexpected map iteration error',
        sinon.match.instanceOf(Error),
      );
      expect(result).to.deep.equal({
        success: false,
        message: 'Analysis failed: Unexpected map iteration error',
        readabilityIssues: [],
        urlsProcessed: 0,
      });
    });
  });
});

describe('analyzePageContent', () => {
  let analyzePageContentWithMockedCheerio;
  let log;

  beforeEach(async () => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should handle error during page content analysis and return empty issues', async () => {
    // Mock cheerio to throw an error
    const mockCheerioLoad = sinon.stub().throws(new Error('Cheerio parsing failed'));

    const analysisUtils = await esmock(
      '../../../src/readability/shared/analysis-utils.js',
      {
        cheerio: {
          load: mockCheerioLoad,
        },
      },
    );

    analyzePageContentWithMockedCheerio = analysisUtils.analyzePageContent;

    const result = await analyzePageContentWithMockedCheerio(
      '<html><body></body></html>',
      'https://example.com/page',
      0,
      log,
      '2025-01-01T00:00:00Z',
    );

    expect(log.error).to.have.been.calledWith(
      '[ReadabilityAnalysis] Error analyzing page content for https://example.com/page: Cheerio parsing failed',
    );
    expect(result).to.deep.equal([]);
  });
});

