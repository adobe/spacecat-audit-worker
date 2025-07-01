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
import { saveExcelReport } from '../../../src/cdn-logs-report/utils/report-uploader.js';

use(sinonChai);

describe('CDN Logs Report Uploader', () => {
  let sandbox;
  let fetchStub;
  let mockContext;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    process.env.ADMIN_HLX_API_KEY = 'test-api-key';

    fetchStub = sandbox.stub(global, 'fetch');

    mockContext = {
      workbook: { xlsx: { writeBuffer: sandbox.stub().resolves(Buffer.from('excel data')) } },
      log: { info: sandbox.stub(), error: sandbox.stub() },
      sharepointDoc: { uploadRawDocument: sandbox.stub().resolves() },
      sharepointClient: { getDocument: sandbox.stub() },
      params: { outputLocation: 'test-location', filename: 'test-file.xlsx' },
    };

    mockContext.sharepointClient.getDocument.returns(mockContext.sharepointDoc);
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.ADMIN_HLX_API_KEY;
  });

  it('should export saveExcelReport function', () => {
    expect(saveExcelReport).to.be.a('function');
  });

  it('should handle workbook buffer errors', async () => {
    mockContext.workbook.xlsx.writeBuffer.rejects(new Error('Buffer error'));

    await expect(saveExcelReport({
      workbook: mockContext.workbook,
      ...mockContext.params,
      log: mockContext.log,
      sharepointClient: mockContext.sharepointClient,
    })).to.be.rejectedWith('Buffer error');

    expect(mockContext.log.error).to.have.been.calledWith('Failed to save Excel report: Buffer error');
  });

  it('should successfully upload report and publish to admin API', async function uploadReportTest() {
    this.timeout(5000);

    fetchStub.resolves({ ok: true, status: 200, statusText: 'OK' });

    await saveExcelReport({
      workbook: mockContext.workbook,
      ...mockContext.params,
      log: mockContext.log,
      sharepointClient: mockContext.sharepointClient,
    });

    expect(mockContext.sharepointDoc.uploadRawDocument).to.have.been.calledOnce;
    expect(fetchStub).to.have.been.calledTwice;
    expect(fetchStub.firstCall.args[0]).to.include('/preview/');
    expect(fetchStub.secondCall.args[0]).to.include('/live/');
    expect(mockContext.log.error).to.not.have.been.called;
  });

  it('should handle SharePoint upload errors', async () => {
    mockContext.sharepointDoc.uploadRawDocument.rejects(new Error('SharePoint error'));

    await expect(saveExcelReport({
      workbook: mockContext.workbook,
      ...mockContext.params,
      log: mockContext.log,
      sharepointClient: mockContext.sharepointClient,
    })).to.be.rejectedWith('SharePoint error');

    expect(mockContext.log.error).to.have.been.calledWith('Failed to upload to SharePoint: SharePoint error');
  });

  it('should handle admin API publish errors gracefully', async function adminApiErrorTest() {
    this.timeout(5000);

    fetchStub.onFirstCall().resolves({ ok: false, status: 404, statusText: 'Not Found' });

    await saveExcelReport({
      workbook: mockContext.workbook,
      ...mockContext.params,
      log: mockContext.log,
      sharepointClient: mockContext.sharepointClient,
    });

    expect(mockContext.log.error).to.have.been.calledWith('Failed to publish via admin.hlx.page: preview failed: 404 Not Found');
    expect(mockContext.sharepointDoc.uploadRawDocument).to.have.been.called;
  });

  it('should skip upload when no SharePoint client provided', async () => {
    await saveExcelReport({
      workbook: mockContext.workbook,
      ...mockContext.params,
      log: mockContext.log,
      sharepointClient: null,
    });

    expect(mockContext.log.error).to.not.have.been.called;
    expect(fetchStub).to.not.have.been.called;
  });
});
