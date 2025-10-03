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
          type: ['color-contrast'],
        },
      ],
    },
  };

  describe('Main Handler Function', () => {
    it('should successfully process updates with matching suggestions', async () => {
      const mockReportData = JSON.stringify({
        url: 'https://example.com/contact',
        source: 'form',
        type: 'color-contrast',
        diff: 'mock diff content',
      });

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
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
      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const message = { siteId: 'site-123', type: 'codefix:accessibility' };
      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        'AccessibilityCodeFixHandler: No data provided in message',
      );
    });

    it('should return badRequest when no opportunityId provided', async () => {
      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const message = {
        siteId: 'site-123',
        data: { updates: [] },
      };
      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(context.log.error).to.have.been.calledWith(
        '[AccessibilityCodeFixHandler] No opportunityId provided',
      );
    });

    it('should return badRequest when no updates provided', async () => {
      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
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

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(404);
      expect(context.log.error).to.have.been.calledWith(
        '[AccessibilityCodeFixHandler] Opportunity not found for ID: opportunity-123',
      );
    });

    it('should return badRequest when site ID mismatch', async () => {
      mockOpportunity.getSiteId.returns('different-site-id');

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(400);
    });

    it('should return ok when no suggestions found', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
    });

    it('should return internalServerError when S3 bucket not configured', async () => {
      context.env.S3_MYSTIQUE_BUCKET_NAME = undefined;

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
    });

    it('should handle missing S3 reports gracefully', async () => {
      getObjectFromKeyStub.resolves(null);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No code change report found for URL/),
      );
    });

    it('should handle S3 errors gracefully', async () => {
      getObjectFromKeyStub.rejects(new Error('S3 access denied'));

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
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
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).not.to.have.been.called;
      expect(mockSuggestion.save).not.to.have.been.called;
    });

    it('should not update suggestions without diff content', async () => {
      const mockReportData = JSON.stringify({
        // No diff property
        url: 'https://example.com/contact',
        source: 'form',
      });

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).not.to.have.been.called;
    });

    it('should handle suggestion save errors', async () => {
      const mockReportData = JSON.stringify({
        diff: 'mock diff content',
      });

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      mockSuggestion.save.rejects(new Error('Save failed'));
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error updating suggestions with code change data/),
      );
    });

    it('should handle processing errors gracefully', async () => {
      mockDataAccess.Opportunity.findById.rejects(new Error('Database error'));

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await handler.default(validMessage, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error processing message: Database error/),
      );
    });

    it('should process multiple updates with multiple types', async () => {
      const mockReportData1 = JSON.stringify({ diff: 'diff for color-contrast' });
      const mockReportData2 = JSON.stringify({ diff: 'diff for select-name' });

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

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const multiUpdateMessage = {
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

      const result = await handler.default(multiUpdateMessage, context);

      expect(result.status).to.equal(200);
      expect(getObjectFromKeyStub).to.have.been.calledTwice;
    });

    it('should skip updates without URL or types', async () => {
      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const messageWithoutUrl = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              source: 'form',
              type: ['color-contrast'],
            },
            {
              url: 'https://example.com/test',
              source: 'form',
              // No type
            },
          ],
        },
      };

      const result = await handler.default(messageWithoutUrl, context);

      expect(result.status).to.equal(200);
      expect(context.log.warn).to.have.been.calledWith(
        '[AccessibilityCodeFixHandler] Skipping update without URL',
      );
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Skipping update for URL.*without types/),
      );
    });

    it('should work without source parameter', async () => {
      const mockReportData = JSON.stringify({
        diff: 'mock diff content',
      });

      const suggestionData = {
        url: 'https://example.com/contact',
        source: 'any-source',
        issues: [{ type: 'color-contrast' }],
      };

      mockSuggestion.getData.returns(suggestionData);
      getObjectFromKeyStub.resolves(mockReportData);

      const handler = await esmock('../../../../src/forms-opportunities/auto-optimization-handlers/codefix-handler.js', {
        '../../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const messageWithoutSource = {
        siteId: 'site-123',
        data: {
          opportunityId: 'opportunity-123',
          updates: [
            {
              url: 'https://example.com/contact',
              type: ['color-contrast'],
            },
          ],
        },
      };

      const result = await handler.default(messageWithoutSource, context);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.called;
    });
  });
});