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

/**
 * Creates opportunity data for YouTube analysis from the Mystique payload.
 * @param {Object} props - The props object from convertToOpportunity
 * @param {Object} [props.opportunityData] - The opportunity object from the analysis payload
 * @returns {Object} Opportunity data
 */
export function createOpportunityData({ opportunityData } = {}) {
  return {
    runbook: opportunityData?.runbook || 'https://adobe.sharepoint.com/sites/youtube-sentiment-analysis',
    origin: opportunityData?.origin || 'AUTOMATION',
    type: opportunityData?.type || 'generic-opportunity',
    title: opportunityData?.title || '[ʙᴇᴛᴀ] Cited YouTube Sentiment Analysis',
    description: opportunityData?.description || 'YouTube sentiment analysis for cited videos.',
    status: opportunityData?.status || 'NEW',
    tags: opportunityData?.tags || ['Video Content', 'social', 'Youtube', 'isElmo', 'Social Media'],
    data: opportunityData?.data || { dataSources: ['Site', 'Page'] },
  };
}
