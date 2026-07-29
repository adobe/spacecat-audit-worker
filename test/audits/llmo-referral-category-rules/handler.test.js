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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

describe('llmo-referral-category-rules handler', function () {
  this.timeout(10000);

  const sandbox = sinon.createSandbox();
  const AUDIT_URL = 'https://example.com';
  let context;
  let site;
  let mockGenerateReferralCategoryRules;
  let handlerModule;

  beforeEach(async () => {
    mockGenerateReferralCategoryRules = sandbox.stub().resolves(true);

    site = {
      getId: sandbox.stub().returns('site-123'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({})
      .build();

    handlerModule = await esmock('../../../src/llmo-referral-category-rules/handler.js', {
      '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
        generateReferralCategoryRules: mockGenerateReferralCategoryRules,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('exports a built audit as the default export', () => {
    expect(handlerModule.default).to.exist;
  });

  it('generates rules and returns generated=true when fresh rules are created', async () => {
    mockGenerateReferralCategoryRules.resolves(true);

    const result = await handlerModule.referralCategoryRulesRunner(AUDIT_URL, context, site);

    expect(mockGenerateReferralCategoryRules).to.have.been.calledOnce;
    const arg = mockGenerateReferralCategoryRules.firstCall.args[0];
    expect(arg.site).to.equal(site);
    expect(arg.context).to.equal(context);
    expect(result).to.deep.equal({
      auditResult: { generated: true },
      fullAuditRef: AUDIT_URL,
    });
    expect(context.log.info).to.have.been.calledOnce;
  });

  it('returns generated=false when the site already has rules (no-op)', async () => {
    mockGenerateReferralCategoryRules.resolves(false);

    const result = await handlerModule.referralCategoryRulesRunner(AUDIT_URL, context, site);

    expect(result).to.deep.equal({
      auditResult: { generated: false },
      fullAuditRef: AUDIT_URL,
    });
  });

  it('records the error and does not throw when rule generation fails', async () => {
    mockGenerateReferralCategoryRules.rejects(new Error('boom'));

    const result = await handlerModule.referralCategoryRulesRunner(AUDIT_URL, context, site);

    expect(result).to.deep.equal({
      auditResult: { generated: false, error: 'boom' },
      fullAuditRef: AUDIT_URL,
    });
    expect(context.log.warn).to.have.been.calledOnce;
  });
});
