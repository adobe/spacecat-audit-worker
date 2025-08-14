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
/* eslint-disable max-len */

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

describe('LLM Error Pages Handler', () => {
  let handler;
  let mockAthenaClient;
  let mockGenerateOpportunities;
  let mockS3Config;
  let mockSite;
  let mockContext;
  let sandbox;
  let mockGetS3Config;
  let mockValidateDatabase;
  let mockGenerateReportingPeriods;
  let mockCreateDateRange;
  let mockBuildSiteFilters;
  let mockProcessResults;
  let mockBuildQuery;
  let mockGetAllLlmProviders;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock AthenaClient
    mockAthenaClient = {
      query: sandbox.stub(),
    };

    // Mock generateOpportunities
    mockGenerateOpportunities = sandbox.stub().resolves();

    // Mock S3 config
    mockS3Config = {
      bucket: 'test-bucket',
      customerName: 'test-customer',
      customerDomain: 'test-domain',
      databaseName: 'test_database',
      tableName: 'test_table',
      getAthenaTempLocation: () => 's3://test-bucket/temp/',
    };

    // Mock site
    mockSite = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({
        getCdnLogsConfig: () => ({
          bucketName: 'test-bucket',
          filters: [],
        }),
      }),
    };

    // Mock context
    mockContext = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      message: {},
    };

    // Create individual mocks for better control
    mockGetS3Config = sandbox.stub().returns(mockS3Config);
    mockValidateDatabase = sandbox.stub().resolves();
    mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [{
        weekNumber: 1,
        year: 2025,
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-07T23:59:59Z'),
      }],
    });
    mockCreateDateRange = sandbox.stub().returns({
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2025-01-07T23:59:59Z'),
    });
    mockBuildSiteFilters = sandbox.stub().returns('');
    mockProcessResults = sandbox.stub().returns({
      totalErrors: 5,
      errorPages: [
        { url: 'https://example.com/page1', status: 404, total_requests: 3 },
        { url: 'https://example.com/page2', status: 500, total_requests: 2 },
      ],
      summary: {
        uniqueUrls: 2,
        uniqueUserAgents: 2,
        statusCodes: { 404: 3, 500: 2 },
      },
    });
    mockBuildQuery = sandbox.stub().resolves('SELECT * FROM test_database.test_table WHERE conditions');
    mockGetAllLlmProviders = sandbox.stub().returns(['chatgpt', 'claude']);

    // Mock all dependencies
    handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(mockAthenaClient),
        },
      },
      '../../../src/llm-error-pages/utils/report-utils.js': {
        getS3Config: mockGetS3Config,
        validateDatabaseAndTable: mockValidateDatabase,
        generateReportingPeriods: mockGenerateReportingPeriods,
        createDateRange: mockCreateDateRange,
        buildSiteFilters: mockBuildSiteFilters,
        processLlmErrorPagesResults: mockProcessResults,
      },
      '../../../src/llm-error-pages/utils/query-builder.js': {
        buildLlmErrorPagesQuery: mockBuildQuery,
      },
      '../../../src/llm-error-pages/constants/user-agent-patterns.js': {
        getAllLlmProviders: mockGetAllLlmProviders,
      },
      '../../../src/llm-error-pages/opportunity-handler.js': {
        generateOpportunities: mockGenerateOpportunities,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runLlmErrorPagesAudit', () => {
    it('should successfully run audit with default weekly period', async () => {
      mockAthenaClient.query.resolves([
        { url: 'https://example.com/page1', status: 404, total_requests: 3 },
        { url: 'https://example.com/page2', status: 500, total_requests: 2 },
      ]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.totalErrors).to.equal(5);
      expect(result.auditResult.periodIdentifier).to.equal('w1-2025');
      expect(result.fullAuditRef).to.equal('https://example.com');
      expect(mockGenerateOpportunities.calledOnce).to.be.true;
      expect(mockContext.log.info.calledWith('Starting LLM error pages audit for https://example.com')).to.be.true;
      expect(mockContext.log.info.calledWith('Running weekly audit for w1-2025')).to.be.true;
      expect(mockContext.log.info.calledWith('Executing LLM error pages query...')).to.be.true;
      expect(mockContext.log.info.calledWith('Found 5 total errors across 2 unique URLs')).to.be.true;
    });

    it('should successfully run audit with custom date range', async () => {
      mockContext.message = {
        type: 'runCustomDateRange',
        startDate: '2025-01-01',
        endDate: '2025-01-07',
      };

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.periodIdentifier).to.equal('2025-01-01_to_2025-01-07');
      expect(mockContext.log.info.calledWith('Running custom date range audit: 2025-01-01 to 2025-01-07')).to.be.true;
      expect(mockCreateDateRange.calledWith('2025-01-01', '2025-01-07')).to.be.true;
    });

    it('should throw error for custom date range without startDate', async () => {
      mockContext.message = {
        type: 'runCustomDateRange',
        endDate: '2025-01-07',
      };

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Custom date range requires startDate and endDate');
      expect(mockContext.log.error.calledWith('LLM error pages audit failed: Custom date range requires startDate and endDate in message')).to.be.true;
    });

    it('should throw error for custom date range without endDate', async () => {
      mockContext.message = {
        type: 'runCustomDateRange',
        startDate: '2025-01-01',
      };

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Custom date range requires startDate and endDate');
    });

    it('should handle database validation failure', async () => {
      const mockError = new Error('Database not found');
      handler = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: {
            fromContext: sandbox.stub().returns(mockAthenaClient),
          },
        },
        '../../../src/llm-error-pages/utils/report-utils.js': {
          getS3Config: sandbox.stub().returns(mockS3Config),
          validateDatabaseAndTable: sandbox.stub().rejects(mockError),
          generateReportingPeriods: sandbox.stub().returns({
            weeks: [{
              weekNumber: 1, year: 2025, startDate: new Date(), endDate: new Date(),
            }],
          }),
          buildSiteFilters: sandbox.stub().returns(''),
          processLlmErrorPagesResults: sandbox.stub().returns({ totalErrors: 0, errorPages: [], summary: {} }),
        },
        '../../../src/llm-error-pages/utils/query-builder.js': {
          buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT * FROM test'),
        },
        '../../../src/llm-error-pages/constants/user-agent-patterns.js': {
          getAllLlmProviders: sandbox.stub().returns(['chatgpt']),
        },
        '../../../src/llm-error-pages/opportunity-handler.js': {
          generateOpportunities: mockGenerateOpportunities,
        },
      });

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Database not found');
      expect(mockContext.log.error.calledWith('LLM error pages audit failed: Database not found')).to.be.true;
    });

    it('should handle query execution failure', async () => {
      const mockError = new Error('Query failed');
      mockAthenaClient.query.rejects(mockError);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Query failed');
    });

    it('should handle site with filters', async () => {
      mockSite.getConfig = () => ({
        getCdnLogsConfig: () => ({
          bucketName: 'test-bucket',
          filters: [
            { key: 'url', value: ['/api/'], type: 'exclude' },
          ],
        }),
      });

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
    });

    it('should handle site without CDN logs config', async () => {
      mockSite.getConfig = () => ({});

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
    });

    it('should include all required fields in successful audit result', async () => {
      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult).to.have.all.keys([
        'success',
        'timestamp',
        'periodIdentifier',
        'dateRange',
        'database',
        'table',
        'customer',
        'totalErrors',
        'summary',
        'errorPages',
      ]);
      expect(result.auditResult.dateRange).to.have.all.keys(['startDate', 'endDate']);
    });

    it('should include all required fields in failed audit result', async () => {
      const mockError = new Error('Test error');
      mockAthenaClient.query.rejects(mockError);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult).to.have.all.keys([
        'success',
        'timestamp',
        'error',
        'database',
        'table',
        'customer',
      ]);
    });

    it('should handle site with filters configuration', async () => {
      mockSite.getConfig = () => ({
        getCdnLogsConfig: () => ({
          bucketName: 'test-bucket',
          filters: [
            { key: 'url', value: ['/api/', '/admin/'], type: 'exclude' },
          ],
        }),
      });

      mockBuildSiteFilters.returns('(NOT REGEXP_LIKE(url, "(?i)(/api/|/admin/)"))');
      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(mockBuildSiteFilters.calledWith([
        { key: 'url', value: ['/api/', '/admin/'], type: 'exclude' },
      ])).to.be.true;
    });

    it('should handle site with null CDN logs config', async () => {
      mockSite.getConfig = () => ({
        getCdnLogsConfig: () => null,
      });

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(mockBuildSiteFilters.calledWith(undefined)).to.be.true;
    });

    it('should handle site with no getConfig method', async () => {
      mockSite.getConfig = () => ({});

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
    });

    it('should properly construct audit result with all fields', async () => {
      mockAthenaClient.query.resolves([
        { url: 'https://example.com/test', status: 404, total_requests: 1 },
      ]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult).to.deep.include({
        success: true,
        periodIdentifier: 'w1-2025',
        database: 'test_database',
        table: 'test_table',
        customer: 'test-customer',
        totalErrors: 5,
      });
      expect(result.auditResult.dateRange).to.deep.equal({
        startDate: new Date('2025-01-01T00:00:00Z').toISOString(),
        endDate: new Date('2025-01-07T23:59:59Z').toISOString(),
      });
      expect(result.auditResult.summary).to.deep.equal({
        uniqueUrls: 2,
        uniqueUserAgents: 2,
        statusCodes: { 404: 3, 500: 2 },
      });
      expect(result.auditResult.errorPages).to.have.length(2);
      expect(result.auditResult.timestamp).to.be.a('string');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should call all dependencies with correct parameters', async () => {
      mockAthenaClient.query.resolves([]);

      await handler.runner('https://example.com', mockContext, mockSite);

      expect(mockGetS3Config.calledWith(mockSite)).to.be.true;
      expect(mockValidateDatabase.calledWith(mockAthenaClient, mockS3Config, mockContext.log)).to.be.true;
      expect(mockGenerateReportingPeriods.calledOnce).to.be.true;
      expect(mockGetAllLlmProviders.calledOnce).to.be.true;
      expect(mockBuildQuery.calledWith({
        databaseName: 'test_database',
        tableName: 'test_table',
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-07T23:59:59Z'),
        llmProviders: ['chatgpt', 'claude'],
        siteFilters: '',
      })).to.be.true;
      expect(mockAthenaClient.query.calledWith(
        'SELECT * FROM test_database.test_table WHERE conditions',
        'test_database',
        '[Athena Query] LLM error pages analysis',
      )).to.be.true;
      expect(mockProcessResults.calledOnce).to.be.true;
      expect(mockGenerateOpportunities.calledWith(
        mockProcessResults.returnValues[0],
        mockContext.message,
        mockContext,
      )).to.be.true;
    });

    it('should handle site configuration with getCdnLogsConfig', async () => {
      const siteWithConfig = {
        ...mockSite,
        getConfig: sandbox.stub().returns({
          getCdnLogsConfig: () => ({
            filters: ['test-filter'],
          }),
        }),
      };

      mockAthenaClient.query.resolves([]);

      await handler.runner('https://example.com', mockContext, siteWithConfig);

      expect(mockBuildSiteFilters.calledWith(['test-filter'])).to.be.true;
    });

    it('should handle site configuration without getCdnLogsConfig', async () => {
      const siteWithoutCdnConfig = {
        ...mockSite,
        getConfig: sandbox.stub().returns({}),
      };

      mockAthenaClient.query.resolves([]);

      await handler.runner('https://example.com', mockContext, siteWithoutCdnConfig);

      expect(mockBuildSiteFilters.calledWith(undefined)).to.be.true;
    });

    it('should handle site without config', async () => {
      const siteWithoutConfig = {
        ...mockSite,
        getConfig: sandbox.stub().returns(null),
      };

      mockAthenaClient.query.resolves([]);

      await handler.runner('https://example.com', mockContext, siteWithoutConfig);

      expect(mockBuildSiteFilters.calledWith(undefined)).to.be.true;
    });

    it('should handle context without message', async () => {
      const contextWithoutMessage = { log: mockContext.log };

      mockAthenaClient.query.resolves([]);

      const result = await handler.runner('https://example.com', contextWithoutMessage, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(mockGenerateOpportunities.calledWith(
        mockProcessResults.returnValues[0],
        {},
        contextWithoutMessage,
      )).to.be.true;
    });

    it('should construct complete audit result with all required fields', async () => {
      mockAthenaClient.query.resolves([
        { url: 'https://example.com/test', status: 404, total_requests: 1 },
      ]);

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult).to.have.all.keys([
        'success',
        'timestamp',
        'periodIdentifier',
        'dateRange',
        'database',
        'table',
        'customer',
        'totalErrors',
        'summary',
        'errorPages',
      ]);

      expect(result.auditResult.dateRange).to.have.keys(['startDate', 'endDate']);
      expect(result.auditResult.database).to.equal('test_database');
      expect(result.auditResult.table).to.equal('test_table');
      expect(result.auditResult.customer).to.equal('test-customer');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should construct error audit result on failure', async () => {
      mockAthenaClient.query.rejects(new Error('Test failure'));

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult).to.have.all.keys([
        'success',
        'timestamp',
        'error',
        'database',
        'table',
        'customer',
      ]);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Test failure');
      expect(result.auditResult.database).to.equal('test_database');
      expect(result.auditResult.table).to.equal('test_table');
      expect(result.auditResult.customer).to.equal('test-customer');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should handle empty results from Athena', async () => {
      mockAthenaClient.query.resolves([]);
      mockProcessResults.returns({
        totalErrors: 0,
        errorPages: [],
        summary: { uniqueUrls: 0, uniqueUserAgents: 0, statusCodes: {} },
      });

      const result = await handler.runner('https://example.com', mockContext, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.totalErrors).to.equal(0);
      expect(result.auditResult.errorPages).to.deep.equal([]);
      expect(mockContext.log.info.calledWith('Found 0 total errors across 0 unique URLs')).to.be.true;
    });
  });

  describe('audit builder configuration', () => {
    it('should have correct audit builder configuration', () => {
      expect(handler).to.have.property('runner');
      expect(handler).to.have.property('urlResolver');
      expect(typeof handler.runner).to.equal('function');
      expect(typeof handler.urlResolver).to.equal('function');
    });
  });
});
