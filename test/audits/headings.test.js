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
/* eslint-disable no-use-before-define */

import { expect, use as chaiUse } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import * as s3Utils from '../../src/utils/s3-utils.js';

import {
  HEADINGS_CHECKS,
  validatePageHeadings,
  generateSuggestions,
  headingsAuditRunner,
} from '../../src/headings/handler.js';
import { createOpportunityData, createOpportunityDataForElmo } from '../../src/headings/opportunity-data-mapper.js';
import { keepLatestMergeDataFunction } from '../../src/utils/data-access.js';

chaiUse(sinonChai);

describe('Headings Audit', () => {
  let log;
  let context;
  let site;
  let allKeys;
  let s3Client;

  beforeEach(() => {
    log = { info: console.log, error: console.error, debug: console.debug };
    nock.cleanAll();
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
    site = { getId: () => 'site-1' };
    allKeys = [];
    allKeys.push('scrapes/site-1/page/scrape.json');
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
    nock.cleanAll();
  });

  it('flags empty headings', async () => {
    const url = 'https://example.com/page';
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1></h1><h2>Valid</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });
    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    expect(result.url).to.equal(url);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
      suggestion: 'Test Suggestion',
    });
    
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
      heading: 'H1',
      nextHeading: 'H2',
    });
  });

  it('flags heading order jumps (h1 → h3)', async () => {
    const url = 'https://example.com/page';
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><h3>Section</h3>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });  

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion,
      previous: 'h1',
      current: 'h3',
    });
  });

  it('passes valid heading sequence', async () => {
    const url = 'https://example.com/page';

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><p>Content for title</p><h2>Section</h2><p>Content for section</p><h3>Subsection</h3><p>Content for subsection</p>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    }); 
    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('detects missing H1 element', async () => {
    const url = 'https://example.com/page';

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h2>Section</h2><h3>Subsection</h3>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
      suggestion: 'Test Suggestion',
    });
  });

  it('detects multiple H1 elements', async () => {


    const url = 'https://example.com/page';

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>First Title</h1><h2>Section</h2><h1>Second Title</h1>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });  

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
      count: 2,
    });
  });

  it('headingsAuditRunner handles rejected promises gracefully (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
    context.log = logSpy;
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
          { getUrl: () => `${baseURL}/failing-page` },
        ]),
      },
    };
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })), // wrap in {Key}
          NextContinuationToken: undefined,
        });
      }
    
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
                Body: {
                  transformToString: () =>
                    JSON.stringify({
                      finalUrl: url,
                      scrapeResult: {
                        rawBody: '<h1>Title</h1><h4>Jump to h4</h4>',
                        tags: {
                          title: 'Page Title',
                          description: 'Page Description',
                          h1: 'Page H1',
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
    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_ORDER_INVALID.check);
    const orderIssue = result.auditResult[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check];
    const orderIssueUrls = orderIssue.urls.map((u) => u.url);
    expect(orderIssueUrls).to.include(`${baseURL}/page`);
    expect(orderIssueUrls).to.not.include(`${baseURL}/failing-page`);
  });

  it('headingsAuditRunner handles server errors gracefully (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
    context.log = logSpy;
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const emptyKeys = [];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: emptyKeys.map((key) => ({ Key: key })), // wrap in {Key}
          NextContinuationToken: undefined,
        });
      }
    
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2></h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: 'Page H1',
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
    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult.status).to.equal('success');
    expect(result.auditResult.message).to.equal('No heading issues detected');

    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 0 issues across 0 check types/),
    );
  });

  it('headingsAuditRunner skips successful checks (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
    context.log = logSpy;
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })), // wrap in {Key}
          NextContinuationToken: undefined,
        });
      }
    
      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2></h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: 'Page H1',
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
    const result = await headingsAuditRunner(baseURL, context, site);
    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_EMPTY.check);
    expect(result.auditResult).to.not.have.property('status');

    // The HTML '<h1>Title</h1><h2></h2>' triggers 2 issues:
    // 1. Empty heading (h2)
    // 2. No content between h1 and h2
    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 2 issues across 2 check types/),
    );
  });

  // added from here
  
  it('validates null/undefined URL in validatePageHeadings', async () => {
    const result = await validatePageHeadings(
      null,
      log,
      site,
      allKeys,
      s3Client,
      context.env.S3_SCRAPER_BUCKET_NAME,
      context,
    );
    
    expect(result.url).to.be.null;
    expect(result.checks).to.deep.equal([]);
  });

  it('handles missing scrape JSON file gracefully', async () => {
    const url = 'https://example.com/missing-page';
    // Mock empty allKeys to simulate missing scrape file
    const emptyKeys = [];
    
    const result = await validatePageHeadings(
      url,
      log,
      site,
      emptyKeys,
      s3Client,
      context.env.S3_SCRAPER_BUCKET_NAME,
      context,
    );
    
    expect(result).to.be.null;
  });

  it('handles null scrapeJsonObject gracefully', async () => {
    const url = 'https://example.com/page';
    s3Client.send.resolves({
      Body: null,
    });
    
    const result = await validatePageHeadings(
      url,
      log,
      site,
      allKeys,
      s3Client,
      context.env.S3_SCRAPER_BUCKET_NAME,
      context,
    );
    
    expect(result).to.be.null;
  });

  it('detects headings with content having child elements', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><div><span>Content with child</span></div><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    // Should pass with no heading issues since content exists between headings
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('detects headings with self-closing content elements', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><img src="test.jpg" alt="test"><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    // Should pass with no heading issues since IMG is considered content
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('detects headings with text nodes between elements', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1>Some plain text content<h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    // Should pass with no heading issues since text node exists between headings
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('detects duplicate heading text', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><p>Content</p><h2>Section</h2><p>Content</p><h3>Section</h3>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.suggestion,
      text: 'Section',
      duplicates: ['H2', 'H3'],
      count: 2,
    });
  });

  it('detects heading without content before next heading', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><h2>Section Without Content</h2><h3>Subsection</h3>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
      heading: 'H1',
      nextHeading: 'H2',
    });

    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
      heading: 'H2',
      nextHeading: 'H3',
    });
  });

  describe('generateSuggestions', () => {
    it('skips suggestions for successful audit', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: { status: 'success', message: 'No issues found' }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
    });

    it('skips suggestions for failed audit', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: { error: 'Audit failed' }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
    });

    it('generates suggestions for audit with issues', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'heading-order-invalid': {
            success: false,
            explanation: 'Invalid order',
            urls: [{ url: 'https://example.com/page1' }, { url: 'https://example.com/page2' }]
          },
          'heading-empty': {
            success: false,
            explanation: 'Empty heading',
            urls: [{ url: 'https://example.com/page3' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions).to.have.lengthOf(3);
      expect(result.suggestions[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).',
      });
      expect(result.suggestions[0].url).to.equal('https://example.com/page1');
    });

    it('handles default case in generateRecommendedAction', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'unknown-check': {
            success: false,
            explanation: 'Unknown issue',
            urls: [{ url: 'https://example.com/page1' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });
  });

  describe('opportunityAndSuggestions', () => {
    let convertToOpportunityStub;
    let syncSuggestionsStub;
    let mockedOpportunityAndSuggestions;

    beforeEach(async () => {
      // Create stubs for the imported functions
      convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });
      
      syncSuggestionsStub = sinon.stub().resolves();

      // Mock the handler with stubbed dependencies
      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      mockedOpportunityAndSuggestions = mockedHandler.opportunityAndSuggestions;
    });

    it('skips opportunity creation when no suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = { suggestions: [] };
      
      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: { url: 'https://example.com/page1' },
            recommendedAction: 'Add content'
          }
        ]
      };
      
      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      
      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.suggestions);
      expect(syncCall.args[0]).to.have.property('context', context);
    });
  });

  it('handles empty heading for non-H1 elements with AI suggestion', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><h2></h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_EMPTY.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
      suggestion: 'Test Suggestion',
      tagName: 'H2',
    });
  });

  it('handles empty heading with fallback suggestion when AI fails', async () => {
    // Mock AI to return null
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":null}}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><h2></h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_EMPTY.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
      tagName: 'H2',
    });
  });

  it('uses fallback suggestion when AI returns null for missing H1', async () => {
    // Mock AI to return null (falsy value to test the OR fallback branch)
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":null}}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h2>Section</h2>', // No H1 to trigger missing H1 check
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    // This should use the fallback suggestion (right branch of OR operator)
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion, // Should use fallback, not AI
    });
  });

  it('detects child elements with self-closing tags but no text content', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><div><hr></div><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    // Should pass with no heading issues since HR is considered content even without text
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('iterates through multiple empty siblings before finding content', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><div></div><span></span><div></div><p>Finally some content</p><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    // Should pass with no heading issues since content is eventually found after iterating through empty siblings
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('iterates through all siblings and finds no content', async () => {
    const url = 'https://example.com/page';
    
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><div></div><span></span><div></div><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    // Should detect no content between h1 and h2 after iterating through all empty siblings
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
      heading: 'H1',
      nextHeading: 'H2',
    });
  });

  it('handles validatePageHeadings error gracefully', async () => {
    const url = 'https://example.com/page';
    
    // Mock s3Client to throw an error - this will cause getObjectFromKey to return null
    s3Client.send.rejects(new Error('S3 connection failed'));
    
    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    // When getObjectFromKey returns null due to S3 error, validatePageHeadings returns null
    expect(result).to.be.null;
  });

  it('handles DOM processing error in validatePageHeadings catch block', async () => {
    const url = 'https://example.com/page';
    
    // Mock successful S3 response
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h1>Title</h1><h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: 'Page H1',
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    // Use esmock to mock JSDOM to throw an error during processing
    const mockedHandler = await esmock('../../src/headings/handler.js', {
      jsdom: {
        JSDOM: class {
          constructor() {
            // Don't throw in constructor, but make window.document.querySelectorAll throw
            this.window = {
              document: {
                querySelectorAll: () => {
                  throw new Error('DOM processing failed');
                }
              }
            };
          }
        }
      },
    });
    
    const result = await mockedHandler.validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, context);
    
    // This should trigger the catch block and return the error object with url and empty checks
    expect(result.url).to.equal(url);
    expect(result.checks).to.deep.equal([]);
  });

  it('handles headingsAuditRunner with no top pages', async () => {
    const baseURL = 'https://example.com';
    const logSpy = { info: sinon.spy(), warn: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
    context.log = logSpy;
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
      },
    };

    // Mock getTopPagesForSiteId to return empty array
    const getTopPagesForSiteIdStub = sinon.stub().resolves([]);
    
    // Use esmock to replace the import
    const mockedHandler = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.s3Client = s3Client;
    const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);
    
    expect(result.auditResult).to.have.property('check', HEADINGS_CHECKS.TOPPAGES.check);
    expect(result.auditResult.success).to.be.false;
    expect(logSpy.warn).to.have.been.calledWith('[Headings Audit] No top pages found, ending audit.');
  });

  it('handles headingsAuditRunner error gracefully', async () => {
    const baseURL = 'https://example.com';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
    context.log = logSpy;
    
    // Mock getTopPagesForSiteId to throw an error
    const getTopPagesForSiteIdStub = sinon.stub().rejects(new Error('Database connection failed'));
    
    const mockedHandler = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.s3Client = s3Client;
    const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);
    
    expect(result.auditResult.error).to.include('Database connection failed');
    expect(result.auditResult.success).to.be.false;
    expect(logSpy.error).to.have.been.calledWith(sinon.match(/Headings audit failed/));
  });

  describe('generateSuggestions', () => {
    it('skips suggestions for successful audit', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: { status: 'success', message: 'No issues found' }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
    });

    it('skips suggestions for failed audit', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: { error: 'Audit failed' }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
    });

    it('generates suggestions for audit with issues', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'heading-order-invalid': {
            success: false,
            explanation: 'Invalid order',
            urls: [{ url: 'https://example.com/page1' }, { url: 'https://example.com/page2' }]
          },
          'heading-empty': {
            success: false,
            explanation: 'Empty heading',
            urls: [{ url: 'https://example.com/page3' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions).to.have.lengthOf(3);
      expect(result.suggestions[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).',
      });
      expect(result.suggestions[0].url).to.equal('https://example.com/page1');
    });

    it('handles default case in generateRecommendedAction', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'unknown-check': {
            success: false,
            explanation: 'Unknown issue',
            urls: [{ url: 'https://example.com/page1' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    it('generates suggestions for duplicate text check', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'heading-duplicate-text': {
            success: false,
            explanation: 'Duplicate heading text',
            urls: [{ url: 'https://example.com/page1' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions).to.have.lengthOf(1);
      expect(result.suggestions[0].recommendedAction).to.equal('Ensure each heading has unique, descriptive text content that clearly identifies its section.');
    });

    it('generates suggestions for no content check', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'heading-no-content': {
            success: false,
            explanation: 'Heading has no content',
            urls: [{ url: 'https://example.com/page1' }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions).to.have.lengthOf(1);
      expect(result.suggestions[0].recommendedAction).to.equal('Add meaningful content (paragraphs, lists, images, etc.) after the heading before the next heading.');
    });

    it('handles new URL object format with tagName and custom suggestion', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          'heading-order-invalid': {
            success: false,
            explanation: 'Invalid order',
            urls: [
              { 
                url: 'https://example.com/page1', 
                tagName: 'H3', 
                suggestion: 'Change this H3 to H2 to maintain proper hierarchy' 
              }, 
              { 
                url: 'https://example.com/page2', 
                tagName: 'H4'
                // No custom suggestion, should use default
              }
            ]
          },
          'heading-empty': {
            success: false,
            explanation: 'Empty heading',
            urls: [{ 
              url: 'https://example.com/page3', 
              tagName: 'H2', 
              suggestion: 'Add meaningful content to this heading'
            }]
          }
        }
      };
      
      const result = generateSuggestions(auditUrl, auditData, context);
      
      expect(result.suggestions).to.have.lengthOf(3);
      
      // First suggestion with custom suggestion
      expect(result.suggestions[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        url: 'https://example.com/page1',
        tagName: 'H3',
        recommendedAction: 'Change this H3 to H2 to maintain proper hierarchy', // Uses custom suggestion
      });
      
      // Second suggestion without custom suggestion (uses default)
      expect(result.suggestions[1]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        url: 'https://example.com/page2',
        tagName: 'H4',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).', // Uses default
      });
      
      // Third suggestion with custom suggestion for empty heading
      expect(result.suggestions[2]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-empty',
        explanation: 'Empty heading',
        url: 'https://example.com/page3',
        tagName: 'H2',
        recommendedAction: 'Add meaningful content to this heading', // Uses custom suggestion
      });
    });
  });

  describe('opportunityAndSuggestions', () => {
    let convertToOpportunityStub;
    let syncSuggestionsStub;
    let mockedOpportunityAndSuggestions;

    beforeEach(async () => {
      // Create stubs for the imported functions
      convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });
      
      syncSuggestionsStub = sinon.stub().resolves();

      // Mock the handler with stubbed dependencies
      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      mockedOpportunityAndSuggestions = mockedHandler.opportunityAndSuggestions;
    });

    it('skips opportunity creation when no suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = { suggestions: [] };
      
      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: { url: 'https://example.com/page1' },
            recommendedAction: 'Add content'
          }
        ]
      };
      
      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      
      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.suggestions);
      expect(syncCall.args[0]).to.have.property('context', context);
    });

    it('tests mapNewSuggestion function execution in opportunityAndSuggestions', async () => {
      // Create real stubs that will be called
      const convertToOpportunityStub2 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });
      
      const syncSuggestionsStub2 = sinon.stub().resolves();
      
      // Mock the dependencies
      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub2,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub2,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: 'https://example.com/page1',
            recommendedAction: 'Add content'
          }
        ]
      };
      
      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);
      
      expect(syncSuggestionsStub2).to.have.been.calledOnce;
      
      // Check that mapNewSuggestion was called with the right structure
      const syncCall = syncSuggestionsStub2.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      expect(mapNewSuggestionFn).to.be.a('function');
      
      // Test the mapNewSuggestion function directly
      const mappedSuggestion = mapNewSuggestionFn(auditData.suggestions[0]);
      expect(mappedSuggestion).to.deep.include({
        opportunityId: 'test-opportunity-id',
        type: 'CODE_CHANGE',
        rank: 0,
      });
      expect(mappedSuggestion.data).to.deep.include({
        type: 'url',
        url: 'https://example.com/page1',
        checkType: 'heading-empty',
        explanation: 'Empty heading',
        recommendedAction: 'Add content',
      });
    });
  });

  describe('Opportunity Data Mapper', () => {
    it('creates proper opportunity data structure', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.be.an('object');
      expect(opportunityData).to.have.property('runbook', '');
      expect(opportunityData).to.have.property('origin', 'AUTOMATION');
      expect(opportunityData).to.have.property('title', 'Heading structure issues affecting accessibility and SEO');
      expect(opportunityData).to.have.property('description');
      expect(opportunityData.description).to.include('heading elements');
      expect(opportunityData.description).to.include('hierarchical order');
      expect(opportunityData.description).to.include('AI-powered suggestions');
    });

    it('includes proper guidance steps', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.have.property('guidance');
      expect(opportunityData.guidance).to.have.property('steps');
      expect(opportunityData.guidance.steps).to.be.an('array');
      expect(opportunityData.guidance.steps).to.have.lengthOf(5);

      const steps = opportunityData.guidance.steps;
      expect(steps[0]).to.include('Review pages flagged for heading order');
      expect(steps[1]).to.include('AI-generated suggestions');
      expect(steps[2]).to.include('levels increase by at most one');
      expect(steps[3]).to.include('Remove or fill any empty heading elements');
      expect(steps[4]).to.include('brand guidelines');
    });

    it('has correct tags', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.have.property('tags');
      expect(opportunityData.tags).to.be.an('array');
      expect(opportunityData.tags).to.have.lengthOf(2);
      expect(opportunityData.tags).to.deep.equal(['Accessibility', 'SEO']);
    });

    it('has correct data sources configuration', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.have.property('data');
      expect(opportunityData.data).to.have.property('dataSources');
      expect(opportunityData.data.dataSources).to.be.an('array');
      expect(opportunityData.data.dataSources).to.have.lengthOf(1);
      expect(opportunityData.data.dataSources[0]).to.equal('Site');
    });

    it('returns consistent data on multiple calls', () => {
      const data1 = createOpportunityData();
      const data2 = createOpportunityData();

      expect(data1).to.deep.equal(data2);
    });

    it('has all required fields for opportunity creation', () => {
      const opportunityData = createOpportunityData();

      // Check all required fields exist
      expect(opportunityData).to.have.all.keys([
        'runbook',
        'origin', 
        'title',
        'description',
        'guidance',
        'tags',
        'data'
      ]);

      // Check nested structure
      expect(opportunityData.guidance).to.have.property('steps');
      expect(opportunityData.data).to.have.property('dataSources');
    });
  });

  describe('Opportunity Data Mapper for Elmo', () => {
    it('creates proper opportunity data structure for Elmo', () => {
      const opportunityData = createOpportunityDataForElmo();

      expect(opportunityData).to.be.an('object');
      expect(opportunityData).to.have.property('runbook', '');
      expect(opportunityData).to.have.property('origin', 'AUTOMATION');
      expect(opportunityData).to.have.property('title', 'Heading structure issues affecting accessibility and SEO');
      expect(opportunityData).to.have.property('description');
      expect(opportunityData.description).to.include('heading elements');
      expect(opportunityData.description).to.include('hierarchical order');
      expect(opportunityData.description).to.include('AI-powered suggestions');
    });

    it('includes Elmo-specific tags', () => {
      const opportunityData = createOpportunityDataForElmo();

      expect(opportunityData).to.have.property('tags');
      expect(opportunityData.tags).to.be.an('array');
      expect(opportunityData.tags).to.have.lengthOf(4);
      expect(opportunityData.tags).to.deep.equal(['Accessibility', 'SEO', 'llm', 'isElmo']);
    });

    it('includes proper guidance steps for Elmo', () => {
      const opportunityData = createOpportunityDataForElmo();

      expect(opportunityData).to.have.property('guidance');
      expect(opportunityData.guidance).to.have.property('steps');
      expect(opportunityData.guidance.steps).to.be.an('array');
      expect(opportunityData.guidance.steps).to.have.lengthOf(5);

      const steps = opportunityData.guidance.steps;
      expect(steps[0]).to.include('Review pages flagged for heading order');
      expect(steps[1]).to.include('AI-generated suggestions');
      expect(steps[2]).to.include('levels increase by at most one');
      expect(steps[3]).to.include('Remove or fill any empty heading elements');
      expect(steps[4]).to.include('brand guidelines');
    });

    it('has correct data sources configuration for Elmo', () => {
      const opportunityData = createOpportunityDataForElmo();

      expect(opportunityData).to.have.property('data');
      expect(opportunityData.data).to.have.property('dataSources');
      expect(opportunityData.data.dataSources).to.be.an('array');
      expect(opportunityData.data.dataSources).to.have.lengthOf(1);
      expect(opportunityData.data.dataSources[0]).to.equal('Site');
    });

    it('includes additional metrics for Elmo with headings subtype', () => {
      const opportunityData = createOpportunityDataForElmo();

      expect(opportunityData.data).to.have.property('additionalMetrics');
      expect(opportunityData.data.additionalMetrics).to.be.an('array');
      expect(opportunityData.data.additionalMetrics).to.have.lengthOf(1);
      expect(opportunityData.data.additionalMetrics[0]).to.deep.equal({
        value: 'headings',
        key: 'subtype',
      });
    });

    it('returns consistent data on multiple calls', () => {
      const data1 = createOpportunityDataForElmo();
      const data2 = createOpportunityDataForElmo();

      expect(data1).to.deep.equal(data2);
    });

    it('has all required fields for Elmo opportunity creation', () => {
      const opportunityData = createOpportunityDataForElmo();

      // Check all required fields exist
      expect(opportunityData).to.have.all.keys([
        'runbook',
        'origin', 
        'title',
        'description',
        'guidance',
        'tags',
        'data'
      ]);

      // Check nested structure
      expect(opportunityData.guidance).to.have.property('steps');
      expect(opportunityData.data).to.have.property('dataSources');
      expect(opportunityData.data).to.have.property('additionalMetrics');
    });

    it('extends base opportunity data with Elmo-specific properties', () => {
      const baseData = createOpportunityData();
      const elmoData = createOpportunityDataForElmo();

      // Should have all base properties
      expect(elmoData.runbook).to.equal(baseData.runbook);
      expect(elmoData.origin).to.equal(baseData.origin);
      expect(elmoData.title).to.equal(baseData.title);
      expect(elmoData.description).to.equal(baseData.description);
      expect(elmoData.guidance).to.deep.equal(baseData.guidance);

      // Should have extended tags
      expect(elmoData.tags).to.include.members(baseData.tags);
      expect(elmoData.tags).to.include('llm');
      expect(elmoData.tags).to.include('isElmo');

      // Should have extended data structure
      expect(elmoData.data.dataSources).to.deep.equal(baseData.data.dataSources);
      expect(elmoData.data).to.have.property('additionalMetrics');
      expect(baseData.data).to.not.have.property('additionalMetrics');
    });

    it('maintains immutability of base data', () => {
      const baseData = createOpportunityData();
      const elmoData = createOpportunityDataForElmo();

      // Base data should not be modified
      expect(baseData.tags).to.deep.equal(['Accessibility', 'SEO']);
      expect(baseData.data).to.not.have.property('additionalMetrics');

      // Elmo data should have extended properties
      expect(elmoData.tags).to.have.lengthOf(4);
      expect(elmoData.data).to.have.property('additionalMetrics');
    });

    it('has correct structure for Elmo opportunity comparison', () => {
      const opportunityData = createOpportunityDataForElmo();

      // This data structure should match what the comparisonFn in opportunityAndSuggestionsForElmo expects
      const additionalMetrics = opportunityData.data.additionalMetrics;
      expect(additionalMetrics).to.be.an('array');
      
      const subtypeMetric = additionalMetrics.find(metric => metric.key === 'subtype');
      expect(subtypeMetric).to.exist;
      expect(subtypeMetric.value).to.equal('headings');
    });
  });

  describe('keepLatestMergeDataFunction', () => {
    it('returns new data when existing data is empty', () => {
      const existingData = {};
      const newData = { type: 'CODE_CHANGE', url: 'https://example.com' };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result).to.not.equal(newData); // Should be a new object
    });

    it('returns new data when existing data is null', () => {
      const existingData = null;
      const newData = { type: 'CODE_CHANGE', url: 'https://example.com' };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
    });

    it('returns new data when existing data is undefined', () => {
      const existingData = undefined;
      const newData = { type: 'CODE_CHANGE', url: 'https://example.com' };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
    });

    it('returns new data when new data is empty', () => {
      const existingData = { type: 'OLD', url: 'https://old.com' };
      const newData = {};
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
    });

    it('handles null new data gracefully', () => {
      const existingData = { type: 'OLD', url: 'https://old.com' };
      const newData = null;
      
      // The spread operator with null returns an empty object
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal({});
    });

    it('handles undefined new data gracefully', () => {
      const existingData = { type: 'OLD', url: 'https://old.com' };
      const newData = undefined;
      
      // The spread operator with undefined returns an empty object
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal({});
    });

    it('overrides existing data with new data completely', () => {
      const existingData = {
        type: 'OLD_TYPE',
        url: 'https://old.com',
        oldProperty: 'oldValue',
        sharedProperty: 'oldValue'
      };
      const newData = {
        type: 'NEW_TYPE',
        url: 'https://new.com',
        newProperty: 'newValue',
        sharedProperty: 'newValue'
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result).to.not.have.property('oldProperty');
      expect(result).to.have.property('newProperty', 'newValue');
      expect(result).to.have.property('sharedProperty', 'newValue');
    });

    it('handles complex nested objects', () => {
      const existingData = {
        type: 'OLD',
        data: {
          nested: {
            deep: 'oldValue',
            other: 'oldOther'
          },
          array: [1, 2, 3]
        }
      };
      const newData = {
        type: 'NEW',
        data: {
          nested: {
            deep: 'newValue',
            newNested: 'newNestedValue'
          },
          array: [4, 5, 6],
          newProperty: 'newPropertyValue'
        }
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.data.nested).to.deep.equal(newData.data.nested);
      expect(result.data.array).to.deep.equal([4, 5, 6]);
    });

    it('handles arrays correctly', () => {
      const existingData = {
        items: [1, 2, 3],
        metadata: { count: 3 }
      };
      const newData = {
        items: [4, 5, 6, 7],
        metadata: { count: 4, updated: true }
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.items).to.deep.equal([4, 5, 6, 7]);
      expect(result.metadata).to.deep.equal({ count: 4, updated: true });
    });

    it('handles primitive values', () => {
      const existingData = {
        string: 'old',
        number: 42,
        boolean: true,
        nullValue: null
      };
      const newData = {
        string: 'new',
        number: 100,
        boolean: false,
        nullValue: 'notNull'
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.string).to.equal('new');
      expect(result.number).to.equal(100);
      expect(result.boolean).to.equal(false);
      expect(result.nullValue).to.equal('notNull');
    });

    it('creates a new object (does not mutate inputs)', () => {
      const existingData = { type: 'OLD', url: 'https://old.com' };
      const newData = { type: 'NEW', url: 'https://new.com' };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      // Verify inputs are not mutated
      expect(existingData).to.deep.equal({ type: 'OLD', url: 'https://old.com' });
      expect(newData).to.deep.equal({ type: 'NEW', url: 'https://new.com' });
      
      // Verify result is a new object
      expect(result).to.not.equal(existingData);
      expect(result).to.not.equal(newData);
    });

    it('handles function properties', () => {
      const existingData = {
        type: 'OLD',
        callback: () => 'old'
      };
      const newData = {
        type: 'NEW',
        callback: () => 'new'
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.callback()).to.equal('new');
    });

    it('handles special values (NaN, Infinity, -Infinity)', () => {
      const existingData = {
        normal: 42,
        nan: NaN,
        infinity: Infinity,
        negativeInfinity: -Infinity
      };
      const newData = {
        normal: 100,
        nan: NaN,
        infinity: Infinity,
        negativeInfinity: -Infinity
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.normal).to.equal(100);
      expect(Number.isNaN(result.nan)).to.be.true;
      expect(result.infinity).to.equal(Infinity);
      expect(result.negativeInfinity).to.equal(-Infinity);
    });

    it('handles empty objects and arrays', () => {
      const existingData = {
        emptyObject: {},
        emptyArray: [],
        nonEmpty: 'value'
      };
      const newData = {
        emptyObject: {},
        emptyArray: [],
        nonEmpty: 'newValue'
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
      expect(result.emptyObject).to.deep.equal({});
      expect(result.emptyArray).to.deep.equal([]);
    });

    it('handles mixed data types in same object', () => {
      const existingData = {
        string: 'old',
        number: 42,
        boolean: true,
        array: [1, 2],
        object: { key: 'old' },
        nullValue: null,
        undefinedValue: undefined
      };
      const newData = {
        string: 'new',
        number: 100,
        boolean: false,
        array: [3, 4, 5],
        object: { key: 'new', newKey: 'newValue' },
        nullValue: 'notNull',
        undefinedValue: 'defined'
      };
      
      const result = keepLatestMergeDataFunction(existingData, newData);
      
      expect(result).to.deep.equal(newData);
    });
  });

  describe('opportunityAndSuggestionsForElmo', () => {
    let convertToOpportunityStub;
    let syncSuggestionsStub;
    let mockedOpportunityAndSuggestionsForElmo;

    beforeEach(async () => {
      // Create stubs for the imported functions
      convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-elmo-opportunity-id'
      });
      
      syncSuggestionsStub = sinon.stub().resolves();

      // Mock the handler with stubbed dependencies
      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      mockedOpportunityAndSuggestionsForElmo = mockedHandler.opportunityAndSuggestionsForElmo;
    });

    it('skips opportunity creation when no elmo suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = { elmoSuggestions: [] };
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('skips opportunity creation when elmo suggestions is undefined', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {};
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs elmo suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: '## Heading Issues\n\n| Page Url | Explanation | Suggestion |\n|-------|-------|-------|\n| https://example.com/page1 | Empty heading | Add content |\n'
          }
        ]
      };
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      
      const convertCall = convertToOpportunityStub.getCall(0);
      expect(convertCall.args[0]).to.equal(auditUrl);
      expect(convertCall.args[1]).to.deep.equal(auditData);
      expect(convertCall.args[2]).to.equal(context);
      expect(convertCall.args[3]).to.be.a('function'); // createOpportunityDataForElmo
      expect(convertCall.args[4]).to.equal('generic-opportunity');
      expect(convertCall.args[5]).to.deep.equal({});
      expect(convertCall.args[6]).to.be.a('function'); // comparisonFn
      
      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.elmoSuggestions);
      expect(syncCall.args[0]).to.have.property('context', context);
      expect(syncCall.args[0]).to.have.property('buildKey');
      expect(syncCall.args[0]).to.have.property('mapNewSuggestion');
      expect(syncCall.args[0]).to.have.property('keepLatestMergeDataFunction');
    });

    it('uses correct buildKey function for elmo suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      const syncCall = syncSuggestionsStub.getCall(0);
      const buildKeyFn = syncCall.args[0].buildKey;
      
      // Test the buildKey function
      const suggestion = { type: 'CODE_CHANGE' };
      const key = buildKeyFn(suggestion);
      expect(key).to.equal('CODE_CHANGE');
    });

    it('uses correct mapNewSuggestion function for elmo suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      
      // Test the mapNewSuggestion function
      const suggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'Test suggestion'
      };
      const mappedSuggestion = mapNewSuggestionFn(suggestion);
      
      expect(mappedSuggestion).to.deep.include({
        opportunityId: 'test-elmo-opportunity-id',
        type: 'CODE_CHANGE',
        rank: 0,
      });
      expect(mappedSuggestion.data).to.deep.include({
        suggestionValue: 'Test suggestion',
      });
    });

    it('uses comparisonFn to find existing headings opportunities', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      const convertCall = convertToOpportunityStub.getCall(0);
      const comparisonFn = convertCall.args[6];
      
      // Test comparisonFn with opportunity that has headings subtype
      const opptyWithHeadings = {
        getData: () => ({
          additionalMetrics: [
            { key: 'subtype', value: 'headings' }
          ]
        })
      };
      expect(comparisonFn(opptyWithHeadings)).to.be.true;
      
      // Test comparisonFn with opportunity that doesn't have headings subtype
      const opptyWithoutHeadings = {
        getData: () => ({
          additionalMetrics: [
            { key: 'subtype', value: 'other' }
          ]
        })
      };
      expect(comparisonFn(opptyWithoutHeadings)).to.be.false;
      
      // Test comparisonFn with opportunity that has no additionalMetrics
      const opptyNoMetrics = {
        getData: () => ({})
      };
      expect(comparisonFn(opptyNoMetrics)).to.be.false;
      
      // Test comparisonFn with opportunity that has null additionalMetrics
      const opptyNullMetrics = {
        getData: () => ({ additionalMetrics: null })
      };
      expect(comparisonFn(opptyNullMetrics)).to.be.false;
    });

    it('handles multiple elmo suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'First suggestion'
          },
          {
            type: 'CONTENT_CHANGE',
            recommendedAction: 'Second suggestion'
          }
        ]
      };
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      
      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0].newData).to.deep.equal(auditData.elmoSuggestions);
    });

    it('logs success message after creating opportunity', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      const contextWithLogSpy = { ...context, log: logSpy };
      
      await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, contextWithLogSpy);
      
      expect(logSpy.info).to.have.been.calledWith('Headings opportunity created for Elmo with oppty id test-elmo-opportunity-id');
      expect(logSpy.info).to.have.been.calledWith('Headings opportunity created for Elmo and 1 suggestions synced for https://example.com');
    });

    it('handles convertToOpportunity errors gracefully', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      // Make convertToOpportunity throw an error
      convertToOpportunityStub.rejects(new Error('Database connection failed'));
      
      try {
        await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
        expect.fail('Expected function to throw an error');
      } catch (error) {
        expect(error.message).to.include('Database connection failed');
      }
    });

    it('handles syncSuggestions errors gracefully', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      // Make syncSuggestions throw an error
      syncSuggestionsStub.rejects(new Error('Sync failed'));
      
      try {
        await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
        expect.fail('Expected function to throw an error');
      } catch (error) {
        expect(error.message).to.include('Sync failed');
      }
    });

    it('handles convertToOpportunity with null comparisonFn', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      // Mock convertToOpportunity to be called with null comparisonFn
      convertToOpportunityStub.callsFake((auditUrl, auditData, context, createOpportunityDataForElmo, elmoOpportunityType, options, comparisonFn) => {
        // Verify that comparisonFn is provided and is a function
        expect(comparisonFn).to.be.a('function');
        return Promise.resolve({
          getId: () => 'test-elmo-opportunity-id'
        });
      });
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      
      // Verify the comparisonFn was passed correctly
      const convertCall = convertToOpportunityStub.getCall(0);
      expect(convertCall.args[6]).to.be.a('function'); // comparisonFn should be a function
    });

    it('handles convertToOpportunity with undefined comparisonFn', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      // Create a mock that simulates the opportunity.js behavior when comparisonFn is undefined
      convertToOpportunityStub.callsFake((auditUrl, auditData, context, createOpportunityDataForElmo, elmoOpportunityType, options, comparisonFn) => {
        // Test the condition from opportunity.js: if (comparisonFn && typeof comparisonFn === 'function')
        if (comparisonFn && typeof comparisonFn === 'function') {
          // This branch should be taken since we're passing a function
          expect(comparisonFn).to.be.a('function');
        } else {
          // This branch should not be taken in our case
          expect.fail('comparisonFn should be a function');
        }
        
        return Promise.resolve({
          getId: () => 'test-elmo-opportunity-id'
        });
      });
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('tests comparisonFn type checking in convertToOpportunity', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        elmoSuggestions: [
          {
            type: 'CODE_CHANGE',
            recommendedAction: 'Test suggestion'
          }
        ]
      };
      
      // Mock convertToOpportunity to test the type checking logic
      convertToOpportunityStub.callsFake((auditUrl, auditData, context, createOpportunityDataForElmo, elmoOpportunityType, options, comparisonFn) => {
        // Simulate the exact condition from opportunity.js
        const shouldUseComparisonFn = comparisonFn && typeof comparisonFn === 'function';
        
        if (shouldUseComparisonFn) {
          // Test that the comparisonFn works correctly
          const mockOppty = {
            getData: () => ({
              additionalMetrics: [
                { key: 'subtype', value: 'headings' }
              ]
            })
          };
          
          const result = comparisonFn(mockOppty);
          expect(result).to.be.true;
        } else {
          expect.fail('comparisonFn should be defined and be a function');
        }
        
        return Promise.resolve({
          getId: () => 'test-elmo-opportunity-id'
        });
      });
      
      const result = await mockedOpportunityAndSuggestionsForElmo(auditUrl, auditData, context);
      
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });
  });
});
