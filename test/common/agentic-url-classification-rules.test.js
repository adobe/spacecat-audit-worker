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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('fetchAgenticUrlClassificationRules', () => {
  let sandbox;
  let sleepStub;
  let fetchAgenticUrlClassificationRules;

  const SITE_ID = 'site-abc';
  const mockSite = { getId: () => SITE_ID };

  const makeQueryChain = (result) => ({
    select: sinon.stub().returnsThis(),
    eq: sinon.stub().returnsThis(),
    order: sinon.stub().returnsThis(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  });

  const makeContext = (fromFn) => ({
    log: {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: {
      services: {
        postgrestClient: {
          from: fromFn,
        },
      },
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    sleepStub = sandbox.stub().resolves();

    ({ fetchAgenticUrlClassificationRules } = await esmock(
      '../../src/common/agentic-url-classification-rules.js',
      { '../../src/support/utils.js': { sleep: sleepStub } },
    ));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns null when no postgrestClient is available', async () => {
    const context = { log: { warn: sandbox.stub() }, dataAccess: {} };
    const result = await fetchAgenticUrlClassificationRules(mockSite, context);
    expect(result).to.be.null;
    expect(context.log.warn).to.have.been.calledWithMatch('no PostgREST client available');
  });

  it('returns null when postgrestClient has no from method', async () => {
    const context = {
      log: { warn: sandbox.stub() },
      dataAccess: { services: { postgrestClient: {} } },
    };
    const result = await fetchAgenticUrlClassificationRules(mockSite, context);
    expect(result).to.be.null;
  });

  it('returns rules on first successful fetch', async () => {
    const categoryRules = [{ name: 'adobe', regex: '/adobe', sort_order: 0 }];
    const pageTypeRules = [{ name: 'Docs', regex: '/docs', sort_order: 0 }];

    const context = makeContext((table) => makeQueryChain({
      data: table === 'agentic_url_category_rules' ? categoryRules : pageTypeRules,
      error: null,
    }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    const expectedShape = {
      sort_order: 0,
      source: 'ai',
      sample_urls: [],
      derivation_method: null,
    };
    expect(result).to.deep.equal({
      topicPatterns: [{ name: 'adobe', regex: '/adobe', ...expectedShape }],
      pagePatterns: [{ name: 'Docs', regex: '/docs', ...expectedShape }],
    });
    expect(sleepStub).to.not.have.been.called;
    expect(context.log.info).to.have.been.calledWithMatch('loaded 1 page patterns, 1 topic patterns');
  });

  it('filters to active rules on both rule tables', async () => {
    const chains = [];
    const context = makeContext(() => {
      const chain = makeQueryChain({ data: [], error: null });
      chains.push(chain);
      return chain;
    });

    await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(chains).to.have.lengthOf(2);
    chains.forEach((chain) => {
      expect(chain.eq).to.have.been.calledWith('site_id', SITE_ID);
      expect(chain.eq).to.have.been.calledWith('status', 'active');
    });
  });

  it('passes through populated provenance fields from rows', async () => {
    const rules = [{
      name: 'photoshop',
      regex: '/photoshop',
      sort_order: 2,
      source: 'human',
      sample_urls: ['/photoshop/a', '/photoshop/b'],
      derivation_method: 'common-prefix',
    }];
    const context = makeContext(() => makeQueryChain({ data: rules, error: null }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);
    expect(result.topicPatterns[0]).to.deep.equal({
      name: 'photoshop',
      regex: '/photoshop',
      sort_order: 2,
      source: 'human',
      sample_urls: ['/photoshop/a', '/photoshop/b'],
      derivation_method: 'common-prefix',
    });
  });

  it('fills sort_order with index when not an integer', async () => {
    const rules = [{ name: 'a', regex: '/a', sort_order: null }];
    const context = makeContext(() => makeQueryChain({ data: rules, error: null }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);
    expect(result.topicPatterns[0].sort_order).to.equal(0);
    expect(result.pagePatterns[0].sort_order).to.equal(0);
  });

  it('retries on thrown error and succeeds on second attempt', async () => {
    let callCount = 0;
    const categoryRules = [{ name: 'adobe', regex: '/adobe', sort_order: 0 }];
    const pageTypeRules = [{ name: 'Docs', regex: '/docs', sort_order: 0 }];

    const context = makeContext((table) => {
      callCount += 1;
      if (callCount <= 2) {
        return {
          select: sinon.stub().returnsThis(),
          eq: sinon.stub().returnsThis(),
          order: sinon.stub().returnsThis(),
          then: (_, reject) => Promise.reject(new Error('transient DB error')).catch(reject),
        };
      }
      return makeQueryChain({
        data: table === 'agentic_url_category_rules' ? categoryRules : pageTypeRules,
        error: null,
      });
    });

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(result).to.have.property('topicPatterns');
    expect(result).to.have.property('pagePatterns');
    expect(sleepStub).to.have.been.calledOnce;
    expect(sleepStub).to.have.been.calledWith(500);
    expect(context.log.warn).to.have.been.calledWithMatch('attempt 1 failed');
  });

  it('retries on PostgREST error result and succeeds on third attempt', async () => {
    let callCount = 0;
    const categoryRules = [{ name: 'adobe', regex: '/adobe', sort_order: 0 }];
    const pageTypeRules = [{ name: 'Docs', regex: '/docs', sort_order: 0 }];

    const context = makeContext((table) => {
      callCount += 1;
      if (callCount <= 4) {
        return makeQueryChain({ data: null, error: new Error('DB error') });
      }
      return makeQueryChain({
        data: table === 'agentic_url_category_rules' ? categoryRules : pageTypeRules,
        error: null,
      });
    });

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(result).to.have.property('topicPatterns');
    expect(result).to.have.property('pagePatterns');
    expect(sleepStub).to.have.been.calledTwice;
    expect(sleepStub.firstCall).to.have.been.calledWith(500);
    expect(sleepStub.secondCall).to.have.been.calledWith(1000);
    expect(context.log.warn).to.have.been.calledWithMatch('attempt 1 failed');
    expect(context.log.warn).to.have.been.calledWithMatch('attempt 2 failed');
  });

  it('returns error object after all retries exhausted', async () => {
    const context = makeContext(() => makeQueryChain({
      data: null,
      error: new Error('persistent DB failure'),
    }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(result).to.deep.equal({ error: true, source: 'postgres' });
    expect(sleepStub).to.have.been.calledTwice;
    expect(sleepStub.firstCall).to.have.been.calledWith(500);
    expect(sleepStub.secondCall).to.have.been.calledWith(1000);
    expect(context.log.error).to.have.been.calledWithMatch('failed to load rules');
    expect(context.log.error).to.have.been.calledWithMatch('after 3 attempts');
  });

  it('returns error object when all attempts throw', async () => {
    const context = makeContext(() => ({
      select: sinon.stub().returnsThis(),
      eq: sinon.stub().returnsThis(),
      order: sinon.stub().returnsThis(),
      then: (_, reject) => Promise.reject(new Error('network timeout')).catch(reject),
    }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(result).to.deep.equal({ error: true, source: 'postgres' });
    expect(sleepStub).to.have.been.calledTwice;
    expect(context.log.error).to.have.been.calledWithMatch('failed to load rules');
  });

  it('handles empty rules arrays without retrying', async () => {
    const context = makeContext(() => makeQueryChain({ data: [], error: null }));

    const result = await fetchAgenticUrlClassificationRules(mockSite, context);

    expect(result).to.deep.equal({ topicPatterns: [], pagePatterns: [] });
    expect(sleepStub).to.not.have.been.called;
  });

  it('uses console as fallback log when context has no log', async () => {
    const consoleWarnStub = sandbox.stub(console, 'warn');
    const result = await fetchAgenticUrlClassificationRules(mockSite, {});
    expect(result).to.be.null;
    expect(consoleWarnStub).to.have.been.calledWithMatch('no PostgREST client available');
  });
});
