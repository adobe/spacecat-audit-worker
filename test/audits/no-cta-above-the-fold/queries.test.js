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
import { getNoCTAAboveTheFoldAnalysisQuery } from "../../../src/no-cta-above-the-fold/queries.js";

describe("No Engageable Content query template", () => {
  const defaultParams = {
    siteId: "test-site-id",
    tableName: "rum_metrics.compact_metrics",
    temporalCondition: "(year = 2025 AND week = 10)",
    pageViewThreshold: 1000,
  };

  it("produces an SQL string with required structure", () => {
    const query = getNoCTAAboveTheFoldAnalysisQuery(defaultParams);

    expect(query).to.be.a("string");
    expect(query.length).to.be.greaterThan(100);
    expect(query.trim()).to.equal(query);
  });

  it("should use provided parameters", () => {
    const params = {
      ...defaultParams,
      siteId: "test-site-id",
      pageViewThreshold: 5000,
      temporalCondition: "(year = 2024 AND month = 8)",
    };

    const query = getNoCTAAboveTheFoldAnalysisQuery(params);

    expect(query).to.include("test-site-id");
    expect(query).to.include("5000");
    expect(query).to.include("(year = 2024 AND month = 8)");
  });
});

