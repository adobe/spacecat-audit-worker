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

import { expect } from 'chai';
import sinon from 'sinon';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import esmock from 'esmock';

describe('External Links Suggestions Generator', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockAudit;
  let mockConfiguration;
  let mockFirefallClient;
  let mockDataAccess;
  let generateSuggestionData;
  let mockUtils;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    const mockAuditType = 'BROKEN_EXTERNAL_LINKS';

    mockSite = { getId: () => 'test-site-id' };

    mockAudit = {
      getAuditResult: () => ({
        success: true,
        brokenExternalLinks: [
          {
            urlFrom: 'https://example.com/page1',
            urlTo: 'https://broken-link.com',
            trafficDomain: 100,
          },
        ],
      }),
    };

    mockConfiguration = {
      isHandlerEnabledForSite: sandbox.stub().returns(true),
    };

    mockFirefallClient = {
      fetchChatCompletion: sandbox.stub(),
    };

    mockDataAccess = {
      Configuration: {
        findLatest: sandbox.stub().resolves(mockConfiguration),
      },
    };

    mockContext = {
      dataAccess: mockDataAccess,
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      env: {
        FIREFALL_MODEL: 'test-model',
      },
    };

    mockUtils = {
      getScrapedDataForSiteId: sandbox.stub(),
    };

    generateSuggestionData = (await esmock(
      '../../../src/external-links/suggestions-generator.js',
      {
        '@adobe/spacecat-shared-utils': {
          getPrompt: sandbox.stub().resolves({
            messages: [{ role: 'user', content: 'Mocked prompt' }],
          }),
          isNonEmptyArray: (arr) => Array.isArray(arr) && arr.length > 0,
        },
        '@adobe/spacecat-shared-data-access': {
          Audit: {
            AUDIT_TYPES: {
              BROKEN_EXTERNAL_LINKS: mockAuditType,
            },
          },
        },
        '../../../src/support/utils.js': mockUtils,
      },
    )).generateSuggestionData;

    sandbox.stub(FirefallClient, 'createFrom').returns(mockFirefallClient);
  });

  afterEach(() => {
    sandbox.restore();
    sinon.restore();
  });

  it('should return original links if audit failed', async () => {
    mockAudit.getAuditResult = () => ({
      success: false,
      brokenExternalLinks: [{ urlFrom: 'test', urlTo: 'test' }],
    });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result).to.deep.equal([{ urlFrom: 'test', urlTo: 'test' }]);
  });

  it('should return original links if auto-suggest is disabled', async () => {
    mockConfiguration.isHandlerEnabledForSite.returns(false);

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result).to.deep.equal(mockAudit.getAuditResult().brokenExternalLinks);
  });

  it('should handle empty site data', async () => {
    mockUtils.getScrapedDataForSiteId.resolves({ siteData: [], headerLinks: [] });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result).to.deep.equal(mockAudit.getAuditResult().brokenExternalLinks);
  });

  it('should process single batch of suggestions successfully', async () => {
    const mockSiteData = Array(100).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];
    mockUtils.getScrapedDataForSiteId.resolves(
      {
        siteData: mockSiteData,
        headerLinks: mockHeaderLinks,
      },
    );

    mockFirefallClient.fetchChatCompletion.resolves({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            suggested_urls: ['https://example.com/suggested1'],
            aiRationale: 'Test rationale',
          }),
        },
      }],
    });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0].urlsSuggested).to.deep.equal(['https://example.com/suggested1']);
    expect(result[0].aiRationale).to.equal('Test rationale');
  });

  it('should handle multiple batches of suggestions', async () => {
    const mockSiteData = Array(400).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];
    mockUtils.getScrapedDataForSiteId.resolves(
      {
        siteData: mockSiteData,
        headerLinks: mockHeaderLinks,
      },
    );

    mockFirefallClient.fetchChatCompletion.resolves({
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            suggested_urls: ['https://example.com/suggested1'],
            aiRationale: 'Test rationale',
          }),
        },
      }],
    });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0].urlsSuggested).to.deep.equal(['https://example.com/suggested1']);
    expect(result[0].aiRationale).to.equal('Test rationale');
  });

  it('should handle Firefall API errors gracefully', async () => {
    const mockSiteData = Array(100).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];
    mockUtils.getScrapedDataForSiteId.resolves(
      {
        siteData: mockSiteData,
        headerLinks: mockHeaderLinks,
      },
    );

    mockFirefallClient.fetchChatCompletion.rejects(new Error('API Error'));

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0].urlsSuggested).to.deep.equal(['https://example.com']);
    expect(result[0].aiRationale).to.equal('No suitable suggestions found');
  });

  it('should handle invalid Firefall responses', async () => {
    const mockSiteData = Array(100).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];
    mockUtils.getScrapedDataForSiteId.resolves(
      {
        siteData: mockSiteData,
        headerLinks: mockHeaderLinks,
      },
    );

    mockFirefallClient.fetchChatCompletion.resolves({
      choices: [{
        finish_reason: 'length',
        message: {
          content: 'invalid json',
        },
      }],
    });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0].urlsSuggested).to.deep.equal(['https://example.com']);
    expect(result[0].aiRationale).to.equal('No suitable suggestions found');
  });

  it('should handle finish_reason not being stop in final suggestions (lines 108-110)', async () => {
    const mockSiteData = Array(400).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];
    mockUtils.getScrapedDataForSiteId.resolves(
      {
        siteData: mockSiteData,
        headerLinks: mockHeaderLinks,
      },
    );

    mockFirefallClient.fetchChatCompletion.onCall(0).resolves({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ suggested_urls: ['https://header-suggestion.com'], aiRationale: 'Header rationale' }) },
      }],
    });

    mockFirefallClient.fetchChatCompletion.onCall(1).resolves({
      choices: [{
        finish_reason: 'stop',
        message: { content: JSON.stringify({ suggested_urls: ['https://batch-suggestion.com'], aiRationale: 'Batch rationale' }) },
      }],
    });

    mockFirefallClient.fetchChatCompletion.onCall(2).resolves({
      choices: [{
        finish_reason: 'length',
        message: { content: JSON.stringify({ suggested_urls: ['https://final-suggestion.com'], aiRationale: 'Final rationale' }) },
      }],
    });

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0]).to.deep.include({
      urlFrom: 'https://example.com/page1',
      urlTo: 'https://broken-link.com',
      trafficDomain: 100,
    });
  });

  it('should return original link if final Firefall response finish_reason is not stop', async () => {
    const mockSiteData = Array(400).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];

    const getPromptStub = sinon.stub().resolves({
      messages: [{ role: 'user', content: 'Mocked prompt' }],
    });

    let callCount = 0;
    mockFirefallClient = {
      fetchChatCompletion: sinon.stub().callsFake(() => {
        const responses = [
          {
            choices: [{
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  suggested_urls: ['https://header-suggestion.com'],
                  aiRationale: 'Header rationale',
                }),
              },
            }],
          },
          {
            choices: [{
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  suggested_urls: ['https://batch-suggestion.com'],
                  aiRationale: 'Batch rationale',
                }),
              },
            }],
          },
          {
            choices: [{
              finish_reason: 'length',
              message: {
                content: JSON.stringify({
                  suggested_urls: ['https://final-suggestion.com'],
                  aiRationale: 'Final rationale',
                }),
              },
            }],
          },
        ];
        const result = responses[callCount] || responses[2];
        callCount += 1;
        return Promise.resolve(result);
      }),
    };

    mockContext = {
      log: {
        error: sinon.stub(),
        info: sinon.stub(),
      },
      env: { FIREFALL_MODEL: 'gpt-test' },
      dataAccess: {
        Configuration: {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: () => true,
          }),
        },
      },
    };

    mockAudit = {
      getAuditResult: () => ({
        success: true,
        brokenExternalLinks: [
          {
            urlFrom: 'https://example.com/page1',
            urlTo: 'https://broken-link.com',
            trafficDomain: 100,
          },
        ],
      }),
    };

    mockSite = {
      getId: () => 'test-site-id',
    };

    generateSuggestionData = (await esmock(
      '../../../src/external-links/suggestions-generator.js',
      {
        '@adobe/spacecat-shared-utils': {
          getPrompt: getPromptStub,
          isNonEmptyArray: (arr) => Array.isArray(arr) && arr.length > 0,
        },
        '@adobe/spacecat-shared-data-access': {
          Audit: {
            AUDIT_TYPES: {
              BROKEN_EXTERNAL_LINKS: 'BROKEN_EXTERNAL_LINKS',
            },
          },
        },
        '../../../src/support/utils.js': {
          getScrapedDataForSiteId: sinon.stub().resolves({
            siteData: mockSiteData,
            headerLinks: mockHeaderLinks,
          }),
        },
        '@adobe/spacecat-shared-gpt-client': {
          FirefallClient: {
            createFrom: () => mockFirefallClient,
          },
        },
      },
    )).generateSuggestionData;

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);

    expect(result[0]).to.deep.equal({
      urlFrom: 'https://example.com/page1',
      urlTo: 'https://broken-link.com',
      trafficDomain: 100,
    });

    const errorCalls = mockContext.log.error.getCalls();
    const matched = errorCalls.some((call) => call.args[0]?.includes('[BROKEN_EXTERNAL_LINKS] [Site: test-site-id] No final suggestions found for https://broken-link.com'));
    expect(matched).to.be.true;
  });
  it('should use fallback values if suggested_urls or aiRationale are missing or empty', async () => {
    const mockSiteData = Array(400).fill('https://example.com/page');
    const mockHeaderLinks = ['https://example.com/header1'];

    generateSuggestionData = (await esmock(
      '../../../src/external-links/suggestions-generator.js',
      {
        '@adobe/spacecat-shared-utils': {
          getPrompt: sinon.stub().resolves({
            messages: [{ role: 'user', content: 'Mocked prompt' }],
          }),
          isNonEmptyArray: (arr) => Array.isArray(arr) && arr.length > 0,
        },
        '@adobe/spacecat-shared-data-access': {
          Audit: {
            AUDIT_TYPES: {
              BROKEN_EXTERNAL_LINKS: 'BROKEN_EXTERNAL_LINKS',
            },
          },
        },
        '../../../src/support/utils.js': {
          getScrapedDataForSiteId: sinon.stub().resolves({
            siteData: mockSiteData,
            headerLinks: mockHeaderLinks,
          }),
        },
        '@adobe/spacecat-shared-gpt-client': {
          FirefallClient: {
            createFrom: () => ({
              fetchChatCompletion: sinon.stub().resolves({
                choices: [{
                  finish_reason: 'stop',
                  message: {
                    content: JSON.stringify({}),
                  },
                }],
              }),
            }),
          },
        },
      },
    )).generateSuggestionData;

    mockContext = {
      log: { info: sinon.stub(), error: sinon.stub() },
      env: { FIREFALL_MODEL: 'gpt-test' },
      dataAccess: {
        Configuration: {
          findLatest: sinon.stub().resolves({
            isHandlerEnabledForSite: () => true,
          }),
        },
      },
    };

    mockAudit = {
      getAuditResult: () => ({
        success: true,
        brokenExternalLinks: [
          {
            urlFrom: 'https://example.com/page1',
            urlTo: 'https://broken-link.com',
            trafficDomain: 100,
          },
        ],
      }),
    };

    mockSite = {
      getId: () => 'test-site-id',
    };

    const result = await generateSuggestionData('https://example.com', mockAudit, mockContext, mockSite);
    expect(result[0].urlsSuggested).to.deep.equal(['https://example.com']);
    expect(result[0].aiRationale).to.equal('No suitable suggestions found');
  });
});
