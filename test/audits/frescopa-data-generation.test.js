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
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const QUERY_INDEX_HOST = 'https://main--project-elmo-ui-data--adobe.aem.live';
const QUERY_INDEX_PATH = '/frescopa.coffee/query-index.json';

const MOCK_QUERY_INDEX = {
  total: 6,
  offset: 0,
  limit: 6,
  data: [
    { path: '/frescopa.coffee/brand-presence/brandpresence-all-w02-2026.json', lastModified: '1768199187' },
    { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w02-2026.json', lastModified: '1768198643' },
    { path: '/frescopa.coffee/referral-traffic/referral-traffic-w02-2026.json', lastModified: '1768198491' },
    { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2026.json', lastModified: '1768100000' },
    { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2026.json', lastModified: '1768100000' },
    { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2026.json', lastModified: '1768100000' },
  ],
};

/**
 * Helper to parse the response body from ok() or internalServerError()
 * The ok() function returns a Response object with a json() method
 */
async function getResponseBody(response) {
  if (typeof response.json === 'function') {
    return response.json();
  }
  return response.body;
}

describe('Frescopa Data Generation Handler', () => {
  let sandbox;
  let context;
  let handler;
  let mockSharepointClient;
  let mockDocument;
  let createLLMOSharepointClientStub;
  let publishToAdminHlxStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockDocument = {
      exists: sandbox.stub(),
      copy: sandbox.stub().resolves(),
    };

    mockSharepointClient = {
      getDocument: sandbox.stub().returns(mockDocument),
    };

    createLLMOSharepointClientStub = sandbox.stub().resolves(mockSharepointClient);
    publishToAdminHlxStub = sandbox.stub().resolves();

    handler = await esmock('../../src/frescopa-data-generation/handler.js', {
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        publishToAdminHlx: publishToAdminHlxStub,
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('run', () => {
    it('creates files for a new week successfully', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      // Folder exists, file doesn't exist
      mockDocument.exists
        .onCall(0).resolves(true) // agentic-traffic folder
        .onCall(1).resolves(false) // agentictraffic-w03-2026.xlsx
        .onCall(2).resolves(true) // brand-presence folder
        .onCall(3).resolves(false) // brandpresence-all-w03-2026.xlsx
        .onCall(4).resolves(true) // referral-traffic folder
        .onCall(5).resolves(false); // referral-traffic-w03-2026.xlsx

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.weekIdentifier).to.equal('w03-2026');
      expect(body.results).to.have.lengthOf(3);
      expect(body.results.every((r) => r.status === 'created')).to.be.true;
      expect(body.errors).to.have.lengthOf(0);
      expect(mockDocument.copy).to.have.been.calledThrice;
      expect(publishToAdminHlxStub).to.have.been.calledThrice;
    });

    it('skips files when week already exists in query-index', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      const message = { auditContext: { weekIdentifier: 'w02-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.weekIdentifier).to.equal('w02-2026');
      expect(body.results).to.have.lengthOf(3);
      expect(body.results.every((r) => r.status === 'skipped' && r.reason === 'already exists')).to.be.true;
      expect(mockDocument.copy).to.not.have.been.called;
    });

    it('skips files when they already exist in SharePoint', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      // Folder exists, file also exists
      mockDocument.exists.resolves(true);

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.results).to.have.lengthOf(3);
      expect(body.results.every((r) => r.status === 'skipped')).to.be.true;
      expect(mockDocument.copy).to.not.have.been.called;
    });

    it('reports error when destination folder does not exist', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      // Folder doesn't exist
      mockDocument.exists.resolves(false);

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.errors).to.have.lengthOf(3);
      expect(body.errors.every((e) => e.error.includes('does not exist'))).to.be.true;
    });

    it('reports error when no template files exist for a type', async () => {
      const emptyQueryIndex = { total: 0, data: [] };
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, emptyQueryIndex);

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.errors).to.have.lengthOf(3);
      expect(body.errors.every((e) => e.error.includes('No template file found'))).to.be.true;
    });

    it('calculates week identifier automatically when not provided', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      mockDocument.exists.resolves(true); // Skip all for simplicity

      const message = {};
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      // Week identifier should be calculated and match pattern wXX-YYYY
      expect(body.weekIdentifier).to.match(/^w\d{2}-\d{4}$/);
    });

    it('returns internal server error when query index fetch fails', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(500, 'Internal Server Error');

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(500);
    });

    it('handles copy failure gracefully', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, MOCK_QUERY_INDEX);

      mockDocument.exists
        .onCall(0).resolves(true) // folder exists
        .onCall(1).resolves(false); // file doesn't exist
      mockDocument.copy.rejects(new Error('SharePoint copy failed'));

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      expect(body.errors.length).to.be.greaterThan(0);
      expect(body.errors[0].error).to.include('SharePoint copy failed');
    });

    it('selects most recent template across different years', async () => {
      const multiYearIndex = {
        total: 4,
        data: [
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w52-2025.json', lastModified: '1' },
          { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2026.json', lastModified: '2' },
          { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2026.json', lastModified: '3' },
          { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2026.json', lastModified: '4' },
        ],
      };

      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, multiYearIndex);

      mockDocument.exists
        .onCall(0).resolves(true)
        .onCall(1).resolves(false)
        .onCall(2).resolves(true)
        .onCall(3).resolves(false)
        .onCall(4).resolves(true)
        .onCall(5).resolves(false);

      const message = { auditContext: { weekIdentifier: 'w02-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);

      // For agentic-traffic, w01-2026 should be selected over w52-2025
      const agenticResult = body.results.find((r) => r.folder === 'agentic-traffic');
      expect(agenticResult.templateWeek).to.equal('w01-2026');
    });
  });

  describe('edge cases for branch coverage', () => {
    it('handles query index response without data property', async () => {
      // Covers line 93: `return data.data || [];`
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, { total: 0 }); // No `data` property

      const message = { auditContext: { weekIdentifier: 'w03-2026' } };
      const result = await handler.run(message, context);

      expect(result.status).to.equal(200);
      const body = await getResponseBody(result);
      // All files should error because no templates found
      expect(body.errors).to.have.lengthOf(3);
      expect(body.errors.every((e) => e.error.includes('No template file found'))).to.be.true;
    });

    it('handles Sunday dates correctly (dayNum || 7 branch)', async () => {
      // Covers lines 158-159, 174-175: when getUTCDay() returns 0 (Sunday), use 7
      // January 4, 2026 is a Sunday
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, {
          total: 3,
          data: [
            { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2026.json', lastModified: '1' },
            { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2026.json', lastModified: '2' },
            { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2026.json', lastModified: '3' },
          ],
        });

      const originalDate = Date;
      // January 4, 2026 is a Sunday (week 1 of 2026)
      const fixedDate = new Date('2026-01-04T10:00:00Z');
      // eslint-disable-next-line no-global-assign
      Date = class extends originalDate {
        constructor(...args) {
          if (args.length === 0) {
            return fixedDate;
          }
          // eslint-disable-next-line prefer-rest-params
          return new originalDate(...args);
        }

        static now() {
          return fixedDate.getTime();
        }

        static UTC = originalDate.UTC;
      };

      try {
        const message = {};
        const result = await handler.run(message, context);

        expect(result.status).to.equal(200);
        const body = await getResponseBody(result);
        expect(body.weekIdentifier).to.equal('w01-2026');
      } finally {
        // eslint-disable-next-line no-global-assign
        Date = originalDate;
      }
    });
  });

  describe('ISO week calculation', () => {
    it('calculates week 3 for January 12, 2026', async () => {
      // Mock query index to return w02-2026 files so they are skipped
      // This avoids actual file operations and simplifies the test
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, {
          total: 3,
          data: [
            { path: '/frescopa.coffee/brand-presence/brandpresence-all-w03-2026.json', lastModified: '1' },
            { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w03-2026.json', lastModified: '2' },
            { path: '/frescopa.coffee/referral-traffic/referral-traffic-w03-2026.json', lastModified: '3' },
          ],
        });

      // Freeze date to January 12, 2026
      const originalDate = Date;
      const fixedDate = new Date('2026-01-12T10:00:00Z');
      // eslint-disable-next-line no-global-assign
      Date = class extends originalDate {
        constructor(...args) {
          if (args.length === 0) {
            return fixedDate;
          }
          // eslint-disable-next-line prefer-rest-params
          return new originalDate(...args);
        }

        static now() {
          return fixedDate.getTime();
        }

        static UTC = originalDate.UTC;
      };

      try {
        const message = {}; // No weekIdentifier, will be calculated
        const result = await handler.run(message, context);

        expect(result.status).to.equal(200);
        const body = await getResponseBody(result);
        expect(body.weekIdentifier).to.equal('w03-2026');
      } finally {
        // eslint-disable-next-line no-global-assign
        Date = originalDate;
      }
    });

    it('handles year boundary correctly (Dec 31, 2025 is week 1 of 2026)', async () => {
      nock(QUERY_INDEX_HOST)
        .get(QUERY_INDEX_PATH)
        .reply(200, {
          total: 3,
          data: [
            { path: '/frescopa.coffee/brand-presence/brandpresence-all-w01-2026.json', lastModified: '1' },
            { path: '/frescopa.coffee/agentic-traffic/agentictraffic-w01-2026.json', lastModified: '2' },
            { path: '/frescopa.coffee/referral-traffic/referral-traffic-w01-2026.json', lastModified: '3' },
          ],
        });

      // December 31, 2025 falls in ISO week 1 of 2026
      const originalDate = Date;
      const fixedDate = new Date('2025-12-31T10:00:00Z');
      // eslint-disable-next-line no-global-assign
      Date = class extends originalDate {
        constructor(...args) {
          if (args.length === 0) {
            return fixedDate;
          }
          // eslint-disable-next-line prefer-rest-params
          return new originalDate(...args);
        }

        static now() {
          return fixedDate.getTime();
        }

        static UTC = originalDate.UTC;
      };

      try {
        const message = {};
        const result = await handler.run(message, context);

        expect(result.status).to.equal(200);
        const body = await getResponseBody(result);
        expect(body.weekIdentifier).to.equal('w01-2026');
      } finally {
        // eslint-disable-next-line no-global-assign
        Date = originalDate;
      }
    });
  });
});
