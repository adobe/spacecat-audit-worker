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
import { MockContextBuilder } from '../../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('AccessibilityCodeFixHandler', () => {
  let sandbox;
  let context;
  let mockDataAccess;
  let mockOpportunity;
  let mockSuggestion;
  let getObjectFromKeyStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockSuggestion = {
      getId: sandbox.stub().returns('suggestion-123'),
      getData: sandbox.stub(),
      setData: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    mockOpportunity = {
      getId: sandbox.stub().returns('opportunity-123'),
      getSiteId: sandbox.stub().returns('site-123'),
      getSuggestions: sandbox.stub().resolves([mockSuggestion]),
    };

    mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
      },
    };

    getObjectFromKeyStub = sandbox.stub();

    const mockS3Client = {
      send: sandbox.stub().resolves(),
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
        s3Client: mockS3Client,
        env: {
          S3_MYSTIQUE_BUCKET_NAME: 'test-mystique-bucket',
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const validMessage = {
    siteId: 'site-123',
    type: 'codefix:accessibility',
    data: {
      opportunityId: 'opportunity-123',
      updates: [
        {
          url: 'https://example.com/contact',
          source: 'form',
          aggregation_key: 'color-contrast',
        },
      ],
    },
  };

  describe('Main Handler Function', () => {
    it('should successfully process updates with matching suggestions', async () => {
      const mockReportData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
        diff: 'mock diff content',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.calledWith({
        ...suggestionData,
        patchContent: 'mock diff content',
        isCodeChangeAvailable: true,
      });
      expect(mockSuggestion.save).to.have.been.called;
    });

    it('should return badRequest when no data provided', async () => {
      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const message = { siteId: 'site-123', type: 'codefix:accessibility' };
      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/No data provided in message/),
      );
    });

    it('should return badRequest when no opportunityId provided', async () => {
      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const message = {
        siteId: 'site-123',
        data: { updates: [] },
      };
      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Validation error.*No opportunityId provided/),
      );
    });

    it('should return badRequest when no updates provided', async () => {
      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const message = {
        siteId: 'site-123',
        data: { opportunityId: 'opportunity-123' },
      };
      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
    });

    it('should return notFound when opportunity not found', async () => {
      mockDataAccess.Opportunity.findById.resolves(null);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Not found.*Opportunity not found for ID: opportunity-123/),
      );
    });

    it('should return badRequest when site ID mismatch', async () => {
      mockOpportunity.getSiteId.returns('different-site-id');

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(400);
    });

    it('should return ok when no suggestions found', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
    });

    it('should return internalServerError when S3 bucket not configured', async () => {
      context.env.S3_MYSTIQUE_BUCKET_NAME = undefined;

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
    });

    it('should handle missing S3 reports gracefully', async () => {
      getObjectFromKeyStub.resolves(null);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No code change report found for URL/),
      );
    });

    it('should handle S3 errors gracefully', async () => {
      getObjectFromKeyStub.rejects(new Error('S3 access denied'));

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error reading code change report from S3/),
      );
    });

    it('should not update suggestions without matching criteria', async () => {
      const mockReportData = JSON.stringify({
        diff: 'mock diff content',
      });

      const suggestionData = {
        url: 'https://different.com/test', // Different URL
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).not.to.have.been.called;
      expect(mockSuggestion.save).not.to.have.been.called;
    });

    it('should not update suggestions without diff content', async () => {
      // Return a parsed object (not stringified) without diff property
      // This simulates JSON content from S3 that has been parsed
      const mockReportData = {
        // No diff property
        url: 'https://example.com/contact',
        source: 'form',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).not.to.have.been.called;
    });

    it('should handle suggestion save errors', async () => {
      const mockReportData = {
        diff: 'mock diff content',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      mockSuggestion.save.rejects(new Error('Save failed'));
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error updating suggestions with code change/),
      );
    });

    it('should handle processing errors gracefully', async () => {
      mockDataAccess.Opportunity.findById.rejects(new Error('Database error'));

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Unexpected error.*Database error/),
      );
    });

    it('should process multiple updates with different aggregation keys', async () => {
      const mockReportData1 = JSON.stringify({ diff: 'diff for color-contrast' });
      const mockReportData2 = JSON.stringify({ diff: 'diff for select-name' });

      const suggestionData1 = {
        url: 'https://example.com/page1',
        source: 'form1',
        aggregation_key: 'color-contrast',
      };

      const suggestionData2 = {
        url: 'https://example.com/page1',
        source: 'form1',
        aggregation_key: 'select-name',
      };

      const mockSuggestion2 = {
        getId: sandbox.stub().returns('suggestion-456'),
        getData: sandbox.stub().returns(suggestionData2),
        setData: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockSuggestion.getData.returns(suggestionData1);
      mockOpportunity.getSuggestions.resolves([mockSuggestion, mockSuggestion2]);

      getObjectFromKeyStub.onFirstCall().resolves(mockReportData1);
      getObjectFromKeyStub.onSecondCall().resolves(mockReportData2);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const multiUpdateMessage = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              source: 'form1',
              aggregation_key: 'color-contrast',
            },
            {
              url: 'https://example.com/page1',
              source: 'form1',
              aggregation_key: 'select-name',
            },
          ],
        },
      };

      const result = await handler.default(multiUpdateMessage, context);

      expect(result.status).to.equal(200);
      expect(getObjectFromKeyStub).to.have.been.calledTwice;
    });

    it('should skip updates without URL or aggregation_key', async () => {
      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageWithoutUrl = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              source: 'form',
              aggregation_key: 'color-contrast',
            },
            {
              url: 'https://example.com/test',
              source: 'form',
              // No aggregation_key or type
            },
          ],
        },
      };

      const result = await handler.default(messageWithoutUrl, context);

      expect(result.status).to.equal(200);
      // These warnings are now in the common handler
      expect(context.log.warn).to.have.been.called;
    });

    it('should handle error when S3_MYSTIQUE_BUCKET_NAME not set for old format', async () => {
      context.env.S3_MYSTIQUE_BUCKET_NAME = undefined;

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageOldFormat = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              source: 'form',
              type: ['color-contrast'],
            },
          ],
        },
      };

      const result = await handler.default(messageOldFormat, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Configuration error.*S3 bucket name not configured/),
      );
    });

    it('should work without source parameter', async () => {
      const mockReportData = {
        diff: 'mock diff content',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: '',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageWithoutSource = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              aggregation_key: 'color-contrast',
            },
          ],
        },
      };

      const result = await handler.default(messageWithoutSource, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.called;
    });

    it('should use provided code_fix_path and code_fix_bucket when available', async () => {
      const mockReportData = {
        diff: 'mock diff content from custom path',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageWithCustomPath = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              source: 'form',
              aggregation_key: 'color-contrast',
              code_fix_path: 'custom/path/to/report.json',
              code_fix_bucket: 'custom-bucket',
            },
          ],
        },
      };

      const result = await handler.default(messageWithCustomPath, context);

      expect(result.status).to.equal(200);
      expect(getObjectFromKeyStub).to.have.been.calledWith(
        sinon.match.any,
        'custom-bucket',
        'custom/path/to/report.json',
        sinon.match.any,
      );
      expect(mockSuggestion.setData).to.have.been.called;
    });

    it('should support old format with type array (backwards compatible)', async () => {
      const mockReportData = {
        diff: 'mock diff content',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageOldFormat = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              source: 'form',
              type: ['color-contrast'],
            },
          ],
        },
      };

      const result = await handler.default(messageOldFormat, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.called;
    });

    it('should process multiple types in old format', async () => {
      const mockReportData1 = { diff: 'diff for color-contrast' };
      const mockReportData2 = { diff: 'diff for select-name' };

      const suggestionData1 = {
        url: 'https://example.com/page1',
        source: 'form1',
        issues: [{ type: 'color-contrast' }],
      };

      const suggestionData2 = {
        url: 'https://example.com/page1',
        source: 'form1',
        issues: [{ type: 'select-name' }],
      };

      const mockSuggestion2 = {
        getId: sandbox.stub().returns('suggestion-456'),
        getData: sandbox.stub().returns(suggestionData2),
        setData: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockSuggestion.getData.returns(suggestionData1);
      mockOpportunity.getSuggestions.resolves([mockSuggestion, mockSuggestion2]);

      getObjectFromKeyStub.onFirstCall().resolves(mockReportData1);
      getObjectFromKeyStub.onSecondCall().resolves(mockReportData2);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageOldFormat = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              source: 'form1',
              type: ['color-contrast', 'select-name'],
            },
          ],
        },
      };

      const result = await handler.default(messageOldFormat, context);

      expect(result.status).to.equal(200);
      expect(getObjectFromKeyStub).to.have.been.calledTwice;
      expect(mockSuggestion.setData).to.have.been.called;
      expect(mockSuggestion2.setData).to.have.been.called;
    });

    it('should prefer aggregation_key over type array when both present', async () => {
      const mockReportData = {
        diff: 'mock diff content',
      };

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'color-contrast',
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const messageBothFormats = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              source: 'form',
              aggregation_key: 'color-contrast',
              type: ['should-be-ignored'],
            },
          ],
        },
      };

      const result = await handler.default(messageBothFormats, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.called;
      // Should only be called once for aggregation_key, not for type array
      expect(getObjectFromKeyStub).to.have.been.calledOnce;
    });

    it('should handle plain text diff content from S3 (non-JSON)', async () => {
      // Simulate plain text content from S3 (string instead of object)
      const plainTextDiff = 'diff --git a/file.js b/file.js\nindex 123..456\n--- a/file.js\n+++ b/file.js\n@@ -1,3 +1,3 @@\n-old line\n+new line';

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        aggregation_key: 'button-name',
      };

      mockSuggestion.getData.returns(suggestionData);
      // Return plain string instead of JSON object - this will be wrapped as {diff: string}
      getObjectFromKeyStub.resolves(plainTextDiff);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              source: 'form',
              aggregation_key: 'button-name',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.calledWith({
        ...suggestionData,
        patchContent: plainTextDiff,
        isCodeChangeAvailable: true,
      });
      expect(mockSuggestion.save).to.have.been.called;
    });

    it('should update multiple suggestions with same aggregation_key', async () => {
      const mockReportData = {
        diff: 'mock diff content for aria-prohibited-attr',
      };

      const suggestionData1 = {
        url: 'https://example.com/page1',
        source: 'form1',
        aggregation_key: 'aria-prohibited-attr',
      };

      const suggestionData2 = {
        url: 'https://example.com/page2',
        source: 'form2',
        aggregation_key: 'aria-prohibited-attr',
      };

      const mockSuggestion2 = {
        getId: sandbox.stub().returns('suggestion-456'),
        getData: sandbox.stub().returns(suggestionData2),
        setData: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockSuggestion.getData.returns(suggestionData1);
      mockOpportunity.getSuggestions.resolves([mockSuggestion, mockSuggestion2]);

      getObjectFromKeyStub.onFirstCall().resolves(mockReportData);
      getObjectFromKeyStub.onSecondCall().resolves(mockReportData);

      const handler = await esmock('../../../../src/common/codefix-response-handler.js', {
        '../../../../src/common/codefix-handler.js': await esmock('../../../../src/common/codefix-handler.js', {
          '../../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        }),
      });

      const message = {
        siteId: 'site-123',
        type: 'codefix:accessibility',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/page1',
              source: 'form1',
              aggregation_key: 'aria-prohibited-attr',
            },
            {
              url: 'https://example.com/page2',
              source: 'form2',
              aggregation_key: 'aria-prohibited-attr',
            },
          ],
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      // Both suggestions should be updated
      expect(mockSuggestion.setData).to.have.been.calledWith({
        ...suggestionData1,
        patchContent: 'mock diff content for aria-prohibited-attr',
        isCodeChangeAvailable: true,
      });
      expect(mockSuggestion2.setData).to.have.been.calledWith({
        ...suggestionData2,
        patchContent: 'mock diff content for aria-prohibited-attr',
        isCodeChangeAvailable: true,
      });
      expect(mockSuggestion.save).to.have.been.called;
      expect(mockSuggestion2.save).to.have.been.called;
    });
  });
});