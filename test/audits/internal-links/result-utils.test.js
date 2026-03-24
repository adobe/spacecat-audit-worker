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
import {
  filterByStatusIfNeeded,
  filterByItemTypes,
  isCanonicalOrHreflangLink,
  createUpdateAuditResult,
} from '../../../src/internal-links/result-utils.js';
import { createInternalLinksContextLogger } from '../../../src/internal-links/logging.js';

use(sinonChai);

describe('internal-links result utils', () => {
  it('filters links by configured status buckets', () => {
    const links = [
      { urlTo: '/a', statusBucket: 'not_found_404' },
      { urlTo: '/b', statusBucket: 'server_error_5xx' },
      { urlTo: '/c', statusBucket: null },
    ];

    expect(filterByStatusIfNeeded(links, ['not_found_404'])).to.deep.equal([
      { urlTo: '/a', statusBucket: 'not_found_404' },
      { urlTo: '/c', statusBucket: null },
    ]);
  });

  it('returns original links when no status bucket filter is configured', () => {
    const links = [{ urlTo: '/a', statusBucket: 'not_found_404' }];

    expect(filterByStatusIfNeeded(links, [])).to.equal(links);
    expect(filterByStatusIfNeeded(links, null)).to.equal(links);
  });

  it('filters links by configured item types treating missing itemType as link', () => {
    const links = [
      { urlTo: '/a' },
      { urlTo: '/b', itemType: 'image' },
      { urlTo: '/c', itemType: 'form' },
    ];

    expect(filterByItemTypes(links, ['link', 'form'])).to.deep.equal([
      { urlTo: '/a' },
      { urlTo: '/c', itemType: 'form' },
    ]);
  });

  it('returns original links when no itemType filter is configured', () => {
    const links = [{ urlTo: '/a' }];

    expect(filterByItemTypes(links, [])).to.equal(links);
    expect(filterByItemTypes(links, undefined)).to.equal(links);
  });

  it('identifies canonical and alternate links for exclusion', () => {
    expect(isCanonicalOrHreflangLink({ itemType: 'canonical' })).to.equal(true);
    expect(isCanonicalOrHreflangLink({ itemType: 'alternate' })).to.equal(true);
    expect(isCanonicalOrHreflangLink({ itemType: 'link' })).to.equal(false);
  });

  it('updates audit results directly when the audit model exposes setAuditResult', async () => {
    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const createAuditLogger = sinon.stub().returns(log);
    const audit = {
      getId: () => 'audit-123',
      setAuditResult: sinon.stub(),
      save: sinon.stub().resolves(),
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    const result = await updateAuditResult(
      audit,
      { success: true },
      [{ urlTo: '/broken' }],
      {},
      log,
      'site-123',
      { internalLinksWorkflowCompletedAt: '2026-03-16T00:00:00.000Z' },
    );

    expect(result).to.deep.equal({
      success: true,
      brokenInternalLinks: [{ urlTo: '/broken' }],
      internalLinksWorkflowCompletedAt: '2026-03-16T00:00:00.000Z',
    });
    expect(audit.setAuditResult).to.have.been.calledWith(result);
    expect(audit.save).to.have.been.calledOnce;
  });

  it('falls back to loading and warning when a database-loaded audit cannot save', async () => {
    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const createAuditLogger = sinon.stub().returns(log);
    const loadedAudit = {
      setAuditResult: sinon.stub(),
    };
    const dataAccess = {
      Audit: {
        findById: sinon.stub().resolves(loadedAudit),
      },
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    await updateAuditResult(
      { id: 'audit-lookup' },
      { success: true },
      [{ urlTo: '/broken' }],
      dataAccess,
      log,
      'site-123',
    );

    expect(dataAccess.Audit.findById).to.have.been.calledWith('audit-lookup');
    expect(loadedAudit.setAuditResult).to.have.been.calledOnce;
    expect(log.warn).to.have.been.calledWith(
      'Audit audit-lookup loaded without save(); skipping persisted audit result update',
    );
  });

  it('persists fallback database updates when the loaded audit uses plain properties', async () => {
    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const createAuditLogger = sinon.stub().returns(log);
    const loadedAudit = {
      save: sinon.stub().resolves(),
    };
    const dataAccess = {
      Audit: {
        findById: sinon.stub().resolves(loadedAudit),
      },
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    const result = await updateAuditResult(
      { id: 'audit-lookup' },
      { success: true },
      [{ urlTo: '/broken' }],
      dataAccess,
      log,
      'site-123',
    );

    expect(loadedAudit.auditResult).to.deep.equal(result);
    expect(loadedAudit.save).to.have.been.calledOnce;
    expect(log.info).to.have.been.calledWith(
      'Updated audit result via database lookup with 1 prioritized broken links',
    );
  });

  it('warns when the fallback database lookup cannot find the audit', async () => {
    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const createAuditLogger = sinon.stub().returns(log);
    const dataAccess = {
      Audit: {
        findById: sinon.stub().resolves(null),
      },
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    await updateAuditResult(
      { id: 'missing-audit' },
      { success: true },
      [],
      dataAccess,
      log,
      'site-123',
    );

    expect(log.warn).to.have.been.calledWith('Could not find audit with ID missing-audit to update');
  });

  it('logs errors when persistence fails', async () => {
    const log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const createAuditLogger = sinon.stub().returns(log);
    const audit = {
      getId: () => 'audit-123',
      setAuditResult: sinon.stub().throws(new Error('boom')),
      save: sinon.stub().resolves(),
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    await updateAuditResult(audit, { success: true }, [], {}, log, 'site-123');

    expect(log.error).to.have.been.calledWith('Failed to update audit result: boom');
  });

  it('reuses an existing internal-links contextual logger', async () => {
    const baseLog = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };
    const contextualLog = createInternalLinksContextLogger(baseLog, {
      auditType: 'broken-internal-links',
      siteId: 'site-123',
      auditId: 'audit-123',
      step: 'result-utils-test',
    });
    const createAuditLogger = sinon.stub().returns(baseLog);
    const audit = {
      getId: () => 'audit-123',
      setAuditResult: sinon.stub(),
      save: sinon.stub().resolves(),
    };
    const updateAuditResult = createUpdateAuditResult({
      auditType: 'broken-internal-links',
      createAuditLogger,
    });

    await updateAuditResult(
      audit,
      { success: true },
      [{ urlTo: '/broken' }],
      {},
      contextualLog,
      'site-123',
    );

    expect(createAuditLogger).to.not.have.been.called;
    expect(baseLog.info).to.have.been.calledWith(
      '[auditType=broken-internal-links] [siteId=site-123] [auditId=audit-123] [step=result-utils-test] Updated audit result with 1 prioritized broken links',
    );
  });
});
