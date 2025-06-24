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

import { createAccessibilityAssistiveOpportunity } from './report-oppty.js';
import { syncSuggestions } from '../../utils/data-access.js';
import { successCriteriaLinks, accessibilityOpportunitiesMap } from './constants.js';
import { getAuditData } from './data-processing.js';
import { processSuggestionsForMystique } from '../guidance-utils/mystique-data-processing.js';

/**
 * Creates a Mystique message object
 *
 * @param {Object} params - Parameters for creating the message
 * @param {Object} params.suggestionData - The suggestion data
 * @param {Array} params.issuesList - List of issues for this type
 * @param {Object} params.opportunity - The opportunity object
 * @param {string} params.siteId - Site identifier
 * @param {string} params.auditId - Audit identifier
 * @param {string} params.deliveryType - Delivery type
 * @returns {Object} The message object ready for SQS
 */
function createMystiqueMessage({
  suggestionData,
  issuesList,
  opportunity,
  siteId,
  auditId,
  deliveryType,
}) {
  return {
    type: 'guidance:accessibility-remediation',
    siteId: siteId || '',
    auditId: auditId || '',
    deliveryType,
    time: new Date().toISOString(),
    data: {
      url: suggestionData.url,
      opportunity_id: opportunity.getId(),
      suggestion_id: suggestionData.suggestionId,
      issues_list: issuesList,
    },
  };
}

/**
 * Sends a single message to Mystique for a specific issue type
 *
 * @param {Object} params - Parameters for sending the message
 * @param {Object} params.suggestion - The suggestion object
 * @param {Object} params.suggestionData - The suggestion data
 * @param {string} params.issueType - The type of accessibility issue
 * @param {Array} params.issuesList - List of issues for this type
 * @param {Object} params.opportunity - The opportunity object
 * @param {string} params.siteId - Site identifier
 * @param {string} params.auditId - Audit identifier
 * @param {string} params.deliveryType - Delivery type
 * @param {Object} params.sqs - SQS client
 * @param {Object} params.env - Environment variables
 * @param {Object} params.log - Logger instance
 * @returns {Promise<Object>} Result object with success status and details
 */
async function sendMystiqueMessage({
  suggestion,
  suggestionData,
  issueType,
  issuesList,
  opportunity,
  siteId,
  auditId,
  deliveryType,
  sqs,
  env,
  log,
}) {
  const message = createMystiqueMessage({
    suggestionData,
    issuesList,
    opportunity,
    siteId,
    auditId,
    deliveryType,
  });

  try {
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(
      `[A11yIndividual] Sent message to Mystique for suggestion ${
        suggestion.getId ? suggestion.getId() : ''
      } and issue type ${issueType} with ${issuesList.length} issues`,
    );
    return {
      success: true,
      issueType,
      suggestionId: suggestion.getId ? suggestion.getId() : '',
    };
  } catch (error) {
    log.error(
      `[A11yIndividual] Failed to send message to Mystique for suggestion ${
        suggestion.getId ? suggestion.getId() : ''
      } and issue type ${issueType}: ${error.message}`,
    );
    return {
      success: false,
      issueType,
      suggestionId: suggestion.getId ? suggestion.getId() : '',
      error: error.message,
    };
  }
}

/**
 * Helper function to format WCAG rule from internal format to human-readable format
 *
 * Converts WCAG rules from the internal "wcag412" format to the standard
 * "4.1.2 Name, Role, Value" format by:
 * 1. Extracting the numeric part (e.g., "412" from "wcag412")
 * 2. Adding dots between digits (e.g., "412" -> "4.1.2")
 * 3. Looking up the rule name from constants
 *
 * @param {string} wcagRule - The WCAG rule in internal format (e.g., "wcag412")
 * @returns {string} Formatted WCAG rule (e.g., "4.1.2 Name, Role, Value")
 */
export function formatWcagRule(wcagRule) {
  if (!wcagRule || !wcagRule.startsWith('wcag')) {
    return wcagRule; // Return as-is if not in expected format
  }

  // Extract the number part (e.g., "412" from "wcag412")
  const numberPart = wcagRule.replace('wcag', '');

  if (!numberPart || !/^\d+$/.test(numberPart)) {
    return wcagRule; // Return as-is if number part is invalid
  }

  // Format the number with dots (e.g., "412" -> "4.1.2")
  let formattedNumber = '';
  for (let i = 0; i < numberPart.length; i += 1) {
    if (i > 0) formattedNumber += '.';
    formattedNumber += numberPart[i];
  }

  // Look up the rule name in constants for complete description
  const ruleInfo = successCriteriaLinks[numberPart];
  if (ruleInfo && ruleInfo.name) {
    return `${formattedNumber} ${ruleInfo.name}`;
  }

  // Return formatted number if no name found in constants
  return formattedNumber;
}

/**
 * Helper function to format individual accessibility issue data
 *
 * Transforms raw accessibility issue data into a standardized format with:
 * - Formatted WCAG rule information
 * - Complete issue metadata for suggestions
 *
 * @param {string} type - The type of accessibility issue (e.g., "color-contrast")
 * @param {Object} issueData - Raw issue data from accessibility scan
 * @param {string} severity - Issue severity level ("critical", "serious", etc.)
 * @returns {Object} Formatted issue object with all required fields
 */
export function formatIssue(type, issueData, severity) {
  // Extract WCAG rule from successCriteriaTags (e.g., "wcag412")
  const rawWcagRule = issueData.successCriteriaTags?.[0] || '';

  // Format the WCAG rule (e.g., "wcag412" -> "4.1.2 Name, Role, Value")
  const wcagRule = formatWcagRule(rawWcagRule);

  return {
    type,
    description: issueData.description || '',
    wcagRule,
    wcagLevel: issueData.level || '', // AA, AAA, etc.
    severity,
    occurrences: issueData.count || 0,
    htmlWithIssues: issueData.htmlWithIssues || [],
    failureSummary: issueData.failureSummary || '',
  };
}

/**
 * Groups accessibility issues by URL for individual opportunity creation
 *
 * Processes the aggregated accessibility data and creates URL-specific issue groups.
 * Only includes issues that are in our tracked categories (from accessibilityOpportunitiesMap)
 * and only includes URLs that have at least one issue.
 *
 * @param {Object} accessibilityData - The accessibility data to process
 * @param {Object} accessibilityData.overall - Site-wide summary data
 * @param {Object} accessibilityData[url] - Per-URL accessibility data
 * @returns {Object} Object with data array containing URLs and their issues
 */
export function aggregateAccessibilityIssues(accessibilityData) {
  if (!accessibilityData) {
    return { data: [] };
  }

  // Create reverse mapping from issueType to opportunityType
  // This eliminates the O(n³) complexity by converting the innermost loop to O(1) lookup
  const issueTypeToOpportunityMap = {};
  for (const [opportunityType, issuesList] of Object.entries(accessibilityOpportunitiesMap)) {
    for (const issueType of issuesList) {
      issueTypeToOpportunityMap[issueType] = opportunityType;
    }
  }

  // Initialize grouped data structure by opportunity type
  const groupedData = {};
  for (const [opportunityType] of Object.entries(accessibilityOpportunitiesMap)) {
    groupedData[opportunityType] = [];
  }

  // Helper function to process issues for a given severity level
  const processIssuesForSeverity = (items, severity, pageIssuesByType) => {
    for (const [issueType, issueData] of Object.entries(items)) {
      // O(1) lookup instead of O(n) search through all opportunity types
      const opportunityType = issueTypeToOpportunityMap[issueType];
      if (opportunityType) {
        pageIssuesByType[opportunityType].issues.push(
          formatIssue(issueType, issueData, severity),
        );
      }
    }
  };

  // Process each page (skip 'overall' summary which contains site-wide data)
  for (const [url, pageData] of Object.entries(accessibilityData)) {
    if (url !== 'overall' && pageData.violations) {
      // Initialize page issues for each opportunity type
      const pageIssuesByType = {};
      for (const [opportunityType] of Object.entries(accessibilityOpportunitiesMap)) {
        pageIssuesByType[opportunityType] = {
          type: 'url', // Indicates this is a URL-based suggestion
          url,
          issues: [], // Will contain accessibility issues for this opportunity type
        };
      }

      const { violations } = pageData;

      // Process critical issues (only those in our tracked categories)
      if (violations.critical?.items) {
        processIssuesForSeverity(violations.critical.items, 'critical', pageIssuesByType);
      }

      // Process serious issues (only those in our tracked categories)
      if (violations.serious?.items) {
        processIssuesForSeverity(violations.serious.items, 'serious', pageIssuesByType);
      }

      // Add URLs with issues directly to their respective opportunity type groups
      for (const [opportunityType, urlData] of Object.entries(pageIssuesByType)) {
        if (urlData.issues.length > 0) {
          groupedData[opportunityType].push(urlData);
        }
      }
    }
  }

  // Convert grouped data to the desired format
  const formattedData = Object.entries(groupedData)
    .filter(([, urls]) => urls.length > 0) // Only include types that have URLs with issues
    .map(([opportunityType, urls]) => ({
      [opportunityType]: urls,
    }));

  return { data: formattedData };
}

/**
 * Creates an individual accessibility opportunity in the database
 *
 * This function follows the same pattern as createReportOpportunity but for
 * individual opportunities. It creates a single opportunity that will contain
 * multiple suggestions (one per URL with issues).
 *
 * @param {Object} opportunityInstance - The opportunity template
 * @param {Object} auditData - Audit metadata including siteId and auditId
 * @param {Object} context - Audit context with dataAccess and logging
 * @returns {Object} Object containing the created opportunity
 */
export async function createIndividualOpportunity(opportunityInstance, auditData, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  try {
    // Prepare opportunity data with all required fields
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.auditId,
      runbook: opportunityInstance.runbook,
      type: opportunityInstance.type,
      origin: opportunityInstance.origin,
      title: opportunityInstance.title,
      description: opportunityInstance.description,
      tags: opportunityInstance.tags,
      status: opportunityInstance.status,
      data: opportunityInstance.data,
    };
    const opportunity = await Opportunity.create(opportunityData);
    log.debug(`[A11yIndividual] Created opportunity with ID: ${opportunity.getId()}`);
    return { opportunity };
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * Creates suggestions for an individual accessibility opportunity
 *
 * This function follows the same pattern as createReportOpportunitySuggestion but for
 * individual opportunities. Each suggestion represents a URL with its accessibility issues.
 * The suggestions are ranked by total number of issue occurrences.
 *
 * @param {Object} opportunity - The created opportunity object
 * @param {Object} aggregatedData - Data containing URLs and their issues
 * @param {Object} context - Audit context for suggestion creation
 * @param {Object} log - Logger instance
 * @returns {Object} Success status object
 */
export async function createIndividualOpportunitySuggestions(
  opportunity,
  aggregatedData,
  context,
  log,
) {
  // Build unique key for each suggestion based on URL
  const buildKey = (data) => data.url;

  log.debug(`[A11yIndividual] Creating ${aggregatedData.data.length} suggestions for opportunity ${opportunity.getId()}`);

  try {
    await syncSuggestions({
      opportunity,
      newData: aggregatedData.data,
      context,
      buildKey,
      // Map each URL's data to a suggestion format
      mapNewSuggestion: (urlData) => ({
        opportunityId: opportunity.getId(),
        type: 'CODE_CHANGE', // Indicates this requires content updates
        // Rank by total occurrences across all issues for this URL
        rank: urlData.issues.reduce((total, issue) => total + issue.occurrences, 0),
        data: {
          url: urlData.url,
          type: urlData.type,
          issues: urlData.issues, // Array of formatted accessibility issues
        },
      }),
      log,
    });

    // Get the suggestions that were just created/updated
    const suggestions = await opportunity.getSuggestions();
    log.debug(`[A11yIndividual] Retrieved ${suggestions.length} suggestions from opportunity ${opportunity.getId()}`);

    // Debug: Log the opportunity object details
    log.debug(`[A11yIndividual] Opportunity details - ID: ${opportunity.getId()}, Type: ${opportunity.getType ? opportunity.getType() : 'N/A'}`);
    const { sqs, env } = context;
    const siteId = opportunity.getSiteId
      ? opportunity.getSiteId()
      : (context.site && context.site.getId && context.site.getId());
    const auditId = opportunity.getAuditId
      ? opportunity.getAuditId()
      : (context.auditId || (context.audit && context.audit.getId && context.audit.getId()));
    const deliveryType = (context.site && context.site.getDeliveryType && context.site.getDeliveryType()) || 'aem_edge';

    log.debug(`[A11yIndividual] Debug info - suggestions: ${suggestions.length}, sqs: ${!!sqs}, env: ${!!env}, siteId: ${siteId}, auditId: ${auditId}`);

    // Log details about each suggestion for debugging
    suggestions.forEach((suggestion, index) => {
      const suggestionData = suggestion.getData();
      const issueTypes = suggestionData.issues
        ? suggestionData.issues.map((issue) => issue.type) : [];
      log.debug(`[A11yIndividual] Suggestion ${index}: URL=${suggestionData.url}, Issues=[${issueTypes.join(', ')}]`);
    });

    // Process the suggestions directly to create Mystique messages
    const mystiqueData = processSuggestionsForMystique(suggestions);

    log.debug(`[A11yIndividual] Mystique data processed: ${mystiqueData.length} messages to send`);

    if (mystiqueData.length === 0) {
      log.info('[A11yIndividual] No messages to send to Mystique - no matching issue types found');
      return { success: true };
    }

    // Validate required context objects before proceeding
    if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
      log.error(`[A11yIndividual] Missing required context - sqs: ${!!sqs}, env: ${!!env}, queue: ${env?.QUEUE_SPACECAT_TO_MYSTIQUE || 'undefined'}`);
      return { success: false, error: 'Missing SQS context or queue configuration' };
    }

    log.info(`[A11yIndividual] Sending ${mystiqueData.length} messages to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

    const messagePromises = mystiqueData.map(({
      suggestion, suggestionData, issueType, issuesList,
    }) => sendMystiqueMessage({
      suggestion,
      suggestionData,
      issueType,
      issuesList,
      opportunity,
      siteId,
      auditId,
      deliveryType,
      sqs,
      env,
      log,
    }));

    // Wait for all messages to be sent (successfully or with errors)
    const results = await Promise.allSettled(messagePromises);

    // Log summary of results
    const successfulMessages = results.filter((result) => result.status === 'fulfilled' && result.value.success).length;
    const failedMessages = results.filter((result) => result.status === 'fulfilled' && !result.value.success).length;
    const rejectedPromises = results.filter((result) => result.status === 'rejected').length;

    log.info(
      `[A11yIndividual] Message sending completed: ${successfulMessages} successful, ${failedMessages} failed, ${rejectedPromises} rejected`,
    );

    return { success: true };
  } catch (e) {
    log.error(`Failed to create suggestions for opportunity ${opportunity.getId()}: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * Deletes existing individual accessibility opportunities for a site
 *
 * @param {Object} dataAccess - Data access object containing Opportunity model
 * @param {string} siteId - Site identifier
 * @param {string} opportunityType - Type of opportunity to delete
 * @param {Object} log - Logger instance
 * @returns {Promise<number>} Number of deleted opportunities
 */
export async function deleteExistingAccessibilityOpportunities(
  dataAccess,
  siteId,
  opportunityType,
  log,
) {
  const { Opportunity } = dataAccess;

  const allOpportunities = await Opportunity.allBySiteId(siteId);
  const existingOpportunities = allOpportunities.filter(
    (opportunity) => opportunity.getType() === opportunityType,
  );

  if (existingOpportunities.length > 0) {
    const count = existingOpportunities.length;
    log.info(`[A11yIndividual] Found ${count} existing opportunities of type ${opportunityType} - deleting`);
    try {
      await Promise.all(existingOpportunities.map(async (opportunity) => {
        await opportunity.remove();
        log.debug(`[A11yIndividual] Deleted opportunity ID: ${opportunity.getId()}`);
      }));
      log.info(`[A11yIndividual] Successfully deleted all existing opportunities of type ${opportunityType}`);
      return existingOpportunities.length;
    } catch (error) {
      log.error(`[A11yIndividual] Error deleting existing opportunities of type ${opportunityType}: ${error.message}`);
      throw new Error(`Failed to delete existing opportunities: ${error.message}`);
    }
  } else {
    log.info(`[A11yIndividual] No existing opportunities of type ${opportunityType} found - proceeding with creation`);
    return 0;
  }
}

/**
 * Calculates metrics from aggregated accessibility data
 *
 * @param {Object} aggregatedData - Aggregated accessibility data
 * @returns {Object} Calculated metrics
 */
export function calculateAccessibilityMetrics(aggregatedData) {
  const totalIssues = aggregatedData.data.reduce((total, page) => (
    total + page.issues.reduce((pageTotal, issue) => pageTotal + issue.occurrences, 0)
  ), 0);

  const totalSuggestions = aggregatedData.data.length;
  const pagesWithIssues = aggregatedData.data.length;

  return {
    totalIssues,
    totalSuggestions,
    pagesWithIssues,
  };
}

/**
 * Main function to create accessibility individual opportunities
 *
 * This is the main entry point that orchestrates the creation of individual
 * accessibility opportunities. It follows the same pattern as report opportunities:
 * 1. Aggregates accessibility issues by URL
 * 2. Creates opportunities for each opportunity type that has issues
 * 3. Creates suggestions for each URL that has accessibility issues
 *
 * The resulting structure provides actionable, URL-specific accessibility improvements
 * that complement the site-wide report opportunities.
 *
 * @param {Object} accessibilityData - Processed accessibility data from aggregation
 * @param {Object} context - Audit context containing site, log, and other utilities
 * @returns {Object} Result object with status, metrics, and created data
 */
export async function createAccessibilityIndividualOpportunities(accessibilityData, context) {
  const {
    site, log, dataAccess,
  } = context;

  log.info(`[A11yIndividual] Creating accessibility opportunities for ${site.getBaseURL()}`);

  // Step 1: Aggregate accessibility issues by URL
  const aggregatedData = aggregateAccessibilityIssues(accessibilityData);

  // Early return if no actionable issues found
  if (!aggregatedData || !aggregatedData.data || aggregatedData.data.length === 0) {
    log.info(`[A11yIndividual] No individual accessibility opportunities found for ${site.getBaseURL()}`);
    return {
      status: 'NO_OPPORTUNITIES',
      message: 'No accessibility issues found in tracked categories',
      data: [],
    };
  }

  try {
    // Get the same audit data that report opportunities use for consistency
    const auditData = await getAuditData(site, 'accessibility');
    log.debug(`[A11yIndividual] Using auditId: ${auditData.auditId}`);

    // Map opportunity types to their creation functions
    const opportunityCreators = {
      'a11y-assistive': createAccessibilityAssistiveOpportunity,
      // Add more opportunity types here as they are created
    };

    // Create separate opportunities for each opportunity type that has data
    const opportunityResults = await Promise.all(
      aggregatedData.data.map(
        async (opportunityTypeData) => {
          // Each item is an object with one key (the opportunity type) and an array of URLs
          const [opportunityType, typeData] = Object.entries(opportunityTypeData)[0];

          log.debug(`[A11yIndividual] Creating opportunity for type: ${opportunityType}`);

          // Get the appropriate opportunity creator function
          const creatorFunc = opportunityCreators[opportunityType];
          if (!creatorFunc) {
            const availableCreators = Object.keys(opportunityCreators).join(', ');
            log.error(
              `[A11yIndividual] No opportunity creator found for type: ${opportunityType}. Available creators: ${availableCreators}`,
            );
            throw new Error(`No opportunity creator found for type: ${opportunityType}`);
          }

          const opportunityInstance = creatorFunc();

          // Step 2a: Delete existing opportunities for this specific type
          await deleteExistingAccessibilityOpportunities(
            dataAccess,
            auditData.siteId,
            opportunityInstance.type,
            log,
          );

          // Step 2b: Create the new accessibility opportunity for this type
          let opportunityRes;
          try {
            opportunityRes = await createIndividualOpportunity(
              opportunityInstance,
              auditData,
              context,
            );
          } catch (error) {
            log.error(
              `Failed to create individual accessibility opportunity for ${opportunityType}: ${error.message}`,
            );
            throw new Error(error.message);
          }

          const { opportunity } = opportunityRes;

          // Step 3: Create the suggestions for this opportunity type only
          const typeSpecificData = { data: typeData };
          try {
            await createIndividualOpportunitySuggestions(
              opportunity,
              typeSpecificData,
              context,
              log,
            );
          } catch (error) {
            const errorMsg = `Failed to create individual accessibility opportunity suggestions for ${opportunityType}: ${error.message}`;
            log.error(errorMsg);
            throw new Error(error.message);
          }

          // Calculate metrics for this opportunity type
          const typeMetrics = calculateAccessibilityMetrics(typeSpecificData);

          // Calculate pages with issues for this specific opportunity type
          const uniqueUrlsForType = new Set(typeData.map((urlData) => urlData.url));
          const pagesWithIssuesForType = uniqueUrlsForType.size;

          const logMsg = `[A11yIndividual] Created opportunity for ${opportunityType} with ${typeMetrics.totalSuggestions} suggestions (${typeMetrics.totalIssues} issues) across ${pagesWithIssuesForType} pages`;
          log.info(logMsg);

          // Return the individual opportunity result with its own status
          return {
            status: 'OPPORTUNITY_CREATED',
            opportunityType,
            opportunityId: opportunity.getId(),
            suggestionsCount: typeMetrics.totalSuggestions,
            totalIssues: typeMetrics.totalIssues,
            pagesWithIssues: pagesWithIssuesForType,
            summary: `Created ${opportunityType} opportunity with ${typeMetrics.totalSuggestions} suggestions across ${pagesWithIssuesForType} pages`,
          };
        },
      ),
    );

    log.info(`[A11yIndividual] Successfully created ${opportunityResults.length} individual accessibility opportunities`);

    return {
      opportunities: opportunityResults, // Return individual opportunity details
      // Include the aggregated data for UI consumption
      ...aggregatedData,
    };
  } catch (error) {
    log.error(`[A11yIndividual] Error creating accessibility opportunities: ${error.message}`, error);
    return {
      status: 'OPPORTUNITIES_FAILED',
      error: error.message,
    };
  }
}

// Export these for testing
export { createMystiqueMessage, sendMystiqueMessage };
