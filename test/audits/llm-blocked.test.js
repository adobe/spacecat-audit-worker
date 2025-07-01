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
import { MockContextBuilder } from '../shared.js';
import { checkLLMBlocked, importTopPages } from '../../src/llm-blocked/handler.js';
import { createOpportunityData } from '../../src/llm-blocked/opportunity-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);

describe('LLM Blocked Audit', () => {
  let clock;
  let context;
  let sandbox;
  let mockTopPages;
  let fetchStub;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  function handleRobotsFetch() {
    return Promise.resolve({
      status: 200,
      text: () => Promise.resolve('User-Agent: *\nAllow: /'),
    });
  }

  beforeEach('setup', () => {
    clock = sinon.useFakeTimers();
    mockTopPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    // Only stub fetch if it's not already stubbed
    if (!global.fetch.restore) {
      fetchStub = sandbox.stub(global, 'fetch').callsFake((url) => {
        if (url.includes('robots.txt')) {
          return handleRobotsFetch();
        }
        return Promise.resolve({ status: 200 });
      });
    } else {
      fetchStub = global.fetch;
    }

    context = new MockContextBuilder()
      .withOverrides({
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
        },
        finalUrl: 'https://example.com',
        audit: {
          getId: () => 'test-audit-id',
        },
        log: {
          info: sandbox.stub(),
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
      })
      .withSandbox(sandbox).build();

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves(mockTopPages);
  });

  afterEach(() => {
    nock.cleanAll();
    clock.restore();
    sandbox.restore();
  });

  it('should return no blocked URLs when all requests return 200', async () => {
    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(fetchStub.callCount).to.equal(15); // 2 pages × (6 user agents + 1 baseline) + 1 robots

    // Verify each page was checked with each user agent
    const userAgents = [
      'ClaudeBot/1.0',
      'Perplexity-User/1.0',
      'PerplexityBot/1.0',
      'ChatGPT-User/1.0',
      'GPTBot/1.0',
    ];

    mockTopPages.forEach((page) => {
      // Check baseline request (no user agent)
      expect(fetchStub.calledWith(page.getUrl())).to.be.true;

      // Check each user agent request
      userAgents.forEach((agent) => {
        expect(fetchStub.calledWith(page.getUrl(), {
          headers: { 'User-Agent': agent },
        })).to.be.true;
      });
    });
  });

  it('should return blocked URLs when a user agent is blocked', async () => {
    // Arrange: page1 returns 403 for ClaudeBot/1.0, 200 for all others and baseline
    const blockedUrl = 'https://example.com/page1';

    // Set up fetchStub to return 403 for ClaudeBot/1.0 on page1, 200 otherwise
    fetchStub.callsFake((url, opts) => {
      if (url.includes('robots.txt')) {
        return handleRobotsFetch();
      }
      if (url === blockedUrl && opts && opts.headers && opts.headers['User-Agent'] === 'ClaudeBot/1.0') {
        return Promise.resolve({ status: 403 });
      }
      return Promise.resolve({ status: 200 });
    });

    const expectedSuggestionsData = [
      {
        affectedUrls: [
          {
            status: 403,
            url: 'https://example.com/page1',
          },
        ],
        agent: 'ClaudeBot/1.0',
        rationale: 'Unblock ClaudeBot/1.0 to allow Anthropic’s Claude to access your site when assisting users.',
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(expectedSuggestionsData);

    // Act
    const result = await checkLLMBlocked(context);

    // Assert
    expect(result.auditResult).to.equal(JSON.stringify([{
      url: blockedUrl,
      blockedAgents: [{ status: 403, agent: 'ClaudeBot/1.0' }],
    }]));
    expect(fetchStub.callCount).to.equal(15); // 2 pages × (6 user agents + 1 baseline) + 1 robots
    expect(fetchStub.calledWith(blockedUrl, { headers: { 'User-Agent': 'ClaudeBot/1.0' } })).to.be.true;
    expect(fetchStub.calledWith(blockedUrl)).to.be.true;
  });

  it('should return blocked URLs when a page is blocked by robots.txt', async () => {
    // Arrange: page1 returns 200 for all user agents but is blocked by robots.txt
    const blockedUrl = 'https://example.com/page1';

    // Set up fetchStub to return 200 for all user agents but blocked by robots.txt
    fetchStub.callsFake((url) => {
      if (url.includes('robots.txt')) {
        return {
          status: 200,
          text: () => Promise.resolve('User-Agent: ClaudeBot/1.0\nDisallow: /page1'),
        };
      }
      return Promise.resolve({ status: 200 });
    });

    const expectedSuggestionsData = [
      {
        affectedUrls: [
          {
            status: 'Blocked by robots.txt',
            url: 'https://example.com/page1',
          },
        ],
        agent: 'ClaudeBot/1.0',
        rationale: 'Unblock ClaudeBot/1.0 to allow Anthropic’s Claude to access your site when assisting users.',
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(expectedSuggestionsData);

    // Act
    const result = await checkLLMBlocked(context);

    // Assert
    expect(result.auditResult).to.equal(JSON.stringify([{
      url: blockedUrl,
      blockedAgents: [{ agent: 'ClaudeBot/1.0', status: 'Blocked by robots.txt' }],
    }]));
    expect(fetchStub.callCount).to.equal(15); // 2 pages × (6 user agents + 1 baseline) + 1 robots
    expect(fetchStub.calledWith(blockedUrl, { headers: { 'User-Agent': 'ClaudeBot/1.0' } })).to.be.true;
    expect(fetchStub.calledWith(blockedUrl)).to.be.true;
  });

  it('should return the expected data structure if multiple issues are detected', async () => {
    // Set up fetchStub
    fetchStub.callsFake((url, opts) => {
      if (url.includes('robots.txt')) {
        return {
          status: 200,
          text: () => Promise.resolve('User-Agent: Perplexity-User/1.0\nDisallow: /'),
        };
      }
      if (url === 'https://example.com/page1' && opts && opts.headers && opts.headers['User-Agent'] === 'ClaudeBot/1.0') {
        return Promise.resolve({ status: 403 });
      }
      if (url === 'https://example.com/page2' && opts && opts.headers && opts.headers['User-Agent'] === 'Perplexity-User/1.0') {
        return Promise.resolve({ status: 403 });
      }
      return Promise.resolve({ status: 200 });
    });

    const expectedSuggestionsData = [
      {
        affectedUrls: [
          {
            status: 'Blocked by robots.txt',
            url: 'https://example.com/page1',
          },
        ],
        agent: 'ClaudeBot/1.0',
        rationale: 'Unblock ClaudeBot/1.0 to allow Anthropic’s Claude to access your site when assisting users.',
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(expectedSuggestionsData);

    // Act
    const result = await checkLLMBlocked(context);

    // Assert
    expect(result.auditResult).to.equal(JSON.stringify([{
      url: 'https://example.com/page1',
      blockedAgents: [{ status: 403, agent: 'ClaudeBot/1.0' }, { agent: 'Perplexity-User/1.0', status: 'Blocked by robots.txt' }],
    }, {
      url: 'https://example.com/page2',
      blockedAgents: [{ status: 403, agent: 'Perplexity-User/1.0' }, { agent: 'Perplexity-User/1.0', status: 'Blocked by robots.txt' }],
    }]));
  });

  it('should warn if robots fetching fails', async () => {
    fetchStub.callsFake((url) => {
      if (url.includes('robots.txt')) {
        return {
          status: 500,
        };
      }
      return Promise.resolve({ status: 200 });
    });

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(fetchStub.callCount).to.equal(15); // 2 pages × (6 user agents + 1 baseline) + 1 robots

    expect(context.log.warn).to.have.been.calledWith('No robots.txt found. Skipping robots.txt check.');
  });

  it('should throw an error when no top pages are returned', async () => {
    // Arrange: override context to return empty top pages array
    const contextWithNoPages = new MockContextBuilder()
      .withOverrides({
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: () => [], // Empty array - no top pages
          },
        },
        finalUrl: 'https://example.com',
        audit: {
          getId: () => 'test-audit-id',
        },
        log: {
          info: sandbox.stub(),
          error: sandbox.stub(),
        },
      })
      .withSandbox(sandbox).build();

    // Act & Assert
    await expect(checkLLMBlocked(contextWithNoPages)).to.be.rejectedWith('No top pages found for site');
  });

  it('should return correct data structure from importTopPages', async () => {
    // Act
    const result = await importTopPages(context);

    // Assert
    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'test-site-id',
      auditResult: { status: 'Importing Pages', finalUrl: 'https://example.com' },
      fullAuditRef: 'llm-blocked::https://example.com',
      finalUrl: 'https://example.com',
    });

    // Verify that log.info was called
    expect(context.log.info).to.have.been.calledWith('Importing top pages for https://example.com');
  });

  it('should return expected opportunity data from createOpportunityData', () => {
    // Act
    const result = createOpportunityData();

    // Assert
    expect(result).to.deep.equal({
      origin: 'AUTOMATION',
      title: 'Blocked AI agent bots',
      description: 'Several URLs have been detected that return a different HTTP status code if accessed by a LLM AI bot user agent.',
      guidance: {
        steps: [
          'Check each URL in the suggestions and ensure that AI user agents are not blocked at the CDN level.',
        ],
      },
      tags: ['llm'],
    });
  });
});
