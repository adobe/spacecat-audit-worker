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

import ExcelJS from 'exceljs';
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
  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let mockWorkbook;

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
              { url: 'https://www.adobe.com/products/photoshop' },
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
              { title: 'Getting Started with Photoshop', url: 'https://www.adobe.com/products/photoshop' },
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
    // Stub the shared analysis-fetch helper directly (no need to fake a Response).
    fetchStub = sinon.stub().resolves(mockFaqData);
    getObjectKeysUsingPrefixStub = sinon.stub();
    getObjectFromKeyStub = sinon.stub();
    createLLMOSharepointClientStub = sinon.stub().resolves({ client: 'mock' });
    readFromSharePointStub = sinon.stub().resolves(Buffer.from('mock'));
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 1,
          getRow: () => ({ values: [] }),
          getRows: () => [],
        },
      ],
    };

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
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchStub,
      },
      exceljs: {
        Workbook: class {
          constructor() {}

          get xlsx() {
            const self = this;
            return {
              load: async () => {
                Object.assign(self, mockWorkbook);
              },
            };
          }
        },
      },
    });

    handler = mockedHandler.default;

    Site = {
      findById: sinon.stub(),
    };
    dummySite = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-123',
      getConfig: sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
      }),
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
      getOutputLocation: sinon.stub().returns('/data/llmo/brand-presence'),
      dataAccess: {
        Site,
        Opportunity,
      },
      s3Client,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'scraper-bucket',
      },
    };

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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(404);
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Site not found for siteId: unknown-site-id/));
    expect(fetchStub).not.to.have.been.called;
  });

  it('should return badRequest when fetch fails', async () => {
    fetchStub.rejects(new Error("[FAQ] analysis fetch failed: 404 Not Found"));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(400);
    // fetchAnalysisFromPresignedUrl throws on non-ok; the FAQ catch logs "Error processing FAQ guidance: …"
    expect(log.error).to.have.been.calledWith(sinon.match(/\[FAQ\] Error processing FAQ guidance.*analysis fetch failed: 404 Not Found/));
  });

  it('should return noContent when no FAQs are found', async () => {
    fetchStub.resolves({
        opportunity_id: 'oppty-123',
        url: 'https://adobe.com',
        suggestions: [],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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

    fetchStub.resolves(dataWithUnsuitableSuggestions);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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

  it('should handle site config without getIncludedURLs method', async () => {
    dummySite.getConfig = sinon.stub().returns({});

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    const result = await handler(message, context);

    expect(result.status).to.equal(200);
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should load related URLs using llmo data folder when custom output location is absent', async () => {
    context.getOutputLocation = undefined;
    dummySite.getConfig = sinon.stub().returns({
      getIncludedURLs: sinon.stub().resolves(['https://www.adobe.com/desired-page']),
      getLlmoDataFolder: sinon.stub().returns('/llmo-folder'),
    });
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'How to use Photoshop?' };
                if (col === 7) return { value: 'https://www.adobe.com/original' };
                if (col === 22) return { value: 'https://www.adobe.com/desired-page' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    expect(readFromSharePointStub).to.have.been.calledWith(
      sinon.match.string,
      '/llmo-folder/brand-presence',
      sinon.match.object,
      log,
    );
  });

  it('should skip workbook lookup when no output location can be resolved', async () => {
    context.getOutputLocation = undefined;
    dummySite.getConfig = sinon.stub().returns({
      getIncludedURLs: sinon.stub().resolves([]),
    });

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    expect(readFromSharePointStub).not.to.have.been.called;
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should handle workbook with no worksheet when loading related URLs', async () => {
    mockWorkbook = {
      worksheets: [],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('should handle related URL workbook when worksheet.getRows returns null', async () => {
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => null,
        },
      ],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('https://www.adobe.com/products/photoshop');
  });

  it('should ignore related URL lookup when workbook headers are missing', async () => {
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({ values: [undefined] }),
          getRows: () => [
            {
              getCell: () => ({ value: 'ignored' }),
            },
          ],
        },
      ],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('https://www.adobe.com/products/photoshop');
  });

  it('should continue trying older workbooks after related URL file-not-found errors', async () => {
    readFromSharePointStub.onFirstCall().rejects(new Error('resource could not be found'));
    readFromSharePointStub.onSecondCall().resolves(Buffer.from('mock'));
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'How to use Photoshop?' };
                if (col === 7) return { value: 'https://www.adobe.com/products/photoshop' };
                if (col === 22) return { value: 'https://www.adobe.com/products/photoshop' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    expect(readFromSharePointStub.callCount).to.be.greaterThan(1);
  });

  it('should log and continue when loading related URLs fails unexpectedly', async () => {
    readFromSharePointStub.onFirstCall().rejects(new Error('boom'));
    readFromSharePointStub.onSecondCall().resolves(Buffer.from('mock'));
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'How to use Photoshop?' };
                if (col === 7) return { value: 'https://www.adobe.com/products/photoshop' };
                if (col === 22) return { value: 'https://www.adobe.com/products/photoshop' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    expect(log.error).to.have.been.calledWith(
      sinon.match(/\[FAQ\] Failed to load related URLs from .*: boom/),
    );
  });

  it('should handle generic suggestions with missing URL and topic', async () => {
    fetchStub.resolves({
        suggestions: [
          {
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'Generic question?',
                answer: 'Answer.',
                sources: [],
              },
            ],
          },
        ],
      });

    const result = await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    expect(result.status).to.equal(200);
    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('');
    expect(newData[0].topic).to.equal('');
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should decorate FAQ URLs using desired URL overlap first', async () => {
    dummySite.getConfig = sinon.stub().returns({
      getIncludedURLs: sinon.stub().resolves(['https://www.adobe.com/desired-page']),
    });
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'How to use Photoshop?' };
                if (col === 7) return { value: 'https://www.adobe.com/original' };
                if (col === 22) return { value: 'https://www.adobe.com/related-page; https://www.adobe.com/desired-page' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/original',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Answer.',
                sources: [
                  { url: 'https://www.adobe.com/related-page' },
                ],
              },
            ],
          },
        ],
      });

    await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('https://www.adobe.com/desired-page');
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should decorate FAQ URLs using related URL overlap with sources before top related URL', async () => {
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'How to use Photoshop?' };
                if (col === 7) return { value: 'https://www.adobe.com/original' };
                if (col === 22) return { value: 'https://www.adobe.com/top-related; https://www.adobe.com/source-match' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/original',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Answer.',
                sources: [
                  { url: 'https://www.adobe.com/source-match' },
                ],
              },
            ],
          },
        ],
      });

    await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('https://www.adobe.com/source-match');
    expect(newData[0].shouldOptimize).to.equal(true);
  });

  it('should fall back to top related URL, then original URL, then generic FAQ URL', async () => {
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 4,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'related' };
                if (col === 3) return { value: 'Related question?' };
                if (col === 7) return { value: 'https://www.adobe.com/original-a' };
                if (col === 22) return { value: 'https://www.adobe.com/top-related' };
                return { value: '' };
              },
            },
            {
              getCell: (col) => {
                if (col === 2) return { value: 'original' };
                if (col === 3) return { value: 'Original question?' };
                if (col === 7) return { value: 'https://www.adobe.com/original-b' };
                if (col === 22) return { value: '' };
                return { value: '' };
              },
            },
            {
              getCell: (col) => {
                if (col === 2) return { value: 'generic' };
                if (col === 3) return { value: 'Generic question?' };
                if (col === 7) return { value: '' };
                if (col === 22) return { value: '' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/original-a',
            topic: 'related',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'Related question?',
                answer: 'Answer.',
                sources: [{ url: 'https://www.adobe.com/other-source' }],
              },
            ],
          },
          {
            url: 'https://www.adobe.com/original-b',
            topic: 'original',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'Original question?',
                answer: 'Answer.',
                sources: [{ url: 'https://www.adobe.com/other-source' }],
              },
            ],
          },
          {
            url: '',
            topic: 'generic',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'Generic question?',
                answer: 'Answer.',
                sources: [],
              },
            ],
          },
        ],
      });

    await handler({
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    }, context);

    const newData = syncSuggestionsStub.getCall(0).args[0].newData;
    expect(newData[0].url).to.equal('https://www.adobe.com/top-related');
    expect(newData[0].shouldOptimize).to.equal(false);
    expect(newData[1].url).to.equal('https://www.adobe.com/original-b');
    expect(newData[1].shouldOptimize).to.equal(false);
    expect(newData[2].url).to.equal('');
    expect(newData[2].shouldOptimize).to.equal(false);
  });

  it('should handle error when fetching FAQ data fails', async () => {
    fetchStub.rejects(new Error('Network error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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

    fetchStub.resolves(mixedQualityData);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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

    fetchStub.resolves(faqData);

    const message = {
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json?signature=xyz',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
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

  it('should set shouldOptimize to false when URL is not in sources', async () => {
    // Mock FAQ data where the suggestion URL is NOT in the sources
    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/products/photoshop',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Photoshop is a powerful tool...',
                sources: [
                  { url: 'https://www.adobe.com/products/photoshop/guides' },
                  { url: 'https://www.adobe.com/tutorials/photoshop' },
                ],
              },
            ],
          },
        ],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should set shouldOptimize to false because URL is not in sources
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should proceed with analysis when URL is in sources', async () => {
    // Mock FAQ data where the suggestion URL IS in the sources
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h1>Product Information</h1></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/products/photoshop',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Photoshop is a powerful tool...',
                sources: [
                  { url: 'https://www.adobe.com/products/photoshop' }, // URL matches!
                  { url: 'https://www.adobe.com/tutorials/photoshop' },
                ],
              },
            ],
          },
        ],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should proceed with analysis and set shouldOptimize based on FAQ heading check
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(newData[0].transformRules.selector).to.equal('main');
  });

  it('should handle sources as plain strings', async () => {
    // Mock FAQ data with sources as plain string URLs (not objects)
    const mockScrapeData = {
      scrapeResult: {
        rawBody: '<html><body><main><h1>Product Information</h1></main></body></html>',
      },
    };

    getObjectKeysUsingPrefixStub.resolves([
      'scrapes/site-123/products/photoshop/scrape.json',
    ]);
    getObjectFromKeyStub.resolves(mockScrapeData);

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/products/photoshop',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Photoshop is a powerful tool...',
                sources: [
                  'https://www.adobe.com/products/photoshop', // Plain string
                  'https://www.adobe.com/tutorials/photoshop',
                ],
              },
            ],
          },
        ],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should find URL in sources and proceed with analysis
    expect(newData[0].shouldOptimize).to.equal(true);
    expect(newData[0].transformRules.selector).to.equal('main');
  });

  it('should handle empty sources array', async () => {
    // Mock FAQ data with empty sources array
    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/products/photoshop',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'How to use Photoshop?',
                answer: 'Photoshop is a powerful tool...',
                sources: [], // Empty sources
              },
            ],
          },
        ],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should set shouldOptimize to false because URL is not in empty sources
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should handle missing item property in suggestion', async () => {
    // This tests the edge case where getJsonFaqSuggestion returns malformed data
    const getJsonFaqSuggestionStub = sinon.stub().returns([
      {
        url: 'https://www.adobe.com/products/photoshop',
        topic: 'photoshop',
        // item property is missing
      },
    ]);
    mockWorkbook = {
      worksheets: [
        {
          rowCount: 2,
          getRow: () => ({
            values: [
              undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
              'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
              'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
              'DBM', 'ExecDate', 'Related URLs',
            ],
          }),
          getRows: () => [
            {
              getCell: (col) => {
                if (col === 2) return { value: 'photoshop' };
                if (col === 3) return { value: 'Test?' };
                if (col === 7) return { value: 'https://www.adobe.com/products/photoshop' };
                if (col === 22) return { value: '' };
                return { value: '' };
              },
            },
          ],
        },
      ],
    };

    const mockedHandlerWithStub = await esmock('../../../src/faqs/guidance-handler.js', {
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
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchStub,
      },
      '../../../src/faqs/utils.js': {
        getJsonFaqSuggestion: getJsonFaqSuggestionStub,
      },
      exceljs: {
        Workbook: class {
          constructor() {}

          get xlsx() {
            const self = this;
            return {
              load: async () => {
                Object.assign(self, mockWorkbook);
              },
            };
          }
        },
      },
    });

    fetchStub.resolves({
        suggestions: [
          {
            url: 'https://www.adobe.com/products/photoshop',
            topic: 'photoshop',
            faqs: [
              {
                isAnswerSuitable: true,
                isQuestionRelevant: true,
                question: 'Test?',
                answer: 'Test answer',
              },
            ],
          },
        ],
      });

    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await mockedHandlerWithStub.default(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const newData = syncCall.args[0].newData;
    
    // Should set shouldOptimize to false because sources are undefined
    expect(newData[0].shouldOptimize).to.equal(false);
  });

  it('should pass a mergeDataFunction that preserves edge-deployed suggestions unchanged', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    expect(syncSuggestionsStub).to.have.been.calledOnce;
    const syncCall = syncSuggestionsStub.getCall(0);
    const mergeDataFn = syncCall.args[0].mergeDataFunction;
    expect(mergeDataFn).to.be.a('function');

    // When edgeDeployed is true, return existing data unchanged (shouldOptimize must not be overwritten)
    const existingData = {
      url: 'https://www.adobe.com/products/photoshop',
      topic: 'photoshop',
      shouldOptimize: true,
      edgeDeployed: true,
      selector: 'main',
    };
    const newData = {
      url: 'https://www.adobe.com/products/photoshop',
      topic: 'photoshop',
      shouldOptimize: false,
      selector: 'body',
    };

    const result = mergeDataFn(existingData, newData);

    expect(result.edgeDeployed).to.equal(true);
    expect(result.shouldOptimize).to.equal(true);
    expect(result.selector).to.equal('main');
  });

  it('should pass a mergeDataFunction that merges normally when edgeDeployed is not set', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json',
      },
    };

    await handler(message, context);

    const syncCall = syncSuggestionsStub.getCall(0);
    const mergeDataFn = syncCall.args[0].mergeDataFunction;

    // When edgeDeployed is not set, new data should overwrite existing
    const existingData = {
      url: 'https://www.adobe.com/products/photoshop',
      topic: 'photoshop',
      shouldOptimize: true,
      selector: 'main',
    };
    const newData = {
      url: 'https://www.adobe.com/products/photoshop',
      topic: 'photoshop',
      shouldOptimize: false,
      selector: 'body',
    };

    const result = mergeDataFn(existingData, newData);

    expect(result.shouldOptimize).to.equal(false);
    expect(result.selector).to.equal('body');
  });

  describe('Related URLs week fallback (LLMO-5035)', () => {
    const HEADER_ROW_VALUES = [
      undefined, 'Category', 'Topics', 'Prompt', 'Origin', 'Region',
      'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
      'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
      'DBM', 'ExecDate', 'Related URLs',
    ];

    const makeWorkbook = (relatedUrlValue) => ({
      worksheets: [{
        rowCount: 2,
        getRow: () => ({ values: HEADER_ROW_VALUES }),
        getRows: () => [{
          getCell: (col) => {
            if (col === 2) return { value: 'photoshop' };
            if (col === 3) return { value: 'How to use Photoshop?' };
            if (col === 7) return { value: 'https://www.adobe.com/original' };
            if (col === 22) return { value: relatedUrlValue || null };
            return { value: '' };
          },
        }],
      }],
    });

    const FAQ_MESSAGE = {
      auditId: 'audit-123',
      siteId: 'site-123',
      data: { presignedUrl: 'https://s3.amazonaws.com/bucket/faqs.json' },
    };

    beforeEach(() => {
      fetchStub.resolves({
        suggestions: [{
          url: 'https://www.adobe.com/original',
          topic: 'photoshop',
          faqs: [{
            isAnswerSuitable: true,
            isQuestionRelevant: true,
            question: 'How to use Photoshop?',
            answer: 'Answer.',
            sources: [],
          }],
        }],
      });
    });

    it('should use current week Related URLs when available without trying older weeks', async () => {
      mockWorkbook = makeWorkbook('https://www.adobe.com/current-week-related');

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      // stopped after first call — current week had data
      expect(readFromSharePointStub.callCount).to.equal(1);
      // first call requested the most-recent week filename
      expect(readFromSharePointStub.getCall(0).args[0]).to.match(/w\d+-\d{4}\.xlsx$/);
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/current-week-related');
    });

    it('should fall back to previous week when current week file exists but has no Related URLs data', async () => {
      // Use an explicit local counter so call ordering is unambiguous.
      // Sinon increments callCount before executing the fake, so inside the fake
      // callCount===1 means "this is the first invocation".
      let callIndex = 0;
      readFromSharePointStub.callsFake(async () => {
        callIndex += 1;
        mockWorkbook = callIndex === 1
          ? makeWorkbook(null) // current week: file exists but Related URLs column not yet populated
          : makeWorkbook('https://www.adobe.com/previous-week-related');
        return Buffer.from('mock');
      });

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      // exactly two weeks tried: current (empty) then previous (has data)
      expect(readFromSharePointStub.callCount).to.equal(2);
      // second call should have requested an older week than the first
      const firstFilename = readFromSharePointStub.getCall(0).args[0];
      const secondFilename = readFromSharePointStub.getCall(1).args[0];
      expect(firstFilename).to.not.equal(secondFilename);
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/previous-week-related');
    });

    it('should fall back through multiple empty weeks to find Related URLs data', async () => {
      let callIndex = 0;
      readFromSharePointStub.callsFake(async () => {
        callIndex += 1;
        // weeks W and W-1 have no Related URLs; W-2 does
        mockWorkbook = callIndex < 3
          ? makeWorkbook(null)
          : makeWorkbook('https://www.adobe.com/week-3-related');
        return Buffer.from('mock');
      });

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      expect(readFromSharePointStub.callCount).to.equal(3);
      // each call should have requested a distinct filename
      const filenames = [0, 1, 2].map((i) => readFromSharePointStub.getCall(i).args[0]);
      expect(new Set(filenames).size).to.equal(3);
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/week-3-related');
    });

    it('should try all 4 lookback weeks and fall back to original URL column when none have Related URLs data', async () => {
      mockWorkbook = makeWorkbook(null); // every week returns an empty Related URLs column

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      // all 4 weeks must have been tried before giving up
      expect(readFromSharePointStub.callCount).to.equal(4);
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      // decorateFaqSuggestionUrl falls through to originalUrl when relatedUrls is empty
      expect(newData[0].url).to.equal('https://www.adobe.com/original');
    });

    it('should treat itemNotFound SharePoint error as file-not-found and try the next week', async () => {
      let callIndex = 0;
      readFromSharePointStub.callsFake(async () => {
        callIndex += 1;
        if (callIndex === 1) {
          throw new Error('itemNotFound: the requested item could not be found');
        }
        mockWorkbook = makeWorkbook('https://www.adobe.com/fallback-related');
        return Buffer.from('mock');
      });

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      expect(readFromSharePointStub.callCount).to.equal(2);
      // itemNotFound is a silent skip — must not log an error
      expect(log.error).not.to.have.been.calledWith(sinon.match(/Failed to load related URLs/));
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/fallback-related');
    });

    it('should not affect customers without Related URLs configured (no outputLocation)', async () => {
      context.getOutputLocation = undefined;
      dummySite.getConfig = sinon.stub().returns({
        getIncludedURLs: sinon.stub().resolves([]),
        // no getLlmoDataFolder → outputLocation resolves to null → workbook lookup skipped entirely
      });

      const result = await handler(FAQ_MESSAGE, context);

      expect(result.status).to.equal(200);
      expect(readFromSharePointStub).not.to.have.been.called;
      const newData = syncSuggestionsStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/original');
    });
  });

  describe('Related URLs week fallback — real ExcelJS integration', () => {
    /**
     * Helper: build a real xlsx Buffer using ExcelJS.
     * Columns match the production brand-presence spreadsheet layout.
     * @param {string|null} relatedUrlValue - value for the "Related URLs" cell, or null for empty
     */
    async function makeRealXlsxBuffer(relatedUrlValue) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      // header row — positions must match buildColumnMap / getColumn usage in production code
      ws.addRow([
        'Category', 'Topics', 'Prompt', 'Origin', 'Region',
        'Volume', 'URL', 'Answer', 'Sources', 'Citations', 'Mentions',
        'Sentiment', 'Biz', 'Org', 'CAI', 'IsA', 'S2A', 'Pos', 'Vis',
        'DBM', 'ExecDate', 'Related URLs',
      ]);
      // data row
      ws.addRow([
        'cat',          // Category (col 1)
        'photoshop',    // Topics   (col 2)
        'How to use Photoshop?', // Prompt (col 3)
        'AI',           // Origin
        'US',           // Region
        100,            // Volume
        'https://www.adobe.com/original', // URL (col 7)
        '',             // Answer
        '',             // Sources
        '',             // Citations
        '',             // Mentions
        '',             // Sentiment
        '',             // Biz
        '',             // Org
        '',             // CAI
        '',             // IsA
        '',             // S2A
        '',             // Pos
        '',             // Vis
        '',             // DBM
        '',             // ExecDate
        relatedUrlValue || '', // Related URLs (col 22)
      ]);
      return wb.xlsx.writeBuffer();
    }

    let realHandler;
    let realSyncStub;
    let realFetchStub;
    let realConvertStub;
    let realS3KeysStub;
    let realS3ObjStub;
    let realSharepointStub;
    let realReadStub;
    let realLog;
    let realContext;
    let realSite;

    beforeEach(async function () {
      this.timeout(15000);
      realSyncStub = sinon.stub().resolves();
      realFetchStub = sinon.stub().resolves({
        suggestions: [{
          url: 'https://www.adobe.com/original',
          topic: 'photoshop',
          faqs: [{
            isAnswerSuitable: true,
            isQuestionRelevant: true,
            question: 'How to use Photoshop?',
            answer: 'Answer.',
            sources: [],
          }],
        }],
      });
      realConvertStub = sinon.stub().resolves({ getId: () => 'oppty-real' });
      realS3KeysStub = sinon.stub().resolves([]);
      realS3ObjStub = sinon.stub().resolves(null);
      realSharepointStub = sinon.stub().resolves({ client: 'mock' });
      realReadStub = sinon.stub();

      realHandler = (await esmock('../../../src/faqs/guidance-handler.js', {
        '../../../src/utils/data-access.js': { syncSuggestions: realSyncStub },
        '../../../src/common/opportunity.js': { convertToOpportunity: realConvertStub },
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: realS3KeysStub,
          getObjectFromKey: realS3ObjStub,
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: realSharepointStub,
          readFromSharePoint: realReadStub,
        },
        '../../../src/utils/analysis-fetch.js': {
          fetchAnalysisFromPresignedUrl: realFetchStub,
        },
        // ← no exceljs mock: real ExcelJS is used
      })).default;

      realLog = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
      realSite = {
        getId: () => 'site-real',
        getBaseURL: () => 'https://adobe.com',
        getConfig: sinon.stub().returns({
          getIncludedURLs: sinon.stub().resolves([]),
          getLlmoDataFolder: sinon.stub().returns('/llmo'),
        }),
      };
      realContext = {
        log: realLog,
        getOutputLocation: sinon.stub().returns('/data/brand-presence'),
        dataAccess: { Site: { findById: sinon.stub().resolves(realSite) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
    });

    afterEach(() => sinon.restore());

    it('uses current week Related URLs from real xlsx when available', async () => {
      const buffer = await makeRealXlsxBuffer('https://www.adobe.com/real-related');
      realReadStub.resolves(buffer);

      const result = await realHandler({
        auditId: 'a1', siteId: 'site-real',
        data: { presignedUrl: 'https://s3/faqs.json' },
      }, realContext);

      expect(result.status).to.equal(200);
      expect(realReadStub.callCount).to.equal(1);
      const newData = realSyncStub.getCall(0).args[0].newData;
      expect(newData[0].url).to.equal('https://www.adobe.com/real-related');
    });

    it('falls back to previous week with real ExcelJS when current week xlsx has no Related URLs', async () => {
      let callIndex = 0;
      realReadStub.callsFake(async () => {
        callIndex += 1;
        return callIndex === 1
          ? makeRealXlsxBuffer(null)          // current week: no Related URLs
          : makeRealXlsxBuffer('https://www.adobe.com/real-fallback'); // previous week: has data
      });

      const result = await realHandler({
        auditId: 'a1', siteId: 'site-real',
        data: { presignedUrl: 'https://s3/faqs.json' },
      }, realContext);

      expect(result.status).to.equal(200);
      expect(realReadStub.callCount).to.equal(2);
      const newData = realSyncStub.getCall(0).args[0].newData;
      // real ExcelJS must reset worksheets between loads — previous week data wins
      expect(newData[0].url).to.equal('https://www.adobe.com/real-fallback');
    });
  });
});
