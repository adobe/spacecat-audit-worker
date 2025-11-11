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

describe('Content AI - enableContentAI', () => {
  let sandbox;
  let context;
  let site;
  let mockFetch;
  let enableContentAI;
  let clock;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockFetch = sandbox.stub(globalThis, 'fetch');

    // Mock Date to control timestamp and time calculations
    // Tuesday, 3:30 PM UTC - January 14, 2025
    const fixedDate = new Date('2025-01-14T15:30:00Z');
    clock = sinon.useFakeTimers(fixedDate.getTime());

    const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js');
    enableContentAI = contentAiModule.enableContentAI;

    site = {
      getId: sandbox.stub().returns('site-123'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };

    context = {
      env: {
        CONTENTAI_GRANT_TYPE: 'client_credentials',
        CONTENTAI_CLIENT_ID: 'test-client-id',
        CONTENTAI_CLIENT_SECRET: 'test-secret',
        CONTENTAI_SCOPE: 'test-scope',
        CONTENTAI_TOKEN_ENDPOINT: 'https://auth.example.com/token',
        CONTENTAI_ENDPOINT: 'https://contentai.example.com',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
    clock.restore();
  });

  describe('successful enablement', () => {
    it('should enable ContentAI with correct cron schedule and timestamp', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint - no existing config
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify token request
      expect(mockFetch.firstCall.args[0]).to.equal('https://auth.example.com/token');
      expect(mockFetch.firstCall.args[1].method).to.equal('POST');

      // Verify configurations request
      expect(mockFetch.secondCall.args[0]).to.equal('https://contentai.example.com/configurations');

      // Verify enable content AI request
      expect(mockFetch.thirdCall.args[0]).to.equal('https://contentai.example.com');
      expect(mockFetch.thirdCall.args[1].method).to.equal('POST');

      const requestBody = JSON.parse(mockFetch.thirdCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-14T15:30:00Z');
      const expectedHour = (testDate.getHours() + 1) % 24;
      const expectedDay = testDate.getDay();
      const expectedTimestamp = testDate.getTime();

      // Verify cron schedule
      expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
      expect(requestBody.steps[1].schedule.enabled).to.be.true;

      // Verify timestamp in sourceId
      expect(requestBody.steps[1].sourceId).to.equal(`example.com-generative-${expectedTimestamp}`);

      // Verify other fields
      expect(requestBody.steps[1].baseUrl).to.equal('https://example.com');
      expect(requestBody.steps[1].type).to.equal('discovery');
    });

    it('should handle midnight hour wraparound correctly', async () => {
      // Mock Date to be 11:30 PM (23:30)
      clock.restore();
      sandbox.restore();
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');

      const fixedDate = new Date('2025-01-14T23:30:00Z');
      clock = sinon.useFakeTimers(fixedDate.getTime());

      const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js');
      enableContentAI = contentAiModule.enableContentAI;

      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.thirdCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-14T23:30:00Z');
      const expectedHour = (testDate.getHours() + 1) % 24;
      const expectedDay = testDate.getDay();

      // Verify hour wraps around correctly (if local hour is 23, should wrap to 0)
      expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
    });

    it('should work correctly on Sunday (day 0)', async () => {
      // Mock Date to be Sunday
      clock.restore();
      sandbox.restore();
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');

      const fixedDate = new Date('2025-01-12T10:00:00Z'); // Sunday
      clock = sinon.useFakeTimers(fixedDate.getTime());

      const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js');
      enableContentAI = contentAiModule.enableContentAI;

      // Mock endpoints
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.thirdCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-12T10:00:00Z');
      const expectedHour = (testDate.getHours() + 1) % 24;
      const expectedDay = testDate.getDay();

      // Verify Sunday day and correct hour
      expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
    });
  });

  describe('pagination handling', () => {
    it('should fetch all configurations when cursor is present', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock first configurations call with cursor
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { id: 'config-1', steps: [] },
            { id: 'config-2', steps: [] },
          ],
          cursor: 'next-page-cursor',
        }),
      });

      // Mock second configurations call without cursor (last page)
      mockFetch.onThirdCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { id: 'config-3', steps: [] },
          ],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(3).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify first configurations call (without cursor)
      expect(mockFetch.secondCall.args[0]).to.equal('https://contentai.example.com/configurations');

      // Verify second configurations call (with cursor)
      expect(mockFetch.thirdCall.args[0]).to.equal('https://contentai.example.com/configurations?cursor=next-page-cursor');

      // Verify enable was called after pagination
      expect(mockFetch.callCount).to.equal(4);
    });

    it('should handle multiple pages of pagination', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock first page
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-1', steps: [] }],
          cursor: 'cursor-page-2',
        }),
      });

      // Mock second page
      mockFetch.onThirdCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-2', steps: [] }],
          cursor: 'cursor-page-3',
        }),
      });

      // Mock third page (last page)
      mockFetch.onCall(3).resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-3', steps: [] }],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(4).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify all pagination calls were made
      expect(mockFetch.callCount).to.equal(5);
      expect(mockFetch.getCall(1).args[0]).to.equal('https://contentai.example.com/configurations');
      expect(mockFetch.getCall(2).args[0]).to.equal('https://contentai.example.com/configurations?cursor=cursor-page-2');
      expect(mockFetch.getCall(3).args[0]).to.equal('https://contentai.example.com/configurations?cursor=cursor-page-3');
    });

    it('should handle empty items array in paginated response', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint with empty items
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
          cursor: 'next-cursor',
        }),
      });

      // Mock second page
      mockFetch.onThirdCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(3).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Should continue pagination even with empty items
      expect(mockFetch.callCount).to.equal(4);
    });
  });

  describe('existing configuration handling', () => {
    it('should skip enabling when configuration already exists', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint with existing config
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            {
              id: 'existing-config',
              steps: [
                {
                  type: 'discovery',
                  baseUrl: 'https://example.com',
                },
              ],
            },
          ],
        }),
      });

      await enableContentAI(site, context);

      // Should only call token and configurations endpoints, not enable endpoint
      expect(mockFetch.callCount).to.equal(2);
    });

    it('should check existing configuration across paginated results', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock first page without matching config
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            {
              id: 'other-config',
              steps: [{ type: 'discovery', baseUrl: 'https://other.com' }],
            },
          ],
          cursor: 'next-page',
        }),
      });

      // Mock second page with matching config
      mockFetch.onThirdCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            {
              id: 'matching-config',
              steps: [{ type: 'discovery', baseUrl: 'https://example.com' }],
            },
          ],
        }),
      });

      await enableContentAI(site, context);

      // Should paginate through all results and find existing config
      expect(mockFetch.callCount).to.equal(3);
    });
  });

  describe('error handling', () => {
    it('should throw error when token request fails', async () => {
      mockFetch.onFirstCall().resolves({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to get access token from ContentAI: 401 Unauthorized');
    });

    it('should throw error when configurations request fails', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint failure
      mockFetch.onSecondCall().resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to get configurations from ContentAI: 500 Internal Server Error');
    });

    it('should throw error when enable content AI request fails', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint failure
      mockFetch.onThirdCall().resolves({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to enable content AI for site site-123: 400 Bad Request');
    });

    it('should throw error when paginated configurations request fails', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock first configurations page succeeds
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-1', steps: [] }],
          cursor: 'next-cursor',
        }),
      });

      // Mock second configurations page fails
      mockFetch.onThirdCall().resolves({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to get configurations from ContentAI: 503 Service Unavailable');
    });
  });

  describe('request payload validation', () => {
    it('should include all required fields in the request payload', async () => {
      // Mock all endpoints
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.thirdCall.args[1].body);

      // Verify all steps are present
      expect(requestBody.steps).to.have.lengthOf(3);

      // Verify index step
      expect(requestBody.steps[0].type).to.equal('index');
      expect(requestBody.steps[0].name).to.equal('example.com-generative');

      // Verify discovery step
      expect(requestBody.steps[1].type).to.equal('discovery');
      expect(requestBody.steps[1].baseUrl).to.equal('https://example.com');
      expect(requestBody.steps[1].discoveryProperties.type).to.equal('website');
      expect(requestBody.steps[1].discoveryProperties.includePdfs).to.be.true;

      // Verify generative step
      expect(requestBody.steps[2].type).to.equal('generative');
      expect(requestBody.steps[2].name).to.equal('Comprehensive Q&A assitant');
      expect(requestBody.steps[2].description).to.exist;
      expect(requestBody.steps[2].prompts.system).to.exist;
      expect(requestBody.steps[2].prompts.user).to.exist;
    });

    it('should correctly format baseURL without protocol in name fields', async () => {
      site.getBaseURL.returns('https://www.test-site.com');

      // Mock all endpoints
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.thirdCall.args[1].body);

      // Verify protocol is stripped in name/sourceId
      expect(requestBody.steps[0].name).to.equal('www.test-site.com-generative');
      expect(requestBody.steps[1].sourceId).to.match(/^www\.test-site\.com-generative-\d+$/);

      // Verify baseUrl retains protocol
      expect(requestBody.steps[1].baseUrl).to.equal('https://www.test-site.com');
    });
  });

  describe('authorization headers', () => {
    it('should use correct authorization header for configurations request', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify configurations request has correct auth header
      const configsHeaders = mockFetch.secondCall.args[1].headers;
      expect(configsHeaders.Authorization).to.equal('Bearer test-access-token');
      expect(configsHeaders['Content-Type']).to.equal('application/json');
    });

    it('should use correct authorization header for enable request', async () => {
      // Mock token endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      });

      // Mock configurations endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onThirdCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify enable request has correct auth header
      const enableHeaders = mockFetch.thirdCall.args[1].headers;
      expect(enableHeaders.Authorization).to.equal('Bearer test-access-token');
      expect(enableHeaders['Content-Type']).to.equal('application/json');
    });
  });
});

