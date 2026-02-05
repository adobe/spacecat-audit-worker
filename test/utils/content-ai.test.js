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
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Content AI Utils', () => {
  describe('calculateWeeklyCronSchedule', () => {
    let sandbox;
    let clock;
    let calculateWeeklyCronSchedule;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      const contentAiModule = await esmock('../../src/utils/content-ai.js');
      calculateWeeklyCronSchedule = contentAiModule.calculateWeeklyCronSchedule;
    });

    afterEach(() => {
      sandbox.restore();
      if (clock) clock.restore();
    });

    it('should increment day when hour is 23 (wraps to midnight)', () => {
      // Set time to 11:30 PM on Tuesday - next hour will be 0 (midnight),
      // day should increment to Wednesday
      const fixedDate = new Date('2025-01-14T23:30:00'); // Local time
      clock = sinon.useFakeTimers(fixedDate.getTime());

      const result = calculateWeeklyCronSchedule();

      // Hour 23 + 1 = 0 (midnight), Tuesday (2) + 1 = Wednesday (3)
      expect(result).to.equal('0 0 * * 3');
    });

    it('should increment day when hour is 23 on Saturday (wraps to Sunday)', () => {
      // Set time to 11:30 PM on Saturday - next hour will be 0 (midnight),
      // day should wrap to Sunday
      const fixedDate = new Date('2025-01-18T23:30:00'); // Saturday local time
      clock = sinon.useFakeTimers(fixedDate.getTime());

      const result = calculateWeeklyCronSchedule();

      // Hour 23 + 1 = 0 (midnight), Saturday (6) + 1 = Sunday (0)
      expect(result).to.equal('0 0 * * 0');
    });

    it('should not increment day when hour does not wrap to midnight', () => {
      // Set time to 3:30 PM on Tuesday
      const fixedDate = new Date('2025-01-14T15:30:00'); // Local time
      clock = sinon.useFakeTimers(fixedDate.getTime());

      const result = calculateWeeklyCronSchedule();

      // Hour 15 + 1 = 16, day stays Tuesday (2)
      expect(result).to.equal('0 16 * * 2');
    });
  });

  describe('ContentAIClient', () => {
    let sandbox;
    let context;
    let site;
    let mockFetch;
    let ContentAIClient;
    let clock;
    let mockImsClient;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');

      // Mock Date to control timestamp and time calculations
      // Tuesday, 3:30 PM UTC - January 14, 2025
      const fixedDate = new Date('2025-01-14T15:30:00Z');
      clock = sinon.useFakeTimers(fixedDate.getTime());

      // Mock ImsClient with v3 token response
      mockImsClient = {
        getServiceAccessTokenV3: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      };

      const contentAiModule = await esmock('../../src/utils/content-ai.js', {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns(mockImsClient),
          },
        },
      });
      ContentAIClient = contentAiModule.ContentAIClient;

      site = {
        getId: sandbox.stub().returns('site-123'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getConfig: sandbox.stub().returns({
          getFetchConfig: sandbox.stub().returns({}),
        }),
      };

      context = {
        env: {
          CONTENTAI_CLIENT_ID: 'test-client-id',
          CONTENTAI_CLIENT_SECRET: 'test-secret',
          CONTENTAI_CLIENT_SCOPE: 'openid,AdobeID,aem.contentai',
          CONTENTAI_IMS_HOST: 'ims-na1.adobelogin.com',
          CONTENTAI_ENDPOINT: 'https://contentai.example.com',
        },
        log: {
          info: sandbox.stub(),
          error: sandbox.stub(),
        },
      };
    });

    afterEach(() => {
      sandbox.restore();
      clock.restore();
    });

    describe('initialization', () => {
      it('should initialize and fetch IMS token', async () => {
        const client = new ContentAIClient(context);
        await client.initialize();

        expect(mockImsClient.getServiceAccessTokenV3).to.have.been.calledOnce;
      });

      it('should throw error when IMS token request fails', async () => {
        mockImsClient.getServiceAccessTokenV3.rejects(new Error('IMS error'));

        const client = new ContentAIClient(context);

        await expect(client.initialize()).to.be.rejectedWith('IMS error');
      });

      it('should throw error when calling methods before initialization', async () => {
        const client = new ContentAIClient(context);

        // Try to call getConfigurations without initializing
        await expect(client.getConfigurations()).to.be.rejectedWith('ContentAIClient not initialized');
      });
    });

    describe('createConfiguration', () => {
      it('should create ContentAI configuration with correct cron schedule', async () => {
        // Mock configurations endpoint - no existing config
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [],
          }),
        });

        // Mock create configuration endpoint
        mockFetch.onSecondCall().resolves({
          ok: true,
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Verify IMS client was called
        expect(mockImsClient.getServiceAccessTokenV3).to.have.been.calledOnce;

        // Verify configurations request
        expect(mockFetch.firstCall.args[0]).to.equal('https://contentai.example.com/configurations');

        // Verify create configuration request
        expect(mockFetch.secondCall.args[0]).to.equal('https://contentai.example.com/configurations');
        expect(mockFetch.secondCall.args[1].method).to.equal('POST');

        const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

        // Calculate expected values based on local timezone
        const testDate = new Date('2025-01-14T15:30:00Z');
        const currentHour = testDate.getHours();
        const expectedHour = (currentHour + 1) % 24;
        let expectedDay = testDate.getDay();
        const expectedTimestamp = testDate.getTime();

        // If hour wraps to midnight, increment the day
        if (expectedHour === 0) {
          expectedDay = (expectedDay + 1) % 7;
        }

        // Verify cron schedule
        expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
        expect(requestBody.steps[1].schedule.enabled).to.be.true;

        // Verify timestamp in sourceId
        expect(requestBody.steps[1].sourceId).to.equal(`example.com-generative-${expectedTimestamp}`);

        // Verify other fields
        expect(requestBody.steps[1].baseUrl).to.equal('https://example.com');
        expect(requestBody.steps[1].type).to.equal('discovery');
      });

      it('should skip creating when configuration already exists', async () => {
        // Mock configurations endpoint - existing config
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              steps: [{
                baseUrl: 'https://example.com',
                type: 'generative',
              }],
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Should only call configurations endpoint (check), not create
        expect(mockFetch).to.have.been.calledOnce;
      });

      it('should skip creating when overrideBaseURL matches existing configuration', async () => {
        // Mock site with overrideBaseURL
        const siteWithOverride = {
          getId: sandbox.stub().returns('site-123'),
          getBaseURL: sandbox.stub().returns('https://example.com'),
          getConfig: sandbox.stub().returns({
            getFetchConfig: sandbox.stub().returns({
              overrideBaseURL: 'https://override.example.com',
            }),
          }),
        };

        // Mock configurations endpoint - existing config with override URL
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              steps: [{
                baseUrl: 'https://override.example.com',
                type: 'generative',
              }],
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(siteWithOverride);

        // Should only call configurations endpoint (check), not create
        expect(mockFetch).to.have.been.calledOnce;
      });

      it('should handle pagination when checking existing configurations', async () => {
        // First page - no match, but has cursor
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              steps: [{
                baseUrl: 'https://other-site.com',
                type: 'generative',
              }],
            }],
            cursor: 'next-page-cursor',
          }),
        });

        // Second page - has match
        mockFetch.onSecondCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              steps: [{
                baseUrl: 'https://example.com',
                type: 'generative',
              }],
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Should call configurations twice (pagination), but not create
        expect(mockFetch).to.have.been.calledTwice;
        expect(mockFetch.secondCall.args[0]).to.include('cursor=next-page-cursor');
      });

      it('should handle configurations without steps array', async () => {
        // Mock configurations endpoint - config without steps
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              // No steps field
            }],
          }),
        });

        // Mock create endpoint
        mockFetch.onSecondCall().resolves({
          ok: true,
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Should call create since no matching config was found
        expect(mockFetch).to.have.been.calledTwice;
      });

      it('should throw error when create request fails', async () => {
        // Mock configurations endpoint - no existing config
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [],
          }),
        });

        // Mock create endpoint - failure
        mockFetch.onSecondCall().resolves({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const client = new ContentAIClient(context);
        await client.initialize();

        await expect(client.createConfiguration(site)).to.be.rejected;
      });

      it('should include all required fields in request payload', async () => {
        // Mock configurations endpoint
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({ items: [] }),
        });

        // Mock create endpoint
        mockFetch.onSecondCall().resolves({
          ok: true,
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.createConfiguration(site);

        const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

        // Verify required fields
        expect(requestBody).to.have.property('steps');
        expect(requestBody.steps).to.be.an('array').with.lengthOf(3);
        expect(requestBody.steps[0]).to.have.property('name');
        expect(requestBody.steps[0]).to.have.property('type');
        expect(requestBody.steps[0].type).to.equal('index');
        expect(requestBody.steps[1]).to.have.property('type');
        expect(requestBody.steps[1].type).to.equal('discovery');
        expect(requestBody.steps[1]).to.have.property('schedule');
        expect(requestBody.steps[2]).to.have.property('type');
        expect(requestBody.steps[2].type).to.equal('generative');
      });
    });

    describe('createConfiguration with brand profile', () => {
      let ContentAIClientWithBrandProfile;
      let mockGetBrandGuidelines;

      it('should include brand guidelines in system prompt when available', async () => {
        // Mock getBrandGuidelinesFromSite to return brand guidelines
        mockGetBrandGuidelines = sandbox.stub().returns(
          '## Brand Guidelines\n### TONE\n  ✓ MUST USE: friendly, professional\n  ✗ MUST AVOID: aggressive',
        );

        // Create ContentAIClient with mocked brand-profile module
        const contentAiModuleWithBrand = await esmock('../../src/utils/content-ai.js', {
          '@adobe/spacecat-shared-ims-client': {
            ImsClient: {
              createFrom: sandbox.stub().returns(mockImsClient),
            },
          },
          '../../src/utils/brand-profile.js': {
            getBrandGuidelinesFromSite: mockGetBrandGuidelines,
          },
        });
        ContentAIClientWithBrandProfile = contentAiModuleWithBrand.ContentAIClient;

        // Mock configurations endpoint - no existing config
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({ items: [] }),
        });

        // Mock create configuration endpoint
        mockFetch.onSecondCall().resolves({
          ok: true,
        });

        const client = new ContentAIClientWithBrandProfile(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Verify getBrandGuidelinesFromSite was called
        expect(mockGetBrandGuidelines).to.have.been.calledOnce;

        // Verify log message for brand guidelines found
        // expect(context.log.info).to.have.been.calledWith(
        //   '[ContentAI] Brand guidelines found for site https://example.com',
        // );

        // Verify the system prompt includes brand guidelines
        const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);
        const systemPrompt = requestBody.steps[2].prompts.system;

        expect(systemPrompt).to.include('**Brand Guidelines**:');
        expect(systemPrompt).to.include('MUST USE: friendly, professional');
        expect(systemPrompt).to.include('MUST AVOID: aggressive');
        expect(systemPrompt).to.include('When generating responses, follow the brand guidelines');
      });

      it('should not include brand guidelines in system prompt when not available', async () => {
        // Mock getBrandGuidelinesFromSite to return empty string
        mockGetBrandGuidelines = sandbox.stub().returns('');

        // Create ContentAIClient with mocked brand-profile module
        const contentAiModuleNoBrand = await esmock('../../src/utils/content-ai.js', {
          '@adobe/spacecat-shared-ims-client': {
            ImsClient: {
              createFrom: sandbox.stub().returns(mockImsClient),
            },
          },
          '../../src/utils/brand-profile.js': {
            getBrandGuidelinesFromSite: mockGetBrandGuidelines,
          },
        });
        const ContentAIClientNoBrand = contentAiModuleNoBrand.ContentAIClient;

        // Mock configurations endpoint - no existing config
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({ items: [] }),
        });

        // Mock create configuration endpoint
        mockFetch.onSecondCall().resolves({
          ok: true,
        });

        const client = new ContentAIClientNoBrand(context);
        await client.initialize();
        await client.createConfiguration(site);

        // Verify log message for no brand guidelines
        expect(context.log.info).to.have.been.calledWith(
          '[ContentAI] No brand guidelines found for site https://example.com',
        );

        // Verify the system prompt does NOT include brand guidelines
        const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);
        const systemPrompt = requestBody.steps[2].prompts.system;

        expect(systemPrompt).to.not.include('**Brand Guidelines**:');
        expect(systemPrompt).to.not.include('When generating responses, follow the brand guidelines');
        expect(systemPrompt).to.include('You are a helpful AI Assistant');
        expect(systemPrompt).to.include('Context: {context}');
      });
    });

    describe('getConfigurationForSite', () => {
      it('should find and return existing configuration for site', async () => {
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              uid: 'config-123',
              steps: [{
                baseUrl: 'https://example.com',
                type: 'generative',
                index: {
                  name: 'example-index',
                },
              }],
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        const config = await client.getConfigurationForSite(site);

        expect(config).to.deep.equal({
          uid: 'config-123',
          steps: [{
            baseUrl: 'https://example.com',
            type: 'generative',
            index: {
              name: 'example-index',
            },
          }],
        });
      });

      it('should return null when no configuration exists', async () => {
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        const config = await client.getConfigurationForSite(site);

        expect(config).to.be.null;
      });

      it('should throw error when getConfigurations request fails', async () => {
        mockFetch.onFirstCall().resolves({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const client = new ContentAIClient(context);
        await client.initialize();

        await expect(client.getConfigurationForSite(site)).to.be.rejectedWith('Failed to get configurations from ContentAI: 500 Internal Server Error');
      });

      it('should handle response without items array', async () => {
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({}), // No items field
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        const config = await client.getConfigurationForSite(site);

        expect(config).to.be.null;
      });

      it('should find configuration by overrideBaseURL', async () => {
        // Mock site with overrideBaseURL
        const siteWithOverride = {
          getId: sandbox.stub().returns('site-123'),
          getBaseURL: sandbox.stub().returns('https://example.com'),
          getConfig: sandbox.stub().returns({
            getFetchConfig: sandbox.stub().returns({
              overrideBaseURL: 'https://override.example.com',
            }),
          }),
        };

        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              uid: 'config-override',
              steps: [{
                baseUrl: 'https://override.example.com',
                type: 'generative',
                index: {
                  name: 'override-index',
                },
              }],
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        const config = await client.getConfigurationForSite(siteWithOverride);

        expect(config.uid).to.equal('config-override');
      });

      it('should handle configurations with undefined steps', async () => {
        mockFetch.onFirstCall().resolves({
          ok: true,
          json: sandbox.stub().resolves({
            items: [{
              uid: 'config-no-steps',
              // No steps field
            }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        const config = await client.getConfigurationForSite(site);

        expect(config).to.be.null;
      });
    });

    describe('runSemanticSearch', () => {
      it('should execute semantic search with correct request body', async () => {
        mockFetch.resolves({
          ok: true,
          json: sandbox.stub().resolves({
            results: [{ title: 'Test Result' }],
          }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();

        const options = {
          vectorSpaceSelection: { space: 'semantic' },
          lexicalSpaceSelection: { space: 'fulltext' },
          numCandidates: 3,
          boost: 1,
        };

        const response = await client.runSemanticSearch('test query', 'vector', 'test-index', options, 10);

        expect(response.ok).to.be.true;
        expect(mockFetch).to.have.been.calledOnce;

        const [url, fetchOptions] = mockFetch.firstCall.args;
        expect(url).to.equal('https://contentai.example.com/search');
        expect(fetchOptions.method).to.equal('POST');

        const requestBody = JSON.parse(fetchOptions.body);
        expect(requestBody.searchIndexConfig.indexes[0].name).to.equal('test-index');
        expect(requestBody.query.text).to.equal('test query');
        expect(requestBody.query.type).to.equal('vector');
        expect(requestBody.queryOptions.pagination.limit).to.equal(10);
      });

      it('should handle search request failure', async () => {
        mockFetch.resolves({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
        });

        const client = new ContentAIClient(context);
        await client.initialize();

        const response = await client.runSemanticSearch('test query', 'vector', 'test-index', {}, 1);

        expect(response.ok).to.be.false;
        expect(response.status).to.equal(422);
      });
    });

    describe('authorization headers', () => {
      it('should use correct authorization header for all requests', async () => {
        mockFetch.resolves({
          ok: true,
          json: sandbox.stub().resolves({ items: [] }),
        });

        const client = new ContentAIClient(context);
        await client.initialize();
        await client.getConfigurationForSite(site);

        const authHeader = mockFetch.firstCall.args[1].headers.Authorization;
        expect(authHeader).to.equal('Bearer test-access-token');
      });
    });
  });
});
