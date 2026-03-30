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
const BRAND_UUID = '3e3556f0-6494-4e8f-858f-01f2c358861a';
const CAT_UUID = 'cat-uuid-001';
const TOPIC_UUID = 'topic-uuid-001';

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

/**
 * Creates a postgrestClient mock where .from(table) returns a chain
 * configured per table via the tableHandlers map.
 *
 * Each tableHandler should return an object with the needed chain methods.
 * Defaults handle brands (select chain) and all other tables (empty data).
 */
function buildPostgrestMock(sandbox, tableHandlers = {}) {
  const emptyResult = () => Object.assign(
    Promise.resolve({ data: [], error: null }),
    { range: sandbox.stub().resolves({ data: [], error: null }) },
  );
  const defaultChain = () => ({
    upsert: sandbox.stub().returnsThis(),
    select: sandbox.stub().returns({ eq: sandbox.stub().callsFake(emptyResult) }),
    eq: sandbox.stub().returnsThis(),
  });

  const from = sandbox.stub();
  from.callsFake((table) => {
    if (tableHandlers[table]) return tableHandlers[table](table);
    return defaultChain();
  });

  return { from };
}

describe('LLMO Config DB Sync Handler', () => {
  let sandbox;
  let handler;
  let isSyncEnabledForSite;
  let context;
  let readConfigStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    readConfigStub = sandbox.stub();

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
      s3Client: {},
      dataAccess: {
        Site: {
          findById: sandbox.stub(),
        },
        services: {
          postgrestClient: buildPostgrestMock(sandbox),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  function setupSite() {
    context.dataAccess.Site.findById.resolves({
      getOrganizationId: () => ORG_ID,
      getConfig: () => ({}),
    });
  }

  /**
   * Helper that sets up postgrestClient.from to handle all tables
   * with configurable existing data and captured upsert rows.
   */
  function setupFullMocks({
    existingCats = [],
    existingTopics = [],
    existingPrompts = [],
    catFetchNullData = false,
    topicFetchNullData = false,
    promptFetchNullData = false,
    catUpsertError = null,
    catUpsertNullData = false,
    topicUpsertError = null,
    topicUpsertNullData = false,
    promptUpsertError = null,
  } = {}) {
    setupSite();

    const captured = { categories: null, topics: null, prompts: null };

    context.dataAccess.services.postgrestClient = buildPostgrestMock(sandbox, {
      categories: () => ({
        upsert: sandbox.stub().callsFake((rows) => {
          captured.categories = rows;
          return {
            select: sandbox.stub().resolves({
              // eslint-disable-next-line no-nested-ternary
              data: catUpsertError || catUpsertNullData
                ? null
                : rows.map((r) => ({ id: `cat-new-${r.category_id}`, category_id: r.category_id })),
              error: catUpsertError,
            }),
          };
        }),
        select: sandbox.stub().returns({
          eq: sandbox.stub().resolves({ data: catFetchNullData ? null : existingCats, error: null }),
        }),
        eq: sandbox.stub().returnsThis(),
      }),

      topics: () => ({
        upsert: sandbox.stub().callsFake((rows) => {
          captured.topics = rows;
          return {
            select: sandbox.stub().resolves({
              // eslint-disable-next-line no-nested-ternary
              data: topicUpsertError || topicUpsertNullData
                ? null
                : rows.map((r) => ({ id: `topic-new-${r.topic_id}`, topic_id: r.topic_id })),
              error: topicUpsertError,
            }),
          };
        }),
        select: sandbox.stub().returns({
          eq: sandbox.stub().resolves({ data: topicFetchNullData ? null : existingTopics, error: null }),
        }),
        eq: sandbox.stub().returnsThis(),
      }),

      prompts: () => ({
        upsert: sandbox.stub().callsFake((rows) => {
          captured.prompts = rows;
          return { error: promptUpsertError };
        }),
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            range: sandbox.stub().resolves({ data: promptFetchNullData ? null : existingPrompts, error: null }),
          }),
        }),
      }),
    });

    return captured;
  }

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
      const response = await handler({ siteId: 'unknown-site' }, context);
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
      setupSite();
      context.dataAccess.services.postgrestClient = null;

      const response = await handler({ siteId: SITE_ID }, context);
      expect(response.status).to.equal(500);
    });
  });

  describe('happy path - full sync', () => {
    it('inserts new categories, topics, and prompts', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1', origin: 'human' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            category: 'cat-1',
            prompts: [{ prompt: 'What is AI?', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.deep.equal({ inserted: 1, updated: 0, unchanged: 0 });
      expect(body.topics).to.deep.equal({ inserted: 1, updated: 0, unchanged: 0 });
      expect(body.prompts).to.deep.equal({ inserted: 1, updated: 0, unchanged: 0 });
      expect(captured.categories).to.have.length(1);
      expect(captured.topics).to.have.length(1);
      expect(captured.prompts).to.have.length(1);
    });

    it('skips unchanged rows', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1', origin: 'human' } },
        topics: {
          'topic-1': {
            name: 'Topic 1',
            prompts: [{ prompt: 'Existing prompt', regions: ['us'], origin: 'human', source: 'config' }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingCats: [{
          id: CAT_UUID, category_id: 'cat-1', name: 'Category 1', origin: 'human', status: 'active', created_by: null, updated_by: null,
        }],
        existingTopics: [{
          id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null,
        }],
        existingPrompts: [{
          prompt_id: 'existing-pid', brand_id: BRAND_UUID, text: 'Existing prompt', topic_id: TOPIC_UUID,
          name: 'Existing prompt', regions: ['US'], category_id: null,
          status: 'active', origin: 'human', source: 'config',
          created_by: null, updated_by: null,
        }],
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.deep.equal({ inserted: 0, updated: 0, unchanged: 1 });
      expect(body.topics).to.deep.equal({ inserted: 0, updated: 0, unchanged: 1 });
      expect(body.prompts).to.deep.equal({ inserted: 0, updated: 0, unchanged: 1 });
      expect(captured.categories).to.be.null;
      expect(captured.topics).to.be.null;
      expect(captured.prompts).to.be.null;
    });

    it('detects updated rows', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Renamed Category', origin: 'human' } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingCats: [{
          id: CAT_UUID, category_id: 'cat-1', name: 'Old Name', origin: 'human', status: 'active', created_by: null, updated_by: null,
        }],
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.deep.equal({ inserted: 0, updated: 1, unchanged: 0 });
      expect(captured.categories).to.have.length(1);
      expect(captured.categories[0].name).to.equal('Renamed Category');
    });

    it('syncs with empty categories and topics', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories).to.deep.equal({ inserted: 0, updated: 0, unchanged: 0 });
      expect(body.topics).to.deep.equal({ inserted: 0, updated: 0, unchanged: 0 });
      expect(body.prompts).to.deep.equal({ inserted: 0, updated: 0, unchanged: 0 });
    });

    it('handles null data from categories fetch', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupFullMocks({ catFetchNullData: true });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
    });

    it('handles null data from topics fetch', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupFullMocks({ topicFetchNullData: true });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
    });

    it('syncs deleted prompts when topic resolves', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1' } },
        topics: { 'topic-1': { name: 'Topic 1', prompts: [] } },
        deleted: {
          prompts: {
            'del-prompt-1': {
              prompt: 'Deleted prompt', regions: ['us'], origin: 'human', source: 'config', topic: 'topic-1', categoryId: 'cat-1',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingCats: [{ id: CAT_UUID, category_id: 'cat-1', name: 'Category 1', origin: 'human', status: 'active', created_by: null, updated_by: null }],
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts.inserted).to.equal(1);
      expect(captured.prompts[0].status).to.equal('deleted');
      expect(captured.prompts[0].topic_id).to.equal(TOPIC_UUID);
      expect(captured.prompts[0].category_id).to.equal(CAT_UUID);
    });

    it('skips deleted prompts when topic does not resolve', async () => {
      const s3Config = buildS3Config({
        deleted: {
          prompts: {
            'del-prompt-1': { prompt: 'Deleted prompt', regions: ['us'], topic: 'unknown-topic' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts.inserted).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        'Skipping deleted prompt "del-prompt-1": topic not resolved',
      );
    });

    it('skips deleted prompts when topic field is absent', async () => {
      const s3Config = buildS3Config({
        deleted: {
          prompts: {
            'del-prompt-1': { prompt: 'Deleted prompt', regions: ['us'] },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts.inserted).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        'Skipping deleted prompt "del-prompt-1": topic not resolved',
      );
    });

    it('uses configPromptId as name fallback when deleted prompt has no text', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [] } },
        deleted: {
          prompts: {
            'del-prompt-config-id': { topic: 'topic-1' },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
      });

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts[0].name).to.equal('del-prompt-config-id');
      expect(captured.prompts[0].regions).to.deep.equal([]);
    });

    it('uses existing prompt_id from DB for matching deleted prompt', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [] } },
        deleted: {
          prompts: {
            'del-prompt-config-id': {
              prompt: 'Deleted prompt', regions: ['us'], topic: 'topic-1',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
        existingPrompts: [{
          prompt_id: 'existing-db-pid', brand_id: BRAND_UUID, text: 'Deleted prompt', topic_id: TOPIC_UUID,
          name: 'Deleted prompt', regions: ['US'], category_id: null,
          status: 'active', origin: 'human', source: 'config',
          created_by: null, updated_by: null,
        }],
      });

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts[0].prompt_id).to.equal('existing-db-pid');
    });

    it('sets null categoryUuid for deleted prompt when categoryId is not in lookup', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [] } },
        deleted: {
          prompts: {
            'del-prompt-1': {
              prompt: 'Deleted prompt', regions: ['us'], topic: 'topic-1', categoryId: 'unknown-cat',
            },
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
      });

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts[0].category_id).to.be.null;
    });

    it('handles null catData returned from category upsert', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1' } },
        topics: { 'topic-1': { name: 'Topic 1', category: 'cat-1', prompts: [{ prompt: 'Q?', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({ catUpsertNullData: true });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
    });

    it('handles null topicData returned from topic upsert', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'Q?', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({ topicUpsertNullData: true });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
    });

    it('syncs aiTopics alongside regular topics', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'P1', regions: ['us'] }] },
        },
        aiTopics: {
          'ai-topic-1': { name: 'AI Topic 1', prompts: [{ prompt: 'AI P', regions: ['de'] }] },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.topics.inserted).to.equal(2);
      expect(body.prompts.inserted).to.equal(2);
    });

  });

  describe('error handling', () => {
    it('returns 500 when category upsert fails', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Cat' } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({ catUpsertError: { message: 'Category error' } });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when topic upsert fails', async () => {
      const s3Config = buildS3Config({
        topics: { 't1': { name: 'T1', prompts: [{ prompt: 'P', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({ topicUpsertError: { message: 'Topic error' } });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when prompt upsert fails', async () => {
      const s3Config = buildS3Config({
        topics: { 't1': { name: 'T1', prompts: [{ prompt: 'P', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({ promptUpsertError: { message: 'Prompt error' } });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      expect(response.status).to.equal(500);
    });

    it('returns 500 when readConfig throws', async () => {
      readConfigStub.rejects(new Error('S3 failure'));
      setupSite();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      expect(response.status).to.equal(500);
    });
  });

  describe('idempotency', () => {
    it('produces same result when run twice with same config', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1' } },
        topics: {
          'topic-1': { name: 'Topic 1', category: 'cat-1', prompts: [{ prompt: 'Q?', regions: ['us'] }] },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response1 = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body1 = await response1.json();

      const response2 = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body2 = await response2.json();

      expect(body1).to.deep.equal(body2);
    });
  });

  describe('config with missing categories field', () => {
    it('handles S3 config that has no categories key', async () => {
      const s3Config = { entities: {}, topics: {}, brands: { aliases: [] }, competitors: { competitors: [] } };
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.categories.inserted).to.equal(0);
    });
  });

  describe('s3 client usage', () => {
    it('passes s3Client from context and bucket from env to readConfig', async () => {
      readConfigStub.resolves({ config: null });

      await handler({ siteId: SITE_ID }, context);

      expect(readConfigStub).to.have.been.calledOnce;
      const callArgs = readConfigStub.firstCall.args;
      expect(callArgs[0]).to.equal(SITE_ID);
      expect(callArgs[1]).to.equal(context.s3Client);
      expect(callArgs[2].s3Bucket).to.equal('test-bucket');
    });
  });

  describe('fetchPromptsBatched', () => {
    it('logs error and returns partial results when a batch fetch fails', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupSite();

      context.dataAccess.services.postgrestClient = buildPostgrestMock(sandbox, {
        prompts: () => ({
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              range: sandbox.stub().resolves({ data: null, error: { message: 'DB timeout' } }),
            }),
          }),
        }),
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
      expect(context.log.error).to.have.been.calledWith(
        'Failed to fetch prompts at offset 0: DB timeout',
      );
    });

    it('paginates when first batch returns exactly FETCH_BATCH_SIZE rows', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupSite();

      const FETCH_BATCH_SIZE = 5000;
      const fullBatch = Array.from({ length: FETCH_BATCH_SIZE }, (_, i) => ({
        prompt_id: `pid-${i}`, brand_id: BRAND_UUID, text: `prompt ${i}`, topic_id: null,
        name: `prompt ${i}`, regions: [], category_id: null,
        status: 'active', origin: 'human', source: 'config',
        created_by: null, updated_by: null,
      }));
      const rangeStub = sandbox.stub();
      rangeStub.onFirstCall().resolves({ data: fullBatch, error: null });
      rangeStub.onSecondCall().resolves({ data: [], error: null });

      context.dataAccess.services.postgrestClient = buildPostgrestMock(sandbox, {
        prompts: () => ({
          upsert: sandbox.stub().returns({ error: null }),
          select: sandbox.stub().returns({
            eq: sandbox.stub().returns({ range: rangeStub }),
          }),
        }),
      });

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(rangeStub.callCount).to.equal(2);
      expect(rangeStub.firstCall.args).to.deep.equal([0, FETCH_BATCH_SIZE - 1]);
      expect(rangeStub.secondCall.args).to.deep.equal([FETCH_BATCH_SIZE, FETCH_BATCH_SIZE * 2 - 1]);
    });

    it('treats null data with no error as an empty batch', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupFullMocks({ promptFetchNullData: true });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(response.status).to.equal(200);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Fetched prompts batch: 0 rows'),
      );
    });
  });

  describe('prompt collection edge cases', () => {
    it('handles topic without a category field', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-no-cat': { name: 'No Cat', prompts: [{ prompt: 'Q?', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts).to.have.length(1);
      expect(captured.prompts[0].category_id).to.be.null;
    });

    it('skips prompt with empty prompt text', async () => {
      const s3Config = buildS3Config({
        topics: { 't1': { name: 'T1', prompts: [{ prompt: '', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(body.prompts.inserted).to.equal(0);
      expect(context.log.error).to.have.been.calledWith(
        'Skipping prompt without text in topic "t1" at index 0',
      );
    });

    it('handles prompt with no regions, no origin, no source', async () => {
      const s3Config = buildS3Config({
        topics: { 't1': { name: 'T1', prompts: [{ prompt: 'Hello' }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts[0].regions).to.deep.equal([]);
      expect(captured.prompts[0].origin).to.equal('human');
      expect(captured.prompts[0].source).to.equal('config');
    });

    it('handles topic with no prompts array', async () => {
      const s3Config = buildS3Config({
        topics: { 't-empty': { name: 'Empty Topic' } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(body.prompts.inserted).to.equal(0);
    });

    it('generates a deterministic UUID v5 for new prompts', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': {
            name: 'Topic 1',
            prompts: [
              { prompt: 'First prompt', regions: ['us'] },
              { prompt: 'Second prompt', regions: ['us'] },
            ],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(captured.prompts).to.have.length(2);
      expect(body.prompts.inserted).to.equal(2);

      const uuidV5Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      captured.prompts.forEach((r) => expect(r.prompt_id).to.match(uuidV5Regex));
      expect(captured.prompts[0].prompt_id).to.not.equal(captured.prompts[1].prompt_id);
    });

    it('produces the same UUID v5 for the same topic+prompt across runs', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'Stable prompt', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      await handler({ siteId: SITE_ID, dryRun: false }, context);
      const firstRunId = captured.prompts[0].prompt_id;

      await handler({ siteId: SITE_ID, dryRun: false }, context);
      const secondRunId = captured.prompts[0].prompt_id;

      expect(firstRunId).to.equal(secondRunId);
    });

    it('skips prompts that have no text', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': {
            name: 'Topic 1',
            prompts: [{ regions: ['us'] }, { prompt: 'Has text', regions: ['us'] }],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(captured.prompts).to.have.length(1);
      expect(captured.prompts[0].text).to.equal('Has text');
      expect(body.prompts.inserted).to.equal(1);
      expect(context.log.error).to.have.been.calledWith(
        'Skipping prompt without text in topic "topic-1" at index 0',
      );
    });

    it('uses existing prompt_id when matching by text and topic', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'Existing prompt', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
        existingPrompts: [{
          prompt_id: 'migration-abc123', brand_id: BRAND_UUID, text: 'Existing prompt', topic_id: TOPIC_UUID,
          name: 'Existing prompt', regions: ['US'], category_id: null,
          status: 'active', origin: 'human', source: 'config',
          created_by: null, updated_by: null,
        }],
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts.unchanged).to.equal(1);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Matched existing prompt_id "migration-abc123"'),
      );
    });

    it('falls back to UUID v5 when no existing prompt matches', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'Brand new', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      await handler({ siteId: SITE_ID, dryRun: false }, context);

      expect(captured.prompts).to.have.length(1);
      expect(captured.prompts[0].prompt_id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('only upserts prompts with changed fields', async () => {
      const s3Config = buildS3Config({
        topics: {
          'topic-1': {
            name: 'Topic 1',
            prompts: [
              { prompt: 'Unchanged', regions: ['us'], origin: 'human', source: 'config' },
              { prompt: 'Changed regions', regions: ['us', 'de'], origin: 'human', source: 'config' },
            ],
          },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks({
        existingTopics: [{ id: TOPIC_UUID, topic_id: 'topic-1', name: 'Topic 1', description: null, status: 'active', created_by: null, updated_by: null }],
        existingPrompts: [
          {
            prompt_id: 'pid-1', brand_id: BRAND_UUID, text: 'Unchanged', topic_id: TOPIC_UUID,
            name: 'Unchanged', regions: ['US'], category_id: null,
            status: 'active', origin: 'human', source: 'config',
            created_by: null, updated_by: null,
          },
          {
            prompt_id: 'pid-2', brand_id: BRAND_UUID, text: 'Changed regions', topic_id: TOPIC_UUID,
            name: 'Changed regions', regions: ['US'], category_id: null,
            status: 'active', origin: 'human', source: 'config',
            created_by: null, updated_by: null,
          },
        ],
      });

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.prompts).to.deep.equal({ inserted: 0, updated: 1, unchanged: 1 });
      expect(captured.prompts).to.have.length(1);
      expect(captured.prompts[0].prompt_id).to.equal('pid-2');
      expect(captured.prompts[0].regions).to.deep.equal(['US', 'DE']);
    });
  });

  describe('dry-run mode', () => {
    it('does not upsert any data when dryRun is true', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Category 1', origin: 'human' } },
        topics: {
          'topic-1': { name: 'Topic 1', category: 'cat-1', prompts: [{ prompt: 'Q?', regions: ['us'] }] },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      const captured = setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: true }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.true;
      expect(body.categories.inserted).to.equal(1);
      expect(body.topics.inserted).to.equal(1);
      expect(body.prompts.inserted).to.equal(1);
      expect(captured.categories).to.be.null;
      expect(captured.topics).to.be.null;
      expect(captured.prompts).to.be.null;
    });

    it('logs insert/update counts and insert sample for each entity type in dry-run', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Cat 1' } },
        topics: {
          'topic-1': { name: 'Topic 1', category: 'cat-1', prompts: [{ prompt: 'Q?', regions: ['us'] }] },
        },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      await handler({ siteId: SITE_ID, dryRun: true }, context);

      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes('[DRY RUN] categories: 1 to insert, 0 to update'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] topics: 1 to insert, 0 to update'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] prompts: 1 to insert, 0 to update'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] categories insert sample:'))).to.be.true;
    });

    it('logs changed field names for updated rows in dry-run', async () => {
      const s3Config = buildS3Config({
        categories: { 'cat-1': { name: 'Renamed Cat' } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks({
        existingCats: [{
          id: CAT_UUID, category_id: 'cat-1', name: 'Old Name', origin: 'human', status: 'active', created_by: null, updated_by: null,
        }],
      });

      await handler({ siteId: SITE_ID, dryRun: true }, context);

      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes('[DRY RUN] categories: 0 to insert, 1 to update'))).to.be.true;
      expect(infoMessages.some((m) => m.includes('[DRY RUN] categories update (changed: name)'))).to.be.true;
    });

    it('resolves brand ID in dry-run', async () => {
      readConfigStub.resolves({ config: buildS3Config() });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: true }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.true;
      const infoMessages = context.log.info.args.map((args) => args[0]);
      expect(infoMessages.some((m) => m.includes(`Using fixed brand ID: ${BRAND_UUID}`))).to.be.true;
    });

    it('returns stats without dryRun flag when dryRun is false', async () => {
      const s3Config = buildS3Config({
        topics: { 'topic-1': { name: 'Topic 1', prompts: [{ prompt: 'Q?', regions: ['us'] }] } },
      });
      readConfigStub.resolves({ config: s3Config });
      setupFullMocks();

      const response = await handler({ siteId: SITE_ID, dryRun: false }, context);
      const body = await response.json();

      expect(response.status).to.equal(200);
      expect(body.dryRun).to.be.undefined;
    });
  });
});
