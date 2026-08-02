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

import { v4 as uuidv4 } from 'uuid';
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

function getEmptyVariationList() {
  return [
    {
      name: 'Control',
      changes: [
        {
          type: 'text',
          element: null,
          text: 'Control',
        },
      ],
      variationEditPageUrl: null,
      id: uuidv4(),
      variationPageUrl: '',
      explanation: null,
      projectedImpact: null,
      previewImage: '',
    },
  ];
}
export async function addSuggestions(
  opportunity,
  newSuggestions,
  context = {},
) {
  let variations = [];

  if (newSuggestions) {
    variations = [...newSuggestions];
  }

  const requiresValidation = Boolean(context?.site?.requiresValidation);
  const suggestionStatus = requiresValidation
    ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
    : SuggestionDataAccess.STATUSES.NEW;

  const existingSuggestions = await opportunity.getSuggestions();

  if (existingSuggestions?.length > 0) {
    if (existingSuggestions[0]?.data?.variations) {
      // replacing the entire variations with the new ones
      existingSuggestions[0].data.variations = variations;
    }
  } else {
    const emptySuggestionList = [
      {
        id: uuidv4(),
        opportunityId: opportunity.opportunityId,
        type: 'CONTENT_UPDATE',
        rank: 1,
        status: suggestionStatus,
        data: {
          variations: variations.length > 0 ? variations : getEmptyVariationList(),
        },
        kpiDeltas: {
          estimatedKPILift: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
      },
    ];
    await opportunity.addSuggestions(emptySuggestionList);
  }
}
