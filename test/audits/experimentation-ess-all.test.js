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
import { persistOnlyMetadata } from '../../src/experimentation-ess/all.js';

use(sinonChai);

describe('experimentation-ess-all persistOnlyMetadata', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let createdAudit;
  const auditData = {
    siteId: 'da39921f-9a02-41db-b491-02c98330d956',
    auditType: 'experimentation-ess-all',
    auditResult: [{ experiment: 'foo' }],
    fullAuditRef: 'https://www.example.com/',
  };

  beforeEach(() => {
    createdAudit = { getId: () => 'audit-123' };
    context = {
      dataAccess: { Audit: { create: sandbox.stub().resolves(createdAudit) } },
    };
  });

  afterEach(() => sandbox.restore());

  // Regression guard for SITES-47215: the framework (base-audit.js processAuditResult)
  // dereferences the persister's return via audit.getId(); returning undefined threw
  // "Cannot read properties of undefined (reading 'getId')" and failed every ess-all run.
  it('returns the created audit so audit.getId() is available downstream', async () => {
    const result = await persistOnlyMetadata(auditData, context);

    expect(result).to.equal(createdAudit);
    expect(result.getId()).to.equal('audit-123');
  });

  it('persists the metadata but overrides auditResult with an empty array', async () => {
    await persistOnlyMetadata(auditData, context);

    expect(context.dataAccess.Audit.create).to.have.been.calledOnce;
    const persisted = context.dataAccess.Audit.create.firstCall.args[0];
    expect(persisted.siteId).to.equal(auditData.siteId);
    expect(persisted.auditType).to.equal('experimentation-ess-all');
    expect(persisted.fullAuditRef).to.equal(auditData.fullAuditRef);
    expect(persisted.auditResult).to.deep.equal([]);
  });
});
