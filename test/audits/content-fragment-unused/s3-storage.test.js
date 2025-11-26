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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('S3 Storage', () => {
  let sandbox;
  let log;
  let mockS3Client;
  let mockGenerateStandardBucketName;
  let mockGetObjectFromKey;
  let buildStoragePath;
  let uploadFragmentsToS3;
  let downloadFragmentsFromS3;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    log = {
      debug: sandbox.spy(),
      info: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
    };

    mockS3Client = {
      send: sandbox.stub().resolves(),
    };

    mockGenerateStandardBucketName = sandbox.stub().returns('test-bucket');
    mockGetObjectFromKey = sandbox.stub();

    const s3StorageModule = await esmock(
      '../../../src/content-fragment-unused/storage/s3-storage.js',
      {
        '../../../src/utils/cdn-utils.js': {
          generateStandardBucketName: mockGenerateStandardBucketName,
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: mockGetObjectFromKey,
        },
      },
    );

    buildStoragePath = s3StorageModule.buildStoragePath;
    uploadFragmentsToS3 = s3StorageModule.uploadFragmentsToS3;
    downloadFragmentsFromS3 = s3StorageModule.downloadFragmentsFromS3;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('buildStoragePath', () => {
    it('should build correct S3 path', () => {
      const date = new Date('2024-06-15T10:30:00.000Z');

      const result = buildStoragePath('prod', 'org-123', date);

      expect(mockGenerateStandardBucketName).to.have.been.calledWith('prod');
      expect(result).to.equal(
        's3://test-bucket/org-123/unused-fragments/2024/06/15/2024-06-15T10:30:00.000Z-unused-fragments.json',
      );
    });

    it('should pad month and day with zeros', () => {
      const date = new Date('2024-01-05T08:00:00.000Z');

      const result = buildStoragePath('dev', 'org-456', date);

      expect(result).to.include('/2024/01/05/');
    });

    it('should use current date when not provided', () => {
      const result = buildStoragePath('stage', 'org-789');

      expect(result).to.match(/s3:\/\/test-bucket\/org-789\/unused-fragments\/\d{4}\/\d{2}\/\d{2}\//);
    });
  });

  describe('uploadFragmentsToS3', () => {
    const validS3Path = 's3://test-bucket/org-123/unused-fragments/2024/06/15/file.json';

    it('should upload fragments successfully', async () => {
      const fragments = [
        { fragmentPath: '/content/dam/fragment1', status: 'NEW' },
        { fragmentPath: '/content/dam/fragment2', status: 'DRAFT' },
      ];

      await uploadFragmentsToS3(fragments, validS3Path, mockS3Client, log);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledTwice;
    });

    it('should throw error when fragments is null', async () => {
      await expect(
        uploadFragmentsToS3(null, validS3Path, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] No fragments to upload');
    });

    it('should throw error when fragments is undefined', async () => {
      await expect(
        uploadFragmentsToS3(undefined, validS3Path, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] No fragments to upload');
    });

    it('should throw error when s3Path is null', async () => {
      await expect(
        uploadFragmentsToS3([], null, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });

    it('should throw error when s3Path does not start with s3://', async () => {
      await expect(
        uploadFragmentsToS3([], 'invalid-path', mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });

    it('should throw error when s3Client is null', async () => {
      await expect(
        uploadFragmentsToS3([], validS3Path, null, log),
      ).to.be.rejectedWith('[Content Fragment Unused] S3 client is required');
    });

    it('should throw error when S3 upload fails', async () => {
      mockS3Client.send.rejects(new Error('S3 error'));

      await expect(
        uploadFragmentsToS3([], validS3Path, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Failed to upload fragments to S3: S3 error');

      expect(log.error).to.have.been.called;
    });

    it('should throw error for invalid S3 path format (no slash after bucket)', async () => {
      await expect(
        uploadFragmentsToS3([], 's3://bucket-only', mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });
  });

  describe('downloadFragmentsFromS3', () => {
    const validS3Path = 's3://test-bucket/org-123/unused-fragments/2024/06/15/file.json';

    it('should download fragments successfully', async () => {
      const fragments = [
        { fragmentPath: '/content/dam/fragment1', status: 'NEW' },
      ];
      mockGetObjectFromKey.resolves(fragments);

      const result = await downloadFragmentsFromS3(validS3Path, mockS3Client, log);

      expect(result).to.deep.equal(fragments);
      expect(mockGetObjectFromKey).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        'org-123/unused-fragments/2024/06/15/file.json',
        log,
      );
      expect(log.info).to.have.been.calledTwice;
    });

    it('should throw error when s3Path is null', async () => {
      await expect(
        downloadFragmentsFromS3(null, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });

    it('should throw error when s3Path does not start with s3://', async () => {
      await expect(
        downloadFragmentsFromS3('invalid-path', mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });

    it('should throw error when s3Client is null', async () => {
      await expect(
        downloadFragmentsFromS3(validS3Path, null, log),
      ).to.be.rejectedWith('[Content Fragment Unused] S3 client is required');
    });

    it('should throw error when no data found', async () => {
      mockGetObjectFromKey.resolves(null);

      await expect(
        downloadFragmentsFromS3(validS3Path, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Failed to download fragments from S3');

      expect(log.error).to.have.been.called;
    });

    it('should throw error when S3 download fails', async () => {
      mockGetObjectFromKey.rejects(new Error('S3 download error'));

      await expect(
        downloadFragmentsFromS3(validS3Path, mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Failed to download fragments from S3');

      expect(log.error).to.have.been.called;
    });

    it('should throw error for invalid S3 path format (no slash after bucket)', async () => {
      await expect(
        downloadFragmentsFromS3('s3://bucket-only', mockS3Client, log),
      ).to.be.rejectedWith('[Content Fragment Unused] Invalid S3 path');
    });
  });
});
