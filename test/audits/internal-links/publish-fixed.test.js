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

describe('internal-links: publish FIXED fix entities when target no longer 404', () => {
  const sandbox = sinon.createSandbox();
  let context;

  afterEach(() => {
    sandbox.restore();
  });

  it('publishes DEPLOYED fix entities to PUBLISHED for non-404 urlTo', async () => {
    let capturedIsIssueResolvedOnProduction;
    const publishDeployedFixEntitiesStub = sandbox.stub().callsFake(async ({ isIssueResolvedOnProduction }) => {
      capturedIsIssueResolvedOnProduction = isIssueResolvedOnProduction;
    });

    const dataAccessModule = await import('@adobe/spacecat-shared-data-access');

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
        generateSuggestionData: sandbox.stub().resolves([]),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
        }),
      },
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: sandbox.stub().resolves(false), // urlTo is not 404
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: publishDeployedFixEntitiesStub,
      },
      '@adobe/spacecat-shared-data-access': {
        ...dataAccessModule,
        Suggestion: { STATUSES: { NEW: 'NEW', FIXED: 'FIXED' } },
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://interlink-example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://interlink-example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => false, // Skip Mystique block entirely
            }),
          },
          Suggestion: {
            // Return one FIXED suggestion with a valid urlTo
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              {
                getId: () => 'sug-1',
                getData: () => ({ urlTo: 'https://interlink-example.com/ok' }),
              },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenInternalLinks: [{ urlFrom: 'https://interlink-example.com/a', urlTo: 'https://interlink-example.com/b', trafficDomain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result).to.deep.equal({ status: 'complete' });

    // Verify publishDeployedFixEntities was called
    expect(publishDeployedFixEntitiesStub).to.have.been.calledOnce;

    // Test the captured callback - urlTo is not 404, so issue is resolved
    const suggestion = { getData: () => ({ urlTo: 'https://interlink-example.com/ok' }) };
    const isResolved = await capturedIsIssueResolvedOnProduction(suggestion);
    // isLinkInaccessible returns false (not 404), so !is404 means resolved = true
    expect(isResolved).to.equal(true);
  });

  it('skips publish when suggestion urlTo is missing', async () => {
    let capturedIsIssueResolvedOnProduction;
    const publishDeployedFixEntitiesStub = sandbox.stub().callsFake(async ({ isIssueResolvedOnProduction }) => {
      capturedIsIssueResolvedOnProduction = isIssueResolvedOnProduction;
    });

    const dataAccessModule = await import('@adobe/spacecat-shared-data-access');

    const handler = await esmock('../../../src/internal-links/handler.js', {
      '../../../src/internal-links/suggestions-generator.js': {
        syncBrokenInternalLinksSuggestions: sandbox.stub().resolves(),
        generateSuggestionData: sandbox.stub().resolves([]),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'oppty-1',
        }),
      },
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: sandbox.stub().resolves(false),
        calculateKpiDeltasForAudit: sandbox.stub().returns({}),
        calculatePriority: (arr) => arr,
      },
      '../../../src/utils/data-access.js': {
        reconcileDisappearedSuggestions: sandbox.stub().resolves(),
        publishDeployedFixEntities: publishDeployedFixEntitiesStub,
      },
      '@adobe/spacecat-shared-data-access': {
        ...dataAccessModule,
        Suggestion: { STATUSES: { NEW: 'NEW', FIXED: 'FIXED' } },
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://interlink-example.com',
        site: {
          getId: () => 'site-1',
          getBaseURL: () => 'https://interlink-example.com',
          getDeliveryType: () => 'aem_edge',
        },
        dataAccess: {
          Configuration: {
            findLatest: () => ({
              isHandlerEnabledForSite: () => false,
            }),
          },
          Suggestion: {
            allByOpportunityIdAndStatus: sandbox.stub().resolves([
              {
                getId: () => 'sug-1',
                getData: () => ({ urlTo: undefined }),
              },
            ]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
        },
        audit: {
          getId: () => 'audit-1',
          getAuditResult: () => ({
            success: true,
            brokenInternalLinks: [{ urlFrom: 'https://interlink-example.com/a', urlTo: 'https://interlink-example.com/b', trafficDomain: 1 }],
          }),
        },
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      })
      .build();

    const result = await handler.opportunityAndSuggestionsStep(context);
    expect(result).to.deep.equal({ status: 'complete' });

    // Verify publishDeployedFixEntities was called
    expect(publishDeployedFixEntitiesStub).to.have.been.calledOnce;

    // Test the captured callback - when urlTo is missing, issue is not resolved
    const suggestion = { getData: () => ({}) }; // missing urlTo
    const isResolved = await capturedIsIssueResolvedOnProduction(suggestion);
    // When urlTo is missing, handler returns false (not resolved)
    expect(isResolved).to.equal(false);
  });
});
