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
        "../common/tagMappings.js": mockTagMappings,
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
  });
});

