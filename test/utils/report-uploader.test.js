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
import esmock from 'esmock';

use(sinonChai);

describe('Utils Report Uploader', () => {
  let sandbox;
  let fetchStub;
  let mockContext;
  let uploadToSharePoint;
  let saveExcelReport;
  let uploadAndPublishFile;
  let readFromSharePoint;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    process.env.ADMIN_HLX_API_KEY = 'test-api-key';

    fetchStub = sandbox.stub(global, 'fetch');

    const reportUploaderModule = await esmock('../../src/utils/report-uploader.js', {
      '../../src/support/utils.js': {
        sleep: sandbox.stub().resolves(),
      },
    });

    uploadToSharePoint = reportUploaderModule.uploadToSharePoint;
    saveExcelReport = reportUploaderModule.saveExcelReport;
    uploadAndPublishFile = reportUploaderModule.uploadAndPublishFile;
    readFromSharePoint = reportUploaderModule.readFromSharePoint;

    mockContext = {
      workbook: { xlsx: { writeBuffer: sandbox.stub().resolves(Buffer.from('excel data')) } },
      log: { info: sandbox.stub(), error: sandbox.stub() },
      sharepointDoc: {
        uploadRawDocument: sandbox.stub().resolves(),
        getDocumentContent: sandbox.stub().resolves(Buffer.from('test content')),
      },
      sharepointClient: { getDocument: sandbox.stub() },
      params: { outputLocation: 'test-location', filename: 'test-file.xlsx' },
    };

    mockContext.sharepointClient.getDocument.returns(mockContext.sharepointDoc);
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.ADMIN_HLX_API_KEY;
  });

  describe('readFromSharePoint', () => {
    it('should read file content from SharePoint successfully', async () => {
      const filename = 'test.xlsx';
      const outputLocation = 'reports';
      const expectedBuffer = Buffer.from('test file content');

      mockContext.sharepointDoc.getDocumentContent.resolves(expectedBuffer);

      const result = await readFromSharePoint(
        filename,
        outputLocation,
        mockContext.sharepointClient,
        mockContext.log,
      );

      expect(mockContext.sharepointClient.getDocument).to.have.been.calledWith('/sites/elmo-ui-data/reports/test.xlsx');
      expect(mockContext.sharepointDoc.getDocumentContent).to.have.been.calledOnce;
      expect(result).to.deep.equal(expectedBuffer);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Document successfully downloaded from SharePoint: /sites/elmo-ui-data/reports/test.xlsx',
      );
    });

    it('should handle SharePoint read errors', async () => {
      const filename = 'test.xlsx';
      const outputLocation = 'reports';
      const errorMessage = 'SharePoint read error';

      mockContext.sharepointDoc.getDocumentContent.rejects(new Error(errorMessage));

      await expect(
        readFromSharePoint(
          filename,
          outputLocation,
          mockContext.sharepointClient,
          mockContext.log,
        ),
      ).to.be.rejectedWith(errorMessage);

      expect(mockContext.log.error).to.have.been.calledWith(`Failed to read from SharePoint: ${errorMessage}`);
    });

    it('should construct correct document path', async () => {
      const filename = 'report-2025.xlsx';
      const outputLocation = 'monthly-reports';
      const expectedBuffer = Buffer.from('report data');

      mockContext.sharepointDoc.getDocumentContent.resolves(expectedBuffer);

      await readFromSharePoint(
        filename,
        outputLocation,
        mockContext.sharepointClient,
        mockContext.log,
      );

      expect(mockContext.sharepointClient.getDocument).to.have.been.calledWith('/sites/elmo-ui-data/monthly-reports/report-2025.xlsx');
    });
  });

  describe('uploadToSharePoint', () => {
    it('should upload file to SharePoint successfully', async () => {
      const buffer = Buffer.from('test data');
      const filename = 'test.xlsx';
      const outputLocation = 'reports';

      await uploadToSharePoint(
        buffer,
        filename,
        outputLocation,
        mockContext.sharepointClient,
        mockContext.log,
      );

      expect(mockContext.sharepointClient.getDocument).to.have.been.calledWith('/sites/elmo-ui-data/reports/test.xlsx');
      expect(mockContext.sharepointDoc.uploadRawDocument).to.have.been.calledWith(buffer);
      expect(mockContext.log.info).to.have.been.calledWith(
        'Excel report successfully uploaded to SharePoint: /sites/elmo-ui-data/reports/test.xlsx',
      );
    });

    it('should handle SharePoint upload errors', async () => {
      const buffer = Buffer.from('test data');
      const filename = 'test.xlsx';
      const outputLocation = 'reports';

      mockContext.sharepointDoc.uploadRawDocument.rejects(new Error('SharePoint error'));

      await expect(
        uploadToSharePoint(
          buffer,
          filename,
          outputLocation,
          mockContext.sharepointClient,
          mockContext.log,
        ),
      ).to.be.rejectedWith('SharePoint error');

      expect(mockContext.log.error).to.have.been.calledWith('Failed to upload to SharePoint: SharePoint error');
    });
  });

  describe('uploadAndPublishFile', () => {
    it('should upload and publish file successfully', async function uploadAndPublishTest() {
      this.timeout(5000);

      const buffer = Buffer.from('test data');
      const filename = 'test.xlsx';
      const outputLocation = 'reports';

      fetchStub.resolves({ ok: true, status: 200, statusText: 'OK' });

      await uploadAndPublishFile(
        buffer,
        filename,
        outputLocation,
        mockContext.sharepointClient,
        mockContext.log,
      );

      expect(mockContext.sharepointDoc.uploadRawDocument).to.have.been.calledWith(buffer);
      expect(fetchStub).to.have.been.calledTwice;
      expect(fetchStub.firstCall.args[0]).to.include('/preview/');
      expect(fetchStub.secondCall.args[0]).to.include('/live/');
      expect(mockContext.log.info).to.have.been.calledWith(
        'Excel report successfully uploaded to SharePoint: /sites/elmo-ui-data/reports/test.xlsx',
      );
    });

    it('should handle upload errors', async () => {
      const buffer = Buffer.from('test data');
      const filename = 'test.xlsx';
      const outputLocation = 'reports';

      mockContext.sharepointDoc.uploadRawDocument.rejects(new Error('Upload failed'));

      await expect(
        uploadAndPublishFile(
          buffer,
          filename,
          outputLocation,
          mockContext.sharepointClient,
          mockContext.log,
        ),
      ).to.be.rejectedWith('Upload failed');

      expect(mockContext.log.error).to.have.been.calledWith('Failed to upload to SharePoint: Upload failed');
    });

    it('should handle publish errors', async () => {
      const buffer = Buffer.from('test data');
      const filename = 'test.xlsx';
      const outputLocation = 'reports';

      fetchStub.onFirstCall().resolves({ ok: true, status: 200, statusText: 'OK' });
      fetchStub.onSecondCall().resolves({ ok: false, status: 500, statusText: 'Internal Server Error' });

      await uploadAndPublishFile(
        buffer,
        filename,
        outputLocation,
        mockContext.sharepointClient,
        mockContext.log,
      );

      expect(mockContext.log.error).to.have.been.calledWith(
        'Failed to publish via admin.hlx.page: live failed: 500 Internal Server Error',
      );
    });
  });

  describe('saveExcelReport', () => {
    it('should save Excel report successfully', async function saveExcelReportTest() {
      this.timeout(5000);

      fetchStub.resolves({ ok: true, status: 200, statusText: 'OK' });

      await saveExcelReport({
        workbook: mockContext.workbook,
        ...mockContext.params,
        log: mockContext.log,
        sharepointClient: mockContext.sharepointClient,
      });

      expect(mockContext.workbook.xlsx.writeBuffer).to.have.been.calledOnce;
      expect(mockContext.sharepointDoc.uploadRawDocument).to.have.been.calledOnce;
      expect(fetchStub).to.have.been.calledTwice;
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

    it('should skip upload when no SharePoint client provided', async () => {
      await saveExcelReport({
        workbook: mockContext.workbook,
        ...mockContext.params,
        log: mockContext.log,
        sharepointClient: null,
      });

      expect(mockContext.workbook.xlsx.writeBuffer).to.have.been.calledOnce;
      expect(fetchStub).to.not.have.been.called;
    });
  });
});
