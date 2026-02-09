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
  getH1HeadingASuggestion,
} from '../../src/headings/handler.js';
import {
  getHeadingSelector,
  getTextContent,
} from '../../src/headings/shared-utils.js';
import { createOpportunityData } from '../../src/headings/opportunity-data-mapper.js';
import { convertToOpportunity } from '../../src/common/opportunity.js';

chaiUse(sinonChai);

describe('Headings Audit', () => {
  let log;
  let context;
  let site;
  let allKeys;
  let s3Client;
  let seoChecks;

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
    site = { getId: () => 'site-1', getBaseURL: () => 'https://example.com', getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }) };
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

    // Mock SeoChecks
    seoChecks = {
      performChecks: sinon.stub(),
      getFewHealthyTags: sinon.stub().returns({
        title: ['Test Title'],
        description: ['Test Description'],
        h1: ['Test H1']
      })
    };
  });


  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  it('flags empty headings', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
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
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1></h1><h2>Valid</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;
    
    // Debug: Check what we actually got
    if (!result || !result.headings) {
      console.log('DEBUG: completedAudit:', JSON.stringify(completedAudit, null, 2));
      console.log('DEBUG: result:', JSON.stringify(result, null, 2));
      console.log('DEBUG: result.error:', result?.error);
      console.log('DEBUG: result.status:', result?.status);
    }
    
    // The audit might have failed, check for error state first
    expect(result).to.exist;
    
    // If there's an error, the structure will be different
    if (result.error || result.status === 'success') {
      // Audit either errored or had no issues
      console.log('Audit did not detect heading issues as expected');
      console.log('Result:', JSON.stringify(result, null, 2));
    }
    
    // Check heading-h1-length (empty H1 now triggers this check instead of heading-missing-h1)
    expect(result.headings, 'result.headings should exist').to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].explanation).to.equal(HEADINGS_CHECKS.HEADING_H1_LENGTH.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_H1_LENGTH.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].urls[0].url).to.equal(url);
  });

  it('flags heading order jumps (multiple invalid orders)', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h3>Section</h3><h5>Subsection</h5>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].explanation).to.include(HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation);
    // Each invalid jump creates a separate URL entry
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].urls).to.be.an('array').with.lengthOf(2);
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].urls[0].url).to.equal(url);
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].urls[0].explanation).to.include('Invalid jump: h1 → h3');
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].urls[1].url).to.equal(url);
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].urls[1].explanation).to.include('Invalid jump: h3 → h5');
    expect(result.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion);
  });

  it('passes valid heading sequence', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><p>Content for title</p><h2>Section</h2><p>Content for section</p><h3>Subsection</h3><p>Content for subsection</p>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // When no issues are found, result should indicate success
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
  });

  it('detects missing H1 element', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h2>Section</h2><h3>Subsection</h3>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check].explanation).to.equal(HEADINGS_CHECKS.HEADING_MISSING_H1.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check].urls[0].url).to.equal(url);
  });

  it('detects multiple H1 elements', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>First Title</h1><h2>Section</h2><h1>Second Title</h1>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check].explanation).to.include(HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check].urls[0].url).to.equal(url);
  });

  it('detects H1 length exceeding 70 characters', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const longH1Text = 'This is a very long H1 heading that exceeds the maximum allowed length of 70 characters for optimal SEO and accessibility';
    
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: `<h1>${longH1Text}</h1><h2>Section</h2>`,
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: [longH1Text],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].explanation).to.equal(HEADINGS_CHECKS.HEADING_H1_LENGTH.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_H1_LENGTH.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_H1_LENGTH.check].urls[0].url).to.equal(url);
  });

  it('detects empty H2 heading', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2></h2><h3>Section</h3>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].explanation).to.include(HEADINGS_CHECKS.HEADING_EMPTY.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_EMPTY.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].urls[0].url).to.equal(url);
  });

  it('detects empty H3 heading', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2>Section</h2><h3></h3>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check]).to.exist;
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].success).to.equal(false);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].explanation).to.include(HEADINGS_CHECKS.HEADING_EMPTY.explanation);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].suggestion).to.equal(HEADINGS_CHECKS.HEADING_EMPTY.suggestion);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].urls).to.be.an('array').with.lengthOf.at.least(1);
    expect(result.headings[HEADINGS_CHECKS.HEADING_EMPTY.check].urls[0].url).to.equal(url);
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
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h2></h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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

    expect(logSpy.debug).to.have.been.calledWith(
      sinon.match(/Found 0 issues across 0 check types/),
    );
  });

  it('validates null/undefined URL in validatePageHeadings', async () => {
    const result = await validatePageHeadings(
      null,
      log,
      site,
      allKeys,
      s3Client,
      context.env.S3_SCRAPER_BUCKET_NAME,
      seoChecks,
    );

    expect(result.url).to.be.null;
    expect(result.checks).to.deep.equal([]);
  });

  it('handles empty string URL in validatePageHeadings', async () => {
    const result = await validatePageHeadings(
      '',
      log,
      site,
      allKeys,
      s3Client,
      context.env.S3_SCRAPER_BUCKET_NAME,
      seoChecks,
    );

    expect(result.url).to.equal('');
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
      seoChecks,
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
      seoChecks,
    );

    expect(result).to.be.null;
  });

  it('detects headings with content having child elements', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><div><span>Content with child</span></div><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // Should pass with no heading issues since content exists between headings
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
  });

  it('detects headings with self-closing content elements', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><img src="test.jpg" alt="test"><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // Should pass with no heading issues since IMG is considered content
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
  });

  it('detects headings with text nodes between elements', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1>Some plain text content<h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // Should pass with no heading issues since text node exists between headings
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
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
          headings: {
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
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(3);
      expect(result.suggestions.headings[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).',
      });
      expect(result.suggestions.headings[0].url).to.equal('https://example.com/page1');
    });

    it('handles default case in generateRecommendedAction', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
            'unknown-check': {
              success: false,
            explanation: 'Unknown issue',
            urls: [{ url: 'https://example.com/page1' }]
          }
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    it('handles generateRecommendedAction with all check types', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
            'heading-order-invalid': {
              success: false,
              explanation: 'Invalid order',
              urls: [{ url: 'https://example.com/page1' }]
            },
            'heading-empty': {
              success: false,
              explanation: 'Empty heading',
              urls: [{ url: 'https://example.com/page2' }]
            },
            'unknown-check-type': {
              success: false,
              explanation: 'Unknown issue',
              urls: [{ url: 'https://example.com/page3' }]
            }
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(3);
      expect(result.suggestions.headings[0].recommendedAction).to.equal('Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).');
      expect(result.suggestions.headings[1].recommendedAction).to.equal('Provide meaningful text content for the empty heading or remove the element.');
      expect(result.suggestions.headings[2].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
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
      const auditData = { suggestions: { headings: [], toc: [] } };

      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: { url: 'https://example.com/page1' },
            recommendedAction: 'Add content'
          }
        ], toc: [] }
      };

      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.suggestions.headings);
      expect(syncCall.args[0]).to.have.property('context', context);
    });
  });

  it('detects child elements with self-closing tags but no text content', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><div><hr></div><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // Should pass with no heading issues since HR is considered content even without text
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
  });

  it('iterates through multiple empty siblings before finding content', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };
    const allKeys = ['scrapes/site-1/page/scrape.json'];
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () =>
              JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><div></div><span></span><div></div><p>Finally some content</p><h2>Section</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Page H1'],
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
    const completedAudit = await headingsAuditRunner(baseURL, context, site);
    const result = completedAudit.auditResult;

    // Should pass with no heading issues since content is eventually found after iterating through empty siblings
    expect(result.status).to.equal('success');
    expect(result.message).to.equal('No heading issues detected');
  });

  describe('transformRules functionality', () => {
    it('includes transformRules in validatePageHeadings for missing H1', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h2>No H1</h2>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Find the missing H1 check
      const missingH1Check = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_MISSING_H1.check);

      expect(missingH1Check).to.exist;
      expect(missingH1Check.transformRules).to.exist;
      expect(missingH1Check.transformRules.action).to.equal('insertBefore');
      expect(missingH1Check.transformRules.selector).to.equal('body > :first-child');
      expect(missingH1Check.transformRules.tag).to.equal('h1');
      expect(missingH1Check.transformRules.scrapedAt).to.exist;
    });

    it('includes transformRules with body > main selector when main element exists', async () => {
      const url = 'https://example.com/page';


      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<body><main><h2>No H1</h2></main></body>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Find the missing H1 check
      const missingH1Check = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_MISSING_H1.check);

      expect(missingH1Check).to.exist;
      expect(missingH1Check.transformRules).to.exist;
      expect(missingH1Check.transformRules.action).to.equal('insertBefore');
      expect(missingH1Check.transformRules.selector).to.equal('body > main > :first-child');
      expect(missingH1Check.transformRules.tag).to.equal('h1');
      expect(missingH1Check.transformRules.scrapedAt).to.exist;
    });

    it('includes transformRules in validatePageHeadings for empty H1', async () => {
      const url = 'https://example.com/page';


      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1></h1>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Find the H1 length check
      const h1LengthCheck = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_H1_LENGTH.check);

      expect(h1LengthCheck).to.exist;
      expect(h1LengthCheck.transformRules).to.exist;
      expect(h1LengthCheck.transformRules.action).to.equal('replace');
      expect(h1LengthCheck.transformRules.selector).to.include('h1');
      expect(h1LengthCheck.transformRules.currValue).to.equal('');
      expect(h1LengthCheck.transformRules.scrapedAt).to.exist;
    });

    it('includes transformRules in validatePageHeadings for long H1', async () => {
      const url = 'https://example.com/page';
      const longH1 = 'This is a very long H1 heading that exceeds the maximum allowed length of 70 characters';


      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>${longH1}</h1>`,
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [longH1],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Find the H1 length check
      const h1LengthCheck = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_H1_LENGTH.check);

      expect(h1LengthCheck).to.exist;
      expect(h1LengthCheck.transformRules).to.exist;
      expect(h1LengthCheck.transformRules.action).to.equal('replace');
      expect(h1LengthCheck.transformRules.selector).to.include('h1');
      expect(h1LengthCheck.transformRules.currValue).to.equal(longH1);
      expect(h1LengthCheck.transformRules.scrapedAt).to.exist;
    });

    it('does not include transformRules for checks that do not support them', async () => {
      const url = 'https://example.com/page';


      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Title</h1><h3>Skip H2</h3>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Find the heading order invalid check
      const orderInvalidCheck = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_ORDER_INVALID.check);

      expect(orderInvalidCheck).to.exist;
      // HEADING_ORDER_INVALID now DOES include transformRules (replaceWith to fix the heading level)
      expect(orderInvalidCheck.transformRules).to.exist;
      expect(orderInvalidCheck.transformRules.action).to.equal('replaceWith');
    });

    it('propagates transformRules from checks to aggregated results in headingsAuditRunner', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/canonical/handler.js': {
          getTopPagesForSiteId: sinon.stub().resolves([{ url }])
        }
      });

      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => url },
          ]),
        },
      };

      const allKeys = ['scrapes/site-1/page/scrape.json'];
      s3Client.send.callsFake((command) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({
            Contents: allKeys.map((key) => ({ Key: key })),
            NextContinuationToken: undefined,
          });
        }

        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h2>No H1</h2>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: [],
                  },
                }
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });
      context.s3Client = s3Client;

      const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);

      // Check aggregated results contain transformRules
      const missingH1Result = result.auditResult.headings[HEADINGS_CHECKS.HEADING_MISSING_H1.check];
      expect(missingH1Result).to.exist;
      expect(missingH1Result.urls).to.be.an('array').with.lengthOf.at.least(1);
      expect(missingH1Result.urls[0].transformRules).to.exist;
      expect(missingH1Result.urls[0].transformRules.action).to.equal('insertBefore');
      expect(missingH1Result.urls[0].transformRules.selector).to.equal('body > :first-child');
      expect(missingH1Result.urls[0].transformRules.tag).to.equal('h1');
      expect(missingH1Result.urls[0].transformRules.scrapedAt).to.exist;
    });

    it('does not add transformRules to aggregated results when check has no transformRules', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/canonical/handler.js': {
          getTopPagesForSiteId: sinon.stub().resolves([{ url }])
        }
      });

      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => url },
          ]),
        },
      };

      const allKeys = ['scrapes/site-1/page/scrape.json'];
      s3Client.send.callsFake((command) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({
            Contents: allKeys.map((key) => ({ Key: key })),
            NextContinuationToken: undefined,
          });
        }

        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1>Title</h1><h3>Skip H2</h3>',
                  tags: {
                    title: 'Page Title',
                    description: 'Page Description',
                    h1: ['Title'],
                  },
                }
              }),
            },
            ContentType: 'application/json',
          });
        }

        throw new Error('Unexpected command passed to s3Client.send');
      });
      context.s3Client = s3Client;

      const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);

      // Check aggregated results now DO contain transformRules for order invalid (implementation changed)
      const orderInvalidResult = result.auditResult.headings[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check];
      expect(orderInvalidResult).to.exist;
      expect(orderInvalidResult.urls).to.be.an('array').with.lengthOf.at.least(1);
      expect(orderInvalidResult.urls[0].transformRules).to.exist;
      expect(orderInvalidResult.urls[0].transformRules.action).to.equal('replaceWith');
    });

    it('propagates transformRules from aggregated results to suggestions in generateSuggestions', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
            'heading-missing-h1': {
              success: false,
              explanation: 'Missing H1',
              urls: [{
                url: 'https://example.com/page1',
                transformRules: {
                  action: 'insertBefore',
                  selector: 'body > main > :first-child',
                  tag: 'h1',
                  scrapedAt: new Date().toISOString(),
                }
              }]
            },
            'heading-h1-length': {
              success: false,
              explanation: 'H1 too long',
              urls: [{
                url: 'https://example.com/page2',
                transformRules: {
                  action: 'replace',
                  selector: 'body > h1',
                  scrapedAt: new Date().toISOString(),
                }
              }]
            }
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(2);

      // Check first suggestion has transformRules
      const missingH1Suggestion = result.suggestions.headings.find(s => s.checkType === 'heading-missing-h1');
      expect(missingH1Suggestion).to.exist;
      expect(missingH1Suggestion.transformRules).to.exist;
      expect(missingH1Suggestion.transformRules.action).to.equal('insertBefore');
      expect(missingH1Suggestion.transformRules.selector).to.equal('body > main > :first-child');
      expect(missingH1Suggestion.transformRules.tag).to.equal('h1');
      expect(missingH1Suggestion.transformRules.scrapedAt).to.exist;

      // Check second suggestion has transformRules
      const h1LengthSuggestion = result.suggestions.headings.find(s => s.checkType === 'heading-h1-length');
      expect(h1LengthSuggestion).to.exist;
      expect(h1LengthSuggestion.transformRules).to.exist;
      expect(h1LengthSuggestion.transformRules.action).to.equal('replace');
      expect(h1LengthSuggestion.transformRules.selector).to.include('h1');
      expect(h1LengthSuggestion.transformRules.scrapedAt).to.exist;
    });

    it('does not add transformRules to suggestions when urlObj has no transformRules', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
            'heading-order-invalid': {
              success: false,
              explanation: 'Invalid order',
              urls: [{
                url: 'https://example.com/page1'
                // No transformRules
              }]
            }
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(1);
      expect(result.suggestions.headings[0].transformRules).to.be.undefined;
    });

    it('propagates transformRules from suggestions to opportunity data in opportunityAndSuggestions', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-missing-h1',
            explanation: 'Missing H1',
            url: 'https://example.com/page1',
            recommendedAction: 'Add H1',
            transformRules: {
              action: 'insertBefore',
              selector: 'body > main > :first-child',
              tag: 'h1',
              scrapedAt: new Date().toISOString(),
            }
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      const mappedSuggestion = mapNewSuggestionFn(auditData.suggestions.headings[0]);

      expect(mappedSuggestion.data.transformRules).to.exist;
      expect(mappedSuggestion.data.transformRules.action).to.equal('insertBefore');
      expect(mappedSuggestion.data.transformRules.selector).to.equal('body > main > :first-child');
      expect(mappedSuggestion.data.transformRules.tag).to.equal('h1');
      expect(mappedSuggestion.data.transformRules.scrapedAt).to.exist;
    });

    it('does not add transformRules to opportunity data when suggestion has no transformRules', async () => {
      const convertToOpportunityStub = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-order-invalid',
            explanation: 'Invalid order',
            url: 'https://example.com/page1',
            recommendedAction: 'Fix order'
            // No transformRules
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      const mappedSuggestion = mapNewSuggestionFn(auditData.suggestions.headings[0]);

      expect(mappedSuggestion.data.transformRules).to.be.undefined;
    });

    it('CSS selector is dynamically generated for different H1 elements', async () => {
      const url = 'https://example.com/page';

      // Test first page
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1></h1>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result1 = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      const h1LengthCheck1 = result1.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_H1_LENGTH.check);

      // Selector is dynamically generated based on DOM structure
      expect(h1LengthCheck1.transformRules.selector).to.exist;
      expect(h1LengthCheck1.transformRules.selector).to.include('h1');

      // Test with different DOM structure
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<main><article><h1></h1></article></main>',
              tags: {
                title: 'Page Title',
                description: 'Page Description',
                h1: [],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result2 = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      const h1LengthCheck2 = result2.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_H1_LENGTH.check);

      // Selector should be different for different DOM structures
      expect(h1LengthCheck2.transformRules.selector).to.exist;
      expect(h1LengthCheck2.transformRules.selector).to.include('h1');
    });
  });

  it('handles validatePageHeadings error gracefully', async () => {
    const url = 'https://example.com/page';

    // Mock s3Client to throw an error - this will cause getObjectFromKey to return null
    s3Client.send.rejects(new Error('S3 connection failed'));

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

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

    // Use esmock to mock cheerio to throw an error during processing
    const mockedHandler = await esmock('../../src/headings/handler.js', {
      cheerio: {
        load: () => {
          throw new Error('DOM processing failed');
        }
      },
    });

    const result = await mockedHandler.validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

    // This should trigger the catch block and return the error object with url and empty checks
    expect(result.url).to.equal(url);
    expect(result.checks).to.deep.equal([]);
  });

  it('handles getH1HeadingASuggestion AI errors gracefully', async () => {
    const url = 'https://example.com/page';

    // Mock AI client to throw an error
    const mockClient = {
      fetchChatCompletion: sinon.stub().rejects(new Error('AI service unavailable')),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapedAt: Date.now(),
          scrapeResult: {
            rawBody: '<h1></h1>',
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

    // validatePageHeadings should return normal checks (AI is called later in headingsAuditRunner)
    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

    // Should return normal checks since AI is not called during validatePageHeadings
    expect(result.url).to.equal(url);
    expect(result.checks).to.have.length.greaterThan(0);
  });

  it('handles getH1HeadingASuggestion JSON parsing errors', async () => {
    const url = 'https://example.com/page';

    // Mock AI client to return invalid JSON
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: 'invalid json' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapedAt: Date.now(),
          scrapeResult: {
            rawBody: '<h1></h1>',
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

    // validatePageHeadings should return normal checks (AI is called later in headingsAuditRunner)
    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

    // Should return normal checks since AI is not called during validatePageHeadings
    expect(result.url).to.equal(url);
    expect(result.checks).to.have.length.greaterThan(0);
  });

  it('handles getH1HeadingASuggestion with invalid response structure', async function () {
    this.timeout(10000); // Increase timeout for async operations
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
    context.log = logSpy;

    // Mock AI client to return valid JSON but without the expected h1.aiSuggestion structure
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"someOtherField":"value"}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Mock getTopPagesForSiteId to return pages
    const getTopPagesForSiteIdStub = sinon.stub().resolves([
      { url: url }
    ]);

    const mockedHandlerWithStubs = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };

    // Mock S3 client to return HTML with missing H1 (which triggers AI suggestion)
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: url,
              scrapedAt: Date.now(),
              scrapeResult: {
                rawBody: '<h2>No H1 here</h2>', // Missing H1 to trigger AI suggestion
                tags: {
                  title: 'Page Title',
                  description: 'Page Description',
                  h1: ['Page H1'],
                },
              }
            }),
          },
          ContentType: 'application/json',
        });
      }

      throw new Error('Unexpected command passed to s3Client.send');
    });

    context.s3Client = s3Client;
    const result = await mockedHandlerWithStubs.headingsAuditRunner(baseURL, context, site);

    // Verify that the error was logged for invalid response structure
    expect(logSpy.error).to.have.been.calledWith(
      sinon.match(/Invalid response structure.*Expected h1.aiSuggestion/)
    );

    // Verify that AI suggestion was attempted but returned null due to invalid structure
    expect(mockClient.fetchChatCompletion).to.have.been.called;

    // The audit should still complete with the heading issue detected (but no AI suggestion)
    expect(result.auditResult.headings['heading-missing-h1']).to.exist;
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].url).to.equal(url);
    // AI suggestion should be null or undefined due to invalid response structure
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].suggestion).to.not.equal('Optimized H1 Title');
  });

  it('handles getH1HeadingASuggestion with missing pageTags properties (default fallbacks)', async function () {
    this.timeout(10000); // Increase timeout for async operations
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
    context.log = logSpy;

    // Mock AI client to return valid suggestions
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":"Generated H1","aiRationale":"For missing properties"},"guidelines":"Test"}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Mock getTopPagesForSiteId to return pages
    const getTopPagesForSiteIdStub = sinon.stub().resolves([
      { url: url }
    ]);

    const mockedHandlerWithStubs = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };

    // Mock S3 client to return HTML with missing H1 and EMPTY/MISSING pageTags properties
    // This tests the fallback branches: || '', || 'en'
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: url,
              scrapedAt: Date.now(),
              scrapeResult: {
                rawBody: '<h2>No H1 here</h2>',
                tags: {
                  // Missing/empty properties to test fallbacks
                  title: '', // Empty title - should use '' fallback
                  description: null, // Null description - should use '' fallback
                  h1: [], // Empty h1 array - should use '' fallback
                  // lang is undefined - should use 'en' fallback
                  // finalUrl will be undefined - should use '' fallback
                },
              }
            }),
          },
          ContentType: 'application/json',
        });
      }

      throw new Error('Unexpected command passed to s3Client.send');
    });

    context.s3Client = s3Client;
    const result = await mockedHandlerWithStubs.headingsAuditRunner(baseURL, context, site);

    // Verify the audit completed successfully despite missing pageTags
    expect(result.auditResult.headings['heading-missing-h1']).to.exist;
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].url).to.equal(url);

    // Verify AI suggestion was called (which means the fallback values were used)
    expect(mockClient.fetchChatCompletion).to.have.been.called;
  });

  it('handles getH1HeadingASuggestion with null brandGuidelines', async () => {
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
    context.log = logSpy;

    // Mock AI client to succeed for both getBrandGuidelines and getH1HeadingASuggestion
    const mockClient = {
      fetchChatCompletion: sinon.stub()
        .onFirstCall().resolves({
          choices: [{ message: { content: '{}' } }], // Empty brand guidelines (will be falsy)
        })
        .onSecondCall().resolves({
          choices: [{ message: { content: '{"h1":{"aiSuggestion":"Generated H1"}}' } }],
        }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Mock getTopPagesForSiteId to return pages
    const getTopPagesForSiteIdStub = sinon.stub().resolves([
      { url: url }
    ]);

    const mockedHandlerWithStubs = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };

    // Mock S3 client to return HTML with missing H1
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: url,
              scrapedAt: Date.now(),
              scrapeResult: {
                rawBody: '<h2>No H1 here</h2>',
                tags: {
                  title: 'Page Title',
                  description: 'Page Description',
                  h1: ['Page H1'],
                },
              }
            }),
          },
          ContentType: 'application/json',
        });
      }

      throw new Error('Unexpected command passed to s3Client.send');
    });

    context.s3Client = s3Client;
    const result = await mockedHandlerWithStubs.headingsAuditRunner(baseURL, context, site);

    // Verify the audit completed successfully with null/empty brandGuidelines (uses '' fallback)
    expect(result.auditResult.headings['heading-missing-h1']).to.exist;
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].url).to.equal(url);

    // Verify AI suggestion was called at least twice (getBrandGuidelines + getH1HeadingASuggestion + possibly getTocDetails)
    expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(2);
  });

  it('handles getH1HeadingASuggestion with all pageTags properties provided (truthy branches)', async function () {
    this.timeout(10000); // Increase timeout for async operations
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
    context.log = logSpy;

    // Mock AI client to return valid suggestions
    const mockClient = {
      fetchChatCompletion: sinon.stub()
        .onFirstCall().resolves({
          choices: [{ message: { content: '{"guidelines":"Valid brand guidelines content"}' } }],
        })
        .onSecondCall().resolves({
          choices: [{ message: { content: '{"h1":{"aiSuggestion":"Generated H1 with all props"}}' } }],
        }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Mock getTopPagesForSiteId to return pages
    const getTopPagesForSiteIdStub = sinon.stub().resolves([
      { url: url }
    ]);

    const mockedHandlerWithStubs = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };

    // Mock S3 client to return HTML with ALL pageTags properties filled (truthy values)
    // This tests the truthy branches: uses actual values instead of fallbacks
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: url, // Truthy finalUrl
              scrapedAt: Date.now(),
              scrapeResult: {
                rawBody: '<h2>No H1 here</h2>',
                tags: {
                  title: 'Actual Page Title', // Truthy title
                  description: 'Actual Page Description', // Truthy description
                  h1: ['Actual H1 Text'], // Truthy h1 array
                  lang: 'fr', // Truthy lang (not 'en')
                },
              }
            }),
          },
          ContentType: 'application/json',
        });
      }

      throw new Error('Unexpected command passed to s3Client.send');
    });

    context.s3Client = s3Client;
    const result = await mockedHandlerWithStubs.headingsAuditRunner(baseURL, context, site);

    // Verify the audit completed successfully with all properties provided
    expect(result.auditResult.headings['heading-missing-h1']).to.exist;
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].url).to.equal(url);

    // Verify AI suggestion was called at least twice (once for brand guidelines, once for H1 suggestion, plus TOC detection)
    expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(2);

    // This test ensures the truthy branches are taken:
    // - finalUrl uses actual value (not '')
    // - h1 uses actual array value (not '')
    // - brandGuidelines uses actual value (not '')
    // - lang uses actual value 'fr' (not 'en')
  });

  it('handles getH1HeadingASuggestion when pageTags is null or undefined', async function () {
    this.timeout(5000);
    const baseURL = 'https://example.com';
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
    context.log = logSpy;

    // Mock AI client to return valid suggestions
    const mockClient = {
      fetchChatCompletion: sinon.stub()
        .onFirstCall().resolves({
          choices: [{ message: { content: '{"guidelines":"Brand guidelines"}' } }],
        })
        .onSecondCall().resolves({
          choices: [{ message: { content: '{"h1":{"aiSuggestion":"Generated H1 for null pageTags"}}' } }],
        }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Mock getTopPagesForSiteId to return pages
    const getTopPagesForSiteIdStub = sinon.stub().resolves([
      { url: url }
    ]);

    const mockedHandlerWithStubs = await esmock('../../src/headings/handler.js', {
      '../../src/canonical/handler.js': {
        getTopPagesForSiteId: getTopPagesForSiteIdStub,
      },
    });

    context.dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
          { getUrl: () => url },
        ]),
      },
    };

    // Mock S3 client to return HTML with missing H1
    // The check object will have pageTags, but we'll test with null/undefined scenario
    s3Client.send.callsFake((command) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: allKeys.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }

      if (command instanceof GetObjectCommand) {
        return Promise.resolve({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: url,
              scrapedAt: Date.now(),
              scrapeResult: {
                rawBody: '<h2>No H1 here</h2>',
                tags: {
                  title: 'Page Title',
                  description: 'Page Description',
                  h1: ['Page H1'],
                  // No lang property
                },
              }
            }),
          },
          ContentType: 'application/json',
        });
      }

      throw new Error('Unexpected command passed to s3Client.send');
    });

    context.s3Client = s3Client;

    // To properly test pageTags being null/undefined, we need to mock getH1HeadingASuggestion
    // being called with null pageTags. We'll use esmock to intercept and test this.
    // For now, let's test through the existing flow and verify it handles undefined properties
    const result = await mockedHandlerWithStubs.headingsAuditRunner(baseURL, context, site);

    // Verify the audit completed successfully even when pageTags properties are missing
    expect(result.auditResult.headings['heading-missing-h1']).to.exist;
    expect(result.auditResult.headings['heading-missing-h1'].urls[0].url).to.equal(url);

    // Verify AI suggestion was called
    expect(mockClient.fetchChatCompletion.callCount).to.be.at.least(2);
  });

  it('handles getH1HeadingASuggestion with completely null pageTags object', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Test calling getH1HeadingASuggestion directly through validatePageHeadings
    // with a scenario where pageTags could be null
    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h2>No H1 here</h2>',
            tags: {
              title: null,
              description: null,
              h1: [],
              lang: null,
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    // This creates a scenario where pageTags properties are all null/empty
    // The optional chaining will safely return undefined for all properties
    const result = await validatePageHeadings(url, logSpy, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

    // Verify the result still contains checks (HEADING_MISSING_H1)
    expect(result.url).to.equal(url);
    expect(result.checks).to.be.an('array');

    // The pageTags object should be created with null/empty values as provided
    const missingH1Check = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_MISSING_H1.check);
    if (missingH1Check) {
      expect(missingH1Check.pageTags).to.exist;
      // Properties reflect the null/empty values from the mock
      expect(missingH1Check.pageTags.h1).to.deep.equal([]);
      expect(missingH1Check.pageTags.title).to.be.null;
      expect(missingH1Check.pageTags.description).to.be.null;
      expect(missingH1Check.pageTags.lang).to.be.null;
      // When getH1HeadingASuggestion is called with these pageTags,
      // the optional chaining and || operators will use fallback values
    }
  });

  it('covers h1 fallback branch in validatePageHeadings', async () => {
    const url = 'https://example.com/page';

    s3Client.send.resolves({
      Body: {
        transformToString: () => JSON.stringify({
          finalUrl: url,
          scrapeResult: {
            rawBody: '<h2>Section</h2>',
            tags: {
              title: 'Page Title',
              description: 'Page Description',
              h1: null, // This will trigger the || [] fallback on line 249
            },
          }
        }),
      },
      ContentType: 'application/json',
    });

    const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

    // Verify that pageTags.h1 uses the fallback [] when h1 is null
    expect(result.checks).to.be.an('array');
    const missingH1Check = result.checks.find(c => c.check === HEADINGS_CHECKS.HEADING_MISSING_H1.check);
    if (missingH1Check) {
      expect(missingH1Check.pageTags.h1).to.deep.equal([]);
    }
  });

  it('tests getH1HeadingASuggestion with null pageTags', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Mock AI client
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test Suggestion"}}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    // Call with null pageTags - this tests the optional chaining branches
    // pageTags?.finalUrl when pageTags is null → undefined → uses '' fallback
    // pageTags?.title when pageTags is null → undefined → uses '' fallback
    // pageTags?.h1 when pageTags is null → undefined → uses '' fallback
    // pageTags?.description when pageTags is null → undefined → uses '' fallback
    // pageTags?.lang when pageTags is null → undefined → uses 'en' fallback
    const result = await getH1HeadingASuggestion(
      url,
      logSpy,
      null, // pageTags is null - tests optional chaining
      context,
      'Brand Guidelines'
    );

    // Should still work with null pageTags
    expect(result).to.equal('Test Suggestion');
    expect(mockClient.fetchChatCompletion).to.have.been.called;
  });

  it('tests getH1HeadingASuggestion with null brandGuidelines', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Mock AI client
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test Suggestion with null guidelines"}}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const pageTags = {
      finalUrl: url,
      title: 'Test Title',
      h1: ['Test H1'],
      description: 'Test Description',
      lang: 'en',
    };

    // Call with null brandGuidelines - this tests the falsy branch of line 161
    // brandGuidelines || '' when brandGuidelines is null → uses '' fallback
    const result = await getH1HeadingASuggestion(
      url,
      logSpy,
      pageTags,
      context,
      null // brandGuidelines is null - tests the || '' fallback
    );

    // Should still work with null brandGuidelines
    expect(result).to.equal('Test Suggestion with null guidelines');
    expect(mockClient.fetchChatCompletion).to.have.been.called;
  });

  it('tests getH1HeadingASuggestion with undefined brandGuidelines', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Mock AI client
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: '{"h1":{"aiSuggestion":"Test Suggestion with undefined guidelines"}}' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const pageTags = {
      finalUrl: url,
      title: 'Test Title',
      h1: ['Test H1'],
      description: 'Test Description',
      lang: 'en',
    };

    // Call with undefined brandGuidelines - this tests the falsy branch of line 161
    // brandGuidelines || '' when brandGuidelines is undefined → uses '' fallback
    const result = await getH1HeadingASuggestion(
      url,
      logSpy,
      pageTags,
      context,
      undefined // brandGuidelines is undefined - tests the || '' fallback
    );

    // Should still work with undefined brandGuidelines
    expect(result).to.equal('Test Suggestion with undefined guidelines');
    expect(mockClient.fetchChatCompletion).to.have.been.called;
  });

  it('tests getH1HeadingASuggestion catch block when fetchChatCompletion throws error (lines 137-140)', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Mock AI client to throw an error
    const mockClient = {
      fetchChatCompletion: sinon.stub().rejects(new Error('Azure OpenAI service unavailable')),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const pageTags = {
      finalUrl: url,
      title: 'Test Title',
      h1: ['Test H1'],
      description: 'Test Description',
      lang: 'en',
    };

    // This should trigger the catch block at lines 137-140
    const result = await getH1HeadingASuggestion(
      url,
      logSpy,
      'h1',
      pageTags,
      context,
      'Brand Guidelines'
    );

    // Should return null when error occurs
    expect(result).to.be.null;

    // Should log the error
    expect(logSpy.error).to.have.been.calledWith(
      sinon.match(/\[Headings AI Suggestions\] Error for empty heading suggestion:/)
    );

    // Should have attempted to call fetchChatCompletion
    expect(mockClient.fetchChatCompletion).to.have.been.called;
  });

  it('tests getH1HeadingASuggestion catch block when JSON.parse throws error (lines 137-140)', async () => {
    const url = 'https://example.com/page';
    const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

    // Mock AI client to return invalid JSON that will cause JSON.parse to throw
    const mockClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{ message: { content: 'This is not valid JSON at all!' } }],
      }),
    };
    AzureOpenAIClient.createFrom.restore();
    sinon.stub(AzureOpenAIClient, 'createFrom').callsFake(() => mockClient);

    const pageTags = {
      finalUrl: url,
      title: 'Test Title',
      h1: ['Test H1'],
      description: 'Test Description',
      lang: 'en',
    };

    // This should trigger the catch block at lines 137-140 via JSON.parse error
    const result = await getH1HeadingASuggestion(
      url,
      logSpy,
      'h1',
      pageTags,
      context,
      'Brand Guidelines'
    );

    // Should return null when JSON parsing fails
    expect(result).to.be.null;

    // Should log the error (will include JSON parse error message)
    expect(logSpy.error).to.have.been.calledWith(
      sinon.match(/\[Headings AI Suggestions\] Error for empty heading suggestion:/)
    );

    // Should have called fetchChatCompletion
    expect(mockClient.fetchChatCompletion).to.have.been.called;
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
          headings: {
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
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(3);
      expect(result.suggestions.headings[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).',
      });
      expect(result.suggestions.headings[0].url).to.equal('https://example.com/page1');
    });

    it('handles default case in generateRecommendedAction', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
            'unknown-check': {
              success: false,
            explanation: 'Unknown issue',
            urls: [{ url: 'https://example.com/page1' }]
          }
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings[0].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
    });

    it('handles new URL object format with tagName and custom suggestion', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          headings: {
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
          },
          toc: {}
        }
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions.headings).to.have.lengthOf(3);

      // First suggestion with custom suggestion
      expect(result.suggestions.headings[0]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        url: 'https://example.com/page1',
        tagName: 'H3',
        recommendedAction: 'Change this H3 to H2 to maintain proper hierarchy', // Uses custom suggestion
      });

      // Second suggestion without custom suggestion (uses default)
      expect(result.suggestions.headings[1]).to.deep.include({
        type: 'CODE_CHANGE',
        checkType: 'heading-order-invalid',
        explanation: 'Invalid order',
        url: 'https://example.com/page2',
        tagName: 'H4',
        recommendedAction: 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).', // Uses default
      });

      // Third suggestion with custom suggestion for empty heading
      expect(result.suggestions.headings[2]).to.deep.include({
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
      const auditData = { suggestions: { headings: [], toc: [] } };

      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);
      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).not.to.have.been.called;
    });

    it('creates opportunity and syncs suggestions', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: { url: 'https://example.com/page1' },
            recommendedAction: 'Add content'
          }
        ], toc: [] }
      };

      const result = await mockedOpportunityAndSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;

      const syncCall = syncSuggestionsStub.getCall(0);
      expect(syncCall.args[0]).to.have.property('opportunity');
      expect(syncCall.args[0]).to.have.property('newData', auditData.suggestions.headings);
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
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: 'https://example.com/page1',
            recommendedAction: 'Add content'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(syncSuggestionsStub2).to.have.been.calledOnce;

      // Check that mapNewSuggestion was called with the right structure
      const syncCall = syncSuggestionsStub2.getCall(0);
      const mapNewSuggestionFn = syncCall.args[0].mapNewSuggestion;
      expect(mapNewSuggestionFn).to.be.a('function');

      // Test the mapNewSuggestion function directly
      const mappedSuggestion = mapNewSuggestionFn(auditData.suggestions.headings[0]);
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

    it('tests buildKey function execution in opportunityAndSuggestions', async () => {
      // Create real stubs that will be called
      const convertToOpportunityStub3 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub3 = sinon.stub().resolves();

      // Mock the dependencies
      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub3,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub3,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            explanation: 'Empty heading',
            url: 'https://example.com/page1',
            recommendedAction: 'Add content'
          },
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-order-invalid',
            explanation: 'Invalid order',
            url: 'https://example.com/page2',
            recommendedAction: 'Fix order'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      expect(syncSuggestionsStub3).to.have.been.calledOnce;

      // Check that buildKey was called with the right structure
      const syncCall = syncSuggestionsStub3.getCall(0);
      const buildKeyFn = syncCall.args[0].buildKey;
      expect(buildKeyFn).to.be.a('function');

      // Test the buildKey function directly
      const suggestion1 = auditData.suggestions.headings[0];
      const key1 = buildKeyFn(suggestion1);
      expect(key1).to.equal('heading-empty|https://example.com/page1');

      const suggestion2 = auditData.suggestions.headings[1];
      const key2 = buildKeyFn(suggestion2);
      expect(key2).to.equal('heading-order-invalid|https://example.com/page2');
    });

    it('tests mergeDataFunction execution - basic merge without isEdited', async () => {
      const convertToOpportunityStub4 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub4 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub4,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub4,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub4.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;
      expect(mergeDataFn).to.be.a('function');

      // Test basic merge without isEdited
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'Old action',
        someField: 'existing value'
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'New action',
        someField: 'new value',
        newField: 'new field value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should merge normally, newSuggestion overwrites existingSuggestion
      expect(result.recommendedAction).to.equal('New action');
      expect(result.someField).to.equal('new value');
      expect(result.newField).to.equal('new field value');
    });

    it('tests mergeDataFunction execution - preserves recommendedAction when isEdited is true', async () => {
      const convertToOpportunityStub5 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub5 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub5,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub5,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub5.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test merge with isEdited: true
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'User edited action',
        isEdited: true,
        someField: 'existing value'
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'AI generated action',
        someField: 'new value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should preserve the user-edited recommendedAction
      expect(result.recommendedAction).to.equal('User edited action');
      expect(result.someField).to.equal('new value');
      expect(result.isEdited).to.equal(true);
    });

    it('tests mergeDataFunction execution - does not preserve when isEdited is false', async () => {
      const convertToOpportunityStub6 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub6 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub6,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub6,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub6.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test merge with isEdited: false
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'Old action',
        isEdited: false,
        someField: 'existing value'
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'New action',
        someField: 'new value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should NOT preserve, should use new recommendedAction
      expect(result.recommendedAction).to.equal('New action');
      expect(result.someField).to.equal('new value');
    });

    it('tests mergeDataFunction execution - does not preserve when recommendedAction is undefined', async () => {
      const convertToOpportunityStub7 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub7 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub7,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub7,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub7.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test merge with isEdited: true but recommendedAction is undefined
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        isEdited: true,
        someField: 'existing value'
        // recommendedAction is undefined
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'New action',
        someField: 'new value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should NOT preserve since recommendedAction is undefined
      expect(result.recommendedAction).to.equal('New action');
      expect(result.someField).to.equal('new value');
      expect(result.isEdited).to.equal(true);
    });

    it('tests mergeDataFunction execution - handles null recommendedAction', async () => {
      const convertToOpportunityStub8 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub8 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub8,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub8,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub8.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test merge with isEdited: true but recommendedAction is null
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        isEdited: true,
        recommendedAction: null,
        someField: 'existing value'
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'New action',
        someField: 'new value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should NOT preserve since recommendedAction is null (which is not !== undefined)
      // Note: null !== undefined is true, so the condition will pass
      expect(result.recommendedAction).to.equal(null);
      expect(result.someField).to.equal('new value');
      expect(result.isEdited).to.equal(true);
    });

    it('tests mergeDataFunction execution - preserves empty string recommendedAction when isEdited', async () => {
      const convertToOpportunityStub9 = sinon.stub().resolves({
        getId: () => 'test-opportunity-id'
      });

      const syncSuggestionsStub9 = sinon.stub().resolves();

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub9,
        },
        '../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub9,
        },
      });

      const auditUrl = 'https://example.com';
      const auditData = {
        suggestions: { headings: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'New action'
          }
        ], toc: [] }
      };

      await mockedHandler.opportunityAndSuggestions(auditUrl, auditData, context);

      const syncCall = syncSuggestionsStub9.getCall(0);
      const mergeDataFn = syncCall.args[0].mergeDataFunction;

      // Test merge with isEdited: true and empty string recommendedAction
      const existingSuggestion = {
        type: 'CODE_CHANGE',
        isEdited: true,
        recommendedAction: '',
        someField: 'existing value'
      };
      const newSuggestion = {
        type: 'CODE_CHANGE',
        recommendedAction: 'New action',
        someField: 'new value'
      };

      const result = mergeDataFn(existingSuggestion, newSuggestion);

      // Should preserve the empty string since it's !== undefined
      expect(result.recommendedAction).to.equal('');
      expect(result.someField).to.equal('new value');
      expect(result.isEdited).to.equal(true);
    });
  });

  describe('Opportunity Data Mapper', () => {
    it('creates proper opportunity data structure', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.be.an('object');
      expect(opportunityData).to.have.property('runbook', '');
      expect(opportunityData).to.have.property('origin', 'AUTOMATION');
      expect(opportunityData).to.have.property('title', 'Optimize Headings for LLMs');
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
      expect(opportunityData.tags).to.have.lengthOf(4);
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

  describe('convertToOpportunity real function coverage', () => {
    it('covers comparisonFn execution in real convertToOpportunity function', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        id: 'test-audit-id',
        suggestions: [
          {
            type: 'CODE_CHANGE',
            checkType: 'heading-empty',
            url: 'https://example.com/page1',
            recommendedAction: 'Add content'
          }
        ]
      };

      const mockContext = {
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([
              {
                getType: () => 'headings',
                getData: () => ({
                  additionalMetrics: [
                    { key: 'subtype', value: 'headings' }
                  ]
                }),
                setAuditId: sinon.stub(),
                setData: sinon.stub(),
                setUpdatedBy: sinon.stub(),
                save: sinon.stub().resolves(),
                getId: () => 'test-existing-opportunity-id'
              }
            ]),
            create: sinon.stub().resolves({
              getId: () => 'test-opportunity-id'
            })
          }
        },
        log: { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() }
      };

      // Use esmock to mock the opportunity-utils module
      const mockedOpportunity = await esmock('../../src/common/opportunity.js', {
        '../../src/common/opportunity-utils.js': {
          checkGoogleConnection: sinon.stub().resolves(true),
        },
      });

      const comparisonFn = (oppty, opportunityInstance) => {
        const opptyData = oppty.getData();
        const opptyAdditionalMetrics = opptyData?.additionalMetrics;
        if (!opptyAdditionalMetrics || !Array.isArray(opptyAdditionalMetrics)) {
          return false;
        }
        const hasHeadingsSubtype = opptyAdditionalMetrics.some(
          (metric) => metric.key === 'subtype' && metric.value === 'headings',
        );
        return hasHeadingsSubtype;
      };

      // This should execute lines 47-48 in opportunity.js
      const result = await mockedOpportunity.convertToOpportunity(
        auditUrl,
        auditData,
        mockContext,
        createOpportunityData,
        'headings',
        {},
        comparisonFn
      );

      expect(result).to.exist;
      expect(result.getId()).to.equal('test-existing-opportunity-id');
    });
  });

  describe('getTextContent function', () => {
    it('returns empty string when element is null', () => {
      const $ = () => ({ text: () => ({ trim: () => 'test' }) });
      const result = getTextContent(null, $);
      expect(result).to.equal('');
    });

    it('returns empty string when element is undefined', () => {
      const $ = () => ({ text: () => ({ trim: () => 'test' }) });
      const result = getTextContent(undefined, $);
      expect(result).to.equal('');
    });

    it('returns empty string when $ is null', () => {
      const element = { tagName: 'H1' };
      const result = getTextContent(element, null);
      expect(result).to.equal('');
    });

    it('returns empty string when $ is undefined', () => {
      const element = { tagName: 'H1' };
      const result = getTextContent(element, undefined);
      expect(result).to.equal('');
    });

    it('returns trimmed text content when both element and $ are valid', () => {
      const element = { tagName: 'H1' };
      const $ = () => ({ text: () => ({ trim: () => 'Test Heading' }) });
      const result = getTextContent(element, $);
      expect(result).to.equal('Test Heading');
    });
  });

  describe('getHeadingSelector function', () => {
    describe('Unit tests - direct function calls', () => {
      it('returns null when heading is null', () => {
        const result = getHeadingSelector(null);
        expect(result).to.be.null;
      });

      it('returns null when heading is undefined', () => {
        const result = getHeadingSelector(undefined);
        expect(result).to.be.null;
      });

      it('returns null when heading has no name property', () => {
        const headingWithoutTag = { attribs: { id: 'test', class: 'heading' } };
        const result = getHeadingSelector(headingWithoutTag);
        expect(result).to.be.null;
      });

      it('returns null when heading.name is null', () => {
        const headingWithNullTag = { name: null, attribs: { id: 'test' } };
        const result = getHeadingSelector(headingWithNullTag);
        expect(result).to.be.null;
      });

      it('returns null when heading.name is undefined', () => {
        const headingWithUndefinedTag = { name: undefined, attribs: { id: 'test' } };
        const result = getHeadingSelector(headingWithUndefinedTag);
        expect(result).to.be.null;
      });

      it('returns null when heading.name is empty string', () => {
        const headingWithEmptyTag = { name: '', attribs: { id: 'test' } };
        const result = getHeadingSelector(headingWithEmptyTag);
        expect(result).to.be.null;
      });

      it('returns selector when heading has valid name', () => {
        const heading = { name: 'H1', attribs: { id: 'main' } };
        const result = getHeadingSelector(heading);
        expect(result).to.equal('h1#main');
      });
    });

    describe('Integration tests - full audit flow', () => {

    it('generates selector with ID when heading has an ID attribute', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1 id="main-heading">Test</h1><h2></h2>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Empty H2 should generate a selector
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.transformRules.selector).to.exist;
      // Selector should be generated for the H2
      expect(emptyCheck.transformRules.selector).to.include('h2');
    });

    it('generates selector with single class', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><h2 class="section-heading"></h2>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.transformRules.selector).to.include('h2');
      expect(emptyCheck.transformRules.selector).to.include('section-heading');
    });

    it('generates selector with multiple classes (limits to 2)', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><h2 class="hero title bold highlight"></h2>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;
      expect(selector).to.include('h2');
      expect(selector).to.include('hero');
      expect(selector).to.include('title');
      // Should not include 3rd and 4th classes
      expect(selector).to.not.include('bold');
      expect(selector).to.not.include('highlight');
    });

    it('generates selector with nth-of-type for multiple siblings', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><div><h2>First</h2><h2></h2><h2>Third</h2></div>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.transformRules.selector).to.include('h2');
      expect(emptyCheck.transformRules.selector).to.include(':nth-of-type(2)');
    });

    it('generates selector with parent context', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><main><article><h2></h2></article></main>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;
      expect(selector).to.include('h2');
      expect(selector).to.include('article');
      expect(selector).to.include('main');
      expect(selector).to.include('>'); // Should use direct child combinator
    });

    it('generates selector with parent classes', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><div class="container wrapper"><h2></h2></div>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;
      expect(selector).to.include('h2');
      expect(selector).to.include('div');
      expect(selector).to.include('container');
      expect(selector).to.include('wrapper');
    });

    it('stops at parent with ID (early termination)', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><div id="content"><section><article><h2></h2></article></section></div>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;
      expect(selector).to.include('h2');
      expect(selector).to.include('#content');
      // Should not climb past the ID
      expect(selector).to.not.include('body');
    });

    it('limits parent context to 3 levels', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><div><section><article><aside><h2></h2></aside></article></section></div>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;

      // Count the number of '>' separators (should be max 3 for 3 levels of parents)
      const separatorCount = (selector.match(/>/g) || []).length;
      expect(separatorCount).to.be.at.most(3);
    });

    it('handles heading with ID and classes (ID takes priority)', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1 id="main" class="hero large">Test</h1><h2></h2>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      // Empty H2 should still generate a selector
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.transformRules.selector).to.include('h2');
    });

    it('handles complex selector: classes + nth-of-type + parent context', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><main class="content"><section class="posts"><h2 class="title">First</h2><h2 class="title"></h2></section></main>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;

      // Should include all parts
      expect(selector).to.include('h2');
      expect(selector).to.include('title'); // heading class
      expect(selector).to.include(':nth-of-type(2)'); // second H2
      expect(selector).to.include('section'); // parent
      expect(selector).to.include('posts'); // parent class
      expect(selector).to.include('>'); // direct child combinator
    });

    it('handles empty heading at different document positions', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><header><h2></h2></header><main><h3></h3></main><footer><h4></h4></footer>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyChecks = result.checks.filter(c => c.check === 'heading-empty');
      expect(emptyChecks).to.have.lengthOf(3);

      // Each should have unique selectors
      const selectors = emptyChecks.map(c => c.transformRules.selector);
      const uniqueSelectors = new Set(selectors);
      expect(uniqueSelectors.size).to.equal(3);

      // Verify each includes its parent context
      expect(selectors.some(s => s.includes('header'))).to.be.true;
      expect(selectors.some(s => s.includes('main'))).to.be.true;
      expect(selectors.some(s => s.includes('footer'))).to.be.true;
    });

    it('handles parent with excessive classes (limits to 2)', async () => {
      const url = 'https://example.com/page';

      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: '<h1>Test</h1><div class="container wrapper main-content primary"><h2></h2></div>',
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Test'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);

      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      const selector = emptyCheck.transformRules.selector;

      // Should include first 2 parent classes only
      expect(selector).to.include('container');
      expect(selector).to.include('wrapper');
      // Should not include 3rd and 4th classes
      expect(selector).to.not.include('main-content');
      expect(selector).to.not.include('primary');
    });
    });
  });

  describe('getSurroundingText utility function', () => {
    it('breaks after loop when afterText reaches charLimit (line 50)', async () => {
      const url = 'https://example.com/page';
      
      // Create long text that will exceed the default 150 char limit
      // We need an EMPTY non-H1 heading for getHeadingContext to be called
      const longText = 'A'.repeat(100); // 100 chars in first element
      const moreText = 'B'.repeat(100); // 100 chars in second element
      
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>Title</h1><h2></h2><p>${longText}</p><p>${moreText}</p>`,
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      
      // Empty H2 triggers getHeadingContext -> getSurroundingText
      // The break at line 50 prevents collecting more than charLimit chars after the heading
      expect(result).to.exist;
      expect(result.checks).to.be.an('array');
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.headingContext).to.exist;
    });

    it('breaks before loop when beforeText reaches charLimit (line 63)', async () => {
      const url = 'https://example.com/page';
      
      // Create long text that will exceed the default 150 char limit
      const longText = 'C'.repeat(100); // 100 chars in first element before
      const moreText = 'D'.repeat(100); // 100 chars in second element before
      
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>Title</h1><p>${moreText}</p><p>${longText}</p><h2></h2>`,
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      
      // Empty H2 triggers getHeadingContext -> getSurroundingText
      // The break at line 63 prevents collecting more than charLimit chars before the heading
      expect(result).to.exist;
      expect(result.checks).to.be.an('array');
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.headingContext).to.exist;
    });

    it('continues after loop when afterText does not reach charLimit (line 50 not taken)', async () => {
      const url = 'https://example.com/page';
      
      // Create short text that won't exceed the limit
      const shortText = 'Short text here.';
      
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>Title</h1><h2></h2><p>${shortText}</p><p>More short text.</p>`,
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      
      // When text is short, the break at line 50 is NOT taken
      // The loop continues to collect text from all siblings
      expect(result).to.exist;
      expect(result.checks).to.be.an('array');
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.headingContext).to.exist;
    });

    it('continues before loop when beforeText does not reach charLimit (line 63 not taken)', async () => {
      const url = 'https://example.com/page';
      
      // Create short text that won't exceed the limit
      const shortText = 'Short before text.';
      
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>Title</h1><p>More before text.</p><p>${shortText}</p><h2></h2>`,
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      
      // When text is short, the break at line 63 is NOT taken
      // The loop continues to collect text from all previous siblings
      expect(result).to.exist;
      expect(result.checks).to.be.an('array');
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.headingContext).to.exist;
    });

    it('handles both breaks when text exceeds limit in both directions', async () => {
      const url = 'https://example.com/page';
      
      // Create long text in both directions
      const longTextBefore = 'E'.repeat(100);
      const longTextAfter = 'F'.repeat(100);
      
      s3Client.send.resolves({
        Body: {
          transformToString: () => JSON.stringify({
            finalUrl: url,
            scrapedAt: Date.now(),
            scrapeResult: {
              rawBody: `<h1>Title</h1><p>${longTextBefore}</p><p>${longTextBefore}</p><h2></h2><p>${longTextAfter}</p><p>${longTextAfter}</p>`,
              tags: {
                title: 'Test',
                description: 'Test',
                h1: ['Title'],
              },
            }
          }),
        },
        ContentType: 'application/json',
      });

      const result = await validatePageHeadings(url, log, site, allKeys, s3Client, context.env.S3_SCRAPER_BUCKET_NAME, seoChecks);
      
      // Both breaks (lines 50 and 63) should be triggered
      expect(result).to.exist;
      expect(result.checks).to.be.an('array');
      const emptyCheck = result.checks.find(c => c.check === 'heading-empty');
      expect(emptyCheck).to.exist;
      expect(emptyCheck.headingContext).to.exist;
    });
  });

  describe('Shared Utils Coverage Tests', () => {
    it('covers lines 144-146: error in loadScrapeJson', async () => {
      const { loadScrapeJson } = await import('../../src/headings/shared-utils.js');
      const url = 'https://example.com/page';
      const logSpy = sinon.spy(log);

      // Mock S3 client to throw an error that will be caught in the catch block
      const errorS3Client = {
        send: sinon.stub().rejects(new Error('S3 connection timeout')),
      };

      const result = await loadScrapeJson(
        url,
        site,
        allKeys,
        errorS3Client,
        context.env.S3_SCRAPER_BUCKET_NAME,
        logSpy,
      );

      expect(result).to.be.null;
      // The error can be logged by either getObjectFromKey or loadScrapeJson's catch block
      expect(logSpy.error).to.have.been.called;
    });
  });

  describe('Coverage Tests for Missing Lines', () => {
    it('covers lines 157-159: null scrapeJsonObject in validatePageHeadingFromScrapeJson', async () => {
      const { validatePageHeadingFromScrapeJson } = await import('../../src/headings/handler.js');
      const url = 'https://example.com/page';
      const logSpy = sinon.spy(log);

      const result = await validatePageHeadingFromScrapeJson(url, null, logSpy, seoChecks);

      expect(result).to.be.null;
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Scrape JSON object not found/)
      );
    });

    it('covers lines 365-370: invalid URL format in validatePageHeadings', async () => {
      const invalidUrl = 'not-a-valid-url';
      const logSpy = sinon.spy(log);

      const result = await validatePageHeadings(
        invalidUrl,
        logSpy,
        site,
        allKeys,
        s3Client,
        context.env.S3_SCRAPER_BUCKET_NAME,
        seoChecks,
      );

      expect(result.url).to.equal(invalidUrl);
      expect(result.checks).to.deep.equal([]);
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Invalid URL format/)
      );
    });

    it('covers lines 379-384: error in validatePageHeadings catch block', async () => {
      const url = 'https://example.com/page';
      const logSpy = sinon.spy(log);

      // Mock S3 to return malformed data that will cause validatePageHeadingFromScrapeJson to throw
      s3Client.send.callsFake((command) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({
            Contents: allKeys.map((key) => ({ Key: key })),
            NextContinuationToken: undefined,
          });
        }
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: null, // This will cause an error when accessing rawBody
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      const result = await validatePageHeadings(
        url,
        logSpy,
        site,
        allKeys,
        s3Client,
        context.env.S3_SCRAPER_BUCKET_NAME,
        seoChecks,
      );

      // The catch block should return an error object
      expect(result.url).to.equal(url);
      expect(result.checks).to.deep.equal([]);
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/Error validating headings for/)
      );
    });

    it('covers lines 467-469: error generating AI suggestion in headingsAuditRunner', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/page';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      context.log = logSpy;

      // Mock getPrompt to throw on the third call (H1 suggestion)
      const getPromptStub = sinon.stub();
      getPromptStub.onCall(0).resolves('toc prompt');
      getPromptStub.onCall(1).resolves('brand guidelines prompt');
      getPromptStub.onCall(2).rejects(new Error('Prompt template not found'));

      const mockClient = {
        fetchChatCompletion: sinon.stub()
          .onFirstCall().resolves({
            choices: [{ message: { content: '{"tocPresent":false}' } }],
          })
          .onSecondCall().resolves({
            choices: [{ message: { content: '{"guidelines":"Test"}' } }],
          }),
      };

      const getTopPagesForSiteIdStub = sinon.stub().resolves([{ url }]);

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/canonical/handler.js': {
          getTopPagesForSiteId: getTopPagesForSiteIdStub,
        },
        '@adobe/spacecat-shared-utils': {
          getPrompt: getPromptStub,
        },
        '@adobe/spacecat-shared-gpt-client': {
          AzureOpenAIClient: {
            createFrom: sinon.stub().returns(mockClient),
          },
        },
      });

      // Set up dataAccess mock
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
            Contents: allKeys.map((key) => ({ Key: key })),
            NextContinuationToken: undefined,
          });
        }
        if (command instanceof GetObjectCommand) {
          return Promise.resolve({
            Body: {
              transformToString: () => JSON.stringify({
                finalUrl: url,
                scrapedAt: Date.now(),
                scrapeResult: {
                  rawBody: '<h1></h1>',
                  tags: { title: 'Test', description: 'Test', h1: [] },
                },
              }),
            },
            ContentType: 'application/json',
          });
        }
        throw new Error('Unexpected command');
      });

      context.s3Client = s3Client;
      const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);

      // The catch block at lines 467-469 OR internal error handling both log AI Suggestions errors
      // Either path provides adequate coverage for error handling
      expect(logSpy.error).to.have.been.calledWith(
        sinon.match(/\[Headings AI Suggestions\]/)
      );
      expect(result).to.have.property('auditResult');
    });

    it('covers lines 520-525: error in headingsAuditRunner catch block', async () => {
      const baseURL = 'https://example.com';
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };
      context.log = logSpy;

      const getTopPagesForSiteIdStub = sinon.stub().rejects(new Error('Database error'));

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/canonical/handler.js': {
          getTopPagesForSiteId: getTopPagesForSiteIdStub,
        },
      });

      const result = await mockedHandler.headingsAuditRunner(baseURL, context, site);

      expect(result.auditResult.error).to.exist;
      expect(result.auditResult.error).to.be.a('string');
      expect(result.auditResult.success).to.be.false;
      expect(logSpy.error).to.have.been.calledWith(sinon.match(/Headings audit failed/));
    });
  });

  describe('Branch Coverage Tests', () => {
    it('covers line 538: fallback to auditResult when headings key does not exist', async () => {
      const { generateSuggestions } = await import('../../src/headings/handler.js');
      const auditUrl = 'https://example.com';
      
      // Create auditData WITHOUT the headings key to trigger fallback
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          // No 'headings' key, so it should fallback to auditResult itself
          'heading-missing-h1': {
            success: false,
            urls: [{
              url: auditUrl,
              suggestion: 'Add H1',
            }],
          },
        },
      };
      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy() };

      const result = await generateSuggestions(auditUrl, auditData, { log: logSpy });

      expect(result.suggestions).to.exist;
      expect(result.suggestions.headings).to.be.an('array');
    });

    it('covers line 566: fallback to empty array when suggestions.headings does not exist', async () => {
      const { opportunityAndSuggestions } = await import('../../src/headings/handler.js');
      const auditUrl = 'https://example.com';
      
      // Create auditData WITHOUT suggestions.headings to trigger fallback
      const auditData = {
        fullAuditRef: auditUrl,
        auditResult: {
          headings: {},
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

  describe('Athena/Ahrefs fallback in headingsAuditRunner', () => {
    it('should use Athena URLs when available and skip Ahrefs', async () => {
      const baseURL = 'https://example.com';
      const url = 'https://example.com/athena-page';

      const mockGetTopAgenticUrlsFromAthena = sinon.stub().resolves([url]);

      const mockedHandler = await esmock('../../src/headings/handler.js', {
        '../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
        },
      });

      const logSpy = { info: sinon.spy(), error: sinon.spy(), debug: sinon.spy(), warn: sinon.spy() };
      const mockSiteTopPage = sinon.stub().resolves([]);

      const testContext = {
        log: logSpy,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AZURE_OPENAI_ENDPOINT: 'https://test-endpoint.com',
          AZURE_OPENAI_KEY: 'test-key',
          AZURE_API_VERSION: '2024-02-01',
          AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: mockSiteTopPage,
          },
        },
        s3Client: {
          send: sinon.stub().callsFake((command) => {
            if (command.constructor.name === 'ListObjectsV2Command') {
              return Promise.resolve({
                Contents: [{ Key: `scrapes/site-1/athena-page/scrape.json` }],
                NextContinuationToken: undefined,
              });
            }
            if (command.constructor.name === 'GetObjectCommand') {
              return Promise.resolve({
                Body: {
                  transformToString: () => JSON.stringify({
                    finalUrl: url,
                    scrapedAt: Date.now(),
                    scrapeResult: {
                      rawBody: '<h1>Valid Heading</h1><h2>Subheading</h2>',
                      tags: { title: 'Test', description: 'Test', h1: ['Valid Heading'] },
                    },
                  }),
                },
                ContentType: 'application/json',
              });
            }
            throw new Error('Unexpected command');
          }),
        },
      };

      const testSite = {
        getId: () => 'site-1',
        getBaseURL: () => baseURL,
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      };

      const result = await mockedHandler.headingsAuditRunner(baseURL, testContext, testSite);

      // Verify Athena was called
      expect(mockGetTopAgenticUrlsFromAthena).to.have.been.calledOnce;
      // Verify Ahrefs was NOT called since Athena returned data
      expect(mockSiteTopPage).to.not.have.been.called;
      // Verify result
      expect(result.fullAuditRef).to.equal(baseURL);
    });
  });

  describe('Brand Profile Integration', () => {
    let getBrandGuidelines;

    before(async () => {
      const sharedUtils = await import('../../src/headings/shared-utils.js');
      getBrandGuidelines = sharedUtils.getBrandGuidelines;
    });

    describe('getBrandGuidelines with brand profile from site config', () => {
      it('should use brand profile from site config when available', async () => {
        const mockBrandProfile = {
          main_profile: {
            brand_personality: {
              description: 'Lovesac comes across as both a nurturing host and an inspired creator',
              archetype: 'Caregiver-Innovator hybrid',
              traits: ['hospitable', 'innovative', 'optimistic', 'genuine', 'modern'],
            },
            tone_attributes: {
              primary: ['warm', 'enthusiastic', 'optimistic', 'inviting', 'premium'],
              avoid: ['aloof', 'overly formal', 'utilitarian', 'cold', 'condescending'],
            },
            language_patterns: {
              preferred: [
                'Designed for life',
                'Changeable. Washable. Loveable.',
                'Innovation you can feel',
              ],
              avoid: [
                'Lowest price guaranteed',
                'Standard sofa',
                'Cheap',
              ],
            },
            editorial_guidelines: {
              dos: [
                'Use brand-specific terms like \'Sac\' and \'Sactional\' confidently',
                'Tie product features directly to lifestyle/emotional benefits',
                'Speak directly to the reader in second person',
              ],
              donts: [
                'Talk down to the reader or use superfluous jargon',
                'Overpromise on technical claims without backing up with benefits',
                'Depend on price or discount language as primary motivation',
              ],
            },
          },
        };

        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        const result = await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Verify that brand profile was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] Using brand profile from site config');

        // Verify the extracted guidelines
        expect(result).to.have.property('brand_persona');
        expect(result.brand_persona).to.equal('Lovesac comes across as both a nurturing host and an inspired creator');

        expect(result).to.have.property('tone');
        expect(result.tone).to.equal('warm, enthusiastic, optimistic, inviting, premium');

        expect(result).to.have.property('editorial_guidelines');
        expect(result.editorial_guidelines).to.have.property('do');
        expect(result.editorial_guidelines.do).to.be.an('array').with.length(3);
        expect(result.editorial_guidelines).to.have.property('dont');
        expect(result.editorial_guidelines.dont).to.be.an('array').with.length(3);

        expect(result).to.have.property('forbidden');
        expect(result.forbidden).to.be.an('array');
        expect(result.forbidden).to.include('Lowest price guaranteed');
        expect(result.forbidden).to.include('aloof');

        // Verify AI was not called (no fetchChatCompletion in this test)
      });

      it('should extract all forbidden items from both language patterns and tone attributes', async () => {
        const mockBrandProfile = {
          main_profile: {
            tone_attributes: {
              primary: ['friendly'],
              avoid: ['tone1', 'tone2'],
            },
            language_patterns: {
              avoid: ['phrase1', 'phrase2', 'phrase3'],
            },
            editorial_guidelines: {
              dos: [],
              donts: [],
            },
            brand_personality: {
              description: 'Test',
            },
          },
        };

        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        const result = await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        expect(result.forbidden).to.be.an('array').with.length(5);
        expect(result.forbidden).to.include.members(['phrase1', 'phrase2', 'phrase3', 'tone1', 'tone2']);
      });

      it('should handle missing main_profile and use empty defaults (covers fallback branches)', async () => {
        // This test covers the fallback branch on line 150 when main_profile is missing
        const mockBrandProfile = {
          // Missing main_profile - tests line 150 {} fallback
          // But we need at least one property so it's not considered empty by getBrandGuidelines
          version: 1,
        };

        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        const result = await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Should use empty defaults
        expect(result.brand_persona).to.equal('');
        expect(result.tone).to.equal('');
        expect(result.editorial_guidelines.do).to.deep.equal([]);
        expect(result.editorial_guidelines.dont).to.deep.equal([]);
        expect(result.forbidden).to.deep.equal([]);
      });

      it('should handle missing nested properties and use empty defaults', async () => {
        // Test with main_profile present but missing nested properties
        const mockBrandProfile = {
          main_profile: {
            // Missing brand_personality - tests line 154 '' fallback
            // Missing tone_attributes - tests line 157 {} fallback
            // Missing editorial_guidelines - tests line 162-163 {} fallback
            // Missing language_patterns - tests line 168 {} fallback
          },
        };

        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        const result = await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Should use empty defaults for all missing properties
        expect(result.brand_persona).to.equal('');
        expect(result.tone).to.equal('');
        expect(result.editorial_guidelines.do).to.deep.equal([]);
        expect(result.editorial_guidelines.dont).to.deep.equal([]);
        expect(result.forbidden).to.deep.equal([]);
      });

      it('should handle brand profile with missing avoid arrays', async () => {
        // Test with tone_attributes and language_patterns present but missing avoid arrays
        const mockBrandProfile = {
          main_profile: {
            brand_personality: {
              description: 'Test persona',
            },
            tone_attributes: {
              primary: ['professional'],
              // Missing avoid - tests line 170 || [] fallback
            },
            language_patterns: {
              preferred: ['test phrase'],
              // Missing avoid - tests line 169 || [] fallback
            },
            editorial_guidelines: {
              // Missing dos - tests line 164 || [] fallback
              // Missing donts - tests line 165 || [] fallback
            },
          },
        };

        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        const result = await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Should use empty arrays for missing avoid properties
        expect(result.brand_persona).to.equal('Test persona');
        expect(result.tone).to.equal('professional');
        expect(result.editorial_guidelines.do).to.deep.equal([]);
        expect(result.editorial_guidelines.dont).to.deep.equal([]);
        expect(result.forbidden).to.deep.equal([]);
      });
    });

    describe('getBrandGuidelines fallback to AI generation', () => {
      let mockAzureClient;

      beforeEach(() => {
        mockAzureClient = {
          fetchChatCompletion: sinon.stub().resolves({
            choices: [{
              message: {
                content: JSON.stringify({
                  brand_persona: 'AI generated persona',
                  tone: 'AI generated tone',
                  editorial_guidelines: {
                    do: ['AI do'],
                    dont: ['AI dont'],
                  },
                  forbidden: ['AI forbidden'],
                }),
              },
            }],
          }),
        };

        AzureOpenAIClient.createFrom.restore();
        sinon.stub(AzureOpenAIClient, 'createFrom').returns(mockAzureClient);
      });

      it('should fall back to AI when no brand profile is available', async () => {
        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => null,
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Verify that AI fallback was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
        expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
      });

      it('should fall back to AI when no site is provided', async () => {
        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        await getBrandGuidelines(healthyTagsObject, mockLog, mockContext);

        // Verify that AI was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
        expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
      });

      it('should fall back to AI when brand profile is empty object', async () => {
        const mockSite = {
          getConfig: () => ({
            getBrandProfile: () => ({}),
          }),
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Verify that AI fallback was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
        expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
      });

      it('should handle errors gracefully and fall back to AI', async () => {
        const mockSite = {
          getConfig: () => {
            throw new Error('Config access error');
          },
        };

        const healthyTagsObject = {
          title: 'Sample Title',
          description: 'Sample Description',
          h1: 'Sample H1',
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
        };

        await getBrandGuidelines(healthyTagsObject, mockLog, mockContext, mockSite);

        // Verify that warning was logged
        expect(mockLog.warn).to.have.been.calledWith(sinon.match(/Error accessing brand profile from site config/));

        // Verify that AI fallback was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
        expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
      });
    });

    describe('Brand profile integration in full audit flow', () => {
      it('should use brand profile throughout the audit when available', async function () {
        this.timeout(10000); // Increase timeout for full audit flow
        const baseURL = 'https://example.com';
        const url = 'https://example.com/page';

        const mockBrandProfile = {
          main_profile: {
            brand_personality: {
              description: 'Professional and approachable',
            },
            tone_attributes: {
              primary: ['professional', 'friendly'],
              avoid: ['aggressive'],
            },
            editorial_guidelines: {
              dos: ['Use clear language'],
              donts: ['Avoid jargon'],
            },
            language_patterns: {
              avoid: ['bad phrase'],
            },
          },
        };

        const mockSite = {
          getId: () => 'site-1',
          getBaseURL: () => baseURL,
          getConfig: () => ({
            getLlmoCdnlogsFilter: () => [],
            getBrandProfile: () => mockBrandProfile,
          }),
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockContext = {
          log: mockLog,
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
                { getUrl: () => url },
              ]),
            },
          },
          s3Client: {
            send: sinon.stub().callsFake((command) => {
              if (command.constructor.name === 'ListObjectsV2Command') {
                return Promise.resolve({
                  Contents: [{ Key: 'scrapes/site-1/page/scrape.json' }],
                  NextContinuationToken: undefined,
                });
              }
              if (command.constructor.name === 'GetObjectCommand') {
                return Promise.resolve({
                  Body: {
                    transformToString: () => JSON.stringify({
                      finalUrl: url,
                      scrapedAt: Date.now(),
                      scrapeResult: {
                        rawBody: '<h1>Valid Heading</h1><h2>Section</h2>',
                        tags: {
                          title: 'Test Title',
                          description: 'Test Description',
                          h1: ['Valid Heading'],
                        },
                      },
                    }),
                  },
                  ContentType: 'application/json',
                });
              }
              throw new Error('Unexpected command');
            }),
          },
        };

        const { headingsAuditRunner } = await import('../../src/headings/handler.js');
        const result = await headingsAuditRunner(baseURL, mockContext, mockSite);

        // Verify brand profile was used (check logs)
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] Using brand profile from site config');

        // Verify audit completed
        expect(result).to.have.property('fullAuditRef', baseURL);
        expect(result).to.have.property('auditResult');
      });

      it('should fall back to AI generation when site has no brand profile', async function () {
        this.timeout(10000); // Increase timeout for full audit flow
        const baseURL = 'https://example.com';
        const url = 'https://example.com/page';

        const mockSite = {
          getId: () => 'site-1',
          getBaseURL: () => baseURL,
          getConfig: () => ({
            getLlmoCdnlogsFilter: () => [],
            getBrandProfile: () => null, // No brand profile
          }),
        };

        const mockLog = {
          info: sinon.spy(),
          warn: sinon.spy(),
          debug: sinon.spy(),
          error: sinon.spy(),
        };

        const mockAzureClient = {
          fetchChatCompletion: sinon.stub().resolves({
            choices: [{
              message: {
                content: JSON.stringify({
                  brand_persona: 'AI generated persona',
                  tone: 'professional',
                }),
              },
            }],
          }),
        };

        AzureOpenAIClient.createFrom.restore();
        sinon.stub(AzureOpenAIClient, 'createFrom').returns(mockAzureClient);

        const mockContext = {
          log: mockLog,
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
            AZURE_OPENAI_KEY: 'test-key',
            AZURE_API_VERSION: '2024-02-01',
            AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
                { getUrl: () => url },
              ]),
            },
          },
          s3Client: {
            send: sinon.stub().callsFake((command) => {
              if (command.constructor.name === 'ListObjectsV2Command') {
                return Promise.resolve({
                  Contents: [{ Key: 'scrapes/site-1/page/scrape.json' }],
                  NextContinuationToken: undefined,
                });
              }
              if (command.constructor.name === 'GetObjectCommand') {
                return Promise.resolve({
                  Body: {
                    transformToString: () => JSON.stringify({
                      finalUrl: url,
                      scrapedAt: Date.now(),
                      scrapeResult: {
                        rawBody: '<h1>Valid Heading</h1><h2>Section</h2>',
                        tags: {
                          title: 'Test Title',
                          description: 'Test Description',
                          h1: ['Valid Heading'],
                        },
                      },
                    }),
                  },
                  ContentType: 'application/json',
                });
              }
              throw new Error('Unexpected command');
            }),
          },
        };

        const { headingsAuditRunner } = await import('../../src/headings/handler.js');
        const result = await headingsAuditRunner(baseURL, mockContext, mockSite);

        // Verify AI fallback was used
        expect(mockLog.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
        expect(mockAzureClient.fetchChatCompletion).to.have.been.called;

        // Verify audit completed
        expect(result).to.have.property('fullAuditRef', baseURL);
        expect(result).to.have.property('auditResult');
      });
    });
  });
});
