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

import { expect } from "chai";
import { describe } from "mocha";
import {
  mapToOpportunity,
  mapToSuggestion,
} from "../../../src/no-cta-above-the-fold/guidance-opportunity-mapper.js";

describe("No Engageable Content opportunity mapper", () => {
  const siteId = "site-id";
  const pageUrl = "https://example.com/testpage";
  const guidance = {
    insight: "insight",
    rationale: "rationale",
    recommendation: "recommendation",
  };

  describe("mapToOpportunity", () => {
    it("maps audit row metrics to opportunity data", () => {
      const audit = {
        getAuditId: () => "test-audit-id",
        getAuditResult: () => [
          {
            path: "/testpage",
            pageviews: "1500",
            bounce_rate: 0.6,
            projected_traffic_lost: 900,
          },
        ],
      };

      const result = mapToOpportunity(siteId, pageUrl, audit, guidance);

      expect(result.id).to.be.a("string");
      expect(result.data.pageViews).to.equal(1500);
      expect(result.data.bounceRate).to.equal(0.6);
      expect(result.data.projectedTrafficLost).to.equal(900);
      expect(result.data.projectedTrafficValue).to.equal(900 * 0.8);
      expect(result.data.page).to.equal(pageUrl);
    });

    it("falls back to zeroed metrics when URL not found", () => {
      const audit = {
        getAuditId: () => "test-audit-id",
        getAuditResult: () => [
          {
            path: "/non-existent-page",
            pageviews: "500",
            bounce_rate: 0.4,
            projected_traffic_lost: 200,
          },
        ],
      };

      const result = mapToOpportunity(siteId, pageUrl, audit, guidance);

      expect(result.data.pageViews).to.equal(0);
      expect(result.data.bounceRate).to.equal(0);
      expect(result.data.projectedTrafficLost).to.equal(0);
      expect(result.data.projectedTrafficValue).to.equal(0);
    });
  });

  describe("mapToSuggestion", () => {
    it("creates suggestion payload with provided markdown", async () => {
      const recommendation = { body: { markdown: "Test markdown" } };
      const suggestion = await mapToSuggestion("oppty-id", pageUrl, recommendation);

      expect(suggestion.type).to.equal("CONTENT_UPDATE");
      expect(suggestion.status).to.equal("NEW");
      expect(suggestion.data.recommendations[0].pageUrl).to.equal(pageUrl);
      expect(suggestion.data.suggestionValue).to.equal("Test markdown");
    });

    it("returns sanitized suggestion value for markdown with escaped newlines", async () => {
      const recommendation = {
        body: { markdown: "Line1\\nLine2" },
      };

      const suggestion = await mapToSuggestion(
        "oppty-id",
        pageUrl,
        recommendation,
      );

      expect(suggestion.data.suggestionValue).to.equal("Line1\nLine2");
      expect(suggestion.data.recommendations[0].pageUrl).to.equal(pageUrl);
    });

    it("defaults suggestion value to empty string when markdown missing", async () => {
      const suggestion = await mapToSuggestion(
        "oppty-id",
        pageUrl,
        {},
      );

      expect(suggestion.data.suggestionValue).to.equal("");
    });
  });
});

