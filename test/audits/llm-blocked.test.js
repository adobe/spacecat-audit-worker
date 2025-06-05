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
import nock from 'nock';
import { MockContextBuilder } from '../shared.js';
import { checkLLMBlocked } from '../../src/llm-blocked/handler.js';

use(sinonChai);

describe('LLM Blocked Audit', () => {
  let clock;
  let context;
  let sandbox;
  let mockTopPages;
  let fetchStub;
  let convertToOpportunityStub;
  let syncSuggestionsStub;

  before('setup', () => {
    sandbox = sinon.createSandbox();
    convertToOpportunityStub = sandbox.stub();
    syncSuggestionsStub = sandbox.stub();
  });

  beforeEach('setup', () => {
    clock = sinon.useFakeTimers();
    mockTopPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    // Only stub fetch if it's not already stubbed
    if (!global.fetch.restore) {
      fetchStub = sandbox.stub(global, 'fetch').resolves({
        status: 200,
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
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: () => mockTopPages,
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
  });

  afterEach(() => {
    nock.cleanAll();
    clock.restore();
    sandbox.restore();
  });

  it('should return no blocked URLs when all requests return 200', async () => {
    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(fetchStub.callCount).to.equal(12); // 2 pages × (5 user agents + 1 baseline)

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
      if (url === blockedUrl && opts && opts.headers && opts.headers['User-Agent'] === 'ClaudeBot/1.0') {
        return Promise.resolve({ status: 403 });
      }
      return Promise.resolve({ status: 200 });
    });

    // Act
    const result = await checkLLMBlocked(context, convertToOpportunityStub, syncSuggestionsStub);

    // Assert
    expect(result.auditResult).to.equal(JSON.stringify([{
      url: blockedUrl,
      blockedAgents: [{ status: 403, agent: 'ClaudeBot/1.0' }],
    }]));
    expect(fetchStub.callCount).to.equal(12); // 2 pages × (5 user agents + 1 baseline)
    expect(fetchStub.calledWith(blockedUrl, { headers: { 'User-Agent': 'ClaudeBot/1.0' } })).to.be.true;
    expect(fetchStub.calledWith(blockedUrl)).to.be.true;
    expect(convertToOpportunityStub).to.have.been.calledOnce;
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });
});
