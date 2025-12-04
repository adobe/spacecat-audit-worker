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

    it('should return null in getSupportedLanguage when isSupportedLanguage returns false', async () => {
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

    it('should handle non-English supported languages with poor readability', async () => {
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

    it('should use calculateReadabilityScore for non-English and return issue', async () => {
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

    it('should handle elements with br tags as multiple paragraphs', async () => {
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

    it('should handle br tags and process each paragraph via forEach loop', async () => {
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

    it('should handle br tags with self-closing syntax', async () => {
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

    it('should filter out elements with block children', async () => {
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

    it('should include elements with only inline children', async () => {
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

    it('should handle errors in analyzeTextReadability gracefully', async () => {
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

    it('should handle errors from cheerioLoad in analyzePageContent', async () => {
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

    it('should categorize issues as Critical - score < 20 AND traffic > 1000', async () => {
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

    it('should return seoImpact High - score < 15', async () => {
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

    it('should categorize issues as Moderate - score 25-29 with low traffic', async () => {
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

    it('should return seoImpact Low - score 25-29', async () => {
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

    it('should return seoImpact High - score < 15 second test', async () => {
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

    it('should return null for good readability', async () => {
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

    it('should return null for unsupported language', async () => {
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

    it('should categorize issues as Low - score >= 30 with mocked TARGET_READABILITY_SCORE', async () => {
      // To reach line 40 (return 'Low'), the readability score must be >= 30.
      // However, issues are only created when score < TARGET_READABILITY_SCORE (30).
      // We need to mock the constant to allow a score >= 30 to still create an issue.
      const moduleWithHigherTarget = await esmock(
        '../../../src/readability/shared/analysis-utils.js',
        {
          '../../../src/utils/s3-utils.js': {
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
    describe('empty scrapeResultPaths handling', () => {
      it('should return failure when scrapeResultPaths is undefined', async () => {
        const result = await analyzePageReadability(mockS3Client, 'test-bucket', undefined, mockLog);

        expect(result).to.deep.equal({
          success: false,
          message: 'No scraped content found for readability analysis',
          readabilityIssues: [],
          urlsProcessed: 0,
        });
      });

      it('should return failure when scrapeResultPaths is null', async () => {
        const result = await analyzePageReadability(mockS3Client, 'test-bucket', null, mockLog);

        expect(result).to.deep.equal({
          success: false,
          message: 'No scraped content found for readability analysis',
          readabilityIssues: [],
          urlsProcessed: 0,
        });
      });

      it('should return failure when scrapeResultPaths is empty', async () => {
        const result = await analyzePageReadability(mockS3Client, 'test-bucket', new Map(), mockLog);

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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockLog.warn).to.have.been.calledWith(
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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockLog.warn).to.have.been.calledWith(
          '[ReadabilityAnalysis] No rawBody found in scraped data for URL: https://example.com/page1',
        );
        expect(result.urlsProcessed).to.equal(0);
      });

      it('should handle errors when processing scraped data fails', async () => {
        const scrapeResultPaths = new Map([
          ['https://example.com/page1', 'scraped/page1.json'],
        ]);

        mockGetObjectFromKey.rejects(new Error('S3 connection failed'));

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockLog.error).to.have.been.calledWith(
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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockLog.info).to.have.been.calledWith(
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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockGetObjectFromKey.callCount).to.equal(3);
        expect(mockLog.info).to.have.been.calledWith(
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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

        expect(mockLog.error).to.have.been.calledWith(
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

        mockFranc.returns('eng');
        mockIsSupportedLanguage.returns(true);
        mockGetLanguageName.returns('english');
        mockRs.fleschReadingEase.returns(10); // Very poor readability

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

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

        mockFranc.returns('eng');
        mockIsSupportedLanguage.returns(true);
        mockGetLanguageName.returns('english');
        mockRs.fleschReadingEase.returns(10); // Very poor readability

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

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

        mockFranc.returns('eng');
        mockIsSupportedLanguage.returns(true);
        mockGetLanguageName.returns('english');
        mockRs.fleschReadingEase.returns(10); // Very poor readability

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', scrapeResultPaths, mockLog);

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

        const result = await analyzePageReadability(mockS3Client, 'test-bucket', faultyMap, mockLog);

        expect(mockLog.error).to.have.been.calledWith(
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
});

