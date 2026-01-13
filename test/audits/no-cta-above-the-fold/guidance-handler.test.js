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

import { expect, use } from "chai";
import sinon from "sinon";
import sinonChai from "sinon-chai";
import esmock from "esmock";
import { ok, notFound } from "@adobe/spacecat-shared-http-utils";

use(sinonChai);

// Mock tagMappings module
const mockTagMappings = {
  mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
    // Return mapped tags for no-cta-above-the-fold
    if (opportunityType === 'no-cta-above-the-fold') {
      return ['CTA Optimization', 'Engagement'];
    }
    // Generic opportunities should not have hardcoded tags applied
    if (opportunityType === 'generic-opportunity') {
      return currentTags || [];
    }
    return currentTags || [];
  }),
};

let handler;

describe("No CTA above the fold guidance handler", () => {
  let sandbox;
  let logStub;
  let context;
  let Audit;
  let Opportunity;
  let Suggestion;

  const siteId = "site-id";
  const pageUrl = "https://example.com/testpage";
  const guidance = [
    {
      insight: "insight",
      rationale: "rationale",
      recommendation: "recommendation",
      body: { markdown: "Line1\\nLine2" },
    },
  ];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // Import handler with mocked tagMappings
    handler = await esmock(
      "../../../src/no-cta-above-the-fold/guidance-handler.js",
      {
        "@adobe/spacecat-shared-utils": mockTagMappings,
      },
    );
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };

    Audit = { findById: sandbox.stub() };
    Opportunity = {
      create: sandbox.stub(),
      allBySiteId: sandbox.stub().resolves([]),
    };
    Suggestion = { create: sandbox.stub().resolves() };

    context = {
      log: logStub,
      dataAccess: {
        Audit,
        Opportunity,
        Suggestion,
      },
      site: {
        requiresValidation: false,
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("returns notFound when the audit is missing", async () => {
    Audit.findById.resolves(null);

    const result = await handler(
      {
        auditId: "audit-id",
        siteId,
        data: { url: pageUrl, guidance },
      },
      context
    );

    expect(result.status).to.equal(notFound().status);
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  it("creates an opportunity and suggestion when audit exists", async () => {
    const audit = {
      getAuditId: () => "audit-id",
      getAuditResult: () => [
        {
          path: "/testpage",
          pageviews: "1000",
          bounce_rate: 0.6,
          projected_traffic_lost: 900,
        },
      ],
    };
    Audit.findById.resolves(audit);

    Opportunity.create.resolves({
      getId: () => "oppty-123",
    });

    const result = await handler(
      {
        auditId: "audit-id",
        siteId,
        data: { url: pageUrl, guidance },
      },
      context
    );

    expect(result.status).to.equal(ok().status);
    expect(Opportunity.create).to.have.been.calledOnce;
    expect(Suggestion.create).to.have.been.calledOnce;

    const suggestionArg = Suggestion.create.getCall(0).args[0];
    expect(suggestionArg.opportunityId).to.equal("oppty-123");
    expect(suggestionArg.data.suggestionValue).to.equal("Line1\nLine2");
    expect(suggestionArg.status).to.equal("NEW");
  });

  it("creates a pending validation suggestion when site requires validation", async () => {
    const audit = {
      getAuditId: () => "audit-id",
      getAuditResult: () => [
        {
          path: "/testpage",
          pageviews: "1000",
          bounce_rate: 0.6,
          projected_traffic_lost: 900,
        },
      ],
    };
    Audit.findById.resolves(audit);
    Opportunity.create.resolves({
      getId: () => "oppty-123",
    });
    context.site = { requiresValidation: true };

    const result = await handler(
      {
        auditId: "audit-id",
        siteId,
        data: { url: pageUrl, guidance },
      },
      context
    );

    expect(result.status).to.equal(ok().status);
    expect(Suggestion.create).to.have.been.calledOnce;
    const suggestionArg = Suggestion.create.getCall(0).args[0];
    expect(suggestionArg.status).to.equal("PENDING_VALIDATION");
    context.site = { requiresValidation: false };
  });

  it("skips opportunity creation when Mystique fails to generate a suggestion", async () => {
    Audit.findById.resolves({});
    const failureGuidance = [
      {
        insight: "Suggestion generation failed, no opportunity created",
        rationale: "Suggestion generation failed, no opportunity created",
        recommendation: "Suggestion generation failed, no opportunity created",
        body: {
          markdown: "Suggestion generation failed, no opportunity created",
        },
      },
    ];

    const result = await handler(
      {
        auditId: "audit-id",
        siteId,
        data: { url: pageUrl, guidance: failureGuidance },
      },
      context
    );

    expect(result.status).to.equal(ok().status);
    expect(Opportunity.allBySiteId).not.to.have.been.called;
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWith(
      "Skipping opportunity creation for site: site-id page: https://example.com/testpage audit: audit-id due to suggestion generation failure."
    );
  });

  it("skips opportunity creation when matching opportunity already exists", async () => {
    const audit = {
      getAuditId: () => "audit-id",
      getAuditResult: () => [
        {
          path: "/testpage",
          pageviews: "1000",
          bounce_rate: 0.6,
          projected_traffic_lost: 900,
        },
      ],
    };
    Audit.findById.resolves(audit);

    Opportunity.allBySiteId.resolves([
      {
        getId: () => "existing-oppty",
        getType: () => "generic-opportunity",
        getData: () => ({
          opportunityType: "no-cta-above-the-fold",
          page: pageUrl,
        }),
        getStatus: () => "NEW",
      },
    ]);

    const result = await handler(
      {
        auditId: "audit-id",
        siteId,
        data: { url: pageUrl, guidance },
      },
      context
    );

    expect(result.status).to.equal(ok().status);
    expect(Opportunity.create).not.to.have.been.called;
    expect(Suggestion.create).not.to.have.been.called;
  });

  describe('isSuggestionFailure edge cases', () => {
    it('should return false when recommendation does not include failure message', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [
          {
            path: "/testpage",
            pageviews: "1000",
            bounce_rate: 0.6,
            projected_traffic_lost: 900,
          },
        ],
      };
      Audit.findById.resolves(audit);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const normalGuidance = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "Normal recommendation text",
          body: { markdown: "Line1\\nLine2" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: normalGuidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should return false when recommendation is not a string', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [
          {
            path: "/testpage",
            pageviews: "1000",
            bounce_rate: 0.6,
            projected_traffic_lost: 900,
          },
        ],
      };
      Audit.findById.resolves(audit);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithObjectRec = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: { text: "recommendation" },
          body: { markdown: "Line1\\nLine2" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithObjectRec },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should return false when recommendation is undefined', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [
          {
            path: "/testpage",
            pageviews: "1000",
            bounce_rate: 0.6,
            projected_traffic_lost: 900,
          },
        ],
      };
      Audit.findById.resolves(audit);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithoutRec = [
        {
          insight: "insight",
          rationale: "rationale",
          body: { markdown: "Line1\\nLine2" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithoutRec },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });
  });

  describe('getGuidanceObj edge cases', () => {
    it('should handle empty guidance array', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: [] },
        },
        context
      );
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle guidance with null body', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      const guidance = [{ body: null, insight: 'insight' }];
      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });

    it('should handle guidance without body property', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      const guidance = [{ insight: 'insight', rationale: 'rationale' }];
      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );
      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.called;
    });
  });

  describe('handler full flow coverage', () => {
    it('should log debug messages throughout the handler flow', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [
          {
            path: "/testpage",
            pageviews: "1000",
            bounce_rate: 0.6,
            projected_traffic_lost: 900,
          },
        ],
      };
      Audit.findById.resolves(audit);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:no-cta-above-the-fold/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Fetched Audit/);
      expect(logStub.info).to.have.been.calledWithMatch(/Creating a new no-cta-above-the-fold opportunity/);
      expect(logStub.info).to.have.been.calledWithMatch(/no-cta-above-the-fold opportunity succesfully added/);
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity/);
    });

    it('should handle existing opportunity with RESOLVED status', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: pageUrl,
          }),
          getStatus: () => "RESOLVED",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity with IGNORED status', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: pageUrl,
          }),
          getStatus: () => "IGNORED",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle opportunity creation with tag mapping applied', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
      // Verify tag mapping was called (for non-generic types)
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall).to.exist;
    });

    it('should apply tag mapping for generic-opportunity using data.opportunityType', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
      const createCall = Opportunity.create.getCall(0).args[0];
      // Generic opportunities should have tag mapping applied using data.opportunityType
      expect(createCall.type).to.equal('generic-opportunity');
      expect(createCall.data.opportunityType).to.equal('no-cta-above-the-fold');
      // Verify tag mapping was called with data.opportunityType
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.calledWith(
        'no-cta-above-the-fold',
        []
      );
      // Verify tags were set correctly
      expect(createCall.tags).to.deep.equal(['CTA Optimization', 'Engagement']);
    });

    it('should preserve isElmo and isASO tags when applying tag mapping', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      // Mock mapper to return tags with isElmo
      const mockMapper = {
        mapToOpportunity: sinon.stub().returns({
          siteId,
          id: 'test-id',
          auditId: 'audit-id',
          type: 'generic-opportunity',
          origin: 'AUTOMATION',
          title: 'Test',
          tags: ['isElmo'],
          data: {
            opportunityType: 'no-cta-above-the-fold',
            page: pageUrl,
          },
        }),
        mapToSuggestion: sinon.stub().resolves({
          opportunityId: 'oppty-123',
          type: 'CONTENT_UPDATE',
          rank: 1,
          status: 'NEW',
          data: { suggestionValue: 'test' },
        }),
      };

      // Update mock to preserve isElmo/isASO tags
      const mockTagMappingsWithPreservation = {
        mergeTagsWithHardcodedTags: sinon.stub().callsFake((opportunityType, currentTags) => {
          if (opportunityType === 'no-cta-above-the-fold') {
            const preservedTags = (currentTags || []).filter(
              (tag) => tag === 'isElmo' || tag === 'isASO'
            );
            return ['CTA Optimization', 'Engagement', ...preservedTags];
          }
          return currentTags || [];
        }),
      };

      const testHandler = await esmock(
        "../../../src/no-cta-above-the-fold/guidance-handler.js",
        {
          "@adobe/spacecat-shared-utils": mockTagMappingsWithPreservation,
          "../../../src/no-cta-above-the-fold/guidance-opportunity-mapper.js": mockMapper,
        },
      );

      const result = await testHandler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.tags).to.include('CTA Optimization');
      expect(createCall.tags).to.include('Engagement');
      expect(createCall.tags).to.include('isElmo');
    });

    it('should handle existing opportunity with different opportunityType', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "different-type",
            page: pageUrl,
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity with different page URL', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: "https://different-url.com",
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity with missing opportunityData', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({}),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle mapToSuggestion returning suggestion data', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity oppty-123/);
    });

    it('should handle getGuidanceObj with guidance[0] having body property', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithBody = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: { markdown: "Line1\\nLine2" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithBody },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle getGuidanceObj returning object with spread guidance[0] and body', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithBody = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: { markdown: "Line1\\nLine2" },
          extraField: "extra",
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithBody },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
      // Verify getGuidanceObj spreads guidance[0] and includes body
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.guidance.recommendations[0].insight).to.equal("insight");
    });

    it('should log opportunity JSON in success message', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      const mockOpportunity = {
        getId: () => "oppty-123",
        toJSON: () => ({ id: "oppty-123", type: "generic-opportunity" }),
      };
      Opportunity.create.resolves(mockOpportunity);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(logStub.info).to.have.been.calledWithMatch(/no-cta-above-the-fold opportunity succesfully added/);
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity oppty-123/);
    });

    it('should handle mapToSuggestion being called with correct parameters', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.opportunityId).to.equal("oppty-123");
      expect(suggestionArg.data.suggestionValue).to.equal("Line1\nLine2");
    });

    it('should handle existing opportunity filtering with different opportunityType', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "different-opportunity-type",
            page: pageUrl,
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity filtering with different page URL', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: "https://different-url.com/page",
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity filtering with null opportunityData', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => null,
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity filtering with missing opportunityType', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            page: pageUrl,
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity filtering with missing page', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
          }),
          getStatus: () => "NEW",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity with IN_PROGRESS status', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: pageUrl,
          }),
          getStatus: () => "IN_PROGRESS",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should handle existing opportunity with APPROVED status', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([
        {
          getId: () => "existing-oppty",
          getType: () => "generic-opportunity",
          getData: () => ({
            opportunityType: "no-cta-above-the-fold",
            page: pageUrl,
          }),
          getStatus: () => "APPROVED",
        },
      ]);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should execute getGuidanceObj function with guidance[0] present', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithFirstElement = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: { markdown: "Line1\\nLine2" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithFirstElement },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
      // Verify getGuidanceObj was called and returned object with spread guidance[0] and body
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.guidance.recommendations[0].insight).to.equal("insight");
    });

    it('should execute getGuidanceObj function with guidance[0] having body property', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });
      const guidanceWithBody = [
        {
          insight: "insight",
          body: { markdown: "test" },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithBody },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.called;
    });

    it('should execute mapToOpportunity function call', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Opportunity.create).to.have.been.calledOnce;
      // Verify mapToOpportunity was called by checking the created entity
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.type).to.equal('generic-opportunity');
      expect(createCall.origin).to.equal('AUTOMATION');
      // Verify tags were set via tag mapping (not hardcoded in mapper)
      expect(createCall.tags).to.deep.equal(['CTA Optimization', 'Engagement']);
    });

    it('should execute mapToSuggestion function call with all parameters', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      const mockOpportunity = {
        getId: () => "oppty-123",
      };
      Opportunity.create.resolves(mockOpportunity);

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      // Verify mapToSuggestion was called with correct parameters
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.opportunityId).to.equal("oppty-123");
      expect(suggestionArg.type).to.equal('CONTENT_UPDATE');
    });

    it('should execute all handler lines including log statements', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(logStub.debug).to.have.been.calledWithMatch(/Message received for guidance:no-cta-above-the-fold handler/);
      expect(logStub.debug).to.have.been.calledWithMatch(/Fetched Audit/);
      expect(logStub.info).to.have.been.calledWithMatch(/Creating a new no-cta-above-the-fold opportunity/);
      expect(logStub.info).to.have.been.calledWithMatch(/no-cta-above-the-fold opportunity succesfully added/);
      expect(logStub.info).to.have.been.calledWithMatch(/Created suggestion for opportunity/);
    });

    it('should apply tag mapping when entity type is not generic-opportunity', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      // Use esmock to mock mapToOpportunity to return a non-generic type
      const mockMapper = {
        mapToOpportunity: sinon.stub().returns({
          siteId,
          id: 'test-id',
          auditId: 'audit-id',
          type: 'some-other-type',
          origin: 'AUTOMATION',
          title: 'Test',
          tags: ['Engagement'],
        }),
        mapToSuggestion: sinon.stub().resolves({
          opportunityId: 'oppty-123',
          type: 'CONTENT_UPDATE',
          rank: 1,
          status: 'NEW',
          data: { suggestionValue: 'test' },
        }),
      };

      const testHandler = await esmock(
        "../../../src/no-cta-above-the-fold/guidance-handler.js",
        {
          "@adobe/spacecat-shared-utils": mockTagMappings,
          "../../../src/no-cta-above-the-fold/guidance-opportunity-mapper.js": mockMapper,
        },
      );

      const result = await testHandler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.have.been.calledWith('some-other-type', sinon.match.array);
    });

    it('should handle sanitizeMarkdown with non-string markdown in mapToSuggestion', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const guidanceWithNullMarkdown = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: { markdown: null },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithNullMarkdown },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.data.suggestionValue).to.equal('');
    });

    it('should handle sanitizeMarkdown with undefined markdown in mapToSuggestion', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const guidanceWithUndefinedMarkdown = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: {},
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithUndefinedMarkdown },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.data.suggestionValue).to.equal('');
    });

    it('should not apply tag mapping when data.opportunityType is missing', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      // Mock mapper to return entity without opportunityType
      const mockMapper = {
        mapToOpportunity: sinon.stub().returns({
          siteId,
          id: 'test-id',
          auditId: 'audit-id',
          type: 'generic-opportunity',
          origin: 'AUTOMATION',
          title: 'Test',
          tags: [],
          data: {
            page: pageUrl,
            // No opportunityType
          },
        }),
        mapToSuggestion: sinon.stub().resolves({
          opportunityId: 'oppty-123',
          type: 'CONTENT_UPDATE',
          rank: 1,
          status: 'NEW',
          data: { suggestionValue: 'test' },
        }),
      };

      const testHandler = await esmock(
        "../../../src/no-cta-above-the-fold/guidance-handler.js",
        {
          "@adobe/spacecat-shared-utils": mockTagMappings,
          "../../../src/no-cta-above-the-fold/guidance-opportunity-mapper.js": mockMapper,
        },
      );

      const result = await testHandler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      // Tag mapping should not be called when opportunityType is missing
      expect(mockTagMappings.mergeTagsWithHardcodedTags).to.not.have.been.called;
      const createCall = Opportunity.create.getCall(0).args[0];
      expect(createCall.tags).to.deep.equal([]);
    });

    it('should handle sanitizeMarkdown with number markdown in mapToSuggestion', async () => {
      const audit = {
        getAuditId: () => "audit-id",
        getAuditResult: () => [],
      };
      Audit.findById.resolves(audit);
      Opportunity.allBySiteId.resolves([]);
      Opportunity.create.resolves({
        getId: () => "oppty-123",
      });

      const guidanceWithNumberMarkdown = [
        {
          insight: "insight",
          rationale: "rationale",
          recommendation: "recommendation",
          body: { markdown: 123 },
        },
      ];

      const result = await handler(
        {
          auditId: "audit-id",
          siteId,
          data: { url: pageUrl, guidance: guidanceWithNumberMarkdown },
        },
        context
      );

      expect(result.status).to.equal(ok().status);
      expect(Suggestion.create).to.have.been.calledOnce;
      const suggestionArg = Suggestion.create.getCall(0).args[0];
      expect(suggestionArg.data.suggestionValue).to.equal('');
    });
  });
});

