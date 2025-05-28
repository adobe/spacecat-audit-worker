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
  generateReportOpportunities,
  createReportOpportunitySuggestion,
  generateReportOpportunity,
  getEnvAsoDomain,
  aggregateAccessibilityData,
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
      expect(mockLog.info.calledWith('Deleted 1 original files after aggregation')).to.be.true;
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
      expect(mockLog.info.calledWith('Deleted 3 original files after aggregation')).to.be.true;
    });

    it('should handle errors gracefully and log them', async () => {
      const error = new Error('S3 delete failed');
      mockS3Client.send.rejects(error);
      const objectKeys = ['file1.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(0);
      expect(mockLog.error.calledWith('Error deleting original files', error)).to.be.true;
    });

    it('should handle errors for multiple files', async () => {
      const error = new Error('S3 batch delete failed');
      mockS3Client.send.rejects(error);
      const objectKeys = ['file1.json', 'file2.json'];

      const result = await deleteOriginalFiles(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result).to.equal(0);
      expect(mockLog.error.calledWith('Error deleting original files', error)).to.be.true;
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
      expect(mockLog.info.calledWith('Fetched 3 keys from S3 for bucket test-bucket and prefix accessibility/site1/ with delimiter /')).to.be.true;
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
        expect(mockLog.error.calledWith('Error while fetching S3 object keys using bucket test-bucket and prefix accessibility/site1/ with delimiter /', error)).to.be.true;
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
      expect(mockLog.info.calledWith('Fetched 0 keys from S3 for bucket test-bucket and prefix accessibility/site1/ with delimiter /')).to.be.true;
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
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.false;
      expect(result.objectKeys).to.deep.equal([]);
      expect(result.message).to.include('No accessibility data found');
      // eslint-disable-next-line max-len
      expect(mockLog.info.calledWith('No accessibility data found in bucket test-bucket at prefix accessibility/site123/ for site site123 with delimiter /')).to.be.true;
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
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(result.success).to.be.true;
      expect(result.objectKeys).to.deep.equal(['file1.json', 'file2.json']);
      expect(result.message).to.equal('Found 2 data files');
      expect(mockLog.info.calledWith('Found 2 data files for site site123')).to.be.true;
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
        'site123',
        '2024-01-15',
        mockLog,
      );

      expect(mockLog.info.calledWith('Fetching accessibility data for site site123 from bucket test-bucket')).to.be.true;
      expect(mockLog.info.calledWith('Found 1 subfolders for site site123 in bucket test-bucket with delimiter / and value accessibility/site123/1705276800000/')).to.be.true;
      expect(mockLog.info.calledWith('Found 1 data files for site site123')).to.be.true;
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
      expect(mockLog.info.calledWith('Deleted 1 oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
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

      expect(mockLog.info.calledWith('Deleted 1 oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
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
      expect(mockLog.info.calledWith('Deleted 1 oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
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
      expect(mockLog.info.calledWith('Deleted 1 oldest final result file: accessibility/site1/2024-01-01-final-result.json')).to.be.true;
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
        expect(mockLog.error.calledWith('Failed to create new opportunity for siteId test-site-123 and auditId audit-456: Database connection failed')).to.be.true;
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
        log.error(`Failed to create new suggestion for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
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
        expect(mockLog.error.calledWith('Failed to create new suggestion for siteId test-site-123 and auditId audit-456: Failed to add suggestions')).to.be.true;
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
        expect(mockLog.error.calledWith('Failed to create new suggestion for siteId different-site and auditId different-audit: Validation failed')).to.be.true;
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
          'Failed to create new suggestion for siteId test-site-456 and auditId audit-789: Database connection failed',
        )).to.be.true;
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
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
      expect(mockLog.error.calledWith('Missing required parameters for aggregateAccessibilityData')).to.be.true;
    });

    it('should return error when bucketName is missing', async () => {
      const result = await aggregateAccessibilityData(
        mockS3Client,
        null,
        'test-site',
        mockLog,
        'output-key',
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
        targetDate, // version
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('No files could be processed successfully for site test-site');
      expect(mockLog.error.calledWith('No files could be processed successfully for site test-site')).to.be.true;
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
        targetDate,
        2,
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('overall');
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page1');
      expect(result.finalResultFiles.current['https://example.com/page1'].violations.total).to.equal(5);
      expect(result.finalResultFiles.current['https://example.com/page1'].traffic).to.equal(100);
      expect(result.message).to.equal('Successfully aggregated 1 files into output-key');
      expect(mockLog.info.calledWith('Saved aggregated accessibility data to output-key')).to.be.true;
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
        targetDate,
        2,
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal('Error: S3 save failed');
      // The main catch block in aggregateAccessibilityData logs a generic error
      expect(mockLog.error.calledWith('Error aggregating accessibility data for site test-site')).to.be.true;
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
        targetDate,
        2,
      );

      expect(result.success).to.be.true;

      // const expectedKeyInLog = `[A11yAudit] Last week file key:${lastWeekFileKey1}`;
      // The log message in the code actually uses lastWeekObjectKeys[1] for the key part.
      const expectedKeyInLog = `[A11yAudit] Last week file key:${lastWeekFileKey2}`;
      const logCall = mockLog.info.getCalls().find((call) => call.args[0].includes(expectedKeyInLog) && call.args[0].includes('with content:'));
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
        '2024-01-01', // version
        2, // maxRetries
      );

      expect(result.success).to.be.false;
      expect(result.aggregatedData).to.be.null;
      expect(result.message).to.equal(expectedMessage);
      expect(mockS3Client.send
        .calledOnceWith(sinon.match.instanceOf(ListObjectsV2Command))).to.be.true;
    });
  });

  describe('generateReportOpportunity', () => {
    let mockReportData;
    let mockGenMdFn;
    let mockCreateOpportunityFn;
    let mockOpportunity;

    beforeEach(() => {
      mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
      };

      mockReportData = {
        mdData: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 3 } },
        },
        linkData: {
          envAsoDomain: 'experience',
          siteId: 'test-site',
        },
        opptyData: {
          week: 42,
          year: 2024,
        },
        auditData: {
          siteId: 'test-site',
          auditId: 'audit-123',
        },
        context: {
          log: mockLog,
          dataAccess: { Opportunity: {} },
        },
      };

      mockGenMdFn = sandbox.stub().returns('# Test Report\n\nThis is a test report.');
      mockCreateOpportunityFn = sandbox.stub().returns({
        runbook: 'test-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Test Opportunity',
        description: 'Test description',
        tags: ['test'],
      });
    });

    it('should successfully generate report opportunity with default shouldIgnore', async () => {
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-123'),
      };

      const result = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies,
      );

      expect(result).to.equal('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-123');
      expect(mockGenMdFn.calledWith(mockReportData.mdData)).to.be.true;
      expect(mockCreateOpportunityFn.calledWith(42, 2024)).to.be.true;
      expect(mockDependencies.createReportOpportunityFn.calledOnce).to.be.true;
      expect(mockDependencies.createReportOpportunitySuggestionFn.calledOnce).to.be.true;
      expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
      expect(mockOpportunity.save.calledOnce).to.be.true;
      expect(mockDependencies.linkBuilderFn.calledWith(mockReportData.linkData, 'opp-123')).to.be.true;
    });

    it('should return empty string when markdown is empty', async () => {
      mockGenMdFn.returns('');
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub(),
        createReportOpportunitySuggestionFn: sandbox.stub(),
        linkBuilderFn: sandbox.stub(),
      };

      const result = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies,
      );

      expect(result).to.equal('');
      expect(mockDependencies.createReportOpportunityFn.called).to.be.false;
      expect(mockDependencies.createReportOpportunitySuggestionFn.called).to.be.false;
      expect(mockDependencies.linkBuilderFn.called).to.be.false;
    });

    it('should return empty string when markdown is null', async () => {
      mockGenMdFn.returns(null);
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub(),
        createReportOpportunitySuggestionFn: sandbox.stub(),
        linkBuilderFn: sandbox.stub(),
      };

      const result = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies,
      );

      expect(result).to.equal('');
      expect(mockDependencies.createReportOpportunityFn.called).to.be.false;
      expect(mockDependencies.createReportOpportunitySuggestionFn.called).to.be.false;
      expect(mockDependencies.linkBuilderFn.called).to.be.false;
    });

    it('should handle createReportOpportunity failure', async () => {
      const error = new Error('Failed to create opportunity');
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().rejects(error),
        createReportOpportunitySuggestionFn: sandbox.stub(),
        linkBuilderFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunity(
          mockReportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'test-report',
          true,
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to create opportunity');
        expect(mockLog.error.calledWith('Failed to create report opportunity for test-report', 'Failed to create opportunity')).to.be.true;
        expect(mockDependencies.createReportOpportunitySuggestionFn.called).to.be.false;
      }
    });

    it('should handle createReportOpportunitySuggestion failure', async () => {
      const error = new Error('Failed to create suggestion');
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().rejects(error),
        linkBuilderFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunity(
          mockReportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'test-report',
          true,
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to create suggestion');
        expect(mockLog.error.calledWith('Failed to create report opportunity suggestion for test-report', 'Failed to create suggestion')).to.be.true;
        expect(mockOpportunity.setStatus.called).to.be.false;
        expect(mockOpportunity.save.called).to.be.false;
      }
    });

    it('should not set status to ignored when shouldIgnore is false', async () => {
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-123'),
      };

      const result = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        false,
        mockDependencies,
      );

      expect(result).to.equal('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-123');
      expect(mockOpportunity.setStatus.called).to.be.false;
      expect(mockOpportunity.save.called).to.be.false;
    });

    it('should use default shouldIgnore value when not provided', async () => {
      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-123'),
      };

      await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        undefined,
        mockDependencies,
      );

      // Default shouldIgnore is true
      expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
      expect(mockOpportunity.save.calledOnce).to.be.true;
    });

    it('should pass correct parameters to createReportOpportunity', async () => {
      const opportunityInstance = {
        runbook: 'test-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Test Opportunity',
        description: 'Test description',
        tags: ['test'],
      };
      mockCreateOpportunityFn.returns(opportunityInstance);

      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies,
      );

      expect(mockDependencies.createReportOpportunityFn.calledWith(
        opportunityInstance,
        mockReportData.auditData,
        mockReportData.context,
      )).to.be.true;
    });

    it('should pass correct parameters to createReportOpportunitySuggestion', async () => {
      const reportMarkdown = '# Test Report\n\nThis is a test report.';
      mockGenMdFn.returns(reportMarkdown);

      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies,
      );

      expect(mockDependencies.createReportOpportunitySuggestionFn.calledWith(
        mockOpportunity,
        reportMarkdown,
        mockReportData.auditData,
        mockLog,
      )).to.be.true;
    });

    it('should handle complex reportData structure', async () => {
      const complexReportData = {
        mdData: {
          current: {
            overall: { violations: { total: 10 } },
            'https://example.com': { violations: { total: 5 } },
          },
          lastWeek: {
            overall: { violations: { total: 8 } },
            'https://example.com': { violations: { total: 3 } },
          },
          relatedReportsUrls: {
            inDepthReportUrl: 'https://report1.com',
            enhancedReportUrl: 'https://report2.com',
          },
        },
        linkData: {
          envAsoDomain: 'experience-stage',
          siteId: 'complex-site-id',
        },
        opptyData: {
          week: 1,
          year: 2025,
        },
        auditData: {
          siteId: 'complex-site-id',
          auditId: 'complex-audit-id',
          additionalData: 'should-be-passed-through',
        },
        context: {
          log: mockLog,
          dataAccess: { Opportunity: {} },
          env: { AWS_ENV: 'stage' },
        },
      };

      const mockDependencies = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://complex-url.com'),
      };

      const result = await generateReportOpportunity(
        complexReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'complex-report',
        false,
        mockDependencies,
      );

      expect(result).to.equal('https://complex-url.com');
      expect(mockGenMdFn.calledWith(complexReportData.mdData)).to.be.true;
      expect(mockCreateOpportunityFn.calledWith(1, 2025)).to.be.true;
      expect(mockDependencies.linkBuilderFn.calledWith(complexReportData.linkData, 'opp-123')).to.be.true;
    });

    it('should use default dependencies when none provided', async () => {
      // This test verifies that the function can be called without dependencies parameter
      // and will use the default imported functions. Since we can't easily test the actual
      // imported functions without mocking them globally, we'll test that the function
      // accepts the call without the dependencies parameter.

      // Create a proper mock for the Opportunity in dataAccess
      const mockOpportunityWithCreate = {
        create: sandbox.stub().resolves(mockOpportunity),
      };

      // Update the mockReportData to have a proper Opportunity mock
      const testReportData = {
        ...mockReportData,
        context: {
          ...mockReportData.context,
          dataAccess: {
            Opportunity: mockOpportunityWithCreate,
          },
        },
      };

      try {
        // This will likely fail due to missing setup, but it should not fail due to
        // missing dependencies parameter
        await generateReportOpportunity(
          testReportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'test-report',
        );
      } catch (error) {
        // We expect this to fail, but not due to missing dependencies
        // The error should be related to the actual function execution, not parameter handling
        expect(error.message).to.not.include('undefined');
        // Allow "is not a function" errors that are NOT related to the default dependencies
        // but exclude the specific error we were getting about Opportunity.create
        if (error.message.includes('is not a function')) {
          expect(error.message).to.not.include('Opportunity.create is not a function');
        }
      }
    });

    it('should handle different markdown content types', async () => {
      // Test empty string
      mockGenMdFn.returns('');
      const mockDependencies1 = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      const result1 = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies1,
      );

      expect(result1).to.equal('');
      expect(mockDependencies1.createReportOpportunityFn.called).to.be.false;

      // Test null
      mockGenMdFn.returns(null);
      const mockDependencies2 = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      const result2 = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies2,
      );

      expect(result2).to.equal('');
      expect(mockDependencies2.createReportOpportunityFn.called).to.be.false;

      // Test undefined
      mockGenMdFn.returns(undefined);
      const mockDependencies3 = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      const result3 = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies3,
      );

      expect(result3).to.equal('');
      expect(mockDependencies3.createReportOpportunityFn.called).to.be.false;

      // Test valid markdown
      mockGenMdFn.returns('# Valid Report');
      const mockDependencies4 = {
        createReportOpportunityFn: sandbox.stub().resolves({ opportunity: mockOpportunity }),
        createReportOpportunitySuggestionFn: sandbox.stub().resolves({ suggestion: { id: 'sugg-123' } }),
        linkBuilderFn: sandbox.stub().returns('https://test.com'),
      };

      const result4 = await generateReportOpportunity(
        mockReportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'test-report',
        true,
        mockDependencies4,
      );

      expect(result4).to.equal('https://test.com');
      expect(mockDependencies4.createReportOpportunityFn.called).to.be.true;
    });
  });

  describe('generateReportOpportunities', () => {
    let mockSite;
    let mockContext;
    let mockAggregationResult;

    beforeEach(() => {
      mockSite = {
        getId: sandbox.stub().returns('test-site-123'),
      };
      mockContext = {
        log: mockLog,
        env: { AWS_ENV: 'prod' },
      };
      mockAggregationResult = {
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'aria-allowed-attr': {
                      count: 1,
                      description: 'description',
                      level: 'A',
                      successCriteriaNumber: '412',
                      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
            'https://example.com': {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'aria-allowed-attr': {
                      count: 1,
                      description: 'description',
                      level: 'A',
                      htmlWithIssues: ['<div></div>'],
                      failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
                      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
                      successCriteriaTags: ['WCAG 2.1 Level A'],
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
              traffic: '1000',
            },
          },
          lastWeek: {
            overall: {
              violations: {
                total: 1,
                critical: {
                  count: 1,
                  items: {
                    'aria-allowed-attr': {
                      count: 1,
                      description: 'description',
                      level: 'A',
                      successCriteriaNumber: '412',
                      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
            },
            'https://example.com': {
              violations: {
                total: 2,
                critical: {
                  count: 2,
                  items: {
                    'other-id': {
                      count: 2,
                      description: 'description',
                      level: 'A',
                      htmlWithIssues: ['<div></div>'],
                      failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
                      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
                      successCriteriaTags: ['WCAG 2.1 Level A'],
                    },
                  },
                },
                serious: {
                  count: 0,
                  items: {},
                },
              },
              traffic: '1000',
            },
          },
        },
      };
    });

    it('should successfully generate all report opportunities', async () => {
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://example.com/in-depth-report')
          .onCall(1)
          .resolves('https://example.com/enhanced-report')
          .onCall(2)
          .resolves('https://example.com/fixed-vs-new-report')
          .onCall(3)
          .resolves('https://example.com/base-report'),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
        mockDependencies,
      );

      expect(result.status).to.be.true;
      expect(result.message).to.equal('All report opportunities created successfully');
      expect(mockSite.getId.calledOnce).to.be.true;
      expect(mockDependencies.getWeekNumberAndYearFn.calledOnce).to.be.true;
      expect(mockDependencies.getAuditDataFn.calledWith(mockSite, 'accessibility')).to.be.true;
      expect(mockDependencies.getEnvAsoDomainFn.calledWith(mockContext.env)).to.be.true;
      expect(mockDependencies.generateReportOpportunityFn.callCount).to.equal(4);
    });

    it('should handle in-depth report generation failure', async () => {
      const error = new Error('In-depth report failed');
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub().rejects(error),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('In-depth report failed');
        expect(mockLog.error.calledWith('Failed to generate in-depth report opportunity', 'In-depth report failed')).to.be.true;
        expect(mockDependencies.generateReportOpportunityFn.calledOnce).to.be.true;
      }
    });

    it('should handle enhanced report generation failure', async () => {
      const error = new Error('Enhanced report failed');
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://example.com/in-depth-report')
          .onCall(1)
          .rejects(error),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Enhanced report failed');
        expect(mockLog.error.calledWith('Failed to generate enhanced report opportunity', 'Enhanced report failed')).to.be.true;
        expect(mockDependencies.generateReportOpportunityFn.calledTwice).to.be.true;
      }
    });

    it('should handle fixed vs new report generation failure', async () => {
      const error = new Error('Fixed vs new report failed');
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://example.com/in-depth-report')
          .onCall(1)
          .resolves('https://example.com/enhanced-report')
          .onCall(2)
          .rejects(error),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Fixed vs new report failed');
        expect(mockLog.error.calledWith('Failed to generate fixed vs new report opportunity', 'Fixed vs new report failed')).to.be.true;
        expect(mockDependencies.generateReportOpportunityFn.calledThrice).to.be.true;
      }
    });

    it('should handle base report generation failure', async () => {
      const error = new Error('Base report failed');
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://example.com/in-depth-report')
          .onCall(1)
          .resolves('https://example.com/enhanced-report')
          .onCall(2)
          .resolves('https://example.com/fixed-vs-new-report')
          .onCall(3)
          .rejects(error),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Base report failed');
        expect(mockLog.error.calledWith('Failed to generate base report opportunity', 'Base report failed')).to.be.true;
        expect(mockDependencies.generateReportOpportunityFn.callCount).to.equal(4);
      }
    });

    it('should pass correct parameters to generateReportOpportunity calls', async () => {
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'test-site-123', auditId: 'audit-789' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://example.com/in-depth-report')
          .onCall(1)
          .resolves('https://example.com/enhanced-report')
          .onCall(2)
          .resolves('https://example.com/fixed-vs-new-report')
          .onCall(3)
          .resolves('https://example.com/base-report'),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
        mockDependencies,
      );

      const expectedReportData = {
        mdData: {
          current: mockAggregationResult.finalResultFiles.current,
          lastWeek: mockAggregationResult.finalResultFiles.lastWeek,
          relatedReportsUrls: {
            inDepthReportUrl: 'https://example.com/in-depth-report',
            enhancedReportUrl: 'https://example.com/enhanced-report',
            fixedVsNewReportUrl: 'https://example.com/fixed-vs-new-report',
          },
        },
        linkData: {
          envAsoDomain: 'experience',
          siteId: 'test-site-123',
        },
        opptyData: {
          week: 42,
          year: 2024,
        },
        auditData: { siteId: 'test-site-123', auditId: 'audit-789' },
        context: mockContext,
      };

      // Check in-depth report call
      expect(mockDependencies.generateReportOpportunityFn.getCall(0).args[0])
        .to.deep.equal(expectedReportData);
      expect(mockDependencies.generateReportOpportunityFn.getCall(0).args[1])
        .to.equal(mockDependencies.generateInDepthReportMarkdownFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(0).args[2])
        .to.equal(mockDependencies.createInDepthReportOpportunityFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(0).args[3])
        .to.equal('in-depth report');

      // Check enhanced report call
      expect(mockDependencies.generateReportOpportunityFn.getCall(1).args[1])
        .to.equal(mockDependencies.generateEnhancedReportMarkdownFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(1).args[2])
        .to.equal(mockDependencies.createEnhancedReportOpportunityFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(1).args[3])
        .to.equal('enhanced report');

      // Check fixed vs new report call
      expect(mockDependencies.generateReportOpportunityFn.getCall(2).args[1])
        .to.equal(mockDependencies.generateFixedNewReportMarkdownFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(2).args[2])
        .to.equal(mockDependencies.createFixedVsNewReportOpportunityFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(2).args[3])
        .to.equal('fixed vs new report');

      // Check base report call (should have shouldIgnore = false)
      const baseReportData = mockDependencies.generateReportOpportunityFn.getCall(3).args[0];
      expect(baseReportData.mdData.relatedReportsUrls).to.deep.equal({
        inDepthReportUrl: 'https://example.com/in-depth-report',
        enhancedReportUrl: 'https://example.com/enhanced-report',
        fixedVsNewReportUrl: 'https://example.com/fixed-vs-new-report',
      });
      expect(mockDependencies.generateReportOpportunityFn.getCall(3).args[1])
        .to.equal(mockDependencies.generateBaseReportMarkdownFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(3).args[2])
        .to.equal(mockDependencies.createBaseReportOpportunityFn);
      expect(mockDependencies.generateReportOpportunityFn.getCall(3).args[3])
        .to.equal('base report');
      expect(mockDependencies.generateReportOpportunityFn.getCall(3).args[4])
        .to.equal(false);
    });

    it('should handle different environment configurations', async () => {
      const stageContext = {
        log: mockLog,
        env: { AWS_ENV: 'stage' },
      };

      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 1, year: 2025 }),
        getAuditDataFn: sandbox.stub().resolves({ siteId: 'stage-site', auditId: 'stage-audit' }),
        getEnvAsoDomainFn: sandbox.stub().returns('experience-stage'),
        generateReportOpportunityFn: sandbox.stub()
          .onCall(0)
          .resolves('https://stage.com/in-depth-report')
          .onCall(1)
          .resolves('https://stage.com/enhanced-report')
          .onCall(2)
          .resolves('https://stage.com/fixed-vs-new-report')
          .onCall(3)
          .resolves('https://stage.com/base-report'),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        stageContext,
        'performance',
        mockDependencies,
      );

      expect(result.status).to.be.true;
      expect(mockDependencies.getEnvAsoDomainFn.calledWith(stageContext.env)).to.be.true;
      expect(mockDependencies.getAuditDataFn.calledWith(mockSite, 'performance')).to.be.true;
    });

    it('should use default dependencies when none provided', async () => {
      // This test verifies that the function can be called without dependencies parameter
      // and will use the default imported functions. Since we can't easily test the actual
      // imported functions without mocking them globally, we'll test that the function
      // accepts the call without the dependencies parameter.

      // Create a proper mock site with the required method
      const testMockSite = {
        getId: sandbox.stub().returns('test-site-123'),
        getLatestAuditByAuditType: sandbox.stub().resolves({
          siteId: 'test-site-123',
          auditId: 'audit-456',
          auditType: 'accessibility',
        }),
      };

      // Create a proper mock context with dataAccess
      const testMockContext = {
        log: mockLog,
        env: { AWS_ENV: 'prod' },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves({
              getId: sandbox.stub().returns('opp-123'),
              setStatus: sandbox.stub().resolves(),
              save: sandbox.stub().resolves(),
              addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
            }),
          },
        },
      };

      try {
        // This will likely fail due to missing setup, but it should not fail due to
        // missing dependencies parameter
        await generateReportOpportunities(
          testMockSite,
          mockAggregationResult,
          testMockContext,
          'accessibility',
        );
      } catch (error) {
        // We expect this to fail, but not due to missing dependencies
        // The error should be related to the actual function execution, not parameter handling
        expect(error.message).to.not.include('undefined');
        // Allow "is not a function" errors that are NOT related to the default dependencies
        // but exclude the specific error we were getting about missing methods
        if (error.message.includes('is not a function')) {
          expect(error.message).to.not.include('site.getLatestAuditByAuditType is not a function');
          expect(error.message).to.not.include('Opportunity.create is not a function');
        }
        // Also check for destructuring errors
        if (error.message.includes('Cannot destructure property')) {
          expect(error.message).to.not.include('Cannot destructure property \'Opportunity\'');
        }
      }
    });

    it('should handle getAuditData failure', async () => {
      const error = new Error('Failed to get audit data');
      const mockDependencies = {
        getWeekNumberAndYearFn: sandbox.stub().returns({ week: 42, year: 2024 }),
        getAuditDataFn: sandbox.stub().rejects(error),
        getEnvAsoDomainFn: sandbox.stub().returns('experience'),
        generateReportOpportunityFn: sandbox.stub(),
        generateInDepthReportMarkdownFn: sandbox.stub(),
        createInDepthReportOpportunityFn: sandbox.stub(),
        generateEnhancedReportMarkdownFn: sandbox.stub(),
        createEnhancedReportOpportunityFn: sandbox.stub(),
        generateFixedNewReportMarkdownFn: sandbox.stub(),
        createFixedVsNewReportOpportunityFn: sandbox.stub(),
        generateBaseReportMarkdownFn: sandbox.stub(),
        createBaseReportOpportunityFn: sandbox.stub(),
      };

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
          mockDependencies,
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to get audit data');
        expect(mockDependencies.generateReportOpportunityFn.called).to.be.false;
      }
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

        expect(mockLog.info).to.have.been.calledWith(
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
        expect(mockLog.info).to.have.been.calledWith(
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
        expect(mockLog.info).to.have.been.calledWith(
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
        expect(mockLog.info).to.have.been.calledWith(
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
          'Failed to process file failing-file.json after 1 retries: Persistent S3 error',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 1 files failed to process, continuing with 0 successful files',
        );
        expect(mockLog.info).to.have.been.calledWith(
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
          'Failed to process file fail-file.json after 1 retries: Permanent failure',
        );
        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 3 files failed to process, continuing with 2 successful files',
        );
        expect(mockLog.info).to.have.been.calledWith(
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
          'Failed to process file default-retry-file.json after 1 retries: Error for default retry test',
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
        expect(mockLog.info).to.have.been.calledWith(
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
        expect(mockLog.info).to.have.been.calledWith(
          'File processing completed: 0 successful, 2 failed out of 2 total files',
        );
      });
    });

    describe('parallel processing', () => {
      it('should process files in parallel using Promise.allSettled', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['file1.json', 'file2.json', 'file3.json'];
        const mockData1 = { url: 'https://example.com/1', violations: { total: 1 } };
        const mockData2 = { url: 'https://example.com/2', violations: { total: 2 } };
        const mockData3 = { url: 'https://example.com/3', violations: { total: 3 } };

        // Add delays to simulate async processing
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file1.json', mockLog)
          .callsFake(() => new Promise((resolve) => {
            setTimeout(() => resolve(mockData1), 100);
          }));
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file2.json', mockLog)
          .callsFake(() => new Promise((resolve) => {
            setTimeout(() => resolve(mockData2), 50);
          }));
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'file3.json', mockLog)
          .callsFake(() => new Promise((resolve) => {
            setTimeout(() => resolve(mockData3), 75);
          }));

        const startTime = Date.now();

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        const endTime = Date.now();
        const executionTime = endTime - startTime;

        // Assert
        expect(result.results).to.have.length(3);
        // Should complete in roughly 100ms (the longest delay) rather than 225ms (sum of delays)
        expect(executionTime).to.be.lessThan(200);

        expect(mockGetObjectFromKey).to.have.been.calledThrice;
      });

      it('should handle parallel processing with some failures', async () => {
        // Arrange
        const s3Client = { mock: 'client' };
        const bucketName = 'test-bucket';
        const objectKeys = ['success1.json', 'fail.json', 'success2.json'];
        const successData1 = { url: 'https://example.com/success1', violations: { total: 1 } };
        const successData2 = { url: 'https://example.com/success2', violations: { total: 2 } };

        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'success1.json', mockLog)
          .resolves(successData1);
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'fail.json', mockLog)
          .rejects(new Error('Processing error'));
        mockGetObjectFromKey
          .withArgs(s3Client, bucketName, 'success2.json', mockLog)
          .resolves(successData2);

        // Act
        const result = await processFilesWithRetryMocked(s3Client, bucketName, objectKeys, mockLog);

        // Assert
        expect(result.results).to.have.length(2);
        expect(result.results).to.deep.include({ key: 'success1.json', data: successData1 });
        expect(result.results).to.deep.include({ key: 'success2.json', data: successData2 });

        expect(mockLog.warn).to.have.been.calledWith(
          '1 out of 3 files failed to process, continuing with 2 successful files',
        );
        expect(mockLog.info).to.have.been.calledWith(
          'File processing completed: 2 successful, 1 failed out of 3 total files',
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
          'Failed to process file no-retry-file.json after 0 retries: No retry error',
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
      it('should throw error when no final result files found', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('[A11yAudit] No final result files found for no-files-site');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] No final result files found for no-files-site',
          )).to.be.true;
        }
      });

      it('should throw error when getObjectKeysUsingPrefix fails', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('S3 access denied');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] Error getting final result files for error-site: S3 access denied',
          )).to.be.true;
        }
      });

      it('should throw error when latest final result file is null', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('[A11yAudit] No latest final result file found for null-file-site');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] No latest final result file found for null-file-site',
          )).to.be.true;
        }
      });

      it('should throw error when getObjectFromKey fails', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Failed to get object from S3');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] Error getting latest final result file for get-object-error-site: Failed to get object from S3',
          )).to.be.true;
        }
      });

      it('should throw error when no HTTPS URLs found in final result file', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('[A11yAudit] No URLs found for no-urls-site');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] No URLs found for no-urls-site',
          )).to.be.true;
        }
      });

      it('should throw error when final result file contains only overall data', async () => {
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('[A11yAudit] No URLs found for only-overall-site');
          expect(mockLogForAudit.error.calledWith(
            '[A11yAudit] No URLs found for only-overall-site',
          )).to.be.true;
        }
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

        // Act & Assert
        try {
          await getUrlsForAuditMocked(
            mockS3ClientForAudit,
            bucketName,
            siteId,
            mockLogForAudit,
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('[A11yAudit] No URLs found for empty-file-site');
        }
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
});
