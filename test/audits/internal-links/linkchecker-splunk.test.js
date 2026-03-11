/*
 * Copyright 2026 Adobe. All rights reserved.
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
import {
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
  fetchLinkCheckerLogs,
} from '../../../src/internal-links/linkchecker-splunk.js';

use(sinonChai);
use(chaiAsPromised);

describe('linkchecker-splunk', () => {
  let sandbox;
  let mockLog;
  let mockClient;
  let mockContext;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    mockClient = {
      apiBaseUrl: 'https://splunk.example.com:8089',
      loginObj: null,
      login: sandbox.stub().resolves({ sessionId: 'test-session-id', cookie: 'test-cookie' }),
      fetchAPI: sandbox.stub(),
    };

    mockContext = {
      log: mockLog,
      env: {
        SPLUNK_API_BASE_URL: 'https://splunk.example.com:8089',
        SPLUNK_API_TOKEN: 'test-token',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('buildLinkCheckerQuery', () => {
    it('builds correct Splunk search query with default parameters', () => {
      const query = buildLinkCheckerQuery({
        programId: 'program123',
        environmentId: 'env456',
      });

      expect(query).to.include('index=dx_aem_engineering');
      expect(query).to.include('earliest=-1440m@m');
      expect(query).to.include('latest=@m');
      expect(query).to.include('aem_program_id="program123"');
      expect(query).to.include('aem_envId="env456"');
      expect(query).to.include('"linkchecker.broken_internal_link"');
      expect(query).to.include('| spath');
      expect(query).to.include('| rename linkchecker.broken_internal_link.urlFrom as urlFrom');
      expect(query).to.include('| where isnotnull(urlFrom) AND isnotnull(urlTo)');
      expect(query).to.include('| head 10000');
    });

    it('builds query with custom lookback minutes', () => {
      const query = buildLinkCheckerQuery({
        programId: 'program123',
        environmentId: 'env456',
        lookbackMinutes: 60,
      });

      expect(query).to.include('earliest=-60m@m');
    });

    it('builds query with custom max results', () => {
      const query = buildLinkCheckerQuery({
        programId: 'program123',
        environmentId: 'env456',
        maxResults: 5000,
      });

      expect(query).to.include('| head 5000');
    });
  });

  describe('submitSplunkJob', () => {
    it('submits async Splunk job successfully', async () => {
      mockClient.fetchAPI.resolves({
        status: 201,
        json: sandbox.stub().resolves({ sid: 'job-id-123' }),
      });

      const sid = await submitSplunkJob(mockClient, 'search query', mockLog);

      expect(sid).to.equal('job-id-123');
      expect(mockClient.login).to.have.been.calledOnce;
      expect(mockClient.fetchAPI).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith(sinon.match('Job submitted successfully'));
    });

    it('throws error if submission fails', async () => {
      mockClient.fetchAPI.resolves({
        status: 500,
        text: sandbox.stub().resolves('Internal Server Error'),
      });

      await expect(submitSplunkJob(mockClient, 'search query', mockLog))
        .to.be.rejectedWith('Splunk job submission failed. Status: 500');
    });

    it('throws error if response missing sid', async () => {
      mockClient.fetchAPI.resolves({
        status: 201,
        json: sandbox.stub().resolves({}),
      });

      await expect(submitSplunkJob(mockClient, 'search query', mockLog))
        .to.be.rejectedWith('Splunk job submission did not return a job ID');
    });

    it('throws error if login fails', async () => {
      mockClient.login.resolves({ error: new Error('Login failed') });

      await expect(submitSplunkJob(mockClient, 'search query', mockLog))
        .to.be.rejectedWith('Login failed');
    });

    it('handles login error as string', async () => {
      mockClient.login.resolves({ error: 'Authentication timeout' });

      await expect(submitSplunkJob(mockClient, 'search query', mockLog))
        .to.be.rejectedWith('Authentication timeout');
    });
  });

  describe('pollJobStatus', () => {
    it('returns isDone: true when job is complete', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: true,
              dispatchState: 'DONE',
              resultCount: 42,
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status).to.deep.equal({
        isDone: true,
        isFailed: false,
        dispatchState: 'DONE',
        resultCount: 42,
      });
    });

    it('returns isDone: true when dispatchState is DONE', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: false,
              dispatchState: 'DONE',
              resultCount: 10,
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status.isDone).to.be.true;
    });

    it('returns isFailed: true when job fails', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: false,
              isFailed: true,
              dispatchState: 'FAILED',
              resultCount: 0,
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status).to.deep.equal({
        isDone: false,
        isFailed: true,
        dispatchState: 'FAILED',
        resultCount: 0,
      });
    });

    it('returns isFailed: true when dispatchState is FAILED', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isFailed: false,
              dispatchState: 'FAILED',
              resultCount: 0,
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status.isFailed).to.be.true;
    });

    it('returns isDone: false when job is running', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: false,
              isFailed: false,
              dispatchState: 'RUNNING',
              resultCount: 0,
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status.isDone).to.be.false;
      expect(status.isFailed).to.be.false;
      expect(status.dispatchState).to.equal('RUNNING');
    });

    it('throws error if status check fails', async () => {
      mockClient.fetchAPI.resolves({
        status: 404,
        text: sandbox.stub().resolves('Job not found'),
      });

      await expect(pollJobStatus(mockClient, 'job-id-123', mockLog))
        .to.be.rejectedWith('Splunk job status check failed. Status: 404');
    });

    it('throws error if response missing content', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({ entry: [{}] }),
      });

      await expect(pollJobStatus(mockClient, 'job-id-123', mockLog))
        .to.be.rejectedWith('Splunk job status response missing content');
    });

    it('throws error when loginObj contains string error', async () => {
      mockClient.loginObj = { error: 'Auth failed' };
      await expect(pollJobStatus(mockClient, 'job-id-123', mockLog))
        .to.be.rejectedWith('Auth failed');
    });

    it('handles resultCount as string and converts to number', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: true,
              dispatchState: 'DONE',
              resultCount: '123',
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status.resultCount).to.equal(123);
    });

    it('handles missing resultCount gracefully', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          entry: [{
            content: {
              isDone: true,
              dispatchState: 'DONE',
            },
          }],
        }),
      });

      const status = await pollJobStatus(mockClient, 'job-id-123', mockLog);

      expect(status.resultCount).to.equal(0);
    });
  });

  describe('fetchJobResults', () => {
    it('fetches and parses job results successfully', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          results: [
            {
              urlFrom: 'https://example.com/page1',
              urlTo: 'https://example.com/broken',
              anchorText: 'Click here',
              itemType: 'link',
              httpStatus: '404',
            },
            {
              urlFrom: 'https://example.com/page2',
              urlTo: 'https://example.com/missing',
              anchorText: 'Learn more',
              itemType: 'link',
              httpStatus: '500',
            },
          ],
        }),
      });

      const results = await fetchJobResults(mockClient, 'job-id-123', mockLog);

      expect(results).to.have.lengthOf(2);
      expect(results[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken',
        anchorText: 'Click here',
        itemType: 'link',
        httpStatus: '404',
      });
      expect(mockLog.info).to.have.been.calledWith(sinon.match('Fetched 2 results'));
    });

    it('returns empty array when no results', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({ results: [] }),
      });

      const results = await fetchJobResults(mockClient, 'job-id-123', mockLog);

      expect(results).to.deep.equal([]);
    });

    it('handles missing fields with defaults', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({
          results: [
            {
              urlFrom: 'https://example.com/page1',
              urlTo: 'https://example.com/broken',
            },
          ],
        }),
      });

      const results = await fetchJobResults(mockClient, 'job-id-123', mockLog);

      expect(results[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken',
        anchorText: '[no text]',
        itemType: 'link',
        httpStatus: 'unknown',
      });
    });

    it('throws error if fetch fails', async () => {
      mockClient.fetchAPI.resolves({
        status: 500,
        text: sandbox.stub().resolves('Internal error'),
      });

      await expect(fetchJobResults(mockClient, 'job-id-123', mockLog))
        .to.be.rejectedWith('Splunk job results fetch failed. Status: 500');
    });

    it('handles missing results field gracefully', async () => {
      mockClient.fetchAPI.resolves({
        status: 200,
        json: sandbox.stub().resolves({}),
      });

      const results = await fetchJobResults(mockClient, 'job-id-123', mockLog);

      expect(results).to.deep.equal([]);
    });

    it('throws error when loginObj contains Error object', async () => {
      mockClient.loginObj = { error: new Error('Session expired') };
      await expect(fetchJobResults(mockClient, 'job-id-123', mockLog))
        .to.be.rejectedWith('Session expired');
    });
  });

  describe('fetchLinkCheckerLogs', () => {
    it('submits job, polls until complete, and returns results', async () => {
      const mockedModule = await esmock('../../../src/internal-links/linkchecker-splunk.js', {
        '../../../src/support/splunk-client-loader.js': {
          createSplunkClient: sandbox.stub().resolves(mockClient),
        },
      });

      mockClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-id-123' }),
        })
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: true,
                dispatchState: 'DONE',
                resultCount: 1,
              },
            }],
          }),
        })
        .onThirdCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            results: [
              {
                urlFrom: 'https://example.com/page1',
                urlTo: 'https://example.com/broken',
                anchorText: 'Link',
                itemType: 'link',
                httpStatus: '404',
              },
            ],
          }),
        });
      const result = await mockedModule.fetchLinkCheckerLogs({
        programId: 'program123',
        environmentId: 'env456',
        context: mockContext,
      });

      expect(result).to.have.lengthOf(1);
      expect(result[0].urlTo).to.equal('https://example.com/broken');
    });

    it('throws error if polling times out', async () => {
      const mockedModule = await esmock('../../../src/internal-links/linkchecker-splunk.js', {
        '../../../src/support/splunk-client-loader.js': {
          createSplunkClient: sandbox.stub().resolves(mockClient),
        },
      });

      const clock = sandbox.useFakeTimers();
      mockClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-id-123' }),
        })
        .callsFake(async () => ({
          status: 200,
          json: async () => ({
            entry: [{
              content: {
                isDone: false,
                isFailed: false,
                dispatchState: 'RUNNING',
                resultCount: 0,
              },
            }],
          }),
        }));

      const promise = mockedModule.fetchLinkCheckerLogs({
        programId: 'program123',
        environmentId: 'env456',
        context: mockContext,
      });

      await clock.tickAsync(61000);
      await expect(promise).to.be.rejectedWith('Splunk job polling timeout after 30 attempts');
    });

    it('throws error when polled job fails', async () => {
      const mockedModule = await esmock('../../../src/internal-links/linkchecker-splunk.js', {
        '../../../src/support/splunk-client-loader.js': {
          createSplunkClient: sandbox.stub().resolves(mockClient),
        },
      });

      mockClient.fetchAPI
        .onFirstCall().resolves({
          status: 201,
          json: sandbox.stub().resolves({ sid: 'job-id-123' }),
        })
        .onSecondCall().resolves({
          status: 200,
          json: sandbox.stub().resolves({
            entry: [{
              content: {
                isDone: false,
                isFailed: true,
                dispatchState: 'FAILED',
                resultCount: 0,
              },
            }],
          }),
        });

      await expect(mockedModule.fetchLinkCheckerLogs({
        programId: 'program123',
        environmentId: 'env456',
        context: mockContext,
      })).to.be.rejectedWith('Splunk job failed. sid=job-id-123, dispatchState=FAILED');
    });
  });
});
