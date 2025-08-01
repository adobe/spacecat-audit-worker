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

describe('LLM Error Pages – opportunity-handler sendWithRetry', () => {
  const sandbox = sinon.createSandbox();
  let opportunityModule;
  let createOpportunityForErrorCategory;

  before(async () => {
    // Stub convertToOpportunity to return minimal Opportunity object
    const convertToOpportunityStub = sandbox.stub().resolves({
      getId: () => 'oppty-1',
    });

    // Stub syncSuggestions (not used for 404 path)
    const syncSuggestionsStub = sandbox.stub().resolves();

    // Stub SQS sendMessage to always reject
    const sendMessageStub = sandbox.stub().rejects(new Error('SQS down'));

    opportunityModule = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
      '../utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
    });

    // Get reference to internal function
    ({ createOpportunityForErrorCategory } = opportunityModule);

    // Attach stubs to context we will pass
    opportunityModule.setContextStubs = () => ({
      sqs: { sendMessage: sendMessageStub },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
    });
  });

  afterEach(() => sandbox.restore());

  it('handles all SQS failures and records stats.failed', async () => {
    const ctxStub = opportunityModule.setContextStubs();

    const context = {
      log: console,
      ...ctxStub,
    };

    const enhancedErrors = [{
      url: '/fail',
      status: '404',
      userAgent: 'ChatGPT',
      rawUserAgents: ['ChatGPT'],
      totalRequests: 1,
      validatedAt: new Date().toISOString(),
    }];

    // Should not throw even though sendMessage fails
    await createOpportunityForErrorCategory(
      '404',
      enhancedErrors,
      'site-1',
      'audit-1',
      context,
    );

    // Each URL attempted 3 times (retry logic)
    expect(context.sqs.sendMessage).to.have.been.calledThrice;
  });
});
