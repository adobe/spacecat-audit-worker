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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { FORM_OPPORTUNITY_TYPES, formOpportunitiesMap } from '../constants.js';
import { getSuccessCriteriaDetails, sendMessageToFormsQualityAgent, sendMessageToMystiqueForGuidance } from '../utils.js';
import { updateStatusToIgnored } from '../../accessibility/utils/scrape-utils.js';
import {
  aggregateAccessibilityIssues,
  createIndividualOpportunitySuggestions,
} from '../../accessibility/utils/generate-individual-opportunities.js';
import { aggregateAccessibilityData, sendRunImportMessage } from '../../accessibility/utils/data-processing.js';
import { URL_SOURCE_SEPARATOR, A11Y_METRICS_AGGREGATOR_IMPORT_TYPE, WCAG_CRITERIA_COUNTS } from '../../accessibility/utils/constants.js';

const filterAccessibilityOpportunities = (opportunities) => opportunities.filter((opportunity) => opportunity.getTags()?.includes('Forms Accessibility'));

/**
 * Creates individual suggestions for form accessibility issues from Mystique data
 * Each htmlWithIssues creates one suggestion
 *
 * @param {Array} a11yData - Array of form accessibility data from Mystique
 * @param {Object} opportunity - The existing form opportunity to attach suggestions to
 * @param {Object} context - The context object containing log and other utilities
 * @returns {Promise<void>}
 */
export async function createFormAccessibilitySuggestionsFromMystique(
  a11yData,
  opportunity,
  context,
) {
  const { log } = context;

  try {
    log.info('[FormMystiqueSuggestions] Creating individual suggestions from Mystique data');

    // Create aggregated issues from M messages - Must be sync with aggregateAccessibilityIssues
    const formAccessibilityData = [];

    a11yData
      .filter((formData) => formData.a11yIssues?.length > 0)
      .forEach((formData) => {
        const { form: pageUrl, formSource: source, a11yIssues } = formData;

        a11yIssues.forEach((issue) => {
          const { type, severity, htmlWithIssues } = issue;
          let understandingUrl = '';
          try {
            const { understandingUrl: docUrl } = getSuccessCriteriaDetails(issue.wcagRule);
            understandingUrl = docUrl;
          } catch (error) {
            log.error(`[FormMystiqueSuggestions] Error getting success criteria details: ${error.message}`);
            return;
          }
          // Create one suggestion for each htmlWithIssues
          if (htmlWithIssues && htmlWithIssues.length > 0) {
            htmlWithIssues.forEach((htmlIssue) => {
              const formattedIssue = {
                type,
                description: issue.description,
                wcagRule: issue.wcagRule,
                wcagLevel: issue.wcagLevel,
                understandingUrl,
                severity,
                occurrences: 1,
                htmlWithIssues: [htmlIssue],
                failureSummary: issue.failureSummary,
              };

              const urlObject = {
                type: 'url',
                url: pageUrl,
                ...(source && { source }),
                issues: [formattedIssue],
                aiGenerated: issue.aiGenerated || false,
              };

              formAccessibilityData.push(urlObject);
            });
          }
        });
      });

    // Early return if no actionable issues found
    if (formAccessibilityData.length === 0) {
      log.info('[FormMystiqueSuggestions] No individual form accessibility suggestions to create from Mystique data');
      return;
    }

    log.info(`[FormMystiqueSuggestions] Creating ${formAccessibilityData.length} individual suggestions for form accessibility from Mystique data`);

    // Create suggestions using the existing individual opportunity suggestion creation logic
    const typeSpecificData = { data: formAccessibilityData };
    await createIndividualOpportunitySuggestions(
      opportunity,
      typeSpecificData,
      context,
      log,
    );

    log.info('[FormMystiqueSuggestions] Successfully created individual suggestions for form accessibility from Mystique data');
  } catch (error) {
    log.error(`[FormMystiqueSuggestions] Error creating individual suggestions from Mystique data: ${error.message}`);
    // Don't throw error to avoid breaking the existing flow
  }
}

/**
 * Create a11y opportunity for the given siteId and auditId
 * @param {string} auditId - The auditId of the audit
 * @param {string} siteId - The siteId of the site
 * @param {object} a11yData - The a11y data
 * @param {object} context - The context object
 * @returns {Promise<void>}
 */
async function createOrUpdateOpportunity(auditId, siteId, a11yData, context, opportunityId = null) {
  const {
    dataAccess, log,
  } = context;
  const { Opportunity } = dataAccess;
  let opportunity = null;

  try {
    if (opportunityId) {
      opportunity = await Opportunity.findById(opportunityId);
    }

    if (a11yData?.length === 0) {
      log.info(`[Form Opportunity] [Site Id: ${siteId}] No a11y data found to create or update opportunity `);
      return opportunity;
    }

    const filteredA11yData = a11yData.filter((a11y) => a11y.a11yIssues?.length > 0);
    if (filteredA11yData.length === 0) {
      log.info(`[Form Opportunity] [Site Id: ${siteId}] No a11y issues found to create or update opportunity`);
      return opportunity;
    }

    const a11yOpptyData = filteredA11yData.map((a11yOpty) => {
      const a11yIssues = a11yOpty.a11yIssues.map((issue) => ({
        ...issue,
        successCriterias: issue.successCriterias.map(
          (criteria) => getSuccessCriteriaDetails(criteria),
        ),
      }));
      return {
        form: a11yOpty.form,
        formSource: a11yOpty.formSource,
        a11yIssues,
      };
    });

    // Update existing opportunity
    if (opportunity) {
      const data = opportunity.getData();
      const existingA11yData = data.accessibility;

      // Merge new data with existing data
      const mergedData = [...existingA11yData];
      a11yOpptyData.forEach((newForm) => {
        const existingFormIndex = mergedData.findIndex(
          (form) => form.form === newForm.form && form.formSource === newForm.formSource,
        );

        if (existingFormIndex !== -1) {
          // Update existing form's a11yIssues
          mergedData[existingFormIndex].a11yIssues = [
            ...mergedData[existingFormIndex].a11yIssues,
            ...newForm.a11yIssues,
          ];
        } else {
          // Add new form data
          mergedData.push({
            form: newForm.form,
            formSource: newForm.formSource,
            a11yIssues: newForm.a11yIssues,
          });
        }
      });

      opportunity.setData({
        ...data,
        accessibility: mergedData,
      });
      opportunity = await opportunity.save();
      log.info(`[Form Opportunity] [Site Id: ${siteId}] Updated existing a11y opportunity`);
    }

    // If no existing opportunity, create new opportunity
    if (!opportunity) {
      // change status to IGNORED for older opportunities
      await updateStatusToIgnored(dataAccess, siteId, log, filterAccessibilityOpportunities);

      const opportunityData = {
        siteId,
        auditId,
        runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/Ebpoflp2gHFNl4w5-9C7dFEBBHHE4gTaRzHaofqSxJMuuQ?e=Ss6mep',
        type: FORM_OPPORTUNITY_TYPES.FORM_A11Y,
        origin: 'AUTOMATION',
        title: 'Accessibility - Assistive technology is incompatible on form',
        description: '',
        tags: [
          'Forms Accessibility',
        ],
        data: {
          accessibility: a11yOpptyData,
        },
      };
      opportunity = await Opportunity.create(opportunityData);
      log.info(`[Form Opportunity] [Site Id: ${siteId}] Created new a11y opportunity`);
    }
  } catch (e) {
    log.error(`[Form Opportunity] [Site Id: ${siteId}] Failed to create/update a11y opportunity with error: ${e.message}`);
    throw new Error(`[Form Opportunity] [Site Id: ${siteId}] Failed to create/update a11y opportunity with error: ${e.message}`);
  }
  return opportunity;
}

function getWCAGCriteriaString(criteria) {
  const { name, criteriaNumber } = getSuccessCriteriaDetails(criteria);
  return `${criteriaNumber} ${name}`;
}

/**
 * Transforms axe-core violation format to the expected output format
 * This is a temporary function to transform sites' accessibility schema to forms' old schema
 * to prevent impact on UI
 * @param {Object} axeData - The axe-core violation data
 * @returns {Object} Form with accessibility issues containing form, formSource, and a11yIssues
 */
export function transformAxeViolationsToA11yData(axeData) {
  const { violations, url, formSource } = axeData;
  const a11yIssues = [];

  // Process critical violations
  if (violations?.critical?.items) {
    Object.values(violations.critical.items).forEach((violation) => {
      a11yIssues.push({
        issue: violation.description,
        level: violation.level,
        successCriterias: violation.successCriteriaTags.map(getWCAGCriteriaString),
        htmlWithIssues: violation.htmlWithIssues,
        recommendation: violation.failureSummary,
      });
    });
  }

  // Process serious violations
  if (violations?.serious?.items) {
    Object.values(violations.serious.items).forEach((violation) => {
      a11yIssues.push({
        issue: violation.description,
        level: violation.level,
        successCriterias: violation.successCriteriaTags.map(getWCAGCriteriaString),
        htmlWithIssues: violation.htmlWithIssues,
        recommendation: violation.failureSummary,
      });
    });
  }

  return {
    form: url,
    formSource,
    a11yIssues,
  };
}

/**
 * Creates individual suggestions for form accessibility issues
 * This method processes the aggregated form data and creates individual suggestions
 * similar to how accessibility individual opportunities work
 *
 * @param {Object} aggregatedData - The aggregated form accessibility data
 * @param {Object} opportunity - The existing form opportunity to attach suggestions to
 * @param {Object} context - The context object containing log and other utilities
 * @returns {Promise<void>}
 */
async function createFormAccessibilityIndividualSuggestions(aggregatedData, opportunity, context) {
  const { log } = context;

  try {
    log.info('[FormIndividualSuggestions] Creating individual suggestions for form accessibility');

    // Transform the aggregated form data to the format expected by aggregateAccessibilityIssues
    // The aggregated data has format: { url1: {violations: {...}}, url2: {violations: {...}} }
    // We need to transform it to match the accessibility data structure
    const transformedAccessibilityData = {};

    Object.entries(aggregatedData).forEach(([key, data]) => {
      // Skip the 'overall' key as it contains summary data
      if (key === 'overall') return;

      const { violations } = data;
      if (violations) {
        transformedAccessibilityData[key] = { violations };
      }
    });

    const aggregatedIssues = aggregateAccessibilityIssues(
      transformedAccessibilityData,
      formOpportunitiesMap,
    );

    // Early return if no actionable issues found
    if (!aggregatedIssues || !aggregatedIssues.data || aggregatedIssues.data.length === 0) {
      log.info('[FormIndividualSuggestions] No individual form accessibility suggestions to create');
      return;
    }

    log.info(`[FormIndividualSuggestions] Found ${aggregatedIssues.data.length} opportunity types with individual suggestions`);

    // Process each opportunity type that has data
    // Use Promise.all to handle multiple opportunity types in parallel
    await Promise.all(
      aggregatedIssues.data.map(async (opportunityTypeData) => {
        // Each item is an object with one key (the opportunity type) and an array of URLs
        const [opportunityType, typeData] = Object.entries(opportunityTypeData)[0];

        if (opportunityType === 'form-accessibility') {
          log.info(`[FormIndividualSuggestions] Creating ${typeData.length} individual suggestions for form accessibility`);

          // Create suggestions using the existing individual opportunity suggestion creation logic
          const typeSpecificData = { data: typeData };
          await createIndividualOpportunitySuggestions(
            opportunity,
            typeSpecificData,
            context,
            log,
          );

          log.info('[FormIndividualSuggestions] Successfully created individual suggestions for form accessibility');
        }
      }),
    );
  } catch (error) {
    log.error(`[FormIndividualSuggestions] Error creating individual suggestions: ${error.message}`);
    // Don't throw error to avoid breaking the existing flow
  }
}

export async function createAccessibilityOpportunity(auditData, context) {
  const {
    log, site, s3Client, env, sqs,
  } = context;
  const siteId = auditData.getSiteId();
  const auditId = auditData.getAuditId();
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const version = new Date().toISOString().split('T')[0];
  const outputKey = `forms-accessibility/${site.getId()}/${version}-final-result.json`;
  try {
    const aggregationResult = await aggregateAccessibilityData(
      s3Client,
      bucketName,
      siteId,
      log,
      outputKey,
      Audit.AUDIT_TYPES.FORMS_OPPORTUNITIES,
      version,
    );
    if (!aggregationResult.success) {
      log.error(`[Form Opportunity]  No data aggregated for site ${siteId} (${site.getBaseURL()}): ${aggregationResult.message}`);
      return;
    }

    // Transform the aggregated data to the expected format
    const aggregatedData = aggregationResult.finalResultFiles.current;
    const a11yData = [];

    // Process each form identified by composite key (URL + formSource)
    Object.entries(aggregatedData).forEach(([key, data]) => {
      // Skip the 'overall' key as it contains summary data
      if (key === 'overall') return;

      const { violations } = data;

      // Extract URL and formSource from the composite key
      const [url, formSource] = key.includes(URL_SOURCE_SEPARATOR)
        ? key.split(URL_SOURCE_SEPARATOR)
        : [key, null];

      // Transform violations to the expected format
      const transformedData = transformAxeViolationsToA11yData({
        violations,
        url,
        formSource,
      });

      a11yData.push(transformedData);
    });

    // Create opportunity
    const opportunity = await createOrUpdateOpportunity(auditId, siteId, a11yData, context);

    // Create individual suggestions for the opportunity (if opportunity was created/updated)
    if (opportunity) {
      await createFormAccessibilityIndividualSuggestions(aggregatedData, opportunity, context);
    }
    // Send message to importer-worker to create/update a11y metrics
    log.debug(`[FormA11yAudit] [Site Id: ${siteId}] Sending message to importer-worker to create/update a11y metrics`);
    await sendRunImportMessage(
      sqs,
      env.IMPORT_WORKER_QUEUE_URL,
      A11Y_METRICS_AGGREGATOR_IMPORT_TYPE,
      siteId,
      {
        scraperBucketName: env.S3_SCRAPER_BUCKET_NAME,
        importerBucketName: env.S3_IMPORTER_BUCKET_NAME,
        version,
        urlSourceSeparator: URL_SOURCE_SEPARATOR,
        totalChecks: WCAG_CRITERIA_COUNTS.TOTAL,
        options: {},
      },
    );

    // Send message to mystique for detection
    const mystiqueMessage = {
      type: 'detect:forms-a11y',
      siteId,
      auditId,
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        url: site.getBaseURL(),
        opportunityId: opportunity?.getId(),
        a11y: a11yData,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] a11y opportunity created (if issues found) and sent to mystique`);
  } catch (error) {
    log.error(`[Form Opportunity] [Site Id: ${site.getId()}] Error creating a11y issues: ${error.message}`);
  }
}

export default async function handler(message, context) {
  const { log } = context;
  const { auditId, siteId, data } = message;
  const { opportunityId, a11y } = data;
  log.info(`[Form Opportunity] [Site Id: ${siteId}] Received message in accessibility handler: ${JSON.stringify(message, null, 2)}`);
  try {
    const opportunity = await createOrUpdateOpportunity(
      auditId,
      siteId,
      a11y,
      context,
      opportunityId,
    );
    if (!opportunity) {
      log.info(`[Form Opportunity] [Site Id: ${siteId}] A11y opportunity not detected, skipping guidance`);
      return ok();
    }

    // Create individual suggestions from Mystique data
    await createFormAccessibilitySuggestionsFromMystique(a11y, opportunity, context);

    log.info(`[Form Opportunity] [Site Id: ${siteId}] a11y opportunity: ${JSON.stringify(opportunity, null, 2)}`);
    const opportunityData = opportunity.getData();
    const a11yData = opportunityData.accessibility;
    // eslint-disable-next-line max-len
    const formsList = a11yData.filter((item) => !item.formDetails).map((item) => ({ form: item.form, formSource: item.formSource }));
    log.info(`[Form Opportunity] [Site Id: ${siteId}] formsList: ${JSON.stringify(formsList, null, 2)}`);
    await (formsList.length === 0
      ? sendMessageToMystiqueForGuidance(context, opportunity)
      : sendMessageToFormsQualityAgent(context, opportunity, formsList));
  } catch (error) {
    log.error(`[Form Opportunity] [Site Id: ${siteId}] Failed to process a11y opportunity from mystique: ${error.message}`);
  }
  return ok();
}
