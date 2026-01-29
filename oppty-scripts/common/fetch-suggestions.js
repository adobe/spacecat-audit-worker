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

import { createDataAccess } from '@adobe/spacecat-shared-data-access';
import { OPPORTUNITY_TYPE_MAPPING, SUGGESTION_STATUSES } from '../opportunities/config.js';

/**
 * Initialize data access with environment configuration
 * Uses the new unified single-table design
 * @param {object} log - Logger instance
 * @returns {object} Data access instance
 */
function initializeDataAccess(log) {
  try {
    // Set up required environment variables with defaults
    if (!process.env.DYNAMO_TABLE_NAME_DATA) {
      process.env.DYNAMO_TABLE_NAME_DATA = 'spacecat-services-data';
      log.debug('Set default DYNAMO_TABLE_NAME_DATA');
    }

    // Initialize data access with unified single-table configuration
    const config = {
      tableNameData: process.env.DYNAMO_TABLE_NAME_DATA,
      indexNameAllByStatus: 'gsi1pk-gsi1sk-index',
      indexNameAllBySiteId: 'gsi2pk-gsi2sk-index',
      region: process.env.AWS_REGION || 'us-east-1',
    };

    const dataAccess = createDataAccess(config);

    log.debug('Data access initialized successfully with single-table design');
    return dataAccess;
  } catch (error) {
    log.error('Failed to initialize data access', { error: error.message });
    throw new Error(`Data access initialization failed: ${error.message}`);
  }
}

/**
 * Fetch opportunities for a site by type (all statuses)
 * @param {string} siteId - Site UUID
 * @param {string} opportunityType - Opportunity type (e.g., 'backlinks', 'image-alt-text')
 * @param {object} dataAccess - Data access instance
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Array of opportunities
 */
async function fetchOpportunitiesByType(siteId, opportunityType, dataAccess, log) {
  const { Opportunity } = dataAccess;

  try {
    // Fetch ALL opportunities for the site (all statuses: NEW, RESOLVED, IGNORED, IN_PROGRESS)
    const opportunities = await Opportunity.allBySiteId(siteId);

    // Filter by opportunity type
    const filteredOpportunities = opportunities.filter(
      (opp) => opp.getType() === opportunityType,
    );

    log.debug(`Found ${filteredOpportunities.length} opportunities of type '${opportunityType}' for site ${siteId}`);

    // Log status breakdown if verbose
    const statusCounts = filteredOpportunities.reduce((acc, opp) => {
      const status = opp.getStatus?.() || opp.status || 'UNKNOWN';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    if (Object.keys(statusCounts).length > 0) {
      log.debug(`Opportunity status breakdown: ${JSON.stringify(statusCounts)}`);
    }

    return filteredOpportunities;
  } catch (error) {
    log.error(`Failed to fetch opportunities for site ${siteId}`, { error: error.message });
    throw new Error(`Failed to fetch opportunities: ${error.message}`);
  }
}

/**
 * Fetch suggestions for an opportunity filtered by status
 * @param {object} opportunity - Opportunity object
 * @param {string} status - Suggestion status to filter by
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Array of suggestions
 */
async function fetchSuggestionsByStatus(opportunity, status, log) {
  try {
    const allSuggestions = await opportunity.getSuggestions();

    // Filter by status if specified
    const filteredSuggestions = status
      ? allSuggestions.filter((sugg) => sugg.getStatus() === status)
      : allSuggestions;

    log.debug(`Found ${filteredSuggestions.length} suggestions with status '${status}' for opportunity ${opportunity.getId()}`);

    return filteredSuggestions;
  } catch (error) {
    log.error(`Failed to fetch suggestions for opportunity ${opportunity.getId()}`, { error: error.message });
    throw new Error(`Failed to fetch suggestions: ${error.message}`);
  }
}

/**
 * Main function to fetch suggestions for a site by opportunity type and status
 * @param {object} params - Parameters
 * @param {string} params.siteId - Site UUID
 * @param {string} params.opportunityType - Opportunity type
 *  (CLI format: 'alt-text', 'broken-backlinks', etc.)
 * @param {string} [params.status] - Suggestion status to filter by (defaults to OUTDATED)
 * @param {boolean} [params.skipFetch] - If true, only initialize dataAccess
 *  without fetching suggestions
 * @param {object} params.log - Logger instance
 * @returns {Promise<object>} Object containing opportunities and their suggestions
 */
export async function fetchSuggestions({
  siteId,
  opportunityType,
  status = SUGGESTION_STATUSES.OUTDATED,
  skipFetch = false,
  log,
}) {
  if (!siteId) {
    throw new Error('siteId is required');
  }

  if (!opportunityType) {
    throw new Error('opportunityType is required');
  }

  // Map CLI opportunity type to internal audit type
  const internalType = OPPORTUNITY_TYPE_MAPPING[opportunityType];
  if (!internalType) {
    throw new Error(`Invalid opportunity type: ${opportunityType}. Valid types: ${Object.keys(OPPORTUNITY_TYPE_MAPPING).join(', ')}`);
  }

  // Validate status
  const validStatuses = Object.values(SUGGESTION_STATUSES);
  if (status && !validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Valid statuses: ${validStatuses.join(', ')}`);
  }

  // Initialize data access (now synchronous with single-table design)
  const dataAccess = initializeDataAccess(log);

  // If skipFetch is true, return early with just dataAccess
  if (skipFetch) {
    log.debug('Skipping fetch, returning dataAccess only');
    return {
      dataAccess,
      site: null,
      opportunities: [],
      totalSuggestions: 0,
    };
  }

  log.info(`Fetching suggestions for site ${siteId}, type: ${opportunityType} (${internalType}), status: ${status}`);

  // Fetch site to verify it exists
  const { Site } = dataAccess;
  const site = await Site.findById(siteId);
  if (!site) {
    throw new Error(`Site not found: ${siteId}`);
  }

  log.info(`Site found: ${site.getBaseURL()}`);

  // Fetch opportunities by type
  const opportunities = await fetchOpportunitiesByType(siteId, internalType, dataAccess, log);

  if (opportunities.length === 0) {
    log.warn(`No opportunities found for site ${siteId} with type ${internalType}`);
    return {
      site,
      dataAccess,
      opportunities: [],
      totalSuggestions: 0,
    };
  }

  // Fetch suggestions for each opportunity in parallel
  const results = await Promise.all(
    opportunities.map(async (opportunity) => {
      const suggestions = await fetchSuggestionsByStatus(opportunity, status, log);
      return {
        opportunity,
        suggestions,
      };
    }),
  );

  const totalSuggestions = results.reduce((sum, result) => sum + result.suggestions.length, 0);

  log.info(`Total suggestions found: ${totalSuggestions} across ${opportunities.length} opportunities`);

  return {
    site,
    dataAccess,
    opportunities: results,
    totalSuggestions,
  };
}

export default fetchSuggestions;
