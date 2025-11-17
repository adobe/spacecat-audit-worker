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
  let handler;
  let fetchStub;
  let convertToOpportunityStub;
  let s3Client;
  let getObjectKeysUsingPrefixStub;
  let getObjectFromKeyStub;

  const mockFaqData = {
    opportunity_id: 'oppty-123',
    site_id: 'site-123',
    audit_id: 'audit-123',
    url: 'https://adobe.com',
    suggestions: [
      {
        url: 'https://www.adobe.com/products/photoshop',
        topic: 'photoshop',
        prompts: ['How to use Photoshop?', 'Is Photoshop good for beginners?'],
        faqs: [
          {
            isAnswerSuitable: true,
            answerSuitabilityReason: 'Answer is suitable',
            isQuestionRelevant: true,
            questionRelevanceReason: 'Question is relevant',
            question: 'How to use Photoshop?',
            answer: 'Photoshop is a powerful image editing tool...',
            sources: [
              { url: 'https://www.adobe.com/products/photoshop/guides' },
            ],
          },
          {
            isAnswerSuitable: true,
            answerSuitabilityReason: 'Answer is suitable',
            isQuestionRelevant: true,
            questionRelevanceReason: 'Question is relevant',
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
    convertToOpportunityStub = sinon.stub();
    fetchStub = sinon.stub(global, 'fetch');
    getObjectKeysUsingPrefixStub = sinon.stub();
    getObjectFromKeyStub = sinon.stub();

    // Mock the handler with stubbed dependencies
    const mockedHandler = await esmock('../../../src/faqs/guidance-handler.js', {
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub,
      },
      '../../../src/utils/s3-utils.js': {
        getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        getObjectFromKey: getObjectFromKeyStub,
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
      getId: sinon.stub().returns('specific-oppty-id'),
    };
    
    convertToOpportunityStub.resolves(dummyOpportunity);

    Opportunity = {
      create: sinon.stub().resolves(dummyOpportunity),
      allBySiteId: sinon.stub().resolves([]),
    };

    s3Client = { mockClient: true };

    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      auditId: 'audit-123',
      dataAccess: {
        Site,
        Opportunity,
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
      },
    };

    // Setup default fetch response
    fetchStub.resolves({
      ok: true,
      status: 200,
      json: sinon.stub().resolves(mockFaqData),
    });

    // Default S3 stubs
    getObjectKeysUsingPrefixStub.resolves([]);
    getObjectFromKeyStub.resolves(null);
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
    expect(log.error).to.have.been.calledWith('[FAQ] No presigned URL provided in message data');
    expect(fetchStub).not.to.have.been.called;
  });

  it('should return notFound when site is not found', async () => {
    Site.findById.resolves(null);
    const message = {
      auditId: 'audit-123',
      siteId: 'unknown-site-id',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(404);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Site not found for siteId: unknown-site-id/));
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
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Failed to fetch FAQ data: 404 Not Found/));
  });

  it('should return noContent when no FAQs are found', async () => {
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        opportunity_id: 'oppty-123',
        url: 'https://adobe.com',
        suggestions: [],
      }),
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(204);
    expect(log.info).to.have.been.calledWith('[FAQ] No suggestions found in the response');
    expect(convertToOpportunityStub).not.to.have.been.called;
  });

  it('should return noContent when no suitable suggestions are found', async () => {
    const dataWithUnsuitableSuggestions = {
      ...mockFaqData,
      suggestions: [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          prompts: ['Test question'],
          faqs: [
            {
              isAnswerSuitable: false,
              isQuestionRelevant: false,
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
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(204);
    expect(log.info).to.have.been.calledWith('[FAQ] No suitable FAQ suggestions found after filtering');
  });

  it('should create an FAQ opportunity', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(convertToOpportunityStub).to.have.been.calledOnce;
    
    const callArgs = convertToOpportunityStub.getCall(0).args;
    expect(callArgs[0]).to.equal('https://adobe.com'); // baseUrl
    expect(callArgs[1].siteId).to.equal('site-123');
    expect(callArgs[1].auditId).to.equal('audit-123');
    expect(callArgs[4]).to.equal('faq'); // type
    
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should create suggestion with correct data structure', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;

    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];

    // Test the mapNewSuggestion function
    const testData = {
      headingText: 'FAQs',
      url: 'https://adobe.com/test',
      topic: 'test',
      transformRules: {
        selector: 'body',
        action: 'appendChild',
      },
      item: {
        question: 'Question?',
        answer: 'Answer.',
        sources: [],
        questionRelevanceReason: 'Reason',
        answerSuitabilityReason: 'Reason',
      },
    };

    const mappedSuggestion = syncArgs.mapNewSuggestion(testData);
    expect(mappedSuggestion.opportunityId).to.equal('specific-oppty-id');
    expect(mappedSuggestion.type).to.equal('CONTENT_UPDATE');
    expect(mappedSuggestion.rank).to.equal(10);
    expect(mappedSuggestion.data).to.deep.equal(testData);
  });

  it('should call buildKey function correctly with URL, topic and question', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;

    const syncCall = syncSuggestionsStub.getCall(0);
    const syncArgs = syncCall.args[0];
    const testData = {
      url: 'https://adobe.com/test',
      topic: 'photoshop',
      item: {
        question: 'How to use Photoshop?',
      },
    };
    const buildKeyResult = syncArgs.buildKey(testData);
    expect(buildKeyResult).to.equal('https://adobe.com/test::photoshop::How to use Photoshop?');
  });

  it('should create correct guidance object with recommendation count', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(convertToOpportunityStub).to.have.been.calledOnce;
    const callArgs = convertToOpportunityStub.getCall(0).args;
    const guidanceObj = callArgs[5]; // The { guidance } object
    
    expect(guidanceObj.guidance).to.exist;
    expect(guidanceObj.guidance).to.be.an('array');
    expect(guidanceObj.guidance[0].insight).to.include('2 relevant FAQs identified');
    expect(guidanceObj.guidance[0].type).to.equal('CONTENT_UPDATE');
  });

  it('should handle error when fetching FAQ data fails', async () => {
    fetchStub.rejects(new Error('Network error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Error processing FAQ guidance: Network error/));
  });

  it('should handle error when syncSuggestions fails', async () => {
    syncSuggestionsStub.rejects(new Error('Database error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Failed to save FAQ opportunity on Mystique callback: Database error/));
  });

  it('should filter and count only suitable and relevant suggestions', async () => {
    const mixedQualityData = {
      ...mockFaqData,
      suggestions: [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          prompts: ['Question 1', 'Question 2'],
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Good question 1?',
              answer: 'Good answer 1',
            },
            {
              isAnswerSuitable: false,
              isQuestionRelevant: true,
              question: 'Bad answer question?',
              answer: 'Bad answer',
            },
            {
              isAnswerSuitable: true,
              isQuestionRelevant: false,
              question: 'Irrelevant question?',
              answer: 'Good answer',
            },
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
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
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    expect(convertToOpportunityStub).to.have.been.calledOnce;
    const callArgs = convertToOpportunityStub.getCall(0).args;
    const guidanceObj = callArgs[5];
    // Should only count the 2 suitable AND relevant suggestions
    expect(guidanceObj.guidance[0].insight).to.include('2 relevant FAQs identified');
  });

  it('should handle FAQs with missing suggestions array', async () => {
    const faqData = {
      url: 'https://adobe.com',
      suggestions: [
        {
          url: 'https://adobe.com/test1',
          topic: 'test1',
          prompts: ['Question 1?'],
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Q1?',
              answer: 'A1',
            },
          ],
        },
        {
          url: 'https://adobe.com/test2',
          topic: 'test2',
          prompts: ['Question 2?'],
          // No faqs property
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
        presignedUrl: 'https://s3.example.com/faqs.json?signature=xyz',
      },
    };

    await handler(message, context);

    expect(convertToOpportunityStub).to.have.been.calledOnce;
    const callArgs = convertToOpportunityStub.getCall(0).args;
    const guidanceObj = callArgs[5];
    // Should only count the 1 suitable FAQ from the first suggestion
    expect(guidanceObj.guidance[0].insight).to.include('1 relevant FAQs identified');
  });

  it('should analyze scrape data and determine selector as main', async () => {
    // Mock scrape data with <main> element
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h1>Content</h1></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Check that selector was set to 'main'
    expect(newData[0].transformRules.selector).to.equal('main');
  });

  it('should analyze scrape data and determine selector as body when no main', async () => {
    // Mock scrape data without <main> element
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><div><h1>Content</h1></div></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Check that selector was set to 'body'
    expect(newData[0].transformRules.selector).to.equal('body');
  });

  it('should detect FAQ headings and set shouldOptimize to false', async () => {
    // Mock scrape data with FAQ heading
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h2>Frequently Asked Questions</h2></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Check that shouldOptimize is false when FAQ heading exists
    expect(newData[0].shouldOptimize).to.equal(false);
    expect(log.info).to.have.been.calledWith(sinon.match(/Found FAQ heading in h2: "Frequently Asked Questions"/));
  });

  it('should detect FAQ heading with "faq" text (case insensitive)', async () => {
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><h1>FAQ</h1></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should set shouldOptimize to true when no FAQ headings found', async () => {
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h1>Product Information</h1></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].shouldOptimize).to.equal(true);
  });

  it('should handle headings with empty textContent', async () => {
    // Mock scrape data with heading that has no text content
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h1></h1><h2>Normal Heading</h2></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should still work correctly
    expect(newData[0].transformRules.selector).to.equal('main');
    expect(newData[0].shouldOptimize).to.equal(true);
  });

  it('should set shouldOptimize to false when FAQ has topic only (no URL)', async () => {
    // Mock FAQ data with no URL (topic only)
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves({
        suggestions: [
          {
            topic: 'general-topic',
            // No URL provided
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'General question?',
                answer: 'General answer.',
                sources: [],
              },
            ],
          },
        ],
      }),
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should set shouldOptimize to false for topic-only FAQs
    expect(newData[0].shouldOptimize).to.equal(false);
    expect(newData[0].url).to.equal('');
    expect(newData[0].topic).to.equal('general-topic');
  });

  it('should handle missing scrape data gracefully', async () => {
    getObjectKeysUsingPrefixStub.resolves([]);
    getObjectFromKeyStub.resolves(null);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    // Should still create opportunity with default values
    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].transformRules.selector).to.equal('body');
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(log.warn).to.have.been.calledWith(sinon.match(/Scrape JSON path not found/));
  });

  it('should handle when scrape JSON object is not found', async () => {
    // Key exists but object is null
    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(null);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    // Should still create opportunity with default values
    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].transformRules.selector).to.equal('body');
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(log.warn).to.have.been.calledWith(sinon.match(/Scrape JSON object not found/));
  });

  it('should handle S3 error gracefully during scrape analysis', async () => {
    getObjectKeysUsingPrefixStub.rejects(new Error('S3 connection failed'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    // Should still create opportunity with default values
    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].transformRules.selector).to.equal('body');
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(log.error).to.have.been.calledWith(sinon.match(/Error fetching S3 keys/));
  });

  it('should handle error during scrape data analysis', async () => {
    // Mock scrape data with invalid structure that will throw an error
    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    // Return an object without scrapeResult property - this will cause error accessing scrapeResult.rawBody
    getObjectFromKeyStub.resolves({
      invalidProperty: 'test',
    });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.aws.com/faqs.json',
      },
    };

    await handler(message, context);

    // Should still create opportunity with default values
    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    expect(newData[0].transformRules.selector).to.equal('body');
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(log.error).to.have.been.calledWith(sinon.match(/Error analyzing scrape data/));
  });
});
