/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/* eslint-env mocha */

import { expect } from 'chai';
import sinon from 'sinon';
import { syncAgenticTrafficToDb } from '../../../src/cdn-logs-report/utils/agentic-traffic-db-sync.js';

describe('Agentic traffic DB sync', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function createContext(overrides = {}) {
    return {
      env: {
        AGENTIC_API_BASE_ENDPOINT: 'http://127.0.0.1:3000',
      },
      ...overrides,
    };
  }

  it('deletes existing data once, then inserts in chunks', async () => {
    const fetchStub = sandbox.stub(global, 'fetch');
    fetchStub.onCall(0).resolves({
      ok: true,
      json: async () => [{ id: '1' }],
    });
    fetchStub.onCall(1).resolves({
      ok: true,
      text: async () => '',
    });
    fetchStub.onCall(2).resolves({
      ok: true,
      text: async () => '',
    });
    fetchStub.onCall(3).resolves({
      ok: true,
      text: async () => '',
    });

    const rows = Array.from({ length: 5 }).map((_, i) => ({
      site_id: 'site-1',
      traffic_date: '2026-01-11',
      url_path: `/p-${i}`,
      hits: 1,
    }));

    const result = await syncAgenticTrafficToDb({
      context: createContext(),
      auditContext: { agenticTrafficChunkSize: 3 },
      siteId: 'site-1',
      trafficDate: '2026-01-11',
      rows,
    });

    expect(result).to.deep.equal({
      source: 'db-endpoints',
      existingRows: 1,
      deletedExisting: true,
      insertedRows: 5,
      chunkSize: 3,
      chunkCount: 2,
    });
    sinon.assert.callCount(fetchStub, 4);
    expect(fetchStub.getCall(0).args[1].method).to.equal('GET');
    expect(fetchStub.getCall(1).args[1].method).to.equal('DELETE');
    expect(fetchStub.getCall(2).args[1].method).to.equal('POST');
    expect(fetchStub.getCall(3).args[1].method).to.equal('POST');
  });

  it('skips delete when no existing data found', async () => {
    const fetchStub = sandbox.stub(global, 'fetch');
    fetchStub.onCall(0).resolves({
      ok: true,
      json: async () => [],
    });
    fetchStub.onCall(1).resolves({
      ok: true,
      text: async () => '',
    });

    const result = await syncAgenticTrafficToDb({
      context: createContext(),
      auditContext: { agenticTrafficChunkSize: 10 },
      siteId: 'site-1',
      trafficDate: '2026-01-11',
      rows: [{ site_id: 'site-1', traffic_date: '2026-01-11', hits: 1 }],
    });

    expect(result.deletedExisting).to.equal(false);
    sinon.assert.callCount(fetchStub, 2);
    expect(fetchStub.getCall(1).args[1].method).to.equal('POST');
  });

  it('throws when base endpoint is missing', async () => {
    try {
      await syncAgenticTrafficToDb({
        context: { env: {} },
        siteId: 'site-1',
        trafficDate: '2026-01-11',
        rows: [],
      });
      expect.fail('Expected missing endpoint error');
    } catch (error) {
      expect(error.message).to.equal('Missing AGENTIC_API_BASE_ENDPOINT');
    }
  });
});
