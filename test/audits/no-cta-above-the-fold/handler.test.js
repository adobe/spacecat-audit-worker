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
import chaiAsPromised from "chai-as-promised";

import { AWSAthenaClient } from "@adobe/spacecat-shared-athena-client";
import {
  runAudit,
  sendResultsToMystique,
} from "../../../src/no-cta-above-the-fold/handler.js";

use(sinonChai);
use(chaiAsPromised);

describe("No CTA above the fold handler", () => {
  let sandbox;
  let athenaStub;
  let sqsStub;
  let logStub;
  let site;
  let context;

  const auditUrl = "example.com";
  const siteId = "test-site-id";
  const baseURL = "https://example.com";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    athenaStub = {
      query: sandbox.stub(),
    };
    sandbox.stub(AWSAthenaClient, "fromContext").returns(athenaStub);

    sqsStub = {
      sendMessage: sandbox.stub().resolves(),
    };

    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };

    site = {
      getId: () => siteId,
      getBaseURL: () => Promise.resolve(baseURL),
      getDeliveryType: () => "aem-edge",
    };

    context = {
      log: logStub,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: "test-queue",
        S3_IMPORTER_BUCKET_NAME: "test-bucket",
        RUM_METRICS_DATABASE: "test_rum_db",
        RUM_METRICS_COMPACT_TABLE: "test_compact_table",
      },
      sqs: sqsStub,
      audit: {
        getId: () => "test-audit-id",
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("passes Ahtna rows to Mystique via the post-processor", async () => {
    const athenaRows = [
      {
        path: "/pricing",
        trf_channel: "search",
        pageviews: "1500",
        bounce_rate: 0.62,
        projected_traffic_lost: 930,
      },
      {
        path: "/signup",
        trf_channel: "social",
        pageviews: "900",
        bounce_rate: 0.7,
        projected_traffic_lost: 630,
      },
    ];
    athenaStub.query.resolves(athenaRows);

    const auditData = await runAudit(auditUrl, context, site);

    expect(athenaStub.query).to.have.been.calledWith(
      sinon.match.string,
      "test_rum_db",
      sinon.match.string
    );
    expect(auditData.auditResult).to.deep.equal(athenaRows);
    expect(auditData.fullAuditRef).to.equal(auditUrl);
    expect(sqsStub.sendMessage).not.to.have.been.called;

    const postProcessorResult = await sendResultsToMystique(auditUrl, auditData, context, site);
    expect(postProcessorResult).to.equal(auditData);
    expect(sqsStub.sendMessage).to.have.been.calledTwice;
    expect(logStub.info).to.have.been.calledWithMatch(
      "[no-cta-above-the-fold] [Site: example.com] Dispatching 2 message(s) to Mystique",
    );
    expect(logStub.info).to.have.been.calledWithMatch(
      "[no-cta-above-the-fold] [Site: example.com] Successfully dispatched 2 message(s) to Mystique",
    );

    const [firstCall, secondCall] = sqsStub.sendMessage.getCalls();
    expect(firstCall.args[1]).to.deep.include({
      type: "guidance:no-cta-above-the-fold",
      siteId,
      url: `${baseURL}/pricing`,
      auditId: "test-audit-id",
    });
    expect(secondCall.args[1]).to.deep.include({
      type: "guidance:no-cta-above-the-fold",
      siteId,
      url: `${baseURL}/signup`,
      auditId: "test-audit-id",
    });
  });

  it("throws when S3 bucket is not configured", async () => {
    delete context.env.S3_IMPORTER_BUCKET_NAME;

    await expect(runAudit(auditUrl, context, site))
      .to.be.rejectedWith("S3_IMPORTER_BUCKET_NAME must be provided for no-cta-above-the-fold audit");
    expect(sqsStub.sendMessage).not.to.have.been.called;
  });

  it("falls back to default database names when env overrides are absent", async () => {
    delete context.env.RUM_METRICS_DATABASE;
    delete context.env.RUM_METRICS_COMPACT_TABLE;

    const rows = [
      {
        path: "/test",
        trf_channel: "display",
        pageviews: "800",
        bounce_rate: 0.5,
        projected_traffic_lost: 400,
      },
    ];
    athenaStub.query.resolves(rows);

    await runAudit(auditUrl, context, site);

    expect(athenaStub.query).to.have.been.calledWith(
      sinon.match.string,
      "rum_metrics",
      sinon.match.string
    );
  });

  it("logs and skips sending Mystique messages when there are no results", async () => {
    const auditData = {
      auditResult: [],
    };

    const result = await sendResultsToMystique(auditUrl, auditData, context, site);

    expect(result).to.equal(auditData);
    expect(sqsStub.sendMessage).not.to.have.been.called;
    expect(logStub.info).to.have.been.calledWithMatch(
      "[no-cta-above-the-fold] [Site: example.com] No messages to dispatch to Mystique"
    );
  });
});

