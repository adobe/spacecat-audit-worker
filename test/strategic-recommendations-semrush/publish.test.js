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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

const OUTPUT_LOCATION = 'customer-data/strategic-recommendations-template';
const LIVE_JSON_URL = `https://main--project-elmo-ui-data--adobe.hlx.live/${OUTPUT_LOCATION}/strategic-recommendations.json`;

describe('publishWorkbookWithReadback / extractSemrushRows', () => {
  let sandbox;
  let log;
  let mod;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    log = { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() };
    mod = await esmock('../../src/strategic-recommendations-semrush/publish.js', {
      '../../src/support/utils.js': { sleep: async () => {} },
    });
  });

  afterEach(() => sandbox.restore());

  const baseArgs = (fetchImpl) => ({
    filename: 'strategic-recommendations.xlsx',
    outputLocation: OUTPUT_LOCATION,
    expectedRowCount: 2,
    expectedGeneratedAt: 'g1',
    adminApiKey: 'test-token',
    log,
    fetchImpl,
  });

  it('publishes preview+live and confirms via read-back', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).resolves({
      ok: true,
      json: async () => ({ generated_at: 'g1', Semrush: { data: [{}, {}] } }),
    });

    await mod.publishWorkbookWithReadback(baseArgs(fetchImpl));

    expect(fetchImpl.getCalls().some((c) => c.args[0].includes('/preview/'))).to.equal(true);
    expect(fetchImpl.getCalls().some((c) => c.args[0].includes('/live/'))).to.equal(true);

    // Each admin.hlx publish POST must carry the auth cookie — without it the
    // edge silently 401s and the read-back failure would be the only signal.
    const publishCalls = fetchImpl.getCalls()
      .filter((c) => /admin\.hlx\.page/.test(c.args[0]));
    expect(publishCalls).to.have.lengthOf(2);
    publishCalls.forEach((c) => {
      expect(c.args[1].method).to.equal('POST');
      expect(c.args[1].headers.Cookie).to.equal('auth_token=test-token');
    });
  });

  it('throws on a non-200 publish', async () => {
    const fetchImpl = sandbox.stub().resolves({ ok: false, status: 500, statusText: 'Err' });
    await expect(mod.publishWorkbookWithReadback(baseArgs(fetchImpl)))
      .to.be.rejectedWith('publish to preview failed: 500');
  });

  it('throws before any fetch when adminApiKey is missing', async () => {
    const fetchImpl = sandbox.stub();
    const args = { ...baseArgs(fetchImpl), adminApiKey: undefined };
    await expect(mod.publishWorkbookWithReadback(args))
      .to.be.rejectedWith('ADMIN_HLX_API_KEY is not configured');
    expect(fetchImpl).to.not.have.been.called;
  });

  it('busts the CDN cache with a fresh query param on each read-back attempt', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    let call = 0;
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).callsFake(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      return { ok: true, json: async () => ({ Semrush: { data: [{}, {}] } }) };
    });

    await mod.publishWorkbookWithReadback(baseArgs(fetchImpl));

    const readbackUrls = fetchImpl.getCalls()
      .map((c) => c.args[0])
      .filter((u) => u.startsWith(LIVE_JSON_URL));
    expect(readbackUrls).to.have.lengthOf(2);
    readbackUrls.forEach((u) => expect(u).to.match(/\?cb=\d+-\d+$/));
    expect(readbackUrls[0]).to.not.equal(readbackUrls[1]);
  });

  it('retries read-back then succeeds (absorbs edge latency)', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    let call = 0;
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).callsFake(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      return { ok: true, json: async () => ({ generated_at: 'g1', Semrush: { data: [{}, {}] } }) };
    });

    await mod.publishWorkbookWithReadback(baseArgs(fetchImpl));
    expect(call).to.equal(2);
  });

  it('throws after exhausting read-back retries on row-count mismatch', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL))
      .resolves({ ok: true, json: async () => ({ Semrush: { data: [] } }) });

    await expect(mod.publishWorkbookWithReadback(baseArgs(fetchImpl)))
      .to.be.rejectedWith('post-publish read-back failed');
  });

  it('throws when read-back JSON has no Semrush sheet', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).resolves({ ok: true, json: async () => ({ foo: 'bar' }) });

    await expect(mod.publishWorkbookWithReadback(baseArgs(fetchImpl)))
      .to.be.rejectedWith('post-publish read-back failed');
  });

  it('throws when read-back fetch itself errors on every attempt', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).rejects(new Error('network down'));

    await expect(mod.publishWorkbookWithReadback(baseArgs(fetchImpl)))
      .to.be.rejectedWith('post-publish read-back failed');
  });

  it('passes read-back when no expectedGeneratedAt is provided', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL))
      .resolves({ ok: true, json: async () => ({ Semrush: { data: [{}, {}] } }) });

    await mod.publishWorkbookWithReadback({ ...baseArgs(fetchImpl), expectedGeneratedAt: null });
  });

  it('extractSemrushRows handles the single-sheet shape and missing/garbage input', () => {
    expect(mod.extractSemrushRows({ data: [1, 2] })).to.deep.equal([1, 2]);
    expect(mod.extractSemrushRows({ Semrush: { data: [1] } })).to.deep.equal([1]);
    expect(mod.extractSemrushRows(null)).to.equal(null);
    expect(mod.extractSemrushRows({ foo: 'bar' })).to.equal(null);
    expect(mod.extractSemrushRows({ Semrush: {} })).to.equal(null);
  });

  it('extractSemrushRows returns null for a multi-sheet doc missing the Semrush sheet', () => {
    // `:names` envelope present but no Semrush key — must NOT fall through to a
    // sibling sheet's `data` array.
    expect(mod.extractSemrushRows({
      ':names': ['Other'],
      ':type': 'multi-sheet',
      Other: { data: [1, 2, 3] },
    })).to.equal(null);
    expect(mod.extractSemrushRows({
      ':type': 'multi-sheet',
      data: [1, 2, 3],
    })).to.equal(null);
  });

  it('matches generated_at carried on a row instead of the envelope', async () => {
    const fetchImpl = sandbox.stub();
    fetchImpl.withArgs(sinon.match(/admin\.hlx\.page/)).resolves({ ok: true, status: 200, statusText: 'OK' });
    fetchImpl.withArgs(sinon.match(LIVE_JSON_URL)).resolves({
      ok: true,
      json: async () => ({ Semrush: { data: [{ generated_at: 'g1' }, { generated_at: 'g1' }] } }),
    });

    await mod.publishWorkbookWithReadback(baseArgs(fetchImpl));
  });
});
