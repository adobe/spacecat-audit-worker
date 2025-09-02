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
/* eslint-disable max-len */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import ExcelJS from 'exceljs';

use(sinonChai);

describe('LLM Error Pages – guidance-handler (Excel upsert)', () => {
  let guidanceHandler;
  const sandbox = sinon.createSandbox();

  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let uploadToSharePointStub;
  let publishToAdminHlxStub;

  beforeEach(async () => {
    // Mock all report-uploader functions
    createLLMOSharepointClientStub = sandbox.stub().resolves({});
    readFromSharePointStub = sandbox.stub();
    uploadToSharePointStub = sandbox.stub().resolves();
    publishToAdminHlxStub = sandbox.stub().resolves();

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
        uploadToSharePoint: uploadToSharePointStub,
        publishToAdminHlx: publishToAdminHlxStub,
      },
    });
  });

  afterEach(() => sandbox.restore());

  it('successfully processes message and updates Excel file', async () => {
    // Create existing Excel file with data
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '/products/item', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/products/item',
          suggestedUrls: ['/products'],
          aiRationale: 'Closest match',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            // keep legacy for code paths that still read it
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const logMock = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = { 
      log: logMock, 
      dataAccess,
      s3Client: {
        send: sandbox.stub().resolves()
      }
    };

    const resp = await guidanceHandler.default(message, context);

    expect(resp.status).to.equal(200);
    expect(readFromSharePointStub.calledOnce).to.be.true;
    expect(uploadToSharePointStub.calledOnce).to.be.true;
    expect(publishToAdminHlxStub.calledOnce).to.be.true;
  });

  it('returns 404 when site is not found', async () => {
    const message = {
      auditId: 'audit-123',
      siteId: 'nonexistent-site',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves(null),
      },
      Audit: {
        findById: sandbox.stub(),
      },
    };

    const context = {
      log: { error: sandbox.stub(), info: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
  });

  it('returns 404 when audit is not found', async () => {
    const message = {
      auditId: 'nonexistent-audit',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves(null),
      },
    };

    const context = {
      log: { error: sandbox.stub(), info: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
  });

  it('returns 400 when Excel processing fails', async () => {
    readFromSharePointStub.rejects(new Error('SharePoint error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const logMock = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = { 
      log: logMock, 
      dataAccess,
      s3Client: {
        send: sandbox.stub().resolves()
      }
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(400);
    expect(logMock.error.calledWith('Failed to update 404 Excel on Mystique callback: SharePoint error')).to.be.true;
  });

  it('handles empty brokenLinks array', async () => {
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('handles brokenLinks with actual URL matching and updates', async () => {
    // Create existing Excel file with matching data
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '/products/item', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/products/item',
          suggestedUrls: ['/products', '/items'],
          aiRationale: 'Best match found',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers workbook.worksheets[0] || addWorksheet fallback', async () => {
    // Create workbook with no worksheets to test the || fallback
    const emptyWorkbook = new ExcelJS.Workbook();
    const emptyBuffer = await emptyWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(emptyBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers optional chaining in getCell operations', async () => {
    // Create workbook with problematic cell values to test optional chaining
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    // Add a row with a cell that doesn't have toString method
    sheet.addRow(['ChatGPT', '/test', '', '', '']);
    // Note: The optional chaining in the code handles cells without toString methods
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers empty urlCell branch in Excel processing loop', async () => {
    // Test the branch where urlCell is empty (if condition fails)
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '', '', '', '']); // Empty URL cell
    sheet.addRow(['Claude', null, '', '', '']); // Null URL cell
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/test',
          suggestedUrls: ['/test'],
          aiRationale: 'Test',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers additional branches - null/undefined suggestedUrls and aiRationale', async () => {
    // Test the || [] and || '' fallback branches in the brokenUrlsMap creation
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '/test-path', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/test-path',
          suggestedUrls: null, // This tests the || [] fallback
          aiRationale: undefined, // This tests the || '' fallback
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers URL parsing with query parameters', async () => {
    // Test the URL parsing logic that includes search parameters
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '/search?q=test', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/search?q=test&param=value', // URL with query params
          suggestedUrls: ['/search'],
          aiRationale: 'Search page',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers toPathOnly catch block with invalid URL characters', async () => {
    // Test the catch block by using URLs with invalid characters
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'http://[invalid-ipv6-bracket', // Invalid URL that should cause URL constructor to throw
          suggestedUrls: ['/fallback'],
          aiRationale: 'Test catch block',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers getLlmoDataFolder fallback to s3Config.customerName', async () => {
    // Test the || s3Config.customerName fallback when getLlmoDataFolder returns null
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => null, // This will trigger the || s3Config.customerName fallback
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers search parameter parsing in URL', async () => {
    // Test the (parsed.search || '') part of the return statement in toPathOnly
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    sheet.addRow(['ChatGPT', '/search', '', '', '']); // URL without search params
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/search', // URL without search params - tests || '' branch
          suggestedUrls: ['/search'],
          aiRationale: 'Test search param fallback',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers userAgent cell toString fallback', async () => {
    // Test the || '' fallback when userAgent cell has no toString method
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    // Add row with problematic userAgent cell
    sheet.addRow([null, '/test', '', '', '']); // null userAgent
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers getBaseURL returning falsy value in toPathOnly', async () => {
    // Test the fallback when getBaseURL returns empty string
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence Score']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: '/test-path', // Relative URL
          suggestedUrls: ['/test'],
          aiRationale: 'Test',
        }],
      },
    };

    // Create a site mock that returns valid URL for utils.js but empty string for toPathOnly
    let getBaseURLCallCount = 0;
    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getBaseURL: () => {
            getBaseURLCallCount += 1;
            // Return valid URL for first call (utils.js), empty string for subsequent calls (toPathOnly)
            return getBaseURLCallCount === 1 ? 'https://example.com' : '';
          },
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => 'test-customer',
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });
});
