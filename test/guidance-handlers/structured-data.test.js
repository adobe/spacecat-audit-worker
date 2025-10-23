/*
 * Copyright 2025 Adobe. All rights reserved.
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
import structuredDataGuidance from '../../src/structured-data/guidance-handler.js';
import { MockContextBuilder } from '../shared.js';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };

use(sinonChai);
describe('guidance-structured-data-remediation handler', () => {
  let sandbox;
  let mockContext;
  const mockMessage = {
    id: 'test-opportunity-id',
    siteId: 'test-site-id',
    type: 'guidance:structured-data-remediation',
    data: {
      opportunityId: 'test-opportunity-id',
      url: 'https://www.example.com/vegan-mince-recipes/',
      suggestionId: 'c7c2d4e5-m8g7-2481-yzab-dg2345678901',
      remediations: [
        {
          error_title: "Missing field 'name'",
          id: 'missingfieldname',
          corrected_markup: {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Example Vegan Mince Recipes',
            url: 'https://www.bulk.com/uk/the-core/vegan-mince-recipes/',
            description: 'Example description: Discover a selection of vegan mince recipes suitable for healthy living and plant-based diets.',
          },
          ai_rationale: "Example data for a 'WebPage' schema was provided, including plausible values for 'name', 'url', and 'description'. This correction relies entirely on hypothetical content as the actual webpage could not be accessed, and the changes are transparently noted.",
        },
        {
          error_title: "Missing field 'recipeYield'",
          id: 'missingfieldrecipeyield',
          corrected_markup: {
            '@context': 'https://schema.org',
            '@type': 'Recipe',
            name: 'Vegan Mince Recipes',
            description: 'A collection of vegan mince recipes ideal for plant-based diets, featured by Bulk.',
            url: 'https://www.bulk.com/uk/the-core/vegan-mince-recipes/',
            recipeYield: '4 servings',
            image: 'https://www.bulk.com/uk/the-core/wp-content/uploads/sites/3/2023/02/vegan-mince-recipes-feature.jpg',
            author: {
              '@type': 'Organization',
              name: 'Bulk',
            },
          },
          ai_rationale: "It is required by schema.org that the Recipe structured data must include the 'recipeYield' property to specify the number of servings. Since page content could not be retrieved, it is suggested to use example data for key fields: 'name', 'description', 'image', and 'recipeYield', based on the URL and best guess from standard vegan recipe collections. It is also suggested to use the organization as author since it is the publisher. All other fields are derived from likely page content and serve as representative placeholders, flagged as example data due to lack of retrievable content.",
        },
      ],
    },
  };

  before(async () => {
    sandbox = sinon.createSandbox();
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(mockMessage);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully process structured-data remediation guidance', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => mockMessage.siteId,
      getBaseURL: () => 'https://foo.com',
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'structured-data ',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => mockMessage.siteId,
      getId: () => mockMessage.data.opportunityId,
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        errors: [
          { errorTitle: "Missing field 'name'", id: 'missingfieldname' },
          { errorTitle: "Missing field 'recipeYield'", id: 'missingfieldrecipeyield' },
        ],
      }),
      save: mockSave,
    });
    const response = await structuredDataGuidance(mockMessage, mockContext);
    expect(response.status).to.equal(200);

    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      errors: [
        {
          errorTitle: "Missing field 'name'",
          id: 'missingfieldname',
          fix: {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Example Vegan Mince Recipes',
            url: 'https://www.bulk.com/uk/the-core/vegan-mince-recipes/',
            description: 'Example description: Discover a selection of vegan mince recipes suitable for healthy living and plant-based diets.',
          },
          aiRationale: "Example data for a 'WebPage' schema was provided, including plausible values for 'name', 'url', and 'description'. This correction relies entirely on hypothetical content as the actual webpage could not be accessed, and the changes are transparently noted.",
        },
        {
          errorTitle: "Missing field 'recipeYield'",
          id: 'missingfieldrecipeyield',
          fix: {
            '@context': 'https://schema.org',
            '@type': 'Recipe',
            name: 'Vegan Mince Recipes',
            description: 'A collection of vegan mince recipes ideal for plant-based diets, featured by Bulk.',
            url: 'https://www.bulk.com/uk/the-core/vegan-mince-recipes/',
            recipeYield: '4 servings',
            image: 'https://www.bulk.com/uk/the-core/wp-content/uploads/sites/3/2023/02/vegan-mince-recipes-feature.jpg',
            author: {
              '@type': 'Organization',
              name: 'Bulk',
            },
          },
          aiRationale: "It is required by schema.org that the Recipe structured data must include the 'recipeYield' property to specify the number of servings. Since page content could not be retrieved, it is suggested to use example data for key fields: 'name', 'description', 'image', and 'recipeYield', based on the URL and best guess from standard vegan recipe collections. It is also suggested to use the organization as author since it is the publisher. All other fields are derived from likely page content and serve as representative placeholders, flagged as example data due to lack of retrievable content.",
        },
      ],
    });
  });

  it('should return 404 if Site is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await structuredDataGuidance(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Site.findById).to.have.been.calledWith(mockMessage.siteId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Audit is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await structuredDataGuidance(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.not.have.been.called;
  });

  it('should return 404 if Opportunity is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(null);
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});

    const response = await structuredDataGuidance(mockMessage, mockContext);
    expect(response.status).to.equal(404);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.have.been
      .calledWith(mockMessage.data.opportunityId);
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should return error if Opportunity siteId does not match message siteId', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub()
      .resolves({ getId: () => mockMessage.siteId });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => 'site-actual',
      getType: () => 'structured-data ',
    });
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({});
    const response = await structuredDataGuidance(mockMessage, mockContext);
    expect(response.status).to.equal(400);
    expect(mockContext.dataAccess.Audit.findById).to.have.been.calledWith(mockMessage.auditId);
    expect(mockContext.dataAccess.Opportunity.findById).to.have.been
      .calledWith(mockMessage.data.opportunityId);
    expect(mockContext.dataAccess.Suggestion.findById).to.not.have.been.called;
  });

  it('should return 404 if Suggestion is not found', async () => {
    mockContext.dataAccess.Site.findById = sandbox.stub().resolves(
      { getId: () => mockMessage.siteId },
    );
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({});
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves(
      {
        getSiteId: () => mockMessage.siteId,
        getType: () => 'structured-data ',
      },
    );
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves(null);

    await structuredDataGuidance(mockMessage, mockContext);
    expect(mockContext.log.error).to.have.been.calledWith('Suggestion not found for suggestionId: c7c2d4e5-m8g7-2481-yzab-dg2345678901');
  });

  it('should handle empty remediations array', async () => {
    const messageWithoutRemediations = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        remediations: [],
      },
    };

    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => messageWithoutRemediations.siteId,
      getBaseURL: () => 'https://foo.com',
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'structured-data ',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => messageWithoutRemediations.siteId,
      getId: () => messageWithoutRemediations.data.opportunityId,
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        errors: [],
      }),
      save: mockSave,
    });

    const response = await structuredDataGuidance(messageWithoutRemediations, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      errors: [],
    });
  });

  it('should handle undefined remediations', async () => {
    const messageWithoutRemediations = {
      ...mockMessage,
      data: {
        ...mockMessage.data,
        remediations: undefined,
      },
    };

    mockContext.dataAccess.Site.findById = sandbox.stub().resolves({
      getId: () => messageWithoutRemediations.siteId,
      getBaseURL: () => 'https://foo.com',
    });
    mockContext.dataAccess.Audit.findById = sandbox.stub().resolves({
      getId: () => auditDataMock.id,
      getAuditType: () => 'structured-data ',
    });
    mockContext.dataAccess.Opportunity.findById = sandbox.stub().resolves({
      getSiteId: () => messageWithoutRemediations.siteId,
      getId: () => messageWithoutRemediations.data.opportunityId,
    });
    const mockSetData = sandbox.stub();
    const mockSave = sandbox.stub().resolves();
    mockContext.dataAccess.Suggestion.findById = sandbox.stub().resolves({
      setData: mockSetData,
      getData: sandbox.stub().returns({
        errors: [],
      }),
      save: mockSave,
    });

    const response = await structuredDataGuidance(messageWithoutRemediations, mockContext);
    expect(response.status).to.equal(200);
    expect(mockSave).to.have.been.calledOnce;
    expect(mockSetData).to.have.been.calledWith({
      errors: [],
    });
  });
});
