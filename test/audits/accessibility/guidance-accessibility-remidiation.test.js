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
import sinon from 'sinon';
import esmock from 'esmock';
import { ok } from '@adobe/spacecat-shared-http-utils';

describe('guidance-accessibility-remediation handler', () => {
  let handler;
  let mockHandleAccessibilityRemediationGuidance;
  let sandbox;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockHandleAccessibilityRemediationGuidance = sandbox.stub();

    handler = await esmock(
      '../../../src/accessibility/guidance-handlers/guidance-accessibility-remediation.js',
      {
        '../../../src/accessibility/utils/generate-individual-opportunities.js': {
          handleAccessibilityRemediationGuidance: mockHandleAccessibilityRemediationGuidance,
        },
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully process accessibility remediation guidance', async () => {
    const mockMessage = {
      type: 'guidance:accessibility-remediation',
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            issue_id: 'issue-123',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_to: '<div>Content</div>',
            user_impact: 'Improves screen reader accessibility',
          },
        ],
        totalIssues: 1,
      },
    };

    const mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Mock successful remediation processing
    mockHandleAccessibilityRemediationGuidance.resolves({
      success: true,
      totalIssues: 1,
      pageUrl: 'https://example.com/page1',
    });

    const result = await handler.default(mockMessage, mockContext);

    expect(result.status).to.equal(ok().status);

    const expectedLogMessage = `Message received in accessibility remediation guidance handler: ${JSON.stringify(
      mockMessage,
      null,
      2,
    )}`;
    expect(mockContext.log.info).to.have.been.calledWith(expectedLogMessage);
    expect(mockContext.log.info).to.have.been.calledWith(
      'Successfully processed accessibility remediation guidance',
    );
    expect(mockHandleAccessibilityRemediationGuidance).to.have.been.calledWith(
      mockMessage,
      mockContext,
    );
  });

  it('should handle processing failure and return ok', async () => {
    const mockMessage = {
      type: 'guidance:accessibility-remediation',
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-nonexistent',
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Mock failed remediation processing
    mockHandleAccessibilityRemediationGuidance.resolves({
      success: false,
      error: 'Opportunity not found',
    });

    const result = await handler.default(mockMessage, mockContext);

    expect(result.status).to.equal(ok().status);
    const expectedLogMessage = `Message received in accessibility remediation guidance handler: ${JSON.stringify(
      mockMessage,
      null,
      2,
    )}`;
    expect(mockContext.log.info).to.have.been.calledWith(expectedLogMessage);
    // eslint-disable-next-line max-len
    expect(mockContext.log.error).to.have.been.calledWith(
      '[A11yIndividual][A11yProcessingError] Failed to process guidance: Opportunity not found',
    );
    expect(mockHandleAccessibilityRemediationGuidance).to.have.been.calledWith(
      mockMessage,
      mockContext,
    );
  });

  it('should handle unexpected errors and return ok', async () => {
    const mockMessage = {
      type: 'guidance:accessibility-remediation',
      auditId: 'audit-123',
      siteId: 'site-456',
      data: {
        opportunityId: 'oppty-123',
        suggestionId: 'sugg-789',
        pageUrl: 'https://example.com/page1',
        remediations: [],
        totalIssues: 0,
      },
    };

    const mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Mock unexpected error from remediation processing
    mockHandleAccessibilityRemediationGuidance.rejects(
      new Error('Database connection failed'),
    );

    const result = await handler.default(mockMessage, mockContext);

    expect(result.status).to.equal(ok().status);
    const expectedLogMessage = `Message received in accessibility remediation guidance handler: ${JSON.stringify(
      mockMessage,
      null,
      2,
    )}`;
    expect(mockContext.log.info).to.have.been.calledWith(expectedLogMessage);
    expect(mockContext.log.error).to.have.been.calledWith(
      '[A11yIndividual][A11yProcessingError] Error processing accessibility remediation guidance: Database connection failed',
    );
    expect(mockHandleAccessibilityRemediationGuidance).to.have.been.calledWith(
      mockMessage,
      mockContext,
    );
  });

  it('should handle message with complex remediation data', async () => {
    const mockMessage = {
      type: 'guidance:accessibility-remediation',
      auditId: 'audit-complex-123',
      siteId: 'site-complex-456',
      data: {
        opportunityId: 'oppty-complex-123',
        suggestionId: 'sugg-complex-789',
        pageUrl: 'https://example.com/complex-page',
        remediations: [
          {
            issue_name: 'aria-allowed-attr',
            issue_id: 'issue-1',
            general_suggestion: 'Remove disallowed ARIA attributes',
            update_from: '<div aria-label="test">Content 1</div>',
            update_to: '<div>Content 1</div>',
            user_impact: 'Improves screen reader accessibility',
          },
          {
            issue_name: 'color-contrast',
            issue_id: 'issue-2',
            general_suggestion: 'Improve color contrast ratio',
            update_from: '<span style="color: #666;">Text</span>',
            update_to: '<span style="color: #000;">Text</span>',
            user_impact: 'Better readability for users with visual impairments',
          },
        ],
        totalIssues: 2,
      },
    };

    const mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Mock successful processing of complex data
    mockHandleAccessibilityRemediationGuidance.resolves({
      success: true,
      totalIssues: 2,
      pageUrl: 'https://example.com/complex-page',
    });

    const result = await handler.default(mockMessage, mockContext);

    expect(result.status).to.equal(ok().status);

    const expectedLogMessage = `Message received in accessibility remediation guidance handler: ${JSON.stringify(
      mockMessage,
      null,
      2,
    )}`;
    expect(mockContext.log.info).to.have.been.calledWith(expectedLogMessage);
    expect(mockContext.log.info).to.have.been.calledWith(
      'Successfully processed accessibility remediation guidance',
    );
    expect(mockHandleAccessibilityRemediationGuidance).to.have.been.calledWith(
      mockMessage,
      mockContext,
    );
  });

  it('should handle empty message data', async () => {
    const mockMessage = {
      type: 'guidance:accessibility-remediation',
      auditId: 'audit-empty-123',
      siteId: 'site-empty-456',
      data: {
        opportunityId: 'oppty-empty-123',
        suggestionId: 'sugg-empty-789',
        pageUrl: 'https://example.com/empty-page',
        remediations: [],
        totalIssues: 0,
      },
    };

    const mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
    };

    // Mock successful processing of empty data
    mockHandleAccessibilityRemediationGuidance.resolves({
      success: true,
      totalIssues: 0,
      pageUrl: 'https://example.com/empty-page',
    });

    const result = await handler.default(mockMessage, mockContext);

    expect(result.status).to.equal(ok().status);
    const expectedLogMessage = `Message received in accessibility remediation guidance handler: ${JSON.stringify(
      mockMessage,
      null,
      2,
    )}`;
    expect(mockContext.log.info).to.have.been.calledWith(expectedLogMessage);
    expect(mockContext.log.info).to.have.been.calledWith(
      'Successfully processed accessibility remediation guidance',
    );
    expect(mockHandleAccessibilityRemediationGuidance).to.have.been.calledWith(
      mockMessage,
      mockContext,
    );
  });
});
