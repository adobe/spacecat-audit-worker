/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';
import { hasText } from '@adobe/spacecat-shared-utils';

/**
 * Sends a message to a Slack channel.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID (e.g., 'C1234567890')
 * @param {string} text - The message text
 * @param {object} options - Additional options
 * @param {string} options.target - Target workspace (default: WORKSPACE_INTERNAL)
 * @param {string} options.threadTs - Thread timestamp for replying to a thread
 * @param {Array} options.blocks - Slack Block Kit blocks for rich formatting
 * @param {Array} options.attachments - Slack message attachments
 * @returns {Promise<{channelId: string, threadId: string}>} Channel and thread IDs
 */
export async function postMessage(context, channelId, text, options = {}) {
  const {
    target = SLACK_TARGETS.WORKSPACE_INTERNAL,
    threadTs,
    blocks,
    attachments,
  } = options;

  const slackClient = BaseSlackClient.createFrom(context, target);

  const message = {
    channel: channelId,
    text,
  };

  if (threadTs) {
    message.thread_ts = threadTs;
  }

  if (blocks) {
    message.blocks = blocks;
  }

  if (attachments) {
    message.attachments = attachments;
  }

  return slackClient.postMessage(message);
}

/**
 * Sends a message to a Slack channel with error handling and logging.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID
 * @param {string} text - The message text
 * @param {object} options - Additional options (same as postMessage)
 * @returns {Promise<{success: boolean, result?: object, error?: Error}>} Operation result
 */
export async function postMessageSafe(context, channelId, text, options = {}) {
  try {
    const result = await postMessage(context, channelId, text, options);
    context.log?.info(`Successfully sent Slack message to channel ${channelId}`);
    return { success: true, result };
  } catch (error) {
    context.log?.error(`Failed to send Slack message to channel ${channelId}:`, error);
    return { success: false, error };
  }
}

/**
 * Act as a wrapper around postMessageSafe() to optionally send a message.
 * @param {object} context - The context object
 * @param {string} channelId - The Slack channel ID
 * @param {string} text - The message text
 * @param {object} options - Additional options (same as postMessage)
 * @returns {Promise<{success: boolean, result?: object, error?: Error}>} Operation result
 */
export async function postMessageOptional(context, channelId, text, options = {}) {
  const { threadTs } = options;
  if (hasText(channelId) && hasText(threadTs)) {
    return postMessageSafe(context, channelId, text, options);
  } else {
    return { success: false, result: null };
  }
}

/**
 * Builds the "audit finished" Slack summary for an offsite analysis
 * (cited / youtube / reddit), keeping the three consistent.
 *
 * Visibility is the QA gate's decision (opportunity status): a visible
 * opportunity is one the gate surfaced, which means the *surfaced* set is below
 * the hallucination threshold. We therefore do NOT print the raw rate on a
 * visible opportunity — after drop-and-recover the raw pre-filter rate can be
 * high (e.g. 48%) and be misread as "shown despite being bad", when the shown
 * items are actually the clean survivors. The raw rate is only shown when the
 * opportunity is hidden, where it is the reason for suppression.
 *
 * When `emptyPersist` is true, the suggestions failed to store (e.g. a DB conflict) so
 * the opportunity was auto-ignored. This uses a warning tone to stand apart from a QA-gate
 * suppression, so operators can tell a storage failure from a quality decision.
 *
 * @param {object} params
 * @param {string} params.analysisName - e.g. 'cited-analysis'
 * @param {string} params.baseUrl - Site base URL
 * @param {number} params.suggestionsCount - Number of suggestions processed
 * @param {boolean} params.isVisible - Whether the opportunity is customer-visible
 * @param {object} [params.verdict] - The qaVerdict stamp (rate, rateDetermined, droppedUrls)
 * @param {boolean} [params.emptyPersist] - True when suggestions failed to persist and the
 *   opportunity was auto-ignored
 * @returns {string} The formatted Slack message
 */
export function buildAnalysisVisibilityMessage({
  analysisName,
  baseUrl,
  suggestionsCount,
  isVisible,
  verdict,
  emptyPersist = false,
}) {
  if (emptyPersist) {
    return `:warning: *${analysisName}* audit finished for *${baseUrl}*\n`
      + '• 0 suggestions persisted\n'
      + '• :see_no_evil: Not visible in the UI — no suggestions stored (auto-ignored)';
  }

  const suggestionsLine = `• ${suggestionsCount} suggestion${suggestionsCount === 1 ? '' : 's'} processed`;

  let note = '';
  if (isVisible) {
    if (verdict?.rateDetermined === false) {
      // Real analysis, but the rate couldn't be computed (gate failed open).
      note = ' — hallucination rate n/a';
    } else if (verdict) {
      // Surfaced => below threshold. Don't show the raw rate; optionally note how
      // many flagged items the gate removed to get there.
      note = ' — below hallucination threshold';
      const droppedCount = Array.isArray(verdict.droppedUrls) ? verdict.droppedUrls.length : 0;
      if (droppedCount > 0) {
        note += ` (${droppedCount} flagged item${droppedCount === 1 ? '' : 's'} removed)`;
      }
    }
    // No verdict at all => no note (unknown), preserving prior behavior.
  } else if (verdict) {
    // Hidden: show the rate that drove the suppression.
    if (verdict.rateDetermined === false) {
      note = ' — hallucination rate n/a';
    } else if (typeof verdict.rate === 'number') {
      note = ` — hallucination ${Math.round(verdict.rate * 100)}%`;
    }
  }

  const header = isVisible ? ':white_check_mark:' : ':warning:';
  const visibilityLine = isVisible
    ? `• :eye: Visible in the UI${note}`
    : `• :see_no_evil: Not visible in the UI${note}`;

  return `${header} *${analysisName}* audit finished for *${baseUrl}*\n${suggestionsLine}\n${visibilityLine}`;
}

export { SLACK_TARGETS };
