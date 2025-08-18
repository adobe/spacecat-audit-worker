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

use(sinonChai);

describe('CDN Logs Report Utils', () => {
  let reportUtils;
  let sandbox;

  before(async () => {
    reportUtils = await import('../../../src/cdn-logs-report/utils/report-utils.js');
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('S3 Configuration', () => {
    it('generates correct S3 config from site', () => {
      const mockSite = {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            s3Config: {
              bucketName: 'test-bucket',
              bucketRegion: 'us-east-1',
            },
          }),
        }),
      };

      const config = reportUtils.getS3Config(mockSite);

      expect(config).to.have.property('customerName', 'example');
      expect(config).to.have.property('customerDomain', 'example_com');
      expect(config).to.have.property('databaseName', 'cdn_logs_example_com');
      expect(config).to.have.property('tableName', 'aggregated_logs_example_com');
    });

    it('removes www from both customer name and domain', () => {
      const mockSite = {
        getBaseURL: () => 'https://www.adobe.com',
        getConfig: () => ({
          getCdnLogsConfig: () => ({ bucketName: 'test-bucket' }),
        }),
      };

      const config = reportUtils.getS3Config(mockSite);

      expect(config).to.have.property('customerName', 'adobe');
      expect(config).to.have.property('customerDomain', 'adobe_com');
    });

    it('handles non-www domains correctly', () => {
      const mockSite = {
        getBaseURL: () => 'https://adobe.com',
        getConfig: () => ({
          getCdnLogsConfig: () => ({ bucketName: 'test-bucket' }),
        }),
      };

      const config = reportUtils.getS3Config(mockSite);

      expect(config).to.have.property('customerName', 'adobe');
      expect(config).to.have.property('customerDomain', 'adobe_com');
    });

    it('generates analysis bucket name correctly', () => {
      const bucketName = reportUtils.getAnalysisBucket('example_com');
      expect(bucketName).to.equal('cdn-logs-example-com');
    });
  });

  describe('Date and Period Management', () => {
    it('generates period identifiers correctly', () => {
      const startDate = new Date('2025-01-06');
      const endDate = new Date('2025-01-12');

      const identifier = reportUtils.generatePeriodIdentifier(startDate, endDate);
      expect(identifier).to.equal('w02-2025');
    });

    it('generates reporting periods with week offset', () => {
      const refDate = new Date('2025-01-15');

      const periods = reportUtils.generateReportingPeriods(refDate, -1);

      expect(periods).to.have.property('weeks').that.is.an('array');
      expect(periods.weeks).to.have.length(1);
      expect(periods.weeks[0]).to.have.property('startDate');
      expect(periods.weeks[0]).to.have.property('endDate');
      expect(periods.weeks[0]).to.have.property('weekLabel');
    });

    it('generates non-week format period identifier', () => {
      const startDate = new Date('2025-01-06');
      const endDate = new Date('2025-01-20'); // Spans more than a week

      const identifier = reportUtils.generatePeriodIdentifier(startDate, endDate);
      expect(identifier).to.equal('2025-01-06_to_2025-01-20');
    });
  });

  describe('Validation', () => {
    it('validates country codes correctly', () => {
      expect(reportUtils.validateCountryCode('US')).to.equal('US');
      expect(reportUtils.validateCountryCode('us')).to.equal('US');
      expect(reportUtils.validateCountryCode('ABC')).to.equal('GLOBAL');
      expect(reportUtils.validateCountryCode(null)).to.equal('GLOBAL');
      expect(reportUtils.validateCountryCode('')).to.equal('GLOBAL');
    });

    it('builds site filters correctly', () => {
      expect(reportUtils.buildSiteFilters([])).to.equal('');
      expect(reportUtils.buildSiteFilters([
        { key: 'url', value: ['test'], type: 'include' },
        { key: 'url', value: ['prod'], type: 'include' },
      ])).to.include("REGEXP_LIKE(url, '(?i)(test)')");
    });

    it('builds exclude filters correctly', () => {
      const result = reportUtils.buildSiteFilters([
        { key: 'url', value: ['admin'], type: 'exclude' },
      ]);
      expect(result).to.include("NOT REGEXP_LIKE(url, '(?i)(admin)')");
    });
  });

  describe('SQL Loading and Database Operations', () => {
    it('loads and processes SQL templates', async () => {
      const sql = await reportUtils.loadSql('create-database', { database: 'test_db' });

      expect(sql).to.be.a('string');
      expect(sql).to.include('test_db');
    });

    it('loads SQL without variables', async () => {
      const sql = await reportUtils.loadSql('create-database', {});

      expect(sql).to.be.a('string');
    });

    it('ensures table exists successfully', async () => {
      const mockAthenaClient = {
        execute: sandbox.stub().resolves(),
      };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_db',
        aggregatedLocation: 's3://test-bucket/data/',
      };
      const mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      await reportUtils.ensureTableExists(mockAthenaClient, mockS3Config, mockLog);

      expect(mockAthenaClient.execute).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith('Creating or checking table: test_table');
      expect(mockLog.info).to.have.been.calledWith('Table test_table is ready');
    });

    it('handles table creation errors', async () => {
      const mockAthenaClient = {
        execute: sandbox.stub().rejects(new Error('Table creation failed')),
      };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_db',
        aggregatedLocation: 's3://test-bucket/data/',
      };
      const mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      await expect(
        reportUtils.ensureTableExists(mockAthenaClient, mockS3Config, mockLog),
      ).to.be.rejectedWith('Table creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to ensure table exists: Table creation failed',
      );
    });
  });
});
