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
import esmock from 'esmock';

use(sinonChai);

describe('FAQs guidance handler', () => {
  let context;
  let Site;
  let Opportunity;
  let log;
  let dummySite;
  let dummyOpportunity;
  let syncSuggestionsStub;
  let getFaqMarkdownStub;
  let handler;
  let fetchStub;

  const mockFaqData = {
    opportunity_id: 'oppty-123',
    site_id: 'site-123',
    audit_id: 'audit-123',
    url: 'https://adobe.com',
    faqs: [
      {
        url: 'https://www.adobe.com/products/photoshop',
        topic: 'photoshop',
        prompts: ['How to use Photoshop?', 'Is Photoshop good for beginners?'],
        suggestions: [
          {
            is_answer_suitable: true,
            answer_suitability_reason: 'Answer is suitable',
            is_question_relevant: true,
            question_relevance_reason: 'Question is relevant',
            question: 'How to use Photoshop?',
            answer: 'Photoshop is a powerful image editing tool...',
            sources: [
              { url: 'https://www.adobe.com/products/photoshop/guides' },
            ],
          },
          {
            is_answer_suitable: true,
            answer_suitability_reason: 'Answer is suitable',
            is_question_relevant: true,
            question_relevance_reason: 'Question is relevant',
            question: 'Is Photoshop good for beginners?',
            answer: 'Photoshop offers several features suitable for beginners...',
            sources: [
              { title: 'Getting Started with Photoshop', url: 'https://www.adobe.com/products/photoshop/tutorials' },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(async function () {
    this.timeout(10000); // Increase timeout for esmock loading
    syncSuggestionsStub = sinon.stub().resolves();
    getFaqMarkdownStub = sinon.stub().returns('## 1. Target URL: [/products/photoshop]...');
    fetchStub = sinon.stub(global, 'fetch');

    // Mock the handler with stubbed dependencies
    const mockedHandler = await esmock('../../../src/faqs/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/faqs/utils.js': {
        getFaqMarkdown: getFaqMarkdownStub,
      },
    });

    handler = mockedHandler.default;

    Site = {
      findById: sinon.stub(),
    };
    dummySite = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-123',
    };
    Site.findById.resolves(dummySite);

    dummyOpportunity = {
      getId: sinon.stub().returns('existing-oppty-id'),
      getData: sinon.stub().returns({ subType: 'faqs' }),
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

    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      dataAccess: {
        Site,
        Opportunity,
      },
    };

    // Setup default fetch response
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: sinon.stub().resolves(mockFaqData),
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return badRequest when no presigned URL is provided', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {},
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith('No presigned URL provided in message data');
    expect(fetchStub).not.to.have.been.called;
  });

  it('should return notFound when site is not found', async () => {
    Site.findById.resolves(null);
    const message = {
      auditId: 'audit-123',
      siteId: 'unknown-site-id',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(404);
    expect(log.error).to.have.been.calledWith(sinon.match(/Site not found for siteId: unknown-site-id/));
    expect(fetchStub).not.to.have.been.called;
  });

  it('should return badRequest when fetch fails', async () => {
    fetchStub.resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/Failed to fetch FAQ data: 404 Not Found/));
  });

  it('should return noContent when no FAQs are found', async () => {
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        opportunity_id: 'oppty-123',
        url: 'https://adobe.com',
        faqs: [],
      }),
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(204);
    expect(log.info).to.have.been.calledWith('No FAQs found in the response');
    expect(Opportunity.create).not.to.have.been.called;
  });

  it('should return noContent when no suitable suggestions are found', async () => {
    const dataWithUnsuitableSuggestions = {
      ...mockFaqData,
      faqs: [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          prompts: ['Test question'],
          suggestions: [
            {
              is_answer_suitable: false,
              is_question_relevant: false,
              question: 'Test question?',
              answer: 'Test answer',
            },
          ],
        },
      ],
    };

    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves(dataWithUnsuitableSuggestions),
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(204);
    expect(log.info).to.have.been.calledWith('No suitable FAQ suggestions found after filtering');
  });

  it('should create a new FAQ opportunity if no existing opportunity is found', async () => {
    Opportunity.allBySiteId.resolves([]);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.type).to.equal('generic-opportunity');
    expect(createdArg.data.subType).to.equal('faqs');
    expect(createdArg.tags).to.include('isElmo');
    expect(syncSuggestionsStub).to.have.been.calledOnce;
    expect(getFaqMarkdownStub).to.have.been.calledWith(mockFaqData.faqs, log);
  });

  it('should update existing FAQ opportunity if found', async () => {
    Opportunity.allBySiteId.resolves([dummyOpportunity]);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(Opportunity.create).not.to.have.been.called;
    expect(dummyOpportunity.setAuditId).to.have.been.calledWith('audit-123');
    expect(dummyOpportunity.setData).to.have.been.called;
    expect(dummyOpportunity.setGuidance).to.have.been.called;
    expect(dummyOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    expect(dummyOpportunity.save).to.have.been.called;
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should create suggestion with correct data structure', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;

    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];

    // Test the mapNewSuggestion function
    const testData = {
      suggestionValue: '## FAQ Markdown Content',
      bKey: 'faqs:https://adobe.com',
    };

    const mappedSuggestion = syncArgs.mapNewSuggestion(testData);
    expect(mappedSuggestion.opportunityId).to.equal('existing-oppty-id');
    expect(mappedSuggestion.type).to.equal('CONTENT_UPDATE');
    expect(mappedSuggestion.rank).to.equal(1);
    expect(mappedSuggestion.status).to.equal('NEW');
    expect(mappedSuggestion.data.suggestionValue).to.equal(testData.suggestionValue);
    expect(mappedSuggestion.kpiDeltas.estimatedKPILift).to.equal(0);
  });

  it('should call buildKey function correctly', async () => {
    Opportunity.allBySiteId.resolves([]);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;

    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];
    const testData = {
      suggestionValue: 'test',
      bKey: 'faqs:https://adobe.com',
    };
    const buildKeyResult = syncArgs.buildKey(testData);
    expect(buildKeyResult).to.equal('faqs:https://adobe.com');
  });

  it('should create correct guidance object with recommendation count', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    expect(createdArg.guidance).to.exist;
    expect(createdArg.guidance.recommendations).to.be.an('array');
    expect(createdArg.guidance.recommendations[0].insight).to.include('2 FAQ opportunities identified');
    expect(createdArg.guidance.recommendations[0].type).to.equal('CONTENT_UPDATE');
  });

  it('should handle error when fetching FAQ data fails', async () => {
    fetchStub.rejects(new Error('Network error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/Error processing FAQ guidance: Network error/));
  });

  it('should handle error when syncSuggestions fails', async () => {
    syncSuggestionsStub.rejects(new Error('Database error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/Error processing FAQ guidance: Database error/));
  });

  it('should filter and count only suitable and relevant suggestions', async () => {
    const mixedQualityData = {
      ...mockFaqData,
      faqs: [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          prompts: ['Question 1', 'Question 2'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Good question 1?',
              answer: 'Good answer 1',
            },
            {
              is_answer_suitable: false,
              is_question_relevant: true,
              question: 'Bad answer question?',
              answer: 'Bad answer',
            },
            {
              is_answer_suitable: true,
              is_question_relevant: false,
              question: 'Irrelevant question?',
              answer: 'Good answer',
            },
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Good question 2?',
              answer: 'Good answer 2',
            },
          ],
        },
      ],
    };

    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves(mixedQualityData),
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presigned_url: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    // Should only count the 2 suitable AND relevant suggestions
    expect(createdArg.guidance.recommendations[0].insight).to.include('2 FAQ opportunities identified');
  });

  it('should handle FAQs with missing suggestions array', async () => {
    const faqData = {
      url: 'https://adobe.com',
      faqs: [
        {
          url: 'https://adobe.com/test1',
          topic: 'test1',
          prompts: ['Question 1?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Q1?',
              answer: 'A1',
            },
          ],
        },
        {
          url: 'https://adobe.com/test2',
          topic: 'test2',
          prompts: ['Question 2?'],
          // No suggestions property
        },
      ],
    };

    global.fetch = sinon.stub().resolves({
      ok: true,
      json: async () => faqData,
    });

    const message = {
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        presigned_url: 'https://s3.example.com/faqs.json?signature=xyz',
      },
    };

    await handler(message, context);

    expect(Opportunity.create).to.have.been.calledOnce;
    const createdArg = Opportunity.create.getCall(0).args[0];
    // Should only count the 1 suitable suggestion from the first FAQ
    expect(createdArg.guidance.recommendations[0].insight).to.include('1 FAQ opportunities identified');
  });
});

