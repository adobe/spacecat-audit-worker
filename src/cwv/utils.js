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

export async function sendMessageToMystiqueForGuidance(context, opportunity) {
  const {
    log, sqs, env, site,
  } = context;

  try {
    if (opportunity) {
      log.info(`Received CWV opportunity for guidance: ${JSON.stringify(opportunity)}`);
      const opptyData = JSON.parse(JSON.stringify(opportunity));

      const mystiqueMessage = {
        type: 'guidance:cwv-analysis',
        siteId: opptyData.siteId,
        auditId: opptyData.auditId,
        deliveryType: site ? site.getDeliveryType() : 'aem_cs',
        time: new Date().toISOString(),
        // keys inside data should follow snake case and outside should follow camel case
        data: {
          url: site ? site.getBaseURL() : '',
          opportunityId: opptyData.opportunityId || '',
          cwv_metrics: opptyData.data?.cwv_metrics || [],
          opportunity_type: 'cwv',
          total_suggestions: opptyData.data?.total_suggestions || 0,
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
      log.info(`CWV opportunity sent to mystique for guidance: ${JSON.stringify(mystiqueMessage)}`);
    }
  } catch (error) {
    log.error(`[CWV] Failed to send message to Mystique for opportunity ${opportunity?.getId()}: ${error.message}`);
    throw new Error(error.message);
  }
}
