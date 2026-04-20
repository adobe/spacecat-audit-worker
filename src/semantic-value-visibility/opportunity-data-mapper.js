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

export function createOpportunityData(props = {}) {
  const { guidance = {} } = props;

  return {
    runbook: '',
    origin: 'AUTOMATION',
    title: 'Increase Image Readability for LLMs',
    description: 'Images on your page contain valuable text — offers, product names, or brand messaging — that AI search engines and LLMs cannot read. Our solution makes that text readable to LLMs, keeps your page looking exactly the same to human visitors, and helps your content get understood, cited, and recommended in AI-powered search results.',
    guidance: {
      insight: guidance.insight,
      rationale: guidance.rationale,
      recommendation: guidance.recommendation,
    },
    tags: ['LLMO', 'SEO', 'Images'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
