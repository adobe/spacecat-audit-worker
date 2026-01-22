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

/**
 * Creates the opportunity data object for unused content fragment opportunities.
 *
 * This function generates the static metadata used when creating or updating
 * opportunities related to unused content fragments in AEM.
 *
 * @returns {Object} The opportunity configuration object.
 */
export function createOpportunityData() {
  return {
    runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/',
    origin: 'AUTOMATION',
    title: 'Remove unused Content Fragments to optimize content governance',
    description: 'Identifying and removing unused content fragments reduces system overhead, optimizes storage, and helps teams focus on active content governance.',
    tags: ['Headless'],
    data: {
      dataSources: [DATA_SOURCES.SITE],
    },
  };
}
