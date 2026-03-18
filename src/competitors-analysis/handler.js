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

const LOG_PREFIX = '[CompetitorsAnalysis]';

/**
 * Extracts competitor names from brand profile competitive context.
 * Merges contrasting_brands and similar_brands, extracting only the name field.
 *
 * @param {object} brandProfile - The brand profile from site config
 * @returns {string[]} Array of competitor names
 */
function extractBrandProfileCompetitors(brandProfile) {
  const competitiveContext = brandProfile?.competitive_context;
  if (!competitiveContext) {
    return [];
  }

  const contrastingBrands = competitiveContext.contrasting_brands || [];
  const similarBrands = competitiveContext.similar_brands || [];

  const names = [
    ...contrastingBrands.map((b) => b?.name).filter(Boolean),
    ...similarBrands.map((b) => b?.name).filter(Boolean),
  ];

  return names;
}

/**
 * Extracts brand aliases from S3 LLMO config.
 * Flattens all brands.aliases[].aliases arrays.
 *
 * @param {object} s3Config - The LLMO config from S3
 * @returns {string[]} Array of brand aliases
 */
function extractBrandAliases(s3Config) {
  const aliasEntries = s3Config?.brands?.aliases || [];
  const allAliases = aliasEntries.flatMap((entry) => entry?.aliases || []);
  return allAliases;
}

/**
 * Extracts competitor names from S3 LLMO config.
 *
 * @param {object} s3Config - The LLMO config from S3
 * @returns {string[]} Array of competitor names
 */
function extractS3Competitors(s3Config) {
  const competitors = s3Config?.competitors?.competitors || [];
  return competitors.map((c) => c?.name).filter(Boolean);
}

/**
 * Runs the competitors analysis audit.
 * Extracts brand/competitor data from site config and S3 LLMO config,
 * then sends a structured message to Mystique.
 *
 * @param {string} finalUrl - The resolved audit URL
 * @param {object} context - Execution context
 * @param {object} site - Site model
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
async function competitorsAnalysisRunner(finalUrl, context, site) {
  const {
    log, sqs, env, s3Client,
  } = context;
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.info(`${LOG_PREFIX} Starting competitors analysis for site ${siteId} (${baseURL})`);

  const siteConfig = site.getConfig();
  const brandProfile = siteConfig?.getBrandProfile?.();

  const companyName = siteConfig?.getLlmoBrand?.() || baseURL;
  const companyWebsite = baseURL;
  const industry = brandProfile?.competitive_context?.industry || null;

  const brandProfileCompetitors = extractBrandProfileCompetitors(brandProfile);
  log.debug(`${LOG_PREFIX} Found ${brandProfileCompetitors.length} competitors from brand profile`);

  const s3Bucket = env?.S3_IMPORTER_BUCKET_NAME;
  let s3Config = null;
  let s3ConfigExists = false;

  if (s3Client && s3Bucket) {
    try {
      const result = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket });
      s3Config = result.config;
      s3ConfigExists = result.exists;
      log.debug(`${LOG_PREFIX} S3 LLMO config exists: ${s3ConfigExists}`);
    } catch (err) {
      log.warn(`${LOG_PREFIX} Failed to read S3 LLMO config: ${err.message}`);
    }
  } else {
    log.warn(`${LOG_PREFIX} S3 client or bucket not configured, skipping S3 config read`);
  }

  const brandAliases = extractBrandAliases(s3Config);
  const s3Competitors = extractS3Competitors(s3Config);

  log.debug(`${LOG_PREFIX} Found ${brandAliases.length} brand aliases from S3 config`);
  log.debug(`${LOG_PREFIX} Found ${s3Competitors.length} competitors from S3 config`);

  const aliasesSet = new Set(brandAliases);
  const competitorsSet = new Set([...brandProfileCompetitors, ...s3Competitors]);

  const aliases = [...aliasesSet];
  const competitors = [...competitorsSet];

  log.info(`${LOG_PREFIX} Extracted data: companyName=${companyName}, aliases=${aliases.length}, competitors=${competitors.length}`);

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping message send`);
    return {
      auditResult: {
        success: true,
        messageSent: false,
        companyName,
        companyWebsite,
        industry,
        aliasCount: aliases.length,
        competitorCount: competitors.length,
      },
      fullAuditRef: finalUrl,
    };
  }

  const mystiqueMessage = {
    type: 'guidance:competitor-analysis',
    siteId,
    auditId: `competitors-analysis-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
    time: new Date().toISOString(),
    data: {
      companyName,
      companyWebsite,
      aliases,
      competitors,
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`${LOG_PREFIX} Sent message to Mystique for site ${siteId}`);

  return {
    auditResult: {
      success: true,
      messageSent: true,
      companyName,
      companyWebsite,
      industry,
      aliasCount: aliases.length,
      competitorCount: competitors.length,
    },
    fullAuditRef: finalUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(competitorsAnalysisRunner)
  .build();
