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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import esmock from 'esmock';
import healthCheckHandler, {
  requestScrape,
  analyzeScrapeResult,
  checkAhrefsTopPagesImport,
  checkEffectiveUrlNoRedirect,
  getEffectiveBaseURL,
} from '../../src/health-check/handler.js';
import {
  checkSpacecatUserAgentAccess,
  analyzeBlockingResponse,
  analyzeBlockingResponseWithKeywords,
  SPACECAT_USER_AGENT,
} from '../../src/health-check/checks/user-agent-access.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('Health Check Audit', () => {
  let context;
  let mockAzureOpenAIClient;

  beforeEach('setup', () => {
    mockAzureOpenAIClient = {
      fetchChatCompletion: sandbox.stub().resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: false,
              confidence: 0.95,
              reason: 'Access appears normal',
              indicators: [],
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
          AZURE_OPENAI_KEY: 'test-api-key',
          AZURE_API_VERSION: '2024-02-01',
          AZURE_COMPLETION_DEPLOYMENT: 'gpt-4o-mini',
        },
      })
      .build();
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('analyzeBlockingResponseWithKeywords', () => {
    it('should detect blocking based on blocking status codes', () => {
      [401, 403, 429].forEach((statusCode) => {
        const result = analyzeBlockingResponseWithKeywords(statusCode, 'Some content');
        expect(result.isBlocked).to.be.true;
        expect(result.reason).to.include(`HTTP status code ${statusCode}`);
      });
    });

    it('should detect blocking when multiple content indicators are present', () => {
      const blockedContent = 'Access Denied - Please verify you are not a robot';
      const result = analyzeBlockingResponseWithKeywords(200, blockedContent);

      expect(result.isBlocked).to.be.true;
      expect(result.reason).to.be.a('string');
    });

    it('should not flag as blocked with single content indicator', () => {
      const normalContent = 'Welcome to our site. Cloudflare powers our CDN.';
      const result = analyzeBlockingResponseWithKeywords(200, normalContent);

      expect(result.isBlocked).to.be.false;
    });

    it('should not flag normal 200 response as blocked', () => {
      const result = analyzeBlockingResponseWithKeywords(200, '<html>Normal page content</html>');

      expect(result.isBlocked).to.be.false;
      expect(result.reason).to.equal('No blocking indicators detected');
    });
  });

  describe('analyzeBlockingResponse', () => {
    // Helper to create mocked analyzeBlockingResponse with LLM
    async function createMockedAnalyze() {
      return esmock(
        '../../src/health-check/checks/user-agent-access.js',
        {
          '@adobe/spacecat-shared-gpt-client': {
            AzureOpenAIClient: function AzureOpenAIClient() {
              return mockAzureOpenAIClient;
            },
          },
        },
      );
    }

    it('should detect blocking when LLM confirms blocking', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: true,
              reason: 'Access denied page detected',
            }),
          },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(403, 'Access Denied', context);

      expect(result.isBlocked).to.be.true;
      expect(result.reason).to.equal('Access denied page detected');
    });

    it('should detect blocking via LLM even with 200 status code', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: true,
              reason: 'CAPTCHA challenge detected',
            }),
          },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, '<html>Please verify you are human</html>', context);

      expect(result.isBlocked).to.be.true;
      expect(result.reason).to.equal('CAPTCHA challenge detected');
    });

    it('should return not blocked for normal content', async () => {
      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, '<html><body>Normal website content</body></html>', context);

      expect(result.isBlocked).to.be.false;
      expect(result.reason).to.equal('Access appears normal');
    });

    it('should fall back to keyword analysis when LLM config is missing', async () => {
      const contextWithoutLLM = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({ env: {} })
        .build();

      const result = await analyzeBlockingResponse(403, 'Forbidden', contextWithoutLLM);

      expect(result.isBlocked).to.be.true;
      expect(contextWithoutLLM.log.warn).to.have.been.called;
    });

    it('should fall back to keyword analysis when LLM throws error', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.rejects(new Error('LLM service unavailable'));

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(403, 'Forbidden - Access Denied', context);

      expect(result.isBlocked).to.be.true;
      expect(context.log.error).to.have.been.called;
    });

    it('should fall back to keyword analysis when LLM returns empty response', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({ choices: [] });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, 'Some content', context);

      expect(result.isBlocked).to.be.false;
    });

    it('should truncate very long content before sending to LLM', async () => {
      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();

      const longContent = 'x'.repeat(20000);
      await mockedAnalyze(200, longContent, context);

      const callArgs = mockAzureOpenAIClient.fetchChatCompletion.firstCall.args[0];
      expect(callArgs).to.include('[truncated]');
    });

    it('should fall back to keyword analysis when LLM returns invalid isBlocked value', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: 'not-a-boolean',
              reason: 'Test',
            }),
          },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, 'Normal content', context);

      expect(result.isBlocked).to.be.false;
    });

    it('should use default reason when LLM returns empty reason', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ isBlocked: false, reason: '' }),
          },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, 'Normal content', context);

      expect(result.isBlocked).to.be.false;
      expect(result.reason).to.equal('Access appears normal');
    });

    it('should use default reason when blocked and reason is whitespace only', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({ isBlocked: true, reason: '   ' }),
          },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(403, 'Blocked content', context);

      expect(result.isBlocked).to.be.true;
      expect(result.reason).to.equal('Access blocked');
    });

    it('should handle undefined env gracefully', async () => {
      const contextWithoutEnv = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({ env: undefined })
        .build();

      const result = await analyzeBlockingResponse(403, 'Forbidden', contextWithoutEnv);

      expect(result.isBlocked).to.be.true;
    });

    it('should fall back to keyword analysis when LLM returns malformed JSON', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: { content: 'not valid json {{{' },
        }],
      });

      const { analyzeBlockingResponse: mockedAnalyze } = await createMockedAnalyze();
      const result = await mockedAnalyze(200, 'Normal content', context);

      expect(result.isBlocked).to.be.false;
    });
  });

  describe('checkSpacecatUserAgentAccess', () => {
    // Helper to create mocked checkSpacecatUserAgentAccess with LLM
    async function createMockedCheck() {
      return esmock(
        '../../src/health-check/checks/user-agent-access.js',
        {
          '@adobe/spacecat-shared-gpt-client': {
            AzureOpenAIClient: function AzureOpenAIClient() {
              return mockAzureOpenAIClient;
            },
          },
        },
      );
    }

    it('should return not blocked for accessible site', async () => {
      nock('https://example.com')
        .get('/')
        .matchHeader('User-Agent', SPACECAT_USER_AGENT)
        .reply(200, '<html>Normal page</html>');

      const { checkSpacecatUserAgentAccess: mockedCheck } = await createMockedCheck();
      const result = await mockedCheck('https://example.com', context);

      expect(result.isBlocked).to.be.false;
      expect(result.reason).to.equal('Access appears normal');
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should detect blocked site', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: true,
              reason: 'Firewall block detected',
            }),
          },
        }],
      });

      nock('https://blocked-site.com')
        .get('/')
        .matchHeader('User-Agent', SPACECAT_USER_AGENT)
        .reply(403, 'Forbidden - Firewall Block');

      const { checkSpacecatUserAgentAccess: mockedCheck } = await createMockedCheck();
      const result = await mockedCheck('https://blocked-site.com', context);

      expect(result.isBlocked).to.be.true;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should add https:// scheme if missing', async () => {
      nock('https://example.com')
        .get('/')
        .reply(200, '<html>Normal page</html>');

      const { checkSpacecatUserAgentAccess: mockedCheck } = await createMockedCheck();
      const result = await mockedCheck('example.com', context);

      expect(result.isBlocked).to.be.false;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should handle network errors gracefully', async () => {
      nock('https://unreachable-site.com')
        .get('/')
        .replyWithError('Connection refused');

      const result = await checkSpacecatUserAgentAccess('https://unreachable-site.com', context);

      expect(result.isBlocked).to.be.false;
      expect(result.reason).to.include('Connection refused');
      expect(context.log.error).to.have.been.called;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should detect CAPTCHA pages via LLM', async () => {
      mockAzureOpenAIClient.fetchChatCompletion.resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              isBlocked: true,
              reason: 'CAPTCHA challenge page',
            }),
          },
        }],
      });

      nock('https://captcha-site.com')
        .get('/')
        .reply(200, '<html><body><h1>Security Check</h1></body></html>');

      const { checkSpacecatUserAgentAccess: mockedCheck } = await createMockedCheck();
      const result = await mockedCheck('https://captcha-site.com', context);

      expect(result.isBlocked).to.be.true;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });
  });

  describe('getEffectiveBaseURL', () => {
    it('returns overrideBaseURL when valid', () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getFetchConfig: () => ({
            overrideBaseURL: 'https://override.example.com',
          }),
        }),
      };

      const result = getEffectiveBaseURL(site);
      expect(result).to.equal('https://override.example.com');
    });

    it('falls back to baseURL when overrideBaseURL is invalid', () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getFetchConfig: () => ({
            overrideBaseURL: 'not-a-valid-url',
          }),
        }),
      };

      const result = getEffectiveBaseURL(site);
      expect(result).to.equal('https://example.com');
    });
  });

  describe('checkAhrefsTopPagesImport', () => {
    let ahrefsContext;

    beforeEach(() => {
      ahrefsContext = {
        site: {
          getId: () => 'site-123',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub(),
          },
        },
        log: context.log,
      };
    });

    it('returns ok when top-pages import is within freshness window', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [{ getImportedAt: () => '2026-02-03T10:00:00.000Z' }],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('ok');
      expect(result).to.not.have.property('latestImportedAt');
      expect(result.freshnessDays).to.equal(8);
      expect(result.reason).to.be.null;
      expect(ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledOnce;
      expect(ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-123',
        'ahrefs',
        'global',
      );
    });

    it('returns error when top-pages import is stale', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [{ getImportedAt: () => '2026-01-20T10:00:00.000Z' }],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('error');
      expect(result).to.not.have.property('latestImportedAt');
      expect(result.reason).to.include('last 8 days');
    });

    it('returns stale result when all valid records are older than freshness window', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [
          { getImportedAt: () => '2026-01-20T10:00:00.000Z' },
          { getImportedAt: () => '2026-01-15T10:00:00.000Z' },
        ],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('error');
      expect(result.reason).to.include('last 8 days');
    });

    it('returns error when no top-pages records exist', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext);

      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('No Ahrefs top-pages import records found');
    });

    it('returns error when SiteTopPage data access is unavailable', async () => {
      const result = await checkAhrefsTopPagesImport({
        site: ahrefsContext.site,
        dataAccess: {},
        log: ahrefsContext.log,
      });

      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('SiteTopPage data access is unavailable');
    });

    it('returns error when top-pages record has no importedAt', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [{ getImportedAt: () => null }],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('No valid Ahrefs top-pages importedAt timestamp found');
    });

    it('returns error when top-pages record has invalid importedAt', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [{ getImportedAt: () => 'not-a-date' }],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('No valid Ahrefs top-pages importedAt timestamp found');
    });

    it('returns ok when a valid fresh timestamp exists in unsorted records', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [
          { getImportedAt: () => '2026-01-20T10:00:00.000Z' },
          { getImportedAt: () => '2026-02-09T10:00:00.000Z' },
          { getImportedAt: () => null },
        ],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('ok');
      expect(ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledOnce;
    });

    it('returns ok when any valid record is within freshness window', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
        data: [
          { getImportedAt: () => '2026-02-03T10:00:00.000Z' },
          { getImportedAt: () => '2026-02-09T10:00:00.000Z' },
        ],
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('ok');
      expect(result).to.not.have.property('latestImportedAt');
    });

    it('supports array page result shape from data access', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getImportedAt: () => '2026-02-09T10:00:00.000Z' },
      ]);

      const result = await checkAhrefsTopPagesImport(ahrefsContext, new Date('2026-02-10T12:00:00.000Z'));

      expect(result.status).to.equal('ok');
    });

    it('handles object page results without data field', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves({
      });

      const result = await checkAhrefsTopPagesImport(ahrefsContext);

      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('No Ahrefs top-pages import records found');
    });

    it('returns error when data access throws', async () => {
      ahrefsContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(new Error('DB unavailable'));

      const result = await checkAhrefsTopPagesImport(ahrefsContext);

      expect(result.status).to.equal('error');
      expect(result.reason).to.include('Ahrefs check failed: DB unavailable');
      expect(ahrefsContext.log.error).to.have.been.called;
    });
  });

  describe('checkEffectiveUrlNoRedirect', () => {
    it('returns ok when effective URL responds without redirect', async () => {
      nock('https://example.com')
        .get('/')
        .reply(200, 'ok');

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({}) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('ok');
      expect(result.statusCode).to.equal(200);
      expect(result.reason).to.be.null;
    });

    it('returns error when effective URL responds with 3xx', async () => {
      nock('https://example.com')
        .get('/')
        .reply(301, undefined, { location: 'https://www.example.com' });

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({}) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('error');
      expect(result.statusCode).to.equal(301);
      expect(result.reason).to.include('Received redirect status 301');
    });

    it('returns error message without target when redirect has no location header', async () => {
      nock('https://example.com')
        .get('/')
        .reply(302);

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({}) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('error');
      expect(result.statusCode).to.equal(302);
      expect(result.reason).to.equal('Received redirect status 302');
    });

    it('returns error when effective URL responds with non-redirect non-success status', async () => {
      nock('https://example.com')
        .get('/')
        .reply(500, 'error');

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({}) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('error');
      expect(result.statusCode).to.equal(500);
      expect(result.reason).to.include('Received non-success status 500 without redirect');
    });

    it('uses overrideBaseURL as effective URL when present', async () => {
      nock('https://override.example.com')
        .get('/')
        .reply(200, 'ok');

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({ overrideBaseURL: 'https://override.example.com' }) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('ok');
      expect(result.checkedUrl).to.equal('https://override.example.com');
    });

    it('returns error when request fails', async () => {
      nock('https://example.com')
        .get('/')
        .replyWithError('Connection failed');

      const result = await checkEffectiveUrlNoRedirect({
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getFetchConfig: () => ({}) }),
        },
        log: context.log,
      });

      expect(result.status).to.equal('error');
      expect(result.statusCode).to.be.null;
      expect(result.reason).to.include('Request failed: Connection failed');
      expect(context.log.error).to.have.been.called;
    });
  });

  describe('healthCheckHandler', () => {
    it('should export a valid audit handler', () => {
      expect(healthCheckHandler).to.be.an('object');
      expect(healthCheckHandler.run).to.be.a('function');
    });
  });

  describe('requestScrape', () => {
    it('should return correct structure for scrape request', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      };

      const stepContext = {
        site,
        finalUrl: 'https://example.com',
        log: context.log,
      };

      const result = await requestScrape(stepContext);

      expect(result.auditResult).to.deep.equal({ status: 'scraping' });
      expect(result.fullAuditRef).to.equal('https://example.com');
      expect(result.urls).to.deep.equal([{ url: 'https://example.com' }]);
      expect(result.siteId).to.equal('site-123');
      expect(result.processingType).to.equal('default');
    });
  });

  describe('analyzeScrapeResult', () => {
    let mockScrapeClient;
    let mockS3Client;
    let stepContext;

    beforeEach(() => {
      mockScrapeClient = {
        getScrapeJobUrlResults: sandbox.stub(),
      };

      mockS3Client = {};

      stepContext = {
        site: {
          getBaseURL: () => 'https://example.com',
          getId: () => 'site-123',
        },
        audit: {
          getFullAuditRef: () => 'https://example.com',
        },
        auditContext: {
          scrapeJobId: 'job-456',
        },
        log: context.log,
        s3Client: mockS3Client,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
          AZURE_OPENAI_KEY: 'test-api-key',
          AZURE_API_VERSION: '2024-02-01',
          AZURE_COMPLETION_DEPLOYMENT: 'gpt-4o-mini',
        },
        dataAccess: {
          LatestAudit: {
            findBySiteIdAndAuditType: sandbox.stub().resolves(null),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves({
              data: [{
                getImportedAt: () => new Date().toISOString(),
              }],
              cursor: null,
            }),
          },
        },
        sqs: {},
      };

      nock('https://example.com')
        .persist()
        .get('/')
        .reply(200, 'ok');
    });

    it('should return error when no scrape results found', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('error');
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.be.null;
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.equal('No scrape results received from scraper');
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.be.null;
      expect(result.auditResult.ahrefsTopPagesImport.status).to.equal('ok');
      expect(result.auditResult.effectiveUrlNoRedirect.status).to.equal('ok');
    });

    it('should still return all three checks when scrape client throws', async () => {
      mockScrapeClient.getScrapeJobUrlResults.rejects(new Error('Scrape service unavailable'));

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('error');
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.include('Scrape service unavailable');
      expect(result.auditResult.ahrefsTopPagesImport.status).to.equal('ok');
      expect(result.auditResult.effectiveUrlNoRedirect.status).to.equal('ok');
    });

    it('should return error when scrape failed at network level', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'FAILED',
        reason: 'Connection timeout after 30s',
        path: null,
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('error');
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.equal('Connection timeout after 30s');
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.be.null;
    });

    it('should return error when S3 retrieval fails', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves(null),
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('error');
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.equal('Could not retrieve scrape data from S3');
    });

    it('should return ok status for successful non-blocked scrape', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves({
              scrapeResult: {
                scrapedAt: 1733311800000,
                status: 200,
                rawBody: '<html>Normal page content</html>',
              },
            }),
          },
          '../../src/health-check/checks/user-agent-access.js': {
            analyzeBlockingResponse: sandbox.stub().resolves({
              isBlocked: false,
              reason: 'Access appears normal',
            }),
            SPACECAT_USER_AGENT: 'Spacecat/1.0',
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('ok');
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.equal(200);
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.be.null;
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.equal(1733311800000);
      expect(result.auditResult.ahrefsTopPagesImport.status).to.equal('ok');
      expect(result.auditResult.effectiveUrlNoRedirect.status).to.equal('ok');
    });

    it('should return blocked status when site is blocking', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves({
              scrapeResult: {
                scrapedAt: 1733311800000,
                status: 403,
                rawBody: 'Access Denied',
              },
            }),
          },
          '../../src/health-check/checks/user-agent-access.js': {
            analyzeBlockingResponse: sandbox.stub().resolves({
              isBlocked: true,
              reason: 'HTTP 403 Forbidden - Access denied',
            }),
            SPACECAT_USER_AGENT: 'Spacecat/1.0',
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('blocked');
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.equal(403);
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.equal('HTTP 403 Forbidden - Access denied');
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.equal(1733311800000);
    });

    it('should return cached result when scrapedAt matches previous audit', async () => {
      const cachedAuditResult = {
        spacecatUserAgentAccess: {
          status: 'ok',
          statusCode: 200,
          reason: null,
          userAgent: 'Spacecat/1.0',
          scrapedAt: 1733311800000,
        },
      };

      stepContext.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves({
        getAuditResult: () => cachedAuditResult,
        getFullAuditRef: () => 'https://example.com',
      });

      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves({
              scrapeResult: {
                scrapedAt: 1733311800000, // Same as cached
                status: 200,
                rawBody: '<html>Content</html>',
              },
            }),
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      // Should return the cached result without re-analyzing
      expect(result.auditResult.spacecatUserAgentAccess).to.deep.equal(cachedAuditResult.spacecatUserAgentAccess);
      expect(result.auditResult.ahrefsTopPagesImport.status).to.equal('ok');
      expect(result.auditResult.effectiveUrlNoRedirect.status).to.equal('ok');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should re-analyze when scrapedAt differs from previous audit', async () => {
      const cachedAuditResult = {
        spacecatUserAgentAccess: {
          status: 'ok',
          statusCode: 200,
          reason: null,
          userAgent: 'Spacecat/1.0',
          scrapedAt: 1733311800000, // Old timestamp
        },
      };

      stepContext.dataAccess.LatestAudit.findBySiteIdAndAuditType.resolves({
        getAuditResult: () => cachedAuditResult,
        getFullAuditRef: () => 'https://example.com',
      });

      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves({
              scrapeResult: {
                scrapedAt: 1733398200000, // Different timestamp
                status: 200,
                rawBody: '<html>New content</html>',
              },
            }),
          },
          '../../src/health-check/checks/user-agent-access.js': {
            analyzeBlockingResponse: sandbox.stub().resolves({
              isBlocked: false,
              reason: 'Access appears normal',
            }),
            SPACECAT_USER_AGENT: 'Spacecat/1.0',
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      // Should have new scrapedAt, not cached one
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.equal(1733398200000);
      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('ok');
    });

    it('should use fallback error message when scrape fails without reason', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'FAILED',
        reason: null, // No reason provided
        path: null,
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('error');
      expect(result.auditResult.spacecatUserAgentAccess.reason).to.equal('Scrape failed with status: FAILED');
    });

    it('should handle missing scrapeResult fields gracefully', async () => {
      mockScrapeClient.getScrapeJobUrlResults.resolves([{
        url: 'https://example.com',
        status: 'COMPLETE',
        path: 'scrapes/site-123/scrape.json',
      }]);

      const { analyzeScrapeResult: mockedAnalyze } = await esmock(
        '../../src/health-check/handler.js',
        {
          '@adobe/spacecat-shared-scrape-client': {
            ScrapeClient: {
              createFrom: () => mockScrapeClient,
            },
          },
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves({
              scrapeResult: {
                // Missing scrapedAt, status, and rawBody
              },
            }),
          },
          '../../src/health-check/checks/user-agent-access.js': {
            analyzeBlockingResponse: sandbox.stub().resolves({
              isBlocked: false,
              reason: 'Access appears normal',
            }),
            SPACECAT_USER_AGENT: 'Spacecat/1.0',
          },
        },
      );

      const result = await mockedAnalyze(stepContext);

      expect(result.auditResult.spacecatUserAgentAccess.status).to.equal('ok');
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.be.null;
      expect(result.auditResult.spacecatUserAgentAccess.scrapedAt).to.be.null;
    });
  });
});
