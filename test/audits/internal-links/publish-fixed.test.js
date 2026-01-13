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
    // Mock FixEntity (module import)
    const dataAccessModule = await import('@adobe/spacecat-shared-data-access');
    const deployed = 'DEPLOYED';
    const published = 'PUBLISHED';
    const fixEntitySave = sandbox.stub().resolves();
    const fixEntity = {
      getId: () => 'fix-1',
      getStatus: () => deployed,
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: fixEntitySave,
    };
    const mockFixEntity = {
      ...dataAccessModule.FixEntity,
      STATUSES: { DEPLOYED: deployed, PUBLISHED: published },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fixEntity]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves({
        data: [{ getData: () => ({ urlTo: 'https://interlink-example.com/ok' }) }],
        unprocessed: [],
      }),
    };

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
        publishDeployedFixEntities: async ({
          opportunityId, FixEntity, log, isSuggestionStillBroken,
        }) => {
          const fixes = await FixEntity.allByOpportunityIdAndStatus(opportunityId, FixEntity.STATUSES.DEPLOYED);
          const tasks = [];
          // eslint-disable-next-line no-restricted-syntax
          for (const fe of fixes) {
            // eslint-disable-next-line no-await-in-loop
            const { data: suggestions } = await FixEntity.getSuggestionsByFixEntityId(fe.getId());
            let publish = true;
            // eslint-disable-next-line no-restricted-syntax
            for (const s of suggestions) {
              // eslint-disable-next-line no-await-in-loop
              const stillBroken = await isSuggestionStillBroken(s);
              if (stillBroken !== false) {
                publish = false;
                break;
              }
            }
            if (publish && fe.getStatus() === FixEntity.STATUSES.DEPLOYED) {
              tasks.push((async () => {
                fe.setStatus(FixEntity.STATUSES.PUBLISHED);
                fe.setUpdatedBy('system');
                await fe.save();
                log.debug('Published fix entity');
              })());
            }
          }
          await Promise.all(tasks);
        },
      },
      '@adobe/spacecat-shared-data-access': {
        ...dataAccessModule,
        FixEntity: mockFixEntity,
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
    expect(mockFixEntity.allByOpportunityIdAndStatus).to.have.been.calledOnceWith('oppty-1', deployed);
    expect(mockFixEntity.getSuggestionsByFixEntityId).to.have.been.calledOnceWith('fix-1');
    expect(fixEntity.setStatus).to.have.been.calledOnceWith(published);
    expect(fixEntity.setUpdatedBy).to.have.been.calledOnceWith('system');
    expect(fixEntitySave).to.have.been.calledOnce;
  });

  it('skips publish when suggestion urlTo is missing', async () => {
    const dataAccessModule = await import('@adobe/spacecat-shared-data-access');
    const deployed = 'DEPLOYED';
    const published = 'PUBLISHED';
    const fixEntitySave = sandbox.stub().resolves();
    const fixEntity = {
      getId: () => 'fix-1',
      getStatus: () => deployed,
      setStatus: sandbox.stub(),
      setUpdatedBy: sandbox.stub().returnsThis(),
      save: fixEntitySave,
    };
    const mockFixEntity = {
      ...dataAccessModule.FixEntity,
      STATUSES: { DEPLOYED: deployed, PUBLISHED: published },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([fixEntity]),
      getSuggestionsByFixEntityId: sandbox.stub().resolves({
        data: [{ getData: () => ({}) }], // missing urlTo
        unprocessed: [],
      }),
    };

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
        publishDeployedFixEntities: async ({
          opportunityId, FixEntity, log, isSuggestionStillBroken,
        }) => {
          const fixes = await FixEntity.allByOpportunityIdAndStatus(opportunityId, FixEntity.STATUSES.DEPLOYED);
          const tasks = [];
          // eslint-disable-next-line no-restricted-syntax
          for (const fe of fixes) {
            // eslint-disable-next-line no-await-in-loop
            const { data: suggestions } = await FixEntity.getSuggestionsByFixEntityId(fe.getId());
            let publish = true;
            // eslint-disable-next-line no-restricted-syntax
            for (const s of suggestions) {
              // eslint-disable-next-line no-await-in-loop
              const stillBroken = await isSuggestionStillBroken(s);
              if (stillBroken !== false) {
                publish = false;
                break;
              }
            }
            if (publish && fe.getStatus() === FixEntity.STATUSES.DEPLOYED) {
              tasks.push((async () => {
                fe.setStatus(FixEntity.STATUSES.PUBLISHED);
                fe.setUpdatedBy('system');
                await fe.save();
                log.debug('Published fix entity');
              })());
            }
          }
          await Promise.all(tasks);
        },
      },
      '@adobe/spacecat-shared-data-access': {
        ...dataAccessModule,
        FixEntity: mockFixEntity,
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
    expect(mockFixEntity.allByOpportunityIdAndStatus).to.have.been.calledOnceWith('oppty-1', deployed);
    expect(mockFixEntity.getSuggestionsByFixEntityId).to.have.been.calledOnceWith('fix-1');
    expect(fixEntity.setStatus).to.not.have.been.called;
  });
});