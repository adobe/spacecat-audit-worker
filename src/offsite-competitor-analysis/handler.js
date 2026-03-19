/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { llmoConfig } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';

const LOG_PREFIX = '[OffsiteCompetitorAnalysis]';

/**
 * Extracts deduplicated brand aliases from S3 LLMO config.
 * Flattens all brands.aliases[].aliases arrays.
 *
 * @param {object} s3Config - The LLMO config from S3
 * @returns {string[]} Deduplicated array of brand aliases
 */
function getBrandAliases(s3Config) {
  return [...new Set(
    (s3Config?.brands?.aliases || []).flatMap((entry) => entry?.aliases || []),
  )];
}

/**
 * Extracts deduplicated competitor names from both the brand profile and S3 LLMO config.
 * Merges contrasting_brands and similar_brands from the brand profile with
 * competitors.competitors from S3.
 *
 * @param {object} brandProfile - The brand profile from site config
 * @param {object} s3Config - The LLMO config from S3
 * @returns {string[]} Deduplicated array of competitor names
 */
function getCompetitors(brandProfile, s3Config) {
  const competitiveContext = brandProfile?.competitive_context;
  const competitorNames = new Set();

  for (const b of competitiveContext?.contrasting_brands || []) {
    if (b?.name) competitorNames.add(b.name);
  }
  for (const b of competitiveContext?.similar_brands || []) {
    if (b?.name) competitorNames.add(b.name);
  }
  for (const c of s3Config?.competitors?.competitors || []) {
    if (c?.name) competitorNames.add(c.name);
  }

  return [...competitorNames];
}

/**
 * Runs the offsite competitor analysis audit.
 * Extracts brand/competitor data from site config and S3 LLMO config.
 * The Mystique message is sent in a post-processor so the persisted audit ID is available.
 *
 * @param {string} finalUrl - The resolved audit URL
 * @param {object} context - Execution context
 * @param {object} site - Site model
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
async function offsiteCompetitorAnalysisRunner(finalUrl, context, site) {
  const { log, env, s3Client } = context;
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.info(`${LOG_PREFIX} Starting competitors analysis for site ${siteId} (${baseURL})`);

  const siteConfig = site.getConfig();
  const brandProfile = siteConfig?.getBrandProfile?.();

  const companyName = siteConfig?.getLlmoBrand?.() || baseURL;
  const companyWebsite = baseURL;
  const industry = brandProfile?.competitive_context?.industry || null;

  const s3Bucket = env?.S3_IMPORTER_BUCKET_NAME;
  let s3Config = null;

  if (s3Client && s3Bucket) {
    try {
      const result = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket });
      s3Config = result.config;
      log.debug(`${LOG_PREFIX} S3 LLMO config exists: ${result.exists}`);
    } catch (err) {
      log.warn(`${LOG_PREFIX} Failed to read S3 LLMO config: ${err.message}`);
    }
  } else {
    log.warn(`${LOG_PREFIX} S3 client or bucket not configured, skipping S3 config read`);
  }

  const aliases = getBrandAliases(s3Config);
  const competitors = getCompetitors(brandProfile, s3Config);

  log.info(`${LOG_PREFIX} Extracted data: companyName=${companyName}, aliases=${aliases.length}, competitors=${competitors.length}`);

  return {
    auditResult: {
      success: true,
      companyName,
      companyWebsite,
      industry,
      aliases,
      competitors,
    },
    fullAuditRef: finalUrl,
  };
}

/**
 * Post-processor that sends the competitor analysis data to Mystique.
 * Runs after the audit is persisted, so the real audit ID is available.
 *
 * @param {string} auditUrl - The audit URL
 * @param {object} auditData - The persisted audit data
 * @param {object} context - Context with sqs, env, audit, etc.
 * @returns {Promise<object>} The audit data (unchanged)
 */
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  if (!auditResult.success) {
    log.info(`${LOG_PREFIX} Audit failed, skipping Mystique message`);
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping message`);
    return auditData;
  }

  const {
    companyName, companyWebsite, aliases, competitors,
  } = auditResult;

  const message = {
    type: 'guidance:offsite-competitor-analysis',
    siteId,
    auditId: audit.getId(),
    time: new Date().toISOString(),
    data: {
      companyName,
      companyWebsite,
      aliases,
      competitors,
    },
  };

  try {
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`${LOG_PREFIX} Sent message to Mystique for site ${siteId}`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    throw error;
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(offsiteCompetitorAnalysisRunner)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
