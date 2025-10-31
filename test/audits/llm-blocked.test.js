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

    const expectedResultsMap = {
      '2': {
        lineNumber: 2,
        robotsTxtHash: '2f293650',
        items: [
          {
            url: 'https://example.com/page1',
            agent: 'ClaudeBot/1.0',
          },
        ],
      },
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves([]);

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal(JSON.stringify(expectedResultsMap));
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should handle many blocked URLs', async () => {
    context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo = sinon.stub().resolves([
      { getUrl: () => 'https://example.com/page1/foo' },
      { getUrl: () => 'https://example.com/page1/bar' },
      { getUrl: () => 'https://example.com/page2' },
    ]);

    // Mock robots.txt that blocks page1 for ClaudeBot/1.0
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: ClaudeBot/1.0\nDisallow: /page1/*\nDisallow: /page2\n\nUser-Agent: *\nAllow: /');

    const expectedResultsMap = {
      '2': {
        lineNumber: 2,
        robotsTxtHash: '97def5ec',
        items: [
          {
            url: 'https://example.com/page1/foo',
            agent: 'ClaudeBot/1.0',
          },
          {
            url: 'https://example.com/page1/bar',
            agent: 'ClaudeBot/1.0',
          },
        ],
      },
      '3': {
        lineNumber: 3,
        robotsTxtHash: '97def5ec',
        items: [
          {
            url: 'https://example.com/page2',
            agent: 'ClaudeBot/1.0',
          },
        ],
      },
    };

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves([]);

    const result = await checkLLMBlocked(context);

    expect(result.auditResult).to.equal(JSON.stringify(expectedResultsMap));
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
    expect(context.log.debug).to.have.been.calledWith('Importing top pages for example.com');
    expect(nock.pendingMocks()).to.have.lengthOf(0);
  });

  it('should return expected opportunity data from createOpportunityData', () => {
    // Arrange
    const mockData = {
      fullRobots: 'User-Agent: *\nDisallow: /',
      numProcessedUrls: 10,
    };

    // Act
    const result = createOpportunityData(mockData);

    // Assert
    expect(result).to.deep.equal({
      origin: 'AUTOMATION',
      title: 'Robots.txt disallowing AI crawlers from accessing your site',
      description: 'Several URLs are disallowed from being accessed by LLM user agents.',
      guidance: {
        steps: [
          'Check each listed line number of robots.txt whether the URLs blocked by the statement are intentionally blocked.',
          'If the URLs are not intentionally blocked, update the line of robots txt',
          'If the URLs are intentionally blocked, ignore the suggestion.',
        ],
      },
      tags: ['llm', 'isElmo'],
      data: {
        fullRobots: 'User-Agent: *\nDisallow: /',
        numProcessedUrls: 10,
      },
    });
  });

  it('should not add new suggestions when existing suggestions have same robots.txt hash', async () => {
    // Mock robots.txt that blocks page1 for ClaudeBot/1.0
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: ClaudeBot/1.0\nDisallow: /page1\n\nUser-Agent: *\nAllow: /');

    const expectedResultsMap = {
      '2': {
        lineNumber: 2,
        robotsTxtHash: '2f293650',
        items: [
          {
            url: 'https://example.com/page1',
            agent: 'ClaudeBot/1.0',
          },
        ],
      },
    };

    // Mock existing suggestions with the same robots.txt hash
    const existingSuggestions = [
      {
        getData: () => ({
          lineNumber: 2,
          items: [
            {
              url: 'https://example.com/page1',
              agent: 'ClaudeBot/1.0',
            },
          ],
          affectedUserAgents: ['ClaudeBot/1.0'],
          robotsTxtHash: '2f293650',
        }),
        // The user decided to skip the suggestion. 
        // We don't want to suggest this again while the robots.txt file is the same.
        getStatus: () => 'SKIPPED',
        setData: sandbox.stub(),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves(existingSuggestions);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves([]);

    const result = await checkLLMBlocked(context);

    // Verify the audit result is correct
    expect(result.auditResult).to.equal(JSON.stringify(expectedResultsMap));
    expect(nock.pendingMocks()).to.have.lengthOf(0);

    // Verify that existing suggestions were updated (not new ones added)
    expect(context.dataAccess.Opportunity.getSuggestions).to.have.been.calledOnce;
    expect(existingSuggestions[0].setData).to.have.been.calledOnce;
    expect(existingSuggestions[0].setUpdatedBy).to.have.been.calledWith('system');
    expect(existingSuggestions[0].save).to.have.been.calledOnce;

    // Verify that no new suggestions were added
    expect(context.dataAccess.Opportunity.addSuggestions).to.not.have.been.called;
  });

  it('should create new suggestions when robots.txt hash is different', async () => {
    // Mock robots.txt that blocks page1 for ClaudeBot/1.0
    nock('https://example.com')
      .get('/robots.txt')
      .reply(200, 'User-Agent: ClaudeBot/1.0\nDisallow: /page1\n\nUser-Agent: *\nAllow: /');

    const expectedResultsMap = {
      '2': {
        lineNumber: 2,
        robotsTxtHash: '2f293650',
        items: [
          {
            url: 'https://example.com/page1',
            agent: 'ClaudeBot/1.0',
          },
        ],
      },
    };

    // Mock existing suggestions with a DIFFERENT robots.txt hash
    const existingSuggestions = [
      {
        getData: () => ({
          lineNumber: 2,
          items: [
            {
              url: 'https://example.com/page1',
              agent: 'ClaudeBot/1.0',
            },
          ],
          affectedUserAgents: ['ClaudeBot/1.0'],
          robotsTxtHash: 'old-hash-123', // Different hash
        }),
        getStatus: () => 'NEW',
        setData: sandbox.stub(),
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      },
    ];

    // Mock the addSuggestions method to return the created suggestions
    const mockNewSuggestions = [
      {
        getId: () => 'new-suggestion-id',
        getData: () => ({
          lineNumber: 2,
          items: [
            {
              url: 'https://example.com/page1',
              agent: 'ClaudeBot/1.0',
            },
          ],
          affectedUserAgents: ['ClaudeBot/1.0'],
          robotsTxtHash: '2f293650',
        }),
      },
    ];

    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves(existingSuggestions);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves({
      createdItems: mockNewSuggestions,
      errorItems: [],
    });

    const result = await checkLLMBlocked(context);

    // Verify the audit result is correct
    expect(result.auditResult).to.equal(JSON.stringify(expectedResultsMap));
    expect(nock.pendingMocks()).to.have.lengthOf(0);

    // Verify that existing suggestions were NOT updated (different hash means different key)
    expect(context.dataAccess.Opportunity.getSuggestions).to.have.been.calledOnce;
    expect(existingSuggestions[0].setData).to.not.have.been.called;
    expect(existingSuggestions[0].setUpdatedBy).to.not.have.been.called;
    expect(existingSuggestions[0].save).to.not.have.been.called;

    // Verify that new suggestions were added
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnce;
    
    // Verify the new suggestion data structure
    const addSuggestionsCall = context.dataAccess.Opportunity.addSuggestions.getCall(0);
    const newSuggestionData = addSuggestionsCall.args[0][0];
    expect(newSuggestionData).to.deep.include({
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 10,
      data: {
        lineNumber: 2,
        items: [
          {
            url: 'https://example.com/page1',
            agent: 'ClaudeBot/1.0',
          },
        ],
        affectedUserAgents: ['ClaudeBot/1.0'],
        robotsTxtHash: '2f293650',
      },
    });
  });
});
