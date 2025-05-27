import { createAccessibilityAssistiveOpportunity } from './report-oppty.js';
import { syncSuggestions } from '../../utils/data-access.js';
import { successCriteriaLinks, accessibilityOpportunitiesIDs } from './constants.js';
import { getAuditData } from './data-processing.js';

/**
 * Helper function to format WCAG rule from wcag412 format to "4.1.2 Name, Role, Value" format
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
  
    // Look up the rule in constants
    const ruleInfo = successCriteriaLinks[numberPart];
    if (ruleInfo && ruleInfo.name) {
      return `${formattedNumber} ${ruleInfo.name}`;
    }
  
    // Return formatted number if no name found
    return formattedNumber;
  }
  
  /**
   * Helper function to format individual issue data
   */
  function formatIssue(type, issueData, severity) {
    // Extract WCAG rule from successCriteriaTags (e.g., "wcag412")
    const rawWcagRule = issueData.successCriteriaTags?.[0] || '';
  
    // Format the WCAG rule (e.g., "wcag412" -> "4.1.2 Name, Role, Value")
    const wcagRule = formatWcagRule(rawWcagRule);
  
    // Set priority based on severity
    let priority;
    if (severity === 'critical') {
      priority = 'High';
    } else if (severity === 'serious') {
      priority = 'Medium';
    } else {
      priority = 'Low';
    }
  
    return {
      type,
      description: issueData.description || '',
      wcagRule,
      wcagLevel: issueData.level || '',
      severity,
      priority,
      occurrences: issueData.count || 0,
      htmlWithIssues: issueData.htmlWithIssues || [],
      failureSummary: issueData.failureSummary || '',
    };
  }
  
  /**
   * Groups accessibility issues by URL for individual opportunity creation
   * @param {Object} accessibilityData - The accessibility data to process
   * @returns {Object} Object with data array containing URLs and their issues
   */
  export function aggregateAccessibilityIssues(accessibilityData) {
    if (!accessibilityData) {
      return { data: [] };
    }
  
    const data = [];
  
    // Process each page (skip 'overall' summary)
    for (const [url, pageData] of Object.entries(accessibilityData)) {
      if (url !== 'overall') {
        const pageIssues = {
          type: 'url',
          url,
          issues: [],
        };
  
        const { violations } = pageData;
  
        // Process critical issues (only those in our interest list)
        if (violations.critical?.items) {
          for (const [issueType, issueData] of Object.entries(violations.critical.items)) {
            if (accessibilityOpportunitiesIDs.includes(issueType)) {
              pageIssues.issues.push(formatIssue(issueType, issueData, 'critical'));
            }
          }
        }
  
        // Process serious issues (only those in our interest list)
        if (violations.serious?.items) {
          for (const [issueType, issueData] of Object.entries(violations.serious.items)) {
            if (accessibilityOpportunitiesIDs.includes(issueType)) {
              pageIssues.issues.push(formatIssue(issueType, issueData, 'serious'));
            }
          }
        }
  
        // Only add pages that have issues
        if (pageIssues.issues.length > 0) {
          data.push(pageIssues);
        }
      }
    }
  
    return { data };
  }

export async function createIndividualOpportunity(opportunityInstance, auditData, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  try {
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
    return { opportunity };
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
}

export async function createIndividualOpportunitySuggestions(
  opportunity,
  aggregatedData,
  context,
  log,
) {
  const buildKey = (data) => data.url;
  
  try {
    await syncSuggestions({
      opportunity,
      newData: aggregatedData.data,
      context,
      buildKey,
      mapNewSuggestion: (urlData) => ({
        opportunityId: opportunity.getId(),
        type: 'CONTENT_UPDATE',
        rank: urlData.issues.reduce((total, issue) => total + issue.occurrences, 0), // Rank by total occurrences
        data: {
          url: urlData.url,
          type: "url",
          issues: urlData.issues,
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

export async function createAccessibilityIndividualOpportunities(accessibilityData, context) {
    const {
      site, log,
    } = context;
  
    log.info(`[A11yAudit] Step 2: Creating accessibility opportunities with data for ${site.getBaseURL()}`);
  
    // Get individual opportunities data
    const aggregatedData = aggregateAccessibilityIssues(accessibilityData);
  
    if (!aggregatedData || !aggregatedData.data || aggregatedData.data.length === 0) {
      log.info(`[A11yAudit] No individual accessibility opportunities found for ${site.getBaseURL()}`);
      return {
        status: 'NO_OPPORTUNITIES',
        message: 'No accessibility issues found in tracked categories',
        data: [],
      };
    }

    try {
      // Get the same audit data that report opportunities use
      const auditData = await getAuditData(site, 'accessibility');
      
      // 1. Create the accessibility assistive opportunity
      const opportunityInstance = createAccessibilityAssistiveOpportunity();
      let opportunityRes;
      
      try {
        opportunityRes = await createIndividualOpportunity(opportunityInstance, auditData, context);
      } catch (error) {
        log.error(`Failed to create individual accessibility opportunity: ${error.message}`);
        throw new Error(error.message);
      }
      
      const { opportunity } = opportunityRes;
      
      // 2. Create the suggestions for the opportunity
      try {
        await createIndividualOpportunitySuggestions(opportunity, aggregatedData, context, log);
      } catch (error) {
        log.error(`Failed to create individual accessibility opportunity suggestions: ${error.message}`);
        throw new Error(error.message);
      }
  
      const totalIssues = aggregatedData.data.reduce((total, page) => total + page.issues.reduce((pageTotal, issue) => pageTotal + issue.occurrences, 0), 0);
      const totalSuggestions = aggregatedData.data.length;
  
      log.info(`[A11yAudit] Created accessibility opportunity with ${totalSuggestions} URL suggestions for ${site.getBaseURL()}`);
  
      return {
        status: 'OPPORTUNITIES_CREATED',
        opportunitiesCount: 1, // One opportunity
        suggestionsCount: totalSuggestions, // One suggestion per URL
        totalIssues,
        pagesWithIssues: aggregatedData.data.length,
        summary: `Created accessibility opportunity with ${totalSuggestions} URL suggestions across ${aggregatedData.data.length} pages`,
        // Send entire aggregated data to UI
        ...aggregatedData,
      };
    } catch (error) {
      log.error(`[A11yAudit] Error creating accessibility opportunities: ${error.message}`, error);
      return {
        status: 'OPPORTUNITIES_FAILED',
        error: error.message,
      };
    }
  }