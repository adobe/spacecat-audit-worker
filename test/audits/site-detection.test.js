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
const PUBLIC_IP = '93.184.216.34'; // example.com

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
  let dnsLookupStub;
  let slackPostMessageStub;
  let siteDetectionRunner;

  beforeEach(async () => {
    fetchStub = sandbox.stub();
    // Default DNS resolution to a public IP so isHelixSite's SSRF guard
    // does not short-circuit tests that don't care about it.
    dnsLookupStub = sandbox.stub().resolves([{ address: PUBLIC_IP, family: 4 }]);
    slackPostMessageStub = sandbox.stub().resolves();
    const mockSlackClient = { postMessage: slackPostMessageStub };
    const mockBaseSlackClient = { createFrom: sandbox.stub().returns(mockSlackClient) };

    ({ siteDetectionRunner } = await esmock('../../src/site-detection/handler.js', {
      'dns/promises': { default: { lookup: dnsLookupStub }, lookup: dnsLookupStub },
      '@adobe/spacecat-shared-utils': { ...sharedUtils, fetch: fetchStub },
      '@adobe/spacecat-shared-slack-client': {
        BaseSlackClient: mockBaseSlackClient,
        SLACK_TARGETS: { WORKSPACE_INTERNAL: 'workspace_internal' },
      },
    }));

    mockJob = {
      getId: sandbox.stub().returns(JOB_ID),
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

  it('returns error when jobId is missing from message', async () => {
    const result = await siteDetectionRunner({}, context);

    expect(result.auditResult.error).to.equal('Missing jobId');
    expect(context.dataAccess.AsyncJob.findById).to.not.have.been.called;
  });

  it('returns error when job not found', async () => {
    context.dataAccess.AsyncJob.findById.resolves(null);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.error).to.equal('Job not found');
  });

  it('skips when job is not IN_PROGRESS (COMPLETED)', async () => {
    mockJob.getStatus.returns(AsyncJob.Status.COMPLETED);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.skipped).to.be.true;
  });

  it('skips when job is not IN_PROGRESS (FAILED)', async () => {
    mockJob.getStatus.returns(AsyncJob.Status.FAILED);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.skipped).to.be.true;
  });

  it('marks job FAILED when metadata is null (null coalescing branch)', async () => {
    mockJob.getMetadata.returns(null);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.FAILED);
    expect(mockJob.setError).to.have.been.calledWith(sinon.match({ code: 'INVALID_PAYLOAD' }));
    expect(result.auditResult.error).to.equal('Missing domain');
  });

  it('marks job FAILED when domain is missing from payload, and save is wrapped in try/catch', async () => {
    mockJob.getMetadata.returns({ payload: {} });
    mockJob.save.rejects(new Error('DB transient'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    // Runner completes successfully despite save() throwing (no poison pill).
    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.FAILED);
    expect(context.log.error).to.have.been.calledWith(sinon.match(/failed to save error state/));
    expect(result.auditResult.error).to.equal('Missing domain');
  });

  it('saves normally when domain is missing and save succeeds', async () => {
    mockJob.getMetadata.returns({ payload: {} });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.FAILED);
    expect(mockJob.setError).to.have.been.calledWith(sinon.match({ code: 'INVALID_PAYLOAD' }));
    expect(mockJob.save).to.have.been.calledOnce;
    expect(result.auditResult.error).to.equal('Missing domain');
  });

  // ── Domain validation → COMPLETED / rejected ──────────────────────────────

  it('accepts domain already prefixed with https:// (startsWith branch)', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'https://foo.example.com', hlxVersion: null } });
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
  });

  it('marks COMPLETED/rejected for a malformed / whitespace-padded domain', async () => {
    mockJob.getMetadata.returns({ payload: { domain: '  not a domain  ' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

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

  it('rejects apex domain (no subdomain)', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'adobe.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('strips www. prefix when composing baseURL (www.foo.example.com → https://foo.example.com)', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'www.foo.example.com', hlxVersion: null } });
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.dataAccess.SiteCandidate.create).to.have.been.calledWith(
      sinon.match({ baseURL: 'https://foo.example.com' }),
    );
  });

  it('rejects www-only alias of an apex domain (www.adobe.com)', async () => {
    mockJob.getMetadata.returns({ payload: { domain: 'www.adobe.com' } });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
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

  // ── Duplicate detection → COMPLETED / duplicate ────────────────────────────

  it('marks COMPLETED/duplicate when site already exists as AEM_EDGE delivery type', async () => {
    context.dataAccess.Site.findByBaseURL.resolves({
      getDeliveryType: () => SiteModel.DELIVERY_TYPES.AEM_EDGE,
    });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
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

  it('marks COMPLETED/duplicate when a site candidate already exists', async () => {
    context.dataAccess.SiteCandidate.findByBaseURL.resolves({
      getBaseURL: () => TEST_BASE_URL,
    });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
    expect(mockJob.setResult).to.have.been.calledWith(
      sinon.match({ action: 'duplicate', reason: 'Site candidate already evaluated' }),
    );
    expect(result.auditResult.action).to.equal('duplicate');
  });

  // ── Helix verification & SSRF guard ────────────────────────────────────────

  it('marks COMPLETED/rejected when site fetch throws a network error (generic reason)', async () => {
    fetchStub.rejects(new Error('ECONNREFUSED 10.0.0.5:443'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setStatus).to.have.been.calledWith(AsyncJob.Status.COMPLETED);
    const resultArg = mockJob.setResult.lastCall.args[0];
    expect(resultArg.action).to.equal('rejected');
    // Network error detail must not reach the caller.
    expect(resultArg.reason).to.not.include('ECONNREFUSED');
    expect(resultArg.reason).to.not.include('10.0.0.5');
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('marks COMPLETED/rejected when resp.text() throws a stream error', async () => {
    fetchStub.resolves({
      status: 200,
      text: () => Promise.reject(new Error('stream closed')),
    });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('marks COMPLETED/rejected when site returns non-Helix DOM (generic reason, no status leak)', async () => {
    fetchStub.resolves(makeSiteResponse(NON_HELIX_DOM, 418));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    const resultArg = mockJob.setResult.lastCall.args[0];
    expect(resultArg.action).to.equal('rejected');
    expect(resultArg.reason).to.not.include('418');
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('treats a 302 redirect as non-Helix (does not follow into potentially internal host)', async () => {
    fetchStub.resolves({ status: 302, text: async () => '' });

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    // redirect: 'manual' passed to fetch
    expect(fetchStub.firstCall.args[1]).to.deep.include({ redirect: 'manual' });
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('SSRF: rejects hostname that resolves to RFC1918 (10/8) without calling fetch', async () => {
    dnsLookupStub.resolves([{ address: '10.0.0.5', family: 4 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
    expect(result.auditResult.action).to.equal('rejected');
  });

  it('SSRF: rejects hostname that resolves to AWS metadata (169.254.169.254)', async () => {
    dnsLookupStub.resolves([{ address: '169.254.169.254', family: 4 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects hostname that resolves to loopback (127.0.0.1)', async () => {
    dnsLookupStub.resolves([{ address: '127.0.0.1', family: 4 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects IPv6 loopback (::1)', async () => {
    dnsLookupStub.resolves([{ address: '::1', family: 6 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects IPv6 link-local (fe80::)', async () => {
    dnsLookupStub.resolves([{ address: 'fe80::1', family: 6 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects IPv4-mapped IPv6 pointing at private v4', async () => {
    dnsLookupStub.resolves([{ address: '::ffff:10.0.0.5', family: 6 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects when DNS lookup itself fails', async () => {
    dnsLookupStub.rejects(new Error('ENOTFOUND'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects when DNS lookup resolves to empty list', async () => {
    dnsLookupStub.resolves([]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
    expect(mockJob.setResult).to.have.been.calledWith(sinon.match({ action: 'rejected' }));
  });

  it('SSRF: rejects CGNAT range (100.64/10)', async () => {
    dnsLookupStub.resolves([{ address: '100.64.0.1', family: 4 }]);

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects 172.16/12 range', async () => {
    dnsLookupStub.resolves([{ address: '172.20.0.1', family: 4 }]);

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects 192.168/16 range', async () => {
    dnsLookupStub.resolves([{ address: '192.168.1.1', family: 4 }]);

    // Note: hostname foo.example.com still passes isValidCandidate; the 192.168
    // rejection happens inside isHelixSite via the DNS guard.
    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects 0.0.0.0/8 range', async () => {
    dnsLookupStub.resolves([{ address: '0.0.0.0', family: 4 }]);

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects multicast / reserved ranges (224+)', async () => {
    dnsLookupStub.resolves([{ address: '224.0.0.1', family: 4 }]);

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects when any resolved address is private (mixed public + private)', async () => {
    dnsLookupStub.resolves([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF: rejects when a resolved address field is not a string', async () => {
    dnsLookupStub.resolves([{ address: null, family: 4 }]);

    await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.not.have.been.called;
  });

  it('allows a public IPv6 address (v6 fallthrough)', async () => {
    dnsLookupStub.resolves([{ address: '2606:4700:4700::1111', family: 6 }]);
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(fetchStub).to.have.been.called;
    expect(result.auditResult.action).to.equal('created');
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

  it('logs and swallows error when happy-path save() throws', async () => {
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));
    mockJob.save.rejects(new Error('DB transient'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/failed to save COMPLETED state/),
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

  it('calls admin API for aem.live RSO even when hlxVersion < 5', async () => {
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: 4 } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(200, { cdn: {}, code: {}, content: {} }),
    ));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(result.auditResult.action).to.equal('created');
    const { hlxConfig } = context.dataAccess.SiteCandidate.create.firstCall.args[0];
    // aem.live branch forces admin enrichment → version bumped to 5
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

  it('logs error in fetchHlxConfig and continues when response.json() rejects', async () => {
    // response.json() rejects → caught by fetchHlxConfig's own try/catch (returns null)
    // → extractHlxConfig returns the default hlxConfig → runner proceeds and creates the candidate
    context.env.SITE_DETECTION_IGNORED_SUBDOMAIN_TOKENS = 'demo,dev,stg';
    mockJob.getMetadata.returns({ payload: { domain: 'main--mysite--myorg.aem.live', hlxVersion: null } });
    fetchStub.callsFake(makeDispatcher(
      makeSiteResponse(HELIX_DOM),
      makeAdminResponse(200, undefined), // undefined body → json() rejects
    ));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(sinon.match(/Error fetching hlx config/));
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

  it('logs error when SiteCandidate.create fails and job.save() also fails', async () => {
    fetchStub.resolves(makeSiteResponse(HELIX_DOM));
    context.dataAccess.SiteCandidate.create.rejects(new Error('DB write failed'));
    mockJob.save.rejects(new Error('Save failed'));

    const result = await siteDetectionRunner({ jobId: JOB_ID }, context);

    expect(context.log.error).to.have.been.calledWith(sinon.match(/failed to save error state/));
    expect(result.auditResult.error).to.equal('DB write failed');
  });
});
