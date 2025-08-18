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
import esmock from 'esmock';
import sinonChai from 'sinon-chai';
import {
  getRemainingUrls,
  extractUrlsFromSettledResults,
  filterAccessibilityOpportunities,
  updateStatusToIgnored,
  calculateA11yMetrics,
  calculateAuditMetrics,
} from '../../../src/accessibility/utils/scrape-utils.js';

use(sinonChai);

describe('Scrape Utils', () => {
  describe('getRemainingUrls', () => {
    it('returns all URLs when there are no existing URLs', () => {
      const urlsToScrape = [{ url: 'https://a.com' }, { url: 'https://b.com' }];
      const existingUrls = [];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(urlsToScrape);
    });

    it('returns an empty array when all URLs already exist', () => {
      const urlsToScrape = [{ url: 'https://a.com/' }, { url: 'https://b.com' }];
      const existingUrls = ['https://a.com/', 'https://b.com'];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal([]);
    });

    it('filters out URLs that exist', () => {
      const urlsToScrape = [
        { url: 'https://a.com' }, // exists
        { url: 'https://b.com/' }, // exists
        { url: 'https://c.com' }, // does not exist
      ];
      const existingUrls = ['https://a.com', 'https://b.com/'];
      const expected = [{ url: 'https://c.com' }];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(expected);
    });

    it('returns an empty array if urlsToScrape is empty', () => {
      const urlsToScrape = [];
      const existingUrls = ['https://a.com/'];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal([]);
    });

    it('does not filter if trailing slashes do not match', () => {
      const urlsToScrape = [
        { url: 'https://a.com' },
        { url: 'https://b.com/' },
        { url: 'https://c.com' },
      ];
      const existingUrls = ['https://a.com/'];
      const expected = [
        { url: 'https://a.com' },
        { url: 'https://b.com/' },
        { url: 'https://c.com' },
      ];
      expect(getRemainingUrls(urlsToScrape, existingUrls)).to.deep.equal(expected);
    });
  });

  describe('extractUrlsFromSettledResults', () => {
    it('extracts URLs from fulfilled promises', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'fulfilled', value: { data: { url: 'https://b.com/' } } },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/', 'https://b.com/']);
    });

    it('returns an empty array if all promises are rejected', () => {
      const settledResults = [
        { status: 'rejected', reason: 'Error 1' },
        { status: 'rejected', reason: 'Error 2' },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal([]);
    });

    it('filters out rejected promises and extracts from fulfilled ones', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'rejected', reason: 'Error' },
        { status: 'fulfilled', value: { data: { url: 'https://c.com/' } } },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/', 'https://c.com/']);
    });

    it('handles fulfilled promises without a url property gracefully', () => {
      const settledResults = [
        { status: 'fulfilled', value: { data: { url: 'https://a.com/' } } },
        { status: 'fulfilled', value: { data: {} } },
        { status: 'fulfilled', value: {} },
        { status: 'fulfilled', value: null },
      ];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal(['https://a.com/']);
    });

    it('returns an empty array when given an empty array', () => {
      const settledResults = [];
      const result = extractUrlsFromSettledResults(settledResults);
      expect(result).to.deep.equal([]);
    });
  });

  describe('getExistingUrlsFromFailedAudits', () => {
    let mockS3Client;
    let mockLog;
    let sandbox;
    let getObjectFromKeyStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockS3Client = { send: sandbox.stub() };
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      getObjectFromKeyStub = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
    });

    async function getModuleWithMocks() {
      return esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });
    }

    it('fetches objects and extracts their URLs', async () => {
      const existingObjectKeys = ['key1', 'key2'];
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key1', mockLog)
        .resolves({ url: 'https://a.com/' });
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key2', mockLog)
        .resolves({ url: 'https://b.com/' });

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal(['https://a.com/', 'https://b.com/']);
      expect(getObjectFromKeyStub).to.have.been.calledTwice;
    });

    it('handles a mix of successful and failed object fetches', async () => {
      const existingObjectKeys = ['key1', 'key2', 'key3'];
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key1', mockLog)
        .resolves({ url: 'https://a.com/' });
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key2', mockLog)
        .rejects(new Error('S3 fetch error'));
      getObjectFromKeyStub
        .withArgs(mockS3Client, 'test-bucket', 'key3', mockLog)
        .resolves({ url: 'https://c.com/' });

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal(['https://a.com/', 'https://c.com/']);
      expect(getObjectFromKeyStub).to.have.been.calledThrice;
    });

    it('returns an empty array if all object fetches fail', async () => {
      const existingObjectKeys = ['key1', 'key2'];
      getObjectFromKeyStub.rejects(new Error('S3 fetch error'));

      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal([]);
    });

    it('returns an empty array for no object keys', async () => {
      const existingObjectKeys = [];
      const { getExistingUrlsFromFailedAudits: getExistingUrls } = await getModuleWithMocks();

      const urls = await getExistingUrls(
        mockS3Client,
        'test-bucket',
        mockLog,
        existingObjectKeys,
      );

      expect(urls).to.deep.equal([]);
      expect(getObjectFromKeyStub).to.not.have.been.called;
    });
  });

  describe('getExistingObjectKeysFromFailedAudits', () => {
    let mockS3Client;
    let mockLog;
    let sandbox;
    let clock;
    let getObjectKeysFromSubfoldersStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockS3Client = { send: sandbox.stub() };
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
      // Set a fixed date for deterministic tests
      clock = sinon.useFakeTimers(new Date('2024-07-24T10:00:00.000Z'));
      getObjectKeysFromSubfoldersStub = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
      clock.restore();
    });

    async function getModule(stubs) {
      return esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/accessibility/utils/data-processing.js': stubs,
      });
    }

    it('fetches and returns object keys when failed audits exist', async () => {
      const objectKeys = [
        'audits/www_site1_com_page1.json',
        'audits/www_site1_com_page2.json',
        'audits/malformed_key.json',
      ];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });

      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal(objectKeys);
      expect(getObjectKeysFromSubfoldersStub).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site1',
        '2024-07-24',
        mockLog,
      );
      expect(mockLog.info).to.have.been.calledWith(`[A11yAudit] Found ${objectKeys.length} existing URLs from failed audits for site site1.`);
    });

    it('returns an empty array when no failed audits are found', async () => {
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys: [] });
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal([]);
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] No existing URLs from failed audits found for site site1.');
    });

    it('returns an empty array and logs error when getObjectKeysFromSubfolders fails', async () => {
      const error = new Error('S3 Error');
      getObjectKeysFromSubfoldersStub.rejects(error);
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal([]);
      expect(mockLog.error).to.have.been.calledWith(`[A11yAudit] Error getting existing URLs from failed audits for site site1: ${error.message}`);
    });

    it('returns all keys even if some are malformed', async () => {
      const objectKeys = ['audits/www_site1_com_page1.json', 'audits/some_path/'];
      getObjectKeysFromSubfoldersStub.resolves({ objectKeys });
      const { getExistingObjectKeysFromFailedAudits: getKeys } = await getModule({
        getObjectKeysFromSubfolders: getObjectKeysFromSubfoldersStub,
      });

      const keys = await getKeys(mockS3Client, 'test-bucket', 'site1', mockLog);

      expect(keys).to.deep.equal(objectKeys);
    });
  });

  describe('filterAccessibilityOpportunities', () => {
    it('filters opportunities correctly based on criteria', () => {
      const opportunities = [
        {
          getType: () => 'generic-opportunity',
          getTitle: () => 'Accessibility report - Desktop',
        },
        {
          getType: () => 'generic-opportunity2',
          getTitle: () => 'Accessibility report - Desktop',
        },
        {
          getType: () => 'other-type',
          getTitle: () => 'Accessibility report - Desktop',
        },
        {
          getType: () => 'generic-opportunity',
          getTitle: () => 'Accessibility report - Desktop',
        },
        {
          getType: () => 'generic-opportunity',
          getTitle: () => 'Other title',
        },
      ];

      const filtered = filterAccessibilityOpportunities(opportunities);

      expect(filtered).to.have.lengthOf(2);
      expect(filtered[0].getType()).to.equal('generic-opportunity');
      expect(filtered[0].getTitle()).to.include('Accessibility report - Desktop');
    });

    it('returns empty array when no opportunities match criteria', () => {
      const opportunities = [
        {
          getType: () => 'other-type',
          getTitle: () => 'Accessibility report - Desktop',
        },
        {
          getType: () => 'generic-opportuni',
          getTitle: () => 'Accessibility report - Desktop',
        },
      ];

      const filtered = filterAccessibilityOpportunities(opportunities);

      expect(filtered).to.be.an('array').that.is.empty;
    });
  });

  describe('updateStatusToIgnored', () => {
    let mockDataAccess;
    let mockLog;
    let sandbox;
    let mockOpportunity;
    let mockOpportunities;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      mockOpportunity = {
        getType: sandbox.stub().returns('generic-opportunity'),
        getTitle: sandbox.stub().returns('Accessibility report - Desktop'),
        setStatus: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockOpportunities = [mockOpportunity];
      mockDataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves(mockOpportunities),
        },
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('successfully updates opportunities to IGNORED status', async () => {
      const result = await updateStatusToIgnored(mockDataAccess, 'site1', mockLog);

      expect(result).to.deep.equal({
        success: true,
        updatedCount: 1,
        error: undefined,
      });
      expect(mockOpportunity.setStatus).to.have.been.calledWith('IGNORED');
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] Found 1 opportunities for site site1');
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] Found 1 opportunities to update to IGNORED for site site1');
    });

    it('handles case when no opportunities are found', async () => {
      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
      const result = await updateStatusToIgnored(mockDataAccess, 'site1', mockLog);

      expect(result).to.deep.equal({
        success: true,
        updatedCount: 0,
      });
      expect(mockOpportunity.setStatus).to.not.have.been.called;
      expect(mockOpportunity.save).to.not.have.been.called;
    });

    it('handles case when no accessibility opportunities match criteria', async () => {
      // Create a mock opportunity that doesn't match the filtering criteria
      const nonMatchingOpportunity = {
        getType: sandbox.stub().returns('other-type'), // Different type
        getTitle: sandbox.stub().returns('Accessibility report - Desktop'),
        setStatus: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([nonMatchingOpportunity]);
      const result = await updateStatusToIgnored(mockDataAccess, 'site1', mockLog);

      expect(result).to.deep.equal({
        success: true,
        updatedCount: 0,
      });
      expect(nonMatchingOpportunity.setStatus).to.not.have.been.called;
      expect(nonMatchingOpportunity.save).to.not.have.been.called;
    });

    it('handles errors during opportunity update', async () => {
      mockOpportunity.save.rejects(new Error('Save failed'));
      const result = await updateStatusToIgnored(mockDataAccess, 'site1', mockLog);

      expect(result).to.deep.equal({
        success: false,
        updatedCount: 0,
        error: 'Some updates failed',
      });
      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] Failed to update 1 opportunities for site site1: [{"status":"rejected","reason":{}}]',
      );
    });

    it('handles errors during opportunity fetch', async () => {
      mockDataAccess.Opportunity.allBySiteIdAndStatus.rejects(new Error('Fetch failed'));
      const result = await updateStatusToIgnored(mockDataAccess, 'site1', mockLog);

      expect(result).to.deep.equal({
        success: false,
        updatedCount: 0,
        error: 'Fetch failed',
      });
      expect(mockLog.error).to.have.been.calledWith('[A11yAudit] Error updating opportunities to IGNORED for site site1: Fetch failed');
    });
  });

  describe('saveA11yMetricsToS3', () => {
    let mockContext;
    let mockLog;
    let mockS3Client;
    let mockSite;
    let sandbox;
    let clock;
    let getObjectFromKeyStub;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      clock = sinon.useFakeTimers(new Date('2024-07-24T10:00:00.000Z'));

      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
      };

      mockS3Client = {
        send: sandbox.stub(),
      };

      mockSite = {
        getId: sandbox.stub().returns('test-site-id'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
      };

      mockContext = {
        log: mockLog,
        env: {
          S3_IMPORTER_BUCKET_NAME: 'test-importer-bucket',
        },
        site: mockSite,
        s3Client: mockS3Client,
      };

      getObjectFromKeyStub = sandbox.stub();
    });

    afterEach(() => {
      sandbox.restore();
      clock.restore();
    });

    async function getModuleWithMocks() {
      return esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });
    }

    it('should successfully save a11y metrics to S3 with new file', async () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            total: 10,
            critical: {
              count: 5,
              items: {
                'color-contrast': { count: 3 },
                'missing-alt': { count: 2 },
              },
            },
            serious: {
              count: 3,
              items: {
                'link-name': { count: 1 },
                'form-label': { count: 2 },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            total: 8,
            critical: { count: 3 },
            serious: { count: 2 },
          },
        },
        'https://example.com/page2': {
          violations: {
            total: 5,
            critical: { count: 2 },
            serious: { count: 1 },
          },
        },
      };

      // Mock no existing file
      getObjectFromKeyStub.resolves(null);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(result.message).to.equal('A11y metrics saved to S3');
      expect(result.s3Key).to.equal('metrics/test-site-id/axe-core/a11y-audit.json');
      expect(result.metricsData).to.deep.include({
        siteId: 'test-site-id',
        url: 'https://example.com',
        source: 'axe-core',
        name: 'a11y-audit',
        time: '2024-07-24T10:00:00.000Z',
        compliance: {
          total: 50,
          failed: 4,
          passed: 46,
        },
      });
      expect(result.metricsData.topOffenders).to.have.lengthOf(2);
      expect(result.metricsData.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 8,
      });

      expect(mockS3Client.send).to.have.been.calledOnce;
    });

    it('should successfully append to existing metrics file', async () => {
      // Arrange
      const existingMetrics = [
        {
          siteId: 'test-site-id',
          url: 'https://example.com',
          source: 'rum',
          name: 'a11y-audit',
          time: '2024-07-20T10:00:00.000Z',
          compliance: { total: 20, failed: 5, passed: 15 },
          topOffenders: [],
        },
      ];

      const reportData = {
        overall: {
          violations: {
            total: 5,
            critical: {
              count: 3,
              items: {
                'color-contrast': { count: 3 },
              },
            },
            serious: {
              count: 2,
              items: {
                'link-name': { count: 2 },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            total: 3,
            critical: { count: 2 },
            serious: { count: 1 },
          },
        },
      };

      getObjectFromKeyStub.resolves(existingMetrics);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] Found existing metrics file with 1 entries for site test-site-id (https://example.com)');

      // Verify the S3 call includes both old and new metrics
      const s3CallArgs = mockS3Client.send.getCall(0).args[0];
      const savedData = JSON.parse(s3CallArgs.input.Body);
      expect(savedData).to.have.lengthOf(2);
      expect(savedData[0]).to.deep.equal(existingMetrics[0]);
      expect(savedData[1]).to.deep.include({
        siteId: 'test-site-id',
        source: 'axe-core',
      });
    });

    it('should handle empty report data gracefully', async () => {
      // Arrange
      const reportData = {};

      getObjectFromKeyStub.resolves(null);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(result.metricsData.compliance).to.deep.equal({
        total: 50,
        failed: 0,
        passed: 50,
      });
      expect(result.metricsData.topOffenders).to.be.an('array').that.is.empty;
    });

    it('should calculate top offenders correctly and limit to 10', async () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            total: 50,
            critical: {
              count: 25,
              items: {
                'color-contrast': { count: 10 },
                'missing-alt': { count: 8 },
                'keyboard-nav': { count: 7 },
              },
            },
            serious: {
              count: 20,
              items: {
                'link-name': { count: 12 },
                'form-label': { count: 8 },
              },
            },
          },
        },
      };

      // Create 15 URLs with violations to test the limit
      for (let i = 1; i <= 15; i += 1) {
        reportData[`https://example.com/page${i}`] = {
          violations: {
            total: i * 2, // Use total instead of critical + serious
            critical: { count: i },
            serious: { count: i - 1 },
          },
        };
      }

      getObjectFromKeyStub.resolves(null);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(result.metricsData.topOffenders).to.have.lengthOf(10);
      expect(result.metricsData.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page15',
        count: 30, // 15 * 2
      });
      expect(result.metricsData.topOffenders[9]).to.deep.equal({
        url: 'https://example.com/page6',
        count: 12, // 6 * 2
      });
    });

    it('should handle S3 read errors gracefully', async () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            total: 5,
            critical: {
              count: 2,
              items: {
                'color-contrast': { count: 2 },
              },
            },
            serious: {
              count: 1,
              items: {
                'link-name': { count: 1 },
              },
            },
          },
        },
      };

      getObjectFromKeyStub.rejects(new Error('S3 read error'));
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(mockLog.info).to.have.been.calledWith('[A11yAudit] No existing metrics file found for site test-site-id (https://example.com), creating new one: S3 read error');

      // Should still save successfully with empty array as base
      const s3CallArgs = mockS3Client.send.getCall(0).args[0];
      const savedData = JSON.parse(s3CallArgs.input.Body);
      expect(savedData).to.have.lengthOf(1);
    });

    it('should handle S3 write errors', async () => {
      // Arrange
      const reportData = {
        overall: {
          violations: { total: 5, critical: { count: 2 }, serious: { count: 1 } },
        },
      };

      getObjectFromKeyStub.resolves([]);
      mockS3Client.send.rejects(new Error('S3 write error'));

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Failed to save a11y metrics to S3: S3 write error');
      expect(result.error).to.equal('S3 write error');
      expect(mockLog.error).to.have.been.calledWith('[A11yAudit] Error saving metrics to S3 for site test-site-id (https://example.com): S3 write error');
    });

    it('should use correct S3 key format', async () => {
      // Arrange
      const reportData = { overall: { violations: { total: 0 } } };

      getObjectFromKeyStub.resolves(null);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      await saveMetrics(reportData, mockContext);

      // Assert
      expect(getObjectFromKeyStub).to.have.been.calledWith(
        mockS3Client,
        'test-importer-bucket',
        'metrics/test-site-id/axe-core/a11y-audit.json',
        mockLog,
      );

      const s3CallArgs = mockS3Client.send.getCall(0).args[0];
      expect(s3CallArgs.input.Key).to.equal('metrics/test-site-id/axe-core/a11y-audit.json');
      expect(s3CallArgs.input.Bucket).to.equal('test-importer-bucket');
      expect(s3CallArgs.input.ContentType).to.equal('application/json');
    });

    it('should handle non-array existing data', async () => {
      // Arrange
      const reportData = { overall: { violations: { total: 1, critical: { count: 1 } } } };

      // Mock existing data that's not an array
      getObjectFromKeyStub.resolves({ invalid: 'data' });
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;

      // Should start with empty array when existing data is not an array
      const s3CallArgs = mockS3Client.send.getCall(0).args[0];
      const savedData = JSON.parse(s3CallArgs.input.Body);
      expect(savedData).to.have.lengthOf(1);
      expect(savedData[0]).to.deep.include({
        siteId: 'test-site-id',
        source: 'axe-core',
      });
    });

    it('should filter out URLs with no violations from top offenders', async () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            total: 5,
            critical: {
              count: 3,
              items: {
                'color-contrast': { count: 3 },
              },
            },
            serious: {
              count: 2,
              items: {
                'link-name': { count: 2 },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            total: 3,
            critical: { count: 3 },
            serious: { count: 0 },
          },
        },
        'https://example.com/page2': {
          violations: {
            total: 0,
            critical: { count: 0 },
            serious: { count: 0 },
          },
        },
        'https://example.com/page3': {
          violations: {
            total: 2,
            critical: { count: 0 },
            serious: { count: 2 },
          },
        },
      };

      getObjectFromKeyStub.resolves(null);
      mockS3Client.send.resolves({});

      const { saveA11yMetricsToS3: saveMetrics } = await getModuleWithMocks();

      // Act
      const result = await saveMetrics(reportData, mockContext);

      // Assert
      expect(result.success).to.be.true;
      expect(result.metricsData.topOffenders).to.have.lengthOf(2);
      expect(result.metricsData.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 3,
      });
      expect(result.metricsData.topOffenders[1]).to.deep.equal({
        url: 'https://example.com/page3',
        count: 2,
      });
    });
  });

  describe('calculateAuditMetrics', () => {
    it('should create metrics with custom audit type and source', () => {
      // Arrange
      const reportData = { custom: 'data' };
      const config = {
        siteId: 'test-site',
        baseUrl: 'https://test.com',
        auditType: 'custom',
        source: 'custom-tool',
        totalChecks: 25,
        extractComplianceData: (data, total) => ({
          total,
          failed: 5,
          passed: 20,
        }),
        extractTopOffenders: () => [
          { url: 'https://test.com/page1', count: 3 },
          { url: 'https://test.com/page2', count: 1 },
        ],
      };

      // Act
      const result = calculateAuditMetrics(reportData, config);

      // Assert
      expect(result).to.deep.include({
        siteId: 'test-site',
        url: 'https://test.com',
        source: 'custom-tool',
        name: 'custom-audit',
        compliance: {
          total: 25,
          failed: 5,
          passed: 20,
        },
        topOffenders: [
          { url: 'https://test.com/page1', count: 3 },
          { url: 'https://test.com/page2', count: 1 },
        ],
      });
      expect(result.time).to.be.a('string');
    });

    it('should use default source when not provided', () => {
      // Arrange
      const reportData = {};
      const config = {
        siteId: 'test-site',
        baseUrl: 'https://test.com',
        auditType: 'test',
        totalChecks: 10,
        extractComplianceData: () => ({ total: 10, failed: 0, passed: 10 }),
        extractTopOffenders: () => [],
      };

      // Act
      const result = calculateAuditMetrics(reportData, config);

      // Assert
      expect(result.source).to.equal('axe-core'); // default value
    });

    it('should call extractor functions with correct parameters', () => {
      // Arrange
      const reportData = { test: 'data' };
      const mockComplianceExtractor = sinon.stub().returns({ total: 20, failed: 5, passed: 15 });
      const mockOffendersExtractor = sinon.stub().returns([]);
      const config = {
        siteId: 'test-site',
        baseUrl: 'https://test.com',
        auditType: 'test',
        totalChecks: 20,
        extractComplianceData: mockComplianceExtractor,
        extractTopOffenders: mockOffendersExtractor,
      };

      // Act
      calculateAuditMetrics(reportData, config);

      // Assert
      expect(mockComplianceExtractor).to.have.been.calledOnceWith(reportData, 20);
      expect(mockOffendersExtractor).to.have.been.calledOnceWith(reportData);
    });

    it('should generate valid ISO timestamp', () => {
      // Arrange
      const config = {
        siteId: 'test-site',
        baseUrl: 'https://test.com',
        auditType: 'test',
        totalChecks: 10,
        extractComplianceData: () => ({ total: 10, failed: 0, passed: 10 }),
        extractTopOffenders: () => [],
      };

      // Act
      const result = calculateAuditMetrics({}, config);

      // Assert
      expect(result.time).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(result.time)).to.be.a('date');
    });
  });

  describe('calculateA11yMetrics', () => {
    it('should calculate metrics correctly from report data', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: {
              items: {
                'color-contrast': { count: 3 },
                'missing-alt': { count: 2 },
              },
            },
            serious: {
              items: {
                'link-name': { count: 1 },
              },
            },
          },
        },
        'https://example.com/page1': {
          violations: {
            total: 8,
          },
        },
        'https://example.com/page2': {
          violations: {
            total: 5,
          },
        },
      };

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result).to.deep.include({
        siteId: 'test-site-id',
        url: 'https://example.com',
        source: 'axe-core',
        name: 'a11y-audit',
        compliance: {
          total: 50,
          failed: 3, // 2 critical items + 1 serious item
          passed: 47,
        },
      });
      expect(result.topOffenders).to.have.lengthOf(2);
      expect(result.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 8,
      });
      expect(result.time).to.be.a('string');
    });

    it('should handle empty report data', () => {
      // Arrange
      const reportData = {};

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.compliance).to.deep.equal({
        total: 50,
        failed: 0,
        passed: 50,
      });
      expect(result.topOffenders).to.be.an('array').that.is.empty;
    });

    it('should filter out URLs with zero violations', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: { items: { 'test-rule': { count: 1 } } },
            serious: { items: {} },
          },
        },
        'https://example.com/page1': {
          violations: { total: 5 },
        },
        'https://example.com/page2': {
          violations: { total: 0 },
        },
        'https://example.com/page3': {
          violations: { total: 3 },
        },
      };

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.topOffenders).to.have.lengthOf(2);
      expect(result.topOffenders[0].url).to.equal('https://example.com/page1');
      expect(result.topOffenders[1].url).to.equal('https://example.com/page3');
    });

    it('should aggregate violations from composite keys (forms) with same base URL', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: { items: { 'test-rule': { count: 1 } } },
            serious: { items: {} },
          },
        },
        'https://example.com/page1': {
          violations: { total: 5 },
        },
        'https://example.com/page1?source=contact-form': {
          violations: { total: 3 },
        },
        'https://example.com/page1?source=newsletter-form': {
          violations: { total: 2 },
        },
        'https://example.com/page2': {
          violations: { total: 4 },
        },
      };

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.topOffenders).to.have.lengthOf(2);
      expect(result.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 10, // 5 + 3 + 2 = 10 (aggregated)
      });
      expect(result.topOffenders[1]).to.deep.equal({
        url: 'https://example.com/page2',
        count: 4,
      });
    });

    it('should handle mixed composite and regular keys correctly', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
        'https://example.com/page1': {
          violations: { total: 8 },
        },
        'https://example.com/page2?source=form1': {
          violations: { total: 6 },
        },
        'https://example.com/page3': {
          violations: { total: 5 },
        },
        'https://example.com/page2?source=form2': {
          violations: { total: 4 },
        },
        'https://example.com/page2': {
          violations: { total: 3 },
        },
      };

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.topOffenders).to.have.lengthOf(3);
      expect(result.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page2',
        count: 13, // 3 + 6 + 4 = 13 (aggregated from site and two forms)
      });
      expect(result.topOffenders[1]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 8,
      });
      expect(result.topOffenders[2]).to.deep.equal({
        url: 'https://example.com/page3',
        count: 5,
      });
    });

    it('should handle only composite keys (no direct URLs)', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
        'https://example.com/page1?source=contact-form': {
          violations: { total: 7 },
        },
        'https://example.com/page1?source=feedback-form': {
          violations: { total: 3 },
        },
        'https://example.com/page2?source=subscribe-form': {
          violations: { total: 5 },
        },
      };

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.topOffenders).to.have.lengthOf(2);
      expect(result.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 10, // 7 + 3 = 10
      });
      expect(result.topOffenders[1]).to.deep.equal({
        url: 'https://example.com/page2',
        count: 5,
      });
    });

    it('should respect the limit of 10 top offenders after aggregation', () => {
      // Arrange
      const reportData = {
        overall: {
          violations: {
            critical: { items: {} },
            serious: { items: {} },
          },
        },
      };

      // Create 15 different pages with varying violation counts
      for (let i = 1; i <= 15; i += 1) {
        const baseUrl = `https://example.com/page${i}`;
        reportData[baseUrl] = {
          violations: { total: 20 - i }, // Decreasing counts
        };
        // Add form entries for some pages
        if (i <= 5) {
          reportData[`${baseUrl}?source=form1`] = {
            violations: { total: i },
          };
        }
      }

      // Act
      const result = calculateA11yMetrics(reportData, 'test-site-id', 'https://example.com');

      // Assert
      expect(result.topOffenders).to.have.lengthOf(10); // Should limit to 10
      // First page should have highest count (20 - 1 + 1 = 20)
      expect(result.topOffenders[0]).to.deep.equal({
        url: 'https://example.com/page1',
        count: 20,
      });
      // Verify it's sorted correctly
      for (let i = 1; i < result.topOffenders.length; i += 1) {
        expect(result.topOffenders[i - 1].count).to.be.at.least(result.topOffenders[i].count);
      }
    });
  });
});
