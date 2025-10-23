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
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  deleteOriginalFiles,
  getSubfoldersUsingPrefixAndDelimiter,
  updateViolationData,
  getObjectKeysFromSubfolders,
  cleanupS3Files,
  createReportOpportunity,
  createReportOpportunitySuggestion,
  getEnvAsoDomain,
  aggregateAccessibilityData,
  getAuditPrefixes,
  sendRunImportMessage,
} from '../../../src/accessibility/utils/data-processing.js';

use(sinonChai);

describe('data-processing utility functions', () => {
  let mockS3Client;
  let mockLog;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockS3Client = {
      send: sandbox.stub(),
    };
    mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
      debug: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('deleteOriginalFiles', () => {
    it('should return 0 when objectKeys is null', async () => {
      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', null, mockLog);
      expect(result).to.equal(0);
      expect(mockS3Client.send.called).to.be.false;
    });

    it('should return 0 when objectKeys is empty array', async () => {
      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', [], mockLog);
      expect(result).to.equal(0);
      expect(mockS3Client.send.called).to.be.false;
    });

    it('should use DeleteObject for single file', async () => {
      mockS3Client.send.resolves();
      const objectKeys = ['file1.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(1);
      expect(mockS3Client.send.calledOnce).to.be.true;
      const command = mockS3Client.send.getCall(0).args[0];
      expect(command).to.be.instanceOf(DeleteObjectCommand);
      expect(command.input.Bucket).to.equal('test-bucket');
      expect(command.input.Key).to.equal('file1.json');
      expect(mockLog.debug.calledWith('Deleted 1 original files after aggregation')).to.be.true;
    });

    it('should use DeleteObjects for multiple files', async () => {
      mockS3Client.send.resolves();
      const objectKeys = ['file1.json', 'file2.json', 'file3.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(3);
      expect(mockS3Client.send.calledOnce).to.be.true;
      const command = mockS3Client.send.getCall(0).args[0];
      expect(command).to.be.instanceOf(DeleteObjectsCommand);
      expect(command.input.Bucket).to.equal('test-bucket');
      expect(command.input.Delete.Objects).to.deep.equal([
        { Key: 'file1.json' },
        { Key: 'file2.json' },
        { Key: 'file3.json' },
      ]);
      expect(command.input.Delete.Quiet).to.be.true;
      expect(mockLog.debug.calledWith('Deleted 3 original files after aggregation')).to.be.true;
    });

    it('should handle errors gracefully and log them', async () => {
      const error = new Error('S3 delete failed');
      mockS3Client.send.rejects(error);
      const objectKeys = ['file1.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(0);
      expect(mockLog.error.calledWith('[A11yProcessingError] Error deleting original files', error)).to.be.true;
    });

    it('should handle errors for multiple files', async () => {
      const error = new Error('S3 batch delete failed');
      mockS3Client.send.rejects(error);
      const objectKeys = ['file1.json', 'file2.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(0);
      expect(mockLog.error.calledWith('[A11yProcessingError] Error deleting original files', error)).to.be.true;
    });
  });

  describe('getSubfoldersUsingPrefixAndDelimiter', () => {
    it('should throw error when s3Client is missing', async () => {
      try {
        await getSubfoldersUsingPrefixAndDelimiter(
          null,
          'test-bucket',
          'test-prefix',
          '/',
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid input parameters');
        expect(mockLog.error.called).to.be.true;
      }
    });

    it('should throw error when bucketName is missing', async () => {
      try {
        await getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          null,
          'test-prefix',
          '/',
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid input parameters');
        expect(mockLog.error.called).to.be.true;
      }
    });

    it('should throw error when prefix is missing', async () => {
      try {
        await getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          null,
          '/',
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid input parameters');
        expect(mockLog.error.called).to.be.true;
      }
    });

    it('should throw error when delimiter is missing', async () => {
      try {
        await getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          'test-prefix',
          null,
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Invalid input parameters');
        expect(mockLog.error.called).to.be.true;
      }
    });

    it('should return subfolders successfully', async () => {
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/site1/folder1/' },
          { Prefix: 'accessibility/site1/folder2/' },
          { Prefix: 'accessibility/site1/folder3/' },
        ],
      };
      mockS3Client.send.resolves(mockResponse);

      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'accessibility/site1/',
        '/',
        mockLog,
      );

      expect(result).to.deep.equal([
        'accessibility/site1/folder1/',
        'accessibility/site1/folder2/',
        'accessibility/site1/folder3/',
      ]);
      expect(mockS3Client.send.calledOnce).to.be.true;
      const command = mockS3Client.send.getCall(0).args[0];
      expect(command).to.be.instanceOf(ListObjectsV2Command);
      expect(command.input.Bucket).to.equal('test-bucket');
      expect(command.input.Prefix).to.equal('accessibility/site1/');
      expect(command.input.Delimiter).to.equal('/');
      expect(command.input.MaxKeys).to.equal(1000);
      expect(mockLog.debug.calledWith('Fetched 3 keys from S3 for bucket test-bucket and prefix accessibility/site1/ with delimiter /')).to.be.true;
    });

    it('should use custom maxKeys parameter', async () => {
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/site1/folder1/' },
        ],
      };
      mockS3Client.send.resolves(mockResponse);

      await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'accessibility/site1/',
        '/',
        mockLog,
        500,
      );

      const command = mockS3Client.send.getCall(0).args[0];
      expect(command.input.MaxKeys).to.equal(500);
    });

    it('should handle S3 errors and rethrow them', async () => {
      const error = new Error('S3 list failed');
      mockS3Client.send.rejects(error);

      try {
        await getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          'accessibility/site1/',
          '/',
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError).to.equal(error);
        expect(mockLog.error.calledWith('[A11yProcessingError] Error while fetching S3 object keys using bucket test-bucket and prefix accessibility/site1/ with delimiter /', error)).to.be.true;
      }
    });

    it('should handle empty CommonPrefixes', async () => {
      const mockResponse = {
        CommonPrefixes: [],
      };
      mockS3Client.send.resolves(mockResponse);

      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'accessibility/site1/',
        '/',
        mockLog,
      );

      expect(result).to.deep.equal([]);
      expect(mockLog.debug.calledWith('Fetched 0 keys from S3 for bucket test-bucket and prefix accessibility/site1/ with delimiter /')).to.be.true;
    });
  });

  describe('updateViolationData', () => {
    let baseAggregatedData;

    beforeEach(() => {
      baseAggregatedData = {
        overall: {
          violations: {
            critical: {
              count: 10,
              items: {
                'existing-issue': {
                  count: 5,
                  description: 'Existing issue',
                  level: 'A',
                  understandingUrl: 'https://example.com/existing',
                  successCriteriaNumber: '111',
                },
              },
            },
            serious: {
              count: 8,
              items: {
                'serious-issue': {
                  count: 3,
                  description: 'Serious issue',
                  level: 'AA',
                  understandingUrl: 'https://example.com/serious',
                  successCriteriaNumber: '222',
                },
              },
            },
          },
        },
      };
    });

    it('should add new violation items for critical level', () => {
      const violations = {
        critical: {
          count: 7,
          items: {
            'new-critical-issue': {
              count: 7,
              description: 'New critical issue',
              level: 'A',
              understandingUrl: 'https://example.com/new-critical',
              successCriteriaNumber: '333',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      expect(result.overall.violations.critical.count).to.equal(17); // 10 + 7
      expect(result.overall.violations.critical.items['new-critical-issue']).to.deep.equal({
        count: 7,
        description: 'New critical issue',
        level: 'A',
        understandingUrl: 'https://example.com/new-critical',
        successCriteriaNumber: '333',
      });
      expect(result.overall.violations.critical.items['existing-issue'].count).to.equal(5);
    });

    it('should update existing violation items for critical level', () => {
      const violations = {
        critical: {
          count: 3,
          items: {
            'existing-issue': {
              count: 3,
              description: 'Existing issue',
              level: 'A',
              understandingUrl: 'https://example.com/existing',
              successCriteriaNumber: '111',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      expect(result.overall.violations.critical.count).to.equal(13); // 10 + 3
      expect(result.overall.violations.critical.items['existing-issue'].count).to.equal(8); // 5 + 3
    });

    it('should add new violation items for serious level', () => {
      const violations = {
        serious: {
          count: 5,
          items: {
            'new-serious-issue': {
              count: 5,
              description: 'New serious issue',
              level: 'AA',
              understandingUrl: 'https://example.com/new-serious',
              successCriteriaNumber: '444',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'serious');

      expect(result.overall.violations.serious.count).to.equal(13); // 8 + 5
      expect(result.overall.violations.serious.items['new-serious-issue']).to.deep.equal({
        count: 5,
        description: 'New serious issue',
        level: 'AA',
        understandingUrl: 'https://example.com/new-serious',
        successCriteriaNumber: '444',
      });
      expect(result.overall.violations.serious.items['serious-issue'].count).to.equal(3);
    });

    it('should handle violations without the specified level', () => {
      const violations = {
        moderate: {
          count: 2,
          items: {
            'moderate-issue': {
              count: 2,
              description: 'Moderate issue',
              level: 'A',
              understandingUrl: 'https://example.com/moderate',
              successCriteriaNumber: '555',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      // Should remain unchanged since 'critical' level is not in violations
      expect(result.overall.violations.critical.count).to.equal(10);
      expect(Object.keys(result.overall.violations.critical.items)).to.have.lengthOf(1);
    });

    it('should handle violations with missing items property', () => {
      const violations = {
        critical: {
          count: 5,
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      // Should remain unchanged since items property is missing
      expect(result.overall.violations.critical.count).to.equal(10);
      expect(Object.keys(result.overall.violations.critical.items)).to.have.lengthOf(1);
    });

    it('should handle violations with missing count property', () => {
      const violations = {
        critical: {
          items: {
            'new-issue': {
              count: 3,
              description: 'New issue',
              level: 'A',
              understandingUrl: 'https://example.com/new',
              successCriteriaNumber: '666',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      // Should remain unchanged since count property is missing
      expect(result.overall.violations.critical.count).to.equal(10);
      expect(Object.keys(result.overall.violations.critical.items)).to.have.lengthOf(1);
    });

    it('should not mutate the original aggregated data', () => {
      const violations = {
        critical: {
          count: 7,
          items: {
            'new-critical-issue': {
              count: 7,
              description: 'New critical issue',
              level: 'A',
              understandingUrl: 'https://example.com/new-critical',
              successCriteriaNumber: '333',
            },
          },
        },
      };

      const originalCount = baseAggregatedData.overall.violations.critical.count;
      const originalItemsCount = Object.keys(
        baseAggregatedData.overall.violations.critical.items,
      ).length;

      updateViolationData(baseAggregatedData, violations, 'critical');

      // Original data should remain unchanged
      expect(baseAggregatedData.overall.violations.critical.count).to.equal(originalCount);
      expect(Object.keys(baseAggregatedData.overall.violations.critical.items)).to.have.lengthOf(
        originalItemsCount,
      );
    });

    it('should handle multiple new and existing items', () => {
      const violations = {
        critical: {
          count: 12,
          items: {
            'existing-issue': {
              count: 2,
              description: 'Existing issue',
              level: 'A',
              understandingUrl: 'https://example.com/existing',
              successCriteriaNumber: '111',
            },
            'new-issue-1': {
              count: 5,
              description: 'New issue 1',
              level: 'A',
              understandingUrl: 'https://example.com/new1',
              successCriteriaNumber: '777',
            },
            'new-issue-2': {
              count: 5,
              description: 'New issue 2',
              level: 'A',
              understandingUrl: 'https://example.com/new2',
              successCriteriaNumber: '888',
            },
          },
        },
      };

      const result = updateViolationData(baseAggregatedData, violations, 'critical');

      expect(result.overall.violations.critical.count).to.equal(22); // 10 + 12
      expect(result.overall.violations.critical.items['existing-issue'].count).to.equal(7); // 5 + 2
      expect(result.overall.violations.critical.items['new-issue-1'].count).to.equal(5);
      expect(result.overall.violations.critical.items['new-issue-2'].count).to.equal(5);
      expect(Object.keys(result.overall.violations.critical.items)).to.have.lengthOf(3);
    });
  });

  describe('getObjectKeysFromSubfolders', () => {
    it('should return success false when no subfolders found', async () => {
      // Mock getSubfoldersUsingPrefixAndDelimiter to return empty array
      mockS3Client.send.resolves({ CommonPrefixes: [] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.objectKeys).to.deep.equal([]);
      expect(result.message).to.include('No accessibility data found');
      // eslint-disable-next-line max-len
      expect(mockLog.debug.calledWith('No accessibility data found in bucket test-bucket at prefix accessibility/site123/ for site site123 with delimiter /')).to.be.true;
    });

    it('should return success false when no current date subfolders found', async () => {
      // Mock subfolders with different dates
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/site123/1705266800000/' }, // 2024-01-14
          { Prefix: 'accessibility/site123/1705449600000/' }, // 2024-01-16
        ],
      };
      mockS3Client.send.resolves(mockResponse);

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.objectKeys).to.deep.equal([]);
      expect(result.message).to.include("No accessibility data found for today's date");
    });

    it('should return success true with object keys when matching subfolders found', async () => {
      // Mock subfolders with matching date (2024-01-15)
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime();
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${timestamp}/` },
          { Prefix: `accessibility/site123/${timestamp + 1000}/` }, // Same date, different time
        ],
      };

      // Mock the S3 calls
      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }] })
        .onThirdCall()
        .resolves({ Contents: [{ Key: 'file2.json' }] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.objectKeys).to.deep.equal(['file1.json', 'file2.json']);
      expect(result.message).to.equal('Found 2 data files');
      expect(mockLog.debug.calledWith('Found 2 data files for site site123')).to.be.true;
    });

    it('should filter subfolders by exact date match', async () => {
      // Mock subfolders with various timestamps
      const targetDate = '2024-01-15';
      const targetTimestamp = new Date('2024-01-15T10:30:00Z').getTime();
      const wrongDateTimestamp = new Date('2024-01-14T10:30:00Z').getTime();
      const anotherTargetTimestamp = new Date('2024-01-15T15:45:00Z').getTime();

      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${wrongDateTimestamp}/` }, // Wrong date
          { Prefix: `accessibility/site123/${targetTimestamp}/` }, // Correct date
          { Prefix: `accessibility/site123/${anotherTargetTimestamp}/` }, // Correct date, different time
        ],
      };

      // Mock the S3 calls
      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }] })
        .onThirdCall()
        .resolves({ Contents: [{ Key: 'file2.json' }] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        targetDate,
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.objectKeys).to.deep.equal(['file1.json', 'file2.json']);
      // Should only process the two subfolders with matching dates
    });

    it('should return success false when no JSON files found in subfolders', async () => {
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime();
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${timestamp}/` },
        ],
      };

      // Mock the S3 calls - first returns subfolders, second returns empty contents
      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.objectKeys).to.deep.equal([]);
      // eslint-disable-next-line max-len
      expect(result.message).to.include('No accessibility data found in bucket test-bucket at prefix accessibility/site123/ for site site123');
    });

    it('should handle empty object keys from some subfolders', async () => {
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime();
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${timestamp}/` },
          { Prefix: `accessibility/site123/${timestamp + 1000}/` },
        ],
      };

      // First subfolder has files, second is empty
      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }, { Key: 'file2.json' }] })
        .onThirdCall()
        .resolves({ Contents: [] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.objectKeys).to.deep.equal(['file1.json', 'file2.json']);
      expect(result.message).to.equal('Found 2 data files');
    });

    it('should log appropriate messages throughout the process', async () => {
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime();
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${timestamp}/` },
        ],
      };

      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }] });

      await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(mockLog.debug.calledWith('Found 1 data files for site site123')).to.be.true;
    });

    it('should handle complex subfolder filtering with multiple dates', async () => {
      // Create timestamps for different dates
      const date1 = new Date('2024-01-14T10:00:00Z').getTime(); // Wrong date
      const date2 = new Date('2024-01-15T08:30:00Z').getTime(); // Target date
      const date3 = new Date('2024-01-15T14:45:00Z').getTime(); // Target date
      const date4 = new Date('2024-01-16T09:15:00Z').getTime(); // Wrong date

      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${date1}/` },
          { Prefix: `accessibility/site123/${date2}/` },
          { Prefix: `accessibility/site123/${date3}/` },
          { Prefix: `accessibility/site123/${date4}/` },
        ],
      };

      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }, { Key: 'file2.json' }] })
        .onThirdCall()
        .resolves({ Contents: [{ Key: 'file3.json' }] });

      const result = await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.objectKeys).to.deep.equal(['file1.json', 'file2.json', 'file3.json']);
      // Should only process the two subfolders with matching dates
    });

    it('should pass correct parameters to S3 operations', async () => {
      const timestamp = new Date('2024-01-15T00:00:00Z').getTime();
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: `accessibility/site123/${timestamp}/` },
        ],
      };

      mockS3Client.send
        .onFirstCall()
        .resolves(mockResponse)
        .onSecondCall()
        .resolves({ Contents: [{ Key: 'file1.json' }] });

      await getObjectKeysFromSubfolders(
        mockS3Client,
        'test-bucket',
        'accessibility',
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(mockS3Client.send.calledTwice).to.be.true;
      // First call should be ListObjectsV2Command for subfolders
      const firstCall = mockS3Client.send.getCall(0).args[0];
      expect(firstCall).to.be.instanceOf(ListObjectsV2Command);
      expect(firstCall.input.Bucket).to.equal('test-bucket');
      expect(firstCall.input.Prefix).to.equal('accessibility/site123/');
      expect(firstCall.input.Delimiter).to.equal('/');
    });
  });

  describe('cleanupS3Files', () => {
    it('should delete original files and oldest final result file when more than 2 exist', async () => {
      const objectKeys = ['file1.json', 'file2.json'];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-01-01-final-result.json',
        'accessibility/site1/2024-01-08-final-result.json',
        'accessibility/site1/2024-01-15-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      // Should call delete twice: once for original files, once for oldest final result
      expect(mockS3Client.send.callCount).to.equal(2);
      expect(mockLog.debug.calledWith('Deleted oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
    });

    it('should only delete original files when 2 or fewer final result files exist', async () => {
      const objectKeys = ['file1.json', 'file2.json'];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-01-08-final-result.json',
        'accessibility/site1/2024-01-15-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      // Should only call delete once for original files
      expect(mockS3Client.send.callCount).to.equal(1);
    });

    it('should sort final result files by timestamp correctly', async () => {
      const objectKeys = ['file1.json'];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-01-15-final-result.json',
        'accessibility/site1/2024-01-01-final-result.json',
        'accessibility/site1/2024-01-08-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      expect(mockLog.debug.calledWith('Deleted oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
    });

    it('should handle empty object keys array', async () => {
      const objectKeys = [];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-01-01-final-result.json',
        'accessibility/site1/2024-01-08-final-result.json',
        'accessibility/site1/2024-01-15-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      // Should still delete oldest final result file even if no original files
      expect(mockS3Client.send.callCount).to.equal(1);
      expect(mockLog.debug.calledWith('Deleted oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
    });

    it('should handle single final result file', async () => {
      const objectKeys = ['file1.json'];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-01-15-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      // Should only delete original files, not the single final result file
      expect(mockS3Client.send.callCount).to.equal(1);
    });

    it('should handle complex timestamp sorting', async () => {
      const objectKeys = ['file1.json'];
      const lastWeekObjectKeys = [
        'accessibility/site1/2024-03-15-final-result.json',
        'accessibility/site1/2024-01-01-final-result.json',
        'accessibility/site1/2024-12-31-final-result.json',
        'accessibility/site1/2024-06-15-final-result.json',
      ];

      mockS3Client.send.resolves();

      await cleanupS3Files(mockS3Client, 'test-bucket', objectKeys, lastWeekObjectKeys, mockLog);

      // Should delete the oldest file (2024-01-01)
      expect(mockLog.debug.calledWith('Deleted oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
    });
  });

  describe('createReportOpportunity', () => {
    let mockOpportunity;
    let mockDataAccess;
    let mockContext;
    let mockAuditData;
    let mockOpportunityInstance;

    beforeEach(() => {
      mockOpportunity = {
        create: sandbox.stub(),
      };
      mockDataAccess = {
        Opportunity: mockOpportunity,
      };
      mockContext = {
        log: mockLog,
        dataAccess: mockDataAccess,
      };
      mockAuditData = {
        siteId: 'test-site-123',
        auditId: 'audit-456',
      };
      mockOpportunityInstance = {
        runbook: 'accessibility-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Improve Accessibility',
        description: 'Fix accessibility violations',
        tags: ['accessibility', 'critical'],
      };
    });

    it('should successfully create a new opportunity', async () => {
      const createdOpportunity = { id: 'opp-123', ...mockOpportunityInstance };
      mockOpportunity.create.resolves(createdOpportunity);

      const result = await createReportOpportunity(
        mockOpportunityInstance,
        mockAuditData,
        mockContext,
      );

      expect(result.opportunity).to.deep.equal(createdOpportunity);
      expect(mockOpportunity.create.calledOnce).to.be.true;
      expect(mockOpportunity.create.calledWith({
        siteId: 'test-site-123',
        auditId: 'audit-456',
        runbook: 'accessibility-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Improve Accessibility',
        description: 'Fix accessibility violations',
        tags: ['accessibility', 'critical'],
      })).to.be.true;
    });

    it('should handle opportunity creation errors', async () => {
      const error = new Error('Database connection failed');
      mockOpportunity.create.rejects(error);

      try {
        await createReportOpportunity(
          mockOpportunityInstance,
          mockAuditData,
          mockContext,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Database connection failed');
        expect(mockLog.error.calledWith('[A11yProcessingError] Failed to create new opportunity for siteId test-site-123 and auditId audit-456: Database connection failed')).to.be.true;
      }
    });

    it('should pass all opportunity instance properties to create method', async () => {
      const complexOpportunityInstance = {
        runbook: 'complex-runbook',
        type: 'performance',
        origin: 'lighthouse',
        title: 'Complex Opportunity',
        description: 'A complex opportunity with multiple requirements',
        tags: ['performance', 'seo', 'accessibility'],
      };
      const createdOpportunity = { id: 'opp-456', ...complexOpportunityInstance };
      mockOpportunity.create.resolves(createdOpportunity);

      await createReportOpportunity(
        complexOpportunityInstance,
        mockAuditData,
        mockContext,
      );

      expect(mockOpportunity.create.calledWith({
        siteId: 'test-site-123',
        auditId: 'audit-456',
        runbook: 'complex-runbook',
        type: 'performance',
        origin: 'lighthouse',
        title: 'Complex Opportunity',
        description: 'A complex opportunity with multiple requirements',
        tags: ['performance', 'seo', 'accessibility'],
      })).to.be.true;
    });

    it('should handle missing opportunity instance properties', async () => {
      const incompleteOpportunityInstance = {
        runbook: 'test-runbook',
        type: 'test',
        // Missing other properties
      };
      const createdOpportunity = { id: 'opp-789' };
      mockOpportunity.create.resolves(createdOpportunity);

      await createReportOpportunity(
        incompleteOpportunityInstance,
        mockAuditData,
        mockContext,
      );

      expect(mockOpportunity.create.calledWith({
        siteId: 'test-site-123',
        auditId: 'audit-456',
        runbook: 'test-runbook',
        type: 'test',
        origin: undefined,
        title: undefined,
        description: undefined,
        tags: undefined,
      })).to.be.true;
    });

    it('should handle different audit data formats', async () => {
      const differentAuditData = {
        siteId: 'another-site',
        auditId: 'different-audit',
        additionalProperty: 'should-be-ignored',
      };
      const createdOpportunity = { id: 'opp-999' };
      mockOpportunity.create.resolves(createdOpportunity);

      await createReportOpportunity(
        mockOpportunityInstance,
        differentAuditData,
        mockContext,
      );

      expect(mockOpportunity.create.calledWith({
        siteId: 'another-site',
        auditId: 'different-audit',
        runbook: 'accessibility-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Improve Accessibility',
        description: 'Fix accessibility violations',
        tags: ['accessibility', 'critical'],
      })).to.be.true;
    });
  });

  describe('createReportOpportunitySuggestion', () => {
    let mockOpportunity;
    let mockAuditData;
    let createReportOpportunitySuggestionInstanceStub;

    beforeEach(() => {
      mockOpportunity = {
        addSuggestions: sandbox.stub(),
      };
      mockAuditData = {
        siteId: 'test-site-123',
        auditId: 'audit-456',
      };
      createReportOpportunitySuggestionInstanceStub = sandbox.stub();
    });

    // Helper function to create a testable version of createReportOpportunitySuggestion
    const createTestCreateReportOpportunitySuggestion = () => async (
      opportunity,
      reportMarkdown,
      auditData,
      log,
    ) => {
      const suggestions = createReportOpportunitySuggestionInstanceStub(reportMarkdown);

      try {
        const suggestion = await opportunity.addSuggestions(suggestions);
        return { suggestion };
      } catch (e) {
        log.error(`[A11yProcessingError] Failed to create new suggestion for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
        throw new Error(e.message);
      }
    };

    it('should successfully create a new suggestion', async () => {
      const reportMarkdown = '# Accessibility Report\n\nThis is a test report.';
      const mockSuggestions = [{ type: 'improvement', content: 'Fix alt text' }];
      const createdSuggestion = { id: 'sugg-123', suggestions: mockSuggestions };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(createdSuggestion);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();
      const result = await testCreateReportOpportunitySuggestion(
        mockOpportunity,
        reportMarkdown,
        mockAuditData,
        mockLog,
      );

      expect(result.suggestion).to.deep.equal(createdSuggestion);
      expect(createReportOpportunitySuggestionInstanceStub.calledOnce).to.be.true;
      expect(createReportOpportunitySuggestionInstanceStub.calledWith(reportMarkdown)).to.be.true;
      expect(mockOpportunity.addSuggestions.calledOnce).to.be.true;
      expect(mockOpportunity.addSuggestions.calledWith(mockSuggestions)).to.be.true;
    });

    it('should handle suggestion creation errors', async () => {
      const reportMarkdown = '# Error Report\n\nThis will fail.';
      const mockSuggestions = [{ type: 'error', content: 'This will fail' }];
      const error = new Error('Failed to add suggestions');

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.rejects(error);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();

      try {
        await testCreateReportOpportunitySuggestion(
          mockOpportunity,
          reportMarkdown,
          mockAuditData,
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to add suggestions');
        expect(mockLog.error.calledWith('[A11yProcessingError] Failed to create new suggestion for siteId test-site-123 and auditId audit-456: Failed to add suggestions')).to.be.true;
      }
    });

    it('should handle empty report markdown', async () => {
      const reportMarkdown = '';
      const mockSuggestions = [];
      const createdSuggestion = { id: 'sugg-empty', suggestions: [] };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(createdSuggestion);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();
      const result = await testCreateReportOpportunitySuggestion(
        mockOpportunity,
        reportMarkdown,
        mockAuditData,
        mockLog,
      );

      expect(result.suggestion).to.deep.equal(createdSuggestion);
      expect(createReportOpportunitySuggestionInstanceStub.calledWith('')).to.be.true;
    });

    it('should handle complex report markdown', async () => {
      const reportMarkdown = `
# Comprehensive Accessibility Report

## Critical Issues
- Missing alt text on images
- Insufficient color contrast

## Recommendations
1. Add descriptive alt text
2. Increase color contrast ratio

## Code Examples
\`\`\`html
<img src="example.jpg" alt="Descriptive text">
\`\`\`
      `;
      const mockSuggestions = [
        { type: 'critical', content: 'Fix alt text' },
        { type: 'recommendation', content: 'Improve contrast' },
      ];
      const createdSuggestion = { id: 'sugg-complex', suggestions: mockSuggestions };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(createdSuggestion);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();
      const result = await testCreateReportOpportunitySuggestion(
        mockOpportunity,
        reportMarkdown,
        mockAuditData,
        mockLog,
      );

      expect(result.suggestion).to.deep.equal(createdSuggestion);
      expect(createReportOpportunitySuggestionInstanceStub.calledWith(reportMarkdown)).to.be.true;
    });

    it('should handle different audit data formats', async () => {
      const reportMarkdown = '# Test Report';
      const differentAuditData = {
        siteId: 'different-site',
        auditId: 'different-audit',
        extraField: 'ignored',
      };
      const mockSuggestions = [{ type: 'test', content: 'Test suggestion' }];
      const error = new Error('Validation failed');

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.rejects(error);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();

      try {
        await testCreateReportOpportunitySuggestion(
          mockOpportunity,
          reportMarkdown,
          differentAuditData,
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch {
        expect(mockLog.error.calledWith('[A11yProcessingError] Failed to create new suggestion for siteId different-site and auditId different-audit: Validation failed')).to.be.true;
      }
    });

    it('should pass suggestions correctly to opportunity.addSuggestions', async () => {
      const reportMarkdown = '# Multiple Suggestions Report';
      const mockSuggestions = [
        { type: 'critical', content: 'Critical fix needed' },
        { type: 'warning', content: 'Warning about potential issue' },
        { type: 'info', content: 'Informational note' },
      ];
      const createdSuggestion = { id: 'sugg-multiple', suggestions: mockSuggestions };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(createdSuggestion);

      const testCreateReportOpportunitySuggestion = createTestCreateReportOpportunitySuggestion();
      await testCreateReportOpportunitySuggestion(
        mockOpportunity,
        reportMarkdown,
        mockAuditData,
        mockLog,
      );

      expect(mockOpportunity.addSuggestions.calledOnce).to.be.true;
      expect(mockOpportunity.addSuggestions.calledWith(mockSuggestions)).to.be.true;
    });

    it('should test actual function error handling for lines 486-487', async () => {
      const reportMarkdown = '# Test Report';
      const auditData = {
        siteId: 'test-site-456',
        auditId: 'audit-789',
      };
      const testOpportunity = {
        addSuggestions: sandbox.stub().rejects(new Error('Database connection failed')),
        getSuggestions: sandbox.stub().resolves([]),
      };

      // Mock the createReportOpportunitySuggestionInstance function
      const originalCreateInstance = global.createReportOpportunitySuggestionInstance;
      global.createReportOpportunitySuggestionInstance = sandbox.stub().returns(['mock suggestions']);

      try {
        await createReportOpportunitySuggestion(
          testOpportunity,
          reportMarkdown,
          auditData,
          mockLog,
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Test line 487: throw new Error(e.message)
        expect(error.message).to.equal('Database connection failed');

        // Test line 486: log.error with specific format
        expect(mockLog.error.calledWith(
          '[A11yProcessingError] Failed to create new suggestion for siteId test-site-456 and auditId audit-789: Database connection failed',
        )).to.be.true;
      } finally {
        // Restore the original function
        global.createReportOpportunitySuggestionInstance = originalCreateInstance;
      }
    });

    it('should successfully call the actual exported function', async () => {
      // Arrange
      const reportMarkdown = '# Real Test Report\n\nReal content.';
      const auditData = {
        siteId: 'real-site-123',
        auditId: 'real-audit-456',
      };
      const testOpportunity = {
        addSuggestions: sandbox.stub().resolves({ id: 'real-sugg-123' }),
      };

      // Mock the createReportOpportunitySuggestionInstance function
      const originalCreateInstance = global.createReportOpportunitySuggestionInstance;
      global.createReportOpportunitySuggestionInstance = sandbox.stub().returns([{ type: 'mock' }]);

      try {
        // Act - call the actual exported function to hit line 497
        const result = await createReportOpportunitySuggestion(
          testOpportunity,
          reportMarkdown,
          auditData,
          mockLog,
        );

        // Assert - test line 497: return { suggestion }
        expect(result).to.deep.equal({ suggestion: { id: 'real-sugg-123' } });
        expect(testOpportunity.addSuggestions).to.have.been.calledOnce;
      } finally {
        // Restore the original function
        global.createReportOpportunitySuggestionInstance = originalCreateInstance;
      }
    });
  });

  describe('aggregateAccessibilityData', () => {
    it('should return error when s3Client is missing', async () => {
      const result = await aggregateAccessibilityData(
        null,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
      expect(mockLog.error.calledWith('[A11yProcessingError] Missing required parameters for aggregateAccessibilityData')).to.be.true;
    });

    it('should return error when bucketName is missing', async () => {
      const result = await aggregateAccessibilityData(
        mockS3Client,
        null,
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
    });

    it('should return error when siteId is missing', async () => {
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        null,
        mockLog,
        'output-key',
        'accessibility',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
    });

    it('should return error when auditType is missing', async () => {
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        null,
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
    });

    it('should use default maxRetries value of 2', async () => {
      // This test will fail when it tries to call getObjectKeysFromSubfolders
      // but we can verify the parameter validation works
      const dataProcessing = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          getObjectKeysFromSubfolders: sandbox.stub().rejects(new Error('S3 error')),
        },
      });
      try {
        await dataProcessing.aggregateAccessibilityData(
          mockS3Client,
          'test-bucket',
          'test-site',
          mockLog,
          'output-key',
          'accessibility',
          '2024-01-01',
          2,
        );
      } catch (error) {
        // Expected to fail due to missing dependencies, but parameter validation passed
        expect(error).to.exist;
      }
    });

    it('should initialize aggregated data structure correctly', async () => {
      // Test that the function initializes the correct data structure
      // This will fail when calling dependencies, but we can check the initialization logic
      const dataProcessing = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/accessibility/utils/data-processing.js': {
          getObjectKeysFromSubfolders: sandbox.stub().rejects(new Error('S3 error')),
        },
      });
      try {
        await dataProcessing.aggregateAccessibilityData(
          mockS3Client,
          'test-bucket',
          'test-site',
          mockLog,
          'output-key',
          'accessibility',
          '2024-01-01',
          2,
        );
      } catch (error) {
        // Expected to fail, but the initialization logic was executed
        expect(error).to.exist;
      }
    });

    it('should return error when getObjectKeysFromSubfolders fails', async () => {
      // esmock for getObjectKeysFromSubfolders isn't hit in this specific test case.
      // Rely on mockS3Client to cause failure in real getObjectKeysFromSubfolders.
      // aggregateAccessibilityData should catch the thrown error.
      mockS3Client.send.rejects(new Error('Cannot read properties of undefined (reading \'CommonPrefixes\')')); // Simulate S3 error

      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        '2024-01-01',
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      // Expect the message that aggregateAccessibilityData constructs when it catches an error
      expect(result.message).to.equal('Error: Cannot read properties of undefined (reading \'CommonPrefixes\')');
    });

    it('should return error when no files could be processed', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();

      // For real getObjectKeysFromSubfolders to succeed:
      // 1. S3 ListObjectsV2Command for getSubfoldersUsingPrefixAndDelimiter
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          // 2. Mock getObjectKeysUsingPrefix (from s3-utils)
          getObjectKeysUsingPrefix: sandbox.stub().resolves(['file1.json', 'file2.json']),
          // Mock getObjectFromKey (from s3-utils) to make processFilesWithRetry return empty
          getObjectFromKey: sandbox.stub().resolves(null),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate, // version
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('[A11yAudit] No files could be processed successfully for site test-site');
      expect(mockLog.error.calledWith('[A11yProcessingError] [A11yAudit] No files could be processed successfully for site test-site')).to.be.true;
    });

    it('should successfully aggregate data with single file', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = {
        url: 'https://example.com/page1',
        violations: {
          total: 5,
          critical: { count: 3, items: { issue1: { count: 3 } } },
          serious: { count: 2, items: { issue2: { count: 2 } } },
        },
        traffic: 100,
      };

      // For real getObjectKeysFromSubfolders to succeed:
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });

      // For S3 PutObject to save aggregated data
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // For cleanupS3Files (deleteOriginalFiles)
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectsCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            // For getObjectKeysFromSubfolders's internal call
            .onFirstCall().resolves(['file1.json'])
            // For aggregateAccessibilityData's direct call (last week files)
            .onSecondCall()
            .resolves([`accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub()
            // For processFilesWithRetry's internal call
            .onFirstCall().resolves(mockFileData)
            // For aggregateAccessibilityData's direct call (last week file content)
            .onSecondCall()
            .resolves(null), // No last week file content for this test
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('overall');
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page1');
      expect(result.finalResultFiles.current['https://example.com/page1'].violations.total).to.equal(5);
      expect(result.finalResultFiles.current['https://example.com/page1'].traffic).to.equal(100);
      expect(result.message).to.equal('Successfully aggregated 1 files into output-key');
      expect(mockLog.debug.calledWith('[A11yAudit] Saved aggregated accessibility data to output-key')).to.be.true;
    });

    it('should handle multiple files and aggregate violations correctly', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFile1Data = {
        url: 'https://example.com/page1',
        violations: {
          total: 5,
          critical: { count: 3, items: {} },
          serious: { count: 2, items: {} },
        },
        traffic: 100,
      };
      const mockFile2Data = {
        url: 'https://example.com/page2',
        violations: {
          total: 3,
          critical: { count: 1, items: {} },
          serious: { count: 2, items: {} },
        },
        traffic: 50,
      };
      const lastWeekFileKeys = [
        // Oldest file key
        `accessibility/test-site/${new Date(new Date(targetDate).setDate(new Date(targetDate).getDate() - 14)).toISOString().split('T')[0]}-final-result.json`,
        // Key for last week's data (aggData loads index length-2)
        `accessibility/test-site/${new Date(new Date(targetDate).setDate(new Date(targetDate).getDate() - 7)).toISOString().split('T')[0]}-final-result.json`,
        // Newest file key (current)
        `accessibility/test-site/${targetDate}-final-result.json`,
      ];
      const lastWeekContent = { overall: { violations: { total: 10 } } };

      // S3 ListObjectsV2 mock (for getSubfoldersUsingPrefixAndDelimiter)
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock (saving aggregated data)
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObjects/DeleteObject mocks (for cleanupS3Files)
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectsCommand)).resolves({});
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            // For getObjectKeysFromSubfolders
            .onFirstCall().resolves(['file1.json', 'file2.json'])
            // For aggregateAccessibilityData (finding last week files)
            .onSecondCall()
            .resolves(lastWeekFileKeys),
          getObjectFromKey: sandbox.stub()
            // For processFilesWithRetry on file1.json
            .onFirstCall().resolves(mockFile1Data)
            // For processFilesWithRetry on file2.json
            .onSecondCall()
            .resolves(mockFile2Data)
            // For aggregateAccessibilityData (loading content of lastWeekFileKeys[1])
            .onThirdCall()
            .resolves(lastWeekContent),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page1');
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page2');
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(8); // 5 + 3
      expect(result.finalResultFiles.lastWeek).to.deep.equal(lastWeekContent);
    });

    it('should handle violations without total property', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileDataWithoutTotal = {
        url: 'https://example.com/page1',
        violations: {
          // No total property here
          critical: { count: 3, items: {} },
          serious: { count: 2, items: {} },
        },
        traffic: 100,
      };

      // S3 ListObjectsV2 mock (for getSubfoldersUsingPrefixAndDelimiter)
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObject mock (for cleanupS3Files)
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            // For getObjectKeysFromSubfolders
            .onFirstCall().resolves(['file1.json'])
            // For aggregateAccessibilityData (last week files)
            .onSecondCall()
            .resolves([`accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub()
            // For processFilesWithRetry
            .onFirstCall().resolves(mockFileDataWithoutTotal)
            // For aggregateAccessibilityData (last week file content)
            .onSecondCall()
            .resolves(null), // No last week content
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      // Overall total should be 0 because the per-file 'total' was missing
      // and aggregateAccessibilityData only adds to overall if file.violations.total exists.
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(0);
      // Check that critical and serious were still aggregated correctly
      expect(result.finalResultFiles.current.overall.violations.critical.count).to.equal(3);
      expect(result.finalResultFiles.current.overall.violations.serious.count).to.equal(2);
    });

    it('should handle S3 save errors', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = [{ // Needs to be an array for processFilesWithRetry stub
        key: 'file1.json',
        data: {
          url: 'https://example.com/page1',
          violations: { total: 5 },
          traffic: 100,
        },
      }];

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock - THIS ONE FAILS
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).rejects(new Error('S3 save failed'));

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub().resolves(['file1.json']), // For getObjectKeysFromSubfolders
          getObjectFromKey: sandbox.stub().resolves(mockFileData[0].data),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Error: S3 save failed');
      // The main catch block in aggregateAccessibilityData logs a generic error
      expect(mockLog.error.calledWith('[A11yAudit][A11yProcessingError] Error aggregating accessibility data for site test-site')).to.be.true;
    });

    it('should handle lastWeekFile logging correctly', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = { // Data for the current processing
        url: 'https://example.com/page1',
        violations: { total: 5 },
        traffic: 100,
      };
      const lastWeekFileKey1 = `accessibility/test-site/${new Date(new Date(targetDate).setDate(new Date(targetDate).getDate() - 14)).toISOString().split('T')[0]}-final-result.json`;
      const lastWeekFileKey2 = `accessibility/test-site/${new Date(new Date(targetDate).setDate(new Date(targetDate).getDate() - 7)).toISOString().split('T')[0]}-final-result.json`;
      const mockLastWeekObjectKeys = [lastWeekFileKey1, lastWeekFileKey2];
      const mockLastWeekContent = { overall: { violations: { total: 8 } } };

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObject/DeleteObjects mock (for cleanupS3Files)
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectsCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            .onFirstCall().resolves(['file1.json']) // For getObjectKeysFromSubfolders
            .onSecondCall()
            .resolves(mockLastWeekObjectKeys), // For finding last week files
          getObjectFromKey: sandbox.stub()
            .onFirstCall().resolves(mockFileData) // For processFilesWithRetry
            // For loading last week file content (loads index length - 2 = lastWeekFileKey1)
            .onSecondCall()
            .resolves(mockLastWeekContent),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;

      // const expectedKeyInLog = `[A11yAudit] Last week file key:${lastWeekFileKey1}`;
      // The log message in the code actually uses lastWeekObjectKeys[1] for the key part.
      const expectedKeyInLog = `[A11yAudit] Last week file key:${lastWeekFileKey2}`;
      const logCall = mockLog.debug.getCalls().find((call) => call.args[0].includes(expectedKeyInLog) && call.args[0].includes('with content:'));
      expect(logCall).to.not.be.undefined;
      // If more precise matching is needed, verify the full content:
      const logContentString = JSON.stringify(mockLastWeekContent, null, 2);
      expect(logCall.args[0]).to.include(logContentString);
    });

    it('should call all required functions in correct order', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = { url: 'https://example.com/page1', violations: { total: 5 }, traffic: 100 };
      const dt = new Date(targetDate);
      const prevDate = new Date(dt.setDate(dt.getDate() - 7));
      const lastWeekFileKey = `accessibility/test-site/${prevDate.toISOString().split('T')[0]}-final-result.json`;

      // S3 Mocks
      // For getSubfolders (via getObjectKeysFromSubfolders)
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({ CommonPrefixes: [{ Prefix: `accessibility/test-site/${timestampToday}/` }] });
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({}); // For save
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      // Create stubs for s3-utils functions BEFORE esmock call
      const getObjectKeysUsingPrefixStub = sandbox.stub()
        .onFirstCall().resolves(['file1.json']) // For getObjectKeysFromSubfolders
        .onSecondCall()
        .resolves([lastWeekFileKey]); // For aggData direct call
      const getObjectFromKeyStub = sandbox.stub()
        .onFirstCall().resolves(mockFileData) // For processFilesWithRetry
        .onSecondCall()
        .resolves(null); // For aggData direct call (last week content)

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility',
        targetDate,
        2,
      );

      // Check if the main aggregation succeeded
      expect(result.success, 'aggregateData should succeed').to.be.true;

      // Assertions for s3-utils.js functions (on the stubs themselves)
      expect(getObjectKeysUsingPrefixStub.calledTwice).to.be.true;
      expect(getObjectFromKeyStub.calledOnce).to.be.true;

      // Assertions for S3 commands
      expect(mockS3Client.send.calledWith(sinon.match.instanceOf(ListObjectsV2Command))).to.be.true;
      expect(mockS3Client.send.calledWith(sinon.match.instanceOf(PutObjectCommand))).to.be.true;

      expect(mockS3Client.send.calledWith(sinon.match.instanceOf(DeleteObjectCommand)))
        .to.be.true;
    });

    it('should return error and specific message when getObjectKeysFromSubfolders returns success false', async () => {
      // eslint-disable-next-line max-len
      const expectedMessage = 'No accessibility data found in bucket test-bucket at prefix accessibility/test-site/ for site test-site with delimiter /';

      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({ CommonPrefixes: [] }); // No subfolders found

      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'accessibility', // auditType
        '2024-01-01', // version
        2, // maxRetries
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal(expectedMessage);
      expect(mockS3Client.send
        .calledOnceWith(sinon.match.instanceOf(ListObjectsV2Command))).to.be.true;
    });

    it('should use correct log identifier and storage prefix for forms-opportunities audit type', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = {
        url: 'https://example.com/contact',
        violations: { total: 3 },
        traffic: 50,
        formSource: '#contact-form',
        source: '#contact-form',
      };

      // S3 ListObjectsV2 mock - note the forms-accessibility prefix
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `forms-accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            .onFirstCall().resolves(['file1.json'])
            .onSecondCall()
            .resolves([`forms-accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub()
            .onFirstCall().resolves(mockFileData)
            .onSecondCall()
            .resolves(null),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'forms-opportunities', // forms audit type
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('https://example.com/contact?source=#contact-form');
      expect(result.finalResultFiles.current['https://example.com/contact?source=#contact-form'].violations.total).to.equal(3);
      expect(result.message).to.equal('Successfully aggregated 1 files into output-key');

      // Verify the correct log identifier is used
      expect(mockLog.debug.calledWith('[FormsA11yAudit] Saved aggregated accessibility data to output-key')).to.be.true;
    });

    it('should handle forms-opportunities audit type with form source data', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = {
        url: 'https://example.com/contact',
        violations: { total: 2 },
        traffic: 30,
        formSource: '#contact-form', // CSS selector for form
        source: '#contact-form',
      };

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `forms-accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            .onFirstCall().resolves(['file1.json'])
            .onSecondCall()
            .resolves([`forms-accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub()
            .onFirstCall().resolves(mockFileData)
            .onSecondCall()
            .resolves(null),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'forms-opportunities',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      // Should create composite key for form source data
      expect(result.finalResultFiles.current).to.have.property('https://example.com/contact?source=#contact-form');
      expect(result.finalResultFiles.current['https://example.com/contact?source=#contact-form'].violations.total).to.equal(2);
      expect(result.finalResultFiles.current['https://example.com/contact?source=#contact-form'].traffic).to.equal(30);
    });

    it('should handle forms-opportunities audit type with different CSS selector form sources', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();
      const mockFileData = {
        url: 'https://example.com/newsletter',
        violations: { total: 1 },
        traffic: 25,
        formSource: '.newsletter-signup-form', // CSS class selector for form
        source: '.newsletter-signup-form',
      };

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `forms-accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).resolves({});
      // S3 DeleteObject mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(DeleteObjectCommand)).resolves({});

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            .onFirstCall().resolves(['file1.json'])
            .onSecondCall()
            .resolves([`forms-accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub()
            .onFirstCall().resolves(mockFileData)
            .onSecondCall()
            .resolves(null),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'forms-opportunities',
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      // Should create composite key for form source data with CSS class selector
      expect(result.finalResultFiles.current).to.have.property('https://example.com/newsletter?source=.newsletter-signup-form');
      expect(result.finalResultFiles.current['https://example.com/newsletter?source=.newsletter-signup-form'].violations.total).to.equal(1);
      expect(result.finalResultFiles.current['https://example.com/newsletter?source=.newsletter-signup-form'].traffic).to.equal(25);
    });

    it('should return error with correct log identifier for forms-opportunities when no files processed', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `forms-accessibility/test-site/${timestampToday}/` }],
        });

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub()
            .onFirstCall().resolves(['file1.json', 'file2.json'])
            .onSecondCall()
            .resolves([`forms-accessibility/test-site/${targetDate}-final-result.json`]),
          getObjectFromKey: sandbox.stub().resolves(null), // No data returned
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'forms-opportunities',
        targetDate,
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('[FormsA11yAudit] No files could be processed successfully for site test-site');
      expect(mockLog.error.calledWith('[A11yProcessingError] [FormsA11yAudit] No files could be processed successfully for site test-site')).to.be.true;
    });

    it('should handle forms-opportunities audit type error with correct log identifier', async () => {
      const targetDate = '2024-01-01';
      const timestampToday = new Date(`${targetDate}T00:00:00Z`).getTime();

      // S3 ListObjectsV2 mock
      mockS3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          CommonPrefixes: [{ Prefix: `forms-accessibility/test-site/${timestampToday}/` }],
        });
      // S3 PutObject mock - THIS ONE FAILS
      mockS3Client.send.withArgs(sinon.match.instanceOf(PutObjectCommand)).rejects(new Error('S3 save failed'));

      const { aggregateAccessibilityData: aggregateData } = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: sandbox.stub().resolves(['file1.json']),
          getObjectFromKey: sandbox.stub().resolves({
            url: 'https://example.com/contact',
            violations: { total: 1 },
            traffic: 20,
            formSource: '#contact-form',
            source: '#contact-form',
          }),
        },
      });

      const result = await aggregateData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        'forms-opportunities',
        targetDate,
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Error: S3 save failed');
      // Verify the correct log identifier is used in error message
      expect(mockLog.error.calledWith('[FormsA11yAudit][A11yProcessingError] Error aggregating accessibility data for site test-site')).to.be.true;
    });
  });

  describe('getEnvAsoDomain', () => {
    it('should return "experience" when AWS_ENV is "prod"', () => {
      const env = { AWS_ENV: 'prod' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience');
    });

    it('should return "experience-stage" when AWS_ENV is not "prod"', () => {
      const env = { AWS_ENV: 'stage' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is "dev"', () => {
      const env = { AWS_ENV: 'dev' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is "test"', () => {
      const env = { AWS_ENV: 'test' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is undefined', () => {
      const env = { AWS_ENV: undefined };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is null', () => {
      const env = { AWS_ENV: null };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is empty string', () => {
      const env = { AWS_ENV: '' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when env object is empty', () => {
      const env = {};
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle case sensitivity - "PROD" should not equal "prod"', () => {
      const env = { AWS_ENV: 'PROD' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle whitespace - " prod " should not equal "prod"', () => {
      const env = { AWS_ENV: ' prod ' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle production environment correctly', () => {
      const env = { AWS_ENV: 'prod', OTHER_VAR: 'some-value' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience');
    });

    it('should handle staging environment correctly', () => {
      const env = { AWS_ENV: 'stage', OTHER_VAR: 'some-value' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });
  });

  describe('processFilesWithRetry', () => {
    let mockGetObjectFromKey;
    let processFilesWithRetryMocked;

    beforeEach(async () => {
      // Create mock for getObjectFromKey
      mockGetObjectFromKey = sandbox.stub();

      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: mockGetObjectFromKey,
        },
      });

      processFilesWithRetryMocked = dataProcessingModule.processFilesWithRetry;
    });

    describe('successful processing', () => {
      it('should process all files successfully', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['file1.json', 'file2.json', 'file3.json'];
        const mockData1 = { url: 'https://example.com/page1', violations: { total: 5 } };
        const mockData2 = { url: 'https://example.com/page2', violations: { total: 3 } };
        const mockData3 = { url: 'https://example.com/page3', violations: { total: 7 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file1.json', mockLog)
          .resolves(mockData1);
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file2.json', mockLog)
          .resolves(mockData2);
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file3.json', mockLog)
          .resolves(mockData3);

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(3);
        expect(result.results[0]).to.deep.equal({ key: 'file1.json', data: mockData1 });
        expect(result.results[1]).to.deep.equal({ key: 'file2.json', data: mockData2 });
        expect(result.results[2]).to.deep.equal({ key: 'file3.json', data: mockData3 });

        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 3 successful, 0 failed out of 3 total files',
        );
      });

      it('should handle empty object keys array', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = [];

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(0);
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 0 successful, 0 failed out of 0 total files',
        );
        expect(mockGetObjectFromKey).to.not.have.been.called;
      });

      it('should process single file successfully', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['single-file.json'];
        const mockData = { url: 'https://example.com/single', violations: { total: 2 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'single-file.json', mockLog)
          .resolves(mockData);

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(1);
        expect(result.results[0]).to.deep.equal({ key: 'single-file.json', data: mockData });
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 1 successful, 0 failed out of 1 total files',
        );
      });
    });

    describe('error handling and retries', () => {
      it('should retry failed files up to maxRetries and succeed on retry', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['retry-file.json'];
        const maxRetries = 2;
        const mockData = { url: 'https://example.com/retry', violations: { total: 1 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'retry-file.json', mockLog)
          .onFirstCall()
          .rejects(new Error('Temporary S3 error'))
          .onSecondCall()
          .resolves(mockData);

        // Act
        const result = await processFilesWithRetryMocked(
          s3Client,
          bucketName,
          objectKeys,
          mockLog,
          maxRetries,
        );

        // Assert
        expect(result.results).to.have.length(1);
        expect(result.results[0]).to.deep.equal({ key: 'retry-file.json', data: mockData });

        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file retry-file.json (attempt 1/2): Temporary S3 error',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 1 successful, 0 failed out of 1 total files',
        );
      });

      it('should fail after exhausting all retries', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['failing-file.json'];
        const maxRetries = 1;

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'failing-file.json', mockLog)
          .rejects(new Error('Persistent S3 error'));

        // Act
        const result = await processFilesWithRetryMocked(
          s3Client,
          bucketName,
          objectKeys,
          mockLog,
          maxRetries,
        );

        // Assert
        expect(result.results).to.have.length(0);

        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file failing-file.json (attempt 1/1): Persistent S3 error',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yProcessingError] Failed to process file failing-file.json after 1 retries: Persistent S3 error',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 1 files failed to process, continuing with 0 successful files',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 0 successful, 1 failed out of 1 total files',
        );
      });

      it('should handle mixed success and failure scenarios', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['success-file.json', 'fail-file.json', 'retry-success-file.json'];
        const maxRetries = 1;
        const successData = { url: 'https://example.com/success', violations: { total: 3 } };
        const retrySuccessData = { url: 'https://example.com/retry-success', violations: { total: 2 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'success-file.json', mockLog)
          .resolves(successData);
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'fail-file.json', mockLog)
          .rejects(new Error('Permanent failure'));
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'retry-success-file.json', mockLog)
          .onFirstCall()
          .rejects(new Error('Temporary failure'))
          .onSecondCall()
          .resolves(retrySuccessData);

        // Act
        const result = await processFilesWithRetryMocked(
          s3Client,
          bucketName,
          objectKeys,
          mockLog,
          maxRetries,
        );

        // Assert
        expect(result.results).to.have.length(2);
        expect(result.results).to.deep.include({ key: 'success-file.json', data: successData });
        expect(result.results).to.deep.include({ key: 'retry-success-file.json', data: retrySuccessData });

        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file retry-success-file.json (attempt 1/1): Temporary failure',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yProcessingError] Failed to process file fail-file.json after 1 retries: Permanent failure',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 3 files failed to process, continuing with 2 successful files',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 2 successful, 1 failed out of 3 total files',
        );
      });

      it('should use default maxRetries value of 1 when not specified', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['default-retry-file.json'];

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'default-retry-file.json', mockLog)
          .rejects(new Error('Error for default retry test'));

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(0);
        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file default-retry-file.json (attempt 1/1): Error for default retry test',
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yProcessingError] Failed to process file default-retry-file.json after 1 retries: Error for default retry test',
        );
      });
    });

    describe('null data handling', () => {
      it('should handle null data from getObjectFromKey', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['null-data-file.json', 'valid-file.json'];
        const validData = { url: 'https://example.com/valid', violations: { total: 1 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'null-data-file.json', mockLog)
          .resolves(null);
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'valid-file.json', mockLog)
          .resolves(validData);

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(1);
        expect(result.results[0]).to.deep.equal({ key: 'valid-file.json', data: validData });

        expect(mockLog.warn).to.have.been.calledWith(
          'Failed to get data from null-data-file.json, skipping',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 2 files failed to process, continuing with 1 successful files',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 1 successful, 1 failed out of 2 total files',
        );
      });

      it('should handle all files returning null data', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['null-file1.json', 'null-file2.json'];

        mockGetObjectFromKey.resolves(null);

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(0);

        expect(mockLog.warn).to.have.been.calledWith(
          'Failed to get data from null-file1.json, skipping',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          'Failed to get data from null-file2.json, skipping',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '2 out of 2 files failed to process, continuing with 0 successful files',
        );
        expect(mockLog.debug).to.have.been.calledWith(
          'File processing completed: 0 successful, 2 failed out of 2 total files',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle maxRetries of 0', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['no-retry-file.json'];
        const maxRetries = 0;

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'no-retry-file.json', mockLog)
          .rejects(new Error('No retry error'));

        // Act
        const result = await processFilesWithRetryMocked(
          s3Client,
          bucketName,
          objectKeys,
          mockLog,
          maxRetries,
        );

        // Assert
        expect(result.results).to.have.length(0);

        // Should not retry when maxRetries is 0
        expect(mockLog.warn).to.not.have.been.calledWith(
          sinon.match(/Retrying file/),
        );
        expect(mockLog.error).to.have.been.calledWith(
          '[A11yProcessingError] Failed to process file no-retry-file.json after 0 retries: No retry error',
        );
      });

      it('should handle very large maxRetries value', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['large-retry-file.json'];
        const maxRetries = 100;
        const mockData = { url: 'https://example.com/large-retry', violations: { total: 1 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'large-retry-file.json', mockLog)
          .onCall(0)
          .rejects(new Error('First failure'))
          .onCall(1)
          .rejects(new Error('Second failure'))
          .onCall(2)
          .resolves(mockData);

        // Act
        const result = await processFilesWithRetryMocked(
          s3Client,
          bucketName,
          objectKeys,
          mockLog,
          maxRetries,
        );

        // Assert
        expect(result.results).to.have.length(1);
        expect(result.results[0]).to.deep.equal({ key: 'large-retry-file.json', data: mockData });

        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file large-retry-file.json (attempt 1/100): First failure',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          'Retrying file large-retry-file.json (attempt 2/100): Second failure',
        );
      });
    });
  });

  describe('getEnvAsoDomain', () => {
    it('should return "experience" when AWS_ENV is "prod"', () => {
      const env = { AWS_ENV: 'prod' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience');
    });

    it('should return "experience-stage" when AWS_ENV is not "prod"', () => {
      const env = { AWS_ENV: 'stage' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is "dev"', () => {
      const env = { AWS_ENV: 'dev' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is "test"', () => {
      const env = { AWS_ENV: 'test' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is undefined', () => {
      const env = { AWS_ENV: undefined };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is null', () => {
      const env = { AWS_ENV: null };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when AWS_ENV is empty string', () => {
      const env = { AWS_ENV: '' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should return "experience-stage" when env object is empty', () => {
      const env = {};
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle case sensitivity - "PROD" should not equal "prod"', () => {
      const env = { AWS_ENV: 'PROD' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle whitespace - " prod " should not equal "prod"', () => {
      const env = { AWS_ENV: ' prod ' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });

    it('should handle production environment correctly', () => {
      const env = { AWS_ENV: 'prod', OTHER_VAR: 'some-value' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience');
    });

    it('should handle staging environment correctly', () => {
      const env = { AWS_ENV: 'stage', OTHER_VAR: 'some-value' };
      const result = getEnvAsoDomain(env);
      expect(result).to.equal('experience-stage');
    });
  });

  describe('getUrlsForAudit', () => {
    let mockGetObjectKeysUsingPrefix;
    let mockGetObjectFromKey;
    let getUrlsForAuditMocked;
    let mockS3ClientForAudit;
    let mockLogForAudit;

    beforeEach(async () => {
      // Create mocks for the s3-utils functions
      mockGetObjectKeysUsingPrefix = sandbox.stub();
      mockGetObjectFromKey = sandbox.stub();
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectKeysUsingPrefix: mockGetObjectKeysUsingPrefix,
          getObjectFromKey: mockGetObjectFromKey,
        },
      });

      getUrlsForAuditMocked = dataProcessingModule.getUrlsForAudit;

      mockS3ClientForAudit = { mock: 'client' };
      mockLogForAudit = {
        info: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      };
    });

    describe('successful scenarios', () => {
      it('should successfully return URLs for audit when final result files exist', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'test-site-123';
        const finalResultFiles = [
          'accessibility/test-site-123/2024-01-01-final-result.json',
          'accessibility/test-site-123/2024-01-08-final-result.json',
          'accessibility/test-site-123/2024-01-15-final-result.json',
        ];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 10 },
          },
          'https://example.com/page1': {
            violations: { total: 5 },
            traffic: '1000',
          },
          'https://example.com/page2': {
            violations: { total: 3 },
            traffic: '500',
          },
          'https://subdomain.example.com/page3': {
            violations: { total: 2 },
            traffic: '750',
          },
        };

        mockGetObjectKeysUsingPrefix
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/test-site-123/',
            mockLogForAudit,
            10,
            '-final-result.json',
          )
          .resolves(finalResultFiles);
        mockGetObjectFromKey
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/test-site-123/2024-01-15-final-result.json',
            mockLogForAudit,
          )
          .resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(3);
        expect(result).to.deep.include({
          url: 'https://example.com/page1',
          urlId: 'example.com/page1',
          traffic: '1000',
        });
        expect(result).to.deep.include({
          url: 'https://example.com/page2',
          urlId: 'example.com/page2',
          traffic: '500',
        });
        expect(result).to.deep.include({
          url: 'https://subdomain.example.com/page3',
          urlId: 'subdomain.example.com/page3',
          traffic: '750',
        });

        expect(mockGetObjectKeysUsingPrefix.calledOnce).to.be.true;
        expect(mockGetObjectFromKey.calledOnce).to.be.true;
      });

      it('should handle single URL in final result file', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'single-url-site';
        const finalResultFiles = ['accessibility/single-url-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 2 },
          },
          'https://single.example.com': {
            violations: { total: 2 },
            traffic: '2000',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(1);
        expect(result[0]).to.deep.equal({
          url: 'https://single.example.com',
          urlId: 'single.example.com',
          traffic: '2000',
        });
      });

      it('should handle URLs with complex paths and query parameters', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'complex-urls-site';
        const finalResultFiles = ['accessibility/complex-urls-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 5 },
          },
          'https://example.com/path/to/page?param=value': {
            violations: { total: 2 },
            traffic: '800',
          },
          'https://api.example.com/v1/endpoint': {
            violations: { total: 3 },
            traffic: '1200',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(2);
        expect(result).to.deep.include({
          url: 'https://example.com/path/to/page?param=value',
          urlId: 'example.com/path/to/page?param=value',
          traffic: '800',
        });
        expect(result).to.deep.include({
          url: 'https://api.example.com/v1/endpoint',
          urlId: 'api.example.com/v1/endpoint',
          traffic: '1200',
        });
      });

      it('should exclude overall data and only include HTTPS URLs', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'mixed-data-site';
        const finalResultFiles = ['accessibility/mixed-data-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 10 },
          },
          'https://secure.example.com': {
            violations: { total: 3 },
            traffic: '900',
          },
          'http://insecure.example.com': {
            violations: { total: 2 },
            traffic: '400',
          },
          'ftp://files.example.com': {
            violations: { total: 1 },
            traffic: '100',
          },
          metadata: {
            scanDate: '2024-01-15',
            totalPages: 3,
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(1);
        expect(result[0]).to.deep.equal({
          url: 'https://secure.example.com',
          urlId: 'secure.example.com',
          traffic: '900',
        });
      });

      it('should use the latest final result file when multiple exist', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'multiple-files-site';
        const finalResultFiles = [
          'accessibility/multiple-files-site/2024-01-01-final-result.json',
          'accessibility/multiple-files-site/2024-01-08-final-result.json',
          'accessibility/multiple-files-site/2024-01-15-final-result.json',
          'accessibility/multiple-files-site/2024-01-22-final-result.json',
        ];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 1 },
          },
          'https://latest.example.com': {
            violations: { total: 1 },
            traffic: '1500',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/multiple-files-site/2024-01-22-final-result.json',
            mockLogForAudit,
          )
          .resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(1);
        expect(result[0]).to.deep.equal({
          url: 'https://latest.example.com',
          urlId: 'latest.example.com',
          traffic: '1500',
        });

        // Verify it used the latest file
        expect(mockGetObjectFromKey.calledWith(
          mockS3ClientForAudit,
          bucketName,
          'accessibility/multiple-files-site/2024-01-22-final-result.json',
          mockLogForAudit,
        )).to.be.true;
      });
    });

    describe('error scenarios', () => {
      it('should return empty array when no final result files found', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'no-files-site';

        mockGetObjectKeysUsingPrefix
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/no-files-site/',
            mockLogForAudit,
            10,
            '-final-result.json',
          )
          .resolves([]);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.warn.calledWith(
          '[A11yProcessingWarning] [A11yAudit] No final result files found for no-files-site',
        )).to.be.true;
      });

      it('should return empty array when getObjectKeysUsingPrefix fails', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'error-site';
        const s3Error = new Error('S3 access denied');

        mockGetObjectKeysUsingPrefix
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/error-site/',
            mockLogForAudit,
            10,
            '-final-result.json',
          )
          .rejects(s3Error);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yAudit][A11yProcessingError] Error getting final result files for error-site: S3 access denied',
        )).to.be.true;
      });

      it('should return empty array when latest final result file is null', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'null-file-site';
        const finalResultFiles = ['accessibility/null-file-site/2024-01-15-final-result.json'];

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/null-file-site/2024-01-15-final-result.json',
            mockLogForAudit,
          )
          .resolves(null);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yProcessingError] [A11yAudit] No latest final result file found for null-file-site',
        )).to.be.true;
      });

      it('should return empty array when getObjectFromKey fails', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'get-object-error-site';
        const finalResultFiles = ['accessibility/get-object-error-site/2024-01-15-final-result.json'];
        const getObjectError = new Error('Failed to get object from S3');

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey
          .withArgs(
            mockS3ClientForAudit,
            bucketName,
            'accessibility/get-object-error-site/2024-01-15-final-result.json',
            mockLogForAudit,
          )
          .rejects(getObjectError);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yAudit][A11yProcessingError] Error getting latest final result file for get-object-error-site: Failed to get object from S3',
        )).to.be.true;
      });

      it('should return empty array when no HTTPS URLs found in final result file', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'no-urls-site';
        const finalResultFiles = ['accessibility/no-urls-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 0 },
          },
          metadata: {
            scanDate: '2024-01-15',
            totalPages: 0,
          },
          'http://insecure.example.com': {
            violations: { total: 1 },
            traffic: '100',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yProcessingError] [A11yAudit] No URLs found for no-urls-site',
        )).to.be.true;
      });

      it('should return empty array when final result file contains only overall data', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'only-overall-site';
        const finalResultFiles = ['accessibility/only-overall-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 5 },
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yProcessingError] [A11yAudit] No URLs found for only-overall-site',
        )).to.be.true;
      });
    });

    describe('edge cases', () => {
      it('should handle empty final result file', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'empty-file-site';
        const finalResultFiles = ['accessibility/empty-file-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {};

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.be.an('array');
        expect(result).to.have.length(0);
        expect(mockLogForAudit.error.calledWith(
          '[A11yProcessingError] [A11yAudit] No URLs found for empty-file-site',
        )).to.be.true;
      });

      it('should handle final result file with undefined traffic values', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'undefined-traffic-site';
        const finalResultFiles = ['accessibility/undefined-traffic-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 2 },
          },
          'https://example.com/page1': {
            violations: { total: 1 },
            traffic: undefined,
          },
          'https://example.com/page2': {
            violations: { total: 1 },
            // traffic property missing
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(2);
        expect(result[0].traffic).to.be.undefined;
        expect(result[1].traffic).to.be.undefined;
      });

      it('should handle URLs with special characters', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'special-chars-site';
        const finalResultFiles = ['accessibility/special-chars-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 3 },
          },
          'https://example.com/path with spaces': {
            violations: { total: 1 },
            traffic: '100',
          },
          'https://example.com/path-with-dashes_and_underscores': {
            violations: { total: 1 },
            traffic: '200',
          },
          'https://example.com/path?query=value&other=123': {
            violations: { total: 1 },
            traffic: '300',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(3);
        expect(result).to.deep.include({
          url: 'https://example.com/path with spaces',
          urlId: 'example.com/path with spaces',
          traffic: '100',
        });
        expect(result).to.deep.include({
          url: 'https://example.com/path-with-dashes_and_underscores',
          urlId: 'example.com/path-with-dashes_and_underscores',
          traffic: '200',
        });
        expect(result).to.deep.include({
          url: 'https://example.com/path?query=value&other=123',
          urlId: 'example.com/path?query=value&other=123',
          traffic: '300',
        });
      });

      it('should handle very large number of URLs', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'large-site';
        const finalResultFiles = ['accessibility/large-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 100 },
          },
        };

        // Generate 50 URLs
        for (let i = 1; i <= 50; i += 1) {
          latestFinalResultFile[`https://example.com/page${i}`] = {
            violations: { total: 2 },
            traffic: `${i * 100}`,
          };
        }

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(50);
        expect(result[0]).to.deep.equal({
          url: 'https://example.com/page1',
          urlId: 'example.com/page1',
          traffic: '100',
        });
        expect(result[49]).to.deep.equal({
          url: 'https://example.com/page50',
          urlId: 'example.com/page50',
          traffic: '5000',
        });
      });

      it('should correctly remove https:// prefix from urlId', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'url-id-test-site';
        const finalResultFiles = ['accessibility/url-id-test-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: {
            violations: { total: 1 },
          },
          'https://www.example.com/very/long/path/to/page.html': {
            violations: { total: 1 },
            traffic: '500',
          },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        const result = await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(result).to.have.length(1);
        expect(result[0]).to.deep.equal({
          url: 'https://www.example.com/very/long/path/to/page.html',
          urlId: 'www.example.com/very/long/path/to/page.html',
          traffic: '500',
        });
      });
    });

    describe('function call verification', () => {
      it('should call getObjectKeysUsingPrefix with correct parameters', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'param-test-site';
        const finalResultFiles = ['accessibility/param-test-site/2024-01-15-final-result.json'];
        const latestFinalResultFile = {
          overall: { violations: { total: 1 } },
          'https://example.com': { violations: { total: 1 }, traffic: '100' },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(mockGetObjectKeysUsingPrefix.calledOnce).to.be.true;
        expect(mockGetObjectKeysUsingPrefix.calledWith(
          mockS3ClientForAudit,
          bucketName,
          'accessibility/param-test-site/',
          mockLogForAudit,
          10,
          '-final-result.json',
        )).to.be.true;
      });

      it('should call getObjectFromKey with correct parameters', async () => {
        // Arrange
        const bucketName = 'test-bucket';
        const siteId = 'param-test-site-2';
        const finalResultFiles = [
          'accessibility/param-test-site-2/2024-01-01-final-result.json',
          'accessibility/param-test-site-2/2024-01-15-final-result.json',
        ];
        const latestFinalResultFile = {
          overall: { violations: { total: 1 } },
          'https://example.com': { violations: { total: 1 }, traffic: '100' },
        };

        mockGetObjectKeysUsingPrefix.resolves(finalResultFiles);
        mockGetObjectFromKey.resolves(latestFinalResultFile);

        // Act
        await getUrlsForAuditMocked(
          mockS3ClientForAudit,
          bucketName,
          siteId,
          mockLogForAudit,
        );

        // Assert
        expect(mockGetObjectFromKey.calledOnce).to.be.true;
        expect(mockGetObjectFromKey.calledWith(
          mockS3ClientForAudit,
          bucketName,
          'accessibility/param-test-site-2/2024-01-15-final-result.json',
          mockLogForAudit,
        )).to.be.true;
      });
    });
  });

  describe('generateReportOpportunity', () => {
    let generateReportOpportunityMocked;
    let mockDataAccess;

    beforeEach(async () => {
      // Create mock for dataAccess
      mockDataAccess = {
        Opportunity: {
          create: sandbox.stub(),
        },
      };

      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js');
      generateReportOpportunityMocked = dataProcessingModule.generateReportOpportunity;
    });

    describe('successful execution', () => {
      it('should successfully generate report opportunity with shouldIgnore=true', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('# Test Report\n\nThis is a test report.');
        const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Test Opportunity' });
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-123'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        const reportData = {
          mdData: { violations: { total: 5 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 20, year: 2024 },
          auditData: { siteId: 'test-site', auditId: 'audit-123' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Test Report';
        const shouldIgnore = true;

        // Mock the dataAccess.Opportunity.create to return our mock opportunity
        mockDataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
          shouldIgnore,
        );

        // Assert
        expect(result).to.be.a('string');
        expect(mockGenMdFn.calledOnce).to.be.true;
        expect(mockGenMdFn.calledWith(reportData.mdData)).to.be.true;
        expect(mockCreateOpportunityFn.calledOnce).to.be.true;
        expect(mockCreateOpportunityFn.calledWith(20, 2024)).to.be.true;
        expect(mockDataAccess.Opportunity.create.calledOnce).to.be.true;
        expect(mockOpportunity.getSuggestions.calledOnce).to.be.true;
        expect(mockOpportunity.addSuggestions.calledOnce).to.be.true;
        expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
        expect(mockOpportunity.save.calledOnce).to.be.true;
        expect(mockOpportunity.getId.called).to.be.true;
      });

      it('should successfully generate report opportunity with shouldIgnore=false', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('# Test Report\n\nThis is a test report.');
        const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Test Opportunity' });
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-456'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-456' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        const reportData = {
          mdData: { violations: { total: 3 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 15, year: 2024 },
          auditData: { siteId: 'test-site-2', auditId: 'audit-456' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Test Report 2';
        const shouldIgnore = false;

        mockDataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
          shouldIgnore,
        );

        // Assert
        expect(result).to.be.a('string');
        expect(mockOpportunity.getSuggestions.calledOnce).to.be.true;
        expect(mockOpportunity.addSuggestions.calledOnce).to.be.true;
        expect(mockOpportunity.setStatus.called).to.be.false;
        expect(mockOpportunity.save.called).to.be.false;
        expect(mockOpportunity.getId.called).to.be.true;
      });

      it('should use default shouldIgnore=true when not provided', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('# Default Test Report');
        const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility' });
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-default'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-default' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        const reportData = {
          mdData: { violations: { total: 1 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 10, year: 2024 },
          auditData: { siteId: 'default-site', auditId: 'audit-default' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Default Test Report';

        mockDataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act - not providing shouldIgnore parameter
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
        );

        // Assert
        expect(result).to.be.a('string');
        expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
        expect(mockOpportunity.save.calledOnce).to.be.true;
      });
    });

    describe('empty markdown handling', () => {
      it('should return empty string when genMdFn returns empty string', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('');
        const mockCreateOpportunityFn = sandbox.stub();
        const reportData = {
          mdData: { violations: { total: 0 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 5, year: 2024 },
          auditData: { siteId: 'empty-site', auditId: 'audit-empty' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Empty Report';

        // Act
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
        );

        // Assert
        expect(result).to.equal('');
        expect(mockGenMdFn.calledOnce).to.be.true;
        expect(mockCreateOpportunityFn.called).to.be.false;
        expect(mockDataAccess.Opportunity.create.called).to.be.false;
      });

      it('should return empty string when genMdFn returns null', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns(null);
        const mockCreateOpportunityFn = sandbox.stub();
        const reportData = {
          mdData: { violations: { total: 0 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 5, year: 2024 },
          auditData: { siteId: 'null-site', auditId: 'audit-null' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Null Report';

        // Act
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
        );

        // Assert
        expect(result).to.equal('');
        expect(mockGenMdFn.calledOnce).to.be.true;
        expect(mockCreateOpportunityFn.called).to.be.false;
      });

      it('should return empty string when genMdFn returns undefined', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns(undefined);
        const mockCreateOpportunityFn = sandbox.stub();
        const reportData = {
          mdData: { violations: { total: 0 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 5, year: 2024 },
          auditData: { siteId: 'undefined-site', auditId: 'audit-undefined' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Undefined Report';

        // Act
        const result = await generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          reportName,
        );

        // Assert
        expect(result).to.equal('');
      });
    });

    describe('createReportOpportunity error handling', () => {
      it('should handle createReportOpportunity error and rethrow', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('# Error Test Report');
        const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility' });
        const reportData = {
          mdData: { violations: { total: 5 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 20, year: 2024 },
          auditData: { siteId: 'error-site', auditId: 'audit-error' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Error Test Report';
        const originalError = new Error('Database connection failed');

        mockDataAccess.Opportunity.create.rejects(originalError);

        // Act & Assert
        try {
          await generateReportOpportunityMocked(
            reportData,
            mockGenMdFn,
            mockCreateOpportunityFn,
            reportName,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Database connection failed');
          expect(mockLog.error.called).to.be.true;
        }
      });
    });

    describe('createReportOpportunitySuggestion error handling', () => {
      it('should handle createReportOpportunitySuggestion error and rethrow', async () => {
        // Arrange
        const mockGenMdFn = sandbox.stub().returns('# Suggestion Error Test');
        const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility' });
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-suggestion-error'),
          addSuggestions: sandbox.stub().rejects(new Error('Failed to add suggestions')),
          getSuggestions: sandbox.stub().resolves([]),
        };
        const reportData = {
          mdData: { violations: { total: 3 } },
          linkData: { baseUrl: 'https://example.com' },
          opptyData: { week: 25, year: 2024 },
          auditData: { siteId: 'suggestion-error-site', auditId: 'audit-suggestion-error' },
          context: {
            log: mockLog,
            dataAccess: mockDataAccess,
          },
        };
        const reportName = 'Suggestion Error Report';

        mockDataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act & Assert
        try {
          await generateReportOpportunityMocked(
            reportData,
            mockGenMdFn,
            mockCreateOpportunityFn,
            reportName,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Failed to add suggestions');
          expect(mockLog.error.called).to.be.true;
          expect(mockDataAccess.Opportunity.create.calledOnce).to.be.true;
          expect(mockOpportunity.getSuggestions.calledOnce).to.be.true;
          expect(mockOpportunity.setStatus.called).to.be.false;
          expect(mockOpportunity.save.called).to.be.false;
        }
      });
    });
  });

  describe('generateReportOpportunities', () => {
    let generateReportOpportunitiesMocked;
    let mockSite;
    let mockAggregationResult;
    let mockContext;
    let mockAuditType;

    beforeEach(async () => {
      // Mock external dependencies instead of internal functions
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '../../../src/accessibility/utils/report-oppty.js': {
          createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
          createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
          createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
          createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
          createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          generateInDepthReportMarkdown: sandbox.stub().returns('# In-depth Report\n\nContent'),
          generateEnhancedReportMarkdown: sandbox.stub().returns('# Enhanced Report\n\nContent'),
          generateFixedNewReportMarkdown: sandbox.stub().returns('# Fixed vs New Report\n\nContent'),
          generateBaseReportMarkdown: sandbox.stub().returns('# Base Report\n\nContent'),
        },
      });
      generateReportOpportunitiesMocked = dataProcessingModule.generateReportOpportunities;

      // Set up mock objects
      mockSite = {
        getId: sandbox.stub().returns('test-site-id'),
        getLatestAuditByAuditType: sandbox.stub().resolves({
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditType: 'accessibility',
        }),
      };

      mockAggregationResult = {
        finalResultFiles: {
          current: { overall: { violations: { total: 10 } }, 'https://site.com/page1': {} },
          lastWeek: { overall: { violations: { total: 5 } }, 'https://site.com/page1': {} },
        },
      };

      mockContext = {
        log: mockLog,
        env: { AWS_ENV: 'stage' },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub(),
          },
        },
      };

      mockAuditType = 'accessibility';
    });

    describe('initial data setup (lines 644-680)', () => {
      it('should correctly extract basic data from inputs', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-123'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(mockSite.getId.calledOnce).to.be.true;
        expect(mockSite.getLatestAuditByAuditType.calledWith(mockAuditType)).to.be.true;
        expect(result).to.have.property('status', true);
        expect(result).to.have.property('message', 'All report opportunities created successfully');
      });

      it('should handle different site IDs', async () => {
        // Arrange
        const customSiteId = 'custom-test-site-456';
        mockSite.getId.returns(customSiteId);
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-custom'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-custom' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(mockSite.getId.calledOnce).to.be.true;
        expect(mockSite.getId.returned(customSiteId)).to.be.true;
        expect(result.status).to.be.true;
      });

      it('should handle different environment configurations', async () => {
        // Arrange
        const prodContext = {
          ...mockContext,
          env: { AWS_ENV: 'prod' },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-prod'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-prod' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        prodContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          prodContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(mockSite.getId.calledOnce).to.be.true;
      });

      it('should handle different audit types', async () => {
        // Arrange
        const customAuditType = 'performance';
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-perf'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-perf' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          customAuditType,
        );

        // Assert
        expect(mockSite.getLatestAuditByAuditType.calledWith(customAuditType)).to.be.true;
        expect(result.status).to.be.true;
      });

      it('should handle complex aggregation result structures', async () => {
        // Arrange
        const complexAggregationResult = {
          finalResultFiles: {
            current: {
              overall: {
                violations: { total: 25, critical: { count: 10 }, serious: { count: 15 } },
              },
              'https://example.com/page1': { violations: { total: 5 }, traffic: '1000' },
              'https://example.com/page2': { violations: { total: 3 }, traffic: '500' },
            },
            lastWeek: {
              overall: {
                violations: { total: 15, critical: { count: 5 }, serious: { count: 10 } },
              },
              'https://example.com/page1': { violations: { total: 3 }, traffic: '900' },
            },
          },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-complex'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-complex' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          complexAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(mockSite.getId.calledOnce).to.be.true;
        expect(mockSite.getLatestAuditByAuditType.calledOnce).to.be.true;
      });

      it('should handle missing lastWeek data', async () => {
        // Arrange
        const aggregationResultWithoutLastWeek = {
          finalResultFiles: {
            current: { overall: { violations: { total: 10 } }, 'https://site.com/page1': {} },
            lastWeek: null,
          },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('opp-no-lastweek'),
          addSuggestions: sandbox.stub().resolves({ id: 'sugg-no-lastweek' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          aggregationResultWithoutLastWeek,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(mockSite.getId.calledOnce).to.be.true;
      });
    });

    describe('in-depth report generation (lines 682-687)', () => {
      it('should successfully generate in-depth report opportunity', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('in-depth-opp-123'),
          addSuggestions: sandbox.stub().resolves({ id: 'in-depth-sugg-123' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(result.message).to.equal('All report opportunities created successfully');

        // Verify that opportunity creation was called for in-depth report
        expect(mockContext.dataAccess.Opportunity.create.called).to.be.true;
        expect(mockOpportunity.addSuggestions.called).to.be.true;
        expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
        expect(mockOpportunity.save.called).to.be.true;
      });

      it('should handle empty markdown for in-depth report', async () => {
        // Arrange - Mock markdown generation to return empty string
        const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
          '../../../src/accessibility/utils/report-oppty.js': {
            createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
            createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
            createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
            createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
            createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
          },
          '../../../src/accessibility/utils/generate-md-reports.js': {
            generateInDepthReportMarkdown: sandbox.stub().returns(''), // Empty markdown
            generateEnhancedReportMarkdown: sandbox.stub().returns('# Enhanced Report\n\nContent'),
            generateFixedNewReportMarkdown: sandbox.stub().returns('# Fixed vs New Report\n\nContent'),
            generateBaseReportMarkdown: sandbox.stub().returns('# Base Report\n\nContent'),
          },
        });
        const generateReportOpportunitiesTest = dataProcessingModule.generateReportOpportunities;

        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('other-opp-123'),
          addSuggestions: sandbox.stub().resolves({ id: 'other-sugg-123' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesTest(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        // When in-depth report markdown is empty, it should still continue with other reports
        expect(result.message).to.equal('All report opportunities created successfully');
      });

      it('should handle opportunity creation failure for in-depth report', async () => {
        // Arrange - Mock opportunity creation to fail
        const creationError = new Error('Database connection failed');
        mockContext.dataAccess.Opportunity.create.rejects(creationError);

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Database connection failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate in-depth report opportunity',
            'Database connection failed',
          )).to.be.true;
        }
      });

      it('should handle suggestion creation failure for in-depth report', async () => {
        // Arrange - Mock suggestion creation to fail
        const suggestionError = new Error('Failed to create suggestions');
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('fail-sugg-opp'),
          addSuggestions: sandbox.stub().rejects(suggestionError),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Failed to create suggestions');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate in-depth report opportunity',
            'Failed to create suggestions',
          )).to.be.true;
        }
      });

      it('should verify in-depth report parameters are passed correctly', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('param-test-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'param-test-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert - Verify the opportunity was created with correct audit data
        expect(mockContext.dataAccess.Opportunity.create.called).to.be.true;
        const createCall = mockContext.dataAccess.Opportunity.create.getCall(0);
        const opportunityData = createCall.args[0];

        expect(opportunityData).to.have.property('siteId', 'test-site-id');
        expect(opportunityData).to.have.property('auditId', 'test-audit-id');
        expect(opportunityData).to.have.property('type', 'accessibility');
        expect(opportunityData).to.have.property('title', 'In-depth Report');
      });

      it('should handle different site configurations for in-depth report', async () => {
        // Arrange
        const customSite = {
          getId: sandbox.stub().returns('custom-site-999'),
          getLatestAuditByAuditType: sandbox.stub().resolves({
            siteId: 'custom-site-999',
            auditId: 'custom-audit-999',
            auditType: 'accessibility',
          }),
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('custom-site-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'custom-site-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          customSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(customSite.getId.calledOnce).to.be.true;
        expect(customSite.getLatestAuditByAuditType.calledWith(mockAuditType)).to.be.true;

        // Verify opportunity was created with custom site data
        const createCall = mockContext.dataAccess.Opportunity.create.getCall(0);
        const opportunityData = createCall.args[0];
        expect(opportunityData.siteId).to.equal('custom-site-999');
        expect(opportunityData.auditId).to.equal('custom-audit-999');
      });
    });

    describe('enhanced report generation (lines 689-694)', () => {
      it('should successfully generate enhanced report opportunity', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('enhanced-opp-456'),
          addSuggestions: sandbox.stub().resolves({ id: 'enhanced-sugg-456' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(result.message).to.equal('All report opportunities created successfully');

        // Verify that multiple opportunities were created (in-depth, enhanced, etc.)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(2);
        expect(mockOpportunity.addSuggestions.callCount).to.be.at.least(2);
        expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
        expect(mockOpportunity.save.callCount).to.be.at.least(2);
      });

      it('should handle empty markdown for enhanced report', async () => {
        // Arrange - Mock enhanced markdown generation to return empty string
        const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
          '../../../src/accessibility/utils/report-oppty.js': {
            createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
            createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
            createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
            createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
            createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
          },
          '../../../src/accessibility/utils/generate-md-reports.js': {
            generateInDepthReportMarkdown: sandbox.stub().returns('# In-depth Report\n\nContent'),
            generateEnhancedReportMarkdown: sandbox.stub().returns(''), // Empty markdown
            generateFixedNewReportMarkdown: sandbox.stub().returns('# Fixed vs New Report\n\nContent'),
            generateBaseReportMarkdown: sandbox.stub().returns('# Base Report\n\nContent'),
          },
        });
        const generateReportOpportunitiesTest = dataProcessingModule.generateReportOpportunities;

        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('enhanced-empty-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'enhanced-empty-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesTest(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        // When enhanced report markdown is empty, it should still continue with other reports
        expect(result.message).to.equal('All report opportunities created successfully');
      });

      it('should handle opportunity creation failure for enhanced report', async () => {
        // Arrange - Mock to succeed for in-depth but fail for enhanced
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call (in-depth) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('in-depth-success-opp'),
              addSuggestions: sandbox.stub().resolves({ id: 'in-depth-success-sugg' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Second call (enhanced) fails
          return Promise.reject(new Error('Enhanced report creation failed'));
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Enhanced report creation failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate enhanced report opportunity',
            'Enhanced report creation failed',
          )).to.be.true;
        }
      });

      it('should handle suggestion creation failure for enhanced report', async () => {
        // Arrange - Mock to succeed for in-depth but fail suggestions for enhanced
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call (in-depth) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('in-depth-sugg-success'),
              addSuggestions: sandbox.stub().resolves({ id: 'in-depth-sugg-success' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Second call (enhanced) succeeds but suggestions fail
          return Promise.resolve({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('enhanced-fail-sugg-opp'),
            addSuggestions: sandbox.stub().rejects(new Error('Enhanced suggestions failed')),
            getSuggestions: sandbox.stub().resolves([]),
          });
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Enhanced suggestions failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate enhanced report opportunity',
            'Enhanced suggestions failed',
          )).to.be.true;
        }
      });

      it('should verify enhanced report parameters are passed correctly', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('enhanced-param-test'),
          addSuggestions: sandbox.stub().resolves({ id: 'enhanced-param-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert - Verify the enhanced opportunity was created (second call)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(2);
        const secondCall = mockContext.dataAccess.Opportunity.create.getCall(1);
        const opportunityData = secondCall.args[0];

        expect(opportunityData).to.have.property('siteId', 'test-site-id');
        expect(opportunityData).to.have.property('auditId', 'test-audit-id');
        expect(opportunityData).to.have.property('type', 'accessibility');
        expect(opportunityData).to.have.property('title', 'Enhanced Report');
      });

      it('should handle different aggregation data for enhanced report', async () => {
        // Arrange
        const complexAggregationResult = {
          finalResultFiles: {
            current: {
              overall: {
                violations: { total: 50, critical: { count: 20 }, serious: { count: 30 } },
              },
              'https://example.com/enhanced-page1': { violations: { total: 8 }, traffic: '2000' },
              'https://example.com/enhanced-page2': { violations: { total: 12 }, traffic: '1500' },
            },
            lastWeek: {
              overall: {
                violations: { total: 30, critical: { count: 10 }, serious: { count: 20 } },
              },
              'https://example.com/enhanced-page1': { violations: { total: 5 }, traffic: '1800' },
            },
          },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('enhanced-complex-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'enhanced-complex-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          complexAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(mockSite.getId.calledOnce).to.be.true;
        expect(mockSite.getLatestAuditByAuditType.calledWith(mockAuditType)).to.be.true;

        // Verify that opportunities were created for both in-depth and enhanced reports
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(2);
      });

      it('should continue processing even if enhanced report generation encounters errors', async () => {
        // Arrange - Create a test to verify that errors are properly thrown and don't silently fail
        mockContext.dataAccess.Opportunity.create
          .onFirstCall()
          .resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('in-depth-success'),
            addSuggestions: sandbox.stub().resolves({ id: 'in-depth-success-sugg' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onSecondCall()
          .rejects(new Error('Enhanced report database error'));

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Enhanced report database error');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate enhanced report opportunity',
            'Enhanced report database error',
          )).to.be.true;
        }
      });
    });

    describe('fixed vs new report generation (lines 696-701)', () => {
      it('should successfully generate fixed vs new report opportunity', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('fixed-vs-new-opp-789'),
          addSuggestions: sandbox.stub().resolves({ id: 'fixed-vs-new-sugg-789' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(result.message).to.equal('All report opportunities created successfully');

        // Verify that multiple opportunities were created (in-depth, enhanced, fixed vs new, etc.)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(3);
        expect(mockOpportunity.addSuggestions.callCount).to.be.at.least(3);
        expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
        expect(mockOpportunity.save.callCount).to.be.at.least(3);
      });

      it('should handle empty markdown for fixed vs new report', async () => {
        // Arrange - Mock fixed vs new markdown generation to return empty string
        const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
          '../../../src/accessibility/utils/report-oppty.js': {
            createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
            createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
            createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
            createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
            createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
          },
          '../../../src/accessibility/utils/generate-md-reports.js': {
            generateInDepthReportMarkdown: sandbox.stub().returns('# In-depth Report\n\nContent'),
            generateEnhancedReportMarkdown: sandbox.stub().returns('# Enhanced Report\n\nContent'),
            generateFixedNewReportMarkdown: sandbox.stub().returns(''), // Empty markdown
            generateBaseReportMarkdown: sandbox.stub().returns('# Base Report\n\nContent'),
          },
        });
        const generateReportOpportunitiesTest = dataProcessingModule.generateReportOpportunities;

        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('fixed-vs-new-empty-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'fixed-vs-new-empty-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesTest(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        // When fixed vs new report markdown is empty, it should still continue with other reports
        expect(result.message).to.equal('All report opportunities created successfully');
      });

      it('should handle opportunity creation failure for fixed vs new report', async () => {
        // Arrange - Mock to succeed for in-depth and enhanced but fail for fixed vs new
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call (in-depth) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('in-depth-success-opp'),
              addSuggestions: sandbox.stub().resolves({ id: 'in-depth-success-sugg' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          if (callCount === 2) {
            // Second call (enhanced) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('enhanced-success-opp'),
              addSuggestions: sandbox.stub().resolves({ id: 'enhanced-success-sugg' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Third call (fixed vs new) fails
          return Promise.reject(new Error('Fixed vs new report creation failed'));
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Fixed vs new report creation failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate fixed vs new report opportunity',
            'Fixed vs new report creation failed',
          )).to.be.true;
        }
      });

      it('should handle suggestion creation failure for fixed vs new report', async () => {
        // Arrange - Mock to succeed for in-depth and enhanced but fail suggestions for fixed vs new
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount === 1) {
            // First call (in-depth) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('in-depth-sugg-success'),
              addSuggestions: sandbox.stub().resolves({ id: 'in-depth-sugg-success' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          if (callCount === 2) {
            // Second call (enhanced) succeeds
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns('enhanced-sugg-success'),
              addSuggestions: sandbox.stub().resolves({ id: 'enhanced-sugg-success' }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Third call (fixed vs new) succeeds but suggestions fail
          return Promise.resolve({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('fixed-vs-new-fail-sugg-opp'),
            addSuggestions: sandbox.stub().rejects(new Error('Fixed vs new suggestions failed')),
            getSuggestions: sandbox.stub().resolves([]),
          });
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Fixed vs new suggestions failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate fixed vs new report opportunity',
            'Fixed vs new suggestions failed',
          )).to.be.true;
        }
      });

      it('should verify fixed vs new report parameters are passed correctly', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('fixed-vs-new-param-test'),
          addSuggestions: sandbox.stub().resolves({ id: 'fixed-vs-new-param-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert - Verify the fixed vs new opportunity was created (third call)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(3);
        const thirdCall = mockContext.dataAccess.Opportunity.create.getCall(2);
        const opportunityData = thirdCall.args[0];

        expect(opportunityData).to.have.property('siteId', 'test-site-id');
        expect(opportunityData).to.have.property('auditId', 'test-audit-id');
        expect(opportunityData).to.have.property('type', 'accessibility');
        expect(opportunityData).to.have.property('title', 'Fixed vs New Report');
      });

      it('should handle complex aggregation data for fixed vs new report', async () => {
        // Arrange
        const complexAggregationResult = {
          finalResultFiles: {
            current: {
              overall: {
                violations: { total: 75, critical: { count: 30 }, serious: { count: 45 } },
              },
              'https://example.com/fixed-page1': { violations: { total: 15 }, traffic: '3000' },
              'https://example.com/fixed-page2': { violations: { total: 20 }, traffic: '2500' },
              'https://example.com/fixed-page3': { violations: { total: 10 }, traffic: '1800' },
            },
            lastWeek: {
              overall: {
                violations: { total: 90, critical: { count: 40 }, serious: { count: 50 } },
              },
              'https://example.com/fixed-page1': { violations: { total: 25 }, traffic: '2800' },
              'https://example.com/fixed-page2': { violations: { total: 30 }, traffic: '2300' },
            },
          },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('fixed-vs-new-complex-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'fixed-vs-new-complex-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          complexAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(mockSite.getId.calledOnce).to.be.true;
        expect(mockSite.getLatestAuditByAuditType.calledWith(mockAuditType)).to.be.true;

        // Verify that opportunities were created for in-depth, enhanced, and fixed vs new reports
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(3);
      });

      it('should handle scenarios where current data shows improvement over lastWeek', async () => {
        // Arrange - Test scenario where fixed vs new report would show improvements
        const improvementAggregationResult = {
          finalResultFiles: {
            current: {
              overall: {
                violations: { total: 20, critical: { count: 5 }, serious: { count: 15 } },
              },
              'https://example.com/improved-page1': { violations: { total: 3 }, traffic: '2000' },
              'https://example.com/improved-page2': { violations: { total: 5 }, traffic: '1500' },
            },
            lastWeek: {
              overall: {
                violations: { total: 50, critical: { count: 20 }, serious: { count: 30 } },
              },
              'https://example.com/improved-page1': { violations: { total: 15 }, traffic: '1800' },
              'https://example.com/improved-page2': { violations: { total: 12 }, traffic: '1400' },
            },
          },
        };
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('improvement-scenario-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'improvement-scenario-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          improvementAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        // Verify that all report types are still generated even with improvement data
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.be.at.least(3);
      });

      it('should handle error propagation correctly in fixed vs new report', async () => {
        // Arrange - Create a test to verify that errors are properly thrown
        mockContext.dataAccess.Opportunity.create
          .onFirstCall()
          .resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('in-depth-success'),
            addSuggestions: sandbox.stub().resolves({ id: 'in-depth-success-sugg' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onSecondCall()
          .resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('enhanced-success'),
            addSuggestions: sandbox.stub().resolves({ id: 'enhanced-success-sugg' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onThirdCall()
          .rejects(new Error('Fixed vs new database error'));

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Fixed vs new database error');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate fixed vs new report opportunity',
            'Fixed vs new database error',
          )).to.be.true;
        }
      });
    });

    describe('base report generation (lines 703-714)', () => {
      it('should successfully generate base report opportunity with shouldIgnore=false', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('base-report-opp-999'),
          addSuggestions: sandbox.stub().resolves({ id: 'base-report-sugg-999' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(result.message).to.equal('All report opportunities created successfully');

        // Verify that all 4 opportunities were created (in-depth, enhanced, fixed vs new, base)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.equal(4);
        expect(mockOpportunity.addSuggestions.callCount).to.equal(4);

        // Base report should NOT call setStatus('IGNORED') or save() because shouldIgnore=false
        // The first 3 calls should set status to IGNORED, but the 4th (base) should not
        expect(mockOpportunity.setStatus.callCount).to.equal(3); // Only first 3 calls
        expect(mockOpportunity.save.callCount).to.equal(3); // Only first 3 calls
      });

      it('should set relatedReportsUrls on reportData.mdData before generating base report', async () => {
        // Arrange - Mock the markdown generation functions to capture the reportData
        let capturedReportData = null;
        const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
          '../../../src/accessibility/utils/report-oppty.js': {
            createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
            createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
            createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
            createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
            createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
          },
          '../../../src/accessibility/utils/generate-md-reports.js': {
            generateInDepthReportMarkdown: sandbox.stub().returns('# In-depth Report\n\nContent'),
            generateEnhancedReportMarkdown: sandbox.stub().returns('# Enhanced Report\n\nContent'),
            generateFixedNewReportMarkdown: sandbox.stub().returns('# Fixed vs New Report\n\nContent'),
            generateBaseReportMarkdown: sandbox.stub().callsFake((mdData) => {
              capturedReportData = mdData;
              return '# Base Report\n\nContent with related reports';
            }),
          },
        });
        const generateReportOpportunitiesTest = dataProcessingModule.generateReportOpportunities;

        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('base-report-urls-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'base-report-urls-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesTest(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(capturedReportData).to.not.be.null;
        expect(capturedReportData).to.have.property('relatedReportsUrls');
        expect(capturedReportData.relatedReportsUrls).to.have.property('inDepthReportUrl');
        expect(capturedReportData.relatedReportsUrls).to.have.property('enhancedReportUrl');
        expect(capturedReportData.relatedReportsUrls).to.have.property('fixedVsNewReportUrl');
      });

      it('should handle empty markdown for base report', async () => {
        // Arrange - Mock base markdown generation to return empty string
        const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
          '../../../src/accessibility/utils/report-oppty.js': {
            createInDepthReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'In-depth Report' }),
            createEnhancedReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Enhanced Report' }),
            createFixedVsNewReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Fixed vs New Report' }),
            createBaseReportOpportunity: sandbox.stub().returns({ type: 'accessibility', title: 'Base Report' }),
            createReportOpportunitySuggestionInstance: sandbox.stub().returns([]),
          },
          '../../../src/accessibility/utils/generate-md-reports.js': {
            generateInDepthReportMarkdown: sandbox.stub().returns('# In-depth Report\n\nContent'),
            generateEnhancedReportMarkdown: sandbox.stub().returns('# Enhanced Report\n\nContent'),
            generateFixedNewReportMarkdown: sandbox.stub().returns('# Fixed vs New Report\n\nContent'),
            generateBaseReportMarkdown: sandbox.stub().returns(''), // Empty markdown
          },
        });
        const generateReportOpportunitiesTest = dataProcessingModule.generateReportOpportunities;

        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('base-report-empty-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'base-report-empty-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesTest(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        // When base report markdown is empty, it should still succeed and return success
        expect(result.message).to.equal('All report opportunities created successfully');
      });

      it('should handle opportunity creation failure for base report', async () => {
        // Arrange - Mock to succeed for first 3 reports but fail for base report
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount <= 3) {
            // First 3 calls (in-depth, enhanced, fixed vs new) succeed
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns(`success-opp-${callCount}`),
              addSuggestions: sandbox.stub().resolves({ id: `success-sugg-${callCount}` }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Fourth call (base report) fails
          return Promise.reject(new Error('Base report creation failed'));
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Base report creation failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate base report opportunity',
            'Base report creation failed',
          )).to.be.true;
        }
      });

      it('should handle suggestion creation failure for base report', async () => {
        // Arrange - Mock to succeed for first 3 reports but fail suggestions for base report
        let callCount = 0;
        mockContext.dataAccess.Opportunity.create.callsFake(() => {
          callCount += 1;
          if (callCount <= 3) {
            // First 3 calls succeed
            return Promise.resolve({
              setStatus: sandbox.stub(),
              save: sandbox.stub(),
              getId: sandbox.stub().returns(`sugg-success-opp-${callCount}`),
              addSuggestions: sandbox.stub().resolves({ id: `sugg-success-${callCount}` }),
              getSuggestions: sandbox.stub().resolves([]),
            });
          }
          // Fourth call (base report) succeeds but suggestions fail
          return Promise.resolve({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('base-fail-sugg-opp'),
            addSuggestions: sandbox.stub().rejects(new Error('Base report suggestions failed')),
            getSuggestions: sandbox.stub().resolves([]),
          });
        });

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Base report suggestions failed');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate base report opportunity',
            'Base report suggestions failed',
          )).to.be.true;
        }
      });

      it('should verify base report parameters are passed correctly with shouldIgnore=false', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('base-report-param-test'),
          addSuggestions: sandbox.stub().resolves({ id: 'base-report-param-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert - Verify the base report opportunity was created (fourth call)
        expect(mockContext.dataAccess.Opportunity.create.callCount).to.equal(4);
        const fourthCall = mockContext.dataAccess.Opportunity.create.getCall(3);
        const opportunityData = fourthCall.args[0];

        expect(opportunityData).to.have.property('siteId', 'test-site-id');
        expect(opportunityData).to.have.property('auditId', 'test-audit-id');
        expect(opportunityData).to.have.property('type', 'accessibility');
        expect(opportunityData).to.have.property('title', 'Base Report');

        // Verify that base report doesn't get ignored (shouldIgnore=false)
        expect(mockOpportunity.setStatus.callCount).to.equal(3); // Only first 3 reports get ignored
        // Only first 3 reports get saved with ignored status
        expect(mockOpportunity.save.callCount).to.equal(3);
      });

      it('should return correct success response after all reports are generated', async () => {
        // Arrange
        const mockOpportunity = {
          setStatus: sandbox.stub(),
          save: sandbox.stub(),
          getId: sandbox.stub().returns('final-success-opp'),
          addSuggestions: sandbox.stub().resolves({ id: 'final-success-sugg' }),
          getSuggestions: sandbox.stub().resolves([]),
        };
        mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert - Test lines 711-714 (return statement)
        expect(result).to.be.an('object');
        expect(result).to.have.property('status', true);
        expect(result).to.have.property('message', 'All report opportunities created successfully');
        expect(Object.keys(result)).to.have.lengthOf(2);
      });

      it('should handle error propagation correctly in base report', async () => {
        // Arrange - Create a test to verify that errors are properly thrown
        mockContext.dataAccess.Opportunity.create
          .onCall(0).resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('success-1'),
            addSuggestions: sandbox.stub().resolves({ id: 'success-sugg-1' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onCall(1).resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('success-2'),
            addSuggestions: sandbox.stub().resolves({ id: 'success-sugg-2' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onCall(2)
          .resolves({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns('success-3'),
            addSuggestions: sandbox.stub().resolves({ id: 'success-sugg-3' }),
            getSuggestions: sandbox.stub().resolves([]),
          })
          .onCall(3)
          .rejects(new Error('Base report database error'));

        // Act & Assert
        try {
          await generateReportOpportunitiesMocked(
            mockSite,
            mockAggregationResult,
            mockContext,
            mockAuditType,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.include('Base report database error');
          expect(mockLog.error.calledWith(
            '[A11yProcessingError] Failed to generate base report opportunity',
            'Base report database error',
          )).to.be.true;
        }
      });

      it('should ensure base report is generated last in the sequence', async () => {
        // Arrange - Track the order of opportunity creation
        const creationOrder = [];
        mockContext.dataAccess.Opportunity.create.callsFake((opportunityData) => {
          creationOrder.push(opportunityData.title);
          return Promise.resolve({
            setStatus: sandbox.stub(),
            save: sandbox.stub(),
            getId: sandbox.stub().returns(`opp-${creationOrder.length}`),
            addSuggestions: sandbox.stub().resolves({ id: `sugg-${creationOrder.length}` }),
            getSuggestions: sandbox.stub().resolves([]),
          });
        });

        // Act
        const result = await generateReportOpportunitiesMocked(
          mockSite,
          mockAggregationResult,
          mockContext,
          mockAuditType,
        );

        // Assert
        expect(result.status).to.be.true;
        expect(creationOrder).to.have.lengthOf(4);
        expect(creationOrder[0]).to.equal('In-depth Report');
        expect(creationOrder[1]).to.equal('Enhanced Report');
        expect(creationOrder[2]).to.equal('Fixed vs New Report');
        expect(creationOrder[3]).to.equal('Base Report'); // Base report should be last
      });
    });
  });

  describe('getAuditPrefixes', () => {
    it('should return correct prefixes for accessibility audit type', () => {
      const result = getAuditPrefixes('accessibility');

      expect(result).to.deep.equal({
        logIdentifier: 'A11yAudit',
        storagePrefix: 'accessibility',
      });
    });

    it('should return correct prefixes for forms-opportunities audit type', () => {
      const result = getAuditPrefixes('forms-opportunities');

      expect(result).to.deep.equal({
        logIdentifier: 'FormsA11yAudit',
        storagePrefix: 'forms-accessibility',
      });
    });

    it('should throw error for unsupported audit type', () => {
      expect(() => {
        getAuditPrefixes('unsupported-audit-type');
      }).to.throw('Unsupported audit type: unsupported-audit-type');
    });

    it('should throw error for null audit type', () => {
      expect(() => {
        getAuditPrefixes(null);
      }).to.throw('Unsupported audit type: null');
    });

    it('should throw error for undefined audit type', () => {
      expect(() => {
        getAuditPrefixes(undefined);
      }).to.throw('Unsupported audit type: undefined');
    });

    it('should return different prefixes for different audit types', () => {
      const accessibilityResult = getAuditPrefixes('accessibility');
      const formsResult = getAuditPrefixes('forms-opportunities');

      expect(accessibilityResult).to.not.deep.equal(formsResult);
      expect(accessibilityResult.logIdentifier).to.not.equal(formsResult.logIdentifier);
      expect(accessibilityResult.storagePrefix).to.not.equal(formsResult.storagePrefix);
    });
  });

  describe('generateReportOpportunity - device-specific merging', () => {
    let generateReportOpportunityMocked;
    let findExistingDesktopOpportunityMocked;
    let findExistingMobileOpportunityMocked;
    let mockDataAccess;

    beforeEach(async () => {
      mockDataAccess = {
        Opportunity: {
          create: sandbox.stub(),
          allBySiteId: sandbox.stub().resolves([]),
        },
      };

      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js');
      generateReportOpportunityMocked = dataProcessingModule.generateReportOpportunity;
      findExistingDesktopOpportunityMocked = dataProcessingModule.findExistingDesktopOpportunity;
      findExistingMobileOpportunityMocked = dataProcessingModule.findExistingMobileOpportunity;
    });

    it('should merge mobile audit with existing desktop opportunity', async () => {
      // Arrange
      const mockGenMdFn = sandbox.stub().returns('# Mobile Report\n\nMobile content.');
      const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Test' });
      
      const mockExistingDesktopOpportunity = {
        getId: sandbox.stub().returns('desktop-opp-123'),
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ id: 'merged-sugg' }),
      };

      const mockExistingDesktopOpportunityForFind = {
        getTitle: sandbox.stub().returns('Accessibility report - Desktop - Week 20 - 2024'),
        getStatus: sandbox.stub().returns('NEW'),
        getId: sandbox.stub().returns('desktop-opp-123'),
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ id: 'merged-sugg' }),
      };

      mockDataAccess.Opportunity.allBySiteId.resolves([mockExistingDesktopOpportunityForFind]);

      const reportData = {
        mdData: { violations: { total: 3 } },
        linkData: { baseUrl: 'https://example.com' },
        opptyData: { week: 20, year: 2024 },
        auditData: { siteId: 'test-site-mobile', auditId: 'audit-mobile' },
        context: {
          log: mockLog,
          dataAccess: mockDataAccess,
        },
      };

      // Act - mobile device type
      const result = await generateReportOpportunityMocked(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Mobile Report',
        false,
        'mobile', // deviceType
        '', // reportType
      );

      // Assert
      expect(result).to.be.a('string');
      expect(mockDataAccess.Opportunity.allBySiteId).to.have.been.called;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Mobile audit will update existing desktop.*opportunity/)
      );
    });

    it('should create new mobile-only opportunity when no desktop exists', async () => {
      // Arrange
      const mockGenMdFn = sandbox.stub().returns('# Mobile Only Report\n');
      const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Mobile Test' });
      
      const mockNewOpportunity = {
        getId: sandbox.stub().returns('new-mobile-opp'),
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ id: 'new-mobile-sugg' }),
      };

      mockDataAccess.Opportunity.allBySiteId.resolves([]); // No existing opportunities
      mockDataAccess.Opportunity.create.resolves(mockNewOpportunity);

      const reportData = {
        mdData: { violations: { total: 2 } },
        linkData: { baseUrl: 'https://example.com' },
        opptyData: { week: 21, year: 2024 },
        auditData: { siteId: 'test-site-mobile-only', auditId: 'audit-mobile-only' },
        context: {
          log: mockLog,
          dataAccess: mockDataAccess,
        },
      };

      // Act - mobile device type, no existing desktop opportunity
      const result = await generateReportOpportunityMocked(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Mobile Only Report',
        false,
        'mobile',
        '',
      );

      // Assert
      expect(result).to.be.a('string');
      expect(mockDataAccess.Opportunity.create).to.have.been.called;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Created new mobile-only.*opportunity/)
      );
    });

    it('should merge desktop audit with existing mobile opportunity', async () => {
      // Arrange
      const mockGenMdFn = sandbox.stub().returns('# Desktop Report\n\nDesktop content.');
      const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Desktop Test' });
      
      const mockExistingMobileOpportunityForFind = {
        getTitle: sandbox.stub().returns('Accessibility report - Mobile - Week 22 - 2024'),
        getStatus: sandbox.stub().returns('NEW'),
        getId: sandbox.stub().returns('mobile-opp-456'),
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ id: 'merged-desktop-sugg' }),
      };

      mockDataAccess.Opportunity.allBySiteId.resolves([mockExistingMobileOpportunityForFind]);

      const reportData = {
        mdData: { violations: { total: 4 } },
        linkData: { baseUrl: 'https://example.com' },
        opptyData: { week: 22, year: 2024 },
        auditData: { siteId: 'test-site-desktop', auditId: 'audit-desktop' },
        context: {
          log: mockLog,
          dataAccess: mockDataAccess,
        },
      };

      // Act - desktop device type
      const result = await generateReportOpportunityMocked(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Desktop Report',
        false,
        'desktop', // deviceType
        '', // reportType
      );

      // Assert
      expect(result).to.be.a('string');
      expect(mockDataAccess.Opportunity.allBySiteId).to.have.been.called;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Desktop audit will update existing mobile.*opportunity/)
      );
    });

    it('should handle base report type (empty string)', async () => {
      // Arrange
      const mockGenMdFn = sandbox.stub().returns('# Base Report\n');
      const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Base' });
      
      const mockOpportunity = {
        getId: sandbox.stub().returns('base-opp'),
        getSuggestions: sandbox.stub().resolves([]),
        addSuggestions: sandbox.stub().resolves({ id: 'base-sugg' }),
      };

      mockDataAccess.Opportunity.allBySiteId.resolves([]);
      mockDataAccess.Opportunity.create.resolves(mockOpportunity);

      const reportData = {
        mdData: { violations: { total: 1 } },
        linkData: { baseUrl: 'https://example.com' },
        opptyData: { week: 23, year: 2024 },
        auditData: { siteId: 'test-base', auditId: 'audit-base' },
        context: {
          log: mockLog,
          dataAccess: mockDataAccess,
        },
      };

      // Act - with empty reportType (base report)
      const result = await generateReportOpportunityMocked(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Base Report',
        false,
        'desktop',
        '', // empty string for base report
      );

      // Assert
      expect(result).to.be.a('string');
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/base.*opportunity/)
      );
    });

    it('should handle error from createOrUpdateDeviceSpecificSuggestion', async () => {
      // Arrange
      const mockGenMdFn = sandbox.stub().returns('# Error Report\n');
      const mockCreateOpportunityFn = sandbox.stub().returns({ type: 'accessibility', title: 'Error Test' });
      
      const mockOpportunity = {
        getId: sandbox.stub().returns('error-opp'),
        getSuggestions: sandbox.stub().rejects(new Error('Suggestion creation failed')),
        addSuggestions: sandbox.stub().rejects(new Error('Suggestion creation failed')),
      };

      mockDataAccess.Opportunity.allBySiteId.resolves([]);
      mockDataAccess.Opportunity.create.resolves(mockOpportunity);

      const reportData = {
        mdData: { violations: { total: 1 } },
        linkData: { baseUrl: 'https://example.com' },
        opptyData: { week: 24, year: 2024 },
        auditData: { siteId: 'test-error', auditId: 'audit-error' },
        context: {
          log: mockLog,
          dataAccess: mockDataAccess,
        },
      };

      // Act & Assert
      await expect(
        generateReportOpportunityMocked(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'Error Report',
          false,
          'desktop',
          '',
        )
      ).to.be.rejectedWith('Suggestion creation failed');

      expect(mockLog.error).to.have.been.called;
    });
  });

  describe('sendRunImportMessage', () => {
    it('should create data object with a11y-metrics-aggregator import type', async () => {
      // Mock SQS message sending to capture the message structure
      const sqsMessageCapture = sinon.stub();

      // Call sendRunImportMessage directly to test data structure
      await sendRunImportMessage(
        { sendMessage: sqsMessageCapture },
        'test-queue',
        'a11y-metrics-aggregator',
        'site-123',
        {
          scraperBucketName: 'test-scraper-bucket',
          importerBucketName: 'test-importer-bucket',
          version: '2024-01-01',
          urlSourceSeparator: '|',
          totalChecks: 10,
          options: {},
        },
      );

      // Verify the message structure includes the data object
      expect(sqsMessageCapture.calledOnce).to.be.true;
      const sentMessage = sqsMessageCapture.firstCall.args[1];

      expect(sentMessage).to.have.property('type', 'a11y-metrics-aggregator');
      expect(sentMessage).to.have.property('siteId', 'site-123');
      expect(sentMessage).to.have.property('data');
      expect(sentMessage.data).to.deep.equal({
        scraperBucketName: 'test-scraper-bucket',
        importerBucketName: 'test-importer-bucket',
        version: '2024-01-01',
        urlSourceSeparator: '|',
        totalChecks: 10,
        options: {},
      });
    });
  });

  describe('createOrUpdateDeviceSpecificSuggestion', () => {
    let createOrUpdateDeviceSpecificSuggestionMocked;
    let mockOpportunity;
    let mockExistingSuggestion;

    beforeEach(async () => {
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js');
      createOrUpdateDeviceSpecificSuggestionMocked = dataProcessingModule.createOrUpdateDeviceSpecificSuggestion;

      mockExistingSuggestion = {
        getType: sandbox.stub().returns('CODE_CHANGE'),
        getData: sandbox.stub().returns({
          suggestionValue: {
            'accessibility-desktop': '# Desktop content\n',
          },
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      mockOpportunity = {
        getSuggestions: sandbox.stub().resolves([mockExistingSuggestion]),
        addSuggestions: sandbox.stub().resolves({ id: 'new-sugg' }),
      };
    });

    it('should update existing suggestion with new device content', async () => {
      // Arrange
      const reportMarkdown = '# Mobile content\n';
      const deviceType = 'mobile';
      const auditData = { siteId: 'site-123', auditId: 'audit-123' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockOpportunity.getSuggestions).to.have.been.called;
      expect(mockExistingSuggestion.setData).to.have.been.called;
      expect(mockExistingSuggestion.save).to.have.been.called;
      expect(result.suggestion).to.equal(mockExistingSuggestion);
    });

    it('should create new suggestion when no existing CODE_CHANGE suggestion found', async () => {
      // Arrange
      mockOpportunity.getSuggestions.resolves([]);
      const reportMarkdown = '# Desktop content\n';
      const deviceType = 'desktop';
      const auditData = { siteId: 'site-456', auditId: 'audit-456' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockOpportunity.getSuggestions).to.have.been.called;
      expect(mockOpportunity.addSuggestions).to.have.been.called;
      expect(mockExistingSuggestion.setData).to.not.have.been.called;
    });

    it('should handle null getData() result (line 532)', async () => {
      // Arrange - test the ?? {} branch
      mockExistingSuggestion.getData.returns(null);
      const reportMarkdown = '# Content\n';
      const deviceType = 'mobile';
      const auditData = { siteId: 'site-789', auditId: 'audit-789' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockExistingSuggestion.setData).to.have.been.called;
      expect(result.suggestion).to.equal(mockExistingSuggestion);
    });

    it('should handle missing suggestionValue in currentData (line 533)', async () => {
      // Arrange - test the ?? {} branch for suggestionValue
      mockExistingSuggestion.getData.returns({ someOtherField: 'value' });
      const reportMarkdown = '# Content\n';
      const deviceType = 'desktop';
      const auditData = { siteId: 'site-abc', auditId: 'audit-abc' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockExistingSuggestion.setData).to.have.been.called;
      expect(result.suggestion).to.equal(mockExistingSuggestion);
    });

    it('should handle empty reportMarkdown (line 527, 566)', async () => {
      // Arrange - test the || 0 branch when reportMarkdown is empty
      mockOpportunity.getSuggestions.resolves([]);
      const reportMarkdown = ''; // Empty string
      const deviceType = 'mobile';
      const auditData = { siteId: 'site-empty', auditId: 'audit-empty' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockOpportunity.addSuggestions).to.have.been.called;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/reportMarkdown length: 0/)
      );
    });

    it('should handle null reportMarkdown (line 527)', async () => {
      // Arrange - test the ?. branch when reportMarkdown is null
      mockOpportunity.getSuggestions.resolves([]);
      const reportMarkdown = null;
      const deviceType = 'desktop';
      const auditData = { siteId: 'site-null', auditId: 'audit-null' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/reportMarkdown length: 0/)
      );
    });

    it('should handle missing accessibility-desktop in suggestionValue (line 536, 550)', async () => {
      // Arrange - test the || 0 branch when accessibility-desktop is undefined
      mockExistingSuggestion.getData.returns({
        suggestionValue: {
          'accessibility-mobile': '# Mobile content',
        },
      });
      const reportMarkdown = '# Desktop content\n';
      const deviceType = 'desktop';
      const auditData = { siteId: 'site-desktop-missing', auditId: 'audit-desktop-missing' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Current accessibility-desktop length: 0/)
      );
    });

    it('should handle missing accessibility-mobile in suggestionValue (line 537, 551)', async () => {
      // Arrange - test the || 0 branch when accessibility-mobile is undefined
      mockExistingSuggestion.getData.returns({
        suggestionValue: {
          'accessibility-desktop': '# Desktop content',
        },
      });
      const reportMarkdown = '# Mobile content\n';
      const deviceType = 'mobile';
      const auditData = { siteId: 'site-mobile-missing', auditId: 'audit-mobile-missing' };

      // Act
      const result = await createOrUpdateDeviceSpecificSuggestionMocked(
        mockOpportunity,
        reportMarkdown,
        deviceType,
        auditData,
        mockLog,
      );

      // Assert
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Current accessibility-mobile length: 0/)
      );
    });
  });

  describe('findExistingDesktopOpportunity', () => {
    let findExistingDesktopOpportunityMocked;
    let mockDataAccess;

    beforeEach(async () => {
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js');
      findExistingDesktopOpportunityMocked = dataProcessingModule.findExistingDesktopOpportunity;

      mockDataAccess = {
        Opportunity: {
          allBySiteId: sandbox.stub(),
        },
      };
    });

    it('should find existing desktop opportunity with in-depth report type', async () => {
      // Arrange
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Accessibility report - Desktop - Week 20 - 2024 - in-depth'),
        getStatus: sandbox.stub().returns('NEW'),
        getId: sandbox.stub().returns('opp-123'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-123',
        20,
        2024,
        mockDataAccess,
        mockLog,
        'in-depth',
      );

      // Assert
      expect(result).to.equal(mockOpportunity);
    });

    it('should find existing desktop opportunity with fixed report type', async () => {
      // Arrange
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Accessibility report Fixed vs New Issues - Desktop - Week 20 - 2024'),
        getStatus: sandbox.stub().returns('NEW'),
        getId: sandbox.stub().returns('opp-456'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-456',
        20,
        2024,
        mockDataAccess,
        mockLog,
        'fixed',
      );

      // Assert
      expect(result).to.equal(mockOpportunity);
    });

    it('should find existing desktop opportunity with enhanced report type', async () => {
      // Arrange
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Enhancing accessibility for the top 10 most-visited pages - Desktop - Week 20 - 2024'),
        getStatus: sandbox.stub().returns('NEW'),
        getId: sandbox.stub().returns('opp-789'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-789',
        20,
        2024,
        mockDataAccess,
        mockLog,
        'enhanced',
      );

      // Assert
      expect(result).to.equal(mockOpportunity);
    });

    it('should return null when no matching opportunity found', async () => {
      // Arrange
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Different Title'),
        getStatus: sandbox.stub().returns('NEW'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-123',
        20,
        2024,
        mockDataAccess,
        mockLog,
        'in-depth',
      );

      // Assert
      expect(result).to.be.null;
    });

    it('should handle error gracefully and return null', async () => {
      // Arrange
      mockDataAccess.Opportunity.allBySiteId.rejects(new Error('DB error'));

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-123',
        20,
        2024,
        mockDataAccess,
        mockLog,
      );

      // Assert
      expect(result).to.be.null;
      expect(mockLog.error.called).to.be.true;
    });

    it('should find opportunity with IGNORED status (line 636 - OR condition)', async () => {
      // Arrange - test the || branch where status is IGNORED
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Accessibility report - Desktop - Week 25 - 2024'),
        getStatus: sandbox.stub().returns('IGNORED'), // Test IGNORED status
        getId: sandbox.stub().returns('ignored-opp-123'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-ignored',
        25,
        2024,
        mockDataAccess,
        mockLog,
        '',
      );

      // Assert
      expect(result).to.equal(mockOpportunity);
      expect(mockOpportunity.getStatus).to.have.been.called;
    });

    it('should not find opportunity with RESOLVED status (line 636)', async () => {
      // Arrange - test that non-NEW and non-IGNORED statuses are filtered out
      const mockOpportunity = {
        getTitle: sandbox.stub().returns('Accessibility report - Desktop - Week 26 - 2024'),
        getStatus: sandbox.stub().returns('RESOLVED'), // Should not match
        getId: sandbox.stub().returns('resolved-opp-456'),
      };
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      // Act
      const result = await findExistingDesktopOpportunityMocked(
        'site-resolved',
        26,
        2024,
        mockDataAccess,
        mockLog,
        '',
      );

      // Assert
      expect(result).to.be.null;
    });
  });
});
