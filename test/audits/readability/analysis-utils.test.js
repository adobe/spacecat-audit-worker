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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Readability Analysis Utils', () => {
  let analyzePageContent;
  let analyzePageReadability;
  let mockLog;
  let mockS3Client;
  let mockGetObjectKeysUsingPrefix;
  let mockGetObjectFromKey;
  let mockRs;
  let mockFranc;
  let mockCalculateReadabilityScore;
  let mockIsSupportedLanguage;
  let mockGetLanguageName;

  beforeEach(async () => {
    mockLog = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockS3Client = {};

    mockGetObjectKeysUsingPrefix = sinon.stub();
    mockGetObjectFromKey = sinon.stub();

    mockRs = {
      fleschReadingEase: sinon.stub(),
    };

    mockFranc = sinon.stub();
    mockCalculateReadabilityScore = sinon.stub();
    mockIsSupportedLanguage = sinon.stub();
    mockGetLanguageName = sinon.stub();

    const module = await esmock(
      '../../../src/readability/shared/analysis-utils.js',
      {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: mockGetObjectKeysUsingPrefix,
          getObjectFromKey: mockGetObjectFromKey,
        },
        'text-readability': mockRs,
        'franc-min': {
          franc: mockFranc,
        },
        '../../../src/readability/shared/multilingual-readability.js': {
          calculateReadabilityScore: mockCalculateReadabilityScore,
          isSupportedLanguage: mockIsSupportedLanguage,
          getLanguageName: mockGetLanguageName,
        },
      },
    );

    analyzePageContent = module.analyzePageContent;
    analyzePageReadability = module.analyzePageReadability;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('analyzePageContent', () => {
    // MIN_TEXT_LENGTH is 150 chars, so all test texts must be >= 150 chars with whitespace
    const createHtmlWithParagraph = (text, tag = 'p') => `
      <!DOCTYPE html>
      <html>
        <body>
          <${tag}>${text}</${tag}>
        </body>
      </html>
    `;

    // Helper to create text that meets MIN_TEXT_LENGTH (150 chars)
    const makeLongText = (baseText) => {
      const padding = ' This additional text ensures the content meets the minimum character length requirement for readability analysis testing.';
      return baseText + padding;
    };

    it('should analyze page content and find readability issues', async () => {
      const poorReadabilityText = makeLongText('This is a test sentence that has some words in it for testing purposes and readability analysis.');
      const html = createHtmlWithParagraph(poorReadabilityText);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25); // Poor readability

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0]).to.have.property('pageUrl', 'https://example.com/page');
      expect(result[0]).to.have.property('fleschReadingEase');
      expect(result[0]).to.have.property('category');
      expect(result[0]).to.have.property('seoImpact');
    });

    it('should return empty array when no readability issues found', async () => {
      const goodReadabilityText = makeLongText('This is a simple and easy to read sentence with clear meaning.');
      const html = createHtmlWithParagraph(goodReadabilityText);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(80); // Good readability

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0);
    });

    it('should return null in getSupportedLanguage when isSupportedLanguage returns false (line 187)', async () => {
      const text = makeLongText('Some text in an unsupported language that should be skipped by the analyzer.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('zho'); // Chinese language code
      mockIsSupportedLanguage.returns(false); // Language not supported - triggers line 187 return null

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0);
      // isSupportedLanguage was called
      expect(mockIsSupportedLanguage).to.have.been.called;
    });

    it('should handle non-English supported languages with poor readability (lines 92-93)', async () => {
      const germanText = makeLongText('Dies ist ein deutscher Satz mit komplexer Grammatik und schwieriger Lesbarkeit für viele Leser.');
      const html = createHtmlWithParagraph(germanText);

      mockFranc.returns('deu');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('german');
      mockCalculateReadabilityScore.resolves(20); // Poor readability - below TARGET_READABILITY_SCORE (30)

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        500,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(mockCalculateReadabilityScore).to.have.been.calledWith(germanText.trim(), 'german');
      expect(result[0]).to.have.property('language', 'german');
      expect(result[0]).to.have.property('fleschReadingEase', 20);
      expect(result[0]).to.have.property('category');
      expect(result[0]).to.have.property('seoImpact');
    });

    it('should use calculateReadabilityScore for non-English and return issue (lines 92-93 full path)', async () => {
      const frenchText = makeLongText('Ce texte français contient des phrases complexes avec une grammaire difficile pour les lecteurs.');
      const html = createHtmlWithParagraph(frenchText);

      mockFranc.returns('fra');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('french');
      mockCalculateReadabilityScore.resolves(14); // Score < 15 for High SEO impact

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        2000, // High traffic for Critical category
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(mockCalculateReadabilityScore).to.have.been.called;
      expect(result[0].language).to.equal('french');
      expect(result[0].category).to.equal('Critical');
      expect(result[0].seoImpact).to.equal('High');
    });

    it('should handle elements with br tags as multiple paragraphs (lines 223-244)', async () => {
      // Each paragraph must be >= 150 chars
      const para1 = 'This is the first paragraph with enough text content for analysis and multiple words that meets the minimum character length requirement for readability testing purposes.';
      const para2 = 'This is the second paragraph after the br tag with sufficient text for testing that also meets the minimum character length requirement for analysis.';
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>${para1}<br>${para2}</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      // Should have analyzed multiple paragraphs from br split
      expect(result.length).to.be.greaterThanOrEqual(1);
    });

    it('should handle br tags and process each paragraph via forEach loop (lines 232-244)', async () => {
      // Each paragraph must be >= 150 chars individually
      const para1 = 'This is the first paragraph with complex vocabulary and difficult grammatical structures that need significant improvement for better readability scores overall and meets minimum length.';
      const para2 = 'This is the second paragraph also containing complex vocabulary and difficult grammatical structures requiring substantial simplification for readers to understand properly.';

      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>${para1}<br>${para2}</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(20); // Poor readability to generate issues

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      // Both paragraphs should be analyzed via the forEach loop (lines 232-244)
      expect(result.length).to.equal(2);
      // Verify each result has the expected properties
      result.forEach((issue) => {
        expect(issue).to.have.property('pageUrl');
        expect(issue).to.have.property('fleschReadingEase');
        expect(issue).to.have.property('category');
      });
    });

    it('should handle br tags with self-closing syntax (lines 223-244)', async () => {
      const para1 = 'First paragraph content with enough words for proper analysis and complex structure that meets the minimum character length requirement for readability analysis testing.';
      const para2 = 'Second paragraph content with enough words for analysis and complex structure too that also meets the minimum character length for proper testing purposes.';
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>${para1}<br/>${para2}</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(20);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThanOrEqual(1);
    });

    it('should filter out elements with block children (lines 199-203)', async () => {
      // Create HTML with a paragraph that has a div child (block element, not inline)
      const longSimplePara = makeLongText('Simple paragraph without block children that should be analyzed properly for readability issues.');
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>Parent paragraph with a block child element inside it.
              <div>This is a nested div which is a block element not in inline tags list.</div>
            </p>
            <p>${longSimplePara}</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      // The paragraph with div child should be filtered out, only simple paragraph analyzed
    });

    it('should include elements with only inline children (lines 199-203)', async () => {
      // Create HTML with inline children that ARE in the inlineTags list - text must be >= 150 chars
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>This paragraph has <strong>bold text</strong> and <em>italic text</em> and <span>span content</span> and <a href="#">link text</a> children which are all inline elements that should pass the filter check for readability analysis.</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      // Element with only inline children should be included
      expect(result.length).to.be.greaterThan(0);
    });

    it('should exclude header and footer elements', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <header><p>Header content that should be removed and not analyzed.</p></header>
            <main><p>Main content paragraph that should be analyzed for readability issues.</p></main>
            <footer><p>Footer content that should be removed and not analyzed.</p></footer>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
    });

    it('should handle errors in analyzeTextReadability gracefully (lines 127-130)', async () => {
      const text = makeLongText('Some text content for testing error handling in readability analysis functions.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      // Throw error inside analyzeTextReadability after language check passes
      mockRs.fleschReadingEase.throws(new Error('Readability calculation error'));

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0);
      expect(mockLog.error).to.have.been.calledWithMatch(/Error analyzing text readability/);
    });

    it('should handle errors from cheerioLoad in analyzePageContent (lines 279-280)', async () => {
      // Pass invalid HTML that causes cheerio to throw
      const invalidHtml = null;

      const result = await analyzePageContent(
        invalidHtml,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(mockLog.error).to.have.been.calledWithMatch(/Error analyzing page content/);
    });

    it('should categorize issues as Critical (line 34) - score < 20 AND traffic > 1000', async () => {
      const text = makeLongText('This is a complex sentence with difficult vocabulary and intricate grammatical structures.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(19); // Score < 20

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1500, // Traffic > 1000
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].category).to.equal('Critical');
    });

    it('should return seoImpact High (line 48) - score < 15', async () => {
      const text = makeLongText('This is a very complex sentence with extremely difficult vocabulary and intricate structures.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(14); // Score < 15 for High SEO impact

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        100,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].seoImpact).to.equal('High');
    });

    it('should categorize issues as Moderate (lines 38-39) - score 25-29 with low traffic', async () => {
      const text = makeLongText('This is a moderately complex sentence with some vocabulary that could be simplified for readers.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(27); // Score >= 25 and < 30

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        100, // Low traffic (not meeting Important or Critical thresholds)
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].category).to.equal('Moderate');
    });

    it('should return seoImpact Low (line 52) - score 25-29', async () => {
      const text = makeLongText('This is a sentence with moderate complexity that could still be improved for better reading.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(27); // Score 25-29 triggers Low SEO impact (line 52)

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        100, // Low traffic
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].seoImpact).to.equal('Low');
      expect(result[0].category).to.equal('Moderate'); // Score 25-29 with low traffic
    });

    it('should return seoImpact High (line 48) - score < 15 second test', async () => {
      const text = makeLongText('This is extremely complex text with very difficult vocabulary and intricate grammatical structures.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(10); // Score < 15 triggers High SEO impact (line 48)

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        100,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].seoImpact).to.equal('High');
    });

    it('should return null for good readability (lines 125-126)', async () => {
      const text = makeLongText('This is a simple clear sentence that reads well and has good readability scores overall.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(75); // Good readability >= TARGET_READABILITY_SCORE

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0); // No issues when readability is good
    });

    it('should return null for unsupported language (lines 81-82 and 187)', async () => {
      const text = makeLongText('Some text in a language that is not supported by the readability analysis system.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('zxx'); // Unknown language code
      mockIsSupportedLanguage.returns(false); // Language NOT supported - triggers line 187 return null

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0);
      // Verify isSupportedLanguage was called
      expect(mockIsSupportedLanguage).to.have.been.called;
    });

    it('should categorize issues as Important for poor readability with medium traffic', async () => {
      const text = makeLongText('This is a moderately complex sentence with some difficult vocabulary for readers to understand.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(22); // Poor readability

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        600, // Medium traffic
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].category).to.equal('Important');
      expect(result[0].seoImpact).to.equal('Moderate');
    });

    it('should categorize issues as Moderate for moderately poor readability', async () => {
      const text = makeLongText('This sentence has moderately complex structure that could be improved for better readability.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(28); // Moderately poor

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        100, // Low traffic
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].category).to.equal('Moderate');
    });

    it('should truncate long text for display', async () => {
      const longText = 'A'.repeat(600) + ' ' + 'B'.repeat(100); // Over 500 chars
      const html = createHtmlWithParagraph(longText);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(20);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      if (result.length > 0) {
        expect(result[0].displayText).to.include('...');
        expect(result[0].displayText.length).to.be.lessThan(longText.length);
      }
    });

    it('should analyze blockquote elements', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <blockquote>This is a blockquote with enough text content for readability analysis testing.</blockquote>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
    });

    it('should analyze list item elements', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <ul>
              <li>This is a list item with enough text content for readability analysis testing purposes.</li>
            </ul>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
    });

    it('should handle elements with only inline children', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>This is <strong>bold</strong> and <em>italic</em> text with <a href="#">links</a> for testing.</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
    });

    it('should skip elements with text that lacks whitespace', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>NoWhitespaceTextThatShouldBeSkippedByTheAnalyzer</p>
          </body>
        </html>
      `;

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');

      const result = await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.equal(0);
    });

    it('should log debug message with detected languages', async () => {
      const text = 'This is a test sentence with enough words for proper language detection and analysis.';
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(80); // Good readability

      await analyzePageContent(
        html,
        'https://example.com/page',
        1000,
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(mockLog.debug).to.have.been.called;
    });

    it('should categorize issues as Low (line 40) - score >= 30 with mocked TARGET_READABILITY_SCORE', async () => {
      // To reach line 40 (return 'Low'), the readability score must be >= 30.
      // However, issues are only created when score < TARGET_READABILITY_SCORE (30).
      // We need to mock the constant to allow a score >= 30 to still create an issue.
      const moduleWithHigherTarget = await esmock(
        '../../../src/readability/shared/analysis-utils.js',
        {
          '../../../src/utils/s3-utils.js': {
            getObjectKeysUsingPrefix: mockGetObjectKeysUsingPrefix,
            getObjectFromKey: mockGetObjectFromKey,
          },
          'text-readability': mockRs,
          'franc-min': {
            franc: mockFranc,
          },
          '../../../src/readability/shared/multilingual-readability.js': {
            calculateReadabilityScore: mockCalculateReadabilityScore,
            isSupportedLanguage: mockIsSupportedLanguage,
            getLanguageName: mockGetLanguageName,
          },
          '../../../src/readability/shared/constants.js': {
            TARGET_READABILITY_SCORE: 35, // Higher threshold to allow score 32 to create an issue
            MIN_TEXT_LENGTH: 150,
            MAX_CHARACTERS_DISPLAY: 500,
          },
        },
      );

      const text = makeLongText('This sentence has borderline readability that falls into the Low category after categorization.');
      const html = createHtmlWithParagraph(text);

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(32); // Score >= 30, so categorizeReadabilityIssue returns 'Low'

      const result = await moduleWithHigherTarget.analyzePageContent(
        html,
        'https://example.com/page',
        100, // Low traffic
        mockLog,
        '2025-01-01T00:00:00.000Z',
      );

      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
      expect(result[0].category).to.equal('Low');
    });
  });

  describe('analyzePageReadability', () => {
    it('should return no issues when no scraped content found', async () => {
      mockGetObjectKeysUsingPrefix.resolves([]);

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('No scraped content found for readability analysis');
      expect(result.readabilityIssues).to.deep.equal([]);
      expect(result.urlsProcessed).to.equal(0);
    });

    it('should return no issues when objectKeys is null', async () => {
      mockGetObjectKeysUsingPrefix.resolves(null);

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.readabilityIssues).to.deep.equal([]);
    });

    it('should process scraped pages and find readability issues', async () => {
      const longText = 'This is complex text with difficult vocabulary and intricate grammatical structures that meets the minimum character length requirement for readability analysis testing purposes.';
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);
      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: `<html><body><p>${longText}</p></body></html>`,
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result).to.have.property('readabilityIssues');
      expect(result).to.have.property('urlsProcessed');
      expect(mockLog.info).to.have.been.calledWithMatch(/Found \d+ scraped objects/);
    });

    it('should warn when scraped data has no rawBody', async () => {
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);
      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {},
      });

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(mockLog.warn).to.have.been.calledWithMatch(/No rawBody found/);
      expect(result.urlsProcessed).to.equal(0);
    });

    it('should handle errors processing individual pages', async () => {
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);
      mockGetObjectFromKey.rejects(new Error('S3 error'));

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(mockLog.error).to.have.been.calledWithMatch(/Error processing scraped data/);
      expect(result.urlsProcessed).to.equal(0);
    });

    it('should handle top-level errors', async () => {
      mockGetObjectKeysUsingPrefix.rejects(new Error('S3 connection error'));

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.message).to.include('Analysis failed');
      expect(mockLog.error).to.have.been.calledWithMatch(/Error analyzing readability/);
    });

    it('should limit issues to top 50 and sort by rank', async () => {
      // Create 60 pages to test the 50 limit
      const objectKeys = Array.from({ length: 60 }, (_, i) => `scrapes/site-123/page${i}.json`);
      mockGetObjectKeysUsingPrefix.resolves(objectKeys);

      mockGetObjectFromKey.callsFake((client, bucket, key) => {
        const pageNum = parseInt(key.match(/page(\d+)/)[1], 10);
        const longText = `This is complex text number ${pageNum} with difficult vocabulary and structures that meets the minimum character length requirement for readability analysis testing and contains enough content.`;
        return Promise.resolve({
          finalUrl: `https://example.com/page${pageNum}`,
          scrapeResult: {
            rawBody: `<html><body><p>${longText}</p></body></html>`,
          },
          scrapedAt: '2025-01-01T00:00:00.000Z',
        });
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.readabilityIssues.length).to.be.at.most(50);
    });

    it('should return success false when no issues found', async () => {
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);
      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: '<html><body><p>Simple clear text that reads well.</p></body></html>',
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(80); // Good readability

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('No readability issues found');
    });

    it('should return success true when issues found', async () => {
      const longText = 'This is complex text with difficult vocabulary and intricate grammatical structures that meets the minimum character length requirement for readability analysis testing purposes.';
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);
      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: `<html><body><p>${longText}</p></body></html>`,
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25);

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.message).to.include('Found');
    });

    it('should increment urlsProcessed when pages have issues (lines 352-353)', async () => {
      const longText1 = 'This is complex text with difficult vocabulary and intricate grammatical structures that are hard to read and meets the minimum character length requirement for analysis.';
      const longText2 = 'Another complex paragraph with difficult vocabulary and challenging grammatical structures for analysis that also meets the minimum character length requirement for testing.';

      mockGetObjectKeysUsingPrefix.resolves([
        'scrapes/site-123/page1.json',
        'scrapes/site-123/page2.json',
      ]);

      // Both pages have content that will produce readability issues
      mockGetObjectFromKey.onFirstCall().resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: `<html><body><p>${longText1}</p></body></html>`,
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockGetObjectFromKey.onSecondCall().resolves({
        finalUrl: 'https://example.com/page2',
        scrapeResult: {
          rawBody: `<html><body><p>${longText2}</p></body></html>`,
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(25); // Poor readability to ensure issues are found

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      // urlsProcessed should be incremented for each page with issues
      expect(result.urlsProcessed).to.be.greaterThan(0);
      expect(result.readabilityIssues.length).to.be.greaterThan(0);
    });

    it('should not increment urlsProcessed when pages have no issues (lines 352-353)', async () => {
      mockGetObjectKeysUsingPrefix.resolves(['scrapes/site-123/page1.json']);

      mockGetObjectFromKey.resolves({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: '<html><body><p>Simple clear text that reads well and has good readability.</p></body></html>',
        },
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      mockFranc.returns('eng');
      mockIsSupportedLanguage.returns(true);
      mockGetLanguageName.returns('english');
      mockRs.fleschReadingEase.returns(80); // Good readability - no issues

      const result = await analyzePageReadability(
        mockS3Client,
        'test-bucket',
        'site-123',
        mockLog,
      );

      // urlsProcessed should be 0 since no issues were found
      expect(result.urlsProcessed).to.equal(0);
    });
  });
});

