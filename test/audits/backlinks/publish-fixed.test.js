/*
 * Copyright 2025 Adobe
 */
/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

describe('backlinks: reconciliation for disappeared suggestions', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let handler;

  afterEach(() => {
    sandbox.restore();
  });

  after(async () => {
    if (handler) {
      await esmock.purge(handler);
      handler = undefined;
    }
  });

  it('reconciliation: marks suggestion FIXED and creates fix entity when url_to redirects to urlsSuggested', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-redirect',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old-broken',
        urlsSuggested: ['https://example.com/new-fixed'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new-fixed', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-reconcile',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://other.com/f', url_to: 'https://other.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;
    const callArgs = addFixEntities.firstCall.args[0];
    expect(callArgs[0].changeDetails.updatedValue).to.equal('https://example.com/new-fixed');

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: handles suggestion with getData returning null (fallback to {})', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-null-data',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => null,
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-null-data',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: uses url_to fallback when resp.url is undefined', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-no-resp-url',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/old'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-no-resp-url',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: uses urlEdited when present', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-urledited',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/suggested'],
        urlEdited: 'https://example.com/custom-edited',
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/suggested', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-urledited',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;
    const callArgs = addFixEntities.firstCall.args[0];
    expect(callArgs[0].changeDetails.updatedValue).to.equal('https://example.com/custom-edited');

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: falls back to empty string when first suggested url is empty', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-empty-first',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['', 'https://example.com/second'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/second', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-empty-first',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;
    const callArgs = addFixEntities.firstCall.args[0];
    expect(callArgs[0].changeDetails.updatedValue).to.equal('');

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: network error while following url_to does not mark FIXED', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-net-err',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/new'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => { throw new Error('Network error'); },
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-net-err',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: save throws logs warn', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-save-err',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/new'],
      }),
      setStatus: sandbox.stub().throws(new Error('save-err')),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-save-err',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed to mark suggestion.*as FIXED/));

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: addFixEntities failure logs warn', async () => {
    const addFixEntities = sandbox.stub().rejects(new Error('add-fail'));
    const suggestion = {
      getId: () => 'sug-add-err',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/new'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-add-err',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed to add fix entities on opportunity/));

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: skips when no suggested targets', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-no-targets',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: [],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-no-targets',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: handles outer error gracefully', async () => {
    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-outer-err',
          addFixEntities: sandbox.stub().resolves(),
          getSuggestions: () => { throw new Error('getSuggestions-fail'); },
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed reconciliation for disappeared suggestions/));

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: normalize handles non-string targets', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-non-string',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: [null, 'https://example.com/valid'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/valid', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-non-string',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.have.been.calledWith('FIXED');
    expect(addFixEntities).to.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: skips when url_to missing', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-missing-urlto',
      getStatus: () => 'NEW',
      getType: () => 'REDIRECT_UPDATE',
      getData: () => ({
        url_from: 'https://from.com/page',
        urlsSuggested: ['https://example.com/new'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-missing-urlto',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(suggestion.setStatus).to.not.have.been.called;
    expect(addFixEntities).to.not.have.been.called;

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);

  it('reconciliation: building fix entity payload failure logs warn (lines 262-263)', async () => {
    const addFixEntities = sandbox.stub().resolves();
    const suggestion = {
      getId: () => 'sug-build-fail',
      getStatus: () => 'NEW',
      getType: () => { throw new Error('getType-fail'); }, // Throws when building fix entity payload
      getData: () => ({
        url_from: 'https://from.com/page',
        url_to: 'https://example.com/old',
        urlsSuggested: ['https://example.com/new'],
      }),
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: sandbox.stub().resolves(),
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ url: 'https://example.com/new', ok: true, status: 200 }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-build-fail',
          addFixEntities,
          getSuggestions: () => [suggestion],
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: sandbox.stub().resolves(),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({ isHandlerEnabledForSite: () => true }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              { getId: () => 'new-1', getData: () => ({ url_from: 'https://from.com/f', url_to: 'https://to.com/t' }) },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/page1' }]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://a.com/f', url_to: 'https://a.com/t', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result.status).to.equal('complete');
    expect(context.log.warn).to.have.been.calledWith(sinon.match(/Failed building fix entity payload for suggestion/));

    await esmock.purge(handler);
    handler = undefined;
  }).timeout(8000);
});

describe('backlinks: publish FIXED fix entities when url_to no longer broken', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let handler;

  afterEach(() => {
    sandbox.restore();
  });

  after(async () => {
    if (handler) {
      await esmock.purge(handler);
      handler = undefined;
    }
  });

  it('publishes DEPLOYED fix entities to PUBLISHED for non-broken url_to', async () => {
    let capturedIsIssueResolvedOnProduction;
    const publishDeployedFixEntitiesStub = sandbox.stub().callsFake(async ({ isIssueResolvedOnProduction }) => {
      capturedIsIssueResolvedOnProduction = isIssueResolvedOnProduction;
    });

    const shared = await import('@adobe/spacecat-shared-data-access');

    handler = await esmock('../../../src/backlinks/handler.js', {
      // Make filterOutValidBacklinks think URL is healthy by making fetch ok
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '' }),
      },
      '@adobe/spacecat-shared-data-access': {
        ...shared,
        Suggestion: { STATUSES: { NEW: 'NEW', FIXED: 'FIXED' } },
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}), // calculateKpiMetrics
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: publishDeployedFixEntitiesStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
        }),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://backlinks-example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://backlinks-example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => true,
            }),
          },
          Suggestion: {
            // Return NEW suggestions for message build; keep minimal valid entry
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              {
                getId: () => 'new-1',
                getData: () => ({ url_from: 'https://backlinks-example.com/from', url_to: 'https://backlinks-example.com/ok' }),
              },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              // Include URL with '/ok' prefix so alternativeUrls filtering keeps it
              { getUrl: () => 'https://backlinks-example.com/ok/page1' },
            ]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://from', url_to: 'https://to', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result).to.deep.equal({ status: 'complete' });

    // Verify publishDeployedFixEntities was called
    expect(publishDeployedFixEntitiesStub).to.have.been.calledOnce;

    // Test the captured callback - when URL is healthy (returns ok), issue is resolved
    const suggestion = { getData: () => ({ url_to: 'https://backlinks-example.com/ok' }) };
    const isResolved = await capturedIsIssueResolvedOnProduction(suggestion);
    // filterOutValidBacklinks returns empty array for healthy URL, so stillBroken.length === 0, so returns true
    expect(isResolved).to.equal(true);

    // Verify SQS was sent once with valid structure
    expect(context.sqs.sendMessage).to.have.been.calledOnce;

    await esmock.purge(handler);
    handler = undefined;
  });

  it('skips fixed suggestion when url_to is missing (continue path)', async () => {
    let capturedIsIssueResolvedOnProduction;
    const publishDeployedFixEntitiesStub = sandbox.stub().callsFake(async ({ isIssueResolvedOnProduction }) => {
      capturedIsIssueResolvedOnProduction = isIssueResolvedOnProduction;
    });

    const shared = await import('@adobe/spacecat-shared-data-access');

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        ...shared,
        Suggestion: { STATUSES: { NEW: 'NEW', FIXED: 'FIXED' } },
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}), // calculateKpiMetrics
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: publishDeployedFixEntitiesStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
        }),
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://backlinks-example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://backlinks-example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => true,
            }),
          },
          Suggestion: {
            // Return NEW suggestions for message build
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              {
                getId: () => 'new-1',
                getData: () => ({ url_from: 'https://backlinks-example.com/from', url_to: 'https://backlinks-example.com/' }),
              },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getUrl: () => 'https://backlinks-example.com/page1' },
            ]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenBacklinks: [{ url_from: 'https://from', url_to: 'https://to', traffic_domain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.generateSuggestionData(context);
    expect(result).to.deep.equal({ status: 'complete' });

    // Verify publishDeployedFixEntities was called
    expect(publishDeployedFixEntitiesStub).to.have.been.calledOnce;

    // Test the captured callback - when url_to is missing, issue is not resolved
    const suggestion = { getData: () => ({}) }; // missing url_to
    const isResolved = await capturedIsIssueResolvedOnProduction(suggestion);
    // When url_to is missing, handler returns false (not resolved)
    expect(isResolved).to.equal(false);

    // But SQS should still be sent for NEW suggestions flow
    expect(context.sqs.sendMessage).to.have.been.calledOnce;

    await esmock.purge(handler);
    handler = undefined;
  });
});
