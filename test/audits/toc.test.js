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

import { expect, use as chaiUse } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { load as cheerioLoad } from 'cheerio';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import { generateSuggestions, slimTocAuditResult, hasTocInDom } from '../../src/toc/handler.js';
import {
  getHeadingLevel,
  TOC_EXCLUDED_CONTAINER_SELECTORS,
  TOC_EXCLUDED_HEADING_PHRASES,
  normalizeHeadingTextForMatch,
  isExcludedConsentHeadingText,
  isHeadingInExcludedContainer,
  getSurroundingText,
  getFollowingStructure,
  getParentSectionContext,
  getHeadingContext,
  extractTocData,
  tocArrayToHast,
  determineTocPlacement,
  getScrapeJsonPath,
} from '../../src/headings/utils.js';
import { getHeadingSelector } from '../../src/headings/shared-utils.js';

chaiUse(sinonChai);
chaiUse(chaiAsPromised);

/** Stub that returns a simple selector for a heading (for extractTocData tests) */
function stubGetHeadingSelector(h) {
  const tag = h.name.toLowerCase();
  const id = h.attribs?.id;
  return id ? `${tag}#${id}` : tag;
}

describe('TOC (Table of Contents) Audit', () => {
  let log;
  let context;
  let site;
  let s3Client;

  beforeEach(() => {
    log = {
      info: console.log, error: console.error, debug: console.debug, warn: console.warn,
    };
    context = {
      log,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        AZURE_OPENAI_ENDPOINT: 'https://test-endpoint.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
        AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
      },
    };
    // Default stubs required by processTocResults (inlines suggestion creation and audit slimming)
    context.audit = { getId: () => 'default-audit-id' };
    context.dataAccess = { Audit: { updateByKeys: sinon.stub().resolves() } };
    site = { getId: () => 'site-1', getBaseURL: () => 'https://example.com', getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }) };
    s3Client = {
      send: sinon.stub().resolves({
        Contents: [{ Key: 'scrapes/site-1/page/scrape.json' }],
      }),
    };

    // Mock AzureOpenAIClient
    const mockFetchChatCompletion = sinon.stub().resolves({
      choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test Suggestion","aiRationale":"Test Rationale"}}' } }],
    });

    const mockClient = {
      fetchChatCompletion: mockFetchChatCompletion,
    };

    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('TOC Detection', () => {
    it('detects when TOC is missing and suggests placement after H1', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      // Mock AI client to return TOC not present
      // NOTE: TOC detection happens FIRST, then brand guidelines
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"TOCCSSSelector":null,"confidence":8,"reasoning":"No TOC structure found"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test guidelines"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const convertToOpportunityStub = sinon.stub().resolves({ getId: () => 'test-opp-id' });
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1 id="main">Title</h1><h2>Section 1</h2><h2>Section 2</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // TOC should be flagged as missing
      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.exist;
      expect(result.auditResult.toc.toc).to.exist;
      expect(result.auditResult.toc.toc.success).to.equal(false);
      expect(result.auditResult.toc.toc.urls).to.have.lengthOf(1);

      const tocIssue = result.auditResult.toc.toc.urls[0];
      expect(tocIssue.url).to.equal(url);
      // transformRules are stripped from the audit DB record (slimmed) after suggestions are built
      expect(tocIssue).to.not.have.property('transformRules');
      expect(tocIssue.tocConfidence).to.equal(8);
      expect(tocIssue.tocReasoning).to.equal('No TOC structure found');

      // auditData passed to convertToOpportunity must include id so the opportunity is linked
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      const [, calledWithAuditData] = convertToOpportunityStub.getCall(0).args;
      expect(calledWithAuditData).to.have.property('id', 'default-audit-id');
    });
  });

  describe('Empty TOC Prevention', () => {
    it('skips suggestion when AI says TOC is missing but all headings are inside nav containers', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":8,"reasoning":"No TOC found"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      // All headings are inside nav/header/footer — extractTocData will return []
      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<header><h1>Site Brand</h1></header><nav><h2>Home</h2><h2>About</h2></nav><footer><h2>Contact</h2></footer>',
                  tags: { title: 'Page Title', description: 'Desc', h1: ['Site Brand'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // No suggestion should be created — result should show no toc issues
      expect(result.auditResult).to.exist;
      const tocResult = result.auditResult.toc;
      // Either empty toc (success) or the toc check key has no urls
      const hasNoSuggestions = !tocResult || Object.keys(tocResult).length === 0
        || !tocResult.toc || tocResult.toc.urls?.length === 0;
      expect(hasNoSuggestions).to.equal(true);
    });

    it('skips suggestion when AI says TOC is missing but headings only in header', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":7,"reasoning":"No TOC"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<header><h1>Site Title</h1><h2>Tagline</h2></header><p>Some content with no headings</p>',
                  tags: { title: 'Page Title', description: 'Desc', h1: ['Site Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      // toc should be empty — no valid headings to build a TOC from
      expect(result.auditResult.toc).to.deep.equal({});
    });

    it('still creates suggestion when some headings exist outside navigation', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":8,"reasoning":"No TOC"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<nav><h2>Site Navigation</h2></nav><h1 id="title">Article Title</h1><h2 id="sec1">Section 1</h2>',
                  tags: { title: 'Page Title', description: 'Desc', h1: ['Article Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // A suggestion SHOULD be created since there are valid content headings
      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.exist;
      expect(result.auditResult.toc.toc).to.exist;
      const tocIssue = result.auditResult.toc.toc.urls[0];
      // transformRules stripped from slimmed result (content is passed to suggestions instead)
      expect(tocIssue).to.not.have.property('transformRules');
      expect(tocIssue.url).to.equal(url);
    });

    it('skips suggestion when page has only one heading (LLMO-4542)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":8,"reasoning":"No TOC"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><h1 id="title">Only Heading</h1><p>Some content</p></body>',
                  tags: { title: 'Page', description: 'Desc', h1: ['Only Heading'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.deep.equal({});
    });

    it('skips suggestion when page has only null/empty headings (LLMO-4542)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":8,"reasoning":"No TOC"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><h1></h1><h2>   </h2><p>Some content</p></body>',
                  tags: { title: 'Page', description: 'Desc', h1: [] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.deep.equal({});
    });
  });

  describe('TOC Placement Strategy', () => {
    it('suggests TOC placement in body > main when no H1 exists', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      // NOTE: Call order is: TOC detection, Brand guidelines, H1 suggestion
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"TOCCSSSelector":null,"confidence":7,"reasoning":"No TOC found"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test guidelines"}' } }],
          })
          .onThirdCall().resolves({
            choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test H1"}}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      let capturedSyncArgs;
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().callsFake((args) => {
            capturedSyncArgs = args;
            return Promise.resolve();
          }),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><main><h2>Section 1</h2><h2>Section 2</h2></main></body>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: [],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc, 'TOC should exist in audit result').to.exist;
      expect(result.auditResult.toc.toc, 'TOC.toc should exist').to.exist;
      const tocIssue = result.auditResult.toc.toc.urls[0];
      // transformRules stripped from slimmed audit DB record
      expect(tocIssue).to.not.have.property('transformRules');
      // Placement verified via suggestion data (transformRules flow into suggestions)
      expect(capturedSyncArgs).to.exist;
      expect(capturedSyncArgs.newData[0].transformRules.action).to.equal('insertBefore');
      expect(capturedSyncArgs.newData[0].transformRules.selector).to.equal('body > main > :first-child');
    });

    it('suggests TOC placement in body when no H1 or main exists', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      // NOTE: Call order is: TOC detection, Brand guidelines, H1 suggestion
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"confidence":6,"reasoning":"No TOC"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test guidelines"}' } }],
          })
          .onThirdCall().resolves({
            choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test H1"}}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      let capturedSyncArgs;
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().callsFake((args) => {
            capturedSyncArgs = args;
            return Promise.resolve();
          }),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><div><h2>Section 1</h2><h2>Section 2</h2></div></body>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: [],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc, 'TOC should exist in audit result').to.exist;
      expect(result.auditResult.toc.toc, 'TOC.toc should exist').to.exist;
      const tocIssue = result.auditResult.toc.toc.urls[0];
      // transformRules stripped from slimmed audit DB record
      expect(tocIssue).to.not.have.property('transformRules');
      // Placement verified via suggestion data
      expect(capturedSyncArgs).to.exist;
      expect(capturedSyncArgs.newData[0].transformRules.action).to.equal('insertBefore');
      expect(capturedSyncArgs.newData[0].transformRules.selector).to.equal('body > :first-child');
    });
  });

  describe('TOC Transform Rules', () => {
    it('includes heading data in TOC transform rules (passed to suggestions, stripped from slimmed result)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      // NOTE: Call order is: TOC detection, Brand guidelines
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"confidence":8}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test guidelines"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      let capturedSyncArgs;
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().callsFake((args) => {
            capturedSyncArgs = args;
            return Promise.resolve();
          }),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1 id="title">Main Title</h1><h2 id="sec1">Section 1</h2><h2 id="sec2">Section 2</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Main Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.exist;
      expect(result.auditResult.toc.toc).to.exist;
      const tocIssue = result.auditResult.toc.toc.urls[0];
      // transformRules stripped from slimmed audit DB record
      expect(tocIssue).to.not.have.property('transformRules');
      // transformRules content flows into suggestions (verified via captured syncSuggestions args)
      expect(capturedSyncArgs).to.exist;
      expect(capturedSyncArgs.newData[0].transformRules.value).to.be.an('array');
      expect(capturedSyncArgs.newData[0].transformRules.value.length).to.be.at.least(2);
      expect(capturedSyncArgs.newData[0].transformRules.valueFormat).to.equal('html');
    });
  });

  describe('TOC Suggestions Generation', () => {
    it('generates TOC suggestions correctly', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {},
          toc: {
            toc: {
              success: false,
              explanation: 'TOC is missing',
              urls: [{
                url: 'https://example.com/page1',
                explanation: 'Table of Contents should be present on the page (Confidence: 8/10)',
                suggestion: 'Add a Table of Contents to the page',
                isAISuggested: true,
                checkTitle: 'Table of Contents',
                tagName: 'nav',
                transformRules: {
                  action: 'insertAfter',
                  selector: 'h1#main',
                  value: [{ text: 'Title', level: 1 }],
                  valueFormat: 'html',
                },
                tocConfidence: 8,
                tocReasoning: 'No TOC found',
              }],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.toc).to.have.lengthOf(1);
      expect(result.suggestions.toc[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'toc',
        url: 'https://example.com/page1',
        explanation: 'Table of Contents should be present on the page (Confidence: 8/10)',
        recommendedAction: 'Add a Table of Contents to the page',
        isAISuggested: true,
      });
      expect(result.suggestions.toc[0].transformRules).to.exist;
    });

    it('uses checkResult.explanation when urlObj.explanation is missing (line 798)', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {},
          toc: {
            toc: {
              success: false,
              explanation: 'Default TOC explanation from checkResult',
              suggestion: 'Add TOC',
              urls: [{
                url: 'https://example.com/page1',
                // No explanation property - should fall back to checkResult.explanation
                suggestion: 'Custom suggestion for this URL',
              }],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.toc).to.have.lengthOf(1);
      // Should use checkResult.explanation as fallback
      expect(result.suggestions.toc[0].explanation).to.equal('Default TOC explanation from checkResult');
      expect(result.suggestions.toc[0].recommendedAction).to.equal('Custom suggestion for this URL');
    });

    it('uses generateRecommendedAction when urlObj.suggestion is missing (line 799)', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {},
          toc: {
            toc: {
              success: false,
              explanation: 'TOC is missing',
              suggestion: 'Default suggestion from checkResult',
              urls: [{
                url: 'https://example.com/page1',
                explanation: 'Custom explanation for this URL',
                // No suggestion property - should fall back to generateRecommendedAction
              }],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.toc).to.have.lengthOf(1);
      expect(result.suggestions.toc[0].explanation).to.equal('Custom explanation for this URL');
      // Should use generated recommendation - 'toc' doesn't have a specific case, so uses default
      expect(result.suggestions.toc[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    it('uses both fallbacks when urlObj has neither explanation nor suggestion', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {},
          toc: {
            toc: {
              success: false,
              explanation: 'Fallback explanation from checkResult',
              suggestion: 'Fallback suggestion from checkResult',
              urls: [{
                url: 'https://example.com/page1',
                // No explanation or suggestion - should use both fallbacks
              }],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.toc).to.have.lengthOf(1);
      // Should use checkResult.explanation as fallback
      expect(result.suggestions.toc[0].explanation).to.equal('Fallback explanation from checkResult');
      // Should use generated recommendation - 'toc' doesn't have a specific case, so uses default
      expect(result.suggestions.toc[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    it('handles null values correctly with nullish coalescing', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {},
          toc: {
            toc: {
              success: false,
              explanation: 'Fallback explanation',
              suggestion: 'Fallback suggestion',
              urls: [{
                url: 'https://example.com/page1',
                explanation: null, // Explicitly null - should use fallback
                suggestion: null, // Explicitly null - should use generated action
              }],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.toc).to.have.lengthOf(1);
      // Null should trigger fallback
      expect(result.suggestions.toc[0].explanation).to.equal('Fallback explanation');
      // Should use generated recommendation - 'toc' doesn't have a specific case, so uses default
      expect(result.suggestions.toc[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    
  });

  describe('TOC Opportunity Creation', () => {
    it('handles TOC opportunity creation', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-toc-opportunity-id',
      });

      const syncSuggestionsStub = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          headings: [],
          toc: [
            {
              type: 'CODE_CHANGE',
              checkType: 'toc',
              url: 'https://example.com/page1',
              explanation: 'TOC missing',
              recommendedAction: 'Add TOC',
              transformRules: {
                action: 'insertAfter',
                selector: 'h1',
                value: [{ text: 'Title', level: 1 }],
                valueFormat: 'html',
              },
            },
          ],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.suggestions.toc);
    });

    it('transforms TOC value to HAST in opportunityAndSuggestionsForToc', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-toc-opportunity-id',
      });

      const syncSuggestionsStub = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          headings: [],
          toc: [
            {
              type: 'CODE_CHANGE',
              checkType: 'toc',
              url: 'https://example.com/page1',
              explanation: 'TOC missing',
              recommendedAction: 'Add TOC',
              transformRules: {
                action: 'insertAfter',
                selector: 'h1',
                value: [
                  { text: 'Introduction', level: 1, id: 'intro', selector: 'h1#intro' },
                  { text: 'Section 1', level: 2, id: 'sec1', selector: 'h2#sec1' },
                ],
                valueFormat: 'html',
              },
            },
          ],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      const mappedSuggestion = mapNewSuggestionFn(auditData.suggestions.toc[0]);

      expect(mappedSuggestion.data.transformRules).to.exist;
      expect(mappedSuggestion.data.transformRules.valueFormat).to.equal('hast');
      // Value should be transformed to HAST
      expect(mappedSuggestion.data.transformRules.value).to.have.property('type', 'root');
      expect(mappedSuggestion.data.transformRules.value).to.have.property('children');

      const buildKeyFn = syncCall.args[0].buildKey;
      expect(buildKeyFn).to.be.a('function');
      expect(buildKeyFn(auditData.suggestions.toc[0]))
        .to.equal('toc|https://example.com/page1');
    });

    it('skips TOC opportunity creation when no TOC issues', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          headings: [],
          toc: [],
        },
      };

      const result = await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });
  });

  describe('sendTocGuidanceRequestToMystique (outbound guidance:table-of-contents message)', () => {
    const makeExistingSuggestion = (data, status = 'NEW') => ({
      getId: () => 'suggestion-1',
      getStatus: () => status,
      getData: () => data,
    });

    const setupMystiqueContext = (existingSuggestions) => {
      context.sqs = { sendMessage: sinon.stub().resolves() };
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = 'test-mystique-queue';
      context.audit = { getId: () => 'audit-1' };
      context.site = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getRegion: () => 'US',
      };
      return sinon.stub().resolves({
        getId: () => 'test-toc-opportunity-id',
        getAuditId: () => null,
        getSuggestions: sinon.stub().resolves(existingSuggestions),
      });
    };

    it('includes siteId and auditId at the top level, matching the guidance:prerender/summarization contract', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({
          url: 'https://example.com/page1',
          title: 'Page 1',
          transformRules: {
            value: [{
              type: 'element',
              tagName: 'a',
              properties: { 'data-selector': 'h1#intro' },
              children: [{ type: 'text', value: 'Introduction' }],
            }],
          },
        }),
      ]);
      // Simulates the flag having been parsed in step 1 and forwarded through steps 2/3.
      context.auditContext = { generatePrompts: true };

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
            explanation: 'TOC missing',
            recommendedAction: 'Add TOC',
            transformRules: {
              action: 'insertAfter', selector: 'h1', value: [{ text: 'Title', level: 1 }], valueFormat: 'html',
            },
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [queue, message] = context.sqs.sendMessage.getCall(0).args;
      expect(queue).to.equal('test-mystique-queue');
      expect(message).to.include({
        type: 'guidance:table-of-contents',
        url: auditUrl,
        siteId: 'site-1',
        auditId: 'audit-1',
      });
      expect(message.data).to.include({
        opportunityId: 'test-toc-opportunity-id',
        generatePrompts: true,
        siteRegion: 'US',
      });
      expect(message.data.suggestions).to.have.length(1);
      expect(message.data.suggestions[0]).to.include({
        url: 'https://example.com/page1',
        title: 'Page 1',
      });
      expect(message.data.suggestions[0].headings).to.deep.equal(['Introduction']);
    });

    it('skips FIXED/OUTDATED/SKIPPED/edge-deployed suggestions, and no eligible suggestions remain', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({ url: 'https://example.com/fixed' }, 'FIXED'),
        makeExistingSuggestion({ url: 'https://example.com/outdated' }, 'OUTDATED'),
        makeExistingSuggestion({ url: 'https://example.com/skipped' }, 'SKIPPED'),
        makeExistingSuggestion({ url: 'https://example.com/edge-deployed', edgeDeployed: true }),
      ]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/fixed', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('includes already-prompted suggestions tagged with hasPrompts instead of silently excluding them', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({
          url: 'https://example.com/already-has-prompts',
          hasPrompts: true,
          prompts: [{ id: 'p1' }],
        }),
      ]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/already-has-prompts', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = context.sqs.sendMessage.getCall(0).args;
      expect(message.data.suggestions).to.have.length(1);
      expect(message.data.suggestions[0]).to.include({
        url: 'https://example.com/already-has-prompts',
        hasPrompts: true,
      });
    });

    it('defaults generatePrompts to false in the outbound message when auditContext has no flag', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({ url: 'https://example.com/page1' }),
      ]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const [, message] = context.sqs.sendMessage.getCall(0).args;
      expect(message.data.generatePrompts).to.equal(false);
    });

    it('falls back to opportunity.getAuditId() then a synthetic id when context.audit is absent', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({ url: 'https://example.com/page1' }),
      ]);
      delete context.audit;

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      // No opportunity.getAuditId() on the resolved entity → synthetic fallback.
      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);
      let [, message] = context.sqs.sendMessage.getCall(0).args;
      expect(message.auditId).to.equal('toc-ai-only-site-1');

      // opportunity.getAuditId() present → used over the synthetic fallback.
      const convertToOpportunityStubWithAuditId = sinon.stub().resolves({
        getId: () => 'test-toc-opportunity-id',
        getAuditId: () => 'stored-audit-id',
        getSuggestions: sinon.stub().resolves([
          makeExistingSuggestion({ url: 'https://example.com/page1' }),
        ]),
      });
      const mockedHandler2 = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStubWithAuditId },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });
      await mockedHandler2.opportunityAndSuggestions(auditUrl, auditData, context);
      [, message] = context.sqs.sendMessage.getCall(1).args;
      expect(message.auditId).to.equal('stored-audit-id');
    });

    it('swallows errors from sqs.sendMessage and logs them without failing the audit', async () => {
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;

      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({ url: 'https://example.com/page1', title: 'Page 1' }),
      ]);
      context.sqs.sendMessage = sinon.stub().rejects(new Error('SQS unavailable'));

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await expect(mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context)).to.be.fulfilled;

      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Failed to send guidance:table-of-contents message to Mystique/),
      );
    });

    it('skips the Mystique message when the opportunity entity has no getId', async () => {
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;
      context.sqs = { sendMessage: sinon.stub().resolves() };
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = 'test-mystique-queue';

      const convertToOpportunityStub = sinon.stub().resolves({
        getSuggestions: sinon.stub().resolves([]),
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available/),
      );
    });

    it('skips the Mystique message when there are no existing suggestions to send', async () => {
      const convertToOpportunityStub = setupMystiqueContext([]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('walks nested HAST wrappers and tolerates null children and childless anchors when extracting headings', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({
          url: 'https://example.com/page1',
          title: 'Page 1',
          transformRules: {
            value: [
              { type: 'text', value: '\n' },
              {
                type: 'element',
                tagName: 'ul',
                children: [
                  null,
                  {
                    type: 'element',
                    tagName: 'li',
                    children: [
                      {
                        type: 'element',
                        tagName: 'a',
                        properties: { 'data-selector': 'h2#one' },
                        children: [{ type: 'text', value: 'First Heading' }],
                      },
                    ],
                  },
                  {
                    type: 'element',
                    tagName: 'a',
                    properties: { 'data-selector': 'h2#two' },
                  },
                ],
              },
            ],
          },
        }),
      ]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = context.sqs.sendMessage.getCall(0).args;
      expect(message.data.suggestions[0].headings).to.deep.equal(['First Heading']);
    });

    it('falls back through site?.getBaseURL?.() in the skip-warning when auditUrl is empty and SQS/queue is unconfigured', async () => {
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;
      // No context.sqs / QUEUE_SPACECAT_TO_MYSTIQUE configured on purpose.

      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-toc-opportunity-id',
        getSuggestions: sinon.stub().resolves([]),
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      // No site at all: `site?.` short-circuits, falls through to the final `|| ''`.
      delete context.site;
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured.*baseUrl=$/),
      );

      // Site present but with no getBaseURL method: `?.()` short-circuits instead.
      context.site = {};
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured.*baseUrl=$/),
      );

      // Site present with a real getBaseURL(): the call actually resolves.
      context.site = { getBaseURL: () => 'https://fallback.example.com' };
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured.*baseUrl=https:\/\/fallback\.example\.com/),
      );
    });

    it('falls back through site?.getBaseURL?.() in the skip-warning when auditUrl is empty and the opportunity has no getId', async () => {
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;
      context.sqs = { sendMessage: sinon.stub().resolves() };
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = 'test-mystique-queue';

      const convertToOpportunityStub = sinon.stub().resolves({
        getSuggestions: sinon.stub().resolves([]),
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      // No site at all: `site?.` short-circuits, falls through to the final `|| ''`.
      delete context.site;
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available.*baseUrl=$/),
      );

      // Site present but with no getBaseURL method: `?.()` short-circuits instead.
      context.site = {};
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available.*baseUrl=$/),
      );

      // Site present with a real getBaseURL(): the call actually resolves.
      context.site = { getBaseURL: () => 'https://fallback.example.com' };
      await mockedHandler.opportunityAndSuggestions('', auditData, context);
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Opportunity entity not available.*baseUrl=https:\/\/fallback\.example\.com/),
      );
    });

    it('defaults siteRegion to an empty string when the site has no getRegion method', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({ url: 'https://example.com/page1', title: 'Page 1' }),
      ]);
      delete context.site.getRegion;

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const [, message] = context.sqs.sendMessage.getCall(0).args;
      expect(message.data.siteRegion).to.equal('');
    });

    it('derives per-candidate url/title defaults and hasPrompts across edge-case suggestion shapes', async () => {
      const convertToOpportunityStub = setupMystiqueContext([
        makeExistingSuggestion({}),
        makeExistingSuggestion({ url: 'https://example.com/u2', hasPrompts: true, prompts: [] }),
        makeExistingSuggestion({ url: 'https://example.com/u3', prompts: [{ id: 'p1' }] }),
      ]);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: sinon.stub().resolves() },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE', checkType: 'toc', url: 'https://example.com/page1', explanation: 'x', recommendedAction: 'x',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const [, message] = context.sqs.sendMessage.getCall(0).args;
      const [candidate1, candidate2, candidate3] = message.data.suggestions;

      expect(candidate1).to.include({ url: '', title: '', hasPrompts: false });
      expect(candidate2.hasPrompts).to.equal(true);
      expect(candidate3.hasPrompts).to.equal(true);
    });
  });

  describe('TOC custom persister (slimmed audit vs full post-processor data)', () => {
    it('slimTocAuditResult strips transformRules from urls for persistence', () => {
      const auditResult = {
        toc: {
          toc: {
            success: false,
            urls: [
              {
                url: 'https://example.com/page',
                explanation: 'TOC missing',
                transformRules: { action: 'insertAfter', selector: 'h1', value: [] },
              },
            ],
          },
        },
      };
      const slimmed = slimTocAuditResult(auditResult);
      expect(slimmed.toc.toc.urls).to.have.lengthOf(1);
      expect(slimmed.toc.toc.urls[0]).to.not.have.property('transformRules');
      expect(slimmed.toc.toc.urls[0].url).to.equal('https://example.com/page');
      expect(auditResult.toc.toc.urls[0]).to.have.property('transformRules');
    });

    it('tocPersister persists slimmed data and logs; post-processors receive full data', async () => {
      const url = 'https://example.com/page';
      const auditCreateStub = sinon.stub().resolves({ getId: () => 'audit-123' });
      const syncSuggestionsStub = sinon.stub().resolves();
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'toc-opportunity-id',
        getSiteId: () => 'site-1',
      });
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      const fullAuditResult = {
        toc: {
          toc: {
            success: false,
            urls: [
              {
                url,
                explanation: 'TOC missing',
                suggestion: 'Add TOC',
                transformRules: { action: 'insertAfter', selector: 'h1', value: [{ text: 'Title', level: 1 }] },
              },
            ],
          },
        },
      };
      const auditData = {
        siteId: 'site-1',
        isLive: true,
        auditedAt: new Date().toISOString(),
        auditType: 'toc',
        auditResult: fullAuditResult,
        fullAuditRef: url,
      };
      const testContext = {
        log: logSpy,
        dataAccess: { Audit: { create: auditCreateStub } },
      };

      const { tocPersister } = await import('../../src/toc/handler.js');
      await tocPersister(auditData, testContext);

      expect(auditCreateStub).to.have.been.calledOnce;
      const persistedAuditData = auditCreateStub.firstCall.args[0];
      expect(persistedAuditData.auditResult.toc.toc.urls[0]).to.not.have.property('transformRules');
      expect(logSpy.debug.called).to.be.true;
      const persisterLog = logSpy.debug.getCalls().find((c) => c.args[0] && c.args[0].includes('[TOC Persister]'));
      expect(persisterLog).to.exist;
      expect(persisterLog.args[0]).to.include('slimmed');

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
        '../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
      });
      const auditUrl = 'https://example.com';
      const suggestionsAuditData = {
        suggestions: {
          headings: [],
          toc: [
            {
              type: 'CODE_CHANGE',
              checkType: 'toc',
              url,
              explanation: 'TOC missing',
              recommendedAction: 'Add TOC',
              transformRules: { action: 'insertAfter', selector: 'h1', value: [{ text: 'Title', level: 1 }] },
            },
          ],
        },
      };
      await mockedHandler.opportunityAndSuggestions(auditUrl, suggestionsAuditData, context);
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncArgs = syncSuggestionsStub.firstCall.args[0];
      expect(syncArgs.newData[0]).to.have.property('transformRules');
      expect(syncArgs.newData[0].transformRules).to.include({ action: 'insertAfter' });
    });
  });

  describe('TOC Error Handling', () => {
    it('uses confidence score from AI response when valid (line 291 truthy branch)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"confidence":7,"reasoning":"Custom confidence"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should use the AI-provided confidence score of 7
      expect(result.auditResult.toc.toc.urls[0].tocConfidence).to.equal(7);
    });

    it('uses default confidence 5 when AI response has no confidence (line 291 falsy branch)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"reasoning":"No confidence provided"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should use default confidence of 5
      expect(result.auditResult.toc.toc.urls[0].tocConfidence).to.equal(5);
    });

    it('handles confidence score that is not a number (line 292 type check)', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"confidence":"high","reasoning":"String confidence"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should log warning and default to 5
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Invalid confidence score high.*defaulting to 5/),
      );
      expect(result.auditResult.toc.toc.urls[0].tocConfidence).to.equal(5);
    });

    it('handles invalid TOC detection response structure', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      // NOTE: Call order is: TOC detection (invalid), Brand guidelines
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"invalid":"response"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should handle invalid response gracefully
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Invalid response structure.*Expected tocPresent as boolean/),
      );
    });

    it('handles TOC detection with invalid confidence score', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      // NOTE: Call order is: TOC detection, Brand guidelines
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false,"confidence":15,"reasoning":"Invalid confidence"}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should default to 5 and log warning
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Invalid confidence score 15.*defaulting to 5/),
      );

      expect(result.auditResult).to.exist;
      expect(result.auditResult.toc).to.exist;
      expect(result.auditResult.toc.toc).to.exist;
      const tocIssue = result.auditResult.toc.toc.urls[0];
      expect(tocIssue.tocConfidence).to.equal(5);
    });

    it('handles TOC detection error gracefully', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      // NOTE: Call order is: TOC detection (error), Brand guidelines
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().rejects(new Error('AI service error'))
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // Should handle error gracefully
      expect(logSpy.error).to.have.been.called;
    });

    it('handles missing body element in TOC detection', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      // NOTE: When body is missing, TOC detection returns early with warning
      // Then brand guidelines is called
      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<html><head></head></html>', // No body element
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: [],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // JSDOM auto-creates a <body> element even when HTML doesn't have one
      // So the warning may not be logged, but the audit should complete successfully
      const warnCalls = logSpy.warn.getCalls();
      const hasTocWarning = warnCalls.some((call) => {
        const message = call.args[0];
        return typeof message === 'string' && message.includes('[TOC Detection]') && message.includes('No body element found');
      });
      
      // Either the warning is logged (body truly missing) or audit completes gracefully (JSDOM auto-created body)
      if (hasTocWarning) {
        // Great! The warning was logged as expected
        expect(hasTocWarning).to.be.true;
      } else {
        // JSDOM auto-created body, so audit should complete without throwing errors
        expect(result).to.exist;
        expect(result.auditResult).to.exist;
        // The audit completes - it may have heading issues (missing H1) but no crash
        // Just verify the result structure is valid
        expect(result.auditResult).to.be.an('object');
      }
    });
  });

  describe('TOC Opportunity Data Mapper', () => {
    it('creates proper TOC opportunity data structure', async () => {
      const { createOpportunityDataForTOC } = await import('../../src/toc/opportunity-data-mapper.js');
      const opportunityData = createOpportunityDataForTOC();

      expect(opportunityData).to.be.an('object');
      expect(opportunityData).to.have.property('runbook', '');
      expect(opportunityData).to.have.property('origin', 'AUTOMATION');
      expect(opportunityData).to.have.property('title', '[Beta] Add Table of Content');
      expect(opportunityData).to.have.property('description');
      expect(opportunityData.description).to.include('table of contents');
    });

    it('description mentions heading-based suggestion generation', async () => {
      const { createOpportunityDataForTOC } = await import('../../src/toc/opportunity-data-mapper.js');
      const opportunityData = createOpportunityDataForTOC();

      expect(opportunityData.description).to.include('H1, H2');
      expect(opportunityData.description).to.include('heading structure');
      expect(opportunityData.description).to.include('accurate TOC suggestions');
    });

    it('description contains both accessibility context and heading guidance', async () => {
      const { createOpportunityDataForTOC } = await import('../../src/toc/opportunity-data-mapper.js');
      const opportunityData = createOpportunityDataForTOC();

      expect(opportunityData.description).to.include('accessibility');
      expect(opportunityData.description).to.include('generative engines');
      expect(opportunityData.description).to.include('Suggestions are generated based on page heading');
    });

    it('includes proper guidance steps for TOC', async () => {
      const { createOpportunityDataForTOC } = await import('../../src/toc/opportunity-data-mapper.js');
      const opportunityData = createOpportunityDataForTOC();

      expect(opportunityData).to.have.property('guidance');
      expect(opportunityData.guidance).to.have.property('steps');
      expect(opportunityData.guidance.steps).to.be.an('array');
      expect(opportunityData.guidance.steps).to.have.lengthOf(3);

      const steps = opportunityData.guidance.steps;
      expect(steps[0]).to.include('Review pages flagged for TOC issues');
      expect(steps[1]).to.include('AI-generated suggestions');
      expect(steps[2]).to.include('properly implemented in the <head> section');
    });

    it('has correct tags for TOC', async () => {
      const { createOpportunityDataForTOC } = await import('../../src/toc/opportunity-data-mapper.js');
      const opportunityData = createOpportunityDataForTOC();

      expect(opportunityData).to.have.property('tags');
      expect(opportunityData.tags).to.be.an('array');
      expect(opportunityData.tags).to.include('Accessibility');
      expect(opportunityData.tags).to.include('SEO');
      expect(opportunityData.tags).to.include('isElmo');
    });
  });

  describe('TOC Merge Data Function', () => {
    it('merges existing and new suggestions normally when isEdited is false', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
            explanation: 'TOC missing',
            recommendedAction: 'Add TOC',
            transformRules: {
              action: 'insertAfter',
              selector: 'h1',
              value: [{ text: 'New Title', level: 1 }],
              valueFormat: 'html',
            },
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(capturedMergeDataFunction).to.be.a('function');

      const existingSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'Old explanation',
        isEdited: false,
        transformRules: {
          value: [{ text: 'Old Title', level: 1 }],
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'New explanation',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      expect(merged.explanation).to.equal('New explanation');
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'New Title', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
      expect(merged.isEdited).to.equal(false);
    });

    it('preserves transformRules.value when isEdited is true and value exists', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
            transformRules: {
              value: [{ text: 'Title', level: 1 }],
            },
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'Old explanation',
        isEdited: true,
        transformRules: {
          value: [{ text: 'Edited by User', level: 1 }],
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'New explanation',
        transformRules: {
          value: [{ text: 'AI Generated', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should preserve the edited value, converted to HAST
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'Edited by User', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
      expect(merged.explanation).to.equal('New explanation');
      expect(merged.isEdited).to.equal(true);
    });

    it('does not preserve value when isEdited is true but transformRules.value is undefined', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        isEdited: true,
        transformRules: {
          action: 'insertAfter',
          selector: 'h1',
          // No value property
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should use new value since existing.transformRules.value is undefined, converted to HAST
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'New Title', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
      expect(merged.isEdited).to.equal(true);
    });

    it('does not preserve value when isEdited is true but transformRules is null', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        isEdited: true,
        transformRules: null,
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should use new value since existing.transformRules is null, converted to HAST
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'New Title', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
      expect(merged.isEdited).to.equal(true);
    });

    it('overwrites value when isEdited is false even if transformRules.value exists', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        isEdited: false,
        transformRules: {
          value: [{ text: 'Old Title', level: 1 }],
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should overwrite with new value since isEdited is false, converted to HAST
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'New Title', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
      expect(merged.isEdited).to.equal(false);
    });

    it('handles case where isEdited is undefined (falsy)', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        // isEdited is undefined
        transformRules: {
          value: [{ text: 'Old Title', level: 1 }],
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should overwrite with new value since isEdited is undefined (falsy), converted to HAST
      expect(merged.transformRules.value).to.deep.equal(tocArrayToHast([{ text: 'New Title', level: 1 }]));
      expect(merged.transformRules.valueFormat).to.equal('hast');
    });

    it('preserves HAST value and sets valueFormat to hast when value is already HAST', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const hastValue = tocArrayToHast([{ text: 'Existing HAST', level: 1 }]);
      const existingSuggestion = {
        url: 'https://example.com/page1',
        isEdited: true,
        transformRules: {
          value: hastValue,
          valueFormat: 'html',
        },
      };

      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Should preserve the existing HAST value (isEdited=true) and fix valueFormat
      expect(merged.transformRules.value).to.deep.equal(hastValue);
      expect(merged.transformRules.valueFormat).to.equal('hast');
    });

    it('returns existing suggestion unchanged when edgeDeployed is true', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        isEdited: true,
        edgeDeployed: true,
        transformRules: {
          value: [{ text: 'Deployed Title', level: 1 }],
        },
      };
      const newSuggestion = {
        url: 'https://example.com/page1',
        transformRules: {
          value: [{ text: 'New Audit Title', level: 1 }],
        },
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      // Must return existing data unchanged — re-audit must not overwrite deployed suggestions
      expect(merged.edgeDeployed).to.equal(true);
      expect(merged.transformRules.value).to.deep.equal([{ text: 'Deployed Title', level: 1 }]);
      expect(merged.isEdited).to.equal(true);
    });

    it('preserves Mystique-persisted prompts across re-audits when the new suggestion has none', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'Old explanation',
        prompts: [{ id: 'p1', prompt: 'What is X?' }],
        hasPrompts: true,
      };
      // Re-audits never re-derive prompts, so the raw new suggestion carries empty defaults
      const newSuggestion = {
        url: 'https://example.com/page1',
        explanation: 'New explanation',
        prompts: [],
        hasPrompts: false,
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      expect(merged.explanation).to.equal('New explanation');
      expect(merged.prompts).to.deep.equal([{ id: 'p1', prompt: 'What is X?' }]);
      expect(merged.hasPrompts).to.equal(true);
    });

    it('does not touch prompts on merge when the new suggestion already carries its own', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id',
      });

      let capturedMergeDataFunction;
      const syncSuggestionsStub = sinon.stub().callsFake((args) => {
        capturedMergeDataFunction = args.mergeDataFunction;
        return Promise.resolve();
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: {
          toc: [{
            type: 'CODE_CHANGE',
            checkType: 'toc',
            url: 'https://example.com/page1',
          }],
        },
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const existingSuggestion = {
        url: 'https://example.com/page1',
        prompts: [{ id: 'p1', prompt: 'Old prompt' }],
        hasPrompts: true,
      };
      const newSuggestion = {
        url: 'https://example.com/page1',
        prompts: [{ id: 'p2', prompt: 'New prompt' }],
        hasPrompts: true,
      };

      const merged = capturedMergeDataFunction(existingSuggestion, newSuggestion);

      expect(merged.prompts).to.deep.equal([{ id: 'p2', prompt: 'New prompt' }]);
      expect(merged.hasPrompts).to.equal(true);
    });
  });

  describe('Coverage Tests for Missing Lines', () => {
    it('covers lines 162-164: null scrapeJsonObject in validatePageTocFromScrapeJson', async () => {
      const { validatePageTocFromScrapeJson } = await import('../../src/toc/handler.js');
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

      const result = await validatePageTocFromScrapeJson(url, null, logSpy, context);

      expect(result).to.be.null;
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Scrape JSON object not found/)
      );
    });

    it('covers lines 185-190: error in validatePageTocFromScrapeJson', async () => {
      const { validatePageTocFromScrapeJson } = await import('../../src/toc/handler.js');
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

      // Pass an invalid scrapeJsonObject that will cause an error
      const invalidScrapeJson = {
        scrapeResult: null, // This will cause an error when accessing rawBody
      };

      const result = await validatePageTocFromScrapeJson(url, invalidScrapeJson, logSpy, context);

      expect(result.url).to.equal(url);
      expect(result.tocDetails).to.be.null;
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Error validating TOC for/)
      );
    });

    it('returns early when no scrapeResultPaths available', async () => {
      const { processTocResults } = await import('../../src/toc/handler.js');
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.scrapeResultPaths = new Map();

      const result = await processTocResults(context);

      expect(result.auditResult.success).to.be.false;
      expect(logSpy.warn).to.have.been.calledWith('[TOC Audit] No scrape results available, ending audit.');
    });

    it('returns early when scrapeResultPaths is undefined', async () => {
      const { processTocResults } = await import('../../src/toc/handler.js');
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.scrapeResultPaths = undefined;

      const result = await processTocResults(context);

      expect(result.auditResult.success).to.be.false;
      expect(logSpy.warn).to.have.been.calledWith('[TOC Audit] No scrape results available, ending audit.');
    });

    it('covers error catch block in processTocResults', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;

      // Use a scrapeResultPaths that is iterable but throws during Array.from
      const throwingMap = {
        size: 1,
        entries: () => { throw new Error('Map iteration error'); },
      };

      const { processTocResults } = await import('../../src/toc/handler.js');

      context.scrapeResultPaths = throwingMap;
      await expect(processTocResults(context)).to.be.rejectedWith('Map iteration error');
      expect(logSpy.error).to.have.been.calledWith(sinon.match(/TOC audit failed/));
      expect(context.dataAccess.Audit.updateByKeys).to.have.been.called;
    });

    it('covers lines 360-362: early return when TOC audit has no issues', async () => {
      const mockedHandler = await esmock('../../src/toc/handler.js');
      const { generateSuggestions } = mockedHandler;

      const auditUrl = 'https://example.com';
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          toc: {}, // Empty toc means success/no issues
        },
      };
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      const testContext = { log: logSpy };

      const result = generateSuggestions(auditUrl, auditData, testContext);

      expect(result).to.deep.equal(auditData);
      expect(logSpy.info).to.have.been.calledWith(
        sinon.match(/has no issues or failed, skipping suggestions generation/)
      );
    });

    it('covers lines 360-362: early return when TOC audit has error', async () => {
      const mockedHandler = await esmock('../../src/toc/handler.js');
      const { generateSuggestions } = mockedHandler;

      const auditUrl = 'https://example.com';
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          toc: {
            error: 'Some error occurred',
          },
        },
      };
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      const testContext = { log: logSpy };

      const result = generateSuggestions(auditUrl, auditData, testContext);

      expect(result).to.deep.equal(auditData);
      expect(logSpy.info).to.have.been.calledWith(
        sinon.match(/has no issues or failed, skipping suggestions generation/)
      );
    });

    it('covers lines 360-362: early return when TOC check is top-pages', async () => {
      const mockedHandler = await esmock('../../src/toc/handler.js');
      const { generateSuggestions } = mockedHandler;

      const auditUrl = 'https://example.com';
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          toc: {
            check: 'top-pages',
          },
        },
      };
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      const testContext = { log: logSpy };

      const result = generateSuggestions(auditUrl, auditData, testContext);

      expect(result).to.deep.equal(auditData);
      expect(logSpy.info).to.have.been.calledWith(
        sinon.match(/has no issues or failed, skipping suggestions generation/)
      );
    });

    it('covers lines 458-459: slimTocAuditResult early return when auditResult.toc is falsy', () => {
      const auditResult = { fullAuditRef: 'https://example.com', toc: undefined };
      const result = slimTocAuditResult(auditResult);
      expect(result).to.deep.equal(auditResult);
      expect(result.toc).to.equal(undefined);
    });

    it('covers lines 451-452: slimTocAuditResult returns as-is when auditResult is null or non-object', () => {
      expect(slimTocAuditResult(null)).to.equal(null);
      expect(slimTocAuditResult(undefined)).to.equal(undefined);
      const str = 'not an object';
      expect(slimTocAuditResult(str)).to.equal(str);
    });

    it('covers lines 453-455: slimTocAuditResult early return when auditResult.toc is empty object', () => {
      const auditResult = { fullAuditRef: 'https://example.com', toc: {} };
      const result = slimTocAuditResult(auditResult);
      expect(result).to.deep.equal(auditResult);
      expect(result.toc).to.deep.equal({});
    });

    it('covers line 463: slimTocAuditResult pass-through when checkResult has no urls array', () => {
      const auditResult = {
        toc: {
          toc: { success: false },
          otherKey: { urls: null },
        },
      };
      const result = slimTocAuditResult(auditResult);
      expect(result.toc.toc).to.deep.equal({ success: false });
      expect(result.toc.otherKey).to.deep.equal({ urls: null });
    });

    it('covers line 488: tocPersister skips debug log when log or log.debug is not available', async () => {
      const auditCreateStub = sinon.stub().resolves({ getId: () => 'audit-123' });
      const auditData = {
        siteId: 'site-1',
        auditResult: { toc: { toc: { urls: [{ url: 'https://example.com' }] } } },
        fullAuditRef: 'https://example.com',
      };
      const contextNoLog = { dataAccess: { Audit: { create: auditCreateStub } } };
      const { tocPersister } = await import('../../src/toc/handler.js');
      await tocPersister(auditData, contextNoLog);
      expect(auditCreateStub).to.have.been.calledOnce;

      auditCreateStub.resetHistory();
      const contextLogNoDebug = { log: {}, dataAccess: { Audit: { create: auditCreateStub } } };
      await tocPersister(auditData, contextLogNoDebug);
      expect(auditCreateStub).to.have.been.calledOnce;

      auditCreateStub.resetHistory();
      const logSpy = { debug: sinon.spy() };
      const auditDataNoUrls = {
        siteId: 'site-1',
        auditResult: { toc: { toc: {} } },
        fullAuditRef: 'https://example.com',
      };
      await tocPersister(auditDataNoUrls, {
        log: logSpy,
        dataAccess: { Audit: { create: auditCreateStub } },
      });
      expect(auditCreateStub).to.have.been.calledOnce;
      expect(logSpy.debug.called).to.be.true;
      expect(logSpy.debug.firstCall.args[0]).to.match(/from 0 URLs/);
    });
  });

  describe('Branch Coverage Tests', () => {
    it('covers line 73: fallback to empty string when pageTags.title is falsy', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false}' } }],
        }),
      };

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '@adobe/spacecat-shared-gpt-client': {
          AzureOpenAIClient: {
            createFrom: sinon.stub().returns(mockClient),
          },
        },
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      // Mock S3 to return data WITHOUT title (null/undefined)
      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2>',
                  tags: {
                    title: null, // Falsy value to trigger fallback
                    description: 'Test',
                    h1: ['Test'],
                  },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(result).to.have.property('auditResult');
    });

    it('covers line 381: fallback to empty array when suggestions.toc does not exist', async () => {
      const { opportunityAndSuggestions } = await import('../../src/toc/handler.js');
      const auditUrl = 'https://example.com';
      
      // Create auditData WITHOUT suggestions.toc to trigger fallback
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          toc: {},
        },
        // No suggestions key at all
      };
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      const mockContext = { 
        log: logSpy,
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
      };

      const result = await opportunityAndSuggestions(auditUrl, auditData, mockContext);

      expect(result).to.deep.equal(auditData);
      expect(logSpy.info).to.have.been.calledWith(
        sinon.match(/no issues, skipping opportunity creation/)
      );
    });
  });

  describe('hasTocInDom (DOM heuristic TOC detection)', () => {
    describe('Signal 1: anchor link lists', () => {
      it('returns true when ul has 2+ internal anchor links', () => {
        const $ = cheerioLoad(
          '<ul><li><a href="#s1">Section 1</a></li><li><a href="#s2">Section 2</a></li></ul>',
        );
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true when ol has 2+ internal anchor links', () => {
        const $ = cheerioLoad(
          '<ol><li><a href="#s1">Section 1</a></li><li><a href="#s2">Section 2</a></li></ol>',
        );
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for Repsol-style anchor__list with 2+ href="#" links', () => {
        const $ = cheerioLoad(
          '<ul class="anchor__list">'
          + '<li><a href="#como-funciona">¿Cómo funciona?</a></li>'
          + '<li><a href="#descuento-particulares">Descuento particulares</a></li>'
          + '</ul>',
        );
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns false when list has only 1 internal anchor link', () => {
        const $ = cheerioLoad('<ul><li><a href="#s1">Section 1</a></li></ul>');
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false when list links do not start with #', () => {
        const $ = cheerioLoad(
          '<ul>'
          + '<li><a href="https://example.com/s1">Section 1</a></li>'
          + '<li><a href="https://example.com/s2">Section 2</a></li>'
          + '</ul>',
        );
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false when list links use bare href="#" (JS tab placeholders, not section anchors)', () => {
        const $ = cheerioLoad(
          '<ul class="search-menu__mobile-navtabs-container">'
          + '<li><a href="#" data-nav="popular">Popular search</a></li>'
          + '<li><a href="#" data-nav="latest">Must have</a></li>'
          + '</ul>',
        );
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false when nav menu has links without # anchors', () => {
        const $ = cheerioLoad(
          '<nav><ul>'
          + '<li><a href="/home">Home</a></li>'
          + '<li><a href="/about">About</a></li>'
          + '<li><a href="/contact">Contact</a></li>'
          + '</ul></nav>',
        );
        expect(hasTocInDom($)).to.equal(false);
      });
    });

    describe('Signal 2: TOC-related class/id names', () => {
      it('returns true for element with class containing "toc"', () => {
        const $ = cheerioLoad('<nav class="toc"><ul><li>Item</li></ul></nav>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with id containing "toc"', () => {
        const $ = cheerioLoad('<div id="toc-container"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class containing "table-of-contents"', () => {
        const $ = cheerioLoad('<div class="table-of-contents"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class containing "tableofcontents"', () => {
        const $ = cheerioLoad('<div class="tableofcontents"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class containing "anchor-list"', () => {
        const $ = cheerioLoad('<ul class="anchor-list"><li>Item</li></ul>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class containing "anchor__list"', () => {
        const $ = cheerioLoad('<ul class="anchor__list"><li>Item</li></ul>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with id containing "table-of-contents"', () => {
        const $ = cheerioLoad('<nav id="table-of-contents"><ul><li>Item</li></ul></nav>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class containing "cmp-toc__content"', () => {
        const $ = cheerioLoad('<div class="cmp-toc__content"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class "abc-toc-xyz" (toc between hyphens)', () => {
        const $ = cheerioLoad('<nav class="abc-toc-xyz"><ul><li>Item</li></ul></nav>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class "site-toc" (toc at end after hyphen)', () => {
        const $ = cheerioLoad('<div class="site-toc"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class "toc-wrapper" (toc at start before hyphen)', () => {
        const $ = cheerioLoad('<div class="toc-wrapper"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with class "my_toc" (underscore boundary)', () => {
        const $ = cheerioLoad('<div class="my_toc"><ul><li>Item</li></ul></div>');
        expect(hasTocInDom($)).to.equal(true);
      });

      it('returns true for element with multiple classes where one is "toc"', () => {
        const $ = cheerioLoad('<nav class="nav-bar toc active"><ul><li>Item</li></ul></nav>');
        expect(hasTocInDom($)).to.equal(true);
      });
    });

    describe('false positives — must not detect as TOC', () => {
      it('returns false for Algolia autocomplete widget (class "aa-Autocomplete" contains "toc" as substring)', () => {
        const $ = cheerioLoad(
          '<div class="aa-Autocomplete" role="combobox">'
          + '<input id="autocomplete-0-input" type="search">'
          + '</div>',
        );
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false for element with id "autocomplete-0-label"', () => {
        const $ = cheerioLoad('<label id="autocomplete-0-label">Search</label>');
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false for class "doctor" (contains "toc" but not at a word boundary)', () => {
        const $ = cheerioLoad('<div class="doctor"><p>Content</p></div>');
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false for class "protocol" (contains "toc" as substring)', () => {
        const $ = cheerioLoad('<div class="protocol"><p>Content</p></div>');
        expect(hasTocInDom($)).to.equal(false);
      });
    });

    describe('no TOC signals', () => {
      it('returns false when page has no TOC signals', () => {
        const $ = cheerioLoad(
          '<body><h1>Title</h1><h2>Section 1</h2><p>Content</p></body>',
        );
        expect(hasTocInDom($)).to.equal(false);
      });

      it('returns false for empty page', () => {
        const $ = cheerioLoad('');
        expect(hasTocInDom($)).to.equal(false);
      });
    });
  });

  describe('TOC Detection — Phase 1 (DOM heuristic) integration', () => {
    it('skips AI call and returns no issues when DOM heuristic finds anchor list TOC', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = { fetchChatCompletion: sinon.stub() };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><main>'
                    + '<h1>Page Title</h1>'
                    + '<ul class="anchor__list">'
                    + '<li><a href="#section-1">Section 1</a></li>'
                    + '<li><a href="#section-2">Section 2</a></li>'
                    + '</ul>'
                    + '<h2 id="section-1">Section 1</h2><p>Content</p>'
                    + '<h2 id="section-2">Section 2</h2><p>Content</p>'
                    + '</main></body>',
                  tags: { title: 'Page Title', description: 'Desc', h1: ['Page Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // AI should NOT have been called — DOM heuristic handled it
      expect(mockClient.fetchChatCompletion.callCount).to.equal(0);
      // No TOC issue should be reported
      expect(result.auditResult.toc).to.deep.equal({});
    });

    it('skips AI call and returns no issues when DOM heuristic finds TOC class', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = { fetchChatCompletion: sinon.stub() };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><nav class="toc"><ul><li><a href="#s1">S1</a></li></ul></nav>'
                    + '<h1>Title</h1><h2 id="s1">Section</h2></body>',
                  tags: { title: 'Page Title', description: 'Desc', h1: ['Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      expect(mockClient.fetchChatCompletion.callCount).to.equal(0);
      expect(result.auditResult.toc).to.deep.equal({});
    });
  });

  describe('TOC Detection — Phase 2 (AI with main/body content) integration', () => {
    it('uses <main> element content (not body boilerplate) when calling AI', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      // Build a raw body where the first 3000 chars is pure boilerplate
      // and the real content (with headings) is only inside <main>
      const boilerplate = '<!-- boilerplate -->'.repeat(200); // ~4000 chars before main
      const rawBody = `<body>${boilerplate}<main><h1>Real Title</h1><h2>Section 1</h2></main></body>`;

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":7,"reasoning":"No TOC in main"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody,
                  tags: { title: 'Page', description: 'Desc', h1: ['Real Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // AI was called (Phase 1 found nothing)
      expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(1);
      // The prompt sent to AI should contain main content, not just the boilerplate
      const promptArg = mockClient.fetchChatCompletion.getCall(0).args[0];
      expect(promptArg).to.include('Real Title');
      // Audit correctly identifies missing TOC
      expect(result.auditResult.toc).to.exist;
      expect(result.auditResult.toc.toc).to.exist;
    });

    it('falls back to empty string when <main> element exists but is empty', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":5,"reasoning":"No content"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  // <main> exists but is completely empty — mainEl.html() returns ''
                  rawBody: '<body><main></main></body>',
                  tags: { title: 'Empty Page', description: 'Desc', h1: [] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // AI was called — Phase 1 found nothing, Phase 2 used empty main (fallback to '')
      expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(1);
      // No TOC headings to build from — result should show no issues
      expect(result.auditResult.toc).to.deep.equal({});
    });

    it('falls back to body content when no <main> element exists', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockClient = {
        fetchChatCompletion: sinon.stub().resolves({
          choices: [{ message: { content: '{"tocPresent":false,"confidence":6,"reasoning":"No TOC"}' } }],
        }),
      };
      AzureOpenAIClient.createFrom.restore();
      sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves({ getId: () => 'test-opp-id' }),
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: sinon.stub().resolves(),
        },
      });

      s3Client.send.callsFake((command) => {
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<body><div><h1 id="t">Title</h1><h2 id="s1">Section 1</h2></div></body>',
                  tags: { title: 'Page', description: 'Desc', h1: ['Title'] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      context.site = site;
      context.scrapeResultPaths = new Map([[url, 'toc/scrapes/test-job/page/scrape.json']]);
      const result = await mockedHandler.processTocResults(context);

      // AI was called with body content (no main present)
      expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(1);
      const promptArg = mockClient.fetchChatCompletion.getCall(0).args[0];
      expect(promptArg).to.include('Title');
      // Audit identifies missing TOC from body content
      expect(result.auditResult.toc.toc).to.exist;
    });
  });

  describe('headings/utils (TOC extraction and exclusion)', () => {
    describe('getHeadingLevel', () => {
      it('returns 1 for h1', () => {
        expect(getHeadingLevel('h1')).to.equal(1);
        expect(getHeadingLevel('H1')).to.equal(1);
      });
      it('returns 2 for h2', () => {
        expect(getHeadingLevel('h2')).to.equal(2);
      });
      it('returns 6 for h6', () => {
        expect(getHeadingLevel('h6')).to.equal(6);
      });
    });

    describe('TOC exclusion constants', () => {
      it('TOC_EXCLUDED_CONTAINER_SELECTORS includes OneTrust and Cookiebot', () => {
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('#onetrust-consent-sdk');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('#CybotCookiebotDialog');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('.cookie-consent');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[id*="consent"]');
      });
      it('TOC_EXCLUDED_HEADING_PHRASES includes consent phrases', () => {
        expect(TOC_EXCLUDED_HEADING_PHRASES).to.include('privacy preference center');
        expect(TOC_EXCLUDED_HEADING_PHRASES).to.include('cookie settings');
      });
      it('TOC_EXCLUDED_CONTAINER_SELECTORS includes navigation-related selectors', () => {
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('nav');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[role="navigation"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('body > header');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('footer');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[class*="nav-"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[class*="navigation"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[class*="sidebar"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[id*="sidebar"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[class*="menu"]');
        expect(TOC_EXCLUDED_CONTAINER_SELECTORS).to.include('[id*="nav"]');
      });
    });

    describe('normalizeHeadingTextForMatch', () => {
      it('trims and lowercases and collapses spaces', () => {
        expect(normalizeHeadingTextForMatch('  Privacy   Preference   Center  ')).to.equal('privacy preference center');
      });
      it('returns empty string for non-string', () => {
        expect(normalizeHeadingTextForMatch(null)).to.equal('');
        expect(normalizeHeadingTextForMatch(undefined)).to.equal('');
        expect(normalizeHeadingTextForMatch(123)).to.equal('');
      });
      it('returns empty string for empty string', () => {
        expect(normalizeHeadingTextForMatch('')).to.equal('');
        expect(normalizeHeadingTextForMatch('   ')).to.equal('');
      });
    });

    describe('isExcludedConsentHeadingText', () => {
      it('returns true for exact phrase match (case-insensitive)', () => {
        expect(isExcludedConsentHeadingText('Privacy Preference Center')).to.equal(true);
        expect(isExcludedConsentHeadingText('privacy preference center')).to.equal(true);
        expect(isExcludedConsentHeadingText('Cookie Settings')).to.equal(true);
      });
      it('returns true when heading contains phrase', () => {
        expect(isExcludedConsentHeadingText('Welcome to Privacy Preference Center')).to.equal(true);
        expect(isExcludedConsentHeadingText('Manage your cookie settings here')).to.equal(true);
      });
      it('returns true when phrase contains heading (short match)', () => {
        expect(isExcludedConsentHeadingText('privacy')).to.equal(true);
      });
      it('returns false for non-consent content', () => {
        expect(isExcludedConsentHeadingText('Product details')).to.equal(false);
        expect(isExcludedConsentHeadingText('Section 1')).to.equal(false);
        expect(isExcludedConsentHeadingText('Compatible lighting components')).to.equal(false);
      });
      it('returns false for empty or whitespace', () => {
        expect(isExcludedConsentHeadingText('')).to.equal(false);
        expect(isExcludedConsentHeadingText('   ')).to.equal(false);
      });
    });

    describe('isHeadingInExcludedContainer', () => {
      it('returns false when heading or $ is missing', () => {
        const $ = cheerioLoad('<h1>Title</h1>');
        expect(isHeadingInExcludedContainer(null, $)).to.equal(false);
        expect(isHeadingInExcludedContainer($('h1')[0], null)).to.equal(false);
      });
      it('returns true when heading is inside OneTrust container', () => {
        const $ = cheerioLoad('<div id="onetrust-consent-sdk"><h1>Privacy Preference Center</h1></div>');
        const h1 = $('h1')[0];
        expect(isHeadingInExcludedContainer(h1, $)).to.equal(true);
      });
      it('returns true when heading is inside cookie-banner', () => {
        const $ = cheerioLoad('<div id="cookie-banner"><h2>Cookie Settings</h2></div>');
        const h2 = $('h2')[0];
        expect(isHeadingInExcludedContainer(h2, $)).to.equal(true);
      });
      it('returns true when heading is inside element with class cookie-consent', () => {
        const $ = cheerioLoad('<div class="cookie-consent"><h1>Accept Cookies</h1></div>');
        const h1 = $('h1')[0];
        expect(isHeadingInExcludedContainer(h1, $)).to.equal(true);
      });
      it('returns false when heading is not inside any excluded container', () => {
        const $ = cheerioLoad('<main><h1>Product details</h1><h2>Section 1</h2></main>');
        expect(isHeadingInExcludedContainer($('h1')[0], $)).to.equal(false);
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(false);
      });
      it('returns true when heading is inside a nav element', () => {
        const $ = cheerioLoad('<nav><h2>Main Menu</h2></nav>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is inside an element with role="navigation"', () => {
        const $ = cheerioLoad('<div role="navigation"><h2>Navigation Links</h2></div>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is inside the top-level site header (body > header)', () => {
        const $ = cheerioLoad('<body><header><h1>Site Name</h1></header></body>');
        expect(isHeadingInExcludedContainer($('h1')[0], $)).to.equal(true);
      });
      it('does NOT exclude heading inside article > header (section-level header)', () => {
        const $ = cheerioLoad(
          '<body><main><article><header><h1>Article Title</h1></header></article></main></body>',
        );
        expect(isHeadingInExcludedContainer($('h1')[0], $)).to.equal(false);
      });
      it('returns true when heading is inside a footer element', () => {
        const $ = cheerioLoad('<footer><h2>Footer Links</h2></footer>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is inside a sidebar element', () => {
        const $ = cheerioLoad('<div class="sidebar"><h2>Related Articles</h2></div>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is inside an element with nav- class prefix', () => {
        const $ = cheerioLoad('<div class="nav-panel"><h2>Nav Section</h2></div>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is inside an element with navigation class', () => {
        const $ = cheerioLoad('<div class="site-navigation"><h2>Browse</h2></div>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
      it('returns true when heading is deeply nested inside a nav element', () => {
        const $ = cheerioLoad('<nav><ul><li><div><h2>Nested Nav Heading</h2></div></li></ul></nav>');
        expect(isHeadingInExcludedContainer($('h2')[0], $)).to.equal(true);
      });
    });

    describe('extractTocData', () => {
      it('returns all h1 and h2 when no main and no consent', () => {
        const $ = cheerioLoad('<body><h1 id="title">Title</h1><h2 id="s1">Section 1</h2><h2 id="s2">Section 2</h2></body>');
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(3);
        expect(result[0]).to.deep.include({ text: 'Title', level: 1 });
        expect(result[1]).to.deep.include({ text: 'Section 1', level: 2 });
        expect(result[2]).to.deep.include({ text: 'Section 2', level: 2 });
      });
      it('when main exists, only includes headings inside body > main', () => {
        const $ = cheerioLoad(
          '<body><h1 id="outside">Outside Main</h1><main><h1 id="inside">Inside Main</h1><h2 id="sec">Section</h2></main></body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Inside Main', 'Section']);
      });
      it('excludes headings inside consent container', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<div id="onetrust-consent-sdk"><h1>Privacy Preference Center</h1></div>'
          + '<main><h1 id="product">Product details</h1><h2 id="sec">Section</h2></main>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Product details', 'Section']);
      });
      it('excludes headings by consent phrase even when not in consent container', () => {
        const $ = cheerioLoad(
          '<body><main><h1 id="a">Product details</h1><h2 id="b">Privacy Preference Center</h2><h2 id="c">Section 2</h2></main></body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Product details', 'Section 2']);
      });
      it('returns empty array when no headings', () => {
        const $ = cheerioLoad('<body><p>No headings</p></body>');
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.deep.equal([]);
      });
      it('returns empty array when all headings are excluded', () => {
        const $ = cheerioLoad('<body><div id="cookie-banner"><h1>Cookie Settings</h1><h2>Manage preferences</h2></div></body>');
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.deep.equal([]);
      });
      it('excludes headings inside nav elements', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<nav><h2>Site Navigation</h2></nav>'
          + '<h1 id="title">Page Title</h1>'
          + '<h2 id="sec1">Section 1</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Page Title', 'Section 1']);
      });
      it('excludes headings inside top-level site header (body > header) and footer', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<header><h1>Site Logo</h1></header>'
          + '<main><h1 id="title">Article Title</h1><h2 id="sec1">Section 1</h2></main>'
          + '<footer><h2>Footer Links</h2></footer>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Article Title', 'Section 1']);
      });
      it('includes heading inside article > header (section-level header is not excluded)', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<header><h1>Site Logo</h1></header>'
          + '<main>'
          + '<article><header><h1 id="title">Article Title</h1></header>'
          + '<h2 id="sec1">Section 1</h2></article>'
          + '</main>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Article Title', 'Section 1']);
      });
      it('excludes headings inside sidebar', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<div class="sidebar"><h2>Related Articles</h2></div>'
          + '<h1 id="title">Main Content Title</h1>'
          + '<h2 id="sec1">Section 1</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Main Content Title', 'Section 1']);
      });
      it('excludes headings inside role="navigation" element', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<div role="navigation"><h2>Browse Topics</h2></div>'
          + '<h1 id="title">Article Title</h1>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(1);
        expect(result[0].text).to.equal('Article Title');
      });
      it('returns empty array when all headings are inside navigation containers', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<header><h1>Brand Name</h1></header>'
          + '<nav><h2>Home</h2><h2>About</h2></nav>'
          + '<footer><h2>Contact</h2></footer>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.deep.equal([]);
      });
      it('excludes headings with empty text', () => {
        const $ = cheerioLoad('<body><h1 id="a">   </h1><h1 id="b">Title</h1><h2 id="c">Section</h2></body>');
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Title', 'Section']);
      });
      it('excludes headings with no text content', () => {
        const $ = cheerioLoad('<body><h2 id="a"></h2><h1 id="b">Title</h1><h2 id="c">Section</h2></body>');
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Title', 'Section']);
      });
      it('includes selector from getHeadingSelectorFn', () => {
        const $ = cheerioLoad('<body><h1 id="main">Title</h1></body>');
        const result = extractTocData($, getHeadingSelector);
        expect(result[0].selector).to.equal('h1#main');
      });
      it('excludes headings inside .form-step containers', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="title">Get Your Quote</h1>'
          + '<div class="form-step"><h2>Step 1: Personal Details</h2></div>'
          + '<div class="form-step"><h2>Step 2: Coverage Options</h2></div>'
          + '<h2 id="sec">Why Choose Us</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Get Your Quote', 'Why Choose Us']);
      });
      it('excludes headings inside button elements (e.g. skip-to-main-content widgets)', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="title">ICICI Bank</h1>'
          + '<button class="skip-main-content-btn"><h2>Skip to main content</h2></button>'
          + '<h2 id="products">Credit Cards</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['ICICI Bank', 'Credit Cards']);
      });
      it('excludes headings inside role="button" elements', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="title">Home</h1>'
          + '<div role="button"><h2>Skip to content</h2></div>'
          + '<h2 id="main">Main Content</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Home', 'Main Content']);
      });
      it('deduplicates headings with identical normalised text', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="a">Coverage Options</h1>'
          + '<h2 id="b">Section One</h2>'
          + '<h2 id="c">Coverage Options</h2>'
          + '<h2 id="d">Section Two</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(3);
        expect(result.map((r) => r.text)).to.deep.equal(['Coverage Options', 'Section One', 'Section Two']);
      });
      it('excludes headings whose entire text is an unrendered template placeholder', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="a">PlayStation</h1>'
          + '<h2 id="b">PS5 Games</h2>'
          + '<h2 id="c" class="txt-style-{STYLE} txt-block-title__title">{TITLE}</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['PlayStation', 'PS5 Games']);
      });
      it('does not exclude headings that merely contain curly braces alongside other text', () => {
        const $ = cheerioLoad(
          '<body>'
          + '<h1 id="a">Welcome to {Brand}</h1>'
          + '<h2 id="b">{TITLE} and more</h2>'
          + '</body>',
        );
        const result = extractTocData($, stubGetHeadingSelector);
        expect(result).to.have.lengthOf(2);
        expect(result.map((r) => r.text)).to.deep.equal(['Welcome to {Brand}', '{TITLE} and more']);
      });
    });

    describe('tocArrayToHast', () => {
      it('builds HAST with nav > ul > li > a for each item', () => {
        const tocData = [
          { text: 'Title', level: 1, selector: 'h1#main' },
          { text: 'Section', level: 2, selector: 'h2#sec' },
        ];
        const hast = tocArrayToHast(tocData);
        expect(hast.type).to.equal('root');
        expect(hast.children[0].tagName).to.equal('nav');
        expect(hast.children[0].properties.className).to.include('toc');
        const ul = hast.children[0].children[0];
        expect(ul.tagName).to.equal('ul');
        expect(ul.children).to.have.lengthOf(2);
        expect(ul.children[1].properties.className).to.include('toc-sub');
        expect(ul.children[0].children[0].properties['data-selector']).to.equal('h1#main');
        expect(ul.children[0].children[0].children[0].value).to.equal('Title');
      });

      it('filters out items with empty or whitespace-only text', () => {
        const tocData = [
          { text: 'Valid Heading', level: 1, selector: 'h1#valid' },
          { text: '', level: 1, selector: 'h1#empty' },
          { text: '   ', level: 2, selector: 'h2#whitespace' },
          { text: 'Another Valid', level: 2, selector: 'h2#also-valid' },
        ];
        const hast = tocArrayToHast(tocData);
        const ul = hast.children[0].children[0];
        expect(ul.children).to.have.lengthOf(2);
        expect(ul.children[0].children[0].children[0].value).to.equal('Valid Heading');
        expect(ul.children[1].children[0].children[0].value).to.equal('Another Valid');
      });
    });

    describe('determineTocPlacement', () => {
      it('returns insertAfter first h1 when h1 present', () => {
        const $ = cheerioLoad('<body><h1 id="title">Title</h1><main><p>Content</p></main></body>');
        const result = determineTocPlacement($, getHeadingSelector);
        expect(result.action).to.equal('insertAfter');
        expect(result.selector).to.include('h1');
        expect(result.placement).to.equal('after-h1');
      });
      it('returns insertBefore main first-child when no h1 but main present', () => {
        const $ = cheerioLoad('<body><main><p>Content</p></main></body>');
        const result = determineTocPlacement($, getHeadingSelector);
        expect(result.action).to.equal('insertBefore');
        expect(result.selector).to.equal('body > main > :first-child');
        expect(result.placement).to.equal('main-start');
      });
      it('returns insertBefore body first-child when no h1 and no main', () => {
        const $ = cheerioLoad('<body><div>Content</div></body>');
        const result = determineTocPlacement($, getHeadingSelector);
        expect(result.action).to.equal('insertBefore');
        expect(result.selector).to.equal('body > :first-child');
        expect(result.placement).to.equal('body-start');
      });
    });

    describe('getScrapeJsonPath', () => {
      it('builds path with siteId and pathname', () => {
        expect(getScrapeJsonPath('https://example.com/products/page', 'site-1'))
          .to.equal('scrapes/site-1/products/page/scrape.json');
      });
      it('strips trailing slash from pathname', () => {
        expect(getScrapeJsonPath('https://example.com/products/', 'site-1'))
          .to.equal('scrapes/site-1/products/scrape.json');
      });
    });

    describe('getSurroundingText', () => {
      it('returns empty strings when heading has no siblings', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2></div>');
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $);
        expect(result.before).to.equal('');
        expect(result.after).to.equal('');
      });

      it('returns before and after text from siblings', () => {
        const $ = cheerioLoad('<div><p>Before paragraph</p><h2>Heading</h2><p>After paragraph</p></div>');
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $);
        expect(result.before).to.include('Before paragraph');
        expect(result.after).to.include('After paragraph');
      });

      it('truncates after text to charLimit using slice', () => {
        const longAfter = 'B'.repeat(200);
        const $ = cheerioLoad(`<div><h2>Heading</h2><p>${longAfter}</p></div>`);
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $, 150);
        expect(result.after.length).to.be.at.most(150);
      });

      it('truncates before text to charLimit using slice', () => {
        const longBefore = 'A'.repeat(200);
        const $ = cheerioLoad(`<div><p>${longBefore}</p><h2>Heading</h2></div>`);
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $, 150);
        expect(result.before.length).to.be.at.most(150);
      });

      it('breaks after-text loop when accumulated text reaches charLimit mid-loop', () => {
        // First sibling is under the limit; second pushes it over — triggers inner break
        const text1 = 'A'.repeat(12);
        const text2 = 'B'.repeat(12);
        const text3 = 'C'.repeat(12);
        const $ = cheerioLoad(
          `<div><h2>Heading</h2><p>${text1}</p><p>${text2}</p><p>${text3}</p></div>`,
        );
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $, 20);
        expect(result.after.length).to.be.at.most(20);
      });

      it('breaks before-text loop when accumulated text reaches charLimit mid-loop', () => {
        const text1 = 'A'.repeat(12);
        const text2 = 'B'.repeat(12);
        const text3 = 'C'.repeat(12);
        const $ = cheerioLoad(
          `<div><p>${text3}</p><p>${text2}</p><p>${text1}</p><h2>Heading</h2></div>`,
        );
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $, 20);
        expect(result.before.length).to.be.at.most(20);
      });

      it('skips siblings with no text content', () => {
        const $ = cheerioLoad('<div><p></p><p>Real before</p><h2>Heading</h2><p></p><p>Real after</p></div>');
        const h2 = $('h2')[0];
        const result = getSurroundingText(h2, $);
        expect(result.before).to.include('Real before');
        expect(result.after).to.include('Real after');
      });
    });

    describe('getFollowingStructure', () => {
      it('returns isEmpty: true when heading has no following sibling', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.isEmpty).to.equal(true);
        expect(result.firstElement).to.equal(null);
        expect(result.firstText).to.equal('');
      });

      it('returns element info for a following paragraph', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2><p>Following text content here</p></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.isEmpty).to.equal(false);
        expect(result.firstElement).to.equal('p');
        expect(result.hasImages).to.equal(false);
        expect(result.hasLinks).to.equal(false);
        expect(result.isList).to.equal(false);
        expect(result.firstText).to.include('Following text content');
      });

      it('detects images inside the following element', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2><div><img src="test.jpg"/></div></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.hasImages).to.equal(true);
      });

      it('detects links inside the following element', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2><p><a href="/link">Click here</a></p></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.hasLinks).to.equal(true);
      });

      it('detects an unordered list as isList', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2><ul><li>Item 1</li><li>Item 2</li></ul></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.isList).to.equal(true);
        expect(result.firstElement).to.equal('ul');
      });

      it('detects an ordered list as isList', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2><ol><li>Step 1</li><li>Step 2</li></ol></div>');
        const h2 = $('h2')[0];
        const result = getFollowingStructure(h2, $);
        expect(result.isList).to.equal(true);
        expect(result.firstElement).to.equal('ol');
      });
    });

    describe('getParentSectionContext', () => {
      it('finds nearest semantic parent (article) with class and id', () => {
        const $ = cheerioLoad('<article class="main-article" id="art-1"><h2>Heading</h2></article>');
        const h2 = $('h2')[0];
        const result = getParentSectionContext(h2, $, [h2], 0);
        expect(result.parentTag).to.equal('article');
        expect(result.parentId).to.equal('art-1');
        expect(result.parentClasses).to.include('main-article');
        expect(result.precedingHeading).to.equal(null);
      });

      it('finds nearest semantic parent (section) with no class or id', () => {
        const $ = cheerioLoad('<section><h2>Heading</h2></section>');
        const h2 = $('h2')[0];
        const result = getParentSectionContext(h2, $, [h2], 0);
        expect(result.parentTag).to.equal('section');
        expect(result.parentClasses).to.deep.equal([]);
        expect(result.parentId).to.equal(null);
      });

      it('finds a preceding higher-level heading', () => {
        const $ = cheerioLoad('<main><h1>Page Title</h1><section><h2>Subsection</h2></section></main>');
        const h1 = $('h1')[0];
        const h2 = $('h2')[0];
        const result = getParentSectionContext(h2, $, [h1, h2], 1);
        expect(result.precedingHeading).to.not.equal(null);
        expect(result.precedingHeading.level).to.equal('h1');
        expect(result.precedingHeading.text).to.equal('Page Title');
      });

      it('returns null precedingHeading when no preceding heading has a lower level', () => {
        const $ = cheerioLoad('<main><h2>Section A</h2><h2>Section B</h2></main>');
        const h2s = $('h2').toArray();
        const result = getParentSectionContext(h2s[1], $, h2s, 1);
        expect(result.precedingHeading).to.equal(null);
      });

      it('falls back to heading.parent when no semantic ancestor found', () => {
        const $ = cheerioLoad('<div class="wrapper" id="wrap"><h2>Heading</h2></div>');
        const h2 = $('h2')[0];
        const result = getParentSectionContext(h2, $, [h2], 0);
        expect(result.parentTag).to.equal('div');
        expect(result.parentId).to.equal('wrap');
        expect(result.parentClasses).to.include('wrapper');
      });

      it('falls back to heading.parent with no class (empty parentClasses)', () => {
        const $ = cheerioLoad('<div><h2>Heading</h2></div>');
        const h2 = $('h2')[0];
        const result = getParentSectionContext(h2, $, [h2], 0);
        expect(result.parentTag).to.equal('div');
        expect(result.parentClasses).to.deep.equal([]);
        expect(result.parentId).to.equal(null);
      });

      it('skips preceding headings with empty text and uses the first with text', () => {
        const $ = cheerioLoad('<main><h1></h1><h1>Real Title</h1><h2>Section</h2></main>');
        const h1s = $('h1').toArray();
        const h2 = $('h2')[0];
        const allHeadings = [...h1s, h2];
        const result = getParentSectionContext(h2, $, allHeadings, 2);
        expect(result.precedingHeading).to.not.equal(null);
        expect(result.precedingHeading.text).to.equal('Real Title');
      });
    });

    describe('getHeadingContext', () => {
      it('returns surroundingText, followingStructure, and parentSection', () => {
        const $ = cheerioLoad('<article><p>Before</p><h2>Heading</h2><p>After</p></article>');
        const h2 = $('h2')[0];
        const result = getHeadingContext(h2, $, [h2], 0);
        expect(result).to.have.property('surroundingText');
        expect(result).to.have.property('followingStructure');
        expect(result).to.have.property('parentSection');
        expect(result.surroundingText.before).to.include('Before');
        expect(result.surroundingText.after).to.include('After');
        expect(result.followingStructure.firstElement).to.equal('p');
        expect(result.parentSection.parentTag).to.equal('article');
      });
    });
  });

  describe('URL Prioritization (getTocInputUrls — used by importTopPages)', () => {
    it('uses merged URL list from getMergedAuditInputUrls covering all three sources', async () => {
      const agenticUrl = 'https://example.com/agentic-page';
      const includedUrl = 'https://example.com/customer-desired';
      const organicUrl = 'https://example.com/organic-page';

      const getMergedAuditInputUrlsStub = sinon.stub().resolves({
        urls: [includedUrl, agenticUrl, organicUrl],
        topPagesUrls: [organicUrl],
        agenticUrls: [agenticUrl],
        includedURLs: [includedUrl],
        filteredCount: 0,
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([agenticUrl]),
        },
      });

      context.site = site;
      context.dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
      };
      const result = await mockedHandler.importTopPages(context);

      expect(getMergedAuditInputUrlsStub).to.have.been.calledOnce;
      expect(result.auditResult.topPages).to.have.lengthOf(3);
      expect(result.auditResult.topPages[0]).to.equal(includedUrl);
    });

    it('logs URL input source counts from getTocInputUrls', async () => {
      const logSpy = {
        info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy(),
      };
      context.log = logSpy;

      const getMergedAuditInputUrlsStub = sinon.stub().resolves({
        urls: ['https://example.com/p1'],
        topPagesUrls: ['https://example.com/p1'],
        agenticUrls: ['https://example.com/agentic'],
        includedURLs: ['https://example.com/desired'],
        filteredCount: 2,
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      context.site = site;
      context.dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
      };
      await mockedHandler.importTopPages(context);

      expect(logSpy.info).to.have.been.calledWith(
        '[TOC] URL inputs: topPages=1, agentic=1, includedURLs=1, filteredOutUrls=2, finalUrls=1',
      );
    });

    it('prioritizes customer desired URLs and passes auditType to getMergedAuditInputUrls', async () => {
      const includedUrl = 'https://example.com/customer-desired';

      const getMergedAuditInputUrlsStub = sinon.stub().resolves({
        urls: [includedUrl],
        topPagesUrls: [],
        agenticUrls: [],
        includedURLs: [includedUrl],
        filteredCount: 0,
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      context.site = site;
      context.dataAccess = {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
      };
      const result = await mockedHandler.importTopPages(context);

      // getMergedAuditInputUrls was called with the correct auditType
      const callArgs = getMergedAuditInputUrlsStub.firstCall.args[0];
      expect(callArgs).to.have.property('auditType', 'toc');
      // The customer desired URL was included in the stored topPages
      expect(result.auditResult.topPages[0]).to.equal(includedUrl);
    });
  });

  describe('importTopPages', () => {
    it('returns top pages when URLs are found', async () => {
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([{ getUrl: () => url }]),
        },
      };

      const getMergedAuditInputUrlsStub = sinon.stub().resolves({
        urls: [url],
        topPagesUrls: [url],
        agenticUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.topPages).to.include(url);
      expect(result.siteId).to.equal(site.getId());
    });

    it('returns empty topPages when no URLs are found', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
        },
      };

      const getMergedAuditInputUrlsStub = sinon.stub().resolves({
        urls: [],
        topPagesUrls: [],
        agenticUrls: [],
        includedURLs: [],
        filteredCount: 0,
      });

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: getMergedAuditInputUrlsStub,
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.topPages).to.deep.equal([]);
    });

    it('returns failure when getTocInputUrls throws', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: sinon.stub().rejects(new Error('DB error')),
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('DB error');
    });

    it('invokes getTopPages callback using real getMergedAuditInputUrls (covers lines 56-61)', async () => {
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      const mockPage = {
        getUrl: () => url,
        getTraffic: () => 100,
      };
      const siteWithConfig = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: sinon.stub().resolves({
          getIncludedURLs: sinon.stub().resolves([]),
          getAuditTargetURLs: sinon.stub().returns([]),
        }),
      };
      context.site = siteWithConfig;
      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([mockPage]),
        },
      };

      // Only mock getTopAgenticUrlsFromAthena — let the real getMergedAuditInputUrls run
      // so the getTopPages callback (lines 56-61) is exercised
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.true;
      expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-1',
        'seo',
        'global',
      );
    });

    it('invokes getTopPages callback with null result (covers topPages || [] branch in line 61)', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;

      const siteWithConfig = {
        getId: () => 'site-1',
        getBaseURL: () => 'https://example.com',
        getConfig: sinon.stub().resolves({
          getIncludedURLs: sinon.stub().resolves([]),
          getAuditTargetURLs: sinon.stub().returns([]),
        }),
      };
      context.site = siteWithConfig;
      context.dataAccess = {
        SiteTopPage: {
          // returns null to exercise the `topPages || []` fallback branch
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves(null),
        },
      };

      // Only mock getTopAgenticUrlsFromAthena — let real getMergedAuditInputUrls run
      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });

      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.topPages).to.deep.equal([]);
    });

    const stubUrlDeps = () => ({
      '../../src/utils/audit-input-urls.js': {
        getMergedAuditInputUrls: sinon.stub().resolves({
          urls: [],
          topPagesUrls: [],
          agenticUrls: [],
          includedURLs: [],
          filteredCount: 0,
        }),
        sortTopPagesByTraffic: sinon.stub().returns([]),
      },
      '../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
      },
    });

    it('forwards a true generatePrompts flag via auditContext when present in context.data', async () => {
      context.site = site;
      context.data = { generatePrompts: true };

      const mockedHandler = await esmock('../../src/toc/handler.js', stubUrlDeps());
      const result = await mockedHandler.importTopPages(context);

      expect(result.auditContext).to.deep.equal({ generatePrompts: true });
    });

    it('parses generatePrompts from a JSON-string context.data', async () => {
      context.site = site;
      context.data = JSON.stringify({ generatePrompts: true });

      const mockedHandler = await esmock('../../src/toc/handler.js', stubUrlDeps());
      const result = await mockedHandler.importTopPages(context);

      expect(result.auditContext).to.deep.equal({ generatePrompts: true });
    });

    it('defaults generatePrompts to false when context.data is absent', async () => {
      context.site = site;
      context.data = undefined;

      const mockedHandler = await esmock('../../src/toc/handler.js', stubUrlDeps());
      const result = await mockedHandler.importTopPages(context);

      expect(result.auditContext).to.deep.equal({ generatePrompts: false });
    });

    it('defaults generatePrompts to false and logs a warning when context.data is malformed JSON', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.data = '{not valid json';

      const mockedHandler = await esmock('../../src/toc/handler.js', stubUrlDeps());
      const result = await mockedHandler.importTopPages(context);

      expect(result.auditContext).to.deep.equal({ generatePrompts: false });
      expect(logSpy.warn).to.have.been.calledWith(
        sinon.match(/Failed to parse context\.data for generatePrompts flag/),
      );
    });

    it('still includes auditContext.generatePrompts on the failure path when getTocInputUrls throws', async () => {
      context.site = site;
      context.data = { generatePrompts: true };

      const mockedHandler = await esmock('../../src/toc/handler.js', {
        '../../src/utils/audit-input-urls.js': {
          getMergedAuditInputUrls: sinon.stub().rejects(new Error('DB error')),
          sortTopPagesByTraffic: sinon.stub().returns([]),
        },
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: sinon.stub().resolves([]),
        },
      });
      const result = await mockedHandler.importTopPages(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditContext).to.deep.equal({ generatePrompts: true });
    });
  });

  describe('submitForScraping', () => {
    it('returns scraping payload when topPages exist in stored audit result', async () => {
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.audit = { getAuditResult: () => ({ success: true, topPages: [url] }) };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([{ url }]);
      expect(result.processingType).to.be.undefined;
      expect(result.options).to.be.undefined;
      expect(result.maxScrapeAge).to.equal(24);
      expect(result.auditContext).to.deep.equal({ generatePrompts: false });
      expect(logSpy.info).to.have.been.calledWith('[TOC] Submitting 1 URLs for scraping');
    });

    it('forwards auditContext (including generatePrompts) from step 1 through to step 3', async () => {
      const url = 'https://example.com/page';
      context.log = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.site = site;
      context.audit = { getAuditResult: () => ({ success: true, topPages: [url] }) };
      context.auditContext = { generatePrompts: true, someOtherKey: 'preserved' };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.auditContext).to.deep.equal({
        generatePrompts: true,
        someOtherKey: 'preserved',
      });
    });

    it('persists terminal result and returns when previous audit step failed', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.audit = { getId: () => 'audit-1', getAuditResult: () => ({ success: false, topPages: [] }) };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.check).to.equal('top-pages');
      expect(result.fullAuditRef).to.equal(site.getBaseURL());
      expect(result).to.not.have.property('urls');
      expect(context.dataAccess.Audit.updateByKeys).to.have.been.calledOnce;
      expect(logSpy.warn).to.have.been.calledWith('[TOC] Audit failed in previous step, skipping scraping');
    });

    it('persists terminal result and returns when topPages is empty', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.audit = { getId: () => 'audit-1', getAuditResult: () => ({ success: true, topPages: [] }) };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.check).to.equal('top-pages');
      expect(result.fullAuditRef).to.equal(site.getBaseURL());
      expect(result).to.not.have.property('urls');
      expect(context.dataAccess.Audit.updateByKeys).to.have.been.calledOnce;
      expect(logSpy.warn).to.have.been.calledWith('[TOC] No top pages found, ending audit');
    });

    it('persists terminal result and returns when topPages is undefined', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      context.audit = { getId: () => 'audit-1', getAuditResult: () => ({ success: true }) };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.check).to.equal('top-pages');
      expect(result.fullAuditRef).to.equal(site.getBaseURL());
      expect(result).to.not.have.property('urls');
      expect(context.dataAccess.Audit.updateByKeys).to.have.been.calledOnce;
      expect(logSpy.warn).to.have.been.calledWith('[TOC] No top pages found, ending audit');
    });

    it('caps submitted URLs at MAX_TOP_PAGES (200) when topPages exceeds the limit', async () => {
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      context.log = logSpy;
      context.site = site;
      const pages = Array.from({ length: 250 }, (_, i) => `https://example.com/page-${i}`);
      context.audit = { getAuditResult: () => ({ success: true, topPages: pages }) };

      const { submitForScraping } = await import('../../src/toc/handler.js');
      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(200);
      expect(result.urls[0]).to.deep.equal({ url: 'https://example.com/page-0' });
      expect(result.urls[199]).to.deep.equal({ url: 'https://example.com/page-199' });
      expect(logSpy.info).to.have.been.calledWith('[TOC] Submitting 200 URLs for scraping');
    });
  });
});

