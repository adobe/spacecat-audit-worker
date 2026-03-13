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

function createWorksheet(rows) {
  const headerValues = [
    undefined,
    'Category',
    'Topics',
    'Prompt',
    'Origin',
    'Region',
    'Volume',
    'URL',
    'Answer',
    'Sources',
  ];

  const worksheet = {
    rowCount: rows.length + 1,
    columnCount: headerValues.length - 1,
    getRow: sinon.stub(),
    getRows: sinon.stub(),
    getCell: sinon.stub(),
  };

  worksheet.getRow.withArgs(1).returns({ values: headerValues });
  worksheet.getRows.withArgs(2, rows.length).returns(rows);
  worksheet.getCell.callsFake((row, col) => {
    if (row !== 1) {
      throw new Error(`Unexpected getCell call for row ${row}`);
    }
    return {
      get value() {
        return headerValues[col];
      },
      set value(next) {
        headerValues[col] = next;
      },
    };
  });

  return { worksheet, headerValues };
}

function createDataRow(prompt, region) {
  const cells = new Map();
  cells.set(3, { value: prompt });
  cells.set(5, { value: region });
  return {
    getCell: (col) => {
      if (!cells.has(col)) {
        cells.set(col, { value: null });
      }
      return cells.get(col);
    },
  };
}

describe('Related URLs Guidance Handler', function testSuite() {
  this.timeout(10000);
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function loadHandler({
    fetchResponse,
    fetchReject,
    site = {
      getConfig: () => ({ getLlmoDataFolder: () => 'dev/lovesac-com' }),
      getBaseURL: () => 'https://www.lovesac.com',
    },
    workbook,
    readFromSharePointResult = Buffer.from('sheet'),
    readFromSharePointError = null,
    writeBufferError = null,
  } = {}) {
    const badRequest = sandbox.stub().callsFake((msg) => ({ status: 'badRequest', msg }));
    const noContent = sandbox.stub().callsFake(() => ({ status: 'noContent' }));
    const notFound = sandbox.stub().callsFake((msg) => ({ status: 'notFound', msg }));
    const ok = sandbox.stub().callsFake(() => ({ status: 'ok' }));

    const tracingFetch = fetchReject
      ? sandbox.stub().rejects(fetchReject)
      : sandbox.stub().resolves(fetchResponse || {
        ok: true,
        json: async () => ({ prompts: [] }),
      });

    const readFromSharePoint = readFromSharePointError
      ? sandbox.stub().rejects(readFromSharePointError)
      : sandbox.stub().resolves(readFromSharePointResult);
    const uploadToSharePoint = sandbox.stub().resolves();
    const publishToAdminHlx = sandbox.stub().resolves();
    const createLLMOSharepointClient = sandbox.stub().resolves({ client: true });

    const resolvedWorkbook = workbook || {
      worksheets: [],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: writeBufferError
          ? sandbox.stub().rejects(writeBufferError)
          : sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };

    const module = await esmock('../../../src/related-urls/guidance-handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        badRequest,
        noContent,
        notFound,
        ok,
      },
      '@adobe/spacecat-shared-utils': {
        tracingFetch,
      },
      '../../../src/utils/date-utils.js': {
        getPreviousWeekTriples: sandbox.stub().returns([{ year: 2026, week: 9 }]),
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient,
        readFromSharePoint,
        uploadToSharePoint,
        publishToAdminHlx,
      },
      exceljs: {
        Workbook: class {
          constructor() {
            return resolvedWorkbook;
          }
        },
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(site),
        },
      },
    };

    return {
      handler: module.default,
      context,
      stubs: {
        badRequest,
        noContent,
        notFound,
        ok,
        tracingFetch,
        readFromSharePoint,
        uploadToSharePoint,
        publishToAdminHlx,
        createLLMOSharepointClient,
      },
    };
  }

  it('returns badRequest when presignedUrl is missing', async () => {
    const { handler, context } = await loadHandler();

    const result = await handler({
      siteId: 'site-1',
      data: {},
    }, context);

    expect(result.status).to.equal('badRequest');
    expect(result.msg).to.equal('Presigned URL is required');
  });

  it('writes top 5 HTML URLs to new "Related URLs" column', async () => {
    const rows = [
      createDataRow('Popular AI art creation tools', 'US'),
      createDataRow('Other prompt', 'US'),
    ];
    const { worksheet, headerValues } = createWorksheet(rows);

    const workbook = {
      worksheets: [worksheet],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };

    const fetchResponse = {
      ok: true,
      json: async () => ({
        prompts: [{
          prompt: 'Popular AI art creation tools',
          input_region: 'US',
          related_urls: [
            { url: 'https://www.adobe.com/products/firefly' },
            { url: 'https://www.adobe.com/products/firefly/' },
            { url: 'https://www.adobe.com/products/firefly/features/ai-art-generator.html' },
            { url: 'ftp://www.adobe.com/skip-me' },
            { url: 'not-a-url' },
            { url: 'https://www.adobe.com/file.pdf' },
            { url: 'https://www.adobe.com/image.png' },
            { url: 'https://www.adobe.com/products/photoshop' },
            { url: 'https://www.adobe.com/products/illustrator' },
          ],
        }],
      }),
    };

    const { handler, context, stubs } = await loadHandler({ workbook, fetchResponse });
    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('ok');
    expect(stubs.readFromSharePoint).to.have.been.calledOnce;
    expect(stubs.uploadToSharePoint).to.have.been.calledOnce;
    expect(stubs.publishToAdminHlx).to.have.been.calledOnce;

    const relatedUrlsCol = headerValues.findIndex((v) => v === 'Related URLs');
    expect(relatedUrlsCol).to.be.greaterThan(0);
    expect(rows[0].getCell(relatedUrlsCol).value).to.equal(
      'https://www.adobe.com/products/firefly; https://www.adobe.com/products/firefly/; https://www.adobe.com/products/firefly/features/ai-art-generator.html; https://www.adobe.com/products/photoshop; https://www.adobe.com/products/illustrator',
    );
    expect(rows[1].getCell(relatedUrlsCol).value).to.equal(null);
  });

  it('updates existing "Related URLs" column when already present', async () => {
    const rows = [createDataRow('Prompt 1', 'GLOBAL')];
    const { worksheet, headerValues } = createWorksheet(rows);
    headerValues.push('Related URLs');

    const workbook = {
      worksheets: [worksheet],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };

    const { handler, context } = await loadHandler({
      workbook,
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            region: 'GLOBAL',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('ok');
    expect(rows[0].getCell(headerValues.length - 1).value).to.equal('https://example.com/page');
  });

  it('returns notFound when site does not exist', async () => {
    const { handler, context } = await loadHandler({ site: null });

    const result = await handler({
      siteId: 'missing-site',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('notFound');
    expect(result.msg).to.equal('Site not found');
  });

  it('returns badRequest when presigned URL fetch fails with non-200', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('badRequest');
    expect(result.msg).to.equal('Failed to fetch related-urls data: Internal Server Error');
  });

  it('returns noContent when payload has no prompts', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: true,
        json: async () => ({ prompts: [] }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('noContent');
  });

  it('returns noContent when prompts have no related URLs', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [],
          }],
        }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('noContent');
  });

  it('returns notFound when no weekly workbook is found', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
      readFromSharePointError: new Error('itemNotFound'),
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('notFound');
  });

  it('returns noContent when worksheet is missing or no rows are updated', async () => {
    const workbook = {
      worksheets: [],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };
    const { handler, context } = await loadHandler({
      workbook,
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('noContent');
  });

  it('returns badRequest when workbook update/upload path throws', async () => {
    const rows = [createDataRow('Prompt 1', 'US'), createDataRow(null, 'US')];
    const { worksheet } = createWorksheet(rows);
    const workbook = {
      worksheets: [worksheet],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().rejects(new Error('write failed')),
      },
    };

    const { handler, context } = await loadHandler({
      workbook,
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('badRequest');
    expect(result.msg).to.equal('Failed to update brand presence sheet');
  });

  it('returns badRequest when fetch throws unexpectedly', async () => {
    const { handler, context } = await loadHandler({
      fetchReject: new Error('network failed'),
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('badRequest');
    expect(result.msg).to.contain('Error processing related-urls guidance');
  });

  it('logs sharepoint read errors and returns notFound after trying candidates', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
      readFromSharePointError: new Error('sharepoint temporary failure'),
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('notFound');
    expect(context.log.error).to.have.been.called;
  });

  it('handles missing data field and returns badRequest', async () => {
    const { handler, context } = await loadHandler();

    const result = await handler({
      siteId: 'site-1',
    }, context);

    expect(result.status).to.equal('badRequest');
    expect(result.msg).to.equal('Presigned URL is required');
  });

  it('uses getOutputLocation and GLOBAL region fallback when input region is missing', async () => {
    const rows = [createDataRow('Prompt 1', null)];
    const { worksheet, headerValues } = createWorksheet(rows);
    const workbook = {
      worksheets: [worksheet],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };

    const { handler, context } = await loadHandler({
      workbook,
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [
            {
              prompt: 'Prompt 1',
              // no input_region or region => GLOBAL fallback
              queries: 'not-array',
              related_urls: [{ url: 'https://example.com/global-page' }],
            },
            {
              prompt: 'Prompt 2',
              input_region: 'US',
              related_urls: 'invalid-non-array',
            },
          ],
        }),
      },
    });
    context.getOutputLocation = sandbox.stub().returns('/custom/location');

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('ok');
    expect(context.getOutputLocation).to.have.been.calledOnce;
    const relatedUrlsCol = headerValues.findIndex((v) => v === 'Related URLs');
    expect(rows[0].getCell(relatedUrlsCol).value).to.equal('https://example.com/global-page');
  });

  it('handles query arrays and URL pathname fallback branch', async () => {
    const originalURL = global.URL;
    global.URL = class MockURL {
      constructor() {
        return {
          protocol: 'https:',
          pathname: '',
        };
      }
    };

    try {
      const rows = [createDataRow('Prompt 1', 'GLOBAL')];
      const { worksheet, headerValues } = createWorksheet(rows);
      const workbook = {
        worksheets: [worksheet],
        xlsx: {
          load: sandbox.stub().resolves(),
          writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
        },
      };

      const { handler, context } = await loadHandler({
        workbook,
        fetchResponse: {
          ok: true,
          json: async () => ({
            prompts: [{
              prompt: 'Prompt 1',
              region: 'GLOBAL',
              queries: ['q1', 'q2'],
              related_urls: [{ url: 'https://example.com/anything' }],
            }],
          }),
        },
      });

      const result = await handler({
        siteId: 'site-1',
        data: { presignedUrl: 'https://example.com/file.json' },
      }, context);

      expect(result.status).to.equal('ok');
      const relatedUrlsCol = headerValues.findIndex((v) => v === 'Related URLs');
      expect(rows[0].getCell(relatedUrlsCol).value).to.equal('https://example.com/anything');
    } finally {
      global.URL = originalURL;
    }
  });

  it('returns noContent when payload.prompts is not an array', async () => {
    const { handler, context } = await loadHandler({
      fetchResponse: {
        ok: true,
        json: async () => ({ prompts: 'invalid' }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('noContent');
  });

  it('handles worksheet rows/header fallback values', async () => {
    const worksheet = {
      rowCount: 2,
      columnCount: 10,
      getRows: sandbox.stub().returns(undefined),
      getRow: sandbox.stub().returns({ values: undefined }),
      getCell: sandbox.stub().returns({ value: null }),
    };
    const workbook = {
      worksheets: [worksheet],
      xlsx: {
        load: sandbox.stub().resolves(),
        writeBuffer: sandbox.stub().resolves(Buffer.from('xlsx')),
      },
    };

    const { handler, context } = await loadHandler({
      workbook,
      fetchResponse: {
        ok: true,
        json: async () => ({
          prompts: [{
            prompt: 'Prompt 1',
            input_region: 'US',
            related_urls: [{ url: 'https://example.com/page' }],
          }],
        }),
      },
    });

    const result = await handler({
      siteId: 'site-1',
      data: { presignedUrl: 'https://example.com/file.json' },
    }, context);

    expect(result.status).to.equal('noContent');
  });
});
