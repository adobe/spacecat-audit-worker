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
  let filterReachableUrlsStub;

  beforeEach(async () => {
    // Mock all report-uploader functions
    createLLMOSharepointClientStub = sandbox.stub().resolves({});
    readFromSharePointStub = sandbox.stub();
    uploadToSharePointStub = sandbox.stub().resolves();
    publishToAdminHlxStub = sandbox.stub().resolves();
    // Passthrough HEAD-check by default; individual tests override.
    filterReachableUrlsStub = sandbox.stub().callsFake(async (urls) => urls);

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
        uploadToSharePoint: uploadToSharePointStub,
        publishToAdminHlx: publishToAdminHlxStub,
      },
      '../../../src/llm-error-pages/url-health-check.js': {
        filterOutConfirmedBrokenUrls: filterReachableUrlsStub,
      },
    });
  });

  afterEach(() => sandbox.restore());

  it('successfully processes message and updates Excel file', async () => {
    // Create existing Excel file with correct 11-column structure
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 150, 245.5, 'US', '/products/item', 'Adobe Creative', 'Product Page', '', '', '']);
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
          suggestionId: 'llm-404-suggestion-w34-2025-0',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
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
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = {
      log: logMock,
      dataAccess,
      s3Client: {
        send: sandbox.stub().resolves(),
      },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
      log: { error: sandbox.stub(), info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'test-site-id',
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
      log: { error: sandbox.stub(), info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(404);
  });

  it('logs and continues (returns 200) when Excel processing fails — dual-write best-effort', async () => {
    readFromSharePointStub.rejects(new Error('SharePoint error'));

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: { brokenLinks: [] },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
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
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = {
      log: logMock,
      dataAccess,
      s3Client: {
        send: sandbox.stub().resolves(),
      },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
    expect(logMock.error).to.have.been.calledWith(
      sinon.match(/Excel guidance update failed/),
      sinon.match({ err: 'SharePoint error', siteId: 'site-1' }),
    );
  });

  it('handles empty brokenLinks array', async () => {
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
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
          getId: () => 'test-site-id',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('falls back to generateReportingPeriods when brokenLinks have no suggestionId', async () => {
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 150, 245.5, 'US', '/products/item', 'Adobe Creative', 'Product Page', '', '', '']);
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
          getId: () => 'test-site-id',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: { AWS_ENV: 'test', AWS_REGION: 'us-east-1' },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);

    const filenameArg = readFromSharePointStub.firstCall.args[0];
    expect(filenameArg).to.match(/^agentictraffic-errors-404-w\d{2}-\d{4}\.xlsx$/);
  });

  it('handles brokenLinks with actual URL matching and updates', async () => {
    // Create existing Excel file with matching data
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 150, 245.5, 'US', '/products/item', 'Adobe Creative', 'Product Page', '', '', '']);
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
          getId: () => 'test-site-id',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('handles comma-separated user agents from Mystique', async () => {
    // Test the new comma-separated user agent matching logic
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 150, 245.5, 'US', '/test-page', 'Adobe Creative', 'Product Page', '', '', '']);
    sheet.addRow(['Web search crawlers', 'Perplexity', 89, 189.2, 'GLOBAL', '/another-page', 'Support', 'Help Page', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT, Perplexity', // Comma-separated user agents like Mystique sends
          urlTo: 'https://example.com/test-page',
          suggestedUrls: ['/products', '/items'],
          aiRationale: 'Best match found for multiple agents',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
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
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = {
      log: logMock,
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);

    // Verify that the debug logging was called
    expect(logMock.debug.calledWith('Processing 1 broken links from Mystique')).to.be.true;
  });

  it('handles empty suggestedUrls array from Mystique', async () => {
    // Test handling of Mystique responses with empty suggestions
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 150, 245.5, 'US', '/test-page', 'Adobe Creative', 'Product Page', '', '', '']);
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/test-page',
          suggestedUrls: [], // Empty suggestions like some Mystique responses
          aiRationale: 'Analysis completed but unexpected output format',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
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
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = {
      log: logMock,
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);

    // Empty-suggestion rows now log at debug (aggregate counter in
    // head-check-summary is the real signal); warn must NOT fire.
    expect(logMock.debug.calledWith('No suggested URLs for broken link: https://example.com/test-page')).to.be.true;
    expect(logMock.warn).to.not.have.been.calledWith('No suggested URLs for broken link: https://example.com/test-page');
  });

  it('handles user agent mismatch scenario - now updates regardless', async () => {
    // Test that URL matches update Excel regardless of user agent differences
    const existingWorkbook = new ExcelJS.Workbook();
    const sheet = existingWorkbook.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'Claude', 150, 245.5, 'US', '/test-page', 'Adobe Creative', 'Product Page', '', '', '']); // Different user agent
    const existingBuffer = await existingWorkbook.xlsx.writeBuffer();
    readFromSharePointStub.resolves(existingBuffer);

    const message = {
      auditId: 'audit-123',
      siteId: 'site-1',
      data: {
        brokenLinks: [{
          urlFrom: 'ChatGPT', // Different from "Claude" in Excel, but should still update
          urlTo: 'https://example.com/test-page',
          suggestedUrls: ['/products'],
          aiRationale: 'Test user agent mismatch - should still update',
        }],
      },
    };

    const dataAccess = {
      Site: {
        findById: sandbox.stub().resolves({
          getId: () => 'test-site-id',
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
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    const context = {
      log: logMock,
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);

    // Verify that the Excel was updated despite user agent mismatch
    expect(logMock.debug.calledWith('Updated row 2 for URL: /test-page with 1 suggestions')).to.be.true;
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
          getId: () => 'test-site-id',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'test-site-id',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });

  it('covers getLlmoDataFolder fallback to s3Config.siteName', async () => {
    // Test the || s3Config.siteName fallback when getLlmoDataFolder returns null
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
          getId: () => 'site-1',
          getConfig: () => ({
            getCdnLogsConfig: () => null,
            getLlmoDataFolder: () => null, // This will trigger the || s3Config.siteName fallback
            getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
          }),
        }),
      },
      Audit: {
        findById: sandbox.stub().resolves({ getId: () => 'audit-123' }),
      },
    };

    const context = {
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
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
          getId: () => 'site-1',
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
      log: { info: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
      dataAccess,
      s3Client: { send: sandbox.stub().resolves() },
      env: {
        AWS_ENV: 'test',
        AWS_REGION: 'us-east-1',
      },
    };

    const resp = await guidanceHandler.default(message, context);
    expect(resp.status).to.equal(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB dual-write paths (Suggestion update alongside Excel cell update)
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Error Pages – guidance-handler (DB dual-write)', () => {
  let guidanceHandler;
  const sandbox = sinon.createSandbox();

  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let uploadToSharePointStub;
  let publishToAdminHlxStub;
  let filterReachableUrlsStub;

  beforeEach(async () => {
    createLLMOSharepointClientStub = sandbox.stub().resolves({});
    readFromSharePointStub = sandbox.stub();
    uploadToSharePointStub = sandbox.stub().resolves();
    publishToAdminHlxStub = sandbox.stub().resolves();
    // Passthrough HEAD-check by default; individual tests override.
    filterReachableUrlsStub = sandbox.stub().callsFake(async (urls) => urls);

    // Default: Excel read returns a workbook so the Excel block succeeds.
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('data');
    sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
    sheet.addRow(['Chatbots', 'ChatGPT', 100, 250, 'US', '/products/item', 'X', 'Y', '', '', '']);
    readFromSharePointStub.resolves(await wb.xlsx.writeBuffer());

    guidanceHandler = await esmock('../../../src/llm-error-pages/guidance-handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
        uploadToSharePoint: uploadToSharePointStub,
        publishToAdminHlx: publishToAdminHlxStub,
      },
      '../../../src/llm-error-pages/url-health-check.js': {
        filterOutConfirmedBrokenUrls: filterReachableUrlsStub,
      },
    });
  });

  afterEach(() => sandbox.restore());

  function makeSuggestion(urlPath, existingData = {}) {
    let data = { url: urlPath, ...existingData };
    return {
      getData: () => data,
      setData: sandbox.stub().callsFake((d) => { data = d; }),
    };
  }

  function buildContext(overrides = {}) {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({
        getCdnLogsConfig: () => null,
        getLlmoDataFolder: () => 'test-customer',
        getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
      }),
      ...overrides.site,
    };
    const suggestions = overrides.suggestions ?? [];
    const opportunity = overrides.opportunity || {
      getId: () => 'opp-1',
      getSiteId: () => 'site-1',
      getSuggestions: sandbox.stub().resolves(suggestions),
    };
    const dataAccess = {
      Site: { findById: sandbox.stub().resolves(site) },
      Audit: { findById: sandbox.stub().resolves({ getId: () => 'audit-1' }) },
      Opportunity: {
        findById: sandbox.stub().resolves(opportunity),
        ...overrides.Opportunity,
      },
      Suggestion: { saveMany: sandbox.stub().resolves() },
    };
    const log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    return {
      log, dataAccess, s3Client: { send: sandbox.stub().resolves() }, env: { AWS_ENV: 'test', AWS_REGION: 'us-east-1' },
    };
  }

  it('writes suggestedUrls, aiRationale, confidenceScore to matched DB Suggestion', async () => {
    const suggestion = makeSuggestion('/products/item');
    const ctx = buildContext({ suggestions: [suggestion] });

    const message = {
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'ChatGPT',
          urlTo: 'https://example.com/products/item',
          suggestedUrls: ['/products', '/shop'],
          aiRationale: 'Best match',
          confidenceScore: 0.9,
        }],
      },
    };

    const resp = await guidanceHandler.default(message, ctx);

    expect(resp.status).to.equal(200);
    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal(['/products', '/shop']);
    expect(saved.aiRationale).to.equal('Best match');
    expect(saved.confidenceScore).to.equal(0.9);
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
  });

  it('defaults aiRationale to empty string when missing', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'],
        }],
      },
    }, ctx);

    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.aiRationale).to.equal('');
  });

  it('omits confidenceScore when not provided', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'ChatGPT', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    const saved = suggestion.setData.firstCall.args[0];
    expect(Object.keys(saved)).to.not.include('confidenceScore');
  });

  it('warns and skips DB when opportunityId is missing — Excel still runs', async () => {
    const ctx = buildContext({ suggestions: [] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        // no opportunityId
        brokenLinks: [{
          urlFrom: 'ChatGPT', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.dataAccess.Opportunity.findById).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
    expect(ctx.log.warn).to.have.been.calledWithMatch(/No opportunityId/);
    // Excel side ran.
    expect(uploadToSharePointStub).to.have.been.called;
  });

  it('skips DB write and warns when opportunity belongs to a different site', async () => {
    const suggestion = makeSuggestion('/p');
    const otherSiteOpportunity = {
      getId: () => 'opp-other-site',
      getSiteId: () => 'other-site',
      getSuggestions: sandbox.stub().resolves([suggestion]),
    };
    const ctx = buildContext({
      opportunity: otherSiteOpportunity,
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-other-site',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.warn).to.have.been.calledWithMatch(/siteId mismatch/);
    expect(suggestion.setData).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('warns when Opportunity is not found in DB', async () => {
    const ctx = buildContext({
      Opportunity: { findById: sandbox.stub().resolves(null) },
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-missing',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.warn).to.have.been.calledWithMatch(/Opportunity not found/);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('persists empty-suggestion rows to DB (Excel↔DB consistency — gate removed)', async () => {
    // Pre-fix behavior was to silently skip empty-suggestion rows in the DB, which
    // diverged from the Excel write that includes them. Both surfaces must now agree.
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: [], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    // HEAD-check pass clears the rationale once the URL list is empty.
    expect(saved.aiRationale).to.equal('');
    expect(ctx.dataAccess.Suggestion.saveMany).to.have.been.calledOnce;
  });

  it('skips brokenLinks where no suggestion matches the URL path', async () => {
    const suggestion = makeSuggestion('/other');
    const ctx = buildContext({ suggestions: [suggestion] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/no-match', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(suggestion.setData).to.not.have.been.called;
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('logs error and continues when DB write throws — Excel still runs', async () => {
    const ctx = buildContext({
      Opportunity: { findById: sandbox.stub().rejects(new Error('db-down')) },
    });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X', urlTo: 'https://example.com/p', suggestedUrls: ['/x'], aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.log.error).to.have.been.calledWithMatch(/DB guidance update failed/);
    // Excel side completed regardless.
    expect(uploadToSharePointStub).to.have.been.called;
  });

  it('handles empty brokenLinks (no DB writes attempted)', async () => {
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: { opportunityId: 'opp-1', brokenLinks: [] },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('drops HEAD-failed suggestedUrls before persisting and logs the drop count', async () => {
    // Helper drops /bad, keeps /good.
    filterReachableUrlsStub.callsFake(async (urls) => urls.filter((u) => !u.endsWith('/bad')));
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/good', 'https://example.com/bad'],
          aiRationale: 'Some prose',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal(['https://example.com/good']);
    // Rationale is preserved when at least one URL survives.
    expect(saved.aiRationale).to.equal('Some prose');
    expect(ctx.log.info).to.have.been.calledWithMatch(/Dropped 1 suggested URL/);
  });

  it('clears aiRationale when HEAD-check empties suggestedUrls for a link', async () => {
    // Helper drops every URL.
    filterReachableUrlsStub.callsFake(async () => []);
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/bad-1', 'https://example.com/bad-2'],
          aiRationale: 'Refers to URLs that no longer exist',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    expect(saved.aiRationale).to.equal('');
  });

  it('tolerates brokenLinks entries with non-array suggestedUrls (e.g. undefined)', async () => {
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          // no suggestedUrls field at all
          aiRationale: 'r',
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([]);
    expect(saved.aiRationale).to.equal('');
  });

  it('handles brokenLinks absent from the message (defensive Array.isArray guard)', async () => {
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      // data has no brokenLinks key
      data: { opportunityId: 'opp-1' },
    }, ctx);

    // brokenLinks is normalised to [] by the `Array.isArray(...) ? : []`
    // guard near the top of the handler. The Excel block then runs against
    // an empty list — it does NOT throw — and proceeds to write an
    // unchanged workbook to SharePoint. The DB-write reduce sees [] and
    // never calls saveMany. The handler returns 200 normally.
    expect(resp.status).to.equal(200);
    expect(uploadToSharePointStub).to.have.been.called;
    expect(publishToAdminHlxStub).to.have.been.called;
    expect(ctx.log.error).to.not.have.been.calledWithMatch(/Excel guidance update failed/);
    expect(ctx.dataAccess.Suggestion.saveMany).to.not.have.been.called;
  });

  it('keeps incoming aiRationale as "" when surviving URLs exist but rationale is undefined (?? "" fallback)', async () => {
    // HEAD-check is the default passthrough so all suggested URLs survive;
    // the link.aiRationale field is missing on the incoming payload, so the
    // `?? ''` fallback in the handler should land an empty string in the DB.
    const suggestion = makeSuggestion('/p');
    const ctx = buildContext({ suggestions: [suggestion] });

    const resp = await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/keep-1', 'https://example.com/keep-2'],
          // aiRationale intentionally undefined
        }],
      },
    }, ctx);

    expect(resp.status).to.equal(200);
    expect(suggestion.setData).to.have.been.calledOnce;
    const saved = suggestion.setData.firstCall.args[0];
    expect(saved.suggestedUrls).to.deep.equal([
      'https://example.com/keep-1',
      'https://example.com/keep-2',
    ]);
    expect(saved.aiRationale).to.equal('');
  });

  it('emits head-check-summary log line with siteId / total / kept / dropped counters', async () => {
    // Drop one URL, keep one — verifies the structured log shape.
    filterReachableUrlsStub.callsFake(async (urls) => urls.filter((u) => !u.endsWith('/bad')));
    const ctx = buildContext({ suggestions: [makeSuggestion('/p')] });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [{
          urlFrom: 'X',
          urlTo: 'https://example.com/p',
          suggestedUrls: ['https://example.com/good', 'https://example.com/bad'],
          aiRationale: 'r',
        }],
      },
    }, ctx);

    const summaryCall = ctx.log.info.getCalls().find(
      (c) => typeof c.args[0] === 'string' && c.args[0].includes('head-check-summary'),
    );
    expect(summaryCall, 'head-check-summary log line missing').to.exist;
    // Structured counters are passed as the second arg (Coralogix native fields).
    expect(summaryCall.args[1]).to.deep.equal({
      siteId: 'site-1', total: 2, kept: 1, dropped: 1,
    });
  });

  it('deduplicates a URL shared across broken links into a single HEAD check, then maps it back per-link', async () => {
    const ctx = buildContext({
      suggestions: [makeSuggestion('/a'), makeSuggestion('/b')],
    });

    await guidanceHandler.default({
      siteId: 'site-1',
      auditId: 'audit-1',
      data: {
        opportunityId: 'opp-1',
        brokenLinks: [
          {
            urlFrom: 'X',
            urlTo: 'https://example.com/a',
            suggestedUrls: ['https://example.com/shared', 'https://example.com/only-a'],
            aiRationale: 'ra',
          },
          {
            urlFrom: 'Y',
            urlTo: 'https://example.com/b',
            suggestedUrls: ['https://example.com/shared'],
            aiRationale: 'rb',
          },
        ],
      },
    }, ctx);

    // The shared URL is HEAD-checked exactly once: the handler dedups into a Set
    // before probing, so the three suggestions collapse to two unique URLs.
    expect(filterReachableUrlsStub).to.have.been.calledOnce;
    const probed = filterReachableUrlsStub.firstCall.args[0];
    expect(probed).to.have.members(['https://example.com/shared', 'https://example.com/only-a']);
    expect(probed).to.have.length(2);
  });
});
