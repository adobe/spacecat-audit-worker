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
  let context;
  let sandbox;
  let mockTopPages;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach('setup', () => {
    mockTopPages = [
      { getUrl: () => 'https://example.com/page1' },
      { getUrl: () => 'https://example.com/page2' },
    ];

    context = new MockContextBuilder()
      .withOverrides({
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
        },
        finalUrl: 'example.com',
        audit: {
          getId: () => 'test-audit-id',
        },
        log: {
          debug: sandbox.stub(),
          info: sandbox.stub(),
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
      })
      .withSandbox(sandbox).build();

    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves(mockTopPages);
    context.dataAccess.Opportunity.allBySiteIdAndStatus = sinon.stub().resolves([]);
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('should return no blocked URLs when robots txt allows all', async () => {
    // Mock robots.txt
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: *\nAllow: /');

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(nock.pendingMocks()).to.have.lengthOf(0, 'not all requests were made');
  });

  it('should return blocked URLs when a page is blocked by robots.txt', async () => {
    // Mock robots.txt that blocks page1 for ClaudeBot/1.0
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: ClaudeBot/1.0\nDisallow: /page1\n\nUser-Agent: *\nAllow: /');

    const expectedSuggestionsData = [
      {
        agent: 'ClaudeBot/1.0',
        rationale: 'Unblock ClaudeBot/1.0 to allow Anthropic’s Claude to access your site when assisting users.',
        affectedUrls: [
          {
            url: 'https://example.com/page1',
            line: 2,
          },
        ],
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(expectedSuggestionsData);

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal(JSON.stringify(expectedSuggestionsData));
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should not return blocked URLs when a page is blocked for all agents', async () => {
    // Mock robots.txt that blocks page1 for ClaudeBot/1.0
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: *\nDisallow: /page1\n');

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should warn if robots fetching fails', async () => {
    // Mock robots.txt to throw a network error
    nock('https://example.com')
      .get('/robots.txt')
      .replyWithError('Network error');

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal('[]');
    expect(context.log.warn).to.have.been.calledWith('No robots.txt found. Aborting robots.txt check.');
    expect(nock.pendingMocks()).to.have.lengthOf(0);
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
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should return correct data structure from importTopPages', async () => {
    // Act
    const result = await importTopPages(context);

    // Assert
    expect(result).to.deep.equal({
      type: 'top-pages',
      siteId: 'test-site-id',
      auditResult: { status: 'Importing Pages', finalUrl: 'example.com' },
      fullAuditRef: 'llm-blocked::example.com',
      finalUrl: 'example.com',
    });

    // Verify that log.info was called
    expect(context.log.info).to.have.been.calledWith('Importing top pages for example.com');
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should return expected opportunity data from createOpportunityData', () => {
    // Act
    const result = createOpportunityData();

    // Assert
    expect(result).to.deep.equal({
      origin: 'AUTOMATION',
      title: 'Blocked AI agent bots',
      description: 'Several URLs are blocked from being accessed by LLM user agents.',
      guidance: {
        steps: [
          'Check each URL in the suggestions and ensure that AI user agents are not blocked in robots.txt',
        ],
      },
      tags: ['llm', 'isElmo'],
    });
  });
});
