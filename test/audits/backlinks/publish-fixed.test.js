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

describe('backlinks: syncSuggestions callback tests', () => {
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

  /**
   * Helper to set up handler with syncSuggestions stub that captures callbacks
   */
  async function setupHandlerWithCallbackCapture(fetchResponse = { url: 'https://example.com/new-fixed', ok: true, status: 200 }) {
    const capturedCallbacks = {};
    const syncSuggestionsStub = sandbox.stub().callsFake(async (params) => {
      capturedCallbacks.isIssueFixed = params.isIssueFixed;
      capturedCallbacks.isIssueResolvedOnProduction = params.isIssueResolvedOnProduction;
      capturedCallbacks.getPagePath = params.getPagePath;
      capturedCallbacks.getUpdatedValue = params.getUpdatedValue;
      capturedCallbacks.getOldValue = params.getOldValue;
    });

    handler = await esmock('../../../src/backlinks/handler.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: async () => fetchResponse,
      },
      '@adobe/spacecat-shared-data-access': {
        ...await import('@adobe/spacecat-shared-data-access'),
        Suggestion: { STATUSES: { FIXED: 'FIXED', NEW: 'NEW' } },
        FixEntity: { STATUSES: { PUBLISHED: 'PUBLISHED' } },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-test',
        }),
      },
      '../../../src/backlinks/kpi-metrics.js': {
        default: sandbox.stub().resolves({}),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
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

    return { syncSuggestionsStub, capturedCallbacks };
  }

  describe('isIssueFixed callback', () => {
    it('returns true when url_to redirects to urlsSuggested', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture({
        url: 'https://example.com/new-fixed',
        ok: true,
        status: 200,
      });

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/old-broken',
          urlsSuggested: ['https://example.com/new-fixed'],
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(true);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('returns true when url_to redirects to urlEdited', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture({
        url: 'https://example.com/custom-edited',
        ok: true,
        status: 200,
      });

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/old-broken',
          urlsSuggested: ['https://example.com/suggested'],
          urlEdited: 'https://example.com/custom-edited',
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(true);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('returns false when redirect does not match any target', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture({
        url: 'https://example.com/wrong-page',
        ok: true,
        status: 200,
      });

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/old-broken',
          urlsSuggested: ['https://example.com/new-fixed'],
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(false);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('returns false when no suggested targets', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/old-broken',
          urlsSuggested: [],
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(false);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('returns false when url_to is missing', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          urlsSuggested: ['https://example.com/new-fixed'],
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(false);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('handles trailing slash normalization', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture({
        url: 'https://example.com/new-fixed/',
        ok: true,
        status: 200,
      });

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({
          url_to: 'https://example.com/old-broken',
          urlsSuggested: ['https://example.com/new-fixed'], // no trailing slash
        }),
      };
      const isFixed = await capturedCallbacks.isIssueFixed(suggestion);
      expect(isFixed).to.equal(true);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);
  });

  describe('isIssueResolvedOnProduction callback', () => {
    it('returns true when URL is no longer broken (200 response)', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture({
        ok: true,
        status: 200,
      });

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({ url_to: 'https://example.com/now-ok' }),
      };
      const isResolved = await capturedCallbacks.isIssueResolvedOnProduction(suggestion);
      expect(isResolved).to.equal(true);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('returns false when url_to is missing', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      const suggestion = {
        getData: () => ({}),
      };
      const isResolved = await capturedCallbacks.isIssueResolvedOnProduction(suggestion);
      expect(isResolved).to.equal(false);

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);
  });

  describe('helper callbacks', () => {
    it('getPagePath extracts url_from from data', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      const data = { url_from: 'https://from.com/page', url_to: 'https://to.com/broken' };
      expect(capturedCallbacks.getPagePath(data)).to.equal('https://from.com/page');

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('getUpdatedValue returns urlEdited if present, otherwise first urlsSuggested', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      // With urlEdited
      const dataWithEdited = { urlEdited: 'https://edited.com', urlsSuggested: ['https://suggested.com'] };
      expect(capturedCallbacks.getUpdatedValue(dataWithEdited)).to.equal('https://edited.com');

      // Without urlEdited
      const dataWithoutEdited = { urlsSuggested: ['https://suggested.com'] };
      expect(capturedCallbacks.getUpdatedValue(dataWithoutEdited)).to.equal('https://suggested.com');

      // Empty
      const emptyData = {};
      expect(capturedCallbacks.getUpdatedValue(emptyData)).to.equal('');

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);

    it('getOldValue returns url_to from data', async () => {
      const { capturedCallbacks } = await setupHandlerWithCallbackCapture();

      await handler.generateSuggestionData(context);

      const data = { url_to: 'https://broken.com/old' };
      expect(capturedCallbacks.getOldValue(data)).to.equal('https://broken.com/old');

      await esmock.purge(handler);
      handler = undefined;
    }).timeout(8000);
  });
});
