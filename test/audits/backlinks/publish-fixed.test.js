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
    const deployed = 'DEPLOYED';
    const published = 'PUBLISHED';
    const fixSave = sandbox.stub().resolves();
    const fixEntity = {
      getId: () => 'fix-1',
      getStatus: () => deployed,
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: fixSave,
    };

    handler = await esmock('../../../src/backlinks/handler.js', {
      // Make filterOutValidBacklinks think URL is healthy by making fetch ok
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => '' }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}), // calculateKpiMetrics
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
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
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => true,
            }),
          },
          Suggestion: {
            // First: return FIXED suggestions for publish branch
            allByOpportunityIdAndStatus: sandbox.stub()
              .onFirstCall().resolves([
                { getId: () => 'sug-1', getData: () => ({ url_to: 'https://example.com/ok' }) },
              ])
              // Then: return NEW suggestions for message build; keep minimal valid entry
              .onSecondCall().resolves([
                {
                  getId: () => 'new-1',
                  getData: () => ({ url_from: 'https://example.com/from', url_to: 'https://example.com/ok' }),
                },
              ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              // Include URL with '/ok' prefix so alternativeUrls filtering keeps it
              { getUrl: () => 'https://example.com/ok/page1' },
            ]),
          },
          FixEntity: {
            STATUSES: { DEPLOYED: deployed, PUBLISHED: published },
            getFixEntitiesBySuggestionId: sandbox.stub().resolves([fixEntity]),
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

    // Verify publish happened
    expect(context.dataAccess.FixEntity.getFixEntitiesBySuggestionId).to.have.been.calledOnceWith('sug-1');
    expect(fixEntity.setStatus).to.have.been.calledOnceWith(published);
    expect(fixEntity.setUpdatedBy).to.have.been.calledOnceWith('system');
    expect(fixSave).to.have.been.calledOnce;
    // Verify SQS was sent once with valid structure
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
  });
});


