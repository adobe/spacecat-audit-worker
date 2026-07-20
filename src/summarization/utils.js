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

function joinKeyPoints(keyPoints) {
  if (!Array.isArray(keyPoints)) {
    return '';
  }
  return keyPoints.map((keyPoint) => `  * ${keyPoint}`).join('\n');
}

/**
 * Returns true if the string has meaningful content (not null, undefined, or blank)
 * @param {string} text
 * @returns {boolean}
 */
function hasSummaryText(text) {
  return typeof text === 'string' && text.trim().length > 0;
}

/**
 * Page summaries should always appear at the top of the page so they are noticed by LLMs early.
 * When no h1 is found, the fallback is body + appendChild (content at bottom). We override
 * to body > :first-child + insertBefore so content is prepended to the page.
 */
function getPageSummaryTransformRules(pageSummary) {
  const selector = pageSummary?.heading_selector || 'body';
  const action = pageSummary?.insertion_method || 'appendChild';
  const isBodyFallback = !selector || selector === 'body';

  if (isBodyFallback) {
    return {
      selector: 'body > :first-child',
      action: 'insertBefore',
    };
  }
  return { selector, action };
}

export function getJsonSummarySuggestion(suggestions, urlToContentHash = {}) {
  const suggestionValues = [];
  suggestions.forEach((suggestion) => {
    // Get scrapedAt once for all suggestion values from this suggestion
    const scrapedAt = suggestion.scrapedAt || new Date().toISOString();
    const pageTransformRules = getPageSummaryTransformRules(suggestion.pageSummary);
    const contentHash = urlToContentHash[suggestion.pageUrl] ?? null;

    // Mystique returns a prompt set per surface; each attaches to its own suggestion.
    const summaryPrompts = Array.isArray(suggestion.summaryPrompts)
      ? suggestion.summaryPrompts : [];
    const keyPointsPrompts = Array.isArray(suggestion.keyPointsPrompts)
      ? suggestion.keyPointsPrompts : [];

    // handle page level summary - only add if summary text is present and not already on page
    const pageSummaryText = suggestion.pageSummary?.formatted_summary;
    const pageSummaryAlreadyPresent = suggestion.page_summary_present === true
      || suggestion.hasExistingSummary === true;
    if (hasSummaryText(pageSummaryText) && !pageSummaryAlreadyPresent) {
      suggestionValues.push({
        summarizationText: pageSummaryText,
        aiGeneratedSummarizationText: pageSummaryText,
        fullPage: true,
        keyPoints: false,
        url: suggestion.pageUrl,
        title: suggestion.pageSummary?.title,
        transformRules: pageTransformRules,
        scrapedAt,
        contentHash,
        prompts: summaryPrompts,
        // Verbatim raw-page sentences the summary was derived from (captured by the
        // gen_summary_crew QA task). Persisted here so the on-demand prompt-regeneration
        // path (build_summarization_inputs) can use them as summary_sources without
        // needing to re-fetch the raw page.
        sourceEvidence: Array.isArray(suggestion.pageSummary?.source_evidence)
          ? suggestion.pageSummary.source_evidence : [],
      });
    }

    // handle key points summary - only add if there are key points and not already on page
    const keyPointsText = joinKeyPoints(suggestion.keyPoints?.formatted_items);
    const keyPointsAlreadyPresent = suggestion.key_points_present === true
      || suggestion.hasExistingKeyPoints === true;
    if (hasSummaryText(keyPointsText) && !keyPointsAlreadyPresent) {
      suggestionValues.push({
        summarizationText: keyPointsText,
        aiGeneratedSummarizationText: keyPointsText,
        fullPage: true,
        keyPoints: true,
        url: suggestion.pageUrl,
        title: suggestion.pageSummary?.title,
        transformRules: pageTransformRules,
        scrapedAt,
        contentHash,
        prompts: keyPointsPrompts,
        // Verbatim raw-page sentences each key point was derived from (parallel to
        // keyPoints.items). Persisted so on-demand regeneration can use them as
        // kp_sources without re-fetching the raw page.
        sourceEvidence: Array.isArray(suggestion.keyPoints?.source_evidence)
          ? suggestion.keyPoints.source_evidence : [],
      });
    }
  });

  return suggestionValues;
}
