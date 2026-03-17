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

import { context as adobeFetchContext } from '@adobe/fetch';
import { ok } from '@adobe/spacecat-shared-http-utils';
import { hasText, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

import { postMessageSafe } from '../utils/slack-utils.js';
import { detectCdnFromUrl } from './cdn-detector.js';

/**
 * Returns a fetch that skips TLS verification when NODE_TLS_REJECT_UNAUTHORIZED=0 (local dev only).
 * The shared tracingFetch does not pass this through, so we use @adobe/fetch context when set.
 */
function getFetchForCdnDetection() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return adobeFetchContext({ rejectUnauthorized: false }).fetch;
  }
  return fetch;
}

/**
 * Normalizes URL: ensures scheme, default https.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  return `https://${u}`;
}

export default async function detectCdn(message, context) {
  const { log } = context;
  const {
    baseURL,
    siteId,
    slackContext = {},
  } = message || {};

  const { channelId, threadTs, target: slackTarget } = slackContext;

  if (!hasText(channelId) || !hasText(threadTs)) {
    log.warn('[detect-cdn] Missing slackContext.channelId or slackContext.threadTs');
    return ok({ status: 'ignored', reason: 'missing-slack-context' });
  }

  const url = normalizeUrl(baseURL);
  if (!url) {
    await postMessageSafe(context, channelId, ':warning: detect-cdn: missing or invalid URL.', {
      threadTs,
      ...(slackTarget && { target: slackTarget }),
    });
    return ok({ status: 'error', reason: 'missing-url' });
  }

  log.info(`[detect-cdn] Detecting CDN for ${url}${siteId ? ` (siteId=${siteId})` : ''}`);

  const fetchFn = getFetchForCdnDetection();
  const { cdn, error } = await detectCdnFromUrl(url, fetchFn, { timeout: 10000, log: context.log });

  const siteNote = siteId ? ` (siteId: \`${siteId}\`)` : '';
  let text;
  if (error) {
    text = `:x: *CDN detection* for *${url}*${siteNote}\n\nCould not fetch URL: \`${error}\``;
  } else {
    text = `:mag: *CDN detection* for *${url}*${siteNote}\n\n*Detected CDN:* \`${cdn}\``;
  }

  await postMessageSafe(context, channelId, text, {
    threadTs,
    ...(slackTarget && { target: slackTarget }),
  });

  return ok({
    status: 'ok',
    url,
    cdn,
    error: error || null,
  });
}
