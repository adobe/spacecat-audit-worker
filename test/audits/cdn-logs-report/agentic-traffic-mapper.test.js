/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

/* eslint-env mocha */

import { expect } from 'chai';
import sinon from 'sinon';
import { mapToAgenticTrafficRows } from '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js';

describe('Agentic Traffic Mapper', () => {
  let sandbox;
  let site;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    site = {
      getId: () => 'site-123',
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({
        getFetchConfig: () => ({}),
      }),
    };

    context = {
      log: {
        warn: sandbox.stub(),
      },
      dataAccess: {
        PageCitability: {
          allBySiteId: sandbox.stub().resolves([]),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('maps rows to agentic_traffic schema', async () => {
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'ChatGPT',
      status: 200,
      number_of_hits: 12,
      avg_ttfb_ms: 98.1,
      country_code: 'US',
      url: '/products/item',
      host: 'www.a.com',
      cdn_provider: 'fastly',
      category: 'Product Page',
      product: 'analytics',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0]).to.deep.equal({
      site_id: 'site-123',
      traffic_date: '2026-02-11',
      host: 'www.a.com',
      platform: 'chatgpt',
      agent_type: 'Bot',
      user_agent: 'ChatGPT',
      http_status: 200,
      region: 'US',
      url_path: '/products/item',
      page_type: 'Product Page',
      category_id: null,
      category_name: 'Analytics',
      content_type: 'HTML',
      hits: 12,
      avg_ttfb_ms: 98.1,
      dimensions: {},
      metrics: {},
      updated_by: 'system',
    });
  });

  it('maps url dash to root and filters out non-positive hits', async () => {
    const rows = [
      {
        agent_type: 'Bot',
        user_agent_display: 'UA',
        status: 200,
        number_of_hits: 0,
        country_code: 'US',
        url: '/skip',
      },
      {
        agent_type: 'Bot',
        user_agent_display: 'UA',
        status: 200,
        number_of_hits: 2,
        country_code: 'US',
        url: '-',
      },
    ];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0].url_path).to.equal('/');
    expect(mapped[0].hits).to.equal(2);
  });

  it('uses GLOBAL for invalid country and null category_id always', async () => {
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'UA',
      status: 200,
      number_of_hits: 2,
      country_code: 'INVALID',
      url: '/x',
      category: 'Other',
      product: 'unknown',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0].region).to.equal('GLOBAL');
    expect(mapped[0].category_id).to.equal(null);
  });

  it('adds citability dimensions when available', async () => {
    context.dataAccess.PageCitability.allBySiteId.resolves([
      {
        getUrl: () => 'https://example.com/a',
        getUpdatedAt: () => '2026-02-11T10:00:00Z',
        getCitabilityScore: () => 87,
        getIsDeployedAtEdge: () => true,
      },
    ]);

    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'UA',
      status: 200,
      number_of_hits: 2,
      country_code: 'US',
      url: '/a',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0].dimensions).to.deep.equal({
      citability_score: 87,
      deployed_at_edge: true,
    });
  });

  it('infers content_type from file extension', async () => {
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'GPTBot',
      status: 200,
      number_of_hits: 1,
      country_code: 'US',
      url: '/files/manual.pdf',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0].platform).to.equal('chatgpt');
    expect(mapped[0].content_type).to.equal('PDF');
  });

  it('returns OTHER content_type for unsupported file extension', async () => {
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'Claude-User',
      status: 200,
      number_of_hits: 1,
      country_code: 'US',
      url: '/files/archive.bin',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(mapped[0].platform).to.equal('claude');
    expect(mapped[0].content_type).to.equal('OTHER');
  });

  it('returns empty array for invalid inputs', async () => {
    expect(await mapToAgenticTrafficRows(null, site, context, '2026-02-11')).to.deep.equal([]);
    expect(await mapToAgenticTrafficRows([], null, context, '2026-02-11')).to.deep.equal([]);
    expect(await mapToAgenticTrafficRows([], site, context, null)).to.deep.equal([]);
  });

  it('handles missing PageCitability accessor safely', async () => {
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'GPTBot',
      status: 200,
      number_of_hits: 1,
      country_code: 'US',
      url: '/a',
    }];
    const contextWithoutCitability = { log: { warn: sandbox.stub() }, dataAccess: {} };

    const mapped = await mapToAgenticTrafficRows(rows, site, contextWithoutCitability, '2026-02-11');

    expect(mapped).to.have.length(1);
  });

  it('handles PageCitability fetch errors and logs warning', async () => {
    context.dataAccess.PageCitability.allBySiteId.rejects(new Error('db fail'));
    const rows = [{
      agent_type: 'Bot',
      user_agent_display: 'GPTBot',
      status: 200,
      number_of_hits: 1,
      country_code: 'US',
      url: '/a',
    }];

    const mapped = await mapToAgenticTrafficRows(rows, site, context, '2026-02-11');

    expect(mapped).to.have.length(1);
    expect(context.log.warn).to.have.been.calledWith(
      sinon.match('Failed to fetch citability scores for agentic mapping: db fail'),
    );
  });
});
