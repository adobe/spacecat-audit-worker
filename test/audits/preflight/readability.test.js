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
import readability, { PREFLIGHT_READABILITY } from '../../../src/preflight/readability.js';

use(sinonChai);

describe('Preflight Readability Audit', () => {
  let context;
  let auditContext;
  let log;
  let audits;
  let auditsResult;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    context = {
      site: { getId: () => 'test-site' },
      jobId: 'test-job',
      log,
      dataAccess: {
        AsyncJob: {
          findById: sinon.stub().resolves({
            setResult: sinon.stub(),
            setStatus: sinon.stub(),
            setResultType: sinon.stub(),
            save: sinon.stub().resolves(),
          }),
        },
      },
    };

    auditsResult = [{
      pageUrl: 'https://example.com/page1',
      step: 'identify',
      audits: [],
    }];

    audits = new Map();
    audits.set('https://example.com/page1', auditsResult[0]);

    auditContext = {
      checks: undefined, // Run all checks
      previewUrls: ['https://example.com/page1'],
      step: 'identify',
      audits,
      auditsResult,
      scrapedObjects: [],
      timeExecutionBreakdown: [],
    };
  });

  describe('PREFLIGHT_READABILITY constant', () => {
    it('should be defined correctly', () => {
      expect(PREFLIGHT_READABILITY).to.equal('readability');
    });
  });

  describe('readability audit', () => {
    it('should skip when check is not included', async () => {
      auditContext.checks = ['canonical']; // Different check
      await readability(context, auditContext);

      expect(auditsResult[0].audits).to.have.lengthOf(0);
      expect(log.info).not.to.have.been.called;
    });

    it('should create audit entry for each page', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Short text</p></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      expect(auditsResult[0].audits).to.have.lengthOf(1);
      expect(auditsResult[0].audits[0].name).to.equal('readability');
      expect(auditsResult[0].audits[0].type).to.equal('seo');
    });

    it('should identify poor readability text', async () => {
      // Create text with very poor readability (very long complex sentences)
      const poorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);
      expect(audit.opportunities[0].check).to.equal('poor-readability');
      expect(audit.opportunities[0].issue).to.include('poor readability');
      expect(audit.opportunities[0].issue).to.include('Flesch score:');
    });

    it('should skip text content shorter than minimum length', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Short</p><div>Also short</div></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);
      expect(log.info).to.have.been.calledWithMatch('Processed 0 text elements');
    });

    it('should process both paragraphs and divs', async () => {
      const goodText = 'This is simple text. It is easy to read. Short sentences help.'.repeat(3);
      const poorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(2);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${goodText}</p><div>${poorText}</div></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1); // Only the poor text should be flagged
      expect(log.info).to.have.been.calledWithMatch('Processed 2 text elements');
    });

    it('should include element selector information', async () => {
      const poorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p id="test-id" class="content main">${poorText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities[0].issue).to.include('p#test-id.content.main');
    });

    it('should truncate long text previews', async () => {
      const longPoorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(5);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${longPoorText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities[0].issue).to.include('Text preview:');
      expect(audit.opportunities[0].issue).to.include('...');
    });

    it('should handle DOM parsing errors gracefully', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: 'invalid html content',
          },
        },
      }];

      await readability(context, auditContext);

      // Should not throw error, but may add error opportunity
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit).to.exist;
    });

    it('should handle multiple pages correctly', async () => {
      // Add second page to test setup
      auditsResult.push({
        pageUrl: 'https://example.com/page2',
        step: 'identify',
        audits: [],
      });
      audits.set('https://example.com/page2', auditsResult[1]);
      auditContext.previewUrls.push('https://example.com/page2');

      const poorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [
        {
          data: {
            finalUrl: 'https://example.com/page1',
            scrapeResult: {
              rawBody: `<html><body><p>${poorText}</p></body></html>`,
            },
          },
        },
        {
          data: {
            finalUrl: 'https://example.com/page2',
            scrapeResult: {
              rawBody: '<html><body><p>Good simple text that is easy to read and understand.</p></body></html>',
            },
          },
        },
      ];

      await readability(context, auditContext);

      // Both pages should have readability audit entries
      expect(auditsResult[0].audits).to.have.lengthOf(1);
      expect(auditsResult[1].audits).to.have.lengthOf(1);

      // Only page 1 should have poor readability issues
      const audit1 = auditsResult[0].audits.find((a) => a.name === 'readability');
      const audit2 = auditsResult[1].audits.find((a) => a.name === 'readability');
      expect(audit1.opportunities).to.have.lengthOf(1);
      expect(audit2.opportunities).to.have.lengthOf(0);
    });

    it('should add timing information', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Simple text for testing.</p></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
      expect(auditContext.timeExecutionBreakdown[0].name).to.equal('readability');
      expect(auditContext.timeExecutionBreakdown[0].duration).to.include('seconds');
    });

    it('should handle URLs with trailing slashes correctly', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1/', // Note the trailing slash
          scrapeResult: {
            rawBody: '<html><body><p>Simple text for testing purposes.</p></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit).to.exist;
      expect(log.warn).not.to.have.been.calledWithMatch('No page result found');
    });

    it('should not crash when text content is valid', async () => {
      // This test mainly ensures the happy path doesn't cause errors
      // (Testing individual readability errors is complex due to import mocking challenges)
      const longText = 'This is a test text that should be long enough to be processed by readability analysis. It contains multiple sentences to ensure proper testing coverage.';
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${longText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should not crash and should process normally
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit).to.exist;
      expect(log.error).not.to.have.been.called;
    });

    it('should handle overall DOM processing errors', async () => {
      // Force an error by making JSDOM constructor throw
      const originalJSDOM = global.JSDOM;
      global.JSDOM = function mockJSDOM() {
        throw new Error('Forced JSDOM error for testing');
      };

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Valid HTML content for processing</p></body></html>',
          },
        },
      }];

      try {
        await readability(context, auditContext);

        const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
        expect(audit.opportunities).to.have.lengthOf(1);
        expect(audit.opportunities[0].check).to.equal('readability-analysis-error');
        expect(audit.opportunities[0].issue).to.include('Failed to analyze page readability');
        expect(log.error).to.have.been.calledWithMatch('Error processing');
      } finally {
        // Always restore JSDOM
        global.JSDOM = originalJSDOM;
      }
    });

    it('should handle case when page result is not found', async () => {
      // Set up scraped object for a URL that's not in the audits map
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/nonexistent-page',
          scrapeResult: {
            rawBody: '<html><body><p>Some test content that is long enough to process</p></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      // Should log a warning and return early
      expect(log.warn).to.have.been.calledWithMatch('No page result found for');
    });

    it('should handle case when audit entry is missing for a page', async () => {
      // To trigger "audit not found", we need a scrapedObject for a URL
      // that's NOT in previewUrls (so no audit entry gets created for it)
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/different-page', // This URL is NOT in previewUrls
          scrapeResult: {
            rawBody: '<html><body><p>Some test content that is long enough to process</p></body></html>',
          },
        },
      }];

      await readability(context, auditContext);

      // Should log a warning because no page result exists for this URL
      expect(log.warn).to.have.been.calledWithMatch('No page result found for');
    });

    it('should handle case when no readability audit exists for a page', async () => {
      // Create a page result but manually remove its readability audit after function creates it
      const testUrl = 'https://example.com/page2';

      // First, add the URL to previewUrls so an audit gets created
      auditContext.previewUrls.push(testUrl);

      const page2Result = {
        pageUrl: testUrl,
        step: 'identify',
        audits: [],
      };
      auditsResult.push(page2Result);
      audits.set(testUrl, page2Result);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: testUrl,
          scrapeResult: {
            rawBody: '<html><body><p>Some test content that is long enough to process</p></body></html>',
          },
        },
      }];

      // Call readability to create the audit entries first
      await readability(context, auditContext);

      // Now remove the readability audit and clear logs
      page2Result.audits = page2Result.audits.filter((audit) => audit.name !== 'readability');
      log.warn.resetHistory();

      // Process scrapedObjects again - this should trigger the warning
      await readability(context, auditContext);

      // Should log a warning because audit entry is missing for this page
      expect(log.warn).to.have.been.calledWithMatch('No readability audit found for');
    });

    it('should handle readability calculation error for individual elements', async () => {
      // We'll use sinon to stub the text-readability module
      const textReadability = await import('text-readability');
      const originalFleschReadingEase = textReadability.default.fleschReadingEase;

      // Stub to throw error on first call, succeed on subsequent calls
      let callCount = 0;
      textReadability.default.fleschReadingEase = sinon.stub().callsFake((text) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Readability calculation failed');
        }
        return originalFleschReadingEase(text);
      });

      const longText1 = 'This is the first long text that should cause an error during processing. '.repeat(3);
      const longText2 = 'This is the second long text that should process normally without any issues. '.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${longText1}</p><p>${longText2}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should log warning for the failed element but continue processing
      expect(log.warn).to.have.been.calledWithMatch('Error calculating readability for element');

      // Restore the original function
      textReadability.default.fleschReadingEase = originalFleschReadingEase;
    });
  });
});
