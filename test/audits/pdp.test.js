/*
 * Copyright 2024 Adobe. All rights reserved.
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
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';

import { gscPdpStructuredDataHandler } from '../../src/url-inspect/pdp-handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

const sandbox = sinon.createSandbox();
const message = {
  type: 'gsc-pdp-structured-data',
  url: 'https://www.example.com',
};

describe('URLInspect Audit', () => {
  let context;
  let googleClientStub;
  let urlInspectStub;
  let siteStub;

  let fullUrlInspectionResult;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
        },
      })
      .build(message);

    googleClientStub = {
      urlInspect: sandbox.stub(),
    };

    urlInspectStub = googleClientStub.urlInspect;
    siteStub = {
      getId: () => '123',
      getConfig: () => ({
        getProductDetailPages: () => ['https://example.com/product/1', 'https://example.com/product/2'],
      }),
    };

    fullUrlInspectionResult = {
      inspectionResult: {
        inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=https://www.example.com/',
        indexStatusResult: {
          verdict: 'PASS',
          coverageState: 'Submitted and indexed',
          robotsTxtState: 'ALLOWED',
          indexingState: 'INDEXING_ALLOWED',
          lastCrawlTime: '2024-08-13T22:35:22Z',
          pageFetchState: 'SUCCESSFUL',
          googleCanonical: 'https://www.example.com/foo',
          userCanonical: 'https://www.example.com/foo',
          referringUrls: [
            'https://www.example.com/bar',
          ],
          crawledAs: 'MOBILE',
        },
        mobileUsabilityResult: {
          verdict: 'VERDICT_UNSPECIFIED',
        },
        richResultsResult: {
          verdict: 'PASS',
          detectedItems: [
            {
              richResultType: 'Product snippets',
              items: [
                {
                  name: 'Example Product Name',
                  issues: [
                    {
                      issueMessage: 'Missing field "image"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
            {
              richResultType: 'Merchant listings',
              items: [
                {
                  name: 'Example Product Name',
                  issues: [
                    {
                      issueMessage: 'Missing field "hasMerchantReturnPolicy"',
                      severity: 'WARNING',
                    },
                    {
                      issueMessage: 'Missing field "shippingDetails"',
                      severity: 'ERROR',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully return a filtered result of the url inspection result', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub.resolves(fullUrlInspectionResult);

    const auditData = await gscPdpStructuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult).to.deep.equal(
      [
        {
          inspectionUrl: 'https://example.com/product/1',
          indexStatusResult: {
            verdict: fullUrlInspectionResult.inspectionResult.indexStatusResult.verdict,
            lastCrawlTime: fullUrlInspectionResult.inspectionResult.indexStatusResult.lastCrawlTime,
          },
          richResults: [
            {
              richResultType: fullUrlInspectionResult
                .inspectionResult.richResultsResult.detectedItems[0].richResultType,
              items: [
                {
                  name: fullUrlInspectionResult
                    .inspectionResult.richResultsResult.detectedItems[0].items[0].name,
                  issues: [
                    {
                      issueMessage: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[0].items[0].issues[0].issueMessage,
                      severity: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[0].items[0].issues[0].severity,
                    },
                  ],
                },
              ],
            },
            {
              richResultType: fullUrlInspectionResult
                .inspectionResult.richResultsResult.detectedItems[1].richResultType,
              items: [
                {
                  name: fullUrlInspectionResult
                    .inspectionResult.richResultsResult.detectedItems[1].items[0].name,
                  issues: [
                    {
                      issueMessage: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[1].items[0].issues[1].issueMessage,
                      severity: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[1].items[0].issues[1].severity,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          inspectionUrl: 'https://example.com/product/2',
          indexStatusResult: {
            verdict: fullUrlInspectionResult.inspectionResult.indexStatusResult.verdict,
            lastCrawlTime: fullUrlInspectionResult.inspectionResult.indexStatusResult.lastCrawlTime,
          },
          richResults: [
            {
              richResultType: fullUrlInspectionResult
                .inspectionResult.richResultsResult.detectedItems[0].richResultType,
              items: [
                {
                  name: fullUrlInspectionResult
                    .inspectionResult.richResultsResult.detectedItems[0].items[0].name,
                  issues: [
                    {
                      issueMessage: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[0].items[0].issues[0].issueMessage,
                      severity: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[0].items[0].issues[0].severity,
                    },
                  ],
                },
              ],
            },
            {
              richResultType: fullUrlInspectionResult
                .inspectionResult.richResultsResult.detectedItems[1].richResultType,
              items: [
                {
                  name: fullUrlInspectionResult
                    .inspectionResult.richResultsResult.detectedItems[1].items[0].name,
                  issues: [
                    {
                      issueMessage: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[1].items[0].issues[1].issueMessage,
                      severity: fullUrlInspectionResult
                        .inspectionResult.richResultsResult
                        .detectedItems[1].items[0].issues[1].severity,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    );
  });

  it('returns no rich results when there are no rich results errors', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    delete fullUrlInspectionResult.inspectionResult.richResultsResult;
    urlInspectStub.resolves(fullUrlInspectionResult);

    const auditData = await gscPdpStructuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult[0].richResults).to.equal(undefined);
  });

  it('returns no rich results when there are no errors in rich results', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    fullUrlInspectionResult.inspectionResult
      .richResultsResult.detectedItems[0].items[0].issues = [];
    delete fullUrlInspectionResult.inspectionResult
      .richResultsResult.detectedItems[1].items[0].issues[1];
    urlInspectStub.resolves(fullUrlInspectionResult);

    const auditData = await gscPdpStructuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult[0].richResults).to.deep.equal([]);
    expect(auditData.auditResult[1].richResults).to.deep.equal([]);
  });

  it('throws error if there are no configured PDPs', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    siteStub.getConfig = () => ({
      getProductDetailPages: () => [],
    });
    try {
      await gscPdpStructuredDataHandler('https://www.example.com', context, siteStub);
    } catch (error) {
      expect(error.message).to.equal('No top pages found for site: https://www.example.com');
    }
  });

  it('throws error if site is not configured for google search console', async () => {
    sandbox.stub(GoogleClient, 'createFrom').throws('No secrets found');

    try {
      await gscPdpStructuredDataHandler('https://www.example.com', context, siteStub);
    } catch (error) {
      expect(error.message).to.equal('Failed to create Google client. Site was probably not onboarded to GSC yet. Error: Sinon-provided No secrets found');
    }
  });
});
