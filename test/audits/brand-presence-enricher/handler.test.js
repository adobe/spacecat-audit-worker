/*
 * Copyright 2026 Adobe. All rights reserved.
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
import ExcelJS from 'exceljs';

use(sinonChai);

describe('brand-presence-enricher handler', () => {
  let sandbox;
  let brandPresenceEnricherRunner;
  let mockSharepointClient;
  let mockPromptToLinks;
  let mockCreateLLMOSharepointClient;
  let mockReadFromSharePoint;
  let mockSaveExcelReport;

  const createMockWorkbook = (sheetName, rows) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    // Add header row
    worksheet.addRow(['Category', 'Topics', 'Prompt', 'Origin', 'Region', 'Volume', 'URL']);

    // Add data rows
    rows.forEach((row) => {
      worksheet.addRow(row);
    });

    return workbook;
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockSharepointClient = {
      getDocument: sandbox.stub(),
    };

    mockPromptToLinks = sandbox.stub();
    mockCreateLLMOSharepointClient = sandbox.stub().resolves(mockSharepointClient);
    mockReadFromSharePoint = sandbox.stub();
    mockSaveExcelReport = sandbox.stub().resolves();

    const module = await esmock('../../../src/brand-presence-enricher/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateLLMOSharepointClient,
        readFromSharePoint: mockReadFromSharePoint,
        saveExcelReport: mockSaveExcelReport,
      },
      '../../../src/brand-presence-enricher/prompt-to-links.js': {
        promptToLinks: mockPromptToLinks,
      },
    });

    brandPresenceEnricherRunner = module.brandPresenceEnricherRunner;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createMockContext = () => ({
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    env: {
      SHAREPOINT_CLIENT_ID: 'test-client-id',
      SHAREPOINT_CLIENT_SECRET: 'test-secret',
    },
  });

  const createMockSite = () => ({
    getId: () => 'site-123',
    getBaseURL: () => 'https://example.com',
    getConfig: () => ({
      getLlmoDataFolder: () => 'customers/example',
    }),
  });

  describe('brandPresenceEnricherRunner', () => {
    it('should enrich rows with empty URLs using promptToLinks', async () => {
      const context = createMockContext();
      const site = createMockSite();

      // Create workbook with test data
      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'What is product X?', 'AI', 'US', 100, ''], // Empty URL - should be enriched
        ['Cat2', 'Topic2', 'How to use Y?', 'AI', 'UK', 50, 'https://existing.com'], // Has URL - skip
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      mockPromptToLinks.resolves(['https://example.com/product-x']);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsProcessed).to.equal(2);
      expect(result.auditResult.rowsEnriched).to.equal(1);
      expect(result.auditResult.rowsSkipped).to.equal(1);
      expect(mockPromptToLinks).to.have.been.calledOnce;
      expect(mockPromptToLinks).to.have.been.calledWith('What is product X?', site, context);
      expect(mockSaveExcelReport).to.have.been.calledOnce;
    });

    it('should skip rows that already have URLs', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'Prompt 1', 'AI', 'US', 100, 'https://existing1.com'],
        ['Cat2', 'Topic2', 'Prompt 2', 'AI', 'UK', 50, 'https://existing2.com'],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsEnriched).to.equal(0);
      expect(result.auditResult.rowsSkipped).to.equal(2);
      expect(mockPromptToLinks).to.not.have.been.called;
    });

    it('should skip rows with no prompt', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', '', 'AI', 'US', 100, ''], // Empty prompt
        ['Cat2', 'Topic2', null, 'AI', 'UK', 50, ''], // Null prompt
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsEnriched).to.equal(0);
      expect(result.auditResult.rowsSkipped).to.equal(2);
      expect(mockPromptToLinks).to.not.have.been.called;
    });

    it('should handle promptToLinks returning empty array', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'Unknown prompt', 'AI', 'US', 100, ''],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      mockPromptToLinks.resolves([]);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsEnriched).to.equal(0);
      expect(result.auditResult.rowsSkipped).to.equal(1);
    });

    it('should handle promptToLinks errors gracefully', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'Error prompt', 'AI', 'US', 100, ''],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      mockPromptToLinks.rejects(new Error('ContentAI error'));

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsErrored).to.equal(1);
      expect(context.log.warn).to.have.been.called;
    });

    it('should return error when sheet not found', async () => {
      const context = createMockContext();
      const site = createMockSite();

      // Create workbook with different sheet name
      const workbook = createMockWorkbook('wrong-sheet-name', []);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Sheet "shared-all" not found');
    });

    it('should return error when reading spreadsheet fails', async () => {
      const context = createMockContext();
      const site = createMockSite();

      mockReadFromSharePoint.rejects(new Error('File not found'));

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to read spreadsheet');
    });

    it('should return error when saving spreadsheet fails', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'Prompt', 'AI', 'US', 100, ''],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);
      mockPromptToLinks.resolves(['https://example.com/page']);
      mockSaveExcelReport.rejects(new Error('SharePoint upload failed'));

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Failed to save spreadsheet');
      expect(result.auditResult.rowsEnriched).to.equal(1);
    });

    it('should add Related URL column if not exists', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', [
        ['Cat1', 'Topic1', 'What is X?', 'AI', 'US', 100, ''],
      ]);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);
      mockPromptToLinks.resolves(['https://example.com/x']);

      await brandPresenceEnricherRunner('https://example.com', context, site);

      // Verify saveExcelReport was called with workbook containing the new column
      expect(mockSaveExcelReport).to.have.been.calledOnce;
      const savedWorkbook = mockSaveExcelReport.firstCall.args[0].workbook;
      const worksheet = savedWorkbook.getWorksheet('shared-all');
      const headerRow = worksheet.getRow(1);

      // Find the Related URL column
      let foundRelatedUrlColumn = false;
      headerRow.eachCell((cell) => {
        if (cell.value === 'Related URL') {
          foundRelatedUrlColumn = true;
        }
      });
      expect(foundRelatedUrlColumn).to.be.true;
    });

    it('should skip rows that already have Related URL', async () => {
      const context = createMockContext();
      const site = createMockSite();

      // Create workbook with Related URL column already populated
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('shared-all');
      worksheet.addRow(['Category', 'Topics', 'Prompt', 'Origin', 'Region', 'Volume', 'URL', 'Related URL']);
      worksheet.addRow(['Cat1', 'Topic1', 'Prompt 1', 'AI', 'US', 100, '', 'https://already-enriched.com']);

      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.rowsSkipped).to.equal(1);
      expect(result.auditResult.rowsEnriched).to.equal(0);
      expect(mockPromptToLinks).to.not.have.been.called;
    });

    it('should return correct audit result format', async () => {
      const context = createMockContext();
      const site = createMockSite();

      const workbook = createMockWorkbook('shared-all', []);
      const buffer = await workbook.xlsx.writeBuffer();
      mockReadFromSharePoint.resolves(buffer);

      const result = await brandPresenceEnricherRunner('https://example.com', context, site);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', 'https://example.com');
      expect(result.auditResult).to.have.property('success', true);
      expect(result.auditResult).to.have.property('siteId', 'site-123');
      expect(result.auditResult).to.have.property('baseURL', 'https://example.com');
      expect(result.auditResult).to.have.property('outputLocation', 'customers/example/brand-presence');
      expect(result.auditResult).to.have.property('filename', 'brandpresence-shared-all.xlsx');
    });
  });
});
