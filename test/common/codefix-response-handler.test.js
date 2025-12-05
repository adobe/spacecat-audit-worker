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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('CodeFixResponseHandler', () => {
  let sandbox;
  let context;
  let mockDataAccess;
  let mockOpportunity;
  let CodeFixConfigurationError;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Import error class
    const codefixHandler = await import('../../src/common/codefix-handler.js');
    CodeFixConfigurationError = codefixHandler.CodeFixConfigurationError;

    mockOpportunity = {
      getId: sandbox.stub().returns('opportunity-123'),
      getSiteId: sandbox.stub().returns('site-123'),
      getSuggestions: sandbox.stub().resolves([]),
    };

    mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        dataAccess: mockDataAccess,
        s3Client: { send: sandbox.stub().resolves() },
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'test-mystique-bucket',
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Error Handling', () => {
    it('should handle CodeFixConfigurationError when thrown from processCodeFixUpdate', async () => {
      // Stub the DataAccess to throw CodeFixConfigurationError
      mockDataAccess.Opportunity.findById.rejects(
        new CodeFixConfigurationError('Custom configuration error message'),
      );

      const handler = await esmock('../../src/common/codefix-response-handler.js', {
        '../../src/common/codefix-handler.js': await esmock('../../src/common/codefix-handler.js', {
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sandbox.stub().resolves(null),
          },
        }),
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:test',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/test',
              aggregation_key: 'test-key',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Unexpected error for codefix:test: Custom configuration error message/),
      );

      // Restore the stub
      mockDataAccess.Opportunity.findById.resolves(mockOpportunity);
    });
  });

  describe('Suggestion Matching Logic', () => {
    let mockSuggestion1;
    let mockSuggestion2;
    let mockSuggestion3;
    let getObjectFromKeyStub;
    let handler;

    beforeEach(async () => {
      // Mock suggestions with different URLs and aggregation keys
      mockSuggestion1 = {
        getId: () => 'suggestion-1',
        getData: () => ({
          url: 'https://example.com/page1',
          source: 'axe',
          issues: [{
            type: 'aria-allowed-attr',
            htmlWithIssues: [{
              target_selector: '.button',
              html: '<button aria-hidden="true">Click</button>',
            }],
          }],
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockSuggestion2 = {
        getId: () => 'suggestion-2',
        getData: () => ({
          url: 'https://example.com/page2',
          source: 'axe',
          issues: [{
            type: 'aria-allowed-attr',
            htmlWithIssues: [{
              target_selector: '.link',
              html: '<a aria-invalid="true">Link</a>',
            }],
          }],
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockSuggestion3 = {
        getId: () => 'suggestion-3',
        getData: () => ({
          url: 'https://example.com/page3',
          source: 'axe',
          issues: [{
            type: 'link-name',
            htmlWithIssues: [{
              target_selector: '.nav-link',
              html: '<a href="#">Nav</a>',
            }],
          }],
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestion2,
        mockSuggestion3,
      ]);

      getObjectFromKeyStub = sandbox.stub();

      handler = await esmock('../../src/common/codefix-response-handler.js', {
        '../../src/common/codefix-handler.js': await esmock('../../src/common/codefix-handler.js', {
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });
    });

    it('should match suggestions by aggregation key only for PER_TYPE granularity (new format)', async () => {
      // Setup: aria-allowed-attr has PER_TYPE granularity, so aggregation key
      // is just the issue type
      getObjectFromKeyStub.resolves({
        diff: '--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old\n+new',
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              aggregation_key: 'aria-allowed-attr',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // Both suggestion1 and suggestion2 should be updated (they have aria-allowed-attr)
      expect(mockSuggestion1.save).to.have.been.calledOnce;
      expect(mockSuggestion2.save).to.have.been.calledOnce;
      // suggestion3 should NOT be updated (it has link-name)
      expect(mockSuggestion3.save).to.not.have.been.called;
    });

    it('should match suggestions by URL+issue type+selector for PER_PAGE_PER_COMPONENT granularity (new format)', async () => {
      // Change suggestion3 to button-name which has PER_PAGE_PER_COMPONENT
      // granularity
      const buttonSuggestion = {
        getId: () => 'suggestion-button',
        getData: () => ({
          url: 'https://example.com/page3',
          source: 'axe',
          issues: [{
            type: 'button-name',
            htmlWithIssues: [{
              target_selector: '.btn',
              html: '<button>Click</button>',
            }],
          }],
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestion2,
        buttonSuggestion,
      ]);

      getObjectFromKeyStub.resolves({
        diff: '--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old\n+new',
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page3',
              aggregation_key: 'https://example.com/page3|button-name|axe',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // Only buttonSuggestion should be updated (matches URL, type, selector)
      expect(mockSuggestion1.save).to.not.have.been.called;
      expect(mockSuggestion2.save).to.not.have.been.called;
      expect(buttonSuggestion.save).to.have.been.calledOnce;
    });

    it('should use backwards compatible matching for old format (types array)', async () => {
      // Create a suggestion with old format expectations
      const oldFormatSuggestion = {
        getId: () => 'suggestion-old',
        getData: () => ({
          url: 'https://example.com/legacy',
          source: 'axe',
          issues: [{
            type: 'color-contrast',
          }],
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockOpportunity.getSuggestions.resolves([oldFormatSuggestion]);

      getObjectFromKeyStub.resolves({
        diff: '--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old\n+new',
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/legacy',
              source: 'axe',
              types: ['color-contrast'],
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // Old format suggestion should be updated using URL+source+type matching
      expect(oldFormatSuggestion.save).to.have.been.calledOnce;
    });

    it('should not update suggestions when aggregation key does not match', async () => {
      getObjectFromKeyStub.resolves({
        diff: '--- a/file.js\n+++ b/file.js\n@@ -1 +1 @@\n-old\n+new',
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              aggregation_key: 'non-existent-issue-type',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // No suggestions should be updated
      expect(mockSuggestion1.save).to.not.have.been.called;
      expect(mockSuggestion2.save).to.not.have.been.called;
      expect(mockSuggestion3.save).to.not.have.been.called;
    });

    it('should not update suggestions when diff is empty', async () => {
      // Return report with empty diff
      getObjectFromKeyStub.resolves({
        diff: '',
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              aggregation_key: 'aria-allowed-attr',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // No suggestions should be updated because diff is empty
      expect(mockSuggestion1.save).to.not.have.been.called;
      expect(mockSuggestion2.save).to.not.have.been.called;
      expect(mockSuggestion3.save).to.not.have.been.called;
    });
  });
});
