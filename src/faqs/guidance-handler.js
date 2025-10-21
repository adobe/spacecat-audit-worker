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

import {
  badRequest, notFound, ok, noContent,
} from '@adobe/spacecat-shared-http-utils';
import { syncSuggestions } from '../utils/data-access.js';
import { getFaqMarkdown } from './utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

/**
 * Handles Mystique response for FAQ suggestions
 * @param {Object} message - Message from Mystique with presigned URL
 * @param {Object} context - Context object with data access and logger
 * @returns {Promise<Object>} - HTTP response
 */
export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Opportunity } = dataAccess;
  const { siteId, auditId, data } = message;
  const { presigned_url: presignedUrl } = data;

  log.info(`Message received in FAQ guidance handler: ${JSON.stringify(message, null, 2)}`);

  // Validate presigned URL
  if (!presignedUrl) {
    log.error('No presigned URL provided in message data');
    return badRequest('Presigned URL is required');
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  try {
    // Fetch FAQ data from presigned URL
    log.info(`Fetching FAQ data from presigned URL: ${presignedUrl}`);
    const response = await fetch(presignedUrl);

    if (!response.ok) {
      log.error(`Failed to fetch FAQ data: ${response.status} ${response.statusText}`);
      return badRequest(`Failed to fetch FAQ data: ${response.statusText}`);
    }

    const faqData = await response.json();
    log.info(`Received FAQ data with ${faqData.faqs?.length || 0} FAQ topics`);

    const { url, faqs } = faqData;

    // Validate the fetched data
    if (!faqs || !Array.isArray(faqs) || faqs.length === 0) {
      log.info('No FAQs found in the response');
      return noContent();
    }

    // Filter to count only suitable suggestions
    const totalSuitableSuggestions = faqs.reduce((count, faq) => {
      const suitable = (faq.suggestions || []).filter(
        (s) => s.is_answer_suitable && s.is_question_relevant,
      );
      return count + suitable.length;
    }, 0);

    if (totalSuitableSuggestions === 0) {
      log.info('No suitable FAQ suggestions found after filtering');
      return noContent();
    }

    // Create guidance object (similar to summarization)
    const wrappedGuidance = {
      recommendations: [{
        insight: `${totalSuitableSuggestions} FAQ opportunities identified based on brand presence analysis`,
        rationale: 'These FAQs address frequently searched queries related to your brand and products',
        recommendation: 'Add these FAQs to relevant pages to improve content discoverability and user engagement',
        type: 'CONTENT_UPDATE',
      }],
    };

    // Find or create opportunity
    const existingOpportunities = await Opportunity.allBySiteId(siteId);
    let opportunity = existingOpportunities.find(
      (oppty) => oppty.getData()?.subType === 'faqs',
    );

    const entity = createOpportunityData(siteId, auditId, url, wrappedGuidance);

    if (!opportunity) {
      opportunity = await Opportunity.create(entity);
      log.info(`Created new FAQ opportunity: ${opportunity.getId()}`);
    } else {
      opportunity.setAuditId(auditId);
      opportunity.setData({
        ...opportunity.getData(),
        ...entity.data,
      });
      opportunity.setGuidance(wrappedGuidance);
      opportunity.setUpdatedBy('system');
      opportunity = await opportunity.save();
      log.info(`Updated existing FAQ opportunity: ${opportunity.getId()}`);
    }

    // Generate markdown from FAQs
    const suggestionValue = getFaqMarkdown(faqs, log);
    const newData = [{
      suggestionValue,
      bKey: `faqs:${site.getBaseURL()}`,
    }];

    // Sync suggestions using the same pattern as summarization
    await syncSuggestions({
      context,
      opportunity,
      newData,
      buildKey: (dataItem) => dataItem.bKey,
      mapNewSuggestion: (dataItem) => ({
        opportunityId: opportunity.getId(),
        type: 'CONTENT_UPDATE',
        rank: 1,
        status: 'NEW',
        data: {
          suggestionValue: dataItem.suggestionValue,
        },
        kpiDeltas: {
          estimatedKPILift: 0,
        },
      }),
    });

    log.info(`Successfully processed FAQ guidance for site: ${siteId}, opportunity: ${opportunity.getId()}, ${totalSuitableSuggestions} suitable suggestions`);
    return ok();
  } catch (error) {
    log.error(`Error processing FAQ guidance: ${error.message}`, error);
    return badRequest(`Error processing FAQ guidance: ${error.message}`);
  }
}
