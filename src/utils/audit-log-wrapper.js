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
 * Adds audit context (siteId, auditType) to all log objects.
 * Must be used AFTER logWrapper from shared-utils.
 */
export function auditLogWrapper(fn) {
  return async (message, context) => {
    if (context.log && !context.auditLogWrapped) {
      const originalLog = { ...context.log };
      const siteId = message?.siteId;
      const auditType = message?.type;

      const logLevels = ['info', 'error', 'debug', 'warn', 'trace', 'verbose', 'silly', 'fatal'];

      logLevels.forEach((level) => {
        if (typeof originalLog[level] === 'function') {
          context.log[level] = (logObj) => {
            // If logObj is a JSON string, parse it first
            let parsedObj = logObj;
            if (typeof logObj === 'string') {
              try {
                parsedObj = JSON.parse(logObj);
              } catch (e) {
                // If parsing fails, just pass through the original string
                return originalLog[level](logObj);
              }
            }

            // Create new object instead of mutating parameter
            if (parsedObj?.constructor === Object) {
              const enhanced = { ...parsedObj };
              if (siteId) enhanced.siteId = siteId;
              if (auditType) enhanced.auditType = auditType;
              return originalLog[level](JSON.stringify(enhanced));
            }
            return originalLog[level](JSON.stringify(parsedObj));
          };
        }
      });

      context.auditLogWrapped = true;
    }

    return fn(message, context);
  };
}
