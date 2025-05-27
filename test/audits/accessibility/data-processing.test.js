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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Accessibility Data Processing Utils', () => {
  let sandbox;
  let mockS3Client;
  let mockLog;
  let getSubfoldersUsingPrefixAndDelimiter;
  let DeleteObjectsCommandStub;
  let DeleteObjectCommandStub;
  let ListObjectsV2CommandStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock S3 client
    mockS3Client = {
      send: sandbox.stub(),
    };

    // Mock logger
    mockLog = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    // Mock S3 Commands
    DeleteObjectsCommandStub = sandbox.stub();
    DeleteObjectCommandStub = sandbox.stub();
    ListObjectsV2CommandStub = sandbox.stub();

    // Import the module with mocked dependencies
    const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
      '@aws-sdk/client-s3': {
        DeleteObjectsCommand: DeleteObjectsCommandStub,
        DeleteObjectCommand: DeleteObjectCommandStub,
        ListObjectsV2Command: ListObjectsV2CommandStub,
        PutObjectCommand: sandbox.stub(),
      },
    });

    // eslint-disable-next-line max-len
    getSubfoldersUsingPrefixAndDelimiter = dataProcessingModule.getSubfoldersUsingPrefixAndDelimiter;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('deleteOriginalFiles', () => {
    let deleteOriginalFiles;

    beforeEach(async () => {
      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
      });

      deleteOriginalFiles = dataProcessingModule.deleteOriginalFiles;
    });

    it('should return 0 when objectKeys is null', async () => {
      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        null,
        mockLog,
      );

      // Assert
      expect(result).to.equal(0);
      expect(mockS3Client.send).to.not.have.been.called;
    });

    it('should return 0 when objectKeys is undefined', async () => {
      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        undefined,
        mockLog,
      );

      // Assert
      expect(result).to.equal(0);
      expect(mockS3Client.send).to.not.have.been.called;
    });

    it('should return 0 when objectKeys is an empty array', async () => {
      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        [],
        mockLog,
      );

      // Assert
      expect(result).to.equal(0);
      expect(mockS3Client.send).to.not.have.been.called;
    });

    it('should successfully delete a single object using DeleteObjectCommand', async () => {
      // Arrange
      const objectKeys = ['path/to/file.json'];
      const mockDeleteCommand = { Bucket: 'test-bucket', Key: 'path/to/file.json' };
      DeleteObjectCommandStub.returns(mockDeleteCommand);
      mockS3Client.send.resolves();

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(1);
      expect(DeleteObjectCommandStub).to.have.been.calledOnceWith({
        Bucket: 'test-bucket',
        Key: 'path/to/file.json',
      });
      expect(mockS3Client.send).to.have.been.calledOnceWith(mockDeleteCommand);
    });

    it('should successfully delete multiple objects using DeleteObjectsCommand', async () => {
      // Arrange
      const objectKeys = ['path/to/file1.json', 'path/to/file2.json', 'path/to/file3.json'];
      const expectedDeleteParams = {
        Bucket: 'test-bucket',
        Delete: {
          Objects: [
            { Key: 'path/to/file1.json' },
            { Key: 'path/to/file2.json' },
            { Key: 'path/to/file3.json' },
          ],
          Quiet: true,
        },
      };
      const mockDeleteCommand = expectedDeleteParams;
      DeleteObjectsCommandStub.returns(mockDeleteCommand);
      mockS3Client.send.resolves();

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(3);
      expect(DeleteObjectsCommandStub).to.have.been.calledOnceWith(expectedDeleteParams);
      expect(mockS3Client.send).to.have.been.calledOnceWith(mockDeleteCommand);
    });

    it('should handle error during single object deletion and return 0', async () => {
      // Arrange
      const objectKeys = ['path/to/file.json'];
      const error = new Error('S3 delete failed');
      DeleteObjectCommandStub.returns({});
      mockS3Client.send.rejects(error);

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(0);
      expect(mockLog.error).to.have.been.calledWith('Error deleting original files', error);
    });

    it('should handle error during multiple object deletion and return 0', async () => {
      // Arrange
      const objectKeys = ['path/to/file1.json', 'path/to/file2.json'];
      const error = new Error('S3 bulk delete failed');
      DeleteObjectsCommandStub.returns({});
      mockS3Client.send.rejects(error);

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(0);
      expect(mockLog.error).to.have.been.calledWith('Error deleting original files', error);
    });

    it('should use DeleteObjectsCommand for exactly 2 objects', async () => {
      // Arrange
      const objectKeys = ['file1.json', 'file2.json'];
      const expectedDeleteParams = {
        Bucket: 'test-bucket',
        Delete: {
          Objects: [
            { Key: 'file1.json' },
            { Key: 'file2.json' },
          ],
          Quiet: true,
        },
      };
      DeleteObjectsCommandStub.returns(expectedDeleteParams);
      mockS3Client.send.resolves();

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(2);
      expect(DeleteObjectsCommandStub).to.have.been.calledOnce;
      expect(DeleteObjectCommandStub).to.not.have.been.called;
    });

    it('should handle different bucket names correctly', async () => {
      // Arrange
      const objectKeys = ['test-file.json'];
      const customBucket = 'custom-bucket-name';
      DeleteObjectCommandStub.returns({});
      mockS3Client.send.resolves();

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        customBucket,
        objectKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(1);
      expect(DeleteObjectCommandStub).to.have.been.calledWith({
        Bucket: customBucket,
        Key: 'test-file.json',
      });
    });

    it('should handle object keys with special characters', async () => {
      // Arrange
      const specialKeys = ['path/with spaces/file-name_123.json', 'åäöü/special-chars.json'];
      DeleteObjectsCommandStub.returns({});
      mockS3Client.send.resolves();

      // Act
      const result = await deleteOriginalFiles(
        mockS3Client,
        'test-bucket',
        specialKeys,
        mockLog,
      );

      // Assert
      expect(result).to.equal(2);
      expect(DeleteObjectsCommandStub).to.have.been.calledWith({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [
            { Key: 'path/with spaces/file-name_123.json' },
            { Key: 'åäöü/special-chars.json' },
          ],
          Quiet: true,
        },
      });
    });
  });

  describe('getSubfoldersUsingPrefixAndDelimiter', () => {
    it('should successfully fetch subfolders and return prefixes', async () => {
      // Arrange
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/site-id/folder1/' },
          { Prefix: 'accessibility/site-id/folder2/' },
          { Prefix: 'accessibility/site-id/folder3/' },
        ],
      };
      const mockCommand = {
        Bucket: 'test-bucket', Prefix: 'accessibility/site-id/', MaxKeys: 1000, Delimiter: '/',
      };
      ListObjectsV2CommandStub.returns(mockCommand);
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'accessibility/site-id/',
        '/',
        mockLog,
      );

      // Assert
      expect(result).to.deep.equal([
        'accessibility/site-id/folder1/',
        'accessibility/site-id/folder2/',
        'accessibility/site-id/folder3/',
      ]);
      expect(ListObjectsV2CommandStub).to.have.been.calledOnceWith({
        Bucket: 'test-bucket',
        Prefix: 'accessibility/site-id/',
        MaxKeys: 1000,
        Delimiter: '/',
      });
      expect(mockS3Client.send).to.have.been.calledOnceWith(mockCommand);
      expect(mockLog.info).to.have.been.calledWith(
        'Fetched 3 keys from S3 for bucket test-bucket and prefix accessibility/site-id/ with delimiter /',
      );
    });

    it('should use custom maxKeys parameter when provided', async () => {
      // Arrange
      const mockResponse = { CommonPrefixes: [{ Prefix: 'test/' }] };
      const customMaxKeys = 500;
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'test-prefix/',
        '/',
        mockLog,
        customMaxKeys,
      );

      // Assert
      expect(ListObjectsV2CommandStub).to.have.been.calledWith({
        Bucket: 'test-bucket',
        Prefix: 'test-prefix/',
        MaxKeys: customMaxKeys,
        Delimiter: '/',
      });
    });

    it('should return empty array when no CommonPrefixes found', async () => {
      // Arrange
      const mockResponse = { CommonPrefixes: [] };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'empty-prefix/',
        '/',
        mockLog,
      );

      // Assert
      expect(result).to.deep.equal([]);
      expect(mockLog.info).to.have.been.calledWith(
        'Fetched 0 keys from S3 for bucket test-bucket and prefix empty-prefix/ with delimiter /',
      );
    });

    it('should throw error when s3Client is missing', async () => {
      // Act & Assert
      await expect(
        getSubfoldersUsingPrefixAndDelimiter(
          null,
          'test-bucket',
          'test-prefix/',
          '/',
          mockLog,
        ),
      ).to.be.rejectedWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter, bucketName, and prefix are provided.',
      );

      expect(mockLog.error).to.have.been.calledWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:/, bucketName:test-bucket, and prefix:test-prefix/ are provided.',
      );
    });

    it('should throw error when bucketName is missing', async () => {
      // Act & Assert
      await expect(
        getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          null,
          'test-prefix/',
          '/',
          mockLog,
        ),
      ).to.be.rejectedWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter, bucketName, and prefix are provided.',
      );

      expect(mockLog.error).to.have.been.calledWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:/, bucketName:null, and prefix:test-prefix/ are provided.',
      );
    });

    it('should throw error when prefix is missing', async () => {
      // Act & Assert
      await expect(
        getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          null,
          '/',
          mockLog,
        ),
      ).to.be.rejectedWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter, bucketName, and prefix are provided.',
      );

      expect(mockLog.error).to.have.been.calledWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:/, bucketName:test-bucket, and prefix:null are provided.',
      );
    });

    it('should throw error when delimiter is missing', async () => {
      // Act & Assert
      await expect(
        getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          'test-prefix/',
          null,
          mockLog,
        ),
      ).to.be.rejectedWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter, bucketName, and prefix are provided.',
      );

      expect(mockLog.error).to.have.been.calledWith(
        'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:null, bucketName:test-bucket, and prefix:test-prefix/ are provided.',
      );
    });

    it('should handle S3 errors and re-throw them', async () => {
      // Arrange
      const s3Error = new Error('S3 service unavailable');
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.rejects(s3Error);

      // Act & Assert
      await expect(
        getSubfoldersUsingPrefixAndDelimiter(
          mockS3Client,
          'test-bucket',
          'test-prefix/',
          '/',
          mockLog,
        ),
      ).to.be.rejectedWith('S3 service unavailable');

      expect(mockLog.error).to.have.been.calledWith(
        'Error while fetching S3 object keys using bucket test-bucket and prefix test-prefix/ with delimiter /',
        s3Error,
      );
    });

    it('should handle different bucket and prefix combinations', async () => {
      // Arrange
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'logs/2024/01/' },
          { Prefix: 'logs/2024/02/' },
        ],
      };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'production-logs',
        'logs/2024/',
        '/',
        mockLog,
      );

      // Assert
      expect(result).to.deep.equal(['logs/2024/01/', 'logs/2024/02/']);
      expect(ListObjectsV2CommandStub).to.have.been.calledWith({
        Bucket: 'production-logs',
        Prefix: 'logs/2024/',
        MaxKeys: 1000,
        Delimiter: '/',
      });
    });

    it('should handle different delimiters correctly', async () => {
      // Arrange
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'data|section1|' },
          { Prefix: 'data|section2|' },
        ],
      };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await getSubfoldersUsingPrefixAndDelimiter(
        mockS3Client,
        'test-bucket',
        'data|',
        '|',
        mockLog,
      );

      // Assert
      expect(result).to.deep.equal(['data|section1|', 'data|section2|']);
      expect(ListObjectsV2CommandStub).to.have.been.calledWith({
        Bucket: 'test-bucket',
        Prefix: 'data|',
        MaxKeys: 1000,
        Delimiter: '|',
      });
    });
  });

  describe('aggregateAccessibilityData', () => {
    let aggregateAccessibilityData;
    let PutObjectCommandStub;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Additional mocks for aggregateAccessibilityData
      PutObjectCommandStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
          PutObjectCommand: PutObjectCommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
      });

      aggregateAccessibilityData = dataProcessingModule.aggregateAccessibilityData;
    });

    it('should return error when s3Client is missing', async () => {
      // Act
      const result = await aggregateAccessibilityData(
        null,
        'test-bucket',
        'test-site-id',
        mockLog,
        'output.json',
        '2024-03-15',
      );

      // Assert
      expect(result).to.deep.equal({
        success: false,
        aggregatedData: null,
        message: 'Missing required parameters for aggregateAccessibilityData',
      });
      expect(mockLog.error).to.have.been.calledWith(
        'Missing required parameters for aggregateAccessibilityData',
      );
    });

    it('should return error when bucketName is missing', async () => {
      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        null,
        'test-site-id',
        mockLog,
        'output.json',
        '2024-03-15',
      );

      // Assert
      expect(result).to.deep.equal({
        success: false,
        aggregatedData: null,
        message: 'Missing required parameters for aggregateAccessibilityData',
      });
      expect(mockLog.error).to.have.been.calledWith(
        'Missing required parameters for aggregateAccessibilityData',
      );
    });

    it('should return error when siteId is missing', async () => {
      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        null,
        mockLog,
        'output.json',
        '2024-03-15',
      );

      // Assert
      expect(result).to.deep.equal({
        success: false,
        aggregatedData: null,
        message: 'Missing required parameters for aggregateAccessibilityData',
      });
      expect(mockLog.error).to.have.been.calledWith(
        'Missing required parameters for aggregateAccessibilityData',
      );
    });

    it('should return error when no subfolders are found', async () => {
      // Arrange
      const mockResponse = { CommonPrefixes: [] };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.include('No accessibility data found in bucket');
      expect(mockLog.info).to.have.been.calledWith(
        'Fetching accessibility data for site test-site-id from bucket test-bucket',
      );
    });

    it('should return error when no current subfolders match version', async () => {
      // Arrange
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710000000000/' }, // Different date
        ],
      };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.include("No accessibility data found for today's date");
    });

    it('should return error when no object keys are found in subfolders', async () => {
      // Arrange
      const mockResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' }, // 2024-03-15
        ],
      };
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockResponse);
      getObjectKeysUsingPrefixStub.resolves([]);

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.include('No accessibility data found in bucket');
    });

    it('should successfully aggregate accessibility data', async () => {
      // Arrange
      const mockSubfoldersResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' }, // 2024-03-15
        ],
      };

      const mockObjectKeys = [
        'accessibility/test-site-id/1710460800000/file1.json',
        'accessibility/test-site-id/1710460800000/file2.json',
      ];

      const mockFileData1 = {
        url: 'https://example.com/page1',
        violations: {
          total: 5,
          critical: {
            count: 3,
            items: {
              rule1: {
                count: 3,
                description: 'Test rule 1',
                level: 'AA',
                understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/rule1',
                successCriteriaNumber: '1.1.1',
              },
            },
          },
          serious: {
            count: 2,
            items: {
              rule2: {
                count: 2,
                description: 'Test rule 2',
                level: 'A',
                understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/rule2',
                successCriteriaNumber: '2.1.1',
              },
            },
          },
        },
        traffic: 1000,
      };

      const mockFileData2 = {
        url: 'https://example.com/page2',
        violations: {
          total: 3,
          critical: {
            count: 1,
            items: {
              rule1: {
                count: 1,
                description: 'Test rule 1',
                level: 'AA',
                understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/rule1',
                successCriteriaNumber: '1.1.1',
              },
            },
          },
          serious: {
            count: 2,
            items: {
              rule3: {
                count: 2,
                description: 'Test rule 3',
                level: 'A',
                understandingUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/rule3',
                successCriteriaNumber: '3.1.1',
              },
            },
          },
        },
        traffic: 500,
      };

      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockSubfoldersResponse);
      getObjectKeysUsingPrefixStub.onFirstCall().resolves(mockObjectKeys);
      getObjectKeysUsingPrefixStub.onSecondCall().resolves([]); // No previous final results
      getObjectFromKeyStub.onFirstCall().resolves(mockFileData1);
      getObjectFromKeyStub.onSecondCall().resolves(mockFileData2);
      PutObjectCommandStub.returns({});

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(result.message).to.equal('Successfully aggregated 2 files into accessibility/test-site-id/2024-03-15-final-result.json');

      // Check aggregated data structure
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(8);
      expect(result.finalResultFiles.current.overall.violations.critical.count).to.equal(4);
      expect(result.finalResultFiles.current.overall.violations.serious.count).to.equal(4);

      // Check individual page data
      expect(result.finalResultFiles.current['https://example.com/page1']).to.deep.equal({
        violations: mockFileData1.violations,
        traffic: 1000,
      });
      expect(result.finalResultFiles.current['https://example.com/page2']).to.deep.equal({
        violations: mockFileData2.violations,
        traffic: 500,
      });

      // Verify S3 operations
      expect(PutObjectCommandStub).to.have.been.calledOnceWith({
        Bucket: 'test-bucket',
        Key: 'accessibility/test-site-id/2024-03-15-final-result.json',
        Body: sinon.match.string,
        ContentType: 'application/json',
      });
    });

    it('should handle failed file reads gracefully', async () => {
      // Arrange
      const mockSubfoldersResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' },
        ],
      };

      const mockObjectKeys = [
        'accessibility/test-site-id/1710460800000/file1.json',
        'accessibility/test-site-id/1710460800000/file2.json',
      ];

      const mockFileData = {
        url: 'https://example.com/page1',
        // eslint-disable-next-line max-len
        violations: { total: 1, critical: { count: 1, items: {} }, serious: { count: 0, items: {} } },
        traffic: 100,
      };

      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockSubfoldersResponse);
      getObjectKeysUsingPrefixStub.onFirstCall().resolves(mockObjectKeys);
      getObjectKeysUsingPrefixStub.onSecondCall().resolves([]);
      getObjectFromKeyStub.onFirstCall().resolves(mockFileData);
      getObjectFromKeyStub.onSecondCall().resolves(null); // Failed read
      PutObjectCommandStub.returns({});

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(mockLog.warn).to.have.been.calledWith(
        'Failed to get data from accessibility/test-site-id/1710460800000/file2.json, skipping',
      );
      expect(result.finalResultFiles.current.overall.violations.total).to.equal(1);
    });

    it('should handle S3 errors and return failure', async () => {
      // Arrange
      const s3Error = new Error('S3 connection failed');
      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.rejects(s3Error);

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Error: S3 connection failed');
      expect(mockLog.error).to.have.been.calledWith(
        'Error aggregating accessibility data for site test-site-id',
        s3Error,
      );
    });

    it('should delete oldest final result files when more than 2 exist', async () => {
      // Arrange
      const mockSubfoldersResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' },
        ],
      };

      const mockObjectKeys = ['file1.json'];
      const mockFileData = {
        url: 'https://example.com/page1',
        // eslint-disable-next-line max-len
        violations: { total: 1, critical: { count: 0, items: {} }, serious: { count: 1, items: {} } },
        traffic: 100,
      };

      const mockFinalResultKeys = [
        'accessibility/test-site-id/2024-03-01-final-result.json',
        'accessibility/test-site-id/2024-03-08-final-result.json',
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockSubfoldersResponse);
      getObjectKeysUsingPrefixStub.onFirstCall().resolves(mockObjectKeys);
      getObjectKeysUsingPrefixStub.onSecondCall().resolves(mockFinalResultKeys);
      getObjectFromKeyStub.onFirstCall().resolves(mockFileData);
      getObjectFromKeyStub.onSecondCall().resolves({ lastWeekData: 'test' });
      PutObjectCommandStub.returns({});
      DeleteObjectCommandStub.returns({});

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(result.finalResultFiles.lastWeek).to.deep.equal({ lastWeekData: 'test' });
      expect(mockLog.info).to.have.been.calledWith(
        'Deleted 1 oldest final result file: accessibility/test-site-id/2024-03-01-final-result.json',
      );
    });

    it('should handle case with no previous final result files', async () => {
      // Arrange
      const mockSubfoldersResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' },
        ],
      };

      const mockObjectKeys = ['file1.json'];
      const mockFileData = {
        url: 'https://example.com/page1',
        // eslint-disable-next-line max-len
        violations: { total: 0, critical: { count: 0, items: {} }, serious: { count: 0, items: {} } },
        traffic: 100,
      };

      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockSubfoldersResponse);
      getObjectKeysUsingPrefixStub.onFirstCall().resolves(mockObjectKeys);
      getObjectKeysUsingPrefixStub.onSecondCall().resolves([]);
      getObjectFromKeyStub.resolves(mockFileData);
      PutObjectCommandStub.returns({});

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.true;
      expect(result.finalResultFiles.lastWeek).to.be.null;
      expect(mockLog.info).to.have.been.calledWith(
        '[A11yAudit] Found 0 final-result files in the accessibility/siteId folder with keys: ',
      );
    });

    it('should correctly aggregate multiple violation types', async () => {
      // Arrange
      const mockSubfoldersResponse = {
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1710460800000/' },
        ],
      };

      const mockObjectKeys = ['file1.json'];
      const mockFileData = {
        url: 'https://example.com/page1',
        violations: {
          total: 10,
          critical: {
            count: 5,
            items: {
              rule1: {
                count: 3,
                description: 'Critical rule 1',
                level: 'AA',
                understandingUrl: 'https://example.com/rule1',
                successCriteriaNumber: '1.1.1',
              },
              rule2: {
                count: 2,
                description: 'Critical rule 2',
                level: 'A',
                understandingUrl: 'https://example.com/rule2',
                successCriteriaNumber: '2.1.1',
              },
            },
          },
          serious: {
            count: 5,
            items: {
              rule3: {
                count: 3,
                description: 'Serious rule 3',
                level: 'AA',
                understandingUrl: 'https://example.com/rule3',
                successCriteriaNumber: '3.1.1',
              },
              rule4: {
                count: 2,
                description: 'Serious rule 4',
                level: 'A',
                understandingUrl: 'https://example.com/rule4',
                successCriteriaNumber: '4.1.1',
              },
            },
          },
        },
        traffic: 1000,
      };

      ListObjectsV2CommandStub.returns({});
      mockS3Client.send.resolves(mockSubfoldersResponse);
      getObjectKeysUsingPrefixStub.onFirstCall().resolves(mockObjectKeys);
      getObjectKeysUsingPrefixStub.onSecondCall().resolves([]);
      getObjectFromKeyStub.resolves(mockFileData);
      PutObjectCommandStub.returns({});

      // Act
      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      // Assert
      expect(result.success).to.be.true;
      const overall = result.finalResultFiles.current.overall.violations;
      expect(overall.total).to.equal(10);
      expect(overall.critical.count).to.equal(5);
      expect(overall.serious.count).to.equal(5);
      expect(overall.critical.items.rule1.count).to.equal(3);
      expect(overall.critical.items.rule2.count).to.equal(2);
      expect(overall.serious.items.rule3.count).to.equal(3);
      expect(overall.serious.items.rule4.count).to.equal(2);
    });
  });

  describe('createReportOpportunity', () => {
    let createReportOpportunity;
    let mockContext;
    let mockOpportunity;
    let mockDataAccess;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock the Opportunity object
      mockOpportunity = {
        create: sandbox.stub(),
      };

      // Mock the dataAccess object
      mockDataAccess = {
        Opportunity: mockOpportunity,
      };

      // Mock the context object
      mockContext = {
        log: mockLog,
        dataAccess: mockDataAccess,
      };

      // Mock s3-utils functions
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
      });

      createReportOpportunity = dataProcessingModule.createReportOpportunity;
    });

    it('should successfully create a report opportunity', async () => {
      // Arrange
      const opportunityInstance = {
        runbook: 'accessibility-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Accessibility Issues Found',
        description: 'Several accessibility issues were detected on the site',
        tags: ['accessibility', 'audit'],
      };

      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockCreatedOpportunity = {
        id: 'opportunity-123',
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
        ...opportunityInstance,
      };

      mockOpportunity.create.resolves(mockCreatedOpportunity);

      // Act
      const result = await createReportOpportunity(opportunityInstance, auditData, mockContext);

      // Assert
      expect(result.status).to.be.true;
      expect(result.opportunity).to.deep.equal(mockCreatedOpportunity);
      expect(mockOpportunity.create).to.have.been.calledOnceWith({
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
        runbook: 'accessibility-runbook',
        type: 'accessibility',
        origin: 'spacecat',
        title: 'Accessibility Issues Found',
        description: 'Several accessibility issues were detected on the site',
        tags: ['accessibility', 'audit'],
      });
    });

    it('should handle opportunity creation failure and return error', async () => {
      // Arrange
      const opportunityInstance = {
        runbook: 'test-runbook',
        type: 'test-type',
        origin: 'test-origin',
        title: 'Test Title',
        description: 'Test Description',
        tags: ['test'],
      };

      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const createError = new Error('Database connection failed');
      mockOpportunity.create.rejects(createError);

      // Act
      const result = await createReportOpportunity(opportunityInstance, auditData, mockContext);

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Error: Database connection failed');
      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId test-site-id and auditId test-audit-id: Database connection failed',
      );
    });

    it('should handle missing opportunity instance properties', async () => {
      // Arrange
      const opportunityInstance = {
        runbook: 'test-runbook',
        // Missing other properties
      };

      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockCreatedOpportunity = {
        id: 'opportunity-456',
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
        runbook: 'test-runbook',
        type: undefined,
        origin: undefined,
        title: undefined,
        description: undefined,
        tags: undefined,
      };

      mockOpportunity.create.resolves(mockCreatedOpportunity);

      // Act
      const result = await createReportOpportunity(opportunityInstance, auditData, mockContext);

      // Assert
      expect(result.status).to.be.true;
      expect(mockOpportunity.create).to.have.been.calledOnceWith({
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
        runbook: 'test-runbook',
        type: undefined,
        origin: undefined,
        title: undefined,
        description: undefined,
        tags: undefined,
      });
    });

    it('should handle empty audit data', async () => {
      // Arrange
      const opportunityInstance = {
        runbook: 'test-runbook',
        type: 'test-type',
      };

      const auditData = {}; // Empty audit data

      const mockCreatedOpportunity = {
        id: 'opportunity-789',
        siteId: undefined,
        auditId: undefined,
        runbook: 'test-runbook',
        type: 'test-type',
      };

      mockOpportunity.create.resolves(mockCreatedOpportunity);

      // Act
      const result = await createReportOpportunity(opportunityInstance, auditData, mockContext);

      // Assert
      expect(result.status).to.be.true;
      expect(mockOpportunity.create).to.have.been.calledOnceWith({
        siteId: undefined,
        auditId: undefined,
        runbook: 'test-runbook',
        type: 'test-type',
        origin: undefined,
        title: undefined,
        description: undefined,
        tags: undefined,
      });
    });
  });

  describe('createReportOpportunitySuggestion', () => {
    let createReportOpportunitySuggestion;
    let createReportOpportunitySuggestionInstanceStub;
    let mockOpportunity;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock the opportunity object
      mockOpportunity = {
        addSuggestions: sandbox.stub(),
      };

      // Mock the utility functions
      createReportOpportunitySuggestionInstanceStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/report-oppty.js': {
          createReportOpportunitySuggestionInstance: createReportOpportunitySuggestionInstanceStub,
        },
      });

      createReportOpportunitySuggestion = dataProcessingModule.createReportOpportunitySuggestion;
    });

    it('should successfully create a report opportunity suggestion', async () => {
      // Arrange
      const inDepthOverviewMarkdown = '## Accessibility Analysis\n\nSeveral issues found...';
      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockSuggestions = {
        type: 'markdown',
        content: inDepthOverviewMarkdown,
        title: 'Accessibility Improvement Suggestions',
      };

      const mockCreatedSuggestion = {
        id: 'suggestion-123',
        opportunityId: 'opportunity-456',
        ...mockSuggestions,
      };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(mockCreatedSuggestion);

      // Act
      const result = await createReportOpportunitySuggestion(
        mockOpportunity,
        inDepthOverviewMarkdown,
        auditData,
        mockLog,
      );

      // Assert
      expect(result.status).to.be.true;
      expect(result.suggestion).to.deep.equal(mockCreatedSuggestion);
      expect(createReportOpportunitySuggestionInstanceStub).to.have.been.calledOnceWith(
        inDepthOverviewMarkdown,
      );
      expect(mockOpportunity.addSuggestions).to.have.been.calledOnceWith(mockSuggestions);
    });

    it('should handle suggestion creation failure and return error', async () => {
      // Arrange
      const inDepthOverviewMarkdown = '## Test markdown content';
      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockSuggestions = {
        type: 'markdown',
        content: inDepthOverviewMarkdown,
      };

      const addSuggestionsError = new Error('Failed to save suggestion');
      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.rejects(addSuggestionsError);

      // Act
      const result = await createReportOpportunitySuggestion(
        mockOpportunity,
        inDepthOverviewMarkdown,
        auditData,
        mockLog,
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.equal('Error: Failed to save suggestion');
      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new suggestion for siteId test-site-id and auditId test-audit-id: Failed to save suggestion',
      );
    });

    it('should handle empty markdown content', async () => {
      // Arrange
      const inDepthOverviewMarkdown = '';
      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockSuggestions = {
        type: 'markdown',
        content: '',
      };

      const mockCreatedSuggestion = {
        id: 'suggestion-789',
        ...mockSuggestions,
      };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(mockCreatedSuggestion);

      // Act
      const result = await createReportOpportunitySuggestion(
        mockOpportunity,
        inDepthOverviewMarkdown,
        auditData,
        mockLog,
      );

      // Assert
      expect(result.status).to.be.true;
      expect(result.suggestion).to.deep.equal(mockCreatedSuggestion);
      expect(createReportOpportunitySuggestionInstanceStub).to.have.been.calledOnceWith('');
    });

    it('should handle null opportunity object gracefully', async () => {
      // Arrange
      const inDepthOverviewMarkdown = '## Test content';
      const auditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };

      const mockSuggestions = {
        type: 'markdown',
        content: inDepthOverviewMarkdown,
      };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);

      // Act
      const result = await createReportOpportunitySuggestion(
        null,
        inDepthOverviewMarkdown,
        auditData,
        mockLog,
      );

      // Assert
      expect(result.success).to.be.false;
      expect(result.message).to.include('Error:');
      expect(mockLog.error).to.have.been.calledWith(
        sinon.match(/Failed to create new suggestion for siteId test-site-id and auditId test-audit-id:/),
      );
      expect(createReportOpportunitySuggestionInstanceStub).to.have.been.calledOnceWith(
        inDepthOverviewMarkdown,
      );
    });

    it('should handle complex markdown content with multiple sections', async () => {
      // Arrange
      const inDepthOverviewMarkdown = `# Accessibility Audit Report

## Summary
Multiple accessibility issues detected.

### Critical Issues
- Missing alt text on images
- Insufficient color contrast

### Recommendations
1. Add alt text to all images
2. Increase color contrast ratios
3. Implement keyboard navigation

## Technical Details
\`\`\`html
<img src="example.jpg" alt="Description">
\`\`\``;

      const auditData = {
        siteId: 'complex-site-id',
        auditId: 'complex-audit-id',
      };

      const mockSuggestions = {
        type: 'markdown',
        content: inDepthOverviewMarkdown,
        title: 'Detailed Accessibility Report',
      };

      const mockCreatedSuggestion = {
        id: 'suggestion-complex-123',
        ...mockSuggestions,
      };

      createReportOpportunitySuggestionInstanceStub.returns(mockSuggestions);
      mockOpportunity.addSuggestions.resolves(mockCreatedSuggestion);

      // Act
      const result = await createReportOpportunitySuggestion(
        mockOpportunity,
        inDepthOverviewMarkdown,
        auditData,
        mockLog,
      );

      // Assert
      expect(result.status).to.be.true;
      expect(result.suggestion.content).to.equal(inDepthOverviewMarkdown);
      expect(createReportOpportunitySuggestionInstanceStub).to.have.been.calledOnceWith(
        inDepthOverviewMarkdown,
      );
    });
  });

  describe('getUrlsForAudit', () => {
    let getUrlsForAudit;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock functions
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
      });

      getUrlsForAudit = dataProcessingModule.getUrlsForAudit;
    });

    it('should successfully extract URLs from final result file', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-01-final-result.json',
        'accessibility/test-site-id/2024-03-08-final-result.json',
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      const mockLatestFileData = {
        overall: {
          violations: { total: 10, critical: { count: 5 }, serious: { count: 5 } },
        },
        'https://example.com/': {
          violations: { total: 3 },
          traffic: 1000,
        },
        'https://example.com/about': {
          violations: { total: 2 },
          traffic: 500,
        },
        'https://example.com/contact': {
          violations: { total: 1 },
          traffic: 250,
        },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act
      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      // Assert
      expect(result).to.have.lengthOf(3);
      expect(result).to.deep.equal([
        {
          url: 'https://example.com/',
          urlId: 'example.com/',
          traffic: 1000,
        },
        {
          url: 'https://example.com/about',
          urlId: 'example.com/about',
          traffic: 500,
        },
        {
          url: 'https://example.com/contact',
          urlId: 'example.com/contact',
          traffic: 250,
        },
      ]);

      expect(getObjectKeysUsingPrefixStub).to.have.been.calledOnceWith(
        mockS3Client,
        bucketName,
        'accessibility/test-site-id/',
        mockLog,
        10,
        '-final-result.json',
      );
      expect(getObjectFromKeyStub).to.have.been.calledOnceWith(
        mockS3Client,
        bucketName,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        mockLog,
      );
    });

    it('should throw error when no final result files are found', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      getObjectKeysUsingPrefixStub.resolves([]);

      // Act & Assert
      await expect(
        getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog),
      ).to.be.rejectedWith('[A11yAudit] No final result files found for test-site-id');

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] No final result files found for test-site-id',
      );
      expect(getObjectFromKeyStub).to.not.have.been.called;
    });

    it('should handle error when getting final result files fails', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';
      const s3Error = new Error('S3 access denied');

      getObjectKeysUsingPrefixStub.rejects(s3Error);

      // Act & Assert
      await expect(
        getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog),
      ).to.be.rejectedWith('S3 access denied');

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] Error getting final result files for test-site-id: S3 access denied',
      );
    });

    it('should throw error when latest final result file is null', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(null);

      // Act & Assert
      await expect(
        getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog),
      ).to.be.rejectedWith('[A11yAudit] No latest final result file found for test-site-id');

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] No latest final result file found for test-site-id',
      );
    });

    it('should handle error when getting latest final result file fails', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      const fileReadError = new Error('File corrupted');

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.rejects(fileReadError);

      // Act & Assert
      await expect(
        getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog),
      ).to.be.rejectedWith('File corrupted');

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] Error getting latest final result file for test-site-id: File corrupted',
      );
    });

    it('should throw error when no URLs are found in the file', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      const mockLatestFileData = {
        overall: {
          violations: { total: 0 },
        },
        metadata: {
          timestamp: '2024-03-15',
        },
        // No https:// URLs
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act & Assert
      await expect(
        getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog),
      ).to.be.rejectedWith('[A11yAudit] No URLs found for test-site-id');

      expect(mockLog.error).to.have.been.calledWith(
        '[A11yAudit] No URLs found for test-site-id',
      );
    });

    it('should select the latest final result file when multiple exist', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-01-final-result.json',
        'accessibility/test-site-id/2024-03-08-final-result.json',
        'accessibility/test-site-id/2024-03-15-final-result.json',
        'accessibility/test-site-id/2024-03-22-final-result.json',
      ];

      const mockLatestFileData = {
        overall: { violations: { total: 1 } },
        'https://example.com/latest': {
          violations: { total: 1 },
          traffic: 100,
        },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act
      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      // Assert
      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://example.com/latest');
      expect(getObjectFromKeyStub).to.have.been.calledOnceWith(
        mockS3Client,
        bucketName,
        'accessibility/test-site-id/2024-03-22-final-result.json', // Latest file
        mockLog,
      );
    });

    it('should properly remove overall data and only process HTTPS URLs', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      const mockLatestFileData = {
        overall: {
          violations: { total: 5 },
        },
        'https://example.com/page1': {
          violations: { total: 2 },
          traffic: 800,
        },
        'http://example.com/page2': { // Should be ignored (not https)
          violations: { total: 1 },
          traffic: 400,
        },
        metadata: { // Should be ignored (no https)
          timestamp: '2024-03-15',
        },
        'https://example.com/page3': {
          violations: { total: 1 },
          traffic: 200,
        },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act
      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      // Assert
      expect(result).to.have.lengthOf(2);
      expect(result).to.deep.equal([
        {
          url: 'https://example.com/page1',
          urlId: 'example.com/page1',
          traffic: 800,
        },
        {
          url: 'https://example.com/page3',
          urlId: 'example.com/page3',
          traffic: 200,
        },
      ]);

      // Verify overall was removed (function modifies the object)
      expect(mockLatestFileData.overall).to.be.undefined;
    });

    it('should handle URLs with complex paths and query parameters', async () => {
      // Arrange
      const siteId = 'complex-site';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/complex-site/2024-03-15-final-result.json',
      ];

      const mockLatestFileData = {
        overall: { violations: { total: 3 } },
        'https://example.com/products/category?filter=active&sort=name': {
          violations: { total: 2 },
          traffic: 1500,
        },
        'https://subdomain.example.com/api/v1/users/123': {
          violations: { total: 1 },
          traffic: 300,
        },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act
      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      // Assert
      expect(result).to.have.lengthOf(2);
      expect(result).to.deep.equal([
        {
          url: 'https://example.com/products/category?filter=active&sort=name',
          urlId: 'example.com/products/category?filter=active&sort=name',
          traffic: 1500,
        },
        {
          url: 'https://subdomain.example.com/api/v1/users/123',
          urlId: 'subdomain.example.com/api/v1/users/123',
          traffic: 300,
        },
      ]);
    });

    it('should handle missing traffic data gracefully', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const bucketName = 'test-bucket';

      const mockFinalResultFiles = [
        'accessibility/test-site-id/2024-03-15-final-result.json',
      ];

      const mockLatestFileData = {
        overall: { violations: { total: 1 } },
        'https://example.com/page-no-traffic': {
          violations: { total: 1 },
          // Missing traffic property
        },
      };

      getObjectKeysUsingPrefixStub.resolves(mockFinalResultFiles);
      getObjectFromKeyStub.resolves(mockLatestFileData);

      // Act
      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      // Assert
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        url: 'https://example.com/page-no-traffic',
        urlId: 'example.com/page-no-traffic',
        traffic: undefined,
      });
    });
  });

  describe('generateIndepthReportOpportunity', () => {
    let generateIndepthReportOpportunity;
    let generateInDepthReportMarkdownStub;
    let createInDepthReportOpportunityStub;
    let mockOpportunity;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock external functions
      generateInDepthReportMarkdownStub = sandbox.stub();
      createInDepthReportOpportunityStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Mock opportunity object
      mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opportunity-123'),
        addSuggestions: sandbox.stub().resolves({ id: 'suggestion-123' }),
      };

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          generateInDepthReportMarkdown: generateInDepthReportMarkdownStub,
        },
        '../../../src/accessibility/utils/report-oppty.js': {
          createInDepthReportOpportunity: createInDepthReportOpportunityStub,
          createReportOpportunitySuggestionInstance: sandbox.stub().returns([{
            type: 'CONTENT_UPDATE',
            rank: 1,
            status: 'NEW',
            data: { suggestionValue: 'test markdown' },
          }]),
        },
      });

      generateIndepthReportOpportunity = dataProcessingModule.generateIndepthReportOpportunity;
    });

    it('should successfully generate in-depth report opportunity', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const orgId = 'test-org-id';
      const envAsoDomain = 'experience';
      const week = 12;
      const year = 2024;
      const mockMarkdown = '# Accessibility Report\n\nDetailed analysis...';
      const mockOpportunityInstance = {
        type: 'accessibility-indepth',
        title: 'In-depth Accessibility Report',
      };
      const mockAuditData = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
      };
      const mockContext = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(mockOpportunity),
          },
        },
      };
      const mockCurrent = {
        violations: {
          total: 25,
          critical: { count: 10 },
          serious: { count: 15 },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act
      const result = await generateIndepthReportOpportunity(
        siteId,
        mockLog,
        mockCurrent,
        orgId,
        envAsoDomain,
        mockAuditData,
        mockContext,
        week,
        year,
      );

      // Assert
      expect(result).to.equal(
        'https://experience.adobe.com/?organizationId=test-org-id#/@aem-sites-engineering/sites-optimizer/sites/test-site-id/opportunities/opportunity-123',
      );

      expect(generateInDepthReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent);
      expect(createInDepthReportOpportunityStub).to.have.been.calledOnceWith(week, year);
      expect(mockContext.dataAccess.Opportunity.create).to.have.been.calledOnceWith({
        siteId: mockAuditData.siteId,
        auditId: mockAuditData.auditId,
        runbook: mockOpportunityInstance.runbook,
        type: mockOpportunityInstance.type,
        origin: mockOpportunityInstance.origin,
        title: mockOpportunityInstance.title,
        description: mockOpportunityInstance.description,
        tags: mockOpportunityInstance.tags,
      });
      expect(mockOpportunity.addSuggestions).to.have.been.calledOnce;
      expect(mockOpportunity.setStatus).to.have.been.calledOnceWith('IGNORED');
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(mockOpportunity.getId).to.have.been.calledOnce;
    });

    it('should throw error when markdown generation fails', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 0 } };

      generateInDepthReportMarkdownStub.returns(null);

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          12,
          2024,
        ),
      ).to.be.rejectedWith('Failed to generate in-depth overview markdown');

      expect(generateInDepthReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent);
      expect(createInDepthReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when markdown generation returns empty string', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 0 } };

      generateInDepthReportMarkdownStub.returns('');

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          12,
          2024,
        ),
      ).to.be.rejectedWith('Failed to generate in-depth overview markdown');
    });

    it('should throw error when opportunity creation fails', async () => {
      // Arrange
      const mockMarkdown = '# Test Report';
      const mockOpportunityInstance = { type: 'test' };
      const mockContextWithFailure = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(null), // simulate failure
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          'site-id',
          mockLog,
          {
            overall: {
              violations: {
                total: 5,
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 1,
                critical: {
                  items: {
                    rule1: {
                      count: 1,
                      description: 'Critical issue 1',
                    },
                  },
                },
                serious: {
                  items: {
                    rule2: {
                      count: 1,
                      description: 'Serious issue 1',
                    },
                  },
                },
              },
            },
          },
          'org-id',
          'experience',
          { siteId: 'site-id', auditId: 'test-audit-id' },
          mockContextWithFailure,
          12,
          2024,
        ),
      ).to.be.rejectedWith('Network timeout');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId site-id and auditId test-audit-id: Network timeout',
      );
    });

    it('should throw error when opportunity creation throws exception', async () => {
      // Arrange
      const mockMarkdown = '# Test Report';
      const mockOpportunityInstance = { type: 'test' };
      const createError = new Error('Network timeout');
      const mockContextWithError = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().rejects(createError),
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          { siteId: 'site-id', auditId: 'test-audit-id' },
          mockContextWithError,
          12,
          2024,
        ),
      ).to.be.rejectedWith('Network timeout');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new opportunity for siteId site-id and auditId test-audit-id: Network timeout',
      );
    });

    it('should throw error when suggestion creation fails', async () => {
      // Arrange
      const mockMarkdown = '# Test Report';
      const mockOpportunityInstance = { type: 'test' };
      const mockOpportunityWithSuggestionFailure = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opportunity-123'),
        addSuggestions: sandbox.stub().rejects(new Error('Suggestion creation failed')),
      };
      const mockContextWithSuggestionFailure = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(mockOpportunityWithSuggestionFailure),
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          { siteId: 'site-id', auditId: 'test-audit-id' },
          mockContextWithSuggestionFailure,
          12,
          2024,
        ),
      ).to.be.rejectedWith('Suggestion creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new suggestion for siteId site-id and auditId test-audit-id: Suggestion creation failed',
      );
    });

    it('should throw error when suggestion creation throws exception', async () => {
      // Arrange
      const mockMarkdown = '# Test Report';
      const mockOpportunityInstance = { type: 'test' };
      const suggestionError = new Error('Validation failed');
      const mockOpportunityWithSuggestionError = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('opportunity-123'),
        addSuggestions: sandbox.stub().rejects(suggestionError),
      };
      const mockContextWithSuggestionError = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(mockOpportunityWithSuggestionError),
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act & Assert
      await expect(
        generateIndepthReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          { siteId: 'site-id', auditId: 'test-audit-id' },
          mockContextWithSuggestionError,
          12,
          2024,
        ),
      ).to.be.rejectedWith('Validation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create new suggestion for siteId site-id and auditId test-audit-id: Validation failed',
      );
    });

    it('should handle different domain environments correctly', async () => {
      // Arrange
      const siteId = 'prod-site';
      const orgId = 'prod-org';
      const envAsoDomain = 'production-env';
      const mockMarkdown = '# Production Report';
      const mockOpportunityInstance = { type: 'production' };
      const mockContextForProd = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(mockOpportunity),
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act
      const result = await generateIndepthReportOpportunity(
        siteId,
        mockLog,
        {},
        orgId,
        envAsoDomain,
        { siteId: 'prod-site', auditId: 'prod-audit-id' },
        mockContextForProd,
        52,
        2024,
      );

      // Assert
      expect(result).to.equal(
        'https://production-env.adobe.com/?organizationId=prod-org#/@aem-sites-engineering/sites-optimizer/sites/prod-site/opportunities/opportunity-123',
      );
    });

    it('should handle different week and year parameters', async () => {
      // Arrange
      const mockMarkdown = '# Year-end Report';
      const mockOpportunityInstance = { type: 'year-end' };
      const week = 1;
      const year = 2025;
      const mockContextForYearEnd = {
        log: mockLog,
        dataAccess: {
          Opportunity: {
            create: sandbox.stub().resolves(mockOpportunity),
          },
        },
      };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act
      await generateIndepthReportOpportunity(
        'site-id',
        mockLog,
        {},
        'org-id',
        'experience',
        { siteId: 'site-id', auditId: 'year-end-audit-id' },
        mockContextForYearEnd,
        week,
        year,
      );

      // Assert
      expect(createInDepthReportOpportunityStub).to.have.been.calledOnceWith(week, year);
    });

    it('should handle complex current data with multiple violation types', async () => {
      // Arrange
      const complexCurrent = {
        violations: {
          total: 25,
          critical: {
            count: 10,
            items: {
              rule1: { count: 5, description: 'Critical issue 1' },
              rule2: { count: 5, description: 'Critical issue 2' },
            },
          },
          serious: {
            count: 15,
            items: {
              rule3: { count: 10, description: 'Serious issue 1' },
              rule4: { count: 5, description: 'Serious issue 2' },
            },
          },
        },
        traffic: 5000,
      };
      const mockMarkdown = '# Complex Report\n\n## Critical Issues\n...';
      const mockOpportunityInstance = { type: 'complex' };

      generateInDepthReportMarkdownStub.returns(mockMarkdown);
      createInDepthReportOpportunityStub.returns(mockOpportunityInstance);

      // Act
      const result = await generateIndepthReportOpportunity(
        'complex-site',
        mockLog,
        complexCurrent,
        'complex-org',
        'experience',
        { siteId: 'complex-site', auditId: 'complex-audit' },
        {
          log: mockLog,
          dataAccess: {
            Opportunity: {
              create: sandbox.stub().resolves(mockOpportunity),
            },
          },
        },
        25,
        2024,
      );

      // Assert
      expect(result).to.be.a('string');
      expect(result).to.include('complex-site');
      expect(result).to.include('complex-org');
      expect(generateInDepthReportMarkdownStub).to.have.been.calledOnceWith(complexCurrent);
    });
  });

  describe('generateEnhancedReportOpportunity', () => {
    let generateEnhancedReportOpportunity;
    let generateEnhancedReportMarkdownStub;
    let createEnhancedReportOpportunityStub;
    let createReportOpportunityStub;
    let createReportOpportunitySuggestionStub;
    let mockOpportunity;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock external functions
      generateEnhancedReportMarkdownStub = sandbox.stub();
      createEnhancedReportOpportunityStub = sandbox.stub();
      createReportOpportunityStub = sandbox.stub();
      createReportOpportunitySuggestionStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Mock opportunity object
      mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('enhanced-opportunity-456'),
      };

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          generateEnhancedReportMarkdown: generateEnhancedReportMarkdownStub,
        },
        '../../../src/accessibility/utils/report-oppty.js': {
          createEnhancedReportOpportunity: createEnhancedReportOpportunityStub,
        },
      }, {
        // Mock the internal functions that are defined in the same module
        '../../../src/accessibility/utils/data-processing.js': {
          createReportOpportunity: createReportOpportunityStub,
          createReportOpportunitySuggestion: createReportOpportunitySuggestionStub,
        },
      });

      generateEnhancedReportOpportunity = dataProcessingModule.generateEnhancedReportOpportunity;
    });

    it('should successfully generate enhanced report opportunity', async () => {
      // Arrange
      const siteId = 'enhanced-site-id';
      const orgId = 'enhanced-org-id';
      const envAsoDomain = 'experience';
      const week = 15;
      const year = 2024;
      const mockTop10Markdown = '# Enhanced Accessibility Report\n\n## Top 10 Issues\n...';
      const mockOpportunityInstance = {
        type: 'accessibility-enhanced',
        title: 'Enhanced Accessibility Report',
        description: 'Top 10 accessibility issues analysis',
      };
      const mockAuditData = {
        siteId: 'enhanced-site-id',
        auditId: 'enhanced-audit-id',
      };
      const mockContext = {
        log: mockLog,
        dataAccess: { Opportunity: {} },
      };
      const mockCurrent = {
        violations: {
          total: 25,
          critical: { count: 10 },
          serious: { count: 15 },
        },
      };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'enhanced-suggestion-123' },
      });

      // Act
      const result = await generateEnhancedReportOpportunity(
        siteId,
        mockLog,
        mockCurrent,
        orgId,
        envAsoDomain,
        mockAuditData,
        mockContext,
        week,
        year,
      );

      // Assert
      expect(result).to.equal(
        'https://experience.adobe.com/?organizationId=enhanced-org-id#/@aem-sites-engineering/sites-optimizer/sites/enhanced-site-id/opportunities/enhanced-opportunity-456',
      );

      expect(generateEnhancedReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent);
      expect(createEnhancedReportOpportunityStub).to.have.been.calledOnceWith(week, year);
      expect(createReportOpportunityStub).to.have.been.calledOnceWith(
        mockOpportunityInstance,
        mockAuditData,
        mockContext,
      );
      expect(createReportOpportunitySuggestionStub).to.have.been.calledOnceWith(
        mockOpportunity,
        mockTop10Markdown,
        mockAuditData,
        mockLog,
      );
      expect(mockOpportunity.setStatus).to.have.been.calledOnceWith('IGNORED');
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(mockOpportunity.getId).to.have.been.calledOnce;
    });

    it('should throw error when enhanced markdown generation fails', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 0 } };

      generateEnhancedReportMarkdownStub.returns(null);

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Failed to generate in-depth top 10 markdown');

      expect(generateEnhancedReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent);
      expect(createEnhancedReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when enhanced markdown generation returns empty string', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 5 } };

      generateEnhancedReportMarkdownStub.returns('');

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Failed to generate in-depth top 10 markdown');
    });

    it('should throw error when enhanced opportunity creation fails', async () => {
      // Arrange
      const mockTop10Markdown = '# Enhanced Test Report';
      const mockOpportunityInstance = { type: 'enhanced-test' };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: false,
        message: 'Enhanced database connection failed',
      });

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Enhanced database connection failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create enhancedreport opportunity',
        'Enhanced database connection failed',
      );
    });

    it('should throw error when enhanced opportunity creation throws exception', async () => {
      // Arrange
      const mockTop10Markdown = '# Enhanced Test Report';
      const mockOpportunityInstance = { type: 'enhanced-test' };
      const createError = new Error('Enhanced network timeout');

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.rejects(createError);

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Enhanced network timeout');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create enhancedreport opportunity',
        'Enhanced network timeout',
      );
    });

    it('should throw error when enhanced suggestion creation fails', async () => {
      // Arrange
      const mockTop10Markdown = '# Enhanced Test Report';
      const mockOpportunityInstance = { type: 'enhanced-test' };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: false,
        message: 'Enhanced suggestion creation failed',
      });

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Enhanced suggestion creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create enhanced report opportunity suggestion',
        'Enhanced suggestion creation failed',
      );
    });

    it('should throw error when enhanced suggestion creation throws exception', async () => {
      // Arrange
      const mockTop10Markdown = '# Enhanced Test Report';
      const mockOpportunityInstance = { type: 'enhanced-test' };
      const suggestionError = new Error('Enhanced validation failed');

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.rejects(suggestionError);

      // Act & Assert
      await expect(
        generateEnhancedReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          15,
          2024,
        ),
      ).to.be.rejectedWith('Enhanced validation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create enhanced report opportunity suggestion',
        'Enhanced validation failed',
      );
    });

    it('should handle staging environment domain correctly', async () => {
      // Arrange
      const siteId = 'staging-site';
      const orgId = 'staging-org';
      const envAsoDomain = 'experience-stage';
      const mockTop10Markdown = '# Staging Enhanced Report';
      const mockOpportunityInstance = { type: 'staging-enhanced' };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'staging-suggestion' },
      });

      // Act
      const result = await generateEnhancedReportOpportunity(
        siteId,
        mockLog,
        {},
        orgId,
        envAsoDomain,
        {},
        {},
        20,
        2024,
      );

      // Assert
      expect(result).to.equal(
        'https://experience-stage.adobe.com/?organizationId=staging-org#/@aem-sites-engineering/sites-optimizer/sites/staging-site/opportunities/enhanced-opportunity-456',
      );
    });

    it('should handle different week and year parameters correctly', async () => {
      // Arrange
      const mockTop10Markdown = '# New Year Enhanced Report';
      const mockOpportunityInstance = { type: 'new-year-enhanced' };
      const week = 52;
      const year = 2025;

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'new-year-suggestion' },
      });

      // Act
      await generateEnhancedReportOpportunity(
        'site-id',
        mockLog,
        {},
        'org-id',
        'experience',
        {},
        {},
        week,
        year,
      );

      // Assert
      expect(createEnhancedReportOpportunityStub).to.have.been.calledOnceWith(week, year);
    });

    it('should handle complex current data with top 10 violations analysis', async () => {
      // Arrange
      const complexCurrent = {
        violations: {
          total: 100,
          critical: {
            count: 40,
            items: {
              'color-contrast': { count: 15, description: 'Insufficient color contrast' },
              'missing-alt-text': { count: 12, description: 'Images missing alt text' },
              'keyboard-navigation': { count: 8, description: 'Keyboard navigation issues' },
              'form-labels': { count: 5, description: 'Missing form labels' },
            },
          },
          serious: {
            count: 60,
            items: {
              'heading-structure': { count: 20, description: 'Incorrect heading structure' },
              'link-purpose': { count: 15, description: 'Unclear link purpose' },
              'table-headers': { count: 25, description: 'Missing table headers' },
            },
          },
        },
        traffic: 10000,
        topPages: [
          'https://example.com/',
          'https://example.com/products',
          'https://example.com/about',
        ],
      };
      const mockTop10Markdown = `# Enhanced Accessibility Report

## Top 10 Critical Issues
1. Color contrast issues: 15 violations
2. Missing alt text: 12 violations
...

## Analysis by Traffic
High-traffic pages with most issues...`;
      const mockOpportunityInstance = { type: 'complex-enhanced' };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'complex-suggestion' },
      });

      // Act
      const result = await generateEnhancedReportOpportunity(
        'complex-site',
        mockLog,
        complexCurrent,
        'complex-org',
        'experience',
        { siteId: 'complex-site', auditId: 'complex-audit' },
        { log: mockLog },
        30,
        2024,
      );

      // Assert
      expect(result).to.be.a('string');
      expect(result).to.include('complex-site');
      expect(result).to.include('complex-org');
      expect(generateEnhancedReportMarkdownStub).to.have.been.calledOnceWith(complexCurrent);
      expect(createReportOpportunitySuggestionStub).to.have.been.calledWith(
        mockOpportunity,
        mockTop10Markdown,
        sinon.match.object,
        mockLog,
      );
    });

    it('should handle opportunity with custom properties', async () => {
      // Arrange
      const mockTop10Markdown = '# Custom Enhanced Report';
      const customOpportunityInstance = {
        type: 'accessibility-enhanced-custom',
        title: 'Custom Enhanced Accessibility Report',
        description: 'Customized top 10 issues analysis',
        priority: 'high',
        tags: ['accessibility', 'enhanced', 'top10'],
      };
      const customAuditData = {
        siteId: 'custom-site',
        auditId: 'custom-audit',
        customProperty: 'custom-value',
      };

      generateEnhancedReportMarkdownStub.returns(mockTop10Markdown);
      createEnhancedReportOpportunityStub.returns(customOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'custom-suggestion' },
      });

      // Act
      const result = await generateEnhancedReportOpportunity(
        'custom-site',
        mockLog,
        {},
        'custom-org',
        'experience',
        customAuditData,
        { log: mockLog },
        25,
        2024,
      );

      // Assert
      expect(result).to.include('custom-site');
      expect(createReportOpportunityStub).to.have.been.calledWith(
        customOpportunityInstance,
        customAuditData,
        sinon.match.object,
      );
    });
  });

  describe('generateFixedNewReportOpportunity', () => {
    let generateFixedNewReportOpportunity;
    let generateFixedNewReportMarkdownStub;
    let createFixedVsNewReportOpportunityStub;
    let createReportOpportunityStub;
    let createReportOpportunitySuggestionStub;
    let mockOpportunity;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock external functions
      generateFixedNewReportMarkdownStub = sandbox.stub();
      createFixedVsNewReportOpportunityStub = sandbox.stub();
      createReportOpportunityStub = sandbox.stub();
      createReportOpportunitySuggestionStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Mock opportunity object
      mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('fixed-new-opportunity-789'),
      };

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          generateFixedNewReportMarkdown: generateFixedNewReportMarkdownStub,
        },
        '../../../src/accessibility/utils/report-oppty.js': {
          createFixedVsNewReportOpportunity: createFixedVsNewReportOpportunityStub,
        },
      }, {
        // Mock the internal functions that are defined in the same module
        '../../../src/accessibility/utils/data-processing.js': {
          createReportOpportunity: createReportOpportunityStub,
          createReportOpportunitySuggestion: createReportOpportunitySuggestionStub,
        },
      });

      generateFixedNewReportOpportunity = dataProcessingModule.generateFixedNewReportOpportunity;
    });

    it('should successfully generate fixed vs new report opportunity', async () => {
      // Arrange
      const siteId = 'fixed-new-site-id';
      const orgId = 'fixed-new-org-id';
      const envAsoDomain = 'experience';
      const week = 20;
      const year = 2024;
      const mockFixedVsNewMarkdown = '# Fixed vs New Issues Report\n\n## Fixed Issues\n...\n\n## New Issues\n...';
      const mockOpportunityInstance = {
        type: 'accessibility-fixed-new',
        title: 'Fixed vs New Accessibility Issues',
        description: 'Analysis of fixed and new accessibility issues',
      };
      const mockAuditData = {
        siteId: 'fixed-new-site-id',
        auditId: 'fixed-new-audit-id',
      };
      const mockContext = {
        log: mockLog,
        dataAccess: { Opportunity: {} },
      };
      const mockCurrent = {
        violations: {
          total: 15,
          critical: { count: 5 },
          serious: { count: 10 },
        },
      };
      const mockLastWeek = {
        violations: {
          total: 20,
          critical: { count: 8 },
          serious: { count: 12 },
        },
      };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'fixed-new-suggestion-123' },
      });

      // Act
      const result = await generateFixedNewReportOpportunity(
        siteId,
        mockLog,
        mockCurrent,
        orgId,
        envAsoDomain,
        mockAuditData,
        mockContext,
        week,
        year,
        mockLastWeek,
      );

      // Assert
      expect(result).to.equal(
        'https://experience.adobe.com/?organizationId=fixed-new-org-id#/@aem-sites-engineering/sites-optimizer/sites/fixed-new-site-id/opportunities/fixed-new-opportunity-789',
      );

      // eslint-disable-next-line max-len
      expect(generateFixedNewReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent, mockLastWeek);
      expect(createFixedVsNewReportOpportunityStub).to.have.been.calledOnceWith(week, year);
      expect(createReportOpportunityStub).to.have.been.calledOnceWith(
        mockOpportunityInstance,
        mockAuditData,
        mockContext,
      );
      expect(createReportOpportunitySuggestionStub).to.have.been.calledOnceWith(
        mockOpportunity,
        mockFixedVsNewMarkdown,
        mockAuditData,
        mockLog,
      );
      expect(mockOpportunity.setStatus).to.have.been.calledOnceWith('IGNORED');
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(mockOpportunity.getId).to.have.been.calledOnce;
    });

    it('should throw error when fixed vs new markdown generation fails', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 5 } };
      const mockLastWeek = { violations: { total: 10 } };

      generateFixedNewReportMarkdownStub.returns(null);

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          mockLastWeek,
        ),
      ).to.be.rejectedWith('Failed to generate fixed vs new markdown');

      // eslint-disable-next-line max-len
      expect(generateFixedNewReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent, mockLastWeek);
      expect(createFixedVsNewReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when fixed vs new markdown generation returns empty string', async () => {
      // Arrange
      const siteId = 'test-site-id';
      const mockCurrent = { violations: { total: 3 } };
      const mockLastWeek = { violations: { total: 8 } };

      generateFixedNewReportMarkdownStub.returns('');

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          siteId,
          mockLog,
          mockCurrent,
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          mockLastWeek,
        ),
      ).to.be.rejectedWith('Failed to generate fixed vs new markdown');
    });

    it('should throw error when fixed vs new opportunity creation fails', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# Fixed vs New Test Report';
      const mockOpportunityInstance = { type: 'fixed-new-test' };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: false,
        message: 'Fixed vs new database connection failed',
      });

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          {},
        ),
      ).to.be.rejectedWith('Fixed vs new database connection failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create fixed vs new report opportunity',
        'Fixed vs new database connection failed',
      );
    });

    it('should throw error when fixed vs new opportunity creation throws exception', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# Fixed vs New Test Report';
      const mockOpportunityInstance = { type: 'fixed-new-test' };
      const createError = new Error('Fixed vs new network timeout');

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.rejects(createError);

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          {},
        ),
      ).to.be.rejectedWith('Fixed vs new network timeout');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create fixed vs new report opportunity',
        'Fixed vs new network timeout',
      );
    });

    it('should throw error when fixed vs new suggestion creation fails', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# Fixed vs New Test Report';
      const mockOpportunityInstance = { type: 'fixed-new-test' };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: false,
        message: 'Fixed vs new suggestion creation failed',
      });

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          {},
        ),
      ).to.be.rejectedWith('Fixed vs new suggestion creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create fixed vs new report opportunity suggestion',
        'Fixed vs new suggestion creation failed',
      );
    });

    it('should throw error when fixed vs new suggestion creation throws exception', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# Fixed vs New Test Report';
      const mockOpportunityInstance = { type: 'fixed-new-test' };
      const suggestionError = new Error('Fixed vs new validation failed');

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.rejects(suggestionError);

      // Act & Assert
      await expect(
        generateFixedNewReportOpportunity(
          'site-id',
          mockLog,
          {},
          'org-id',
          'experience',
          {},
          {},
          20,
          2024,
          {},
        ),
      ).to.be.rejectedWith('Fixed vs new validation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create fixed vs new report opportunity suggestion',
        'Fixed vs new validation failed',
      );
    });

    it('should handle null lastWeek data', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# No Previous Data Report';
      const mockOpportunityInstance = { type: 'no-previous-data' };
      const mockCurrent = { violations: { total: 10 } };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'no-previous-suggestion' },
      });

      // Act
      const result = await generateFixedNewReportOpportunity(
        'site-id',
        mockLog,
        mockCurrent,
        'org-id',
        'experience',
        {},
        {},
        20,
        2024,
        null,
      );

      // Assert
      expect(result).to.be.a('string');
      expect(generateFixedNewReportMarkdownStub).to.have.been.calledOnceWith(mockCurrent, null);
    });

    it('should handle complex current and lastWeek data comparison', async () => {
      // Arrange
      const complexCurrent = {
        violations: {
          total: 50,
          critical: {
            count: 20,
            items: {
              'color-contrast': { count: 8, description: 'Color contrast issues' },
              'missing-alt-text': { count: 7, description: 'Missing alt text' },
              'keyboard-navigation': { count: 5, description: 'Keyboard issues' },
            },
          },
          serious: {
            count: 30,
            items: {
              'heading-structure': { count: 15, description: 'Heading issues' },
              'link-purpose': { count: 10, description: 'Link issues' },
              'form-labels': { count: 5, description: 'Form issues' },
            },
          },
        },
        traffic: 8000,
        'https://example.com/': { violations: { total: 15 }, traffic: 3000 },
        'https://example.com/products': { violations: { total: 20 }, traffic: 2500 },
        'https://example.com/about': { violations: { total: 15 }, traffic: 2500 },
      };

      const complexLastWeek = {
        violations: {
          total: 60,
          critical: {
            count: 25,
            items: {
              'color-contrast': { count: 10, description: 'Color contrast issues' },
              'missing-alt-text': { count: 8, description: 'Missing alt text' },
              'keyboard-navigation': { count: 7, description: 'Keyboard issues' },
            },
          },
          serious: {
            count: 35,
            items: {
              'heading-structure': { count: 20, description: 'Heading issues' },
              'link-purpose': { count: 10, description: 'Link issues' },
              'form-labels': { count: 5, description: 'Form issues' },
            },
          },
        },
        traffic: 7500,
        'https://example.com/': { violations: { total: 20 }, traffic: 2800 },
        'https://example.com/products': { violations: { total: 25 }, traffic: 2400 },
        'https://example.com/about': { violations: { total: 15 }, traffic: 2300 },
      };

      const mockFixedVsNewMarkdown = `# Fixed vs New Issues Analysis

## Summary
- Total violations decreased from 60 to 50 (-16.7%)
- Critical issues decreased from 25 to 20 (-20%)
- Serious issues decreased from 35 to 30 (-14.3%)

## Fixed Issues
1. Color contrast: 2 issues fixed
2. Keyboard navigation: 2 issues fixed

## New Issues
1. No new critical issues detected
2. Minor increases in some categories

## Page-by-Page Analysis
...`;

      const mockOpportunityInstance = { type: 'complex-comparison' };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'complex-suggestion' },
      });

      // Act
      const result = await generateFixedNewReportOpportunity(
        'complex-site',
        mockLog,
        complexCurrent,
        'complex-org',
        'experience',
        { siteId: 'complex-site', auditId: 'complex-audit' },
        { log: mockLog },
        25,
        2024,
        complexLastWeek,
      );

      // Assert
      expect(result).to.be.a('string');
      expect(result).to.include('complex-site');
      expect(result).to.include('complex-org');
      expect(generateFixedNewReportMarkdownStub).to.have.been.calledOnceWith(
        complexCurrent,
        complexLastWeek,
      );
      expect(createReportOpportunitySuggestionStub).to.have.been.calledWith(
        mockOpportunity,
        mockFixedVsNewMarkdown,
        sinon.match.object,
        mockLog,
      );
    });

    it('should handle staging environment correctly', async () => {
      // Arrange
      const siteId = 'staging-site';
      const orgId = 'staging-org';
      const envAsoDomain = 'experience-stage';
      const mockFixedVsNewMarkdown = '# Staging Fixed vs New Report';
      const mockOpportunityInstance = { type: 'staging-fixed-new' };

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'staging-suggestion' },
      });

      // Act
      const result = await generateFixedNewReportOpportunity(
        siteId,
        mockLog,
        {},
        orgId,
        envAsoDomain,
        {},
        {},
        30,
        2024,
        {},
      );

      // Assert
      expect(result).to.equal(
        'https://experience-stage.adobe.com/?organizationId=staging-org#/@aem-sites-engineering/sites-optimizer/sites/staging-site/opportunities/fixed-new-opportunity-789',
      );
    });

    it('should handle different week and year parameters correctly', async () => {
      // Arrange
      const mockFixedVsNewMarkdown = '# Year-end Fixed vs New Report';
      const mockOpportunityInstance = { type: 'year-end-fixed-new' };
      const week = 1;
      const year = 2025;

      generateFixedNewReportMarkdownStub.returns(mockFixedVsNewMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'year-end-suggestion' },
      });

      // Act
      await generateFixedNewReportOpportunity(
        'site-id',
        mockLog,
        {},
        'org-id',
        'experience',
        {},
        {},
        week,
        year,
        {},
      );

      // Assert
      expect(createFixedVsNewReportOpportunityStub).to.have.been.calledOnceWith(week, year);
    });

    it('should handle improvement scenario where violations decreased', async () => {
      // Arrange
      const improvedCurrent = {
        violations: { total: 10, critical: { count: 2 }, serious: { count: 8 } },
      };
      const previousLastWeek = {
        violations: { total: 25, critical: { count: 8 }, serious: { count: 17 } },
      };
      const improvementMarkdown = `# Significant Improvement Detected!

## Great Progress!
- Total violations decreased by 60% (25 → 10)
- Critical issues down by 75% (8 → 2)
- Serious issues down by 53% (17 → 8)

## Keep up the excellent work!`;

      const mockOpportunityInstance = { type: 'improvement-report' };

      generateFixedNewReportMarkdownStub.returns(improvementMarkdown);
      createFixedVsNewReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'improvement-suggestion' },
      });

      // Act
      const result = await generateFixedNewReportOpportunity(
        'improved-site',
        mockLog,
        improvedCurrent,
        'improved-org',
        'experience',
        { siteId: 'improved-site', auditId: 'improved-audit' },
        { log: mockLog },
        35,
        2024,
        previousLastWeek,
      );

      // Assert
      expect(result).to.include('improved-site');
      expect(generateFixedNewReportMarkdownStub).to.have.been.calledWith(
        improvedCurrent,
        previousLastWeek,
      );
    });
  });

  describe('generateBaseReportOpportunity', () => {
    let generateBaseReportOpportunity;
    let generateBaseReportMarkdownStub;
    let createBaseReportOpportunityStub;
    let createReportOpportunityStub;
    let createReportOpportunitySuggestionStub;
    let mockOpportunity;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock external functions
      generateBaseReportMarkdownStub = sandbox.stub();
      createBaseReportOpportunityStub = sandbox.stub();
      createReportOpportunityStub = sandbox.stub();
      createReportOpportunitySuggestionStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Mock opportunity object
      mockOpportunity = {
        setStatus: sandbox.stub().resolves(),
        save: sandbox.stub().resolves(),
        getId: sandbox.stub().returns('base-opportunity-999'),
      };

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          generateBaseReportMarkdown: generateBaseReportMarkdownStub,
        },
        '../../../src/accessibility/utils/report-oppty.js': {
          createBaseReportOpportunity: createBaseReportOpportunityStub,
        },
      }, {
        // Mock the internal functions that are defined in the same module
        '../../../src/accessibility/utils/data-processing.js': {
          createReportOpportunity: createReportOpportunityStub,
          createReportOpportunitySuggestion: createReportOpportunitySuggestionStub,
        },
      });

      generateBaseReportOpportunity = dataProcessingModule.generateBaseReportOpportunity;
    });

    it('should successfully generate base report opportunity', async () => {
      // Arrange
      const week = 25;
      const year = 2024;
      const mockBaseMarkdown = '# Base Accessibility Report\n\n## Summary\n...\n\n## Related Reports\n...';
      const mockOpportunityInstance = {
        type: 'accessibility-base',
        title: 'Base Accessibility Report',
        description: 'Comprehensive accessibility report with related insights',
      };
      const mockAuditData = {
        siteId: 'base-site-id',
        auditId: 'base-audit-id',
      };
      const mockContext = {
        log: mockLog,
        dataAccess: { Opportunity: {} },
      };
      const mockCurrent = {
        violations: {
          total: 30,
          critical: { count: 12 },
          serious: { count: 18 },
        },
      };
      const mockLastWeek = {
        violations: {
          total: 35,
          critical: { count: 15 },
          serious: { count: 20 },
        },
      };
      const mockRelatedReportsUrls = {
        inDepthReportUrl: 'https://experience.adobe.com/indepth-report',
        enhancedReportUrl: 'https://experience.adobe.com/enhanced-report',
        fixedVsNewReportUrl: 'https://experience.adobe.com/fixed-new-report',
      };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'base-suggestion-123' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        mockCurrent,
        mockAuditData,
        mockContext,
        week,
        year,
        mockRelatedReportsUrls,
        mockLastWeek,
      );

      // Assert
      expect(generateBaseReportMarkdownStub).to.have.been.calledOnceWith(
        mockCurrent,
        mockLastWeek,
        mockRelatedReportsUrls,
      );
      expect(createBaseReportOpportunityStub).to.have.been.calledOnceWith(week, year);
      expect(createReportOpportunityStub).to.have.been.calledOnceWith(
        mockOpportunityInstance,
        mockAuditData,
        mockContext,
      );
      expect(createReportOpportunitySuggestionStub).to.have.been.calledOnceWith(
        mockOpportunity,
        mockBaseMarkdown,
        mockAuditData,
        mockLog,
      );
    });

    it('should throw error when base markdown generation fails', async () => {
      // Arrange
      const mockCurrent = { violations: { total: 10 } };
      const mockLastWeek = { violations: { total: 15 } };
      const mockRelatedReportsUrls = {
        inDepthReportUrl: 'https://example.com/indepth',
        enhancedReportUrl: 'https://example.com/enhanced',
        fixedVsNewReportUrl: 'https://example.com/fixed-new',
      };

      generateBaseReportMarkdownStub.returns(null);

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          mockCurrent,
          {},
          {},
          25,
          2024,
          mockRelatedReportsUrls,
          mockLastWeek,
        ),
      ).to.be.rejectedWith('Failed to generate base report markdown');

      expect(generateBaseReportMarkdownStub).to.have.been.calledOnceWith(
        mockCurrent,
        mockLastWeek,
        mockRelatedReportsUrls,
      );
      expect(createBaseReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when base markdown generation returns empty string', async () => {
      // Arrange
      const mockCurrent = { violations: { total: 5 } };
      const mockLastWeek = { violations: { total: 8 } };
      const mockRelatedReportsUrls = { inDepthReportUrl: '', enhancedReportUrl: '', fixedVsNewReportUrl: '' };

      generateBaseReportMarkdownStub.returns('');

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          mockCurrent,
          {},
          {},
          25,
          2024,
          mockRelatedReportsUrls,
          mockLastWeek,
        ),
      ).to.be.rejectedWith('Failed to generate base report markdown');
    });

    it('should throw error when base opportunity creation fails', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Test Report';
      const mockOpportunityInstance = { type: 'base-test' };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: false,
        message: 'Base database connection failed',
      });

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          {},
          {},
          {},
          25,
          2024,
          {},
          {},
        ),
      ).to.be.rejectedWith('Base database connection failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create base report opportunity',
        'Base database connection failed',
      );
    });

    it('should throw error when base opportunity creation throws exception', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Test Report';
      const mockOpportunityInstance = { type: 'base-test' };
      const createError = new Error('Base network timeout');

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.rejects(createError);

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          {},
          {},
          {},
          25,
          2024,
          {},
          {},
        ),
      ).to.be.rejectedWith('Base network timeout');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create base report opportunity',
        'Base network timeout',
      );
    });

    it('should throw error when base suggestion creation fails', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Test Report';
      const mockOpportunityInstance = { type: 'base-test' };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: false,
        message: 'Base suggestion creation failed',
      });

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          {},
          {},
          {},
          25,
          2024,
          {},
          {},
        ),
      ).to.be.rejectedWith('Base suggestion creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create base report opportunity suggestion',
        'Base suggestion creation failed',
      );
    });

    it('should throw error when base suggestion creation throws exception', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Test Report';
      const mockOpportunityInstance = { type: 'base-test' };
      const suggestionError = new Error('Base validation failed');

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.rejects(suggestionError);

      // Act & Assert
      await expect(
        generateBaseReportOpportunity(
          mockLog,
          {},
          {},
          {},
          25,
          2024,
          {},
          {},
        ),
      ).to.be.rejectedWith('Base validation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to create base report opportunity suggestion',
        'Base validation failed',
      );
    });

    it('should handle null lastWeek data correctly', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Report Without Previous Data';
      const mockOpportunityInstance = { type: 'base-no-previous' };
      const mockCurrent = { violations: { total: 20 } };
      const mockRelatedReportsUrls = {
        inDepthReportUrl: 'https://experience.adobe.com/indepth',
        enhancedReportUrl: 'https://experience.adobe.com/enhanced',
        fixedVsNewReportUrl: 'https://experience.adobe.com/fixed-new',
      };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'base-no-previous-suggestion' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        mockCurrent,
        {},
        {},
        25,
        2024,
        mockRelatedReportsUrls,
        null,
      );

      // Assert
      expect(generateBaseReportMarkdownStub).to.have.been.calledOnceWith(
        mockCurrent,
        null,
        mockRelatedReportsUrls,
      );
    });

    it('should handle different week and year parameters correctly', async () => {
      // Arrange
      const mockBaseMarkdown = '# Year-end Base Report';
      const mockOpportunityInstance = { type: 'year-end-base' };
      const week = 52;
      const year = 2025;

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'year-end-base-suggestion' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        {},
        {},
        {},
        week,
        year,
        {},
        {},
      );

      // Assert
      expect(createBaseReportOpportunityStub).to.have.been.calledOnceWith(week, year);
    });

    it('should handle complex current and lastWeek data with comprehensive related reports', async () => {
      // Arrange
      const complexCurrent = {
        violations: {
          total: 75,
          critical: {
            count: 30,
            items: {
              'color-contrast': { count: 12, description: 'Color contrast issues' },
              'missing-alt-text': { count: 10, description: 'Missing alt text' },
              'keyboard-navigation': { count: 8, description: 'Keyboard issues' },
            },
          },
          serious: {
            count: 45,
            items: {
              'heading-structure': { count: 20, description: 'Heading issues' },
              'link-purpose': { count: 15, description: 'Link issues' },
              'form-labels': { count: 10, description: 'Form issues' },
            },
          },
        },
        traffic: 12000,
        metadata: {
          timestamp: '2024-03-20',
          totalPages: 150,
        },
      };

      const complexLastWeek = {
        violations: {
          total: 80,
          critical: {
            count: 35,
            items: {
              'color-contrast': { count: 15, description: 'Color contrast issues' },
              'missing-alt-text': { count: 12, description: 'Missing alt text' },
              'keyboard-navigation': { count: 8, description: 'Keyboard issues' },
            },
          },
          serious: {
            count: 45,
            items: {
              'heading-structure': { count: 25, description: 'Heading issues' },
              'link-purpose': { count: 12, description: 'Link issues' },
              'form-labels': { count: 8, description: 'Form issues' },
            },
          },
        },
        traffic: 11500,
        metadata: {
          timestamp: '2024-03-13',
          totalPages: 148,
        },
      };

      const comprehensiveRelatedReportsUrls = {
        inDepthReportUrl: 'https://experience.adobe.com/org123#/sites/complex-site/opportunities/indepth-456',
        enhancedReportUrl: 'https://experience.adobe.com/org123#/sites/complex-site/opportunities/enhanced-789',
        fixedVsNewReportUrl: 'https://experience.adobe.com/org123#/sites/complex-site/opportunities/fixed-new-012',
      };

      const mockBaseMarkdown = `# Comprehensive Accessibility Base Report

## Executive Summary
Total violations decreased from 80 to 75 (-6.25%)
Critical issues improved from 35 to 30 (-14.29%)

## Detailed Analysis
For comprehensive analysis, please refer to our detailed reports:
- [In-depth Analysis](${comprehensiveRelatedReportsUrls.inDepthReportUrl})
- [Top 10 Issues Report](${comprehensiveRelatedReportsUrls.enhancedReportUrl})
- [Fixed vs New Issues](${comprehensiveRelatedReportsUrls.fixedVsNewReportUrl})

## Key Improvements
1. Color contrast violations reduced by 3
2. Missing alt text violations reduced by 2
...`;

      const mockOpportunityInstance = { type: 'complex-base' };
      const mockAuditData = { siteId: 'complex-site', auditId: 'complex-audit' };
      const mockContext = { log: mockLog };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'complex-base-suggestion' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        complexCurrent,
        mockAuditData,
        mockContext,
        30,
        2024,
        comprehensiveRelatedReportsUrls,
        complexLastWeek,
      );

      // Assert
      expect(generateBaseReportMarkdownStub).to.have.been.calledWith(
        complexCurrent,
        complexLastWeek,
        comprehensiveRelatedReportsUrls,
      );
      expect(createReportOpportunityStub).to.have.been.calledWith(
        mockOpportunityInstance,
        mockAuditData,
        mockContext,
      );
      expect(createReportOpportunitySuggestionStub).to.have.been.calledWith(
        mockOpportunity,
        mockBaseMarkdown,
        mockAuditData,
        mockLog,
      );
    });

    it('should handle empty related reports URLs', async () => {
      // Arrange
      const mockBaseMarkdown = '# Base Report With No Related Reports';
      const mockOpportunityInstance = { type: 'base-standalone' };
      const emptyRelatedReportsUrls = {
        inDepthReportUrl: '',
        enhancedReportUrl: '',
        fixedVsNewReportUrl: '',
      };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(mockOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'standalone-suggestion' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        {},
        {},
        {},
        25,
        2024,
        emptyRelatedReportsUrls,
        {},
      );

      // Assert
      expect(generateBaseReportMarkdownStub).to.have.been.calledWith(
        {},
        {},
        emptyRelatedReportsUrls,
      );
    });

    it('should handle opportunity instance with custom properties', async () => {
      // Arrange
      const mockBaseMarkdown = '# Custom Base Report';
      const customOpportunityInstance = {
        type: 'accessibility-base-custom',
        title: 'Custom Base Accessibility Report',
        description: 'Customized base report with specific requirements',
        priority: 'high',
        tags: ['accessibility', 'base', 'comprehensive'],
        customMetadata: {
          reportVersion: '2.0',
          includeCompliance: true,
        },
      };
      const customAuditData = {
        siteId: 'custom-base-site',
        auditId: 'custom-base-audit',
        customProperty: 'custom-value',
      };

      generateBaseReportMarkdownStub.returns(mockBaseMarkdown);
      createBaseReportOpportunityStub.returns(customOpportunityInstance);
      createReportOpportunityStub.resolves({
        status: true,
        opportunity: mockOpportunity,
      });
      createReportOpportunitySuggestionStub.resolves({
        status: true,
        suggestion: { id: 'custom-base-suggestion' },
      });

      // Act
      await generateBaseReportOpportunity(
        mockLog,
        {},
        customAuditData,
        { log: mockLog },
        40,
        2024,
        {},
        {},
      );

      // Assert
      expect(createReportOpportunityStub).to.have.been.calledWith(
        customOpportunityInstance,
        customAuditData,
        sinon.match.object,
      );
    });
  });

  describe('generateReportOpportunities', () => {
    let generateReportOpportunities;
    let generateIndepthReportOpportunityStub;
    let generateEnhancedReportOpportunityStub;
    let generateFixedNewReportOpportunityStub;
    let generateBaseReportOpportunityStub;
    let getWeekNumberStub;
    let mockSite;
    let getObjectFromKeyStub;
    let getObjectKeysUsingPrefixStub;

    beforeEach(async () => {
      // Mock external functions
      generateIndepthReportOpportunityStub = sandbox.stub();
      generateEnhancedReportOpportunityStub = sandbox.stub();
      generateFixedNewReportOpportunityStub = sandbox.stub();
      generateBaseReportOpportunityStub = sandbox.stub();
      getWeekNumberStub = sandbox.stub();
      getObjectFromKeyStub = sandbox.stub();
      getObjectKeysUsingPrefixStub = sandbox.stub();

      // Mock site object
      mockSite = {
        getId: sandbox.stub().returns('test-site-id'),
        getLatestAuditByAuditType: sandbox.stub(),
        getOrganizationId: sandbox.stub().returns('test-org-id'),
      };

      // Import the function with mocked dependencies
      const dataProcessingModule = await esmock('../../../src/accessibility/utils/data-processing.js', {
        '@aws-sdk/client-s3': {
          DeleteObjectsCommand: DeleteObjectsCommandStub,
          DeleteObjectCommand: DeleteObjectCommandStub,
          ListObjectsV2Command: ListObjectsV2CommandStub,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
          getObjectKeysUsingPrefix: getObjectKeysUsingPrefixStub,
        },
        '../../../src/accessibility/utils/generate-md-reports.js': {
          getWeekNumber: getWeekNumberStub,
        },
      }, {
        // Mock the internal functions that are defined in the same module
        '../../../src/accessibility/utils/data-processing.js': {
          generateIndepthReportOpportunity: generateIndepthReportOpportunityStub,
          generateEnhancedReportOpportunity: generateEnhancedReportOpportunityStub,
          generateFixedNewReportOpportunity: generateFixedNewReportOpportunityStub,
          generateBaseReportOpportunity: generateBaseReportOpportunityStub,
        },
      });

      generateReportOpportunities = dataProcessingModule.generateReportOpportunities;
    });

    it('should successfully generate all report opportunities in production environment', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: {
            violations: {
              total: 25,
              critical: { count: 10 },
              serious: { count: 15 },
            },
          },
          lastWeek: {
            violations: {
              total: 30,
              critical: { count: 12 },
              serious: { count: 18 },
            },
          },
        },
      };
      const mockLatestAudit = {
        siteId: 'test-site-id',
        auditId: 'test-audit-id',
        type: 'accessibility',
        createdAt: '2024-03-20T10:00:00Z',
      };
      const mockContext = {
        log: mockLog,
        dataAccess: { Opportunity: {} },
      };
      const isProd = true;
      const currentWeek = 12;
      const currentYear = 2024;

      // Mock return values
      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(currentWeek);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth-url');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced-url');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/fixed-new-url');
      generateBaseReportOpportunityStub.resolves();

      // Act
      const result = await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        isProd,
        mockContext,
      );

      // Assert
      expect(result).to.deep.equal({
        status: true,
        message: 'All report opportunities created successfully',
      });

      expect(mockSite.getId).to.have.been.calledOnce;
      expect(mockSite.getLatestAuditByAuditType).to.have.been.calledOnceWith('accessibility');
      expect(mockSite.getOrganizationId).to.have.been.calledOnce;

      expect(generateIndepthReportOpportunityStub).to.have.been.calledOnceWith(
        'test-site-id',
        mockLog,
        mockAggregationResult.finalResultFiles.current,
        'test-org-id',
        'experience',
        mockLatestAudit,
        mockContext,
        currentWeek,
        currentYear,
      );

      expect(generateEnhancedReportOpportunityStub).to.have.been.calledOnceWith(
        'test-site-id',
        mockLog,
        mockAggregationResult.finalResultFiles.current,
        'test-org-id',
        'experience',
        mockLatestAudit,
        mockContext,
        currentWeek,
        currentYear,
      );

      expect(generateFixedNewReportOpportunityStub).to.have.been.calledOnceWith(
        'test-site-id',
        mockLog,
        mockAggregationResult.finalResultFiles.current,
        'test-org-id',
        'experience',
        mockLatestAudit,
        mockContext,
        currentWeek,
        currentYear,
        mockAggregationResult.finalResultFiles.lastWeek,
      );

      expect(generateBaseReportOpportunityStub).to.have.been.calledOnceWith(
        mockLog,
        mockAggregationResult.finalResultFiles.current,
        mockLatestAudit,
        mockContext,
        currentWeek,
        currentYear,
        {
          inDepthReportUrl: 'https://experience.adobe.com/indepth-url',
          enhancedReportUrl: 'https://experience.adobe.com/enhanced-url',
          fixedVsNewReportUrl: 'https://experience.adobe.com/fixed-new-url',
        },
        mockAggregationResult.finalResultFiles.lastWeek,
      );
    });

    it('should successfully generate all report opportunities in staging environment', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 10 } },
          lastWeek: { violations: { total: 15 } },
        },
      };
      const mockLatestAudit = { siteId: 'staging-site', auditId: 'staging-audit' };
      const mockContext = { log: mockLog };
      const isProd = false;

      mockSite.getId.returns('staging-site');
      mockSite.getOrganizationId.returns('staging-org');
      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(15);
      generateIndepthReportOpportunityStub.resolves('https://experience-stage.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience-stage.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience-stage.adobe.com/fixed-new');
      generateBaseReportOpportunityStub.resolves();

      // Act
      const result = await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        isProd,
        mockContext,
      );

      // Assert
      expect(result.status).to.be.true;
      expect(generateIndepthReportOpportunityStub).to.have.been.calledWith(
        'staging-site',
        mockLog,
        sinon.match.any,
        'staging-org',
        'experience-stage', // Staging environment
        sinon.match.any,
        mockContext,
        15,
        sinon.match.any,
      );
    });

    it('should throw error when in-depth report generation fails', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 8 } },
        },
      };
      const mockLatestAudit = { siteId: 'test-site', auditId: 'test-audit' };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(20);
      generateIndepthReportOpportunityStub.rejects(new Error('In-depth generation failed'));

      // Act & Assert
      await expect(
        generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        ),
      ).to.be.rejectedWith('In-depth generation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to generate in-depth report opportunity',
        'In-depth generation failed',
      );
      expect(generateEnhancedReportOpportunityStub).to.not.have.been.called;
      expect(generateFixedNewReportOpportunityStub).to.not.have.been.called;
      expect(generateBaseReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when enhanced report generation fails', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 8 } },
        },
      };
      const mockLatestAudit = { siteId: 'test-site', auditId: 'test-audit' };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(20);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.rejects(new Error('Enhanced generation failed'));

      // Act & Assert
      await expect(
        generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        ),
      ).to.be.rejectedWith('Enhanced generation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to generate enhanced report opportunity',
        'Enhanced generation failed',
      );
      expect(generateFixedNewReportOpportunityStub).to.not.have.been.called;
      expect(generateBaseReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when fixed vs new report generation fails', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 8 } },
        },
      };
      const mockLatestAudit = { siteId: 'test-site', auditId: 'test-audit' };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(20);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.rejects(new Error('Fixed vs new generation failed'));

      // Act & Assert
      await expect(
        generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        ),
      ).to.be.rejectedWith('Fixed vs new generation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to generate fixed vs new report opportunity',
        'Fixed vs new generation failed',
      );
      expect(generateBaseReportOpportunityStub).to.not.have.been.called;
    });

    it('should throw error when base report generation fails', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 8 } },
        },
      };
      const mockLatestAudit = { siteId: 'test-site', auditId: 'test-audit' };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(20);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/fixed-new');
      generateBaseReportOpportunityStub.rejects(new Error('Base generation failed'));

      // Act & Assert
      await expect(
        generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        ),
      ).to.be.rejectedWith('Base generation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to generate base report opportunity',
        'Base generation failed',
      );
    });

    it('should handle null lastWeek data correctly', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 10 } },
          lastWeek: null, // No previous week data
        },
      };
      const mockLatestAudit = { siteId: 'test-site', auditId: 'test-audit' };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(25);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/fixed-new');
      generateBaseReportOpportunityStub.resolves();

      // Act
      const result = await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        true,
        {},
      );

      // Assert
      expect(result.status).to.be.true;
      expect(generateFixedNewReportOpportunityStub).to.have.been.calledWith(
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        null, // lastWeek parameter should be null
      );
      expect(generateBaseReportOpportunityStub).to.have.been.calledWith(
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        null, // lastWeek parameter should be null
      );
    });

    it('should properly serialize audit data', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 15 } },
          lastWeek: { violations: { total: 20 } },
        },
      };
      const mockLatestAudit = {
        siteId: 'serialize-test-site',
        auditId: 'serialize-test-audit',
        createdAt: new Date('2024-03-20T10:00:00Z'),
        // Complex object that needs serialization
        metadata: {
          nested: {
            property: 'value',
          },
        },
      };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(30);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/fixed-new');
      generateBaseReportOpportunityStub.resolves();

      // Act
      await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        true,
        {},
      );

      // Assert - Check that audit data was properly serialized
      expect(generateIndepthReportOpportunityStub).to.have.been.calledWith(
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
        sinon.match((auditData) => auditData.siteId === 'serialize-test-site'
            && auditData.auditId === 'serialize-test-audit'
            && typeof auditData.createdAt === 'string' // Date should be serialized to string
            && auditData.metadata.nested.property === 'value'),
        sinon.match.any,
        sinon.match.any,
        sinon.match.any,
      );
    });

    it('should handle different week numbers and years correctly', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 3 } },
        },
      };
      const mockLatestAudit = { siteId: 'week-test-site', auditId: 'week-test-audit' };
      const customWeek = 52;
      const customYear = 2025;

      // Mock Date to return specific year
      const OriginalDate = global.Date;
      // eslint-disable-next-line func-names
      global.Date = class MockDate extends OriginalDate {
        constructor(...args) {
          if (args.length === 0) {
            super(customYear, 0, 1); // January 1st of custom year
          } else {
            super(...args);
          }
        }

        // eslint-disable-next-line class-methods-use-this
        getFullYear() {
          return customYear;
        }

        static now() {
          return new OriginalDate(customYear, 0, 1).getTime();
        }
      };

      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(customWeek);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/fixed-new');
      generateBaseReportOpportunityStub.resolves();

      try {
        // Act
        await generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        );

        // Assert
        expect(generateIndepthReportOpportunityStub).to.have.been.calledWith(
          sinon.match.any,
          sinon.match.any,
          sinon.match.any,
          sinon.match.any,
          sinon.match.any,
          sinon.match.any,
          sinon.match.any,
          customWeek,
          customYear,
        );
      } finally {
        // Restore original Date
        global.Date = OriginalDate;
      }
    });

    it('should handle complex aggregation result data', async () => {
      // Arrange
      const complexAggregationResult = {
        finalResultFiles: {
          current: {
            violations: {
              total: 50,
              critical: {
                count: 20,
                items: {
                  'color-contrast': { count: 8, description: 'Color contrast issues' },
                  'missing-alt-text': { count: 7, description: 'Missing alt text' },
                  'keyboard-nav': { count: 5, description: 'Keyboard navigation' },
                },
              },
              serious: {
                count: 30,
                items: {
                  'heading-structure': { count: 15, description: 'Heading issues' },
                  'link-purpose': { count: 10, description: 'Link issues' },
                  'form-labels': { count: 5, description: 'Form label issues' },
                },
              },
            },
            traffic: 15000,
            metadata: {
              timestamp: '2024-03-20T10:00:00Z',
              totalPages: 200,
            },
            'https://example.com/': { violations: { total: 15 }, traffic: 5000 },
            'https://example.com/products': { violations: { total: 20 }, traffic: 4500 },
            'https://example.com/about': { violations: { total: 15 }, traffic: 5500 },
          },
          lastWeek: {
            violations: {
              total: 55,
              critical: { count: 25 },
              serious: { count: 30 },
            },
            traffic: 14500,
            metadata: {
              timestamp: '2024-03-13T10:00:00Z',
              totalPages: 195,
            },
          },
        },
        success: true,
        message: 'Successfully aggregated 25 files',
      };
      const mockLatestAudit = { siteId: 'complex-site', auditId: 'complex-audit' };

      mockSite.getId.returns('complex-site');
      mockSite.getOrganizationId.returns('complex-org');
      mockSite.getLatestAuditByAuditType.resolves(mockLatestAudit);
      getWeekNumberStub.returns(35);
      generateIndepthReportOpportunityStub.resolves('https://experience.adobe.com/complex-indepth');
      generateEnhancedReportOpportunityStub.resolves('https://experience.adobe.com/complex-enhanced');
      generateFixedNewReportOpportunityStub.resolves('https://experience.adobe.com/complex-fixed-new');
      generateBaseReportOpportunityStub.resolves();

      // Act
      const result = await generateReportOpportunities(
        mockSite,
        mockLog,
        complexAggregationResult,
        true,
        { log: mockLog },
      );

      // Assert
      expect(result.status).to.be.true;

      // Verify all functions were called with the complex data
      expect(generateIndepthReportOpportunityStub).to.have.been.calledWith(
        'complex-site',
        mockLog,
        complexAggregationResult.finalResultFiles.current,
        'complex-org',
        'experience',
        mockLatestAudit,
        sinon.match.object,
        35,
        sinon.match.number,
      );

      expect(generateBaseReportOpportunityStub).to.have.been.calledWith(
        mockLog,
        complexAggregationResult.finalResultFiles.current,
        mockLatestAudit,
        sinon.match.object,
        35,
        sinon.match.number,
        {
          inDepthReportUrl: 'https://experience.adobe.com/complex-indepth',
          enhancedReportUrl: 'https://experience.adobe.com/complex-enhanced',
          fixedVsNewReportUrl: 'https://experience.adobe.com/complex-fixed-new',
        },
        complexAggregationResult.finalResultFiles.lastWeek,
      );
    });

    it('should handle site method failures gracefully', async () => {
      // Arrange
      const mockAggregationResult = {
        finalResultFiles: {
          current: { violations: { total: 5 } },
          lastWeek: { violations: { total: 8 } },
        },
      };

      mockSite.getLatestAuditByAuditType.rejects(new Error('Failed to get latest audit'));

      // Act & Assert
      await expect(
        generateReportOpportunities(
          mockSite,
          mockLog,
          mockAggregationResult,
          true,
          {},
        ),
      ).to.be.rejectedWith('Failed to get latest audit');

      expect(generateIndepthReportOpportunityStub).to.not.have.been.called;
    });
  });
});
