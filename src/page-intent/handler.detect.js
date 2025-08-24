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

import { hasText } from '@adobe/spacecat-shared-utils';
import { PageIntent as PageIntentModel } from '@adobe/spacecat-shared-data-access';
import { ok } from '@adobe/spacecat-shared-http-utils';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { siteId, data = {} } = message;
  const { pageIntent: pageIntentRaw, topic, url } = data;

  if (!hasText(siteId) || !hasText(pageIntentRaw) || !hasText(topic) || !hasText(url)) {
    throw new Error(`Missing required parameters. siteId: ${siteId}, pageIntent: ${pageIntentRaw}, topic: ${topic}, url: ${url}`);
  }
  const pageIntent = pageIntentRaw.toUpperCase();

  const { PageIntent } = dataAccess;
  if (!Object.values(PageIntentModel.PAGE_INTENTS).includes(pageIntent)) {
    throw new Error(`Invalid page intent value: ${pageIntent}`);
  }

  let pi = await PageIntent.findByUrl(url);
  if (pi) {
    pi.setTopic(topic);
    pi.setPageIntent(pageIntent);
    await pi.save();
    log.info(`Updated Page Intent entity: ${JSON.stringify(pi.toJSON())}`);
  } else {
    pi = await PageIntent.create({
      siteId,
      url,
      pageIntent,
      topic,
    });
    log.info(`New Page Intent entity created: ${JSON.stringify(pi.toJSON())}`);
  }

  return ok();
}
