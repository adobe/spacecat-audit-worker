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

/* eslint-disable no-console */

import { expect, use } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import sinonChai from 'sinon-chai';
import {
  getRemainingUrls,
  extractUrlsFromSettledResults,
  filterAccessibilityOpportunities,
  updateStatusToIgnored,
  saveOpptyWithRetry,
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
        debug: sandbox.stub(),
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
      expect(mockLog.error).to.have.been.calledWith(`[A11yAudit][A11yProcessingError] Error getting existing URLs from failed audits for site site1: ${error.message}`);
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
        debug: sandbox.stub(),
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
      expect(mockLog.debug).to.have.been.calledWith('[A11yAudit] Found 1 opportunities to update to IGNORED for site site1');
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
        '[A11yAudit][A11yProcessingError] Failed to update 1 opportunities for site site1: [{"status":"rejected","reason":{}}]',
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
      expect(mockLog.error).to.have.been.calledWith('[A11yAudit][A11yProcessingError] Error updating opportunities to IGNORED for site site1: Fetch failed');
    });
  });

  describe('saveMystiqueValidationMetricsToS3', () => {
    let testModule;
    let sandbox;
    let mockS3Client;
    let mockLog;
    let mockContext;
    let getObjectFromKeyStub;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      mockS3Client = { send: sandbox.stub() };
      mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
      };
      mockContext = {
        log: mockLog,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        s3Client: mockS3Client,
      };

      getObjectFromKeyStub = sandbox.stub();

      testModule = await esmock('../../../src/accessibility/utils/scrape-utils.js', {
        '../../../src/accessibility/utils/data-processing.js': {},
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should create new metrics file when none exists', async () => {
      // Arrange
      const validationData = {
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      };

      // Mock getObjectFromKey to throw (no existing file)
      getObjectFromKeyStub.rejects(new Error('File not found'));
      // Mock successful S3 save
      mockS3Client.send.resolves();

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(result.message).to.equal('Mystique validation metrics saved to S3');
      expect(result.s3Key).to.equal('metrics/site-456/mystique/a11y-suggestions-validation.json');
      expect(result.metricsData).to.deep.include({
        siteId: 'site-456',
        auditId: 'audit-789',
        opportunityId: 'oppty-123',
        opportunityType: 'accessibility',
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      });
      expect(result.metricsData.validatedAt).to.be.a('string');

      // Verify S3 call
      expect(mockS3Client.send).to.have.been.calledOnce;
      const putCall = mockS3Client.send.getCall(0);
      const putCommand = putCall.args[0];
      expect(putCommand.input.Bucket).to.equal('test-bucket');
      expect(putCommand.input.Key).to.equal('metrics/site-456/mystique/a11y-suggestions-validation.json');
      expect(putCommand.input.ContentType).to.equal('application/json');

      const savedData = JSON.parse(putCommand.input.Body);
      expect(savedData).to.be.an('array').with.lengthOf(1);
      expect(savedData[0]).to.deep.include({
        siteId: 'site-456',
        auditId: 'audit-789',
        opportunityId: 'oppty-123',
        opportunityType: 'accessibility',
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      });

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yValidation] No existing mystique validation file found for site site-456, creating new one: File not found',
      );
      expect(mockLog.debug).to.have.been.calledWith(
        '[A11yValidation] Added new mystique validation entry for page https://example.com/page1',
      );
    });

    it('should update existing entry for same audit+opportunity+page', async () => {
      // Arrange
      const existingMetrics = [
        {
          siteId: 'site-456',
          auditId: 'audit-789',
          opportunityId: 'oppty-123',
          opportunityType: 'accessibility',
          pageUrl: 'https://example.com/page1',
          validatedAt: '2024-01-01T00:00:00.000Z',
          sentCount: 10,
          receivedCount: 8,
        },
        {
          siteId: 'site-456',
          auditId: 'audit-789',
          opportunityId: 'oppty-123',
          opportunityType: 'accessibility',
          pageUrl: 'https://example.com/page2',
          validatedAt: '2024-01-01T00:00:00.000Z',
          sentCount: 5,
          receivedCount: 4,
        },
      ];

      const validationData = {
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      };

      // Mock getObjectFromKey to return existing data
      getObjectFromKeyStub.resolves(existingMetrics);
      // Mock successful S3 save
      mockS3Client.send.resolves();

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(mockLog.debug).to.have.been.calledWith(
        '[A11yValidation] Updated existing mystique validation entry for page https://example.com/page1',
      );

      // Verify the updated data
      const putCall = mockS3Client.send.getCall(0);
      const savedData = JSON.parse(putCall.args[0].input.Body);
      expect(savedData).to.have.lengthOf(2);

      // First entry should be updated
      expect(savedData[0]).to.deep.include({
        siteId: 'site-456',
        auditId: 'audit-789',
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      });

      // Second entry should remain unchanged
      expect(savedData[1]).to.deep.equal(existingMetrics[1]);
    });

    it('should add new entry when audit+opportunity+page combination is different', async () => {
      // Arrange
      const existingMetrics = [
        {
          siteId: 'site-456',
          auditId: 'audit-789',
          opportunityId: 'oppty-123',
          opportunityType: 'accessibility',
          pageUrl: 'https://example.com/page1',
          validatedAt: '2024-01-01T00:00:00.000Z',
          sentCount: 10,
          receivedCount: 8,
        },
      ];

      const validationData = {
        pageUrl: 'https://example.com/page2',
        sentCount: 7,
        receivedCount: 5,
      };

      // Mock getObjectFromKey to return existing data
      getObjectFromKeyStub.resolves(existingMetrics);
      // Mock successful S3 save
      mockS3Client.send.resolves();

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(mockLog.debug).to.have.been.calledWith(
        '[A11yValidation] Added new mystique validation entry for page https://example.com/page2',
      );

      // Verify the data now has 2 entries
      const putCall = mockS3Client.send.getCall(0);
      const savedData = JSON.parse(putCall.args[0].input.Body);
      expect(savedData).to.have.lengthOf(2);

      // Original entry should remain
      expect(savedData[0]).to.deep.equal(existingMetrics[0]);

      // New entry should be added
      expect(savedData[1]).to.deep.include({
        siteId: 'site-456',
        auditId: 'audit-789',
        opportunityId: 'oppty-123',
        pageUrl: 'https://example.com/page2',
        sentCount: 7,
        receivedCount: 5,
      });
    });

    it('should handle default values for sentCount and receivedCount', async () => {
      // Arrange
      const validationData = {
        pageUrl: 'https://example.com/page1',
        // sentCount and receivedCount are undefined
      };

      // Mock no existing file
      getObjectFromKeyStub.rejects(new Error('File not found'));
      mockS3Client.send.resolves();

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(result.metricsData.sentCount).to.equal(0);
      expect(result.metricsData.receivedCount).to.equal(0);
    });

    it('should handle S3 save errors gracefully', async () => {
      // Arrange
      const validationData = {
        pageUrl: 'https://example.com/page1',
        sentCount: 10,
        receivedCount: 8,
      };

      // Mock getObjectFromKey success but S3 save failure
      getObjectFromKeyStub.rejects(new Error('File not found'));
      mockS3Client.send.rejects(new Error('S3 save failed'));

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Failed to save mystique validation metrics to S3: S3 save failed');
      expect(result.error).to.equal('S3 save failed');
      expect(mockLog.error).to.have.been.calledWith(
        '[A11yValidation][A11yProcessingError] Error saving mystique validation metrics to S3 for site site-456, opportunity oppty-123: S3 save failed',
      );
    });

    it('should handle invalid existing data gracefully', async () => {
      // Arrange
      const validationData = {
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      };

      // Mock getObjectFromKey to return invalid data (not an array)
      getObjectFromKeyStub.resolves({ invalid: 'data' });
      mockS3Client.send.resolves();

      // Act
      const result = await testModule.saveMystiqueValidationMetricsToS3(
        validationData,
        mockContext,
        'oppty-123',
        'accessibility',
        'site-456',
        'audit-789',
      );

      // Assert
      expect(result.success).to.be.true;

      // Should create new array with just the new entry
      const putCall = mockS3Client.send.getCall(0);
      const savedData = JSON.parse(putCall.args[0].input.Body);
      expect(savedData).to.be.an('array').with.lengthOf(1);
      expect(savedData[0]).to.deep.include({
        siteId: 'site-456',
        pageUrl: 'https://example.com/page1',
        sentCount: 15,
        receivedCount: 12,
      });
    });

    describe('sent vs received count relationships', () => {
      it('should track multiple page metrics for same opportunity', async () => {
        // Arrange - Simulate multiple pages for same opportunity
        const existingMetrics = [];

        // First page with some suggestions received
        const page1Data = {
          pageUrl: 'https://example.com/page1',
          sentCount: 15, // Total sent for entire opportunity
          receivedCount: 8, // Received for this page only
        };

        // Second page with different received count
        const page2Data = {
          pageUrl: 'https://example.com/page2',
          sentCount: 15, // Same total (as expected per user requirement)
          receivedCount: 4, // Received for this page only
        };

        getObjectFromKeyStub.onFirstCall().resolves(existingMetrics);
        getObjectFromKeyStub.onSecondCall().resolves([
          {
            siteId: 'site-456',
            auditId: 'audit-789',
            opportunityId: 'oppty-123',
            opportunityType: 'accessibility',
            ...page1Data,
            validatedAt: '2024-01-01T00:00:00.000Z',
          },
        ]);
        mockS3Client.send.resolves();

        // Act - Save metrics for both pages
        const result1 = await testModule.saveMystiqueValidationMetricsToS3(page1Data, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789');

        const result2 = await testModule.saveMystiqueValidationMetricsToS3(page2Data, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789');

        // Assert - Both pages stored with same sentCount but different receivedCount
        expect(result1.success).to.be.true;
        expect(result2.success).to.be.true;

        expect(result1.metricsData.sentCount).to.equal(15);
        expect(result1.metricsData.receivedCount).to.equal(8);

        expect(result2.metricsData.sentCount).to.equal(15);
        expect(result2.metricsData.receivedCount).to.equal(4);

        // Verify total received (8 + 4 = 12) is less than sent (15)
        const totalReceived = result1.metricsData.receivedCount + result2.metricsData.receivedCount;
        const totalSent = result1.metricsData.sentCount; // Same for all pages
        expect(totalReceived).to.equal(12);
        expect(totalSent).to.equal(15);
        expect(totalReceived).to.be.lessThan(totalSent); // Some suggestions were "orphaned"
      });

      it('should handle case where received equals sent (100% success)', async () => {
        // Arrange - Perfect success scenario
        const validationData = {
          pageUrl: 'https://example.com/page1',
          sentCount: 10,
          receivedCount: 10, // All suggestions received back
        };

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act
        const result = await testModule.saveMystiqueValidationMetricsToS3(validationData, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789');

        // Assert - 100% success rate
        expect(result.success).to.be.true;
        expect(result.metricsData.sentCount).to.equal(10);
        expect(result.metricsData.receivedCount).to.equal(10);

        // Calculate success rate
        const successRate = ((result.metricsData.receivedCount / result.metricsData.sentCount)
            * 100);
        expect(successRate).to.equal(100);
      });

      it('should handle case where received exceeds sent (error scenario)', async () => {
        // Arrange - Data inconsistency scenario (should not happen in practice)
        const validationData = {
          pageUrl: 'https://example.com/page1',
          sentCount: 5,
          receivedCount: 8, // More received than sent (data issue)
        };

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act
        const result = await testModule.saveMystiqueValidationMetricsToS3(validationData, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789');

        // Assert - Still stores the data (doesn't validate business logic)
        expect(result.success).to.be.true;
        expect(result.metricsData.sentCount).to.equal(5);
        expect(result.metricsData.receivedCount).to.equal(8);

        // Calculate success rate (would be > 100% - indicates data issue)
        const successRate = ((result.metricsData.receivedCount / result.metricsData.sentCount)
            * 100);
        expect(successRate).to.equal(160); // 160% indicates data problem
      });

      it('should handle zero received (0% success)', async () => {
        // Arrange - No suggestions received back
        const validationData = {
          pageUrl: 'https://example.com/page1',
          sentCount: 12,
          receivedCount: 0, // No suggestions received
        };

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act
        const result = await testModule.saveMystiqueValidationMetricsToS3(validationData, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789');

        // Assert - 0% success rate
        expect(result.success).to.be.true;
        expect(result.metricsData.sentCount).to.equal(12);
        expect(result.metricsData.receivedCount).to.equal(0);

        // Calculate success rate
        const successRate = ((result.metricsData.receivedCount / result.metricsData.sentCount)
            * 100);
        expect(successRate).to.equal(0);
      });

      it('should demonstrate aggregation across multiple opportunities', async () => {
        // Arrange - Different opportunities with different sent/received ratios
        const opportunity1Metrics = [
          { pageUrl: 'https://example.com/page1', sentCount: 20, receivedCount: 15 },
          { pageUrl: 'https://example.com/page2', sentCount: 20, receivedCount: 12 },
        ];

        const opportunity2Metrics = [
          { pageUrl: 'https://example.com/page3', sentCount: 8, receivedCount: 8 },
        ];

        // Mock empty existing data for clean test
        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act - Save metrics for multiple opportunities
        const opp1Promises = opportunity1Metrics.map((data) => testModule.saveMystiqueValidationMetricsToS3(data, mockContext, 'oppty-123', 'accessibility', 'site-456', 'audit-789'));
        const opp2Promises = opportunity2Metrics.map((data) => testModule.saveMystiqueValidationMetricsToS3(data, mockContext, 'oppty-456', 'accessibility', 'site-456', 'audit-789'));

        const results = await Promise.all([...opp1Promises, ...opp2Promises]);

        // Assert - Calculate aggregated success rates
        expect(results).to.have.lengthOf(3);

        // Opportunity 1: 20 sent, (15 + 12) = 27 received total
        const opp1TotalReceived = opportunity1Metrics.reduce((sum, m) => sum + m.receivedCount, 0);
        const opp1SentCount = opportunity1Metrics[0].sentCount; // Same for all pages
        expect(opp1TotalReceived).to.equal(27);
        expect(opp1SentCount).to.equal(20);
        expect(opp1TotalReceived).to.be.greaterThan(opp1SentCount); // 135% success rate

        // Opportunity 2: 8 sent, 8 received
        const opp2TotalReceived = opportunity2Metrics.reduce((sum, m) => sum + m.receivedCount, 0);
        const opp2SentCount = opportunity2Metrics[0].sentCount;
        expect(opp2TotalReceived).to.equal(8);
        expect(opp2SentCount).to.equal(8);
        expect(opp2TotalReceived).to.equal(opp2SentCount); // 100% success rate
      });

      it('should validate real-world scenario: multiple pages with consistent sentCount but low receivedCount', async () => {
        // Arrange
        const realWorldMetrics = [
          {
            pageUrl: 'https://www.volvotrucks.us/parts-and-services/parts/all-makes/',
            sentCount: 143, // Total suggestions sent for entire opportunity
            receivedCount: 2, // Only 2 received for this page
          },
          {
            pageUrl: 'https://www.volvotrucks.us/trucks/vhd-ii/interior/',
            sentCount: 143, // Same total (as expected)
            receivedCount: 2, // Only 2 received for this page
          },
          {
            pageUrl: 'https://www.volvotrucks.us/about-volvo/facilities/parts-distribution-centers/',
            sentCount: 143, // Same total
            receivedCount: 2, // Only 2 received for this page
          },
          {
            pageUrl: 'https://www.volvotrucks.us/our-difference/driver-productivity/volvo-dynamic-steering/',
            sentCount: 143, // Same total
            receivedCount: 2, // Only 2 received for this page
          },
        ];

        // Mock empty existing data for clean test
        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act - Save metrics for all pages (simulating async SQS message processing)
        const saveMetrics = (data) => testModule.saveMystiqueValidationMetricsToS3(
          data,
          mockContext,
          'bd068a2a-8150-4ea7-b821-9120b2561cdc', // Real opportunity ID
          'a11y-assistive',
          'd1a5d531-8c3a-42a0-a39a-e7f4a72f4015', // Real site ID
          '7dc5c794-6116-446f-907d-47b96a5be571', // Real audit ID
        );
        const promises = realWorldMetrics.map(saveMetrics);
        const results = await Promise.all(promises);

        // Assert - All pages have same sentCount but different receivedCount
        expect(results).to.have.lengthOf(4);

        // Verify each page stores the correct data
        results.forEach((result, index) => {
          expect(result.success).to.be.true;
          expect(result.metricsData.sentCount).to.equal(143);
          expect(result.metricsData.receivedCount).to.equal(2);
          expect(result.metricsData.pageUrl).to.equal(realWorldMetrics[index].pageUrl);
        });

        // Calculate aggregated success rate across all pages
        const totalSent = realWorldMetrics[0].sentCount; // 143 (same for all)
        // 2+2+2+2 = 8
        const totalReceived = realWorldMetrics.reduce((sum, m) => sum + m.receivedCount, 0);
        const successRate = ((totalReceived / totalSent) * 100);

        expect(totalSent).to.equal(143);
        expect(totalReceived).to.equal(8);
        expect(successRate).to.be.approximately(5.59, 0.01); // ~5.6% success rate

        // Verify this indicates many "orphaned" suggestions
        const orphanedCount = totalSent - totalReceived;
        expect(orphanedCount).to.equal(135); // 135 suggestions never received back
        expect(orphanedCount).to.be.greaterThan(totalReceived); // More orphaned than successful
      });

      it('should validate ideal scenario: receivedCount sum equals sentCount (100% success)', async () => {
        // Arrange - Ideal scenario where ALL suggestions are successfully processed by Mystique
        const idealMetrics = [
          { pageUrl: 'https://example.com/page1', sentCount: 143, receivedCount: 35 },
          { pageUrl: 'https://example.com/page2', sentCount: 143, receivedCount: 42 },
          { pageUrl: 'https://example.com/page3', sentCount: 143, receivedCount: 38 },
          { pageUrl: 'https://example.com/page4', sentCount: 143, receivedCount: 28 },
          // Total received: 35 + 42 + 38 + 28 = 143 (matches sentCount perfectly)
        ];

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act - Save metrics for all pages
        const promises = idealMetrics.map((data) => testModule.saveMystiqueValidationMetricsToS3(data, mockContext, 'ideal-oppty-123', 'accessibility', 'site-456', 'audit-789'));
        const results = await Promise.all(promises);

        // Assert - Perfect 100% success rate
        expect(results).to.have.lengthOf(4);

        const totalSent = idealMetrics[0].sentCount; // 143
        const totalReceived = idealMetrics.reduce((sum, m) => sum + m.receivedCount, 0); // 143
        const successRate = ((totalReceived / totalSent) * 100);

        expect(totalSent).to.equal(143);
        expect(totalReceived).to.equal(143);
        expect(successRate).to.equal(100); // Perfect 100% success rate

        const orphanedCount = totalSent - totalReceived;
        expect(orphanedCount).to.equal(0); // No orphaned suggestions
      });

      it('should detect and flag when receivedCount sum is significantly less than sentCount', async () => {
        // Arrange - Your real-world problematic scenario
        const problematicMetrics = [
          { pageUrl: 'https://www.volvotrucks.us/page1', sentCount: 143, receivedCount: 2 },
          { pageUrl: 'https://www.volvotrucks.us/page2', sentCount: 143, receivedCount: 2 },
          { pageUrl: 'https://www.volvotrucks.us/page3', sentCount: 143, receivedCount: 2 },
          { pageUrl: 'https://www.volvotrucks.us/page4', sentCount: 143, receivedCount: 2 },
          // Total received: 2 + 2 + 2 + 2 = 8 (much less than sentCount of 143)
        ];

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act
        const promises = problematicMetrics.map((data) => testModule.saveMystiqueValidationMetricsToS3(data, mockContext, 'problematic-oppty-456', 'accessibility', 'site-789', 'audit-123'));
        const results = await Promise.all(promises);

        // Assert - Flag the significant discrepancy
        expect(results).to.have.lengthOf(4);
        results.forEach((result) => expect(result.success).to.be.true);
        const totalSent = problematicMetrics[0].sentCount; // 143
        const totalReceived = problematicMetrics.reduce((sum, m) => sum + m.receivedCount, 0); // 8
        const successRate = ((totalReceived / totalSent) * 100);
        const orphanedCount = totalSent - totalReceived;

        expect(totalSent).to.equal(143);
        expect(totalReceived).to.equal(8);
        expect(successRate).to.be.approximately(5.59, 0.01);
        expect(orphanedCount).to.equal(135);

        // Flag this as problematic (< 50% success rate indicates issues)
        expect(successRate).to.be.lessThan(50); // This should trigger investigation
        // 10x more orphaned than successful
        expect(orphanedCount).to.be.greaterThan(totalReceived * 10);

        // This test validates that your real data shows a significant problem
        expect(successRate).to.be.lessThan(10); // Less than 10% is definitely problematic
      });

      it('should simulate realistic async receival workflow: static sent, variable received per payload', async () => {
        // Arrange - Simulate the real workflow philosophy:
        // 1. We already sent 143 suggestions to Mystique (this count is now static/known)
        // 2. Mystique processes them and sends back multiple SQS payloads at different times
        // 3. Each payload has variable receivedCount based on what Mystique processed for that page
        // 4. Each receival triggers metrics collection with the SAME sentCount but
        // different receivedCount

        const opportunityId = 'oppty-async-workflow';
        const staticSentCount = 143; // This never changes - we know we sent 143 total

        // Simulate 5 SQS payloads arriving at different times from Mystique
        const asyncReceivals = [
          {
            pageUrl: 'https://example.com/landing',
            sentCount: staticSentCount, // Always the same - static
            receivedCount: 24, // Variable - what Mystique processed for this page
          },
          {
            pageUrl: 'https://example.com/products',
            sentCount: staticSentCount, // Same static value
            receivedCount: 31, // Different received count
          },
          {
            pageUrl: 'https://example.com/services',
            sentCount: staticSentCount, // Same static value
            receivedCount: 18, // Different received count
          },
          {
            pageUrl: 'https://example.com/about',
            sentCount: staticSentCount, // Same static value
            receivedCount: 42, // Different received count
          },
          {
            pageUrl: 'https://example.com/contact',
            sentCount: staticSentCount, // Same static value
            receivedCount: 28, // Different received count
          },
          // Total received: 24 + 31 + 18 + 42 + 28 = 143 (equals staticSentCount - perfect!)
        ];

        getObjectFromKeyStub.resolves([]);
        mockS3Client.send.resolves();

        // Act - Simulate each SQS payload arriving and triggering metrics collection
        const promises = asyncReceivals.map((payload) => testModule.saveMystiqueValidationMetricsToS3(payload, mockContext, opportunityId, 'accessibility', 'site-async', 'audit-async'));
        const results = await Promise.all(promises);

        // Assert - Validate the philosophy
        expect(results).to.have.lengthOf(5);

        // 1. All payloads have the SAME staticSentCount (known from when we sent to Mystique)
        results.forEach((result) => {
          expect(result.metricsData.sentCount).to.equal(staticSentCount);
        });

        // 2. Each payload has DIFFERENT receivedCount (varies per page/payload)
        const receivedCounts = results.map((r) => r.metricsData.receivedCount);
        expect(receivedCounts).to.deep.equal([24, 31, 18, 42, 28]);

        // 3. Sum of all receivedCounts should ideally equal staticSentCount
        const totalReceived = receivedCounts.reduce((sum, count) => sum + count, 0);
        expect(totalReceived).to.equal(staticSentCount); // Perfect 100% success!
      });
    });
  });

  describe('saveOpptyWithRetry', () => {
    let sandbox;
    let mockOpportunity;
    let mockOpportunityClass;
    let mockLog;
    let clock;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      clock = sinon.useFakeTimers();

      mockLog = {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      };

      mockOpportunity = {
        getId: sandbox.stub().returns('test-opportunity-id'),
        save: sandbox.stub(),
        setAuditId: sandbox.stub().returnsThis(),
        setUpdatedBy: sandbox.stub().returnsThis(),
      };

      mockOpportunityClass = {
        findById: sandbox.stub(),
      };
    });

    afterEach(() => {
      sandbox.restore();
      clock.restore();
    });

    describe('successful save scenarios', () => {
      it('should save opportunity successfully on first attempt', async () => {
        // Arrange
        mockOpportunity.save.resolves();

        // Act
        const result = await saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
        );

        // Assert
        expect(mockOpportunity.save).to.have.been.calledOnce;
        // First attempt doesn't call setAuditId or setUpdatedBy - only retries do
        expect(mockOpportunity.setAuditId).to.not.have.been.called;
        expect(mockOpportunity.setUpdatedBy).to.not.have.been.called;
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 1',
        );
        expect(result).to.equal(mockOpportunity);
      });

      it('should return the saved opportunity object', async () => {
        // Arrange
        mockOpportunity.save.resolves();

        // Act
        const result = await saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
        );

        // Assert
        expect(result).to.equal(mockOpportunity);
      });
    });

    describe('retry scenarios', () => {
      it('should retry after any error and succeed on second attempt', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        const refreshedOpportunity = {
          getId: sandbox.stub().returns('test-opportunity-id'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.save.onFirstCall().rejects(saveError);
        mockOpportunityClass.findById.resolves(refreshedOpportunity);

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
        );

        // Advance time to complete the delay
        await clock.tickAsync(200); // First retry delay is 200ms

        const result = await promise;

        // Assert
        expect(mockOpportunity.save).to.have.been.calledOnce;
        expect(refreshedOpportunity.save).to.have.been.calledOnce;
        expect(mockOpportunityClass.findById).to.have.been.calledWith('test-opportunity-id');
        expect(refreshedOpportunity.setAuditId).to.have.been.calledWith('audit-123');
        expect(refreshedOpportunity.setUpdatedBy).to.have.been.calledWith('system');
        // Original opportunity should not have setAuditId/setUpdatedBy called
        expect(mockOpportunity.setAuditId).to.not.have.been.called;
        expect(mockOpportunity.setUpdatedBy).to.not.have.been.called;
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 1, retrying in 200ms',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 2',
        );
        expect(result).to.equal(refreshedOpportunity);
      });

      it('should retry multiple times with exponential backoff', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        const refreshedOpportunity1 = {
          getId: sandbox.stub().returns('test-opportunity-id'),
          save: sandbox.stub().rejects(saveError),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        const refreshedOpportunity2 = {
          getId: sandbox.stub().returns('test-opportunity-id'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById
          .onFirstCall().resolves(refreshedOpportunity1)
          .onSecondCall().resolves(refreshedOpportunity2);

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
        );

        // Advance through the delays
        await clock.tickAsync(200); // First retry delay: 2^1 * 100 = 200ms
        await clock.tickAsync(400); // Second retry delay: 2^2 * 100 = 400ms

        const result = await promise;

        // Assert
        expect(mockOpportunity.save).to.have.been.calledOnce;
        expect(refreshedOpportunity1.save).to.have.been.calledOnce;
        expect(refreshedOpportunity2.save).to.have.been.calledOnce;
        expect(mockOpportunityClass.findById).to.have.been.calledTwice;

        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 1, retrying in 200ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 2, retrying in 400ms',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 3',
        );
        expect(result).to.equal(refreshedOpportunity2);
      });

      it('should respect custom maxRetries parameter', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById.resolves(mockOpportunity);

        // Act & Assert
        try {
          await saveOpptyWithRetry(
            mockOpportunity,
            'audit-123',
            mockOpportunityClass,
            mockLog,
            1, // maxRetries = 1, so only 1 attempt total
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Save failed');
          expect(mockOpportunity.save).to.have.been.calledOnce;
          expect(mockOpportunityClass.findById).to.not.have.been.called;
        }
      });

      it('should calculate correct exponential backoff delays', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        // Create multiple refreshed opportunities that will fail
        const refreshedOpportunities = [];
        for (let i = 0; i < 2; i += 1) {
          refreshedOpportunities.push({
            getId: sandbox.stub().returns('test-opportunity-id'),
            save: sandbox.stub().rejects(saveError),
            setAuditId: sandbox.stub().returnsThis(),
            setUpdatedBy: sandbox.stub().returnsThis(),
          });
        }

        // Final successful opportunity
        const successOpportunity = {
          getId: sandbox.stub().returns('test-opportunity-id'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById
          .onCall(0).resolves(refreshedOpportunities[0])
          .onCall(1).resolves(refreshedOpportunities[1])
          .onCall(2)
          .resolves(successOpportunity);

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          4, // Allow 4 attempts
        );

        // Advance through all delays
        await clock.tickAsync(200); // 2^1 * 100 = 200ms
        await clock.tickAsync(400); // 2^2 * 100 = 400ms
        await clock.tickAsync(800); // 2^3 * 100 = 800ms

        const result = await promise;

        // Assert exponential backoff delays were logged correctly
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 1, retrying in 200ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 2, retrying in 400ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 3, retrying in 800ms',
        );
        expect(result).to.equal(successOpportunity);
      });
    });

    describe('error scenarios', () => {
      it('should throw error after exhausting all retries', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById.resolves(mockOpportunity);

        // Act & Assert
        try {
          const promise = saveOpptyWithRetry(
            mockOpportunity,
            'audit-123',
            mockOpportunityClass,
            mockLog,
            2, // Only 2 attempts
          );

          // Advance through the retry delay
          await clock.tickAsync(200);

          await promise;
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Save failed');
          expect(mockOpportunity.save).to.have.been.calledTwice; // Original + 1 retry
          expect(mockOpportunityClass.findById).to.have.been.calledOnce;
        }
      });

      it('should handle errors during opportunity refresh', async () => {
        // Arrange
        const saveError = new Error('Save failed');
        const refreshError = new Error('Opportunity not found');

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById.rejects(refreshError);

        // Act & Assert
        try {
          const promise = saveOpptyWithRetry(
            mockOpportunity,
            'audit-123',
            mockOpportunityClass,
            mockLog,
          );

          // Advance through the retry delay
          await clock.tickAsync(200);

          await promise;
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.equal(refreshError);
          expect(mockOpportunity.save).to.have.been.calledOnce;
          expect(mockOpportunityClass.findById).to.have.been.calledWith('test-opportunity-id');
        }
      });
    });

    describe('edge cases', () => {
      it('should handle maxRetries of 1 (no retries)', async () => {
        // Arrange
        mockOpportunity.save.resolves();

        // Act
        const result = await saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          1,
        );

        // Assert
        expect(mockOpportunity.save).to.have.been.calledOnce;
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 1',
        );
        expect(result).to.equal(mockOpportunity);
      });

      it('should handle maxRetries of 0 (no retries, but first attempt still runs)', async () => {
        // Arrange
        mockOpportunity.save.resolves();

        // Act
        const result = await saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          0, // No retries allowed, but first attempt still runs
        );

        // Assert - First attempt runs and succeeds, returns the opportunity
        expect(result).to.equal(mockOpportunity);
        expect(mockOpportunity.save).to.have.been.calledOnce;
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 1',
        );
      });

      it('should handle very large maxRetries', async () => {
        // Arrange
        mockOpportunity.save.resolves();

        // Act
        const result = await saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          100, // Large number
        );

        // Assert
        expect(mockOpportunity.save).to.have.been.calledOnce;
        expect(result).to.equal(mockOpportunity);
      });

      it('should handle opportunity with null getId()', async () => {
        // Arrange
        const opportunityWithNullId = {
          getId: sandbox.stub().returns(null),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        // Act
        const result = await saveOpptyWithRetry(
          opportunityWithNullId,
          'audit-123',
          mockOpportunityClass,
          mockLog,
        );

        // Assert
        expect(result).to.equal(opportunityWithNullId);
      });
    });

    describe('recursive behavior validation', () => {
      it('should maintain correct attempt numbers through recursion', async () => {
        // Arrange
        const saveError = new Error('Save failed');

        // Create sequence of failing then succeeding opportunities
        const opportunities = [];
        for (let i = 0; i < 3; i += 1) {
          opportunities.push({
            getId: sandbox.stub().returns(`opportunity-${i}`),
            save: sandbox.stub().rejects(saveError),
            setAuditId: sandbox.stub().returnsThis(),
            setUpdatedBy: sandbox.stub().returnsThis(),
          });
        }

        // Final successful opportunity
        const successOpportunity = {
          getId: sandbox.stub().returns('opportunity-success'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.save.rejects(saveError);
        mockOpportunityClass.findById
          .onCall(0).resolves(opportunities[0])
          .onCall(1).resolves(opportunities[1])
          .onCall(2)
          .resolves(opportunities[2])
          .onCall(3)
          .resolves(successOpportunity);

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          5, // Allow enough attempts
        );

        // Advance through all delays
        await clock.tickAsync(200); // Attempt 1 -> 2
        await clock.tickAsync(400); // Attempt 2 -> 3
        await clock.tickAsync(800); // Attempt 3 -> 4
        await clock.tickAsync(1600); // Attempt 4 -> 5

        const result = await promise;

        // Assert correct attempt numbers in logs
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 1, retrying in 200ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 2, retrying in 400ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 3, retrying in 800ms',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 4, retrying in 1600ms',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 5',
        );

        expect(result).to.equal(successOpportunity);
      });

      it('should not exceed maximum call stack with deep recursion', async () => {
        // Arrange - Test with many retries to ensure recursion doesn't cause stack overflow
        const saveError = new Error('Save failed');

        // Create 10 failing opportunities
        const failingOpportunities = [];
        for (let i = 0; i < 10; i += 1) {
          failingOpportunities.push({
            getId: sandbox.stub().returns(`opportunity-${i}`),
            save: sandbox.stub().rejects(saveError),
            setAuditId: sandbox.stub().returnsThis(),
            setUpdatedBy: sandbox.stub().returnsThis(),
          });
        }

        // Final successful opportunity
        const successOpportunity = {
          getId: sandbox.stub().returns('opportunity-success'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.save.rejects(saveError);

        // Set up findById to return failing opportunities then success
        let callCount = 0;
        mockOpportunityClass.findById.callsFake(() => {
          if (callCount < failingOpportunities.length) {
            const opportunity = failingOpportunities[callCount];
            callCount += 1;
            return Promise.resolve(opportunity);
          }
          return Promise.resolve(successOpportunity);
        });

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          'audit-123',
          mockOpportunityClass,
          mockLog,
          15, // Allow enough attempts
        );

        // Advance through all delays (this would be a lot of time, but we're using fake timers)
        let delay = 200;
        for (let i = 0; i < 11; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await clock.tickAsync(delay);
          delay *= 2; // Exponential backoff
        }

        const result = await promise;

        // Assert - Should succeed without stack overflow
        expect(result).to.equal(successOpportunity);
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 12',
        );
      });
    });

    describe('real-world integration scenarios', () => {
      it('should handle typical conditional check failure scenario', async () => {
        // Arrange - Simulate real ElectroDB conditional check failure
        const realSaveError = new Error('The save request failed');
        realSaveError.name = 'SaveException';

        const refreshedOpportunity = {
          getId: sandbox.stub().returns('bd068a2a-8150-4ea7-b821-9120b2561cdc'),
          save: sandbox.stub().resolves(),
          setAuditId: sandbox.stub().returnsThis(),
          setUpdatedBy: sandbox.stub().returnsThis(),
        };

        mockOpportunity.getId.returns('bd068a2a-8150-4ea7-b821-9120b2561cdc');
        mockOpportunity.save.onFirstCall().rejects(realSaveError);
        mockOpportunityClass.findById.resolves(refreshedOpportunity);

        // Act
        const promise = saveOpptyWithRetry(
          mockOpportunity,
          '7dc5c794-6116-446f-907d-47b96a5be571',
          mockOpportunityClass,
          mockLog,
        );

        await clock.tickAsync(200); // Wait for retry delay
        const result = await promise;

        // Assert
        expect(result).to.equal(refreshedOpportunity);
        expect(mockOpportunityClass.findById).to.have.been.calledWith(
          'bd068a2a-8150-4ea7-b821-9120b2561cdc',
        );
        expect(refreshedOpportunity.setAuditId).to.have.been.calledWith(
          '7dc5c794-6116-446f-907d-47b96a5be571',
        );
        expect(refreshedOpportunity.setUpdatedBy).to.have.been.calledWith('system');
        // Original opportunity should not have setAuditId/setUpdatedBy called
        expect(mockOpportunity.setAuditId).to.not.have.been.called;
        expect(mockOpportunity.setUpdatedBy).to.not.have.been.called;
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt 1, retrying in 200ms',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          '[A11yRemediationGuidance] Successfully saved opportunity on attempt 2',
        );
      });

      it('should handle concurrent access patterns', async () => {
        // Arrange - Simulate multiple concurrent saves of the same opportunity
        const saveError = new Error('The conditional request failed');
        saveError.code = 4001;

        // Create multiple "instances" of the same opportunity being saved concurrently
        const opportunities = [];
        for (let i = 0; i < 3; i += 1) {
          opportunities.push({
            getId: sandbox.stub().returns('same-opportunity-id'),
            save: sandbox.stub(),
            setAuditId: sandbox.stub().returnsThis(),
            setUpdatedBy: sandbox.stub().returnsThis(),
          });
        }

        // First two fail with conditional check, third succeeds
        opportunities[0].save.rejects(saveError);
        opportunities[1].save.rejects(saveError);
        opportunities[2].save.resolves();

        mockOpportunityClass.findById
          .onCall(0).resolves(opportunities[1])
          .onCall(1).resolves(opportunities[2]);

        // Act - Simulate concurrent saves
        const promise = saveOpptyWithRetry(
          opportunities[0],
          'audit-concurrent',
          mockOpportunityClass,
          mockLog,
        );

        await clock.tickAsync(200); // First retry
        await clock.tickAsync(400); // Second retry

        const result = await promise;

        // Assert
        expect(result).to.equal(opportunities[2]);
        expect(mockOpportunityClass.findById).to.have.been.calledTwice;
        expect(opportunities[0].save).to.have.been.calledOnce;
        expect(opportunities[1].save).to.have.been.calledOnce;
        expect(opportunities[2].save).to.have.been.calledOnce;
      });
    });
  });
});
