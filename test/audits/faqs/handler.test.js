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

describe('FAQs Handler', () => {
  let context;
  let sandbox;
  let site;
  let audit;
  let log;
  let sqs;
  let env;
  let dataAccess;
  let runFaqsAudit;
  let sendMystiqueMessagePostProcessor;
  let createLLMOSharepointClientStub;
  let readFromSharePointStub;
  let validateContentAIStub;
  let ExcelJSStub;

  beforeEach(async function () {
    this.timeout(10000); // Increase timeout for esmock loading
    sandbox = sinon.createSandbox();

    // Setup stubs
    createLLMOSharepointClientStub = sandbox.stub().resolves({ client: 'mock' });
    readFromSharePointStub = sandbox.stub();
    validateContentAIStub = sandbox.stub().resolves({
      uid: 'test-uid-123',
      indexName: 'test-index',
      genSearchEnabled: true,
      isWorking: true,
    });

    // Mock Excel workbook structure
    ExcelJSStub = {
      Workbook: class {
        constructor() {
          this.worksheets = [];
        }

        async xlsx() {
          return {
            load: sandbox.stub().resolves(),
          };
        }
      },
    };

    // Mock the handler with dependencies
    const mockedModule = await esmock('../../../src/faqs/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      '../../../src/faqs/utils.js': {
        validateContentAI: validateContentAIStub,
      },
      exceljs: ExcelJSStub,
    });

    // Access the exported functions
    runFaqsAudit = mockedModule.default.runner;
    sendMystiqueMessagePostProcessor = mockedModule.default.postProcessors[0];

    site = {
      getBaseURL: () => 'https://adobe.com',
      getId: () => 'site-123',
      getDeliveryType: () => 'aem',
      getConfig: () => ({
        getLlmoDataFolder: () => '/data/llmo',
      }),
    };

    audit = {
      getId: () => 'audit-456',
      getAuditType: () => 'faqs',
      getFullAuditRef: () => 'https://adobe.com',
    };

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    sqs = {
      sendMessage: sandbox.stub().resolves({}),
    };

    env = {
      QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
    };

    dataAccess = {
      Site: {
        findById: sandbox.stub(),
      },
    };

    context = {
      log,
      sqs,
      env,
      site,
      audit,
      dataAccess,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runFaqsAudit', () => {
    it('should return audit result with grouped prompts when spreadsheet is read successfully', async () => {
      // Mock Excel file structure
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 5,
            getRows: (start, count) => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'photoshop' }; // Topic
                  if (col === 3) return { value: 'How to use Photoshop?' }; // Prompt
                  if (col === 7) return { value: 'https://adobe.com/photoshop' }; // URL
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'illustrator' }; // Topic
                  if (col === 3) return { value: 'What is Illustrator?' }; // Prompt
                  if (col === 7) return { value: 'https://adobe.com/illustrator' }; // URL
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'photoshop' }; // Topic
                  if (col === 3) return { value: 'Photoshop tutorials?' }; // Prompt
                  if (col === 7) return { value: 'https://adobe.com/photoshop' }; // URL
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

      // Mock ExcelJS
      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(true);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(2);
      expect(result.fullAuditRef).to.equal('https://adobe.com');
    });

    it('should return failure when Content AI configuration does not exist', async () => {
      validateContentAIStub.resolves({
        uid: null,
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      });

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.error).to.equal('Content AI configuration not found');
      expect(log.warn).to.have.been.calledWith('[FAQ] Content AI configuration does not exist for this site, skipping audit');
    });

    it('should return failure when Content AI search endpoint is not working', async () => {
      validateContentAIStub.resolves({
        uid: 'test-uid-123',
        indexName: 'test-index',
        genSearchEnabled: true,
        isWorking: false,
      });

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.error).to.equal('Content AI search endpoint validation failed');
      expect(log.warn).to.have.been.calledWith('[FAQ] Content AI search endpoint is not working for index test-index, skipping audit');
    });

    it('should return failure when Content AI generative search is not enabled', async () => {
      validateContentAIStub.resolves({
        uid: 'test-uid-123',
        indexName: 'test-index',
        genSearchEnabled: false,
        isWorking: true,
      });

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.error).to.equal('Content AI generative search not enabled');
      expect(log.warn).to.have.been.calledWith('[FAQ] Content AI generative search not enabled for index test-index, skipping audit');
    });

    it('should return failure when no prompts are found', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 1,
            getRows: () => [],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(0);
      expect(log.warn).to.have.been.calledWith('[FAQ] No prompts found in brand presence spreadsheet from the last 4 weeks');
    });

    it('should handle file not found errors gracefully (expected when trying multiple weeks)', async () => {
      readFromSharePointStub.rejects(new Error('The resource could not be found.'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(0);
      // File not found should log as INFO (not ERROR) since it's expected when trying multiple weeks
      expect(log.info).to.have.been.calledWith(sinon.match(/Brand presence file not found/));
      expect(log.warn).to.have.been.calledWith('[FAQ] No prompts found in brand presence spreadsheet from the last 4 weeks');
    });

    it('should handle unexpected spreadsheet read errors and log as ERROR', async () => {
      readFromSharePointStub.rejects(new Error('SharePoint connection failed'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(0);
      // Unexpected errors should log as ERROR
      expect(log.error).to.have.been.calledWith(sinon.match(/Failed to read brand presence spreadsheet.*SharePoint connection failed/));
      expect(log.warn).to.have.been.calledWith('[FAQ] No prompts found in brand presence spreadsheet from the last 4 weeks');
    });

    it('should retry multiple weeks and succeed when data is found in a later week', async () => {
      // Mock date to ensure consistent week calculations (Nov 18, 2025 = week 47)
      // This will make the test look for weeks: w47, w46, w45, w44
      const clock = sandbox.useFakeTimers(new Date('2025-11-18T10:00:00Z'));

      // getWeekRangeStub will be called with offsets -1, -2, -3, -4
      // The stub will return different weeks for each offset

      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 2,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'test-topic' };
                  if (col === 3) return { value: 'test question' };
                  if (col === 7) return { value: 'https://adobe.com/test' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      // First two weeks: file not found, third week: success
      readFromSharePointStub.onCall(0).rejects(new Error('The resource could not be found.'));
      readFromSharePointStub.onCall(1).rejects(new Error('The resource could not be found.'));
      readFromSharePointStub.onCall(2).resolves(Buffer.from('mock-buffer'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(true);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(1);
      // Should have tried 3 times (2 failures + 1 success)
      expect(readFromSharePointStub).to.have.been.calledThrice;
      // Should log that it found data for w45-2025 (the third week)
      expect(log.info).to.have.been.calledWith(sinon.match(/Successfully found brand presence data for w45-2025/));

      clock.restore();
    });

    it('should use custom output location when getOutputLocation is provided', async () => {
      const customOutputLocation = '/custom/output';
      context.getOutputLocation = sandbox.stub().returns(customOutputLocation);

      readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 2,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'test' };
                  if (col === 3) return { value: 'test question' };
                  if (col === 7) return { value: '' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      await runner('https://adobe.com', context, site);

      expect(context.getOutputLocation).to.have.been.calledWith(site);
    });

    it('should handle worksheet with no data', async () => {
      const mockWorkbook = {
        worksheets: [],
      };

      readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(log.warn).to.have.been.called;
    });

    it('should handle worksheet.getRows returning null', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 5,
            getRows: () => null, // getRows returns null
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(0);
      expect(log.warn).to.have.been.calledWith('[FAQ] No prompts found in brand presence spreadsheet from the last 4 weeks');
    });

    it('should handle general errors during audit execution', async () => {
      createLLMOSharepointClientStub.rejects(new Error('Failed to create SharePoint client'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.equal(false);
      expect(result.auditResult.promptsByUrl).to.be.an('array').with.lengthOf(0);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/\[FAQ\] Audit failed.*Failed to create SharePoint client/),
      );
    });

    it('should deduplicate prompts with same question (case-insensitive)', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 4,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'Photoshop' };
                  if (col === 3) return { value: 'How to use layers?' };
                  if (col === 7) return { value: 'https://adobe.com/page1' };
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'Illustrator' };
                  if (col === 3) return { value: 'how to use layers?' };
                  if (col === 7) return { value: '' };
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'InDesign' };
                  if (col === 3) return { value: 'What is typography?' };
                  if (col === 7) return { value: 'https://adobe.com/page2' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock data'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.promptsByUrl).to.be.an('array');
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Deduplicated 3 prompts to 2 unique prompts/),
      );
    });

    it('should prioritize prompt with URL when deduplicating', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 3,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'Topic1' };
                  if (col === 3) return { value: 'How do I get started?' };
                  if (col === 7) return { value: '' };
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'Topic2' };
                  if (col === 3) return { value: 'How do I get started?' };
                  if (col === 7) return { value: 'https://adobe.com/starter-guide' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock data'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.promptsByUrl).to.have.lengthOf(1);
      expect(result.auditResult.promptsByUrl[0].topic).to.equal('Topic2');
      expect(result.auditResult.promptsByUrl[0].prompts).to.have.lengthOf(1);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Deduplicated 2 prompts to 1 unique prompts/),
      );
    });

    it('should keep first occurrence when both duplicates have URLs', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 3,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'FirstTopic' };
                  if (col === 3) return { value: 'What is the price?' };
                  if (col === 7) return { value: 'https://adobe.com/first' };
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'SecondTopic' };
                  if (col === 3) return { value: 'What is the price?' };
                  if (col === 7) return { value: 'https://adobe.com/second' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock data'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.promptsByUrl).to.have.lengthOf(1);
      expect(result.auditResult.promptsByUrl[0].topic).to.equal('FirstTopic');
      expect(result.auditResult.promptsByUrl[0].prompts).to.have.lengthOf(1);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Deduplicated 2 prompts to 1 unique prompts/),
      );
    });

    it('should keep first occurrence when neither duplicate has URL', async () => {
      const mockWorkbook = {
        worksheets: [
          {
            rowCount: 3,
            getRows: () => [
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'FirstTopic' };
                  if (col === 3) return { value: 'How to export?' };
                  if (col === 7) return { value: '' };
                  return { value: '' };
                },
              },
              {
                getCell: (col) => {
                  if (col === 2) return { value: 'SecondTopic' };
                  if (col === 3) return { value: 'How to export?' };
                  if (col === 7) return { value: '' };
                  return { value: '' };
                },
              },
            ],
          },
        ],
      };

      readFromSharePointStub.resolves(Buffer.from('mock data'));

      const excelJsMock = await esmock('../../../src/faqs/handler.js', {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createLLMOSharepointClientStub,
          readFromSharePoint: readFromSharePointStub,
        },
        '../../../src/faqs/utils.js': {
          validateContentAI: validateContentAIStub,
        },
        exceljs: {
          Workbook: class {
            constructor() {}

            get xlsx() {
              const self = this;
              return {
                load: async () => {
                  Object.assign(self, mockWorkbook);
                },
              };
            }
          },
        },
      });

      const runner = excelJsMock.default.runner;
      const result = await runner('https://adobe.com', context, site);

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.promptsByUrl).to.have.lengthOf(1);
      expect(result.auditResult.promptsByUrl[0].topic).to.equal('FirstTopic');
      expect(result.auditResult.promptsByUrl[0].prompts).to.have.lengthOf(1);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Deduplicated 2 prompts to 1 unique prompts/),
      );
    });
  });

  describe('sendMystiqueMessagePostProcessor', () => {
    let auditData;

    beforeEach(() => {
      auditData = {
        siteId: 'site-123',
        auditResult: {
          success: true,
          promptsByUrl: [
            {
              url: 'https://adobe.com/photoshop',
              topic: 'photoshop',
              prompts: ['How to use Photoshop?', 'Photoshop tutorials?'],
            },
            {
              url: 'https://adobe.com/illustrator',
              topic: 'illustrator',
              prompts: ['What is Illustrator?'],
            },
          ],
        },
      };

      dataAccess.Site.findById.resolves(site);
    });

    it('should send message to Mystique when audit is successful', async () => {
      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage).to.have.been.calledOnce;

      const call = sqs.sendMessage.getCall(0);
      expect(call.args[0]).to.equal('spacecat-to-mystique');

      const message = call.args[1];
      expect(message.type).to.equal('guidance:faqs');
      expect(message.siteId).to.equal('site-123');
      expect(message.url).to.equal('https://adobe.com');
      expect(message.auditId).to.equal('audit-456');
      expect(message.deliveryType).to.equal('aem');
      expect(message.data.faqs).to.deep.equal(auditData.auditResult.promptsByUrl);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/Queued 2 FAQ groups to Mystique/),
      );
    });

    it('should skip Mystique message when audit failed', async () => {
      auditData.auditResult.success = false;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage).not.to.have.been.called;
      expect(log.info).to.have.been.calledWith('[FAQ] Audit failed, skipping Mystique message');
    });

    it('should skip Mystique message when no grouped prompts', async () => {
      auditData.auditResult.promptsByUrl = [];

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage).not.to.have.been.called;
      expect(log.info).to.have.been.calledWith('[FAQ] No grouped prompts by URL found, skipping Mystique message');
    });

    it('should skip Mystique message when SQS is not configured', async () => {
      context.sqs = null;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(log.warn).to.have.been.calledWith('[FAQ] SQS or Mystique queue not configured, skipping message');
    });

    it('should skip Mystique message when queue name is not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(log.warn).to.have.been.calledWith('[FAQ] SQS or Mystique queue not configured, skipping message');
    });

    it('should skip Mystique message when site is not found', async () => {
      dataAccess.Site.findById.resolves(null);

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage).not.to.have.been.called;
      expect(log.warn).to.have.been.calledWith('[FAQ] Site not found, skipping Mystique message');
    });

    it('should handle SQS send errors gracefully', async () => {
      sqs.sendMessage.rejects(new Error('SQS connection failed'));

      const result = await sendMystiqueMessagePostProcessor(
        'https://adobe.com',
        auditData,
        context,
      );

      expect(result).to.deep.equal(auditData);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to send Mystique message.*SQS connection failed/),
      );
    });
  });
});

