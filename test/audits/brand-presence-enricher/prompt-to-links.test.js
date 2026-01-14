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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('brand-presence-enricher prompt-to-links', () => {
  let sandbox;
  let mockContentAIClient;
  let promptToLinks;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockContentAIClient = {
      initialize: sandbox.stub().resolves(),
      runGenerativeSearch: sandbox.stub(),
    };

    const module = await esmock('../../../src/brand-presence-enricher/prompt-to-links.js', {
      '../../../src/utils/content-ai.js': {
        ContentAIClient: sandbox.stub().returns(mockContentAIClient),
      },
    });

    promptToLinks = module.promptToLinks;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('promptToLinks', () => {
    let mockSite;
    let mockContext;

    beforeEach(() => {
      mockSite = {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
      };

      mockContext = {
        env: {
          CONTENTAI_ENDPOINT: 'https://contentai.example.com',
        },
        log: {
          info: sandbox.stub(),
        },
      };
    });

    it('should return URLs from successful generative search', async () => {
      const mockUrls = [
        'https://example.com/page1',
        'https://example.com/page2',
      ];

      mockContentAIClient.runGenerativeSearch.resolves({
        status: 200,
        json: async () => ({
          data: {
            urls: mockUrls,
          },
        }),
      });

      const result = await promptToLinks('What products do you have?', mockSite, mockContext);

      expect(result).to.deep.equal(mockUrls);
      expect(mockContentAIClient.initialize).to.have.been.calledOnce;
      expect(mockContentAIClient.runGenerativeSearch).to.have.been.calledWith(
        'What products do you have?',
        mockSite,
      );
    });

    it('should throw error when API returns non-200 status', async () => {
      mockContentAIClient.runGenerativeSearch.resolves({
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(promptToLinks('Test prompt', mockSite, mockContext))
        .to.be.rejectedWith('Error calling API - Internal Server Error');
    });

    it('should throw error for 404 responses', async () => {
      mockContentAIClient.runGenerativeSearch.resolves({
        status: 404,
        statusText: 'Not Found',
      });

      await expect(promptToLinks('Test prompt', mockSite, mockContext))
        .to.be.rejectedWith('Error calling API - Not Found');
    });

    it('should initialize ContentAIClient before calling runGenerativeSearch', async () => {
      mockContentAIClient.runGenerativeSearch.resolves({
        status: 200,
        json: async () => ({
          data: {
            urls: [],
          },
        }),
      });

      await promptToLinks('Test prompt', mockSite, mockContext);

      expect(mockContentAIClient.initialize).to.have.been.calledBefore(
        mockContentAIClient.runGenerativeSearch,
      );
    });

    it('should handle empty URLs array', async () => {
      mockContentAIClient.runGenerativeSearch.resolves({
        status: 200,
        json: async () => ({
          data: {
            urls: [],
          },
        }),
      });

      const result = await promptToLinks('Test prompt', mockSite, mockContext);

      expect(result).to.deep.equal([]);
    });
  });
});
