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
import readability, { PREFLIGHT_READABILITY } from '../../../src/readability/handler.js';
import { PREFLIGHT_STEP_IDENTIFY } from '../../../src/preflight/handler.js';

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
      debug: sinon.stub(),
    };

    context = {
      site: {
        getId: () => 'test-site',
        getBaseURL: () => 'https://test-site.com',
      },
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
      job: {
        getMetadata: () => ({
          payload: {
            step: PREFLIGHT_STEP_IDENTIFY,
            urls: ['https://main--example--page.aem.page/page1'],
          },
        }),
        getStatus: sinon.stub().returns('IN_PROGRESS'),
        getId: () => 'job-123',
        setStatus: sinon.stub(),
        setResultType: sinon.stub(),
        setResult: sinon.stub(),
        setEndedAt: sinon.stub(),
        setError: sinon.stub(),
        save: sinon.stub().resolves(),
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
      checks: ['readability'],
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
      const poorText = 'This is an extraordinarily complex sentence that utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration. '.repeat(3);

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
      expect(log.info).to.have.been.calledWithMatch('Processed 0 text element(s)');
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
      expect(log.info).to.have.been.calledWithMatch('Processed 2 text element(s)');
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
      expect(log.error).to.have.been.calledWithMatch('Error calculating readability for element');

      // Restore the original function
      textReadability.default.fleschReadingEase = originalFleschReadingEase;
    });

    it('should skip non-English content (e.g. German)', async () => {
      // Create German text that is long enough to be processed
      const germanText = 'Dies ist ein sehr komplexer deutscher Text, der zahlreiche mehrsilbige Wörter und komplizierte grammatikalische Konstruktionen verwendet, was es für den durchschnittlichen Leser äußerst schwierig macht, ohne beträchtliche Anstrengung und Konzentration zu verstehen.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${germanText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should not create any opportunities since German content is skipped
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);

      // Should log that content was processed but no poor readability found
      expect(log.info).to.have.been.calledWithMatch('Processed 1 text element(s)');
      expect(log.info).to.have.been.calledWithMatch('found 0 with poor readability');
    });

    it('should skip elements with block-level children to avoid duplicate analysis', async () => {
      // Create text with poor readability
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body>
              <div>
                <p>${poorText}</p>
                <div>Another block element that should cause the parent to be skipped</div>
              </div>
            </body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should only create 1 opportunity since only the first paragraph (child)
      // has poor readability
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);
    });

    it('should process elements with only inline formatting children', async () => {
      // Create text with poor readability
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body>
              <div>
                <strong>Bold text</strong> and <em>italic text</em> with <span>inline formatting</span> and <a href="#">links</a>.
                ${poorText}
              </div>
            </body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should create opportunities since the div only has inline children
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);

      // Should log that elements were processed
      expect(log.info).to.have.been.calledWithMatch('Processed 1 text element(s)');
    });

    it('should properly handle text with <br> tags by splitting into paragraphs', async () => {
      // Create text with poor readability that will be split by <br> tags
      const poorText1 = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(2);
      const poorText2 = 'Another paragraph with similarly complex sentence structures that contain numerous multisyllabic words and intricate grammatical constructions, making it extremely challenging for readers to understand without significant cognitive effort.'.repeat(2);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body>
              <p>${poorText1}<br>${poorText2}</p>
            </body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      // Should create opportunities for each paragraph separated by <br>
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(2);

      // Should log that 2 elements were processed (one for each paragraph)
      expect(log.info).to.have.been.calledWithMatch('Processed 2 text element(s)');
    });

    it('should not truncate text when it is shorter than MAX_CHARACTERS_DISPLAY', async () => {
      // Create text that is poor readability but shorter than 200 characters
      const shortPoorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions making it extremely difficult to comprehend without considerable concentration.';

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${shortPoorText}</p></body></html>`,
          },
        },
      }];

      await readability(context, auditContext);

      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(1);

      // The issue text should contain the full text without truncation
      const opportunity = audit.opportunities[0];
      expect(opportunity.issue).to.include(shortPoorText);
      expect(opportunity.issue).not.to.include('...');
    });
  });

  describe('suggest step functionality', () => {
    let mockSendReadabilityToMystique;
    let readabilityMocked;

    beforeEach(async () => {
      mockSendReadabilityToMystique = sinon.stub().resolves();

      readabilityMocked = await esmock('../../../src/readability/handler.js', {
        '../../../src/readability/async-mystique.js': {
          sendReadabilityToMystique: mockSendReadabilityToMystique,
        },
        '../../../src/preflight/utils.js': {
          saveIntermediateResults: sinon.stub().resolves(),
        },
      });

      auditContext.step = 'suggest';

      // Mock dataAccess.Opportunity
      context.dataAccess.Opportunity = {
        allBySiteId: sinon.stub().resolves([]),
      };
    });

    it('should handle suggest step with no readability issues', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Simple text that is easy to read.</p></body></html>',
          },
        },
      }];

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.info).to.have.been.calledWithMatch('No readability issues found to send to Mystique');
      expect(mockSendReadabilityToMystique).not.to.have.been.called;
      expect(result.processing).to.be.false;
    });

    it('should collect readability issues and check for existing suggestions', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with no suggestions
      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWithMatch('Sending 1 readability issues to Mystique');
      expect(result.processing).to.be.true;
    });

    it('should handle existing suggestions from previous Mystique runs', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with suggestions
      const mockSuggestion = {
        getData: () => ({
          recommendations: [{
            originalText: poorText,
            improvedText: 'This is a simple sentence. It is easy to read.',
            originalFleschScore: 15,
            improvedFleschScore: 85,
            seoRecommendation: 'Use shorter sentences',
            aiRationale: 'Shorter sentences improve readability',
          }],
          lastMystiqueResponse: '2023-01-01T00:00:00.000Z',
        }),
      };

      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([mockSuggestion]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).not.to.have.been.called;
      expect(log.info).to.have.been.calledWithMatch('All 1 readability issues already have suggestions');
      expect(result.processing).to.be.false;

      // Check that audit results were updated with suggestions
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      const opportunity = audit.opportunities[0];
      expect(opportunity.suggestionStatus).to.equal('completed');
      expect(opportunity.improvedText).to.equal('This is a simple sentence. It is easy to read.');
      expect(opportunity.improvedFleschScore).to.equal(85);
      expect(opportunity.readabilityImprovement).to.equal(70); // 85 - 15
    });

    it('should handle no existing opportunity found scenario', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // No existing opportunity found
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.debug).to.have.been.calledWithMatch('No existing opportunity found for jobId: job-123');
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
      expect(result.processing).to.be.true;

      // Check that opportunities were cleared from response while processing
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);
    });

    it('should handle mixed suggestions scenario - some exist, some need processing', async () => {
      const poorText1 = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);
      const poorText2 = 'Another extremely convoluted and unnecessarily complicated textual composition that employs excessive verbosity and complex grammatical structures that significantly impede comprehension for typical readers.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText1}</p><p>${poorText2}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with partial suggestions (only for first text)
      const mockSuggestion = {
        getData: () => ({
          recommendations: [{
            originalText: poorText1,
            improvedText: 'This is a simple sentence. It is easy to read.',
            originalFleschScore: 15,
            improvedFleschScore: 85,
            seoRecommendation: 'Use shorter sentences',
            aiRationale: 'Shorter sentences improve readability',
          }],
          lastMystiqueResponse: '2023-01-01T00:00:00.000Z',
        }),
      };

      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([mockSuggestion]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWithMatch('Sending 1 readability issues to Mystique');
      expect(result.processing).to.be.true;

      // Check that opportunities were cleared from response while processing
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);
    });

    it('should handle errors when checking for existing suggestions', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock error when getting opportunities
      context.dataAccess.Opportunity.allBySiteId.rejects(new Error('Database connection failed'));

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.error).to.have.been.calledWithMatch('Error checking for existing suggestions: Database connection failed');
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
      expect(result.processing).to.be.true;

      // Check that opportunities were cleared from response while processing
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);
    });

    it('should handle Mystique integration errors and set error status', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // No existing opportunity found
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      // Mock Mystique error
      mockSendReadabilityToMystique.rejects(new Error('SQS connection failed'));

      // Add env and sqs to context for error debugging
      context.env = { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' };
      context.sqs = { sendMessage: sinon.stub() };

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.error).to.have.been.calledWithMatch('Error sending issues to Mystique');
      expect(result.processing).to.be.false;

      // Check that opportunities were marked with error status and debug info
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      const opportunity = audit.opportunities[0];
      expect(opportunity.suggestionStatus).to.equal('error');
      expect(opportunity.suggestionMessage).to.include('Mystique integration failed: SQS connection failed');
      expect(opportunity.debugInfo).to.exist;
      expect(opportunity.debugInfo.errorType).to.equal('Error');
      expect(opportunity.debugInfo.errorMessage).to.equal('SQS connection failed');
      expect(opportunity.debugInfo.mystiqueQueueConfigured).to.be.true;
      expect(opportunity.debugInfo.sqsClientAvailable).to.be.true;
    });

    it('should clear readability opportunities from response when processing', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // No existing opportunity found
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(result.processing).to.be.true;

      // Check that opportunities were cleared from the response (set to empty array)
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      expect(audit.opportunities).to.have.lengthOf(0);
    });

    it('should add suggest step timing information', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Simple text that is easy to read.</p></body></html>',
          },
        },
      }];

      await readabilityMocked.default(context, auditContext);

      expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
      expect(auditContext.timeExecutionBreakdown[0].name).to.equal('readability-suggestions');
      expect(auditContext.timeExecutionBreakdown[0].duration).to.include('seconds');
    });

    it('should use fallback originalFleschScore when recommendation score is missing (line 89)', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with suggestion
      // that has NO originalFleschScore (to trigger fallback)
      const mockSuggestion = {
        getData: () => ({
          recommendations: [{
            originalText: poorText,
            improvedText: 'This is a simple sentence. It is easy to read.',
            // originalFleschScore: undefined/missing - this will trigger the fallback
            improvedFleschScore: 85,
            seoRecommendation: 'Use shorter sentences',
            aiRationale: 'Shorter sentences improve readability',
          }],
          lastMystiqueResponse: '2023-01-01T00:00:00.000Z',
        }),
      };

      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([mockSuggestion]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).not.to.have.been.called;
      expect(result.processing).to.be.false;

      // Check that audit results used the fallback fleschReadingEase value
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      const opportunity = audit.opportunities[0];
      expect(opportunity.suggestionStatus).to.equal('completed');

      // The readabilityImprovement should be calculated using the fallback score
      // improvedFleschScore (85) - opportunity.fleschReadingEase (from original audit)
      expect(opportunity.readabilityImprovement).to.be.a('number');
      expect(opportunity.readabilityImprovement).to.be.greaterThan(0);
    });

    it('should use fallback timestamp when lastMystiqueResponse is missing (line 103)', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with suggestion
      // that has NO lastMystiqueResponse (to trigger fallback)
      const mockSuggestion = {
        getData: () => ({
          recommendations: [{
            originalText: poorText,
            improvedText: 'This is a simple sentence. It is easy to read.',
            originalFleschScore: 15,
            improvedFleschScore: 85,
            seoRecommendation: 'Use shorter sentences',
            aiRationale: 'Shorter sentences improve readability',
          }],
          // lastMystiqueResponse: undefined/missing - this will trigger the fallback
        }),
      };

      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([mockSuggestion]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).not.to.have.been.called;
      expect(result.processing).to.be.false;

      // Check that audit results used the fallback timestamp (current date)
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      const opportunity = audit.opportunities[0];
      expect(opportunity.suggestionStatus).to.equal('completed');

      // The mystiqueProcessingCompleted should be a valid ISO timestamp (fallback)
      expect(opportunity.mystiqueProcessingCompleted).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Since we're using the fallback (new Date().toISOString()),
      // the timestamp should be recent (within the last few seconds)
      const timestamp = new Date(opportunity.mystiqueProcessingCompleted);
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - timestamp.getTime());
      expect(timeDiff).to.be.lessThan(5000); // Within 5 seconds
    });

    it('should cover both fallbacks in the same scenario', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Mock existing opportunity with suggestion that has BOTH fallbacks triggered
      const mockSuggestion = {
        getData: () => ({
          recommendations: [{
            originalText: poorText,
            improvedText: 'This is a simple sentence. It is easy to read.',
            // originalFleschScore: undefined/missing - triggers line 89 fallback
            improvedFleschScore: 85,
            seoRecommendation: 'Use shorter sentences',
            aiRationale: 'Shorter sentences improve readability',
          }],
          // lastMystiqueResponse: undefined/missing - triggers line 103 fallback
        }),
      };

      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([mockSuggestion]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(mockSendReadabilityToMystique).not.to.have.been.called;
      expect(result.processing).to.be.false;

      // Check that both fallbacks were used correctly
      const audit = auditsResult[0].audits.find((a) => a.name === 'readability');
      const opportunity = audit.opportunities[0];
      expect(opportunity.suggestionStatus).to.equal('completed');

      // Line 89 fallback: readabilityImprovement uses opportunity.fleschReadingEase
      expect(opportunity.readabilityImprovement).to.be.a('number');
      expect(opportunity.readabilityImprovement).to.be.greaterThan(0);

      // Line 103 fallback: mystiqueProcessingCompleted uses new Date().toISOString()
      expect(opportunity.mystiqueProcessingCompleted).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const timestamp = new Date(opportunity.mystiqueProcessingCompleted);
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - timestamp.getTime());
      expect(timeDiff).to.be.lessThan(5000); // Within 5 seconds
    });

    it('should handle readability processing with opportunity collection', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Start with normal audit with opportunities to collect issues
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [{
          check: 'poor-readability',
          textContent: poorText,
          suggestionStatus: 'processing',
        }],
      }];

      // No existing opportunity found - this will trigger processing
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.info).to.have.been.calledWithMatch('Sending 2 readability issues to Mystique');
      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
    });

    it('should handle readability processing with multiple scenarios', async () => {
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Start with normal audit with opportunities to collect issues
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [{
          check: 'poor-readability',
          textContent: poorText,
          suggestionStatus: 'processing',
        }],
      }];

      // No existing opportunity found - this will trigger processing
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(log.info).to.have.been.calledWithMatch('Sending 2 readability issues to Mystique');
      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;
    });

    it('should cover all branches for line 326: pageAudit?.opportunities || []', async () => {
      // Create a simple test that focuses specifically on the counting logic (line 326)
      // We'll skip the complex initial processing and focus on the suggest step
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Create a scenario where all pages have empty opportunities to pass line 301
      // This allows us to reach the counting logic at line 326
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [], // Empty to pass line 301 but still be counted
      }];

      // Add more pages to test the flatMap logic thoroughly
      auditsResult.push(
        {
          pageUrl: 'https://example.com/page2',
          audits: [{
            name: 'readability',
            type: 'seo',
            opportunities: [], // Empty array case
          }],
        },
        {
          pageUrl: 'https://example.com/page3',
          audits: [], // No readability audit - pageAudit will be undefined
        },
      );

      // Mock for checkForExistingSuggestions - return no existing opportunities
      context.dataAccess.Opportunity.allBySiteId.resolves([]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;

      // This test covers:
      // 1. pageAudit exists + opportunities is empty array (pages 1 & 2)
      // 2. pageAudit is undefined (page 3 - no readability audit found)
      // The || [] fallback should be used for the undefined case
    });

    it('should test null opportunities branch after checkForExistingSuggestions', async () => {
      // This test specifically targets the case where opportunities becomes null
      // after the initial processing but before the counting phase
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Start with empty opportunities to pass line 301
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [],
      }];

      // Create a mock opportunity that exists so checkForExistingSuggestions runs
      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().callsFake(async () => {
          // Mark some suggestions as processing to trigger Mystique call
          if (auditsResult[0] && auditsResult[0].audits[0]) {
            const { opportunities } = auditsResult[0].audits[0];
            for (let i = 0; i < opportunities.length; i += 1) {
              opportunities[i].suggestionStatus = 'processing';
            }
          }
          return [];
        }),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Add missing environment variable
      context.env = context.env || {};
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = 'test-queue-url';

      const result = await readabilityMocked.default(context, auditContext);

      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;

      // This should cover the case where pageAudit exists but opportunities is null
      // triggering the || [] fallback on line 326
    });

    it('should test pageAudit null branch specifically', async () => {
      // Specifically test when pageAudit is null to ensure full branch coverage
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Create one normal page with opportunities
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [{
          check: 'poor-readability',
          textContent: poorText,
          suggestionStatus: 'processing',
        }],
      }];

      // Add a page where find() returns undefined (pageAudit is undefined)
      // This happens when there's no audit with name === 'readability'
      auditsResult.push({
        pageUrl: 'https://example.com/page2',
        audits: [
          { name: 'canonical', type: 'seo', opportunities: [] },
          { name: 'metatags', type: 'seo', opportunities: [] },
          // No 'readability' audit - this makes pageAudit undefined
        ],
      });

      // Mock for checkForExistingSuggestions
      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;

      // This should cover the pageAudit?.opportunities branch when pageAudit is undefined
    });

    it('should test opportunities array exists branch', async () => {
      // Test the scenario where pageAudit exists AND opportunities exists (left side of ||)
      const poorText = 'This extraordinarily complex sentence utilizes numerous multisyllabic words and intricate grammatical constructions, making it extremely difficult for the average reader to comprehend without considerable effort and concentration.'.repeat(3);

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorText}</p></body></html>`,
          },
        },
      }];

      // Create pages with normal opportunities arrays (tests the left side of ||)
      auditsResult[0].audits = [{
        name: 'readability',
        type: 'seo',
        opportunities: [
          {
            check: 'poor-readability',
            textContent: poorText,
            suggestionStatus: 'processing',
          },
          {
            check: 'poor-readability',
            textContent: 'Another poor text',
            suggestionStatus: 'completed',
          },
        ],
      }];

      // Add another page with a different opportunities array
      auditsResult.push({
        pageUrl: 'https://example.com/page2',
        audits: [{
          name: 'readability',
          type: 'seo',
          opportunities: [{
            check: 'poor-readability',
            textContent: 'Some other text',
            suggestionStatus: 'error',
          }],
        }],
      });

      // Mock for checkForExistingSuggestions
      const mockOpportunity = {
        getAuditId: () => 'job-123',
        getData: () => ({ subType: 'readability' }),
        getSuggestions: sinon.stub().resolves([]),
      };
      context.dataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await readabilityMocked.default(context, auditContext);

      expect(result.processing).to.be.true;
      expect(mockSendReadabilityToMystique).to.have.been.calledOnce;

      // This tests the scenario where opportunities arrays exist and are used directly
      // (left side of the || operator on line 326)
    });
  });
});
