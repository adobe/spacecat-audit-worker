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

describe('LLM Error Pages – url-validator', () => {
  let urlValidator;
  let fetchStub;
  const sandbox = sinon.createSandbox();

  beforeEach(async () => {
    fetchStub = sandbox.stub();
    // Use esmock to replace tracingFetch with our stub
    urlValidator = await esmock('../../../src/llm-error-pages/url-validator.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: fetchStub },
    });
  });

  afterEach(() => sandbox.restore());

  it('keeps crawler-specific 403 errors (GET 200)', async () => {
    // LLM request returns 403, simple GET returns 200
    fetchStub.onFirstCall().resolves({ status: 200 }); // simple GET
    fetchStub.onSecondCall().resolves({ status: 403 }); // LLM user agent

    const error = {
      url: 'https://example.com/private',
      status: '403',
      userAgent: 'ChatGPT',
      rawUserAgents: ['ChatGPT'],
    };
    const validated = await urlValidator.validateUrlsBatch([error], console);
    expect(validated).to.have.lengthOf(1);
    expect(validated[0].url).to.equal('https://example.com/private');
  });

  it('excludes universally blocked 403 errors (GET 403)', async () => {
    // Simple GET returns 403, indicating universal block
    fetchStub.onFirstCall().resolves({ status: 403 }); // simple GET

    const error = {
      url: 'https://example.com/private',
      status: '403',
      userAgent: 'ChatGPT',
      rawUserAgents: ['ChatGPT'],
    };
    const validated = await urlValidator.validateUrlsBatch([error], console);
    expect(validated).to.have.lengthOf(0);
  });

  it('excludes status mismatch errors (expected 404, got 200)', async () => {
    // Only LLM request performed (function early returns for 404 path)
    fetchStub.resolves({ status: 200 });

    const error = {
      url: 'https://example.com/old',
      status: '404',
      userAgent: 'ChatGPT',
      rawUserAgents: ['ChatGPT'],
    };
    const validated = await urlValidator.validateUrlsBatch([error], console);
    expect(validated).to.have.lengthOf(0);
  });
});
