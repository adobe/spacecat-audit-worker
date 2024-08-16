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
import chai from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { urlInspectRunner } from '../../src/urlInspect/handler.js';

chai.use(sinonChai);
const { expect } = chai;
const sandbox = sinon.createSandbox();

describe('URLInspect Audit', () => {
  let context;
  let dataAccess;
  let googleClientStub;
  let urlInspectStub;
  let siteStub;

  const fullUrlInspectionResult = {
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

  const topPages = [
    { url: 'https://example.com/foo' },
    { url: 'https://example.com/bar' },
  ];

  beforeEach(() => {
    dataAccess = {
      getTopPagesForSite: sinon.stub(),
    };
    context = {
      log: {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      },
      dataAccess,
    };

    googleClientStub = {
      urlInspect: sandbox.stub(),
    };
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    urlInspectStub = googleClientStub.urlInspect;
    siteStub = {
      getId: () => '123',
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully return a filtered result of the url inspection result', async () => {
    dataAccess.getTopPagesForSite.resolves(topPages);

    urlInspectStub.resolves(fullUrlInspectionResult);

    const auditData = await urlInspectRunner('https://www.example.com', context, siteStub);

    expect(auditData.auditResult).to.deep.equal(
      [
        {
          inspectionUrl: 'https://example.com/foo',
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
          inspectionUrl: 'https://example.com/bar',
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
    dataAccess.getTopPagesForSite.resolves(topPages);
    delete fullUrlInspectionResult.inspectionResult.richResultsResult;

    const auditData = await urlInspectRunner('https://www.example.com', context, siteStub);

    expect(auditData.auditResult[0].richResults).to.equal(undefined);
  });

  it('returns an empty array if there are no top pages', async () => {
    dataAccess.getTopPagesForSite.resolves([]);

    const auditData = await urlInspectRunner('https://www.example.com', context, siteStub);

    expect(auditData.auditResult).to.deep.equal([]);
  });
});
