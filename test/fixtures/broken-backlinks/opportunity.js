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
import { site } from './sites.js';

export const brokenBacklinksOpportunity = {
  getType: () => 'broken-backlinks',
  getId: () => 'test-opportunity-id',
  getSiteId: () => site.getId(),
  addSuggestions: sinon.stub(),
  getSuggestions: sinon.stub(),
  setAuditId: sinon.stub(),
  save: sinon.stub().resolves(),
  setData: () => {},
  getData: () => {},
};

export const otherOpportunity = {
  getType: () => 'other',
};

export const opportunityData = (siteId, auditId, kpiDeltas) => ({
  siteId,
  auditId,
  runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7BAC174971-BA97-44A9-9560-90BE6C7CF789%7D&file=Experience_Success_Studio_Broken_Backlinks_Runbook.docx&action=default&mobileredirect=true',
  type: 'broken-backlinks',
  origin: 'AUTOMATION',
  title: 'Authoritative Domains are linking to invalid URLs. This could impact your SEO.',
  description: 'Provide the correct target URL that each of the broken backlinks should be redirected to.',
  guidance: {
    steps: [
      'Review the list of broken target URLs and the suggested redirects.',
      'Manually override redirect URLs as needed.',
      'Copy redirects.',
      'Paste new entries in your website redirects file.',
      'Publish the changes.',
    ],
  },
  tags: ['Traffic acquisition'],
  data: {
    ...kpiDeltas,
  },
});
