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

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { isValidUrl } from '@adobe/spacecat-shared-utils';
import {
  filterBrokenSuggestedUrls,
  isEntityReplacementSuggestion,
  resolveParentPathFallback,
} from '../utils/url-utils.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'srsltid', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid',
]);

function stripTrackingParams(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Suggestion, Site } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    brokenLinks, opportunityId,
  } = data;
  log.debug(`Message received in broken-links suggestion handler: ${JSON.stringify(message, null, 2)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`Site not found for siteId: ${siteId}`);
    return notFound('Site not found');
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }
  const { Opportunity } = dataAccess;
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[Broken Links Guidance] Opportunity not found for ID: ${opportunityId}`);
    return notFound('Opportunity not found');
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[${opportunity.getType()} Guidance] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    return badRequest('Site ID mismatch');
  }

  // Validate brokenLinks array
  if (!brokenLinks || !Array.isArray(brokenLinks)) {
    log.error(`[${opportunity.getType()} Guidance] Invalid brokenLinks format. Expected array, got: ${typeof brokenLinks}. Message: ${JSON.stringify(message)}`);
    return badRequest('Invalid brokenLinks format');
  }

  if (brokenLinks.length === 0) {
    log.info(`[${opportunity.getType()} Guidance] No broken links provided in Mystique response`);
    return ok();
  }

  // Batch-fetch all suggestions in a single query instead of N individual findById calls
  const suggestionIds = brokenLinks
    .map((bl) => bl.suggestionId)
    .filter(Boolean);

  const { data: existingSuggestions = [] } = suggestionIds.length > 0
    ? await Suggestion.batchGetByKeys(suggestionIds.map((id) => ({ suggestionId: id })))
    : { data: [] };

  const suggestionMap = new Map(existingSuggestions.map((s) => [s.getId(), s]));

  // Filter and validate suggested URLs configured for the site
  const overrideBaseURL = site.getConfig()?.getFetchConfig()?.overrideBaseURL;
  const effectiveBaseURL = (overrideBaseURL && isValidUrl(overrideBaseURL))
    ? overrideBaseURL
    : site.getBaseURL();

  const toSave = [];
  // Process each broken link (URL filtering is async but not a DB call)
  await Promise.all(brokenLinks.map(async (brokenLink) => {
    const suggestion = suggestionMap.get(brokenLink.suggestionId);
    if (!suggestion) {
      log.error(`[${opportunity.getType()}] Suggestion not found for ID: ${brokenLink.suggestionId}`);
      return;
    }

    const suggestedUrls = brokenLink.suggestedUrls || [];

    // Validate that suggestedUrls is an array
    if (!Array.isArray(suggestedUrls)) {
      log.info(
        `[${opportunity.getType()}] Invalid suggestedUrls format for suggestion ${brokenLink.suggestionId}. `
        + `Expected array, got: ${typeof suggestedUrls}. Available fields: ${Object.keys(brokenLink).join(', ')}`,
      );
    }

    // Read existing data early so url_to is available for entity-replacement filtering
    const existingData = suggestion.getData() || {};
    const brokenUrl = existingData.url_to || '';

    // 1. Drop entity-replacement siblings (e.g. /contact/john-smith → /contact/jane-doe)
    const entityFiltered = (Array.isArray(suggestedUrls) ? suggestedUrls : [])
      .filter((url) => {
        if (brokenUrl && isEntityReplacementSuggestion(brokenUrl, url)) {
          log.info(`[${opportunity.getType()}] Dropping entity-replacement sibling: ${url} (broken: ${brokenUrl})`);
          return false;
        }
        return true;
      });

    // 2. Strip tracking params and deduplicate
    const seen = new Set();
    const cleanedUrls = entityFiltered
      .map(stripTrackingParams)
      .filter((url) => {
        if (seen.has(url)) {
          return false;
        }
        seen.add(url);
        return true;
      });

    const filteredSuggestedUrls = await filterBrokenSuggestedUrls(
      cleanedUrls,
      effectiveBaseURL,
    );

    // Drop root-domain fallbacks (homepage with no meaningful path).
    // When Mystique can't access site content it falls back to the base URL,
    // which passes filterBrokenSuggestedUrls (it returns 200) but is always
    // worse than the parent-path fallback that runs below.
    const nonRootSuggestedUrls = filteredSuggestedUrls.filter((url) => {
      try {
        const { pathname } = new URL(url);
        return pathname !== '/' && pathname !== '';
      } catch {
        return true;
      }
    });

    const existingSuggestedUrls = Array.isArray(existingData.urlsSuggested)
      ? existingData.urlsSuggested.filter(Boolean)
      : [];
    let nextSuggestedUrls = nonRootSuggestedUrls;
    if (nextSuggestedUrls.length === 0) {
      if (existingSuggestedUrls.length > 0) {
        nextSuggestedUrls = existingSuggestedUrls;
      } else {
        const parentFallback = brokenUrl
          ? await resolveParentPathFallback(brokenUrl)
          : null;
        if (parentFallback) {
          log.info(`[${opportunity.getType()}] Using parent path fallback: ${parentFallback} (broken: ${brokenUrl})`);
          nextSuggestedUrls = [parentFallback];
        } else if (filteredSuggestedUrls.length > 0) {
          // No valid parent path exists — restore Mystique's homepage suggestion since it
          // may be intentional (e.g. the entire section was removed) and is better than
          // hardcoding the base URL with no context from Mystique
          log.info(`[${opportunity.getType()}] No parent path found, keeping Mystique's root-domain suggestion (broken: ${brokenUrl})`);
          nextSuggestedUrls = filteredSuggestedUrls;
        } else {
          nextSuggestedUrls = [effectiveBaseURL];
        }
      }
    }

    // Handle AI rationale - omit it if all URLs were filtered out or none were provided
    // This prevents storing an empty string which fails schema validation
    let aiRationale = brokenLink.aiRationale || undefined;
    if (filteredSuggestedUrls.length === 0 && cleanedUrls.length > 0) {
      // All URLs were filtered out (likely invalid/broken):
      // fall back to base URL with no rationale, unless a previous run already stored valid URLs
      log.info('All the suggested URLs were filtered out');
      aiRationale = existingSuggestedUrls.length > 0
        ? existingData.aiRationale || undefined : undefined;
    } else if (filteredSuggestedUrls.length === 0 && cleanedUrls.length === 0) {
      // No URLs provided by Mystique (LLM/Bright Data found nothing):
      // fall back to base URL with no rationale, unless a previous run already stored valid URLs
      log.info('No suggested URLs provided by Mystique');
      aiRationale = existingSuggestedUrls.length > 0
        ? existingData.aiRationale || undefined : undefined;
    } else if (
      nonRootSuggestedUrls.length === 0
      && filteredSuggestedUrls.length > 0
      && !filteredSuggestedUrls.includes(nextSuggestedUrls[0])
    ) {
      // Mystique suggested only the homepage but we replaced it with a parent path:
      // Mystique's rationale was written about the homepage, not the parent path, so drop it
      aiRationale = undefined;
    }

    // Preserve factId from Mystique enrichment (autofix bridge)
    const updatedData = {
      ...existingData,
      urlsSuggested: nextSuggestedUrls,
    };
    if (aiRationale) {
      updatedData.aiRationale = aiRationale;
    } else {
      delete updatedData.aiRationale;
    }
    // Add factId if provided by Mystique
    if (brokenLink.factId) {
      updatedData.factId = brokenLink.factId;
    }
    warnOnInvalidSuggestionData(updatedData, opportunity.getType(), log);
    suggestion.setData(updatedData);
    toSave.push(suggestion);
  }));

  if (toSave.length > 0) {
    await Suggestion.saveMany(toSave);
  }

  return ok();
}
