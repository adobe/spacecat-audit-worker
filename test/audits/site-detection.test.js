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
import * as sharedUtils from '@adobe/spacecat-shared-utils';
import { AsyncJob, Site as SiteModel } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

// Domain that passes all validation and keeps its subdomain after composeBaseURL
// (composeBaseURL strips 'www.' so we use 'foo.' instead)
const TEST_DOMAIN = 'foo.example.com';
const TEST_BASE_URL = 'https://foo.example.com';

const HELIX_DOM = '<header></header><main><div>content</div></main>';
const NON_HELIX_DOM = '<div>not helix</div>';
const JOB_ID = '11111111-1111-4111-8111-111111111111';

/** Minimal fetch response for isHelixSite (reads .text() and .status). */
function makeSiteResponse(body, status = 200) {
  return { text: async () => body, status };
}

/**
 * Minimal fetch response for fetchHlxConfig (reads .status and .json()).
 * Pass body=null to make json() return a rejected Promise (simulates invalid JSON).
 */
function makeAdminResponse(status, body = undefined) {
  return {
    status,
    json: body !== undefined
      ? async () => body
      : () => Promise.reject(new SyntaxError('Unexpected token')),
  };
}

/**
 * Creates a callsFake dispatcher that routes fetch calls by URL:
 *   - admin.hlx.page → adminResponse
 *   - everything else → siteResponse
 */
function makeDispatcher(siteResponse, adminResponse) {
  return (url) => (/admin\.hlx\.page/.test(url) ? adminResponse : siteResponse);
}

describe('[site-detection] runner tests', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  let context;
  let mockJob;
  let fetchStub;
  let slackPostMessageStub;
  let siteDetectionRunner;

  beforeEach(async () => {
    fetchStub = sandbox.stub();
    slackPostMessageStub = sandbox.stub().resolves();
    const mockSlackClient = { postMessage: slackPostMessageStub };
    const mockBaseSlackClient = { createFrom: sandbox.stub().returns(mockSlackClient) };

    ({ siteDetectionRunner } = await esmock('../../src/site-detection/handler.js', {
      '@adobe/spacecat-shared-utils': { ...sharedUtils, fetch: fetchStub },
      '@adobe/spacecat-shared-slack-client': {
        BaseSlackClient: mockBaseSlackClient,
        SLACK_TARGETS: { WORKSPACE_INTERNAL: 'workspace_internal' },
      },
    }));

    mockJob = {
      getStatus: sandbox.stub().returns(AsyncJob.Status.IN_PROGRESS),
      getMetadata: sandbox.stub().returns({ payload: { domain: TEST_DOMAIN, hlxVersion: null } }),
      setStatus: sandbox.stub(),
      setResult: sandbox.stub(),
      setError: sandbox.stub(),
      setEndedAt: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.env = {
      HLX_ADMIN_TOKEN: 'test-token',
      SLACK_SITE_DISCOVERY_CHANNEL_INTERNAL: 'C123456',
    };

    context.dataAccess.AsyncJob.findById = sandbox.stub().resolves(mockJob);
    context.dataAccess.Site.findByBaseURL = sandbox.stub().resolves(null);
    context.dataAccess.SiteCandidate = {
      findByBaseURL: sandbox.stub().resolves(null),
      create: sandbox.stub().resolves(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ── Job lifecycle ──────────────────────────────────────────────────────────

  it('returns error when job not found', async () => {
    context.dataAccess.AsyncJob.findById.resolves(null);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.error).to.equal('Job not found');
  });

  it('skips when job is not IN_PROGRESS', async () => {
    mockJob.getStatus.returns(AsyncJob.Status.COMPLETED);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.skipped).to.be.true;
  });

  it('marks job FAILED when domain is missing from payload', async () => {
    mockJob.getMetadata.returns({ payload: {} });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.FAILED);
    expect(mockJob.setError).to.have.been.calledWith(sinon.match({ code: 'INVALID_PAYLOAD' }));
    expect(mockJob.save).to.have.been.calledOnce;
    expect(result.auditResult.error).to.equal('Missing domain');
  });

  // ── Domain validation ──────────────────────────────────────────────────────

  it('rejects domain containing a path segment', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'foo.example.com/path' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('rejects IPv4 address domain', async () => {
    mockJob.getMetadata.returns({ payload: { domain: '192.168.1.1' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('rejects domain with an ignored subdomain token', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'dev.example.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('rejects domain with a one-character subdomain', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'a.example.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('rejects domain matching an ignored domain pattern', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'foo.fastly.net' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('rejects domain with a port', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'foo.example.com:8080' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('uses custom subdomain tokens from SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'custom,tokens';
    mockJob.getMetadata.returns({ payload: { domain: 'custom.example.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('uses custom domain patterns from SITE_DETECTION_IGNORED_DOMAINS (regex wrapped in slashes)', async () => {
    context.env.SITE_DETECTION_IGNORED_DOMAINS = '/\\.ignoreme\\.com$/';
    mockJob.getMetadata.returns({ payload: { domain: 'foo.ignoreme.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('uses custom domain patterns from SITE_DETECTION_IGNORED_DOMAINS (plain string)', async () => {
    context.env.SITE_DETECTION_IGNORED_DOMAINS = 'example\\.com';
    mockJob.getMetadata.returns({ payload: { domain: 'foo.example.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('skips invalid regex patterns in SITE_DETECTION_IGNORED_DOMAINS and logs a warning', async () => {
    context.env.SITE_DETECTION_IGNORED_DOMAINS = '[invalid-regex';
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/Skipping invalid regex pattern/),
    );
  });

  // ── Duplicate detection ────────────────────────────────────────────────────

  it('marks FAILED/duplicate when site already exists as AEM_EDGE delivery type', async () => {
    context.dataAccess.Site.findByBaseURL.resolves({
      getDeliveryType: () => SiteModel.DELIVERY_TYPES.AEM_EDGE,
    });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(
      sinon.match({ action: 'duplicate', reason: 'Site already exists' }),
    );
    expect(result.auditResult.action).to.equal('duplicate');
  });

  it('continues processing when an existing site has a non-AEM_EDGE delivery type', async () => {
    context.dataAccess.Site.findByBaseURL.resolves({ getDeliveryType: () => 'other_type' });
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
  });

  it('marks FAILED/duplicate when a site candidate already exists', async () => {
    context.dataAccess.SiteCandidate.findByBaseURL.resolves({
      getBaseURL: () => TEST_BASE_URL,
    });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(
      sinon.match({ action: 'duplicate', reason: 'Site candidate already evaluated' }),
    );
    expect(result.auditResult.action).to.equal('duplicate');
  });

  // ── Helix verification ─────────────────────────────────────────────────────

  it('marks FAILED/rejected when site fetch throws a network error', async () => {
    fetchStub.rejects(new Error('ECONNREFUSED'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('marks FAILED/rejected when site returns non-Helix DOM', async () => {
    fetchStub.resolves(makeSiteResponse(NON_HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(
      sinon.match({ action: 'rejected', reason: sinon.match(/Not a Helix site/) }),
    );
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('creates SiteCandidate and marks job COMPLETED for a non-RSO domain', async () => {
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.dataAccess.SiteCandidate.create).to.have.been.calledOnce;
    const createArg = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    expect(createArg.baseURL).to.equal(TEST_BASE_URL);
    expect(createArg.hlxConfig.rso).to.deep.equal({});
    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
    expect(mockJob.setResult).to.have.been.calledWith(
      sinon.match({ action: 'created', domain: TEST_DOMAIN }),
    );
    expect(result.auditResult.action).to.equal('created');
  });

  it('sends Slack notification with the correct channel and site URL on success', async () => {
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(slackPostMessageStub).to.have.been.calledOnce;
    const payload = slackPostMessageStub.firstCall.args[0];
    expect(payload.channel).to.equal('C123456');
    expect(payload.text).to.include(TEST_DOMAIN);
    expect(payload.blocks).to.have.length(2);
  });

  it('skips Slack and logs warning when channel env var is not set', async () => {
    delete context.env.SLACK_SITE_DISCOVERY_CHANNEL_INTERNAL;
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(slackPostMessageStub).to.not.have.been.called;
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match(/SLACK_SITE_DISCOVERY_CHANNEL_INTERNAL not set/),
    );
  });

  it('marks job COMPLETED even when Slack notification fails', async () => {
    slackPostMessageStub.rejects(new Error('Slack API error'));
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
    expect(result.auditResult.action).to.equal('created');
  });

  // ── hlxConfig extraction ──────────────────────────────────────────────────
  // RSO domains contain '--' which is in DEFAULT_IGNORED_SUBDOMAIN_TOKENS.
  // Tests below override the token list so the RSO domain passes validation.

  it('enriches hlxConfig with all admin config fields for an aem.live RSO domain', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    const adminConfig = {
      cdn: { prod: { host: 'www.mysite.com' } },
      code: { owner: 'myorg' },
      content: { source: {} },
    };
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(200, adminConfig),
    ));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    const { hlxConfig } = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    expect(hlxConfig.rso.owner).to.equal('myorg');
    expect(hlxConfig.rso.site).to.equal('mysite');
    expect(hlxConfig.rso.ref).to.equal('main');
    expect(hlxConfig.rso.tld).to.equal('aem.live');
    expect(hlxConfig.hlxVersion).to.equal(5);
    expect(hlxConfig.cdn).to.deep.equal({ prod: { host: 'www.mysite.com' } });
    expect(hlxConfig.code).to.deep.equal({ owner: 'myorg' });
    expect(hlxConfig.content).to.deep.equal({ source: {} });
  });

  it('includes RSO owner/site/ref in Slack message for RSO domain', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(404),
    ));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    const payload = slackPostMessageStub.firstCall.args[0];
    const text = payload.blocks[0].text.text;
    expect(text).to.include('myorg/mysite');
    expect(text).to.include('main');
  });

  it('calls admin API when hlxVersion is 5 for an hlx.live RSO domain', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.hlx.live', hlxVersion: 5 } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(200, { cdn: {}, code: {}, content: {} }),
    ));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
    const { hlxConfig } = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    expect(hlxConfig.hlxVersion).to.equal(5);
  });

  it('skips admin API call for hlx.live RSO domain when hlxVersion < 5', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.hlx.live', hlxVersion: 4 } });
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
    const { hlxConfig } = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    expect(hlxConfig.hlxVersion).to.equal(4);
    expect(hlxConfig.rso.owner).to.equal('myorg');
    expect(fetchStub).to.have.been.calledOnce; // only the isHelixSite call
  });

  it('skips admin API call when HLX_ADMIN_TOKEN is not set', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    delete context.env.HLX_ADMIN_TOKEN;
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
    expect(fetchStub).to.have.been.calledOnce; // only the isHelixSite call
  });

  it('continues without enrichment when admin API returns 404', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(404),
    ));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
    const { hlxConfig } = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    expect(hlxConfig.hlxVersion).to.be.null;
  });

  it('logs error and continues when admin API returns a non-200/404 status', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(500),
    ));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(sinon.match(/Error fetching hlx config/));
  });

  it('logs error and continues when admin API request throws a network error', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake((url) => {
      if (/admin\.hlx\.page/.test(url)) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve(makeSiteResponse(HELIX_DOM));
    });

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(sinon.match(/Error fetching hlx config/));
  });

  it('warns and continues when response.json() rejects (propagates through extractHlxConfig)', async () => {
    // response.json() returns a rejected Promise → NOT caught by fetchHlxConfig's try/catch
    // (because it's `return response.json()`, not `return await response.json()`)
    // The rejection propagates to the runner's outer try/catch around extractHlxConfig.
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(200, undefined), // undefined body → json() rejects
    ));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.warn).to.have.been.calledWith(sinon.match(/failed to extract hlxConfig/));
    expect(result.auditResult.action).to.equal('created');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('catches unexpected error and marks job FAILED with EXCEPTION code', async () => {
    context.dataAccess.Site.findByBaseURL.rejects(new Error('DB connection lost'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.FAILED);
    expect(mockJob.setError).to.have.been.calledWith(
      sinon.match({ code: 'EXCEPTION', message: 'DB connection lost' }),
    );
    expect(result.auditResult.error).to.equal('DB connection lost');
  });

  it('logs error when saving the FAILED state itself throws', async () => {
    context.dataAccess.Site.findByBaseURL.rejects(new Error('DB error'));
    mockJob.save.rejects(new Error('Save failed'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(sinon.match(/failed to save error state/));
    expect(result.auditResult.error).to.equal('DB error');
  });
});
