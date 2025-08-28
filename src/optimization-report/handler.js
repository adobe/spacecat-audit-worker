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

/**
 * Optimization report callback handler
 * Passes the received message to the report jobs queue without modification
 * @param {object} message the message object received from SQS
 * @param {UniversalContext} context the context of the universal serverless function
 * @returns {Promise<void>}
 */
async function optimizationReportCallback(message, context) {
  const { log, sqs, env } = context;
  const { data } = message;
  const { siteId, reportId } = data;

  log.info(`Processing optimization report callback for site: ${siteId} with report id: ${reportId}`);

  try {
    // Get the report jobs queue URL from environment variables
    const { REPORT_JOBS_QUEUE_URL: reportJobsQueueUrl } = env;

    if (!reportJobsQueueUrl) {
      throw new Error('REPORT_JOBS_QUEUE_URL environment variable is not set');
    }

    // Send the message to the report jobs queue without modification
    await sqs.sendMessage(reportJobsQueueUrl, message);

    log.info(`Successfully sent message to report jobs queue for site: ${siteId} and report id: ${reportId}`);
  } catch (error) {
    log.error(`Failed to send message to report jobs queue for site: ${siteId} and report id: ${reportId}`, error);
    throw error;
  }
}

export default optimizationReportCallback;
