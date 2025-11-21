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
import handler from "../../../src/no-cta-above-the-fold/guidance-handler.js";
import { ok, notFound } from "@adobe/spacecat-shared-http-utils";

use(sinonChai);

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

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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
});

