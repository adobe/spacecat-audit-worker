/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { internalServerError, noContent } from '@adobe/spacecat-shared-http-utils';
import {
  getRUMUrl,
} from '../support/utils.js';

export function filter404Data(data) {
  return data.topurl.toLowerCase() !== 'other' && !!data.source; // ignore the combined result and the 404s with no source
}

function process404Response(data) {
  return data
    .filter(filter404Data)
    .map((row) => ({
      url: row.topurl,
      pageviews: row.views,
      source: row.source,
    }));
}
export default async function audit404(message, context) {
  const { type, url, auditContext } = message;
  const { log, sqs } = context;
  const {
    AUDIT_RESULTS_QUEUE_URL: queueUrl,
  } = context.env;

  try {
    log.info(`Received audit req for domain: ${url}`);

    const rumAPIClient = RUMAPIClient.createFrom(context);
    const finalUrl = await getRUMUrl(url);
    auditContext.finalUrl = finalUrl;

    const params = {
      url: finalUrl,
    };

    const data = await rumAPIClient.get404Sources(params);
    const auditResult = process404Response(data);

    await sqs.sendMessage(queueUrl, {
      type,
      url,
      auditContext,
      auditResult,
    });

    log.info(`Successfully audited ${url} for ${type} type audit`);

    return noContent();
  } catch (e) {
    return internalServerError(`Internal server error: ${e.message}`);
  }
}
