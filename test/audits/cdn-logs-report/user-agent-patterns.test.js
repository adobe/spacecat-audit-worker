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
import { expect } from 'chai';
import { getProviderPattern } from '../../../src/cdn-logs-report/constants/user-agent-patterns.js';

describe('getProviderPattern', () => {
  it('should return correct pattern for known providers (case-insensitive)', () => {
    expect(getProviderPattern('chatgpt')).to.include('ChatGPT');
    expect(getProviderPattern('CHATGPT')).to.include('ChatGPT');
    expect(getProviderPattern('perplexity')).to.include('Perplexity');
    expect(getProviderPattern('claude')).to.include('Claude');
    expect(getProviderPattern('gemini')).to.include('Gemini');
    expect(getProviderPattern('copilot')).to.include('Copilot');
  });
  it('should return null for unknown provider', () => {
    expect(getProviderPattern('unknown')).to.equal(null);
  });
  it('should return null for undefined or null', () => {
    expect(getProviderPattern(undefined)).to.equal(null);
    expect(getProviderPattern(null)).to.equal(null);
  });
});
