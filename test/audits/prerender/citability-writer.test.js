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

describe('citability-writer', () => {
  let sandbox;
  let toPathnameStub;
  let allBySiteIdStub;
  let createStub;
  let mod;

  before(async () => {
    sandbox = sinon.createSandbox();
    toPathnameStub = sandbox.stub();

    mod = await esmock('../../../src/prerender/citability-writer.js', {
      '../../../src/prerender/utils/utils.js': { toPathname: toPathnameStub },
    });
  });

  beforeEach(() => {
    sandbox.reset();
    // Default: toPathname returns the URL's pathname portion
    toPathnameStub.callsFake((url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    });
    allBySiteIdStub = sandbox.stub();
    createStub = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
    // Re-set stubs after restore so before() stubs are still valid
    toPathnameStub = sandbox.stub().callsFake((url) => {
      try {
        return new URL(url).pathname;
      } catch {
        return url;
      }
    });
  });

  function buildContext(overrides = {}) {
    return {
      log: {
        debug: sandbox.stub(),
        warn: sandbox.stub(),
        info: sandbox.stub(),
      },
      dataAccess: {
        PageCitability: {
          allBySiteId: allBySiteIdStub,
          create: createStub,
        },
      },
      ...overrides,
    };
  }

  function buildResult(overrides = {}) {
    return {
      url: 'https://example.com/page',
      citabilityScore: 0.8,
      contentGainRatio: 1.2,
      wordDifference: 100,
      wordCountBefore: 200,
      wordCountAfter: 300,
      isDeployedAtEdge: false,
      ...overrides,
    };
  }

  function buildExistingRecord(url = 'https://example.com/page') {
    return {
      getUrl: () => url,
      setCitabilityScore: sandbox.stub(),
      setContentRatio: sandbox.stub(),
      setWordDifference: sandbox.stub(),
      setBotWords: sandbox.stub(),
      setNormalWords: sandbox.stub(),
      setIsDeployedAtEdge: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };
  }

  describe('early return on empty input', () => {
    it('should return early without any DB calls when comparisonResults is null', async () => {
      const context = buildContext();
      await mod.writeToCitabilityRecords(null, 'site-1', context);
      expect(allBySiteIdStub).to.not.have.been.called;
    });

    it('should return early without any DB calls when comparisonResults is undefined', async () => {
      const context = buildContext();
      await mod.writeToCitabilityRecords(undefined, 'site-1', context);
      expect(allBySiteIdStub).to.not.have.been.called;
    });

    it('should return early without any DB calls when comparisonResults is empty', async () => {
      const context = buildContext();
      await mod.writeToCitabilityRecords([], 'site-1', context);
      expect(allBySiteIdStub).to.not.have.been.called;
      expect(context.log.debug).to.not.have.been.called;
    });
  });

  describe('PageCitability not available', () => {
    it('should log debug and return when PageCitability is absent from dataAccess', async () => {
      const context = buildContext({ dataAccess: {} });
      await mod.writeToCitabilityRecords([buildResult()], 'site-1', context);
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match('PageCitability not available'),
      );
      expect(createStub).to.not.have.been.called;
    });

    it('should log debug and return when PageCitability.allBySiteId is absent', async () => {
      const context = buildContext({
        dataAccess: { PageCitability: {} },
      });
      await mod.writeToCitabilityRecords([buildResult()], 'site-1', context);
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match('PageCitability not available'),
      );
    });
  });

  describe('create path — URL not in existingRecordsMap', () => {
    it('should call PageCitability.create with correct field mapping', async () => {
      allBySiteIdStub.resolves([]);
      createStub.resolves({});
      const context = buildContext();
      const result = buildResult({
        url: 'https://example.com/page',
        citabilityScore: 0.8,
        contentGainRatio: 1.2,
        wordDifference: 100,
        wordCountBefore: 200,
        wordCountAfter: 300,
        isDeployedAtEdge: false,
      });

      await mod.writeToCitabilityRecords([result], 'site-1', context);

      expect(createStub).to.have.been.calledOnce;
      expect(createStub.firstCall.args[0]).to.deep.equal({
        siteId: 'site-1',
        url: 'https://example.com/page',
        citabilityScore: 0.8,
        contentRatio: 1.2,
        wordDifference: 100,
        botWords: 200,
        normalWords: 300,
        isDeployedAtEdge: false,
      });
    });

    it('should fall back to null/false for undefined fields in create path', async () => {
      allBySiteIdStub.resolves([]);
      createStub.resolves({});
      const context = buildContext();

      await mod.writeToCitabilityRecords([{ url: 'https://example.com/new' }], 'site-1', context);

      expect(createStub.firstCall.args[0]).to.deep.equal({
        siteId: 'site-1',
        url: 'https://example.com/new',
        citabilityScore: null,
        contentRatio: null,
        wordDifference: null,
        botWords: null,
        normalWords: null,
        isDeployedAtEdge: false,
      });
    });

    it('should log warn and return false when PageCitability.create throws', async () => {
      allBySiteIdStub.resolves([]);
      createStub.rejects(new Error('DB write error'));
      const context = buildContext();

      await mod.writeToCitabilityRecords([buildResult()], 'site-1', context);

      expect(context.log.warn).to.have.been.calledOnce;
      expect(context.log.warn.firstCall.args[0]).to.include('Failed to write PageCitability');
    });
  });

  describe('update path — URL exists in existingRecordsMap', () => {
    it('should call setters and save() when URL matches existing record', async () => {
      const existing = buildExistingRecord('https://example.com/page');
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();
      const result = buildResult({
        url: 'https://example.com/page',
        citabilityScore: 0.9,
        contentGainRatio: 1.5,
        wordDifference: 50,
        wordCountBefore: 100,
        wordCountAfter: 150,
        isDeployedAtEdge: true,
      });

      await mod.writeToCitabilityRecords([result], 'site-1', context);

      expect(createStub).to.not.have.been.called;
      expect(existing.setCitabilityScore).to.have.been.calledWith(0.9);
      expect(existing.setContentRatio).to.have.been.calledWith(1.5);
      expect(existing.setWordDifference).to.have.been.calledWith(50);
      expect(existing.setBotWords).to.have.been.calledWith(100);
      expect(existing.setNormalWords).to.have.been.calledWith(150);
      expect(existing.setIsDeployedAtEdge).to.have.been.calledWith(true);
      expect(existing.save).to.have.been.calledOnce;
    });

    it('should match by pathname when hostname differs (www vs non-www)', async () => {
      const existing = buildExistingRecord('https://www.example.com/page');
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [buildResult({ url: 'https://example.com/page' })],
        'site-1',
        context,
      );

      expect(createStub).to.not.have.been.called;
      expect(existing.setCitabilityScore).to.have.been.calledWith(0.8);
      expect(existing.save).to.have.been.calledOnce;
    });

    it('should fall back to null/false for undefined fields in update path', async () => {
      const existing = buildExistingRecord('https://example.com/page');
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();

      await mod.writeToCitabilityRecords([{ url: 'https://example.com/page' }], 'site-1', context);

      expect(existing.setCitabilityScore).to.have.been.calledWith(null);
      expect(existing.setContentRatio).to.have.been.calledWith(null);
      expect(existing.setWordDifference).to.have.been.calledWith(null);
      expect(existing.setBotWords).to.have.been.calledWith(null);
      expect(existing.setNormalWords).to.have.been.calledWith(null);
      expect(existing.setIsDeployedAtEdge).to.have.been.calledWith(false);
      expect(existing.save).to.have.been.calledOnce;
    });

    it('should log warn and return false when existing.save() throws', async () => {
      const existing = buildExistingRecord('https://example.com/page');
      existing.save = sandbox.stub().rejects(new Error('save failed'));
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();

      await mod.writeToCitabilityRecords([buildResult()], 'site-1', context);

      expect(context.log.warn).to.have.been.calledOnce;
      expect(context.log.warn.firstCall.args[0]).to.include('Failed to write PageCitability');
    });
  });

  describe('error filtering', () => {
    it('should skip results with error flag set', async () => {
      allBySiteIdStub.resolves([]);
      createStub.resolves({});
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [
          { url: 'https://example.com/error-page', error: true },
          buildResult({ url: 'https://example.com/ok-page' }),
        ],
        'site-1',
        context,
      );

      expect(createStub).to.have.been.calledOnce;
      expect(createStub.firstCall.args[0].url).to.equal('https://example.com/ok-page');
    });

    it('should log info with 0/0 counts when all results have error flag set', async () => {
      allBySiteIdStub.resolves([]);
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [{ url: 'https://example.com/err', error: true }],
        'site-1',
        context,
      );

      // No DB calls — all results filtered out
      expect(createStub).to.not.have.been.called;
      // log.info is called at the end with written=0, successful.length=0
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Wrote PageCitability records: 0/0'),
      );
    });
  });

  describe('batch processing', () => {
    it('should process writes in batches of 10 (25 URLs = 3 batches)', async () => {
      allBySiteIdStub.resolves([]);
      const callOrder = [];
      createStub.callsFake(async ({ url }) => { callOrder.push(url); return {}; });
      const context = buildContext();

      const results = Array.from({ length: 25 }, (_, i) => buildResult({
        url: `https://example.com/page${i}`,
      }));

      await mod.writeToCitabilityRecords(results, 'site-1', context);

      expect(createStub.callCount).to.equal(25);
      expect(callOrder).to.have.lengthOf(25);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Wrote PageCitability records: 25/25'),
      );
    });

    it('should report correct written count when some writes fail', async () => {
      allBySiteIdStub.resolves([]);
      // First call succeeds, rest fail
      createStub.onFirstCall().resolves({});
      createStub.rejects(new Error('fail'));
      const context = buildContext();

      const results = Array.from({ length: 5 }, (_, i) => buildResult({
        url: `https://example.com/page${i}`,
      }));

      await mod.writeToCitabilityRecords(results, 'site-1', context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match('Wrote PageCitability records: 1/5'),
      );
    });
  });

  describe('field mapping correctness', () => {
    it('should map contentGainRatio to contentRatio in create call', async () => {
      allBySiteIdStub.resolves([]);
      createStub.resolves({});
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [buildResult({ contentGainRatio: 2.5 })],
        'site-1',
        context,
      );

      expect(createStub.firstCall.args[0].contentRatio).to.equal(2.5);
    });

    it('should map wordCountBefore to botWords and wordCountAfter to normalWords', async () => {
      allBySiteIdStub.resolves([]);
      createStub.resolves({});
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [buildResult({ wordCountBefore: 111, wordCountAfter: 222 })],
        'site-1',
        context,
      );

      expect(createStub.firstCall.args[0].botWords).to.equal(111);
      expect(createStub.firstCall.args[0].normalWords).to.equal(222);
    });

    it('should map contentGainRatio to setContentRatio setter in update path', async () => {
      const existing = buildExistingRecord('https://example.com/page');
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [buildResult({ contentGainRatio: 3.1 })],
        'site-1',
        context,
      );

      expect(existing.setContentRatio).to.have.been.calledWith(3.1);
    });

    it('should map wordCountBefore/After to setBotWords/setNormalWords in update path', async () => {
      const existing = buildExistingRecord('https://example.com/page');
      allBySiteIdStub.resolves([existing]);
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [buildResult({ wordCountBefore: 77, wordCountAfter: 99 })],
        'site-1',
        context,
      );

      expect(existing.setBotWords).to.have.been.calledWith(77);
      expect(existing.setNormalWords).to.have.been.calledWith(99);
    });
  });

  describe('race condition resilience', () => {
    it('RC-1: should attempt create twice when same URL appears twice in input', async () => {
      allBySiteIdStub.resolves([]);
      createStub
        .onFirstCall().resolves({})
        .onSecondCall().rejects(new Error('unique constraint violation'));
      const context = buildContext();

      await mod.writeToCitabilityRecords(
        [
          buildResult({ url: 'https://example.com/page' }),
          buildResult({ url: 'https://example.com/page' }),
        ],
        'site-1',
        context,
      );

      expect(createStub).to.have.been.calledTwice;
      expect(context.log.warn).to.have.been.calledOnce;
      expect(context.log.warn.firstCall.args[0]).to.include('Failed to write PageCitability');
    });

    it('RC-2: second Lambda invocation with stale snapshot catches duplicate-key error', async () => {
      allBySiteIdStub.resolves([]);
      createStub
        .onFirstCall().resolves({})
        .onSecondCall().rejects(new Error('duplicate key value violates unique constraint'));
      const context = buildContext();
      const results = [buildResult({ url: 'https://example.com/new-page' })];

      await mod.writeToCitabilityRecords(results, 'site-1', context);
      expect(createStub).to.have.been.calledOnce;
      expect(context.log.warn).to.not.have.been.called;

      await mod.writeToCitabilityRecords(results, 'site-1', context);
      expect(createStub).to.have.been.calledTwice;
      expect(context.log.warn).to.have.been.calledOnce;
      expect(context.log.warn.firstCall.args[0]).to.include('Failed to write PageCitability');
    });
  });
});
