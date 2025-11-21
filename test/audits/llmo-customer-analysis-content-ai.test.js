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

describe('Content AI - calculateWeeklyCronSchedule', () => {
  let sandbox;
  let clock;
  let calculateWeeklyCronSchedule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js');
    calculateWeeklyCronSchedule = contentAiModule.calculateWeeklyCronSchedule;
  });

  afterEach(() => {
    sandbox.restore();
    if (clock) clock.restore();
  });

  it('should increment day when hour is 23 (wraps to midnight)', () => {
    // Set time to 11:30 PM on Tuesday - next hour will be 0 (midnight), day should increment to Wednesday
    const fixedDate = new Date('2025-01-14T23:30:00'); // Local time
    clock = sinon.useFakeTimers(fixedDate.getTime());

    const result = calculateWeeklyCronSchedule();

    // Hour 23 + 1 = 0 (midnight), Tuesday (2) + 1 = Wednesday (3)
    expect(result).to.equal('0 0 * * 3');
  });

  it('should increment day when hour is 23 on Saturday (wraps to Sunday)', () => {
    // Set time to 11:30 PM on Saturday - next hour will be 0 (midnight), day should wrap to Sunday
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

describe('Content AI - enableContentAI', () => {
  let sandbox;
  let context;
  let site;
  let mockFetch;
  let enableContentAI;
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

    const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js', {
      '@adobe/spacecat-shared-ims-client': {
        ImsClient: {
          createFrom: sandbox.stub().returns(mockImsClient),
        },
      },
    });
    enableContentAI = contentAiModule.enableContentAI;

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

  describe('successful enablement', () => {
    it('should enable ContentAI with correct cron schedule and timestamp', async () => {
      // Mock configurations endpoint - no existing config
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify IMS client was called
      expect(mockImsClient.getServiceAccessTokenV3).to.have.been.calledOnce;

      // Verify configurations request
      expect(mockFetch.firstCall.args[0]).to.equal('https://contentai.example.com/configurations');

      // Verify enable content AI request
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

    it('should handle midnight hour wraparound correctly', async () => {
      // Mock Date to be 11:30 PM (23:30)
      clock.restore();
      sandbox.restore();
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');

      const fixedDate = new Date('2025-01-14T23:30:00Z');
      clock = sinon.useFakeTimers(fixedDate.getTime());

      // Mock ImsClient with v3 token response
      mockImsClient = {
        getServiceAccessTokenV3: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      };

      const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js', {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns(mockImsClient),
          },
        },
      });
      enableContentAI = contentAiModule.enableContentAI;

      // Mock configurations endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-14T23:30:00Z');
      const currentHour = testDate.getHours();
      const expectedHour = (currentHour + 1) % 24;
      let expectedDay = testDate.getDay();
      
      // If hour wraps to midnight, increment the day
      if (expectedHour === 0) {
        expectedDay = (expectedDay + 1) % 7;
      }

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

      // Mock ImsClient with v3 token response
      mockImsClient = {
        getServiceAccessTokenV3: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      };

      const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js', {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns(mockImsClient),
          },
        },
      });
      enableContentAI = contentAiModule.enableContentAI;

      // Mock endpoints
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-12T10:00:00Z');
      const currentHour = testDate.getHours();
      const expectedHour = (currentHour + 1) % 24;
      let expectedDay = testDate.getDay();
      
      // If hour wraps to midnight, increment the day
      if (expectedHour === 0) {
        expectedDay = (expectedDay + 1) % 7;
      }

      // Verify Sunday day and correct hour
      expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
    });

    it('should increment day when hour wraps to midnight (Saturday to Sunday)', async () => {
      // Mock Date to be Saturday 11:30 PM (23:30)
      clock.restore();
      sandbox.restore();
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');

      const fixedDate = new Date('2025-01-18T23:30:00Z'); // Saturday
      clock = sinon.useFakeTimers(fixedDate.getTime());

      // Mock ImsClient with v3 token response
      mockImsClient = {
        getServiceAccessTokenV3: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      };

      const contentAiModule = await esmock('../../src/llmo-customer-analysis/content-ai.js', {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns(mockImsClient),
          },
        },
      });
      enableContentAI = contentAiModule.enableContentAI;

      // Mock endpoints
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

      // Calculate expected values based on local timezone
      const testDate = new Date('2025-01-18T23:30:00Z');
      const currentHour = testDate.getHours();
      const expectedHour = (currentHour + 1) % 24;
      let expectedDay = testDate.getDay();
      
      // If hour wraps to midnight, increment the day (Saturday 6 -> Sunday 0)
      if (expectedHour === 0) {
        expectedDay = (expectedDay + 1) % 7;
      }

      // If local hour is 23, next hour should be 0 and day should increment
      expect(requestBody.steps[1].schedule.cronSchedule).to.equal(`0 ${expectedHour} * * ${expectedDay}`);
    });
  });

  describe('pagination handling', () => {
    it('should fetch all configurations when cursor is present', async () => {
      // Mock first configurations call with cursor
      mockFetch.onFirstCall().resolves({
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
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { id: 'config-3', steps: [] },
          ],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(2).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify first configurations call (without cursor)
      expect(mockFetch.firstCall.args[0]).to.equal('https://contentai.example.com/configurations');

      // Verify second configurations call (with cursor)
      expect(mockFetch.secondCall.args[0]).to.equal('https://contentai.example.com/configurations?cursor=next-page-cursor');

      // Verify enable was called after pagination
      expect(mockFetch.callCount).to.equal(3);
    });

    it('should handle multiple pages of pagination', async () => {
      // Mock first page
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-1', steps: [] }],
          cursor: 'cursor-page-2',
        }),
      });

      // Mock second page
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-2', steps: [] }],
          cursor: 'cursor-page-3',
        }),
      });

      // Mock third page (last page)
      mockFetch.onCall(2).resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-3', steps: [] }],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(3).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify all pagination calls were made
      expect(mockFetch.callCount).to.equal(4);
      expect(mockFetch.getCall(0).args[0]).to.equal('https://contentai.example.com/configurations');
      expect(mockFetch.getCall(1).args[0]).to.equal('https://contentai.example.com/configurations?cursor=cursor-page-2');
      expect(mockFetch.getCall(2).args[0]).to.equal('https://contentai.example.com/configurations?cursor=cursor-page-3');
    });

    it('should handle empty items array in paginated response', async () => {
      // Mock configurations endpoint with empty items
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
          cursor: 'next-cursor',
        }),
      });

      // Mock second page
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onCall(2).resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Should continue pagination even with empty items
      expect(mockFetch.callCount).to.equal(3);
    });
  });

  describe('existing configuration handling', () => {
    it('should skip enabling when configuration already exists', async () => {
      // Mock configurations endpoint with existing config
      mockFetch.onFirstCall().resolves({
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

      // Should only call configurations endpoint, not enable endpoint
      expect(mockFetch.callCount).to.equal(1);
    });

    it('should check existing configuration across paginated results', async () => {
      // Mock first page without matching config
      mockFetch.onFirstCall().resolves({
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
      mockFetch.onSecondCall().resolves({
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
      expect(mockFetch.callCount).to.equal(2);
    });

    it('should skip enabling when override base URL matches existing configuration', async () => {
      // Mock site with fetchConfig override
      site.getConfig.returns({
        getFetchConfig: sandbox.stub().returns({
          overrideBaseURL: 'https://override.example.com',
        }),
      });

      // Mock configurations endpoint with config matching override base URL
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            {
              id: 'existing-config',
              steps: [
                {
                  type: 'discovery',
                  baseUrl: 'https://override.example.com',
                },
              ],
            },
          ],
        }),
      });

      await enableContentAI(site, context);

      // Should only call configurations endpoint, not enable endpoint
      expect(mockFetch.callCount).to.equal(1);
    });
  });

  describe('error handling', () => {
    it('should throw error when IMS token request fails', async () => {
      mockImsClient.getServiceAccessTokenV3.rejects(new Error('IMS authentication failed'));

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('IMS authentication failed');
    });

    it('should throw error when configurations request fails', async () => {
      // Mock configurations endpoint failure
      mockFetch.onFirstCall().resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to get configurations from ContentAI: 500 Internal Server Error');
    });

    it('should throw error when enable content AI request fails', async () => {
      // Mock configurations endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint failure
      mockFetch.onSecondCall().resolves({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(enableContentAI(site, context))
        .to.be.rejectedWith('Failed to enable content AI for site site-123: 400 Bad Request');
    });

    it('should throw error when paginated configurations request fails', async () => {
      // Mock first configurations page succeeds
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ id: 'config-1', steps: [] }],
          cursor: 'next-cursor',
        }),
      });

      // Mock second configurations page fails
      mockFetch.onSecondCall().resolves({
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
          items: [],
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

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
          items: [],
        }),
      });

      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      const requestBody = JSON.parse(mockFetch.secondCall.args[1].body);

      // Verify protocol is stripped in name/sourceId
      expect(requestBody.steps[0].name).to.equal('www.test-site.com-generative');
      expect(requestBody.steps[1].sourceId).to.match(/^www\.test-site\.com-generative-\d+$/);

      // Verify baseUrl retains protocol
      expect(requestBody.steps[1].baseUrl).to.equal('https://www.test-site.com');
    });
  });

  describe('authorization headers', () => {
    it('should use correct authorization header for configurations request', async () => {
      // Mock configurations endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify configurations request has correct auth header
      const configsHeaders = mockFetch.firstCall.args[1].headers;
      expect(configsHeaders.Authorization).to.equal('Bearer test-access-token');
      expect(configsHeaders['Content-Type']).to.equal('application/json');
    });

    it('should use correct authorization header for enable request', async () => {
      // Mock configurations endpoint
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({
          items: [],
        }),
      });

      // Mock enable content AI endpoint
      mockFetch.onSecondCall().resolves({
        ok: true,
      });

      await enableContentAI(site, context);

      // Verify enable request has correct auth header
      const enableHeaders = mockFetch.secondCall.args[1].headers;
      expect(enableHeaders.Authorization).to.equal('Bearer test-access-token');
      expect(enableHeaders['Content-Type']).to.equal('application/json');
    });
  });
});

