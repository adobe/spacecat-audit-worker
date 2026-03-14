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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { createInternalLinksRumSteps } from '../../../src/internal-links/rum-detection.js';

use(chaiAsPromised);
use(sinonChai);

describe('internal-links rum-detection', () => {
  function createLog() {
    return {
      info: sinon.stub(),
      debug: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  }

  function createSite() {
    return {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
    };
  }

  function createSteps(overrides = {}) {
    return createInternalLinksRumSteps({
      auditType: 'broken-internal-links',
      interval: 30,
      createContextLogger: (log) => log,
      createRUMAPIClient: sinon.stub(),
      resolveFinalUrl: sinon.stub().resolves('https://example.com'),
      isLinkInaccessible: sinon.stub(),
      calculatePriority: (links) => links.map((link) => ({ ...link, priority: 'high' })),
      isWithinAuditScope: sinon.stub().returns(true),
      ...overrides,
    });
  }

  it('returns unsuccessful result when rum query throws', async () => {
    const rumApiClient = {
      query: sinon.stub().rejects(new Error('rum exploded')),
    };
    const log = createLog();
    const { internalLinksAuditRunner } = createSteps();

    const result = await internalLinksAuditRunner('https://audit.example', {
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
    });

    expect(result).to.deep.equal({
      fullAuditRef: 'https://audit.example',
      auditResult: {
        finalUrl: 'https://audit.example',
        error: 'audit failed with error: rum exploded',
        success: false,
      },
    });
    expect(log.error).to.have.been.called;
  });

  it('returns an empty successful result when rum has no matching links', async () => {
    const createRUMAPIClient = sinon.stub().returns({
      query: sinon.stub().resolves([]),
    });
    const log = createLog();
    const { internalLinksAuditRunner } = createSteps({
      createRUMAPIClient,
      resolveFinalUrl: sinon.stub().resolves('https://resolved.example'),
    });

    const result = await internalLinksAuditRunner('https://audit.example', {
      log,
      site: createSite(),
    });

    expect(result).to.deep.equal({
      fullAuditRef: 'https://audit.example',
      auditResult: {
        brokenInternalLinks: [],
        fullAuditRef: 'https://audit.example',
        finalUrl: 'https://resolved.example',
        auditContext: { interval: 30 },
        success: true,
      },
    });
    expect(createRUMAPIClient).to.have.been.calledOnce;
    expect(log.info).to.have.been.calledWith('No 404 internal links found in RUM data');
  });

  it('runs the top-pages step on successful rum detection', async () => {
    const rumApiClient = {
      query: sinon.stub().resolves([
        {
          url_from: 'https://example.com/source',
          url_to: 'https://example.com/missing',
          traffic_domain: 42,
        },
      ]),
    };
    const isLinkInaccessible = sinon.stub().resolves({
      isBroken: true,
      inconclusive: false,
      httpStatus: 404,
      statusBucket: 'not_found_404',
      contentType: 'text/html',
    });
    const log = createLog();
    const { runAuditAndImportTopPagesStep } = createSteps({ isLinkInaccessible });

    const result = await runAuditAndImportTopPagesStep({
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
      audit: {
        getId: () => 'audit-1',
      },
    });

    expect(result).to.deep.equal({
      auditResult: {
        brokenInternalLinks: [{
          urlFrom: 'https://example.com/source',
          urlTo: 'https://example.com/missing',
          trafficDomain: 42,
          detectionSource: 'rum',
          httpStatus: 404,
          statusBucket: 'not_found_404',
          contentType: 'text/html',
          priority: 'high',
        }],
        fullAuditRef: 'https://example.com',
        finalUrl: 'https://example.com',
        auditContext: { interval: 30 },
        success: true,
      },
      fullAuditRef: 'https://example.com',
      type: 'top-pages',
      siteId: 'site-1',
    });
    expect(log.info).to.have.been.calledWith(
      sinon.match('Triggering import worker to fetch Ahrefs top pages'),
    );
  });

  it('logs inconclusive and failed validation counts in rum summary', async () => {
    const rumApiClient = {
      query: sinon.stub().resolves([
        {
          url_from: 'https://example.com/source-1',
          url_to: 'https://example.com/maybe-broken',
          traffic_domain: 20,
        },
        {
          url_from: 'https://example.com/source-2',
          url_to: 'https://example.com/rejected',
          traffic_domain: 10,
        },
      ]),
    };
    const isLinkInaccessible = sinon.stub();
    isLinkInaccessible.withArgs('https://example.com/maybe-broken').resolves({
      isBroken: false,
      inconclusive: true,
      httpStatus: null,
      statusBucket: null,
      contentType: null,
    });
    isLinkInaccessible.withArgs('https://example.com/rejected').rejects(new Error('network exploded'));

    const log = createLog();
    const { internalLinksAuditRunner } = createSteps({ isLinkInaccessible });

    const result = await internalLinksAuditRunner('https://example.com', {
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
    });

    expect(result.auditResult.brokenInternalLinks).to.deep.equal([]);
    expect(log.info).to.have.been.calledWith(
      'Validation results: 0 still broken, 0 now fixed, 1 inconclusive, 1 failed',
    );
  });

  it('logs when out-of-scope rum links are filtered before validation', async () => {
    const rumApiClient = {
      query: sinon.stub().resolves([
        {
          url_from: 'https://example.com/source',
          url_to: 'https://example.com/missing',
          traffic_domain: 20,
        },
        {
          url_from: 'https://example.com/out-of-scope',
          url_to: 'https://external.example/missing',
          traffic_domain: 10,
        },
      ]),
    };
    const isWithinAuditScope = sinon.stub();
    isWithinAuditScope.withArgs('https://example.com/source', 'https://example.com').returns(true);
    isWithinAuditScope.withArgs('https://example.com/missing', 'https://example.com').returns(true);
    isWithinAuditScope.withArgs('https://example.com/out-of-scope', 'https://example.com').returns(true);
    isWithinAuditScope.withArgs('https://external.example/missing', 'https://example.com').returns(false);

    const isLinkInaccessible = sinon.stub().resolves({
      isBroken: true,
      inconclusive: false,
      httpStatus: 404,
      statusBucket: 'not_found_404',
      contentType: 'text/html',
    });
    const log = createLog();
    const { internalLinksAuditRunner } = createSteps({ isWithinAuditScope, isLinkInaccessible });

    const result = await internalLinksAuditRunner('https://example.com', {
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
    });

    expect(result.auditResult.brokenInternalLinks).to.have.lengthOf(1);
    expect(log.info).to.have.been.calledWith('Filtered out 1 RUM links outside the audit scope before validation');
  });

  it('throws from the top-pages step when rum detection fails', async () => {
    const rumApiClient = {
      query: sinon.stub().rejects(new Error('upstream down')),
    };
    const log = createLog();
    const { runAuditAndImportTopPagesStep } = createSteps();

    await expect(runAuditAndImportTopPagesStep({
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
    })).to.be.rejectedWith('Audit failed, skip scraping and suggestion generation');

    expect(log.error).to.have.been.calledWith('RUM detection audit failed');
  });

  it('logs zero broken links when prioritized rum links are undefined', async () => {
    const rumApiClient = {
      query: sinon.stub().resolves([
        {
          url_from: 'https://example.com/source',
          url_to: 'https://example.com/missing',
          traffic_domain: 5,
        },
      ]),
    };
    const isLinkInaccessible = sinon.stub().resolves({
      isBroken: true,
      inconclusive: false,
      httpStatus: 404,
      statusBucket: 'not_found_404',
      contentType: 'text/html',
    });
    const log = createLog();
    const { runAuditAndImportTopPagesStep } = createInternalLinksRumSteps({
      auditType: 'broken-internal-links',
      interval: 30,
      createContextLogger: (baseLog) => baseLog,
      createRUMAPIClient: sinon.stub(),
      resolveFinalUrl: sinon.stub().resolves('https://example.com'),
      isLinkInaccessible,
      calculatePriority: () => undefined,
      isWithinAuditScope: sinon.stub().returns(true),
    });

    const result = await runAuditAndImportTopPagesStep({
      log,
      site: createSite(),
      rumApiClient,
      finalUrl: 'https://example.com',
    });

    expect(result.auditResult.brokenInternalLinks).to.equal(undefined);
    expect(log.info).to.have.been.calledWith('RUM detection complete. Found 0 broken links');
  });
});
