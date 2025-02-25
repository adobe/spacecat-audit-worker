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
import sinon from 'sinon';
import auditDataMock from './audit.json' with { type: 'json' };
import { brokenBacklinksOpportunity } from './opportunity.js';

export const brokenBacklinksSuggestions = {
  createdItems: auditDataMock.auditResult.brokenBacklinks,
  errorItems: [],
};

export const brokenBacklinkExistingSuggestions = [{
  opportunityId: brokenBacklinksOpportunity.getId(),
  type: 'REDIRECT_UPDATE',
  rank: 5000,
  data: auditDataMock.auditResult.brokenBacklinks[0],
  remove: sinon.stub(),
  getData: sinon.stub().returns(auditDataMock.auditResult.brokenBacklinks[0]),
  setData: sinon.stub(),
  save: sinon.stub(),
}];

export const suggestions = [
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 2000,
    data: {
      title: 'backlink that redirects to www and throw connection error',
      url_from: 'https://from.com/from-2',
      url_to: 'https://foo.com/redirects-throws-error',
      urlsSuggested: [],
      aiRationale: '',
      traffic_domain: 2000,
    },
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 1000,
    data: {
      title: 'backlink that returns 429',
      url_from: 'https://from.com/from-3',
      url_to: 'https://foo.com/returns-429',
      urlsSuggested: [],
      aiRationale: '',
      traffic_domain: 1000,
    },
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 5000,
    data: {
      title: 'backlink that is not excluded',
      url_from: 'https://from.com/from-not-excluded',
      url_to: 'https://foo.com/not-excluded',
      urlsSuggested: [],
      aiRationale: '',
      traffic_domain: 5000,
    },
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 4000,
    data: {
      title: 'backlink that returns 404',
      url_from: 'https://from.com/from-1',
      url_to: 'https://foo.com/returns-404',
      urlsSuggested: [],
      aiRationale: '',
      traffic_domain: 4000,
    },
  },
];

brokenBacklinkExistingSuggestions[0].remove.resolves();
