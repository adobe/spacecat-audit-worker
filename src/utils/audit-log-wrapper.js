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

import { getTraceId } from '@adobe/spacecat-shared-utils';

/**
 * Enhanced log wrapper that adds jobId and traceId as structured fields to all log calls.
 *
 * This wrapper enhances the helix-universal-logger by automatically injecting:
 * - jobId: extracted from the message object
 * - traceId: extracted from AWS X-Ray context
 *
 * The wrapper replaces standard log methods (info, error, debug, etc.) with calls to
 * their *Fields counterparts (infoFields, errorFields, etc.), automatically appending
 * jobId and traceId as structured fields.
 *
 * @example
 *
 * // All these work and get jobId/traceId automatically:
 * log.info('message');
 * log.info('User logged in', userData);
 * log.error('Error occurred', error);
 * log.debug('Processing', item1, item2, item3);
 *
 * // Result in logs:
 * // { message: [...], jobId: 'xxx', traceId: 'yyy', ... }
 *  *
 * @param {Function} fn - The original function to be wrapped
 * @returns {Function} - A wrapped function with enhanced logging
 */
export default function logMarkersWrapper(fn, collectors = []) {
  return async (message, context) => {
    const { log } = context;

    if (log && !context.logMarkersApplied) {
      const allMarkers = {};

      if (message?.jobId) {
        allMarkers.jobId = message.jobId;
      }

      const traceId = getTraceId();
      if (traceId) {
        allMarkers.traceId = traceId;
      }

      collectors.forEach((collector) => {
        Object.assign(allMarkers, collector(message, context));
      });

      if (Object.keys(allMarkers).length > 0) {
        ['info', 'error', 'debug', 'warn', 'trace', 'verbose', 'silly', 'fatal'].forEach((level) => {
          const originalMethod = log[level];
          const fieldsMethod = log[`${level}Fields`];

          if (typeof originalMethod === 'function' && typeof fieldsMethod === 'function') {
            context.log[level] = (...args) => fieldsMethod.call(log, ...args, allMarkers);
          }
        });
      }

      context.logMarkersApplied = true;
    }

    return fn(message, context);
  };
}
