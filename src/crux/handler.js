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

import { generateCSVFile, prependSchema } from '@adobe/spacecat-shared-utils';
import { BaseSlackClient, SLACK_TARGETS } from '@adobe/spacecat-shared-slack-client';
import { fetch } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';

async function handler(url, context) {
  const {
    GOOGLE_CLOUD_API_KEY: cruxApiKey,
    SLACK_REPORT_CHANNEL_INTERNAL: slackChannel,
  } = context.env;

  const CRUX_URL = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${cruxApiKey}`;
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const body = {
    formFactor: 'PHONE',
    origin: prependSchema(url),
    metrics: [
      'cumulative_layout_shift',
      'largest_contentful_paint',
      'interaction_to_next_paint',
    ],
  };

  const resp = await fetch(CRUX_URL, {
    method: 'POST',
    headers,
    body,
  });

  const json = await resp.json();

  const auditResult = {
    scores: {
      CLS: json.record.metrics.cumulative_layout_shift.percentiles.p75,
      LCP: json.record.metrics.largest_contentful_paint.percentiles.p75,
      INP: json.record.metrics.interaction_to_next_paint.percentiles.p75,
    },
  };

  const slackClient = BaseSlackClient.createFrom(context, SLACK_TARGETS.WORKSPACE_INTERNAL);
  await slackClient.fileUpload({
    channel_id: slackChannel,
    file: generateCSVFile([auditResult.scores]),
    filename: `crux-report-for-${url}.csv`,
    initial_comment: `CRUX data for ${url}`,
    unfurl_links: false,
  });

  return {
    auditResult,
    fullAuditRef: prependSchema(url),
  };
}

export default new AuditBuilder().withRunner(handler).build();
