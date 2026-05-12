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

import { DATA_SOURCES } from '../common/constants.js';

const OpptyData = {
  runbook: '',
  origin: 'AUTOMATION',
  title: 'Improve LLM Content Coverage',
  description: 'Pages have topics with insufficient content coverage. Expanding these pages based on Semrush content briefs improves AI discoverability and LLM citation potential.',
  guidance: {
    steps: [
      'Review pages flagged for low content coverage in the audit results.',
      'For each gap, consult the attached content brief for recommended headings and subtopics.',
      'Rewrite or expand the page following the brief\'s instructions.',
      'Ensure new content is accurate, on-brand, and targets the identified topics.',
    ],
  },
  tags: ['isElmo', 'content'],
  data: {
    dataSources: [DATA_SOURCES.PAGE],
  },
};

export function createOpportunityData() {
  return OpptyData;
}
