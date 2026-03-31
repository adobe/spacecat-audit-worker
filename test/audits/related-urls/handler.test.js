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

use(sinonChai);

describe('Related URLs Handler', () => {
  let sandbox;
  let site;
  let log;
  let context;
  let readFromSharePointStub;
  let createLLMOSharepointClientStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    readFromSharePointStub = sandbox.stub();
    createLLMOSharepointClientStub = sandbox.stub().resolves({ client: 'mock' });

    site = {
      getBaseURL: () => 'https://example.com',
      getId: () => 'site-123',
      getDeliveryType: () => 'aem',
      getConfig: () => ({
        getLlmoDataFolder: () => '/data/llmo',
      }),
    };

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    context = {
      log,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url',
      },
      sqs: {
        sendMessage: sandbox.stub().resolves({}),
      },
      audit: {
        getId: () => 'audit-456',
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(site),
        },
      },
      site,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('prioritizes prompts without URL and returns promptRegions', async () => {
    const rows = [
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Same question?' };
          if (col === 5) return { value: 'AU' };
          if (col === 7) return { value: 'https://example.com/a' };
          return { value: '' };
        },
      },
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Same question?' };
          if (col === 5) return { value: 'BR' };
          if (col === 7) return { value: '' };
          return { value: '' };
        },
      },
    ];

    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          constructor() {}

          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return {
              load: async () => {},
            };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(true);
    expect(result.auditResult.promptRegions).to.have.lengthOf(2);
    expect(result.auditResult.promptRegions[0]).to.deep.equal({
      prompt: 'Same question?',
      region: 'BR',
    });
    expect(result.auditResult.promptRegions[1]).to.deep.equal({
      prompt: 'Same question?',
      region: 'AU',
    });
    expect(result.auditResult.fanoutCount).to.equal(4);
  });

  it('returns failure when no brand presence data found', async () => {
    readFromSharePointStub.rejects(new Error('itemNotFound'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(false);
    expect(result.auditResult.promptRegions).to.deep.equal([]);
  });

  it('sends promptRegions to Mystique post-processor', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        baseURL: 'https://example.com',
        fanoutCount: 4,
        promptRegions: [{
          prompt: 'Question 1',
          region: 'AU',
        }],
      },
    };

    await postProcessor('https://example.com', auditData, context);

    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.type).to.equal('guidance:related-urls');
    expect(message.traceId).to.be.a('string');
    expect(message.data.baseURL).to.equal('https://example.com');
    expect(message.data.fanoutCount).to.equal(4);
    expect(message.data.promptRegions).to.have.lengthOf(1);
  });

  it('returns empty prompts when worksheet is missing', async () => {
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          constructor() {}

          get worksheets() {
            return [];
          }

          get xlsx() {
            return {
              load: async () => {},
            };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(false);
    expect(result.auditResult.promptRegions).to.deep.equal([]);
  });

  it('returns failure when sharepoint read throws non-notfound error', async () => {
    readFromSharePointStub.rejects(new Error('sharepoint outage'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(false);
    expect(result.auditResult.promptRegions).to.deep.equal([]);
    expect(log.error).to.have.been.called;
  });

  it('skips Mystique message when audit result has no promptRegions', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        promptRegions: [],
      },
    };

    const result = await postProcessor('https://example.com', auditData, context);

    expect(result).to.equal(auditData);
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('skips Mystique message when site lookup fails in post-processor', async () => {
    context.dataAccess.Site.findById = sandbox.stub().resolves(null);
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        promptRegions: [{ prompt: 'Question 1', region: 'AU' }],
      },
    };

    const result = await postProcessor('https://example.com', auditData, context);

    expect(result).to.equal(auditData);
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(log.warn).to.have.been.called;
  });

  it('handles sqs send errors in post-processor', async () => {
    context.sqs.sendMessage.rejects(new Error('sqs send failed'));
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        promptRegions: [{ prompt: 'Question 1', region: 'AU' }],
      },
    };

    const result = await postProcessor('https://example.com', auditData, context);

    expect(result).to.equal(auditData);
    expect(log.error).to.have.been.called;
  });

  it('keeps prompt order when both items have URL presence parity', async () => {
    const rows = [
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Prompt A' };
          if (col === 5) return { value: 'US' };
          if (col === 7) return { value: '' };
          return { value: '' };
        },
      },
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Prompt B' };
          if (col === 5) return { value: 'US' };
          if (col === 7) return { value: '' };
          return { value: '' };
        },
      },
    ];

    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));
    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          constructor() {}

          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return {
              load: async () => {},
            };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.promptRegions[0]).to.deep.equal({ prompt: 'Prompt A', region: 'US' });
    expect(result.auditResult.promptRegions[1]).to.deep.equal({ prompt: 'Prompt B', region: 'US' });
  });

  it('sorts prompts when first row has URL and second does not', async () => {
    const rows = [
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Prompt With URL' };
          if (col === 5) return { value: 'US' };
          if (col === 7) return { value: 'https://example.com/with-url' };
          return { value: '' };
        },
      },
      {
        getCell: (col) => {
          if (col === 3) return { value: 'Prompt Without URL' };
          if (col === 5) return { value: 'US' };
          if (col === 7) return { value: '' };
          return { value: '' };
        },
      },
    ];
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return { load: async () => {} };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);

    expect(result.auditResult.promptRegions[0]).to.deep.equal({
      prompt: 'Prompt Without URL',
      region: 'US',
    });
    expect(result.auditResult.promptRegions[1]).to.deep.equal({
      prompt: 'Prompt With URL',
      region: 'US',
    });
  });

  it('returns failure when top-level runner throws unexpectedly', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().rejects(new Error('auth failed')),
        readFromSharePoint: readFromSharePointStub,
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(false);
    expect(result.auditResult.promptRegions).to.deep.equal([]);
    expect(log.error).to.have.been.called;
  });

  it('skips Mystique message when audit result indicates failure', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: false,
        promptRegions: [{ prompt: 'Question 1', region: 'AU' }],
      },
    };

    const result = await postProcessor('https://example.com', auditData, context);

    expect(result).to.equal(auditData);
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('skips Mystique message when sqs config is missing', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        promptRegions: [{ prompt: 'Question 1', region: 'AU' }],
      },
    };

    const contextWithoutSqs = {
      ...context,
      sqs: null,
    };

    const result = await postProcessor('https://example.com', auditData, contextWithoutSqs);

    expect(result).to.equal(auditData);
    expect(log.warn).to.have.been.called;
  });

  it('uses custom output location when provided in context', async () => {
    const rows = [{
      getCell: (col) => {
        if (col === 3) return { value: 'Prompt A' };
        if (col === 5) return { value: 'US' };
        if (col === 7) return { value: '' };
        return { value: '' };
      },
    }];
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));
    context.getOutputLocation = sandbox.stub().returns('/custom/location');

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return { load: async () => {} };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);

    expect(result.auditResult.success).to.equal(true);
    expect(context.getOutputLocation).to.have.been.calledOnce;
    const outputLocationArg = readFromSharePointStub.getCall(0).args[1];
    expect(outputLocationArg).to.equal('/custom/location');
  });

  it('falls back to GLOBAL region when spreadsheet row has empty region', async () => {
    const rows = [{
      getCell: (col) => {
        if (col === 3) return { value: 'Prompt A' };
        if (col === 5) return { value: null };
        if (col === 7) return { value: '' };
        return { value: '' };
      },
    }];
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return { load: async () => {} };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.promptRegions[0].region).to.equal('GLOBAL');
  });

  it('handles worksheet rows fallback when getRows returns undefined', async () => {
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          get worksheets() {
            return [{
              rowCount: 2,
              getRows: () => undefined,
            }];
          }

          get xlsx() {
            return { load: async () => {} };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(false);
    expect(result.auditResult.promptRegions).to.deep.equal([]);
  });

  it('uses fallback auditId format when context.audit is missing', async () => {
    const mockedModule = await esmock('../../../src/related-urls/handler.js');
    const postProcessor = mockedModule.default.postProcessors[0];

    const auditData = {
      siteId: 'site-123',
      auditResult: {
        success: true,
        promptRegions: [{ prompt: 'Question 1', region: 'AU' }],
      },
    };

    const contextWithoutAudit = {
      ...context,
      audit: undefined,
    };

    await postProcessor('https://example.com', auditData, contextWithoutAudit);
    const [, message] = context.sqs.sendMessage.getCall(0).args;
    expect(message.auditId).to.match(/^test-audit-related-urls-\d{8}T\d{6}$/);
  });

  it('forces comparator path where a has URL and b does not', async () => {
    const rows = [{
      getCell: (col) => {
        if (col === 3) return { value: 'Prompt A' };
        if (col === 5) return { value: 'US' };
        if (col === 7) return { value: '' };
        return { value: '' };
      },
    }];
    readFromSharePointStub.resolves(Buffer.from('mock-buffer'));

    const originalSort = Array.prototype.sort;
    const sortStub = sandbox.stub(Array.prototype, 'sort').callsFake(function forceComparator(comparator) {
      if (typeof comparator === 'function') {
        comparator({ url: 'https://example.com/with-url' }, { url: '' });
        return originalSort.call(this, comparator);
      }
      return originalSort.call(this);
    });

    const mockedModule = await esmock('../../../src/related-urls/handler.js', {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        readFromSharePoint: readFromSharePointStub,
      },
      exceljs: {
        Workbook: class {
          get worksheets() {
            return [{
              rowCount: rows.length + 1,
              getRows: () => rows,
            }];
          }

          get xlsx() {
            return { load: async () => {} };
          }
        },
      },
    });

    const result = await mockedModule.default.runner('https://example.com', context, site);
    expect(result.auditResult.success).to.equal(true);
    expect(sortStub).to.have.been.called;
  });

});
