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
import esmock from 'esmock';

use(sinonChai);

describe('agentic-urls', () => {
  let sandbox;
  let mockAthenaClient;
  let mockResolveConsolidatedBucketName;
  let mockExtractCustomerDomain;
  let mockGenerateReportingPeriods;
  let mockWeeklyBreakdownQueries;
  let mockWwwUrlResolver;
  let getTopAgenticUrlsFromAthena;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAthenaClient = {
      query: sandbox.stub(),
    };

    mockResolveConsolidatedBucketName = sandbox.stub().returns('test-bucket');
    mockExtractCustomerDomain = sandbox.stub().returns('example_com');
    // Default: resolve to www.example.com (simulating www resolution)
    mockWwwUrlResolver = sandbox.stub().resolves('www.example.com');

    mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [
        {
          weekNumber: 1,
          year: 2025,
          startDate: new Date('2025-01-06'),
          endDate: new Date('2025-01-12'),
        },
      ],
    });

    mockWeeklyBreakdownQueries = {
      createTopUrlsQueryWithLimit: sandbox.stub().resolves('SELECT * FROM test'),
    };

    const module = await esmock('../../src/utils/agentic-urls.js', {
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(mockAthenaClient),
        },
      },
      '../../src/utils/cdn-utils.js': {
        resolveConsolidatedBucketName: mockResolveConsolidatedBucketName,
        extractCustomerDomain: mockExtractCustomerDomain,
      },
      '../../src/cdn-logs-report/utils/report-utils.js': {
        generateReportingPeriods: mockGenerateReportingPeriods,
      },
      '../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: mockWeeklyBreakdownQueries,
      },
      '../../src/common/base-audit.js': {
        wwwUrlResolver: mockWwwUrlResolver,
      },
    });

    getTopAgenticUrlsFromAthena = module.getTopAgenticUrlsFromAthena;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createMockSite = () => ({
    getBaseURL: () => 'https://example.com',
    getId: () => 'site-123',
    getConfig: () => ({
      getLlmoCdnlogsFilter: () => [],
    }),
  });

  const createMockContext = () => ({
    log: {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    },
    env: {
      AWS_ENV: 'prod',
      AWS_REGION: 'us-east-1',
    },
  });

  describe('getTopAgenticUrlsFromAthena', () => {
    it('should return top agentic URLs from Athena successfully', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([
        { url: '/page1' },
        { url: '/page2' },
        { url: '/page3' },
      ]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      // URLs should use the resolved www hostname
      expect(result).to.deep.equal([
        'https://www.example.com/page1',
        'https://www.example.com/page2',
        'https://www.example.com/page3',
      ]);
      expect(context.log.info).to.have.been.calledWith(
        'Agentic URLs - Executing Athena query for top agentic URLs... baseUrl=https://example.com',
      );
      expect(context.log.info).to.have.been.calledWith(
        'Agentic URLs - Using resolved base URL: https://www.example.com (original: https://example.com)',
      );
      expect(context.log.info).to.have.been.calledWith(
        'Agentic URLs - Selected 3 top agentic URLs via Athena. baseUrl=https://example.com',
      );
    });

    it('should return empty array when Athena returns no results', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      expect(result).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWith(
        'Agentic URLs - Athena returned no agentic rows. baseUrl=https://example.com',
      );
    });

    it('should return empty array when Athena returns null', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves(null);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      expect(result).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWith(
        'Agentic URLs - Athena returned no agentic rows. baseUrl=https://example.com',
      );
    });

    it('should return empty array and warn when Athena query fails', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.rejects(new Error('Athena connection failed'));

      const result = await getTopAgenticUrlsFromAthena(site, context);

      expect(result).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWith(
        'Agentic URLs - Athena agentic URL fetch failed: Athena connection failed. baseUrl=https://example.com',
      );
    });

    it('should filter out rows with empty or missing URLs', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([
        { url: '/page1' },
        { url: '' },
        { url: null },
        { url: '/page2' },
        {},
      ]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      // URLs should use the resolved www hostname
      expect(result).to.deep.equal([
        'https://www.example.com/page1',
        'https://www.example.com/page2',
      ]);
    });

    it('should use custom limit parameter', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([
        { url: '/page1' },
      ]);

      await getTopAgenticUrlsFromAthena(site, context, 50);

      expect(mockWeeklyBreakdownQueries.createTopUrlsQueryWithLimit).to.have.been.calledWith(
        sinon.match({
          limit: 50,
        }),
      );
    });

    it('should use default limit of 200 when not specified', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([]);

      await getTopAgenticUrlsFromAthena(site, context);

      expect(mockWeeklyBreakdownQueries.createTopUrlsQueryWithLimit).to.have.been.calledWith(
        sinon.match({
          limit: 200,
        }),
      );
    });

    it('should handle paths that are already full URLs', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([
        { url: '/page1' },
        { url: 'https://example.com/page2' }, // Already full URL
      ]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      // Both should be normalized to full URLs using resolved www hostname
      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.equal('https://www.example.com/page1');
      // Full URLs are handled by URL constructor - base is ignored for absolute URLs
      expect(result[1]).to.equal('https://example.com/page2');
    });

    it('should handle site with no baseURL gracefully', async () => {
      const site = {
        getBaseURL: () => '',
        getId: () => 'site-123',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      };
      const context = createMockContext();

      // When there's no baseURL, wwwUrlResolver returns empty string
      mockWwwUrlResolver.resolves('');

      mockAthenaClient.query.resolves([
        { url: '/page1' },
      ]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      // Should return the path as-is when URL construction fails
      expect(result).to.deep.equal(['/page1']);
    });

    it('should build correct S3 config from site and context', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockAthenaClient.query.resolves([]);

      await getTopAgenticUrlsFromAthena(site, context);

      expect(mockExtractCustomerDomain).to.have.been.calledWith(site);
      expect(mockResolveConsolidatedBucketName).to.have.been.calledWith(context);
    });

    it('should handle www prefix in customer domain', async () => {
      const site = createMockSite();
      const context = createMockContext();

      // Test the www prefix handling - returns www_example_com, which splits to
      //  ['www', 'example', 'com']
      mockExtractCustomerDomain.returns('www_example_com');
      mockAthenaClient.query.resolves([]);

      await getTopAgenticUrlsFromAthena(site, context);

      // The S3 config should use 'example' as customerName (second part when first is 'www')
      expect(mockExtractCustomerDomain).to.have.been.calledWith(site);
    });

    it('should use first week from reporting periods', async () => {
      const site = createMockSite();
      const context = createMockContext();

      mockGenerateReportingPeriods.returns({
        weeks: [
          { weekNumber: 2, year: 2025 },
          { weekNumber: 1, year: 2025 },
        ],
      });

      mockAthenaClient.query.resolves([]);

      await getTopAgenticUrlsFromAthena(site, context);

      expect(mockWeeklyBreakdownQueries.createTopUrlsQueryWithLimit).to.have.been.calledWith(
        sinon.match({
          periods: { weeks: [{ weekNumber: 2, year: 2025 }] },
        }),
      );
    });

    it('should use wwwUrlResolver to construct URLs with proper www prefix', async () => {
      // This test verifies the fix for URLs missing www prefix
      // (e.g., https://example.com instead of https://www.example.com)
      const site = {
        getBaseURL: () => 'https://example.com', // Base URL without www
        getId: () => 'site-123',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [],
        }),
      };
      const context = createMockContext();

      // wwwUrlResolver should resolve to www.example.com
      mockWwwUrlResolver.resolves('www.example.com');

      mockAthenaClient.query.resolves([
        { url: '/products/page1' },
        { url: '/about' },
      ]);

      const result = await getTopAgenticUrlsFromAthena(site, context);

      // URLs should use the resolved www hostname to avoid redirects
      expect(result).to.deep.equal([
        'https://www.example.com/products/page1',
        'https://www.example.com/about',
      ]);
      expect(mockWwwUrlResolver).to.have.been.calledWith(site, context);
      expect(context.log.info).to.have.been.calledWith(
        'Agentic URLs - Using resolved base URL: https://www.example.com (original: https://example.com)',
      );
    });
  });
});
