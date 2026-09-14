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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { calculateWeeklyCronSchedule } from '../../src/utils/content-ai.js';

use(sinonChai);
use(chaiAsPromised);

const jsonResponse = (sandbox, body, overrides = {}) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: sandbox.stub().resolves(body),
  ...overrides,
});

describe('Content AI Utils', () => {
  describe('calculateWeeklyCronSchedule', () => {
    let clock;

    afterEach(() => {
      clock?.restore();
    });

    it('increments the day when the next hour is midnight', () => {
      clock = sinon.useFakeTimers(new Date('2025-01-14T23:30:00').getTime());
      expect(calculateWeeklyCronSchedule()).to.equal('0 0 * * 3');
    });

    it('wraps Saturday to Sunday', () => {
      clock = sinon.useFakeTimers(new Date('2025-01-18T23:30:00').getTime());
      expect(calculateWeeklyCronSchedule()).to.equal('0 0 * * 0');
    });

    it('keeps the day when the next hour is not midnight', () => {
      clock = sinon.useFakeTimers(new Date('2025-01-14T15:30:00').getTime());
      expect(calculateWeeklyCronSchedule()).to.equal('0 16 * * 2');
    });
  });

  describe('ContentAIClient', () => {
    let sandbox;
    let context;
    let site;
    let siteConfig;
    let mockFetch;
    let mockImsClient;
    let toDynamoItem;
    let ContentAIClient;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      mockFetch = sandbox.stub(globalThis, 'fetch');
      mockImsClient = {
        getServiceAccessTokenV3: sandbox.stub().resolves({
          access_token: 'test-access-token',
          token_type: 'Bearer',
        }),
      };
      toDynamoItem = sandbox.stub().returns({ contentAiConfig: { name: 'example-source' } });

      ({ ContentAIClient } = await esmock('../../src/utils/content-ai.js', {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns(mockImsClient),
          },
        },
        '@adobe/spacecat-shared-data-access/src/models/site/config.js': {
          Config: { toDynamoItem },
        },
      }));

      siteConfig = {
        getContentAiConfig: sandbox.stub().returns(undefined),
        getFetchConfig: sandbox.stub().returns({}),
        updateContentAiConfig: sandbox.stub(),
      };
      site = {
        getId: sandbox.stub().returns('site-123'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getConfig: sandbox.stub().returns(siteConfig),
        setConfig: sandbox.stub(),
        save: sandbox.stub().resolves(),
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
    });

    async function createClient() {
      const client = new ContentAIClient(context);
      await client.initialize();
      return client;
    }

    describe('initialization', () => {
      it('fetches an IMS token', async () => {
        await createClient();
        expect(mockImsClient.getServiceAccessTokenV3).to.have.been.calledOnce;
      });

      it('returns itself after initialization', async () => {
        const client = new ContentAIClient(context);
        expect(await client.initialize()).to.equal(client);
      });

      it('propagates IMS failures', async () => {
        mockImsClient.getServiceAccessTokenV3.rejects(new Error('IMS error'));
        await expect(new ContentAIClient(context).initialize()).to.be.rejectedWith('IMS error');
      });

      it('rejects requests before initialization', async () => {
        const client = new ContentAIClient(context);
        await expect(client.listAcquisitionContentSources())
          .to.be.rejectedWith('ContentAIClient not initialized');
      });
    });

    describe('listAcquisitionContentSources', () => {
      it('collects pages and URL-encodes cursors', async () => {
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, {
          items: [{ name: 'one' }],
          cursor: 'next page/+',
        }));
        mockFetch.onSecondCall().resolves(jsonResponse(sandbox, {
          items: [{ name: 'two' }],
        }));

        const sources = await (await createClient()).listAcquisitionContentSources();

        expect(sources).to.deep.equal([{ name: 'one' }, { name: 'two' }]);
        expect(mockFetch.firstCall.args[0].toString())
          .to.equal('https://contentai.example.com/content-sources/acquisition?limit=50');
        expect(mockFetch.secondCall.args[0].searchParams.get('cursor')).to.equal('next page/+');
        expect(mockFetch.firstCall.args[1].headers.Authorization)
          .to.equal('Bearer test-access-token');
      });

      it('accepts a page without items', async () => {
        mockFetch.resolves(jsonResponse(sandbox, {}));
        expect(await (await createClient()).listAcquisitionContentSources()).to.deep.equal([]);
      });

      it('surfaces RFC 7807 details', async () => {
        mockFetch.resolves(jsonResponse(sandbox, { detail: 'Access denied' }, {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        }));

        await expect((await createClient()).listAcquisitionContentSources())
          .to.be.rejectedWith('Failed to list Content AI acquisition sources: 403 Access denied');
      });

      it('falls back to status text for non-JSON errors', async () => {
        mockFetch.resolves({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: sandbox.stub().rejects(new Error('not json')),
        });

        await expect((await createClient()).listAcquisitionContentSources())
          .to.be.rejectedWith('503 Service Unavailable');
      });
    });

    describe('resolveContentSourceName', () => {
      it('uses the persisted name without discovery', async () => {
        siteConfig.getContentAiConfig.returns({ name: 'persisted-source' });

        expect(await (await createClient()).resolveContentSourceName(site))
          .to.equal('persisted-source');
        expect(mockFetch).not.to.have.been.called;
      });

      it('discovers and persists a matching source while preserving the legacy index', async () => {
        siteConfig.getContentAiConfig.returns({ index: 'legacy-index' });
        siteConfig.updateContentAiConfig.callsFake(({ name }) => {
          siteConfig.getContentAiConfig.returns({
            index: 'legacy-index',
            name,
          });
        });
        toDynamoItem.callsFake((config) => ({
          contentAiConfig: config.getContentAiConfig(),
        }));
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'example-source',
            acquisitionConfig: { baseUrl: 'https://example.com/' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site))
          .to.equal('example-source');
        expect(siteConfig.updateContentAiConfig).to.have.been.calledOnceWith({
          name: 'example-source',
        });
        expect(site.setConfig).to.have.been.calledOnceWith({
          contentAiConfig: {
            index: 'legacy-index',
            name: 'example-source',
          },
        });
        expect(site.save).to.have.been.calledOnce;
      });

      it('matches sources that differ only by www hostname', async () => {
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'www-source',
            acquisitionConfig: { baseUrl: 'https://www.example.com' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site)).to.equal('www-source');
      });

      it('preserves explicit ports while matching source URLs', async () => {
        site.getBaseURL.returns('https://example.com:8443');
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'port-source',
            acquisitionConfig: { baseUrl: 'https://www.example.com:8443/' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site)).to.equal('port-source');
      });

      it('matches the override URL before the base URL', async () => {
        siteConfig.getFetchConfig.returns({ overrideBaseURL: 'https://override.example.com/' });
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'override-source',
            acquisitionConfig: { baseUrl: 'https://override.example.com' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site))
          .to.equal('override-source');
      });

      it('matches non-URL override values exactly', async () => {
        siteConfig.getFetchConfig.returns({ overrideBaseURL: 'override.example.com' });
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'invalid-url-source',
            acquisitionConfig: { baseUrl: 'override.example.com' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site))
          .to.equal('invalid-url-source');
      });

      it('ignores sources without a base URL', async () => {
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{ name: 'missing-base-url', acquisitionConfig: {} }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site)).to.be.null;
        expect(site.save).not.to.have.been.called;
      });

      it('returns null when no source matches', async () => {
        mockFetch.resolves(jsonResponse(sandbox, {
          items: [{
            name: 'other-source',
            acquisitionConfig: { baseUrl: 'https://other.example.com' },
          }],
        }));

        expect(await (await createClient()).resolveContentSourceName(site)).to.be.null;
      });
    });

    describe('createAcquisitionContentSource', () => {
      it('returns a persisted source without making a request', async () => {
        siteConfig.getContentAiConfig.returns({ name: 'persisted-source' });
        const client = await createClient();

        expect(await client.createAcquisitionContentSource(site)).to.equal('persisted-source');
        expect(mockFetch).not.to.have.been.called;
      });

      it('creates an acquisition source and persists its normalized name', async () => {
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, { items: [] }));
        mockFetch.onSecondCall().resolves(jsonResponse(sandbox, {
          name: 'example-com',
        }, { status: 201, statusText: 'Created' }));
        const client = await createClient();

        expect(await client.createAcquisitionContentSource(site)).to.equal('example-com');
        const [url, options] = mockFetch.secondCall.args;
        const body = JSON.parse(options.body);
        expect(url).to.equal('https://contentai.example.com/content-sources/acquisition');
        expect(body).to.deep.include({
          name: 'example.com',
          description: 'Content acquired from https://example.com',
        });
        expect(body.acquisitionConfig).to.deep.include({
          baseUrl: 'https://example.com',
          discovery: { includePdfs: true },
        });
        expect(body.acquisitionConfig.schedule.enabled).to.be.true;
        expect(siteConfig.updateContentAiConfig).to.have.been.calledWith({ name: 'example-com' });
      });

      it('creates a source for the override URL', async () => {
        siteConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.override.example.com' });
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, { items: [] }));
        mockFetch.onSecondCall().resolves(jsonResponse(sandbox, {
          name: 'override-example-com',
        }, { status: 201 }));

        await (await createClient()).createAcquisitionContentSource(site);

        const body = JSON.parse(mockFetch.secondCall.args[1].body);
        expect(body.name).to.equal('override.example.com');
        expect(body.acquisitionConfig.baseUrl).to.equal('https://www.override.example.com');
      });

      it('recovers a creation conflict by discovering and persisting the source', async () => {
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, { items: [] }));
        mockFetch.onSecondCall().resolves(jsonResponse(sandbox, { detail: 'Conflict' }, {
          ok: false,
          status: 409,
          statusText: 'Conflict',
        }));
        mockFetch.onThirdCall().resolves(jsonResponse(sandbox, {
          items: [{
            name: 'existing-source',
            acquisitionConfig: { baseUrl: 'https://example.com' },
          }],
        }));

        expect(await (await createClient()).createAcquisitionContentSource(site))
          .to.equal('existing-source');
        expect(siteConfig.updateContentAiConfig).to.have.been.calledWith({
          name: 'existing-source',
        });
      });

      it('surfaces an unresolved creation conflict', async () => {
        const conflict = jsonResponse(sandbox, { detail: 'Name already exists' }, {
          ok: false,
          status: 409,
          statusText: 'Conflict',
        });
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, { items: [] }));
        mockFetch.onSecondCall().resolves(conflict);
        mockFetch.onThirdCall().resolves(jsonResponse(sandbox, { items: [] }));

        await expect((await createClient()).createAcquisitionContentSource(site))
          .to.be.rejectedWith('409 Name already exists');
      });

      it('rejects a successful response without a source name', async () => {
        mockFetch.onFirstCall().resolves(jsonResponse(sandbox, { items: [] }));
        mockFetch.onSecondCall().resolves(jsonResponse(sandbox, {}, { status: 201 }));

        await expect((await createClient()).createAcquisitionContentSource(site))
          .to.be.rejectedWith('did not include a name');
      });
    });

    describe('searchContentSource', () => {
      it('searches a named acquisition source', async () => {
        mockFetch.resolves(jsonResponse(sandbox, {
          totalResults: 1,
          results: [{ id: 'document-1' }],
        }));
        const options = {
          boost: 1,
          qualityConfig: { quality: 'FAST', size: 1 },
        };

        const result = await (await createClient())
          .searchContentSource('example-source', 'website', options, 1);

        expect(result.totalResults).to.equal(1);
        const [url, fetchOptions] = mockFetch.firstCall.args;
        expect(url).to.equal('https://contentai.example.com/content-sources/search');
        expect(JSON.parse(fetchOptions.body)).to.deep.equal({
          contentSource: { name: 'example-source', type: 'ACQUISITION' },
          query: { type: 'vector', text: 'website', options },
          queryOptions: { pagination: { limit: 1 } },
        });
      });

      it('returns null for a successful no-content response', async () => {
        mockFetch.resolves({ ok: true, status: 204, statusText: 'No Content' });
        expect(await (await createClient()).searchContentSource('source', 'query')).to.be.null;
      });

      it('surfaces search problem details', async () => {
        mockFetch.resolves(jsonResponse(sandbox, { detail: 'Invalid query' }, {
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
        }));

        await expect((await createClient()).searchContentSource('source', 'query'))
          .to.be.rejectedWith('Content AI search failed for source source: 422 Invalid query');
      });
    });
  });
});
