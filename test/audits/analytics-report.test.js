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
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Analytics Report Handler', () => {
  let sandbox;
  let context;
  let site;
  let mockS3Client;
  let mockSharepointClient;
  let handlerModule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getId: sandbox.stub().returns('site-id'),
    };

    mockS3Client = {
      send: sandbox.stub(),
    };

    mockSharepointClient = {
      getDocument: sandbox.stub(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: mockS3Client,
      })
      .build();

    handlerModule = await esmock('../../src/analytics-report/handler.js', {
      '@adobe/spacecat-helix-content-sdk': {
        createFrom: sandbox.stub().resolves(mockSharepointClient),
      },
      '../../src/utils/report-uploader.js': {
        uploadAndPublishFile: sandbox.stub().resolves(),
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process analytics report files successfully', async () => {
    const currentDate = new Date().toISOString().split('T')[0];
    const mockFiles = [
      { Key: `adobe/referralrevenue-chatgpt-${currentDate}.xlsx`, Size: 1024 },
      { Key: `adobe/referralrevenue-bing-${currentDate}.xlsx`, Size: 2048 },
      { Key: 'adobe/referralrevenue-google-2025-01-01.xlsx', Size: 512 },
    ];

    mockS3Client.send.onFirstCall().resolves({ Contents: mockFiles });
    mockS3Client.send.onSecondCall().resolves({
      Body: { transformToByteArray: () => Buffer.from('excel1') },
    });
    mockS3Client.send.onThirdCall().resolves({
      Body: { transformToByteArray: () => Buffer.from('excel2') },
    });

    const result = await handlerModule.analyticsReportRunner('example.com', context, site);

    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.deep.include({
      processed: 2,
      success: true,
    });
    expect(mockS3Client.send).to.have.been.calledThrice;
  });

  it('should handle no files found for current date', async () => {
    const mockFiles = [
      { Key: 'adobe/referralrevenue-chatgpt-2025-01-01.xlsx', Size: 1024 },
      { Key: 'adobe/referralrevenue-bing-2025-01-02.xlsx', Size: 2048 },
    ];

    mockS3Client.send.onFirstCall().resolves({ Contents: mockFiles });

    const result = await handlerModule.analyticsReportRunner('example.com', context, site);

    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.deep.include({
      processed: 0,
      success: true,
    });
    expect(mockS3Client.send).to.have.been.calledOnce;
  });

  it('should handle empty file list', async () => {
    mockS3Client.send.onFirstCall().resolves({ Contents: undefined });

    const result = await handlerModule.analyticsReportRunner('example.com', context, site);

    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.deep.include({
      processed: 0,
      success: true,
    });
    expect(mockS3Client.send).to.have.been.calledOnce;
  });

  it('should filter files by current date', async () => {
    const currentDate = new Date().toISOString().split('T')[0];
    const mockFiles = [
      { Key: `adobe/referralrevenue-chatgpt-${currentDate}.xlsx`, Size: 1024 },
      { Key: 'adobe/referralrevenue-bing-2025-01-01.xlsx', Size: 2048 }, // old file
      { Key: 'adobe/referralrevenue-google-2025-01-02.xlsx', Size: 512 }, // old file
    ];

    mockS3Client.send.onFirstCall().resolves({ Contents: mockFiles });
    mockS3Client.send.onSecondCall().resolves({
      Body: { transformToByteArray: () => Buffer.from('excel1') },
    });

    const result = await handlerModule.analyticsReportRunner('example.com', context, site);

    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.deep.include({
      processed: 1,
      success: true,
    });
    expect(mockS3Client.send).to.have.been.calledTwice;
  });

  it('should handle S3 errors', async () => {
    const s3Error = new Error('S3 connection failed');
    mockS3Client.send.onFirstCall().rejects(s3Error);

    await expect(handlerModule.analyticsReportRunner('example.com', context, site))
      .to.be.rejectedWith('S3 connection failed');
    expect(context.log.error).to.have.been.calledWith('Analytics report failed: S3 connection failed');
  });

  it('should handle upload errors', async () => {
    const currentDate = new Date().toISOString().split('T')[0];
    const mockFiles = [
      { Key: `adobe/referralrevenue-chatgpt-${currentDate}.xlsx`, Size: 1024 },
    ];

    mockS3Client.send.onFirstCall().resolves({ Contents: mockFiles });
    mockS3Client.send.onSecondCall().resolves({
      Body: { transformToByteArray: () => Buffer.from('excel1') },
    });

    handlerModule = await esmock('../../src/analytics-report/handler.js', {
      '@adobe/spacecat-helix-content-sdk': {
        createFrom: sandbox.stub().resolves(mockSharepointClient),
      },
      '../../src/utils/report-uploader.js': {
        uploadAndPublishFile: sandbox.stub().rejects(new Error('Upload failed')),
      },
    });

    await expect(handlerModule.analyticsReportRunner('example.com', context, site))
      .to.be.rejectedWith('Upload failed');
    expect(context.log.error).to.have.been.calledWith('Analytics report failed: Upload failed');
  });
});
