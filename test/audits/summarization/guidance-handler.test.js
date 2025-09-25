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
import handler from '../../../src/summarization/guidance-handler.js';

use(sinonChai);

describe('summarization guidance handler', () => {
  let context;
  let Site;
  let Audit;
  let Opportunity;
  let Suggestion;
  let log;
  let dummySite;
  let dummyAudit;
  let dummyOpportunity;

  beforeEach(() => {
    Site = {
      findById: sinon.stub(),
    };
    dummySite = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem',
    };
    Site.findById.resolves(dummySite);

    Audit = {
      findById: sinon.stub(),
    };
    dummyAudit = { auditId: 'audit-id' };
    Audit.findById.resolves(dummyAudit);

    dummyOpportunity = {
      getId: sinon.stub().returns('existing-oppty-id'),
      getSuggestions: sinon.stub().resolves([]),
      getData: sinon.stub().returns({ subType: 'summarization' }),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };
    Opportunity = {
      create: sinon.stub().resolves(dummyOpportunity),
      allBySiteId: sinon.stub().resolves([]),
    };
    Suggestion = {
      create: sinon.stub().resolves(),
    };
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      dataAccess: {
        Site,
        Audit,
        Opportunity,
        Suggestion,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should log a warning and return if no site found', async () => {
    Site.findById.resolves(null);
    const message = {
      auditId: 'audit-id',
      siteId: 'unknown-site-id',
      data: {
        guidance: [],
        suggestions: [],
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWith(sinon.match(/Site not found for siteId: unknown-site-id/));
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should log a warning and return if no audit found', async () => {
    Audit.findById.resolves(null);
    const message = {
      auditId: 'unknown-audit-id',
      siteId: 'site-id',
      data: {
        guidance: [],
        suggestions: [],
      },
    };
    await handler(message, context);
    expect(log.warn).to.have.been.calledWith(sinon.match(/No audit found for auditId: unknown-audit-id/));
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it('should create a new summarization opportunity if no existing opportunity is found', async () => {
    Opportunity.allBySiteId.resolves([]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [
          {
            insight: 'Content analysis reveals opportunities',
            rationale: 'Content summarization elements improve discoverability',
            recommendation: 'Focus on creating clear, engaging summaries',
            type: 'guidance',
          },
        ],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
              readability_score: 70.5,
              word_count: 25,
              brand_consistency_score: 85,
            },
            keyPoints: {
              items: ['Key point 1', 'Key point 2'],
              brand_consistency_score: 90,
            },
            sectionSummaries: [
              {
                title: 'Section 1',
                summary: 'Section summary 1',
                readability_score: 65.2,
                word_count: 15,
                brand_consistency_score: 88,
              },
            ],
          },
        ],
      },
    };
    await handler(message, context);
    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.type).to.equal('generic-opportunity');
    expect(createdArg.data.subType).to.equal('summarization');
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('should update existing summarization opportunity if found', async () => {
    Opportunity.allBySiteId.resolves([dummyOpportunity]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [
          {
            insight: 'Content analysis reveals opportunities',
            rationale: 'Content summarization elements improve discoverability',
            recommendation: 'Focus on creating clear, engaging summaries',
            type: 'guidance',
          },
        ],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
            },
            keyPoints: {
              items: ['Key point 1', 'Key point 2'],
            },
            sectionSummaries: [
              {
                title: 'Section 1',
                summary: 'Section summary 1',
              },
            ],
          },
        ],
      },
    };
    await handler(message, context);
    expect(Opportunity.create).not.to.have.been.called;
    expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-id');
    expect(dummyOpportunity.setData).to.have.been.called;
    expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(dummyOpportunity.save).to.have.been.called;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('removes previous suggestions if any', async () => {
    const oldSuggestion = { remove: sinon.stub().resolves() };
    dummyOpportunity.getSuggestions.resolves([oldSuggestion, oldSuggestion]);
    Opportunity.allBySiteId.resolves([dummyOpportunity]);
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
            },
            keyPoints: {
              items: ['Key point 1'],
            },
            sectionSummaries: [],
          },
        ],
      },
    };
    await handler(message, context);
    expect(oldSuggestion.remove).to.have.been.calledTwice;
    expect(Suggestion.create).to.have.been.calledOnce;
  });

  it('should skip suggestions with no meaningful content', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
            },
            keyPoints: {
              items: ['Key point 1'],
            },
            sectionSummaries: [],
          },
          {
            pageUrl: 'https://adobe.com/page2',
            pageSummary: { title: '', summary: '' },
            keyPoints: { items: [] },
            sectionSummaries: [],
          },
        ],
      },
    };
    await handler(message, context);
    expect(log.info).to.have.been.calledWithMatch(/Skipping suggestion with no meaningful content for URL: https:\/\/adobe\.com\/page2/);
    expect(Suggestion.create).to.have.been.calledOnce;
    expect(Suggestion.create.getCall(0).args[0].data.suggestionValue).to.not.include('https://adobe.com/page2');
  });

  it('should handle empty suggestions array', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [],
        suggestions: [],
      },
    };
    await handler(message, context);
    expect(Suggestion.create).to.have.been.calledOnce;
    expect(Suggestion.create.getCall(0).args[0].data.suggestionValue).to.equal('');
  });

  it('should create suggestion with correct data structure', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        guidance: [
          {
            insight: 'Content analysis reveals opportunities',
            rationale: 'Content summarization elements improve discoverability',
            recommendation: 'Focus on creating clear, engaging summaries',
            type: 'guidance',
          },
        ],
        suggestions: [
          {
            pageUrl: 'https://adobe.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
              readability_score: 70.5,
              word_count: 25,
              brand_consistency_score: 85,
            },
            keyPoints: {
              items: ['Key point 1', 'Key point 2'],
              brand_consistency_score: 90,
            },
            sectionSummaries: [
              {
                title: 'Section 1',
                summary: 'Section summary 1',
                readability_score: 65.2,
                word_count: 15,
                brand_consistency_score: 88,
              },
            ],
          },
        ],
      },
    };
    await handler(message, context);
    expect(Suggestion.create).to.have.been.calledOnce;
    const suggestionData = Suggestion.create.getCall(0).args[0];
    expect(suggestionData.opportunityId).to.equal('existing-oppty-id');
    expect(suggestionData.type).to.equal('CONTENT_UPDATE');
    expect(suggestionData.rank).to.equal(1);
    expect(suggestionData.status).to.equal('NEW');
    expect(suggestionData.data.suggestionValue).to.include('## 1. https://adobe.com/page1');
    expect(suggestionData.data.suggestionValue).to.include('### Page Title');
    expect(suggestionData.data.suggestionValue).to.include('Page Title 1');
    expect(suggestionData.data.suggestionValue).to.include('### Page Summary (AI generated)');
    expect(suggestionData.data.suggestionValue).to.include('> This is a page summary');
    expect(suggestionData.data.suggestionValue).to.include('*Readability:* 70.5 | *Word Count:* 25 | *Brand Consistency:* 85/100');
    expect(suggestionData.data.suggestionValue).to.include('### Key Points (AI generated)');
    expect(suggestionData.data.suggestionValue).to.include('> - Key point 1');
    expect(suggestionData.data.suggestionValue).to.include('> - Key point 2');
    expect(suggestionData.data.suggestionValue).to.include('*Brand Consistency:* 90/100');
    expect(suggestionData.data.suggestionValue).to.include('### Section Summaries (AI generated)');
    expect(suggestionData.data.suggestionValue).to.include('#### Section 1');
    expect(suggestionData.data.suggestionValue).to.include('> Section summary 1');
    expect(suggestionData.data.suggestionValue).to.include('*Readability:* 65.2 | *Word Count:* 15 | *Brand Consistency:* 88/100');
    expect(suggestionData.kpiDeltas.estimatedKPILift).to.equal(0);
  });

  it('should handle error when saving opportunity fails', async () => {
    const message = {
      siteId: dummySite.getId(),
      auditId: dummyAudit.auditId,
      data: {
        guidance: [
          {
            insight: 'Test insight',
            rationale: 'Test rationale',
            recommendation: 'Test recommendation',
          },
        ],
        suggestions: [
          {
            pageUrl: 'https://example.com/page1',
            pageSummary: {
              title: 'Page Title 1',
              summary: 'This is a page summary',
              readability_score: 70.5,
              word_count: 25,
              brand_consistency_score: 85,
            },
          },
        ],
      },
    };

    // Mock existing opportunity
    const existingOpportunity = {
      getId: () => 'existing-opportunity-id',
      getData: () => ({ subType: 'summarization' }),
      getSuggestions: () => Promise.resolve([]),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setGuidance: sinon.stub(),
      setUpdatedBy: sinon.stub(),
      save: sinon.stub().resolvesThis(),
    };

    Opportunity.allBySiteId.resolves([existingOpportunity]);

    // Mock Opportunity.create to return the existing opportunity
    Opportunity.create.resolves(existingOpportunity);

    // Mock Suggestion.create to throw an error
    const error = new Error('Database connection failed');
    Suggestion.create.rejects(error);

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    // The body is a Readable stream, so we need to read it
    const bodyText = await result.text();
    expect(bodyText).to.equal('{"message":"Failed to persist summarization opportunity"}');
    expect(log.error).to.have.been.calledWith(sinon.match(/Failed to save summarization opportunity on Mystique callback: Database connection failed/));
  });
});
