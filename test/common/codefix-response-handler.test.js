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
});
