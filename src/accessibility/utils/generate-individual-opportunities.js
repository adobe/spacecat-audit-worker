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
import { successCriteriaLinks, accessibilityOpportunitiesIDs } from './constants.js';
import { getAuditData } from './data-processing.js';

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
function formatWcagRule(wcagRule) {
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
 * - Priority mapping based on severity
 * - Complete issue metadata for suggestions
 *
 * @param {string} type - The type of accessibility issue (e.g., "color-contrast")
 * @param {Object} issueData - Raw issue data from accessibility scan
 * @param {string} severity - Issue severity level ("critical", "serious", etc.)
 * @returns {Object} Formatted issue object with all required fields
 */
function formatIssue(type, issueData, severity) {
  // Extract WCAG rule from successCriteriaTags (e.g., "wcag412")
  const rawWcagRule = issueData.successCriteriaTags?.[0] || '';

  // Format the WCAG rule (e.g., "wcag412" -> "4.1.2 Name, Role, Value")
  const wcagRule = formatWcagRule(rawWcagRule);

  // Map severity levels to priority levels for UI display
  let priority;
  if (severity === 'critical') {
    priority = 'High';
  } else if (severity === 'serious') {
    priority = 'Medium';
  } else {
    priority = 'Low'; // For moderate, minor, etc.
  }

  return {
    type,
    description: issueData.description || '',
    wcagRule,
    wcagLevel: issueData.level || '', // AA, AAA, etc.
    severity,
    priority,
    occurrences: issueData.count || 0,
    htmlWithIssues: issueData.htmlWithIssues || [],
    failureSummary: issueData.failureSummary || '',
  };
}

/**
 * Groups accessibility issues by URL for individual opportunity creation
 *
 * Processes the aggregated accessibility data and creates URL-specific issue groups.
 * Only includes issues that are in our tracked categories (accessibilityOpportunitiesIDs)
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

  const data = [];

  // Process each page (skip 'overall' summary which contains site-wide data)
  for (const [url, pageData] of Object.entries(accessibilityData)) {
    if (url !== 'overall') {
      const pageIssues = {
        type: 'url', // Indicates this is a URL-based suggestion
        url,
        issues: [], // Will contain all accessibility issues for this URL
      };

      const { violations } = pageData;

      // Process critical issues (only those in our tracked categories)
      if (violations.critical?.items) {
        for (const [issueType, issueData] of Object.entries(violations.critical.items)) {
          // Only include issues we're tracking for opportunities
          if (accessibilityOpportunitiesIDs.includes(issueType)) {
            pageIssues.issues.push(formatIssue(issueType, issueData, 'critical'));
          }
        }
      }

      // Process serious issues (only those in our tracked categories)
      if (violations.serious?.items) {
        for (const [issueType, issueData] of Object.entries(violations.serious.items)) {
          // Only include issues we're tracking for opportunities
          if (accessibilityOpportunitiesIDs.includes(issueType)) {
            pageIssues.issues.push(formatIssue(issueType, issueData, 'serious'));
          }
        }
      }

      // Only add pages that have issues to avoid empty suggestions
      if (pageIssues.issues.length > 0) {
        data.push(pageIssues);
      }
    }
  }

  return { data };
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
    return { success: true };
  } catch (e) {
    log.error(`Failed to create suggestions for opportunity ${opportunity.getId()}: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * Main function to create accessibility individual opportunities
 *
 * This is the main entry point that orchestrates the creation of individual
 * accessibility opportunities. It follows the same pattern as report opportunities:
 * 1. Aggregates accessibility issues by URL
 * 2. Creates a single opportunity using the assistive opportunity template
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

    // Step 2a: Check for existing assistive opportunities and delete if found
    const { Opportunity } = dataAccess;
    const opportunityInstance = createAccessibilityAssistiveOpportunity();

    const allOpportunities = await Opportunity.allBySiteId(auditData.siteId);
    const existingOpportunities = allOpportunities.filter(
      (opportunity) => opportunity.getType() === opportunityInstance.type,
    );

    if (existingOpportunities.length > 0) {
      log.info(`[A11yIndividual] Found ${existingOpportunities.length} existing assistive opportunities - deleting them`);
      try {
        await Promise.all(existingOpportunities.map(async (opportunity) => {
          await opportunity.remove();
          log.debug(`[A11yIndividual] Deleted assistive opportunity ID: ${opportunity.getId()}`);
        }));
        log.info('[A11yIndividual] Successfully deleted all existing assistive opportunities');
      } catch (error) {
        log.error(`[A11yIndividual] Error deleting existing assistive opportunities: ${error.message}`);
        throw new Error(`Failed to delete existing opportunities: ${error.message}`);
      }
    } else {
      log.info('[A11yIndividual] No existing assistive opportunities found - proceeding with creation');
    }

    // Step 2b: Create the new accessibility assistive opportunity
    let opportunityRes;

    try {
      opportunityRes = await createIndividualOpportunity(opportunityInstance, auditData, context);
    } catch (error) {
      log.error(`Failed to create individual accessibility opportunity: ${error.message}`);
      throw new Error(error.message);
    }

    const { opportunity } = opportunityRes;

    // Step 3: Create the suggestions for the opportunity (one per URL with issues)
    try {
      await createIndividualOpportunitySuggestions(opportunity, aggregatedData, context, log);
    } catch (error) {
      log.error(`Failed to create individual accessibility opportunity suggestions: ${error.message}`);
      throw new Error(error.message);
    }

    // Calculate metrics for reporting
    const totalIssues = aggregatedData.data.reduce((total, page) => (
      total + page.issues.reduce((pageTotal, issue) => pageTotal + issue.occurrences, 0)
    ), 0);
    const totalSuggestions = aggregatedData.data.length;

    log.info(`[A11yIndividual] Created 1 opportunity with ${totalSuggestions} suggestions (${totalIssues} total issues)`);

    return {
      status: 'OPPORTUNITIES_CREATED',
      opportunitiesCount: 1, // One opportunity containing multiple suggestions
      suggestionsCount: totalSuggestions, // One suggestion per URL with issues
      totalIssues,
      pagesWithIssues: aggregatedData.data.length,
      summary: `Created accessibility opportunity with ${totalSuggestions} URL suggestions across ${aggregatedData.data.length} pages`,
      // Include the aggregated data for potential UI consumption
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
