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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('sendLowSuggestionCountAlert', () => {
  const sandbox = sinon.createSandbox();

  let fetchStub;
  let sendLowSuggestionCountAlert;
  let PLG_SUGGESTION_THRESHOLD;

  const CHANNEL_ID = 'C_AUDIT_CHANNEL';
  const BOT_TOKEN = 'xoxb-test-token';
  const SLACK_API = 'https://slack.com/api/chat.postMessage';

  const makeEnrollment = (productCode, tier) => ({
    getEntitlement: sinon.stub().resolves({
      getProductCode: () => productCode,
      getTier: () => tier,
    }),
  });

  const makeSite = (enrollments) => ({
    getId: () => 'site-uuid-123',
    getBaseURL: () => 'https://example.com',
    getSiteEnrollments: sinon.stub().resolves(enrollments),
  });

  const makeContext = (overrides = {}) => ({
    env: {
      SLACK_BOT_TOKEN: BOT_TOKEN,
      SLACK_AUDIT_LOW_SUGGESTION_CHANNEL: CHANNEL_ID,
      ...overrides.env,
    },
    log: {
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
  });

  const getPostedBody = () => JSON.parse(fetchStub.firstCall.args[1].body);

  beforeEach(async () => {
    fetchStub = sandbox.stub().resolves({
      ok: true,
      json: async () => ({ ok: true }),
    });

    ({ sendLowSuggestionCountAlert, PLG_SUGGESTION_THRESHOLD } = await esmock(
      '../../src/support/plg-suggestion-alert.js',
      { '@adobe/spacecat-shared-utils': { fetch: fetchStub } },
    ));
  });

  afterEach(() => sandbox.restore());

  it('sends a POST to the Slack API with correct headers', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());

    expect(fetchStub).to.have.been.calledOnce;
    const [url, opts] = fetchStub.firstCall.args;
    expect(url).to.equal(SLACK_API);
    expect(opts.method).to.equal('POST');
    expect(opts.headers['Content-Type']).to.include('application/json');
    expect(opts.headers.Authorization).to.equal(`Bearer ${BOT_TOKEN}`);
  });

  it('sends to the configured audit channel', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());

    const body = getPostedBody();
    expect(body.channel).to.equal(CHANNEL_ID);
  });

  it('includes site URL, audit type, and suggestion count in the message', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'broken-backlinks', 1, makeContext());

    const text = JSON.stringify(getPostedBody().blocks);
    expect(text).to.include('example.com');
    expect(text).to.include('broken-backlinks');
    expect(text).to.include('1');
    expect(text).to.include(String(PLG_SUGGESTION_THRESHOLD));
  });

  it('does not send when suggestion count equals the threshold', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', PLG_SUGGESTION_THRESHOLD, makeContext());
    expect(fetchStub).to.not.have.been.called;
  });

  it('does not send when suggestion count exceeds the threshold', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', PLG_SUGGESTION_THRESHOLD + 5, makeContext());
    expect(fetchStub).to.not.have.been.called;
  });

  it('does nothing when SLACK_BOT_TOKEN is missing', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext({ env: { SLACK_BOT_TOKEN: undefined } }));
    expect(fetchStub).to.not.have.been.called;
  });

  it('does nothing when SLACK_AUDIT_LOW_SUGGESTION_CHANNEL is missing', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext({ env: { SLACK_AUDIT_LOW_SUGGESTION_CHANNEL: undefined } }));
    expect(fetchStub).to.not.have.been.called;
  });

  it('does nothing when the site is not PLG tier', async () => {
    const site = makeSite([makeEnrollment('ASO', 'PAID')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());
    expect(fetchStub).to.not.have.been.called;
  });

  it('does nothing when there are no enrollments', async () => {
    const site = makeSite([]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());
    expect(fetchStub).to.not.have.been.called;
  });

  it('does nothing when there is no ASO entitlement', async () => {
    const site = makeSite([makeEnrollment('OTHER', 'PLG')]);
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());
    expect(fetchStub).to.not.have.been.called;
  });

  it('logs warning and does nothing when tier lookup throws', async () => {
    const site = {
      ...makeSite([]),
      getSiteEnrollments: sinon.stub().rejects(new Error('db error')),
    };
    const context = makeContext();
    await sendLowSuggestionCountAlert(site, 'cwv', 0, context);

    expect(fetchStub).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledWithMatch('Failed to determine ASO PLG tier');
  });

  it('logs error and does not throw when the Slack API returns a non-ok HTTP status', async () => {
    fetchStub.resolves({ ok: false, status: 500, json: async () => ({}) });
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    const context = makeContext();

    await expect(
      sendLowSuggestionCountAlert(site, 'cwv', 0, context),
    ).to.not.be.rejected;

    expect(context.log.error).to.have.been.calledWithMatch('Failed to send low suggestion count');
  });

  it('logs error and does not throw when the Slack API returns ok:false in JSON', async () => {
    fetchStub.resolves({ ok: true, json: async () => ({ ok: false, error: 'channel_not_found' }) });
    const site = makeSite([makeEnrollment('ASO', 'PLG')]);
    const context = makeContext();

    await expect(
      sendLowSuggestionCountAlert(site, 'cwv', 0, context),
    ).to.not.be.rejected;

    expect(context.log.error).to.have.been.calledWithMatch('Failed to send low suggestion count');
  });

  it('sanitizes mrkdwn control characters in the site URL', async () => {
    const site = {
      getId: () => 'site-uuid-123',
      getBaseURL: () => 'https://<evil>.example.com',
      getSiteEnrollments: sinon.stub().resolves([makeEnrollment('ASO', 'PLG')]),
    };
    await sendLowSuggestionCountAlert(site, 'cwv', 0, makeContext());

    const text = JSON.stringify(getPostedBody().blocks);
    expect(text).to.include('&lt;evil&gt;');
    expect(text).to.not.include('<evil>');
  });

  it('falls back to site.getId() when getBaseURL is missing', async () => {
    const site = {
      getId: () => 'fallback-site-id',
      getSiteEnrollments: sinon.stub().resolves([makeEnrollment('ASO', 'PLG')]),
    };
    await sendLowSuggestionCountAlert(site, 'alt-text', 2, makeContext());

    expect(fetchStub).to.have.been.calledOnce;
    const text = JSON.stringify(getPostedBody().blocks);
    expect(text).to.include('fallback-site-id');
  });
});
