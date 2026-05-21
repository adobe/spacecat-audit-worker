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

import { toPathname } from './utils/utils.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Writes citability metrics to the PageCitability entity for all successfully scraped URLs.
 * This enables the page-citability audit to detect recently-processed URLs via its 7-day
 * staleness filter, avoiding duplicate scraping across both audits.
 *
 * @param {Array} comparisonResults - Results from compareHtmlContent (all scraped URLs)
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<void>}
 */
export async function writeToCitabilityRecords(comparisonResults, siteId, context) {
  if (!comparisonResults?.length) {
    return;
  }

  const { dataAccess, log } = context;
  const { PageCitability } = dataAccess;

  if (!PageCitability?.allBySiteId) {
    log.debug(`${LOG_PREFIX} PageCitability not available, skipping citability record writes`);
    return;
  }

  const existingRecords = await PageCitability.allBySiteId(siteId);
  const existingRecordsMap = new Map(
    existingRecords.map((r) => [toPathname(r.getUrl()), r]),
  );

  const successful = comparisonResults.filter((r) => !r.error);
  const WRITE_BATCH_SIZE = 10;

  const writeOne = async (result) => {
    const {
      url,
      citabilityScore,
      contentGainRatio,
      wordDifference,
      wordCountBefore,
      wordCountAfter,
      isDeployedAtEdge,
    } = result;
    try {
      const existing = existingRecordsMap.get(toPathname(url));
      if (existing) {
        existing.setCitabilityScore(citabilityScore ?? null);
        existing.setContentRatio(contentGainRatio ?? null);
        existing.setWordDifference(wordDifference ?? null);
        existing.setBotWords(wordCountBefore ?? null);
        existing.setNormalWords(wordCountAfter ?? null);
        existing.setIsDeployedAtEdge(isDeployedAtEdge ?? false);
        await existing.save();
      } else {
        await PageCitability.create({
          siteId,
          url,
          citabilityScore: citabilityScore ?? null,
          contentRatio: contentGainRatio ?? null,
          wordDifference: wordDifference ?? null,
          botWords: wordCountBefore ?? null,
          normalWords: wordCountAfter ?? null,
          isDeployedAtEdge: isDeployedAtEdge ?? false,
        });
      }
      return true;
    } catch (e) {
      log.warn(`${LOG_PREFIX} Failed to write PageCitability for ${url}: ${e.message}`);
      return false;
    }
  };

  let written = 0;
  for (let i = 0; i < successful.length; i += WRITE_BATCH_SIZE) {
    const batch = successful.slice(i, i + WRITE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map(writeOne));
    written += results.filter(Boolean).length;
  }

  log.info(`${LOG_PREFIX} Wrote PageCitability records: ${written}/${successful.length}`);
}
