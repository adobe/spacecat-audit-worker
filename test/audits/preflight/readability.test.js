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
      // Test with data that causes an error during processing
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            // Missing rawBody property entirely, which should cause an error
            // when trying to access it
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);
      expect(audit.opportunities[0].check).to.equal('readability-analysis-error');
      expect(audit.opportunities[0].issue).to.include('Failed to analyze page readability');
      expect(log.error).to.have.been.calledWithMatch('Error processing');
    });

    it('should cover error handling when textContent processing fails', async () => {
      // Create a scenario where JSDOM succeeds but something else fails
      // by providing data that will cause an error in the text processing logic
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: undefined, // This should cause new JSDOM(undefined) to throw
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);
      expect(audit.opportunities[0].check).to.equal('readability-analysis-error');
      expect(log.error).to.have.been.calledWithMatch('Error processing');
    });
  });
});
