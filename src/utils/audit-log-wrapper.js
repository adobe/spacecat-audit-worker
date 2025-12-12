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
export default function enhancedLogWrapper(fn) {
  return async (message, context) => {
    const { log } = context;

    // Only enhance if log exists and hasn't been enhanced yet
    if (log && !context.enhancedLogWrapperApplied) {
      log.info('!TEST! Log object keys:', Object.keys(log));
      log.info('!TEST! Has infoFields:', typeof log.infoFields);
      log.info('!TEST! Logger type:', log.constructor.name);

      log.info({
        text: '!TEST!',
        typeof: typeof log,
        constructor: log?.constructor?.name,
        protoConstructor: Object.getPrototypeOf(log)?.constructor?.name,
        isPlainObject: Object.getPrototypeOf(log) === Object.prototype,
        keys: Object.keys(log),
        hasSymbols: Object.getOwnPropertySymbols(log).length > 0,
      });
      const markers = {};

      // Extract jobId from message if available
      if (typeof message === 'object' && message !== null && 'jobId' in message) {
        markers.jobId = message.jobId;
      }

      // Extract traceId from AWS X-Ray
      const traceId = getTraceId();
      if (traceId) {
        markers.traceId = traceId;
      }

      log.info('!TEST! Applying enhanced log wrapper with markers:', markers);

      // Only enhance if we have markers to add
      if (Object.keys(markers).length > 0) {
        const logLevels = ['info', 'error', 'debug', 'warn', 'trace', 'verbose', 'silly', 'fatal'];

        logLevels.forEach((level) => {
          const originalMethod = log[level];
          const fieldsMethod = log[`${level}Fields`];

          // Only wrap if both methods exist
          if (typeof originalMethod === 'function' && typeof fieldsMethod === 'function') {
            log.info('!TEST! Enhancing log level:', level);
            // Replace the method to call *Fields version with markers appended
            // Simply call the *Fields method with all args + markers as fields
            context.log[level] = (...args) => fieldsMethod.call(log, ...args, markers);
          }
        });
      }

      // Mark that we've enhanced this context
      context.enhancedLogWrapperApplied = true;
    }

    return fn(message, context);
  };
}
