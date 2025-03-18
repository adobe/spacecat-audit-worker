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
import auditDataSuggestionsMock from './auditWithSuggestions.json' with { type: 'json' };
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
  getStatus: sinon.stub().returns('NEW'),
  getData: sinon.stub().returns(auditDataMock.auditResult.brokenBacklinks[0]),
  setData: sinon.stub(),
  save: sinon.stub(),
}];

export const suggestions = [
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 550000,
    data: auditDataSuggestionsMock.auditResult.brokenBacklinks[0],
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 11000,
    data: auditDataSuggestionsMock.auditResult.brokenBacklinks[1],
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 5500,
    data: auditDataSuggestionsMock.auditResult.brokenBacklinks[2],
  },
  {
    opportunityId: 'test-opportunity-id',
    type: 'REDIRECT_UPDATE',
    rank: 1100000,
    data: {
      ...auditDataSuggestionsMock.auditResult.brokenBacklinks[3],
      urlsSuggested: [],
      aiRationale: '',
    },
  },
];

brokenBacklinkExistingSuggestions[0].remove.resolves();
