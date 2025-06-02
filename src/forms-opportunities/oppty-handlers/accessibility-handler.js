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

import { cleanupS3Files, getObjectKeysFromSubfolders, processFilesWithRetry } from '../../accessibility/utils/data-processing.js';
import { FORM_OPPORTUNITY_TYPES } from '../constants.js';
import { getSuccessCriteriaDetails } from '../utils.js';

/**
 * Create a11y opportunity for the given siteId and auditId
 * @param {string} auditId - The auditId of the audit
 * @param {string} siteId - The siteId of the site
 * @param {object} a11yData - The a11y data
 * @param {object} context - The context object
 * @returns {Promise<void>}
 */
export async function createOpportunity(auditId, siteId, a11yData, context) {
  const {
    dataAccess, log,
  } = context;
  const { Opportunity } = dataAccess;

  if (a11yData?.length === 0) {
    log.info(`[Form Opportunity] [Site Id: ${siteId}] No a11y data found`);
    return;
  }

  const filteredA11yData = a11yData.filter((a11y) => a11y.a11yIssues?.length > 0);
  if (filteredA11yData.length === 0) {
    log.info(`[Form Opportunity] [Site Id: ${siteId}] No accessibility issues found`);
    return;
  }

  try {
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

    const opportunityData = {
      siteId,
      auditId,
      runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
      type: FORM_OPPORTUNITY_TYPES.FORM_A11Y,
      origin: 'AUTOMATION',
      title: 'Form Accessibility Issues',
      description: 'Form Accessibility Issues',
      tags: [
        'Forms Accessibility',
      ],
      data: {
        accessibility: a11yOpptyData,
      },
    };

    await Opportunity.create(opportunityData);
    log.info(`[Form Opportunity] [Site Id: ${siteId}] Created a11y opportunity`);
  } catch (e) {
    log.error(`[Form Opportunity] [Site Id: ${siteId}] Failed to create a11y opportunity with error: ${e.message}`);
    throw new Error(`[Form Opportunity] [Site Id: ${siteId}] Failed to create a11y opportunity with error: ${e.message}`);
  }
  log.info(`[Form Opportunity] [Site Id: ${siteId}] Successfully synced Opportunity for form-accessibility audit type.`);
}

function getWcagCriteriaString(criteria) {
  const { name, criteriaNumber } = getSuccessCriteriaDetails(criteria);
  return `${criteriaNumber} ${name}`;
}

export default async function createAccessibilityOpportunity(auditData, context) {
  const {
    log, site, s3Client, env,
  } = context;

  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const version = new Date().toISOString().split('T')[0];
  try {
    const objectKeysResult = await getObjectKeysFromSubfolders(
      s3Client,
      bucketName,
      'forms-accessibility',
      site.getId(),
      version,
      log,
    );

    if (!objectKeysResult.success) {
      log.error(`[Form Opportunity] [Site Id: ${site.getId()}] Failed to get object keys from subfolders: ${objectKeysResult.message}`);
      return;
    }
    const { objectKeys } = objectKeysResult;

    const { results } = await processFilesWithRetry(
      s3Client,
      bucketName,
      objectKeys,
      log,
      2,
    );

    if (results.length === 0) {
      log.error(`[Form Opportunity] No files could be processed successfully for site ${site.getId()}`);
      return;
    }
    const axeResults = results.map((result) => result.data);

    const a11yData = [];
    for (const a11y of axeResults) {
      const { a11yResult } = a11y;
      a11yResult.forEach((result) => {
        if (result.a11yIssues.length > 0) {
          const a11yIssues = result.a11yIssues.map((a11yIssue) => ({
            issue: a11yIssue.issue,
            level: a11yIssue.level,
            successCriterias: a11yIssue.successCriterias.map(getWcagCriteriaString),
            htmlSources: a11yIssue.htmlWithIssues,
            recommendation: a11yIssue.recommendation,
          }));
          a11yData.push({
            form: a11y.finalUrl,
            formSource: result.formSource,
            a11yIssues,
          });
        }
      });
    }

    await createOpportunity(auditData.getAuditId(), auditData.getSiteId(), a11yData, context);
    await cleanupS3Files(s3Client, bucketName, objectKeys, [], log);
    log.info(`[Form Opportunity] [Site Id: ${site.getId()}] a11y opportunities created/updated`);
  } catch (error) {
    log.error(`[Form Opportunity] [Site Id: ${site.getId()}] Error creating a11y issues: ${error.message}`);
  }
}
