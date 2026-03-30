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
import esmock from 'esmock';

use(sinonChai);

const SITE_ID = '00000000-0000-0000-0000-000000000001';
const ORG_ID = 'org-uuid-001';
const BRAND_UUID = 'brand-uuid-001';
const CAT_UUID = 'cat-uuid-001';
const TOPIC_UUID = 'topic-uuid-001';

function createPostgrestClient(sandbox) {
  const chainable = {
    select: sandbox.stub(),
    eq: sandbox.stub(),
    single: sandbox.stub(),
    upsert: sandbox.stub(),
    from: sandbox.stub(),
  };
  // Make every method return the chainable object for chaining
  Object.values(chainable).forEach((stub) => stub.returns(chainable));

  // Default upsert/select/single resolution
  chainable.single.resolves({ data: { id: BRAND_UUID }, error: null });
  chainable.upsert.returns(chainable);
  chainable.select.returns(chainable);
  chainable.eq.returns(chainable);

  return chainable;
}

function buildS3Config({
  categories = {},
  topics = {},
  aiTopics,
  deleted,
  ignored,
} = {}) {
  return {
    entities: {},
    categories,
    topics,
    ...(aiTopics !== undefined && { aiTopics }),
    brands: { aliases: [] },
    competitors: { competitors: [] },
    ...(deleted !== undefined && { deleted }),
    ...(ignored !== undefined && { ignored }),
  };
}

describe('LLMO Config DB Sync Handler', () => {
  let sandbox;
  let handler;
  let isSyncEnabledForSite;
  let context;
  let readConfigStub;
  let postgrestClient;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    readConfigStub = sandbox.stub();

    postgrestClient = createPostgrestClient(sandbox);

    const module = await esmock('../../src/llmo-config-db-sync/handler.js', {
      '@adobe/spacecat-shared-utils': {
        llmoConfig: { readConfig: readConfigStub },
      },
    });

    handler = module.default;
    isSyncEnabledForSite = module.isSyncEnabledForSite;

    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
      },
      env: {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
      },
      s3: {
        s3Client: {},
        s3Bucket: 'test-bucket',
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub(),
        },
        services: {
          postgrestClient,
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isSyncEnabledForSite', () => {
    it('returns true when siteId is in the hardcoded allowed list', () => {
      expect(isSyncEnabledForSite(SITE_ID)).to.be.true;
    });

    it('returns false when siteId is not in the allowed list', () => {
      expect(isSyncEnabledForSite('unknown-site-id')).to.be.false;
    });
  });

  describe('site ID gating', () => {
    it('skips sync when site is not in allowed list', async () => {
      const response = await handler(
        { siteId: 'unknown-site' },
        context,
      );
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.skipped).to.be.true;
      expect(body.reason).to.equal('site not in allowed list');
      expect(readConfigStub).to.not.have.been.called;
    });
  });

  describe('config not found', () => {
    it('returns ok with skipped when S3 config is missing', async () => {
      readConfigStub.resolves({ config: null });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.skipped).to.be.true;
      expect(body.reason).to.equal('no config found');
    });

    it('returns ok with skipped when readConfig returns undefined', async () => {
      readConfigStub.resolves(undefined);

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.skipped).to.be.true;
      expect(body.reason).to.equal('no config found');
    });
  });

  describe('site not found', () => {
    it('returns ok with skipped when site does not exist', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      context.dataAccess.Site.findById.resolves(null);

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.skipped).to.be.true;
      expect(body.reason).to.equal('site not found');
    });
  });

  describe('postgrest client not available', () => {
    it('returns 500 when postgrestClient is missing', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'TestBrand' }),
      });
      context.dataAccess.services.postgrestClient = null;

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });
  });

  describe('happy path - full sync', () => {
    let site;

    beforeEach(() => {
      site = {
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      };
      context.dataAccess.Site.findById.resolves(site);

      // Brand upsert chain
      postgrestClient.from.withArgs('brands').returns(postgrestClient);
      postgrestClient.single.resolves({ data: { id: BRAND_UUID }, error: null });

      // Categories/topics upsert resolve successfully
      postgrestClient.upsert.returns(postgrestClient);
      postgrestClient.select.returns(postgrestClient);
      postgrestClient.eq.returns(postgrestClient);

      // Default: resolve upserts with no error
      postgrestClient.upsert.returns({
        select: sandbox.stub().returns({
          single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
          eq: sandbox.stub().returns({
            data: [],
            error: null,
          }),
        }),
        error: null,
      });
    });

    it('syncs categories, topics, and prompts successfully', async () => {
      const s3Config = buildS3Config({
        categories: {
          'cat-1': { name: 'Category 1', origin: 'human', region: 'us' },
        },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [
              {
                id: 'prompt-1', prompt: 'What is AI?', regions: ['us'], origin: 'human', source: 'config',
              },
            ],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      // Brand upsert
      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      // Category upsert
      const catUpsertResult = { error: null };

      // Topic upsert
      const topicUpsertResult = { error: null };

      // Lookup maps
      const catLookupResult = {
        data: [{ id: CAT_UUID, category_id: 'cat-1' }],
        error: null,
      };
      const topicLookupResult = {
        data: [{ id: TOPIC_UUID, topic_id: 'topic-1' }],
        error: null,
      };

      // Prompt upsert
      const promptUpsertResult = { error: null };

      postgrestClient.from.callsFake((table) => {
        const chain = {
          upsert: sandbox.stub(),
          select: sandbox.stub(),
          eq: sandbox.stub(),
          single: sandbox.stub(),
        };

        chain.upsert.returns(chain);
        chain.select.returns(chain);
        chain.eq.returns(chain);

        if (table === 'brands') {
          chain.single.resolves({ data: { id: BRAND_UUID }, error: null });
          return chain;
        }
        if (table === 'categories') {
          // For upsert call
          chain.upsert.returns(catUpsertResult);
          // For lookup query
          chain.select.returns({
            eq: sandbox.stub().resolves(catLookupResult),
          });
          return chain;
        }
        if (table === 'topics') {
          chain.upsert.returns(topicUpsertResult);
          chain.select.returns({
            eq: sandbox.stub().resolves(topicLookupResult),
          });
          return chain;
        }
        if (table === 'prompts') {
          chain.upsert.returns(promptUpsertResult);
          return chain;
        }
        return chain;
      });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.equal(1);
      expect(body.topics).to.equal(1);
      expect(body.prompts).to.equal(1);
    });

    it('syncs with empty categories and topics', async () => {
      readConfigStub.resolves({ config: buildS3Config() });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        const chain = {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
        return chain;
      });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.equal(0);
      expect(body.topics).to.equal(0);
      expect(body.prompts).to.equal(0);
    });

    it('syncs deleted and ignored prompts', async () => {
      const s3Config = buildS3Config({
        categories: {
          'cat-1': { name: 'Category 1', region: 'us' },
        },
        deleted: {
          prompts: {
            'del-prompt-1': {
              prompt: 'Deleted prompt', regions: ['us'], origin: 'human', source: 'config', topic: 'topic-1', category: 'Category 1', categoryId: 'cat-1',
            },
          },
        },
        ignored: {
          prompts: {
            'ign-prompt-1': {
              prompt: 'Ignored prompt', region: 'us', source: 'gsc',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        const chain = {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({
              data: table === 'categories'
                ? [{ id: CAT_UUID, category_id: 'cat-1' }]
                : [],
              error: null,
            }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
        return chain;
      });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts).to.equal(2);
    });

    it('syncs aiTopics alongside regular topics', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [{ id: 'p1', prompt: 'Prompt 1', regions: ['us'] }],
          },
        },
        aiTopics: {
          'ai-topic-1': {
            name: 'AI Topic 1',
            category: 'cat-1',
            prompts: [{ id: 'p2', prompt: 'AI Prompt', regions: ['de'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.topics).to.equal(2);
      expect(body.prompts).to.equal(2);
    });

    it('uses default brand name when site config has no brand', async () => {
      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => undefined }),
      });
      readConfigStub.resolves({ config: buildS3Config() });

      let capturedBrandRow;
      const brandChain = {
        upsert: sandbox.stub().callsFake((row) => { capturedBrandRow = row; return brandChain; }),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);

      expect(response.status).to.equal(200);
      expect(capturedBrandRow).to.not.be.undefined;
      expect(capturedBrandRow.name).to.equal('default');
    });

    it('handles site config without getLlmoBrand method', async () => {
      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({}),
      });
      readConfigStub.resolves({ config: buildS3Config() });

      let capturedBrandRow;
      const brandChain = {
        upsert: sandbox.stub().callsFake((row) => { capturedBrandRow = row; return brandChain; }),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);

      expect(response.status).to.equal(200);
      expect(capturedBrandRow).to.not.be.undefined;
      expect(capturedBrandRow.name).to.equal('default');
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });
    });

    it('returns 500 when brand upsert fails', async () => {
      readConfigStub.resolves({ config: buildS3Config() });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: null, error: { message: 'DB error' } }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when category upsert fails', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Cat', region: 'us' } },
      });
      readConfigStub.resolves({ config: s3Config });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'categories') {
          return {
            upsert: sandbox.stub().returns({ error: { message: 'Category error' } }),
          };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when topic upsert fails', async () => {
      const s3Config = buildS3Config({
        topics: {
          't1': {
            name: 'T1', category: 'c1', prompts: [{ id: 'p1', prompt: 'P1', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'topics') {
          return {
            upsert: sandbox.stub().returns({ error: { message: 'Topic error' } }),
          };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when prompt upsert fails', async () => {
      const s3Config = buildS3Config({
        topics: {
          't1': {
            name: 'T1', category: 'c1', prompts: [{ id: 'p1', prompt: 'P1', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      let promptCallCount = 0;
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'prompts') {
          return {
            upsert: sandbox.stub().returns({ error: { message: 'Prompt error' } }),
          };
        }
        if (table === 'categories' || table === 'topics') {
          return {
            upsert: sandbox.stub().returns({ error: null }),
            select: sandbox.stub().returns({
              eq: sandbox.stub().resolves({ data: [], error: null }),
            }),
          };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when readConfig throws', async () => {
      readConfigStub.rejects(new Error('S3 failure'));

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });
  });

  describe('idempotency', () => {
    it('produces same result when run twice with same config', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1', region: 'us' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [{ id: 'p1', prompt: 'Q?', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({
              data: table === 'categories'
                ? [{ id: CAT_UUID, category_id: 'cat-1' }]
                : table === 'topics'
                  ? [{ id: TOPIC_UUID, topic_id: 'topic-1' }]
                  : [],
              error: null,
            }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response1 = await handler({ siteId: SITE_ID }, context);
      const body1 = await response1.json();

      const response2 = await handler({ siteId: SITE_ID }, context);
      const body2 = await response2.json();

      expect(body1).to.deep.equal(body2);
    });
  });

  describe('config with missing categories field', () => {
    it('handles S3 config that has no categories key', async () => {
      const s3Config = {
        entities: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      readConfigStub.resolves({ config: s3Config });

      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.equal(0);
    });
  });

  describe('lookup maps with null data', () => {
    it('handles null data from category and topic queries', async () => {
      const s3Config = buildS3Config({
        topics: {
          't1': {
            name: 'T1', prompts: [{ id: 'p1', prompt: 'Q', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'prompts') {
          return { upsert: sandbox.stub().returns({ error: null }) };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: null, error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(200);
    });
  });

  describe('s3 context fallback', () => {
    it('uses S3_IMPORTER_BUCKET_NAME when s3Bucket is not available', async () => {
      context.s3 = { s3Client: {}, s3Bucket: undefined };
      readConfigStub.resolves({ config: null });

      await handler({ siteId: SITE_ID }, context);

      expect(readConfigStub).to.have.been.calledOnce;
      const callArgs = readConfigStub.firstCall.args;
      expect(callArgs[2].s3Bucket).to.equal('test-bucket');
    });

    it('handles missing s3 context gracefully', async () => {
      context.s3 = undefined;
      readConfigStub.resolves({ config: null });

      await handler({ siteId: SITE_ID }, context);

      expect(readConfigStub).to.have.been.calledOnce;
    });
  });

  describe('prompt collection edge cases', () => {
    function setupBasicMocks() {
      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      let capturedPromptRows;
      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'prompts') {
          return {
            upsert: sandbox.stub().callsFake((rows) => {
              capturedPromptRows = rows;
              return { error: null };
            }),
          };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      return () => capturedPromptRows;
    }

    it('handles topic without a category field', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-no-cat': {
            name: 'No Category Topic',
            prompts: [{ id: 'p1', prompt: 'Q?', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows).to.have.length(1);
      expect(rows[0].category_id).to.be.null;
    });

    it('handles prompt with empty prompt text (name fallback to id)', async () => {
      const s3Config = buildS3Config({
        topics: {
          't1': {
            name: 'T1',
            prompts: [{ id: 'p-custom', prompt: '', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows).to.have.length(1);
      expect(rows[0].name).to.equal('p-custom');
    });

    it('handles prompt with no regions, no origin, no source', async () => {
      const s3Config = buildS3Config({
        topics: {
          't1': {
            name: 'T1',
            prompts: [{ id: 'p1', prompt: 'Hello' }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].regions).to.deep.equal([]);
      expect(rows[0].origin).to.equal('human');
      expect(rows[0].source).to.equal('config');
    });

    it('handles deleted prompt without categoryId', async () => {
      const s3Config = buildS3Config({
        deleted: {
          prompts: {
            'del-1': {
              prompt: 'Deleted', topic: 'T1', category: 'Cat1',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows).to.have.length(1);
      expect(rows[0].category_id).to.be.null;
      expect(rows[0].status).to.equal('deleted');
      expect(rows[0].regions).to.deep.equal([]);
      expect(rows[0].origin).to.equal('human');
      expect(rows[0].source).to.equal('config');
    });

    it('handles deleted prompt with explicit origin and source', async () => {
      const s3Config = buildS3Config({
        deleted: {
          prompts: {
            'del-2': {
              prompt: 'Deleted AI',
              regions: ['de'],
              origin: 'ai',
              source: 'api',
              topic: 'T1',
              category: 'Cat1',
              categoryId: 'cat-1',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].origin).to.equal('ai');
      expect(rows[0].source).to.equal('api');
      expect(rows[0].regions).to.deep.equal(['de']);
    });

    it('handles ignored prompt without region', async () => {
      const s3Config = buildS3Config({
        ignored: {
          prompts: {
            'ign-no-region': { prompt: 'No region', source: 'gsc' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].regions).to.deep.equal([]);
    });

    it('handles ignored prompt without source', async () => {
      const s3Config = buildS3Config({
        ignored: {
          prompts: {
            'ign-no-src': { prompt: 'No source', region: 'us' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].source).to.equal('gsc');
    });

    it('handles topic with no prompts array', async () => {
      const s3Config = buildS3Config({
        topics: {
          't-empty': { name: 'Empty Topic' },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      expect(body.prompts).to.equal(0);
    });

    it('handles deleted prompt with empty prompt text', async () => {
      const s3Config = buildS3Config({
        deleted: {
          prompts: {
            'del-empty': {
              prompt: '', topic: 'T', category: 'C',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].name).to.equal('del-empty');
    });

    it('handles ignored prompt with empty prompt text', async () => {
      const s3Config = buildS3Config({
        ignored: {
          prompts: {
            'ign-empty': { prompt: '', region: 'us', source: 'gsc' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      await handler({ siteId: SITE_ID }, context);

      const rows = getRows();
      expect(rows[0].name).to.equal('ign-empty');
    });

    it('skips prompts without an id and logs an error', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [
              { prompt: 'No ID prompt', regions: ['us'] },
              { id: 'p-valid', prompt: 'Has ID', regions: ['us'] },
            ],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const getRows = setupBasicMocks();

      const response = await handler({ siteId: SITE_ID }, context);
      const body = await response.json();

      const rows = getRows();
      expect(rows).to.have.length(1);
      expect(rows[0].prompt_id).to.equal('p-valid');
      expect(body.prompts).to.equal(1);
      expect(context.log.error).to.have.been.calledWith(
        '[llmo-config-db-sync] Skipping prompt without id in topic "topic-1" at index 0',
      );
    });

    it('handles ignored prompts with single region string', async () => {
      const s3Config = buildS3Config({
        ignored: {
          prompts: {
            'ign-1': { prompt: 'Ignored', region: 'de', source: 'gsc' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      let capturedPromptRows;
      const brandChain = {
        upsert: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
      };

      postgrestClient.from.callsFake((table) => {
        if (table === 'brands') return brandChain;
        if (table === 'prompts') {
          return {
            upsert: sandbox.stub().callsFake((rows) => {
              capturedPromptRows = rows;
              return { error: null };
            }),
          };
        }
        return {
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().resolves({ data: [], error: null }),
          }),
          eq: sandbox.stub().returnsThis(),
        };
      });

      await handler({ siteId: SITE_ID }, context);

      expect(capturedPromptRows).to.have.length(1);
      expect(capturedPromptRows[0].regions).to.deep.equal(['de']);
      expect(capturedPromptRows[0].status).to.equal('ignored');
    });
  });

  describe('dry-run mode', () => {
    let upsertCalls;

    beforeEach(() => {
      upsertCalls = [];

      context.dataAccess.Site.findById.resolves({
        getOrganizationId: () => ORG_ID,
        getConfig: () => ({ getLlmoBrand: () => 'Adobe' }),
      });

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        const chain = {
          upsert: sandbox.stub().callsFake((rows, opts) => {
            upsertCalls.push({ table, rows, opts });
            return chain;
          }),
          select: sandbox.stub().callsFake(() => {
            if (table === 'brands') return chain;
            return {
              eq: sandbox.stub().resolves({
                data: table === 'categories'
                  ? [{ id: CAT_UUID, category_id: 'cat-1' }]
                  : table === 'topics'
                    ? [{ id: TOPIC_UUID, topic_id: 'topic-1' }]
                    : [],
                error: null,
              }),
            };
          }),
          eq: sandbox.stub().callsFake(() => chain),
          single: sandbox.stub().resolves({ data: { id: BRAND_UUID }, error: null }),
        };
        return chain;
      });
    });

    it('does not upsert any data when dryRun is true', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1', origin: 'human' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [{ id: 'p1', prompt: 'What is AI?', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const response = await handler({ siteId: SITE_ID, dryRun: true }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.true;
      expect(body.categories).to.equal(1);
      expect(body.topics).to.equal(1);
      expect(body.prompts).to.equal(1);
      expect(upsertCalls).to.have.length(0);
    });

    it('logs sample rows for each entity type in dry-run', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Cat 1' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [{ id: 'p1', prompt: 'Q?', regions: ['us'] }],
          },
        },
        deleted: {
          prompts: { 'del-1': { prompt: 'Deleted', topic: 'T' } },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      await handler({ siteId: SITE_ID, dryRun: true }, context);

      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes('[DRY RUN] Would upsert brand'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] categories sample'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] topics sample'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] prompts sample'))).to.be.true;
    });

    it('uses existing brand ID when available in dry-run', async () => {
      readConfigStub.resolves({ config: buildS3Config() });

      const response = await handler({ siteId: SITE_ID, dryRun: true }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.true;
      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes(`Resolved brand ID: ${BRAND_UUID}`))).to.be.true;
    });

    it('falls back to placeholder brand ID when brand does not exist in dry-run', async () => {
      readConfigStub.resolves({ config: buildS3Config() });

      postgrestClient.from.resetBehavior();
      postgrestClient.from.callsFake((table) => {
        const chain = {
          upsert: sandbox.stub().callsFake(() => chain),
          select: sandbox.stub().callsFake(() => {
            if (table === 'brands') return chain;
            return {
              eq: sandbox.stub().resolves({ data: [], error: null }),
            };
          }),
          eq: sandbox.stub().callsFake(() => chain),
          single: sandbox.stub().resolves({ data: null, error: null }),
        };
        return chain;
      });

      const response = await handler({ siteId: SITE_ID, dryRun: true }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.true;
      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes('Resolved brand ID: dry-run-brand-id'))).to.be.true;
    });

    it('returns stats without dryRun flag when dryRun is false', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Cat 1' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            prompts: [{ id: 'p1', prompt: 'Q?', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.undefined;
    });
  });
});
