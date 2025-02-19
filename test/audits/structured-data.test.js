/*
 * Copyright 2024 Adobe. All rights reserved.
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
import GoogleClient from '@adobe/spacecat-shared-google-client';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';

import { opportunityAndSuggestions, structuredDataHandler } from '../../src/structured-data/handler.js';
import { MockContextBuilder } from '../shared.js';

import fullUrlInspectionResult from '../fixtures/structured-data/structured-data.json' with { type: 'json' };
import expectedOppty from '../fixtures/structured-data/oppty.json' with { type: 'json' };
import auditDataMock from '../fixtures/structured-data/audit.json' with { type: 'json' };
import suggestions from '../fixtures/structured-data/suggestions.json' with { type: 'json' };

use(sinonChai);

const sandbox = sinon.createSandbox();
const message = {
  type: 'structured-data',
  url: 'https://www.example.com',
};

describe('URLInspect Audit', () => {
  let context;
  let googleClientStub;
  let urlInspectStub;
  let siteStub;
  let structuredDataSuggestions;
  let mockFullInspectionResult;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          error: sinon.stub(),
        },
      })
      .build(message);

    googleClientStub = {
      urlInspect: sandbox.stub(),
    };

    urlInspectStub = googleClientStub.urlInspect;
    siteStub = {
      getId: () => '123',
      getConfig: () => ({
        getIncludedURLs: () => ['https://example.com/product/1', 'https://example.com/product/2', 'https://example.com/product/3'],
      }),
    };

    mockFullInspectionResult = JSON.parse(JSON.stringify(fullUrlInspectionResult));

    structuredDataSuggestions = {
      createdItems: [
        {
          type: 'url',
          url: 'https://example.com/product/1',
          errors: ['Missing field "image"'],
        },
        {
          type: 'url',
          url: 'https://example.com/product/2',
          errors: ['Missing field "image"'],
        },
      ],
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully return a filtered result of the url inspection result', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    // for the first call, return the full inspection result
    urlInspectStub.resolves(fullUrlInspectionResult);
    urlInspectStub.onSecondCall().resolves(fullUrlInspectionResult);
    urlInspectStub.onThirdCall().rejects(new Error('Failed to inspect URL'));

    const auditData = await structuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult).to.deep.equal(auditDataMock.auditResult);
  });

  it('returns no rich results when there are no rich results errors', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    delete mockFullInspectionResult.inspectionResult.richResultsResult;
    urlInspectStub.resolves(mockFullInspectionResult);

    const auditData = await structuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult[0].richResults).to.deep.equal({});
  });

  it('returns no rich results when there are no errors in rich results', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    mockFullInspectionResult.inspectionResult
      .richResultsResult.detectedItems[0].items[0].issues = [];
    delete mockFullInspectionResult.inspectionResult
      .richResultsResult.detectedItems[1].items[0].issues[1];

    urlInspectStub.resolves(mockFullInspectionResult);

    const auditData = await structuredDataHandler('https://www.example.com', context, siteStub);

    expect(auditData.auditResult[0].richResults.detectedIssues).to.deep.equal([]);
    expect(auditData.auditResult[1].richResults.verdict).to.equal('PASS');
  });

  it('throws error if there are no configured PDPs', async () => {
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);
    siteStub.getConfig = () => ({
      getIncludedURLs: () => [],
    });
    try {
      await structuredDataHandler('https://www.example.com', context, siteStub);
    } catch (error) {
      expect(error.message).to.equal('No product detail pages found for site: https://www.example.com');
    }
  });

  it('throws error if site is not configured for google search console', async () => {
    sandbox.stub(GoogleClient, 'createFrom').throws('No secrets found');

    try {
      await structuredDataHandler('https://www.example.com', context, siteStub);
    } catch (error) {
      expect(error.message).to.equal('Failed to create Google client. Site was probably not onboarded to GSC yet. Error: Sinon-provided No secrets found');
    }
  });

  it('throws error if google client fails to inspect URL', async () => {
    urlInspectStub.rejects(new Error('Failed to inspect URL'));
    sandbox.stub(GoogleClient, 'createFrom').returns(googleClientStub);

    try {
      await structuredDataHandler('https://www.example.com', context, siteStub);
    } catch (error) {
      expect(error.message).to.equal('Failed to inspect URL: https://example.com/product/1. Error: Failed to inspect URL');
    }
  });

  it('should transform the audit result into opportunities and suggestions in the post processor', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.resolves(context.dataAccess.Opportunity);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions('', auditDataMock, context);

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnceWith(suggestions);
  });

  it('should transform the audit result into opportunities and suggestions in the post processor and add the audit to an existing opportunity', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
    context.dataAccess.Opportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.getType.returns('structured-data');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions('', auditDataMock, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.setAuditId).to.have.been.calledOnceWith('audit-id');
    expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnceWith(suggestions);
  });

  it('should transform the audit result into opportunities and suggestions in the post processor and add the audit to an existing opportunity with outdated suggestions', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([context.dataAccess.Opportunity]);
    const existingSuggestionsData = {
      type: 'url',
      url: 'https://example.com/product/1',
      errors: [
        {
          id: 'missingfieldimages',
          errorTitle: "Missing field 'images'",
          fix: '',
        },
        {
          id: 'missingfieldrecipe',
          errorTitle: "Missing field 'Recipe'",
          fix: '',
        },
      ],
    };

    const existingSuggestions = [{
      opportunityId: 'opportunity-id',
      type: 'CODE_CHANGE',
      rank: 2,
      data: existingSuggestionsData,
      remove: sinon.stub(),
      getData: sinon.stub().returns(existingSuggestionsData),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
      getStatus: sinon.stub().returns('NEW'),
    }];

    context.dataAccess.Opportunity.getSuggestions.resolves(existingSuggestions);
    context.dataAccess.Opportunity.getId.returns('opportunity-id');
    context.dataAccess.Opportunity.getType.returns('structured-data');
    context.dataAccess.Opportunity.addSuggestions.resolves(structuredDataSuggestions);
    await opportunityAndSuggestions('', auditDataMock, context);

    expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledOnceWith(
      existingSuggestions,
      'OUTDATED',
    );
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(context.dataAccess.Opportunity.setAuditId).to.have.been.calledOnceWith('audit-id');
    expect(context.dataAccess.Opportunity.save).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.addSuggestions).to.have.been.calledOnceWith(suggestions);
  });

  it('should throw an error if creating a new opportunity fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.throws('opportunity-error');
    try {
      await opportunityAndSuggestions('', auditDataMock, context);
    } catch (error) {
      expect(error.message).to.equal('Sinon-provided opportunity-error');
    }

    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnceWith(expectedOppty);
    expect(context.dataAccess.Opportunity.addSuggestions).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith('Failed to create new opportunity for siteId site-id and auditId audit-id: Sinon-provided opportunity-error');
  });
});
