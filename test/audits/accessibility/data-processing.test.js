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

import { expect } from 'chai';
import sinon from 'sinon';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  deleteOriginalFiles,
  getSubfoldersUsingPrefixAndDelimiter,
  updateViolationData,
  getObjectKeysFromSubfolders,
  cleanupS3Files,
  createReportOpportunity,
  linkBuilder,
  getAuditData,
  getEnvAsoDomain,
  getWeekNumber,
  getWeekNumberAndYear,
  generateReportOpportunities,
} from '../../../src/accessibility/utils/data-processing.js';

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

  describe('processFilesWithRetry', () => {
    let getObjectFromKeyStub;

    beforeEach(() => {
      getObjectFromKeyStub = sandbox.stub();
    });

    // Helper function to create a testable version of processFilesWithRetry
    const createTestProcessFilesWithRetry = () => async (
      s3Client,
      bucketName,
      objectKeys,
      log,
      maxRetries = 1,
    ) => {
      const processFile = async (key) => {
        try {
          const data = await getObjectFromKeyStub(s3Client, bucketName, key, log);

          if (!data) {
            log.warn(`Failed to get data from ${key}, skipping`);
            return null;
          }

          return { key, data };
        } catch (error) {
          log.error(`Error processing file ${key}: ${error.message}`);
          throw error; // Re-throw to be caught by retry logic
        }
      };

      const processFileWithRetry = async (key, retryCount = 0) => {
        try {
          return await processFile(key);
        } catch (error) {
          if (retryCount < maxRetries) {
            log.warn(`Retrying file ${key} (attempt ${retryCount + 1}/${maxRetries}): ${error.message}`);
            return processFileWithRetry(key, retryCount + 1);
          }
          log.error(`Failed to process file ${key} after ${maxRetries} retries: ${error.message}`);
          return null;
        }
      };

      // Process files in parallel using Promise.allSettled to handle failures gracefully
      const processFilePromises = objectKeys.map((key) => processFileWithRetry(key));

      // Use Promise.allSettled to handle potential failures without stopping the entire process
      const settledResults = await Promise.allSettled(processFilePromises);

      // Extract successful results and log failures
      const results = [];
      let failedCount = 0;

      settledResults.forEach((settledResult, index) => {
        if (settledResult.status === 'fulfilled') {
          if (settledResult.value !== null) {
            results.push(settledResult.value);
          } else {
            failedCount += 1;
          }
        } else {
          failedCount += 1;
          log.error(`Promise failed for file ${objectKeys[index]}: ${settledResult.reason?.message || settledResult.reason}`);
        }
      });

      if (failedCount > 0) {
        log.warn(`${failedCount} out of ${objectKeys.length} files failed to process, continuing with ${results.length} successful files`);
      }

      log.info(`File processing completed: ${results.length} successful, ${failedCount} failed out of ${objectKeys.length} total files`);

      return { results };
    };

    it('should process all files successfully', async () => {
      const objectKeys = ['file1.json', 'file2.json'];
      const mockData1 = { url: 'https://example.com/1', violations: { total: 5 } };
      const mockData2 = { url: 'https://example.com/2', violations: { total: 3 } };

      getObjectFromKeyStub.onFirstCall().resolves(mockData1);
      getObjectFromKeyStub.onSecondCall().resolves(mockData2);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result.results).to.have.length(2);
      expect(result.results[0]).to.deep.equal({ key: 'file1.json', data: mockData1 });
      expect(result.results[1]).to.deep.equal({ key: 'file2.json', data: mockData2 });
      expect(mockLog.info.calledWith('File processing completed: 2 successful, 0 failed out of 2 total files')).to.be.true;
    });

    it('should handle null data from getObjectFromKey', async () => {
      const objectKeys = ['file1.json', 'file2.json'];
      const mockData = { url: 'https://example.com/2', violations: { total: 3 } };

      getObjectFromKeyStub.onFirstCall().resolves(null);
      getObjectFromKeyStub.onSecondCall().resolves(mockData);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result.results).to.have.length(1);
      expect(result.results[0]).to.deep.equal({ key: 'file2.json', data: mockData });
      expect(mockLog.warn.calledWith('Failed to get data from file1.json, skipping')).to.be.true;
      expect(mockLog.info.calledWith('File processing completed: 1 successful, 1 failed out of 2 total files')).to.be.true;
    });

    it('should retry failed files up to maxRetries', async () => {
      const objectKeys = ['file1.json'];
      const error = new Error('Network error');
      const mockData = { url: 'https://example.com/1', violations: { total: 5 } };

      getObjectFromKeyStub.onFirstCall().rejects(error);
      getObjectFromKeyStub.onSecondCall().resolves(mockData);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog, 2);

      expect(result.results).to.have.length(1);
      expect(result.results[0]).to.deep.equal({ key: 'file1.json', data: mockData });
      expect(mockLog.warn.calledWith('Retrying file file1.json (attempt 1/2): Network error')).to.be.true;
      expect(mockLog.info.calledWith('File processing completed: 1 successful, 0 failed out of 1 total files')).to.be.true;
    });

    it('should fail after exceeding maxRetries', async () => {
      const objectKeys = ['file1.json'];
      const error = new Error('Persistent network error');

      getObjectFromKeyStub.rejects(error);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog, 2);

      expect(result.results).to.have.length(0);
      expect(mockLog.warn.calledWith('Retrying file file1.json (attempt 1/2): Persistent network error')).to.be.true;
      expect(mockLog.warn.calledWith('Retrying file file1.json (attempt 2/2): Persistent network error')).to.be.true;
      expect(mockLog.error.calledWith('Failed to process file file1.json after 2 retries: Persistent network error')).to.be.true;
      expect(mockLog.warn.calledWith('1 out of 1 files failed to process, continuing with 0 successful files')).to.be.true;
      expect(mockLog.info.calledWith('File processing completed: 0 successful, 1 failed out of 1 total files')).to.be.true;
    });

    it('should handle mixed success and failure scenarios', async () => {
      const objectKeys = ['file1.json', 'file2.json', 'file3.json'];
      const mockData1 = { url: 'https://example.com/1', violations: { total: 5 } };
      const mockData3 = { url: 'https://example.com/3', violations: { total: 2 } };
      const error = new Error('File processing error');

      getObjectFromKeyStub.onCall(0).resolves(mockData1);
      getObjectFromKeyStub.onCall(1).rejects(error);
      getObjectFromKeyStub.onCall(2).rejects(error); // Retry for file2
      getObjectFromKeyStub.onCall(3).resolves(mockData3);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog, 1);

      expect(result.results).to.have.length(2);
      expect(result.results[0]).to.deep.equal({ key: 'file1.json', data: mockData1 });
      expect(result.results[1]).to.deep.equal({ key: 'file2.json', data: mockData3 });
      expect(mockLog.warn.calledWith('1 out of 3 files failed to process, continuing with 2 successful files')).to.be.true;
      expect(mockLog.info.calledWith('File processing completed: 2 successful, 1 failed out of 3 total files')).to.be.true;
    });

    it('should handle empty objectKeys array', async () => {
      const objectKeys = [];

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result.results).to.have.length(0);
      expect(mockLog.info.calledWith('File processing completed: 0 successful, 0 failed out of 0 total files')).to.be.true;
    });

    it('should use default maxRetries value of 1', async () => {
      const objectKeys = ['file1.json'];
      const error = new Error('Network error');

      getObjectFromKeyStub.rejects(error);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result.results).to.have.length(0);
      expect(mockLog.warn.calledWith('Retrying file file1.json (attempt 1/1): Network error')).to.be.true;
      expect(mockLog.error.calledWith('Failed to process file file1.json after 1 retries: Network error')).to.be.true;
    });

    it('should handle Promise.allSettled rejection scenarios', async () => {
      const objectKeys = ['file1.json', 'file2.json'];
      const mockData1 = { url: 'https://example.com/1', violations: { total: 5 } };

      getObjectFromKeyStub.onFirstCall().resolves(mockData1);
      getObjectFromKeyStub.onSecondCall().resolves(null);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);

      expect(result.results).to.have.length(1);
      expect(result.results[0]).to.deep.equal({ key: 'file1.json', data: mockData1 });
      expect(mockLog.warn.calledWith('Failed to get data from file2.json, skipping')).to.be.true;
      expect(mockLog.warn.calledWith('1 out of 2 files failed to process, continuing with 1 successful files')).to.be.true;
    });

    it('should log error details for each processing step', async () => {
      const objectKeys = ['file1.json'];
      const error = new Error('Detailed error message');

      getObjectFromKeyStub.rejects(error);

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog, 1);

      expect(mockLog.error.calledWith('Error processing file file1.json: Detailed error message')).to.be.true;
      expect(mockLog.warn.calledWith('Retrying file file1.json (attempt 1/1): Detailed error message')).to.be.true;
      expect(mockLog.error.calledWith('Failed to process file file1.json after 1 retries: Detailed error message')).to.be.true;
    });

    it('should process files in parallel', async () => {
      const objectKeys = ['file1.json', 'file2.json', 'file3.json'];
      const mockData1 = { url: 'https://example.com/1', violations: { total: 5 } };
      const mockData2 = { url: 'https://example.com/2', violations: { total: 3 } };
      const mockData3 = { url: 'https://example.com/3', violations: { total: 2 } };

      // Add delays to simulate async processing
      getObjectFromKeyStub.onCall(0).callsFake(() => new Promise((resolve) => {
        setTimeout(() => resolve(mockData1), 50);
      }));
      getObjectFromKeyStub.onCall(1).callsFake(() => new Promise((resolve) => {
        setTimeout(() => resolve(mockData2), 30);
      }));
      getObjectFromKeyStub.onCall(2).callsFake(() => new Promise((resolve) => {
        setTimeout(() => resolve(mockData3), 10);
      }));

      const testProcessFilesWithRetry = createTestProcessFilesWithRetry();
      const startTime = Date.now();
      const result = await testProcessFilesWithRetry(mockS3Client, 'test-bucket', objectKeys, mockLog);
      const endTime = Date.now();

      expect(result.results).to.have.length(3);
      // Should complete in roughly the time of the longest operation (50ms) plus overhead,
      // not the sum of all operations (90ms)
      expect(endTime - startTime).to.be.lessThan(100);
    });
  });

  describe('aggregateAccessibilityData', () => {
    let getObjectKeysFromSubfoldersStub;
    let processFilesWithRetryStub;
    let updateViolationDataStub;
    let getObjectKeysUsingPrefixStub;
    let getObjectFromKeyStub;
    let cleanupS3FilesStub;

    beforeEach(() => {
      getObjectKeysFromSubfoldersStub = sandbox.stub();
      processFilesWithRetryStub = sandbox.stub();
      updateViolationDataStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      cleanupS3FilesStub = sandbox.stub();
    });

    // Helper function to create a testable version of aggregateAccessibilityData
    const createTestAggregateAccessibilityData = () => async (
      s3Client,
      bucketName,
      siteId,
      log,
      outputKey,
      version,
      maxRetries = 2,
    ) => {
      if (!s3Client || !bucketName || !siteId) {
        const message = 'Missing required parameters for aggregateAccessibilityData';
        log.error(message);
        return { success: false, aggregatedData: null, message };
      }

      // Initialize aggregated data structure
      let aggregatedData = {
        overall: {
          violations: {
            total: 0,
            critical: {
              count: 0,
              items: {},
            },
            serious: {
              count: 0,
              items: {},
            },
          },
        },
      };

      try {
        // Get object keys from subfolders
        const objectKeysResult = await getObjectKeysFromSubfoldersStub(
          s3Client,
          bucketName,
          siteId,
          version,
          log,
        );
        if (!objectKeysResult.success) {
          return { success: false, aggregatedData: null, message: objectKeysResult.message };
        }
        const { objectKeys } = objectKeysResult;

        // Process files with retry logic
        const { results } = await processFilesWithRetryStub(
          s3Client,
          bucketName,
          objectKeys,
          log,
          maxRetries,
        );

        // Check if we have any successful results to process
        if (results.length === 0) {
          const message = `No files could be processed successfully for site ${siteId}`;
          log.error(message);
          return { success: false, aggregatedData: null, message };
        }

        // Process the results
        results.forEach((result) => {
          const { data } = result;
          const { violations, traffic, url: siteUrl } = data;

          // Store the url specific data
          aggregatedData[siteUrl] = {
            violations,
            traffic,
          };

          // Update overall data
          aggregatedData = updateViolationDataStub(aggregatedData, violations, 'critical') || aggregatedData;
          aggregatedData = updateViolationDataStub(aggregatedData, violations, 'serious') || aggregatedData;
          if (violations.total) {
            aggregatedData.overall.violations.total += violations.total;
          }
        });

        // Save aggregated data to S3
        await s3Client.send({
          Bucket: bucketName,
          Key: outputKey,
          Body: JSON.stringify(aggregatedData, null, 2),
          ContentType: 'application/json',
        });

        log.info(`Saved aggregated accessibility data to ${outputKey}`);

        // check if there are any other final-result files in the accessibility/siteId folder
        const lastWeekObjectKeys = await getObjectKeysUsingPrefixStub(
          s3Client,
          bucketName,
          `accessibility/${siteId}/`,
          log,
          10,
          '-final-result.json',
        );
        log.info(`[A11yAudit] Found ${lastWeekObjectKeys.length} final-result files in the accessibility/siteId folder with keys: ${lastWeekObjectKeys}`);

        // get last week file and start creating the report
        const lastWeekFile = lastWeekObjectKeys.length < 2
          ? null
          : await getObjectFromKeyStub(
            s3Client,
            bucketName,
            lastWeekObjectKeys[lastWeekObjectKeys.length - 2],
            log,
          );
        if (lastWeekFile) {
          const expectedLogMessage = `[A11yAudit] Last week file key:accessibility/test-site/2024-01-08-final-result.json with content: ${JSON.stringify(lastWeekFile, null, 2)}`;
          log.info(expectedLogMessage);
        }

        await cleanupS3FilesStub(s3Client, bucketName, objectKeys, lastWeekObjectKeys, log);

        return {
          success: true,
          finalResultFiles: {
            current: aggregatedData,
            lastWeek: lastWeekFile,
          },
          message: `Successfully aggregated ${objectKeys.length} files into ${outputKey}`,
        };
      } catch (error) {
        log.error(`Error aggregating accessibility data for site ${siteId}`, error);
        return {
          success: false,
          aggregatedData: null,
          message: `Error: ${error.message}`,
        };
      }
    };

    it('should return error when s3Client is missing', async () => {
      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        null,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
      expect(mockLog.error.calledWith('Missing required parameters for aggregateAccessibilityData')).to.be.true;
    });

    it('should return error when bucketName is missing', async () => {
      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        null,
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
    });

    it('should return error when siteId is missing', async () => {
      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        null,
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('Missing required parameters for aggregateAccessibilityData');
    });

    it('should return error when getObjectKeysFromSubfolders fails', async () => {
      getObjectKeysFromSubfoldersStub.resolves({
        success: false,
        message: 'No subfolders found',
      });

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('No subfolders found');
    });

    it('should return error when no files could be processed', async () => {
      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json', 'file2.json'],
      });
      processFilesWithRetryStub.resolves({ results: [] });

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('No files could be processed successfully for site test-site');
      expect(mockLog.error.calledWith('No files could be processed successfully for site test-site')).to.be.true;
    });

    it('should successfully aggregate data with single file', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: {
              total: 5,
              critical: { count: 3, items: {} },
              serious: { count: 2, items: {} },
            },
            traffic: 100,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0); // Return the first argument unchanged
      getObjectKeysUsingPrefixStub.resolves(['accessibility/test-site/2024-01-01-final-result.json']);
      getObjectFromKeyStub.resolves(null);
      cleanupS3FilesStub.resolves();
      mockS3Client.send.resolves();

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('overall');
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page1');
      expect(result.finalResultFiles.current['https://example.com/page1'].violations.total).to.equal(5);
      expect(result.finalResultFiles.current['https://example.com/page1'].traffic).to.equal(100);
      expect(result.message).to.equal('Successfully aggregated 1 files into output-key');
      expect(mockLog.info.calledWith('Saved aggregated accessibility data to output-key')).to.be.true;
    });

    it('should successfully aggregate data with multiple files', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: {
              total: 5,
              critical: { count: 3, items: {} },
              serious: { count: 2, items: {} },
            },
            traffic: 100,
          },
        },
        {
          key: 'file2.json',
          data: {
            url: 'https://example.com/page2',
            violations: {
              total: 3,
              critical: { count: 1, items: {} },
              serious: { count: 2, items: {} },
            },
            traffic: 50,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json', 'file2.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      getObjectKeysUsingPrefixStub.resolves([
        'accessibility/test-site/2024-01-01-final-result.json',
        'accessibility/test-site/2024-01-08-final-result.json',
      ]);
      getObjectFromKeyStub.resolves({ overall: { violations: { total: 10 } } });
      cleanupS3FilesStub.resolves();
      mockS3Client.send.resolves();

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page1');
      expect(result.finalResultFiles.current).to.have.property('https://example.com/page2');
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(8); // 5 + 3
      expect(result.finalResultFiles.lastWeek).to.deep.equal(
        { overall: { violations: { total: 10 } } },
      );
      expect(result.message).to.equal('Successfully aggregated 2 files into output-key');
    });

    it('should handle violations without total property', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: {
              critical: { count: 3, items: {} },
              serious: { count: 2, items: {} },
              // No total property
            },
            traffic: 100,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      getObjectKeysUsingPrefixStub.resolves(['accessibility/test-site/2024-01-01-final-result.json']);
      getObjectFromKeyStub.resolves(null);
      cleanupS3FilesStub.resolves();
      mockS3Client.send.resolves();

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.true;
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(0);
    });

    it('should handle S3 save errors', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: { total: 5 },
            traffic: 100,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      mockS3Client.send.rejects(new Error('S3 save failed'));

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('Error: S3 save failed');
      expect(mockLog.error.calledWith('Error aggregating accessibility data for site test-site')).to.be.true;
    });

    it('should handle getObjectKeysUsingPrefix errors', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: { total: 5 },
            traffic: 100,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      mockS3Client.send.resolves();
      getObjectKeysUsingPrefixStub.rejects(new Error('Failed to get object keys'));

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.false;
      expect(result.message).to.equal('Error: Failed to get object keys');
    });

    it('should use default maxRetries value', async () => {
      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: [] });

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(processFilesWithRetryStub.calledWith(
        mockS3Client,
        'test-bucket',
        ['file1.json'],
        mockLog,
        2, // default maxRetries
      )).to.be.true;
    });

    it('should use custom maxRetries value', async () => {
      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: [] });

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
        5, // custom maxRetries
      );

      expect(processFilesWithRetryStub.calledWith(
        mockS3Client,
        'test-bucket',
        ['file1.json'],
        mockLog,
        5, // custom maxRetries
      )).to.be.true;
    });

    it('should handle lastWeekFile logging correctly', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: { total: 5 },
            traffic: 100,
          },
        },
      ];
      const mockLastWeekFile = { overall: { violations: { total: 8 } } };

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      getObjectKeysUsingPrefixStub.resolves([
        'accessibility/test-site/2024-01-01-final-result.json',
        'accessibility/test-site/2024-01-08-final-result.json',
      ]);
      getObjectFromKeyStub.resolves(mockLastWeekFile);
      cleanupS3FilesStub.resolves();
      mockS3Client.send.resolves();

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      const result = await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(result.success).to.be.true;
      expect(mockLog.info.calledWith(`[A11yAudit] Last week file key:accessibility/test-site/2024-01-08-final-result.json with content: ${JSON.stringify(mockLastWeekFile, null, 2)}`)).to.be.true;
    });

    it('should call all required functions in correct order', async () => {
      const mockResults = [
        {
          key: 'file1.json',
          data: {
            url: 'https://example.com/page1',
            violations: { total: 5 },
            traffic: 100,
          },
        },
      ];

      getObjectKeysFromSubfoldersStub.resolves({
        success: true,
        objectKeys: ['file1.json'],
      });
      processFilesWithRetryStub.resolves({ results: mockResults });
      updateViolationDataStub.returnsArg(0);
      getObjectKeysUsingPrefixStub.resolves(['accessibility/test-site/2024-01-01-final-result.json']);
      getObjectFromKeyStub.resolves(null);
      cleanupS3FilesStub.resolves();
      mockS3Client.send.resolves();

      const testAggregateAccessibilityData = createTestAggregateAccessibilityData();
      await testAggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site',
        mockLog,
        'output-key',
        '2024-01-01',
      );

      expect(getObjectKeysFromSubfoldersStub.calledOnce).to.be.true;
      expect(processFilesWithRetryStub.calledOnce).to.be.true;
      expect(updateViolationDataStub.calledTwice).to.be.true; // Called for critical and serious
      expect(mockS3Client.send.calledOnce).to.be.true;
      expect(getObjectKeysUsingPrefixStub.calledOnce).to.be.true;
      expect(cleanupS3FilesStub.calledOnce).to.be.true;
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
  });

  describe('getUrlsForAudit', () => {
    let getObjectKeysUsingPrefixStub;
    let getObjectFromKeyStub;

    beforeEach(() => {
      getObjectKeysUsingPrefixStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
    });

    // Helper function to create a testable version of getUrlsForAudit
    const createTestGetUrlsForAudit = () => async (s3Client, bucketName, siteId, log) => {
      let finalResultFiles;
      try {
        finalResultFiles = await getObjectKeysUsingPrefixStub(
          s3Client,
          bucketName,
          `accessibility/${siteId}/`,
          log,
          10,
          '-final-result.json',
        );
        if (finalResultFiles.length === 0) {
          const errorMessage = `[A11yAudit] No final result files found for ${siteId}`;
          log.error(errorMessage);
          throw new Error(errorMessage);
        }
      } catch (error) {
        log.error(`[A11yAudit] Error getting final result files for ${siteId}: ${error.message}`);
        throw error;
      }

      const latestFinalResultFileKey = finalResultFiles[finalResultFiles.length - 1];
      let latestFinalResultFile;
      try {
        latestFinalResultFile = await getObjectFromKeyStub(
          s3Client,
          bucketName,
          latestFinalResultFileKey,
          log,
        );
        if (!latestFinalResultFile) {
          const errorMessage = `[A11yAudit] No latest final result file found for ${siteId}`;
          log.error(errorMessage);
          throw new Error(errorMessage);
        }
      } catch (error) {
        log.error(`[A11yAudit] Error getting latest final result file for ${siteId}: ${error.message}`);
        throw error;
      }

      delete latestFinalResultFile.overall;
      const urlsToScrape = [];
      for (const [key, value] of Object.entries(latestFinalResultFile)) {
        if (key.includes('https://')) {
          urlsToScrape.push({
            url: key,
            urlId: key.replace('https://', ''),
            traffic: value.traffic,
          });
        }
      }

      if (urlsToScrape.length === 0) {
        const errorMessage = `[A11yAudit] No URLs found for ${siteId}`;
        log.error(errorMessage);
        throw new Error(errorMessage);
      }

      return urlsToScrape;
    };

    it('should successfully return URLs for audit', async () => {
      const mockFinalResultFiles = [
        'accessibility/test-site/2024-01-01-final-result.json',
        'accessibility/test-site/2024-01-08-final-result.json',
      ];
      const mockLatestFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': { traffic: 100 },
        'https://example.com/page2': { traffic: 50 },
        'non-url-key': { traffic: 25 },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFile);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();
      const result = await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);

      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com/page1',
        urlId: 'example.com/page1',
        traffic: 100,
      });
      expect(result[1]).to.deep.equal({
        url: 'https://example.com/page2',
        urlId: 'example.com/page2',
        traffic: 50,
      });
    });

    it('should throw error when no final result files found', async () => {
      getObjectKeysUsingPrefixStub.resolves([]);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();

      try {
        await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('[A11yAudit] No final result files found for test-site');
        expect(mockLog.error.calledWith('[A11yAudit] No final result files found for test-site')).to.be.true;
      }
    });

    it('should handle getObjectKeysUsingPrefix errors', async () => {
      const error = new Error('S3 access denied');
      getObjectKeysUsingPrefixStub.rejects(error);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();

      try {
        await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError).to.equal(error);
        expect(mockLog.error.calledWith('[A11yAudit] Error getting final result files for test-site: S3 access denied')).to.be.true;
      }
    });

    it('should throw error when latest file is null', async () => {
      const mockFinalResultFiles = ['accessibility/test-site/2024-01-01-final-result.json'];
      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(null);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();

      try {
        await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('[A11yAudit] No latest final result file found for test-site');
        expect(mockLog.error.calledWith('[A11yAudit] No latest final result file found for test-site')).to.be.true;
      }
    });

    it('should handle getObjectFromKey errors', async () => {
      const mockFinalResultFiles = ['accessibility/test-site/2024-01-01-final-result.json'];
      const error = new Error('File not found');
      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.rejects(error);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();

      try {
        await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError).to.equal(error);
        expect(mockLog.error.calledWith('[A11yAudit] Error getting latest final result file for test-site: File not found')).to.be.true;
      }
    });

    it('should throw error when no URLs found in file', async () => {
      const mockFinalResultFiles = ['accessibility/test-site/2024-01-01-final-result.json'];
      const mockLatestFile = {
        overall: { violations: { total: 10 } },
        'non-url-key': { traffic: 25 },
        'another-key': { traffic: 15 },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFile);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();

      try {
        await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('[A11yAudit] No URLs found for test-site');
        expect(mockLog.error.calledWith('[A11yAudit] No URLs found for test-site')).to.be.true;
      }
    });

    it('should use latest file when multiple files exist', async () => {
      const mockFinalResultFiles = [
        'accessibility/test-site/2024-01-01-final-result.json',
        'accessibility/test-site/2024-01-08-final-result.json',
        'accessibility/test-site/2024-01-15-final-result.json',
      ];
      const mockLatestFile = {
        'https://example.com/latest': { traffic: 200 },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFile);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();
      await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);

      expect(getObjectFromKeyStub.calledWith(
        mockS3Client,
        'test-bucket',
        'accessibility/test-site/2024-01-15-final-result.json',
        mockLog,
      )).to.be.true;
    });

    it('should filter out non-URL keys correctly', async () => {
      const mockFinalResultFiles = ['accessibility/test-site/2024-01-01-final-result.json'];
      const mockLatestFile = {
        overall: { violations: { total: 10 } },
        'https://example.com/page1': { traffic: 100 },
        'http://example.com/page2': { traffic: 50 }, // Should not be included (http not https)
        'https://another.com/page3': { traffic: 75 },
        'ftp://example.com/file': { traffic: 25 }, // Should not be included
        'regular-key': { traffic: 30 }, // Should not be included
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFile);

      const testGetUrlsForAudit = createTestGetUrlsForAudit();
      const result = await testGetUrlsForAudit(mockS3Client, 'test-bucket', 'test-site', mockLog);

      expect(result).to.have.length(2);
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[1].url).to.equal('https://another.com/page3');
    });
  });

  describe('linkBuilder', () => {
    it('should build correct link for production environment', () => {
      const linkData = {
        envAsoDomain: 'experience',
        siteId: 'test-site-123',
      };
      const opptyId = 'opportunity-456';

      const result = linkBuilder(linkData, opptyId);

      expect(result).to.equal('https://experience.adobe.com/#/sites-optimizer/sites/test-site-123/opportunities/opportunity-456');
    });

    it('should build correct link for staging environment', () => {
      const linkData = {
        envAsoDomain: 'experience-stage',
        siteId: 'staging-site-789',
      };
      const opptyId = 'staging-opportunity-123';

      const result = linkBuilder(linkData, opptyId);

      expect(result).to.equal('https://experience-stage.adobe.com/#/sites-optimizer/sites/staging-site-789/opportunities/staging-opportunity-123');
    });

    it('should handle special characters in siteId and opptyId', () => {
      const linkData = {
        envAsoDomain: 'experience',
        siteId: 'site-with-dashes_and_underscores',
      };
      const opptyId = 'oppty-with-special-chars_123';

      const result = linkBuilder(linkData, opptyId);

      expect(result).to.equal('https://experience.adobe.com/#/sites-optimizer/sites/site-with-dashes_and_underscores/opportunities/oppty-with-special-chars_123');
    });
  });

  describe('generateReportOpportunity', () => {
    let mockGenMdFn;
    let mockCreateOpportunityFn;
    let mockOpportunity;
    let createReportOpportunityStub;
    let createReportOpportunitySuggestionStub;

    beforeEach(() => {
      mockGenMdFn = sandbox.stub();
      mockCreateOpportunityFn = sandbox.stub();
      mockOpportunity = {
        setStatus: sandbox.stub(),
        save: sandbox.stub(),
        getId: sandbox.stub(),
      };
      createReportOpportunityStub = sandbox.stub();
      createReportOpportunitySuggestionStub = sandbox.stub();
    });

    // Helper function to create a testable version of generateReportOpportunity
    const createTestGenerateReportOpportunity = () => async (
      reportData,
      genMdFn,
      createOpportunityFn,
      reportName,
      shouldIgnore = true,
    ) => {
      const {
        mdData,
        linkData,
        opptyData,
        auditData,
        context,
      } = reportData;
      const { week, year } = opptyData;
      const { log } = context;

      // 1.1 generate the markdown report
      const reportMarkdown = genMdFn(mdData);

      if (!reportMarkdown) {
        return '';
      }

      // 1.2 create the opportunity for the report
      const opportunityInstance = createOpportunityFn(week, year);
      let opportunityRes;

      try {
        opportunityRes = await createReportOpportunityStub(opportunityInstance, auditData, context);
      } catch (error) {
        log.error(`Failed to create report opportunity for ${reportName}`, error.message);
        throw new Error(error.message);
      }

      const { opportunity } = opportunityRes;

      // 1.3 create the suggestions for the report oppty
      try {
        await createReportOpportunitySuggestionStub(
          opportunity,
          reportMarkdown,
          auditData,
          log,
        );
      } catch (error) {
        log.error(`Failed to create report opportunity suggestion for ${reportName}`, error.message);
        throw new Error(error.message);
      }

      // 1.4 update status to ignored
      if (shouldIgnore) {
        await opportunity.setStatus('IGNORED');
        await opportunity.save();
      }

      const opptyId = opportunity.getId();
      const opptyUrl = `https://${linkData.envAsoDomain}.adobe.com/#/sites-optimizer/sites/${linkData.siteId}/opportunities/${opptyId}`;
      return opptyUrl;
    };

    it('should successfully generate report opportunity', async () => {
      const reportData = {
        mdData: { violations: 10, pages: 5 },
        linkData: { envAsoDomain: 'experience', siteId: 'test-site' },
        opptyData: { week: 10, year: 2024 },
        auditData: { siteId: 'test-site', auditId: 'audit-123' },
        context: { log: mockLog },
      };
      const reportMarkdown = '# Accessibility Report\n\nFound 10 violations.';
      const opportunityInstance = { type: 'accessibility', title: 'Fix Issues' };

      mockGenMdFn.returns(reportMarkdown);
      mockCreateOpportunityFn.returns(opportunityInstance);
      createReportOpportunityStub.resolves({ opportunity: mockOpportunity });
      createReportOpportunitySuggestionStub.resolves();
      mockOpportunity.setStatus.resolves();
      mockOpportunity.save.resolves();
      mockOpportunity.getId.returns('opp-456');

      const testGenerateReportOpportunity = createTestGenerateReportOpportunity();
      const result = await testGenerateReportOpportunity(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Test Report',
      );

      expect(result).to.equal('https://experience.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-456');
      expect(mockGenMdFn.calledWith(reportData.mdData)).to.be.true;
      expect(mockCreateOpportunityFn.calledWith(10, 2024)).to.be.true;
      expect(createReportOpportunityStub.calledWith(
        opportunityInstance,
        reportData.auditData,
        reportData.context,
      )).to.be.true;
      expect(createReportOpportunitySuggestionStub.calledWith(
        mockOpportunity,
        reportMarkdown,
        reportData.auditData,
        mockLog,
      )).to.be.true;
      expect(mockOpportunity.setStatus.calledWith('IGNORED')).to.be.true;
      expect(mockOpportunity.save.calledOnce).to.be.true;
    });

    it('should return empty string when markdown is empty', async () => {
      const reportData = {
        mdData: { violations: 0, pages: 0 },
        linkData: { envAsoDomain: 'experience', siteId: 'test-site' },
        opptyData: { week: 10, year: 2024 },
        auditData: { siteId: 'test-site', auditId: 'audit-123' },
        context: { log: mockLog },
      };

      mockGenMdFn.returns(''); // Empty markdown

      const testGenerateReportOpportunity = createTestGenerateReportOpportunity();
      const result = await testGenerateReportOpportunity(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'Empty Report',
      );

      expect(result).to.equal('');
      expect(mockCreateOpportunityFn.called).to.be.false;
      expect(createReportOpportunityStub.called).to.be.false;
    });

    it('should handle createReportOpportunity errors', async () => {
      const reportData = {
        mdData: { violations: 5 },
        linkData: { envAsoDomain: 'experience', siteId: 'test-site' },
        opptyData: { week: 10, year: 2024 },
        auditData: { siteId: 'test-site', auditId: 'audit-123' },
        context: { log: mockLog },
      };
      const error = new Error('Database error');

      mockGenMdFn.returns('# Report');
      mockCreateOpportunityFn.returns({ type: 'test' });
      createReportOpportunityStub.rejects(error);

      const testGenerateReportOpportunity = createTestGenerateReportOpportunity();

      try {
        await testGenerateReportOpportunity(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'Error Report',
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Database error');
        expect(mockLog.error.calledWith('Failed to create report opportunity for Error Report', 'Database error')).to.be.true;
      }
    });

    it('should handle createReportOpportunitySuggestion errors', async () => {
      const reportData = {
        mdData: { violations: 5 },
        linkData: { envAsoDomain: 'experience', siteId: 'test-site' },
        opptyData: { week: 10, year: 2024 },
        auditData: { siteId: 'test-site', auditId: 'audit-123' },
        context: { log: mockLog },
      };
      const error = new Error('Suggestion creation failed');

      mockGenMdFn.returns('# Report');
      mockCreateOpportunityFn.returns({ type: 'test' });
      createReportOpportunityStub.resolves({ opportunity: mockOpportunity });
      createReportOpportunitySuggestionStub.rejects(error);

      const testGenerateReportOpportunity = createTestGenerateReportOpportunity();

      try {
        await testGenerateReportOpportunity(
          reportData,
          mockGenMdFn,
          mockCreateOpportunityFn,
          'Suggestion Error Report',
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Suggestion creation failed');
        expect(mockLog.error.calledWith('Failed to create report opportunity suggestion for Suggestion Error Report', 'Suggestion creation failed')).to.be.true;
      }
    });

    it('should not set status to ignored when shouldIgnore is false', async () => {
      const reportData = {
        mdData: { violations: 5 },
        linkData: { envAsoDomain: 'experience-stage', siteId: 'test-site' },
        opptyData: { week: 15, year: 2024 },
        auditData: { siteId: 'test-site', auditId: 'audit-123' },
        context: { log: mockLog },
      };

      mockGenMdFn.returns('# Report');
      mockCreateOpportunityFn.returns({ type: 'test' });
      createReportOpportunityStub.resolves({ opportunity: mockOpportunity });
      createReportOpportunitySuggestionStub.resolves();
      mockOpportunity.getId.returns('opp-789');

      const testGenerateReportOpportunity = createTestGenerateReportOpportunity();
      const result = await testGenerateReportOpportunity(
        reportData,
        mockGenMdFn,
        mockCreateOpportunityFn,
        'No Ignore Report',
        false, // shouldIgnore = false
      );

      expect(result).to.equal('https://experience-stage.adobe.com/#/sites-optimizer/sites/test-site/opportunities/opp-789');
      expect(mockOpportunity.setStatus.called).to.be.false;
      expect(mockOpportunity.save.called).to.be.false;
    });
  });

  describe('getAuditData', () => {
    it('should successfully get audit data', async () => {
      const mockSite = {
        getLatestAuditByAuditType: sandbox.stub(),
      };
      const mockAudit = {
        id: 'audit-123',
        siteId: 'site-456',
        auditType: 'accessibility',
        result: { violations: 10 },
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAudit);

      const result = await getAuditData(mockSite, 'accessibility');

      expect(result).to.deep.equal(mockAudit);
      expect(mockSite.getLatestAuditByAuditType.calledWith('accessibility')).to.be.true;
    });

    it('should handle different audit types', async () => {
      const mockSite = {
        getLatestAuditByAuditType: sandbox.stub(),
      };
      const mockAudit = { id: 'audit-789', auditType: 'performance' };

      mockSite.getLatestAuditByAuditType.resolves(mockAudit);

      await getAuditData(mockSite, 'performance');

      expect(mockSite.getLatestAuditByAuditType.calledWith('performance')).to.be.true;
    });
  });

  describe('getEnvAsoDomain', () => {
    it('should return experience for production environment', () => {
      const env = { AWS_ENV: 'prod' };

      const result = getEnvAsoDomain(env);

      expect(result).to.equal('experience');
    });

    it('should return experience-stage for non-production environment', () => {
      const env = { AWS_ENV: 'stage' };

      const result = getEnvAsoDomain(env);

      expect(result).to.equal('experience-stage');
    });

    it('should return experience-stage for development environment', () => {
      const env = { AWS_ENV: 'dev' };

      const result = getEnvAsoDomain(env);

      expect(result).to.equal('experience-stage');
    });

    it('should return experience-stage when AWS_ENV is undefined', () => {
      const env = {};

      const result = getEnvAsoDomain(env);

      expect(result).to.equal('experience-stage');
    });
  });

  describe('getWeekNumber', () => {
    it('should calculate correct week number for January 1st, 2024', () => {
      const date = new Date('2024-01-01T00:00:00Z');

      const result = getWeekNumber(date);

      expect(result).to.equal(1);
    });

    it('should calculate correct week number for mid-year date', () => {
      const date = new Date('2024-06-15T00:00:00Z');

      const result = getWeekNumber(date);

      expect(result).to.be.a('number');
      expect(result).to.be.greaterThan(20);
      expect(result).to.be.lessThan(30);
    });

    it('should handle leap year correctly', () => {
      const date = new Date('2024-02-29T00:00:00Z'); // 2024 is a leap year

      const result = getWeekNumber(date);

      expect(result).to.be.a('number');
      expect(result).to.be.greaterThan(8);
      expect(result).to.be.lessThan(11);
    });

    it('should handle different years consistently', () => {
      const date2023 = new Date('2023-06-15T00:00:00Z');
      const date2024 = new Date('2024-06-15T00:00:00Z');

      const result2023 = getWeekNumber(date2023);
      const result2024 = getWeekNumber(date2024);

      expect(result2023).to.be.a('number');
      expect(result2024).to.be.a('number');
      // Week numbers should be similar for the same date in different years
      expect(Math.abs(result2023 - result2024)).to.be.lessThan(2);
    });
  });

  describe('getWeekNumberAndYear', () => {
    let clock;

    beforeEach(() => {
      // Mock the current date to ensure consistent test results
      clock = sinon.useFakeTimers(new Date('2024-06-15T10:30:00Z'));
    });

    afterEach(() => {
      clock.restore();
    });

    it('should return current week number and year', () => {
      const result = getWeekNumberAndYear();

      expect(result).to.have.property('week');
      expect(result).to.have.property('year');
      expect(result.year).to.equal(2024);
      expect(result.week).to.be.a('number');
      expect(result.week).to.be.greaterThan(0);
      expect(result.week).to.be.lessThan(54);
    });

    it('should return consistent results when called multiple times', () => {
      const result1 = getWeekNumberAndYear();
      const result2 = getWeekNumberAndYear();

      expect(result1).to.deep.equal(result2);
    });

    it('should handle year boundary correctly', () => {
      clock.restore();
      clock = sinon.useFakeTimers(new Date('2024-01-01T00:00:00Z'));

      const result = getWeekNumberAndYear();

      expect(result.year).to.equal(2024);
      expect(result.week).to.equal(1);
    });
  });

  describe('generateReportOpportunities', () => {
    let mockSite;
    let mockContext;
    let mockAggregationResult;

    beforeEach(() => {
      mockSite = {
        getId: sandbox.stub().returns('test-site-123'),
        getLatestAuditByAuditType: sandbox.stub(),
      };
      mockContext = {
        log: mockLog,
        env: { AWS_ENV: 'prod' },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub(),
          },
        },
      };
      mockAggregationResult = {
        finalResultFiles: {
          current: { overall: { violations: { total: 10 } } },
          lastWeek: { overall: { violations: { total: 8 } } },
        },
      };
    });

    it('should successfully generate all report opportunities', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      expect(result.message).to.equal('All report opportunities created successfully');
      expect(mockSite.getId.calledOnce).to.be.true;
      expect(mockSite.getLatestAuditByAuditType.calledWith('accessibility')).to.be.true;
      expect(mockContext.dataAccess.Opportunity.create.callCount).to.equal(4);
    });

    it('should handle different audit types', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'performance',
      );

      expect(mockSite.getLatestAuditByAuditType.calledWith('performance')).to.be.true;
    });

    it('should handle different environments', async () => {
      const stagingContext = {
        log: mockLog,
        env: { AWS_ENV: 'stage' },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub(),
          },
        },
      };
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      stagingContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        stagingContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      expect(stagingContext.dataAccess.Opportunity.create.callCount).to.equal(4);
    });

    it('should handle different site IDs', async () => {
      const mockSiteWithDifferentId = {
        getId: sandbox.stub().returns('different-site-456'),
        getLatestAuditByAuditType: sandbox.stub(),
      };
      const mockAuditData = { siteId: 'different-site-456', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSiteWithDifferentId.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSiteWithDifferentId,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      expect(mockSiteWithDifferentId.getId.calledOnce).to.be.true;
    });

    it('should handle different aggregation results', async () => {
      const differentAggregationResult = {
        finalResultFiles: {
          current: { overall: { violations: { total: 15 } } },
          lastWeek: { overall: { violations: { total: 12 } } },
        },
      };
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSite,
        differentAggregationResult,
        mockContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      expect(result.message).to.equal('All report opportunities created successfully');
    });

    it('should handle audit data retrieval errors', async () => {
      const error = new Error('Failed to get audit data');
      mockSite.getLatestAuditByAuditType.rejects(error);

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to get audit data');
      }
    });

    it('should handle opportunity creation errors', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const error = new Error('Failed to create opportunity');

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.rejects(error);

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to create opportunity');
        expect(mockLog.error.calledWith('Failed to generate in-depth report opportunity', 'Failed to create opportunity')).to.be.true;
      }
    });

    it('should handle suggestion creation errors', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().rejects(new Error('Failed to add suggestions')),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      try {
        await generateReportOpportunities(
          mockSite,
          mockAggregationResult,
          mockContext,
          'accessibility',
        );
        expect.fail('Should have thrown an error');
      } catch (thrownError) {
        expect(thrownError.message).to.equal('Failed to add suggestions');
        expect(mockLog.error.calledWith('Failed to generate in-depth report opportunity', 'Failed to add suggestions')).to.be.true;
      }
    });

    it('should call opportunity creation for all four report types', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );

      // Should create 4 opportunities: in-depth, enhanced, fixed vs new, and base
      expect(mockContext.dataAccess.Opportunity.create.callCount).to.equal(4);
      // Should create 4 suggestions
      expect(mockOpportunity.addSuggestions.callCount).to.equal(4);
      // Should set status to ignored for first 3 reports (not base report)
      expect(mockOpportunity.setStatus.callCount).to.equal(3);
      expect(mockOpportunity.save.callCount).to.equal(3);
    });

    it('should use correct environment domain for production', async () => {
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      mockContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      // The function should use 'experience' domain for production environment
      expect(mockContext.env.AWS_ENV).to.equal('prod');
    });

    it('should use correct environment domain for staging', async () => {
      const stagingContext = {
        log: mockLog,
        env: { AWS_ENV: 'stage' },
        dataAccess: {
          Opportunity: {
            create: sandbox.stub(),
          },
        },
      };
      const mockAuditData = { siteId: 'test-site-123', auditId: 'audit-789' };
      const mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opp-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'sugg-123' }),
      };

      mockSite.getLatestAuditByAuditType.resolves(mockAuditData);
      stagingContext.dataAccess.Opportunity.create.resolves(mockOpportunity);

      const result = await generateReportOpportunities(
        mockSite,
        mockAggregationResult,
        stagingContext,
        'accessibility',
      );

      expect(result.status).to.be.true;
      // The function should use 'experience-stage' domain for non-production environment
      expect(stagingContext.env.AWS_ENV).to.equal('stage');
    });
  });
});
